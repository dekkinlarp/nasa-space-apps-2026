import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Which edges of a scrolling panel have content running off them. `root` holds the scrollers (the
 * elements matching `selector`); the one on screen is read. Re-read on scroll, on resize, when the
 * content changes, and whenever `deps` change (a different tab, a sheet opening).
 */
export function useScrollEdges(root: RefObject<HTMLElement | null>, selector: string, deps: readonly unknown[]) {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const s = [...el.querySelectorAll<HTMLElement>(selector)].find((x) => x.offsetParent !== null);
        const top = !!s && s.scrollTop > 2;
        const bottom = !!s && s.scrollHeight - s.clientHeight - s.scrollTop > 2;
        setEdges((p) => (p.top === top && p.bottom === bottom ? p : { top, bottom }));
      });
    };
    read();
    // Scroll events do not bubble, so listen on the way down.
    el.addEventListener("scroll", read, { capture: true, passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    const mo = new MutationObserver(read);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", read, { capture: true });
      ro.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, selector, ...deps]);
  return edges;
}

/** Blur radii of the stacked layers, weakest (far from the edge) to strongest (at it). Kept gentle: the text
 *  softens as it leaves and stays recognisable, instead of smearing into a glow. */
const LEVELS = [0.4, 0.8, 1.4, 2.2, 3.2, 4.5];

/**
 * A progressive blur over one edge of a scrolling panel: text leaving it is blurred a little, then more,
 * until at the edge it is a soft smear with no line where the effect begins. One blurred strip reads as
 * a frosted rectangle; this is a stack of them, each a little stronger than the last and each masked to its
 * own band, the bands overlapping by half so no step shows. (The technique Magic UI's ProgressiveBlur uses.)
 * Give it the panel's corner radius where it meets a rounded corner; the panel itself must not clip with
 * overflow: hidden plus a radius, or Chrome drops the masks and every layer blurs the whole strip.
 * It appears only while content is actually running off that edge (`show`), easing in and out.
 */
export function EdgeBlur({ side, show, levels = LEVELS, className }: { side: "top" | "bottom"; show: boolean; levels?: number[]; className?: string }) {
  // Gradient stops run from the inner side of the strip (0%) to the panel's edge (100%).
  const dir = side === "top" ? "to top" : "to bottom";
  const band = 100 / levels.length;
  return (
    <div
      aria-hidden
      data-slot="edge-blur"
      className={cn("pointer-events-none absolute inset-x-0 transition-[--edge-k] duration-300 ease-out", side === "top" ? "top-0" : "bottom-0", className)}
      style={{ "--edge-k": show ? 1 : 0 } as CSSProperties}
    >
      {levels.map((px, i) => {
        // Each layer rises over one band, holds for one, and falls over the next; the last holds to the edge.
        const last = i === levels.length - 1;
        const mask = last
          ? `linear-gradient(${dir}, transparent ${i * band}%, #000 100%)`
          : `linear-gradient(${dir}, transparent ${i * band}%, #000 ${(i + 1) * band}%, #000 ${(i + 2) * band}%, transparent ${(i + 3) * band}%)`;
        const blur = `blur(calc(${px}px * var(--edge-k)))`;
        return <i key={px} className="absolute inset-0 block rounded-[inherit]" style={{ zIndex: i + 1, backdropFilter: blur, WebkitBackdropFilter: blur, maskImage: mask, WebkitMaskImage: mask }} />;
      })}
    </div>
  );
}
