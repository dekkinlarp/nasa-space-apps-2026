import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** The option in effect, however the control marks it: a pressed toggle, a selected tab. */
const ACTIVE = '[aria-pressed="true"], [aria-selected="true"]';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: string;
}

/**
 * The highlight behind the chosen option of a segmented control or tab bar. It is one element that slides
 * and resizes from the old option to the new one, so the eye follows the choice instead of seeing one
 * highlight vanish and another appear.
 *
 * Put it first inside the container, which must be `relative`; the options must be `relative` too so
 * they sit above it, and must not paint a selected background of their own. It finds the chosen option
 * itself and takes its size and corner, so it needs no wiring.
 *
 * The move is a CSS transition on a critically damped curve: no overshoot, and a change of mind part-way
 * starts from where the thumb is. Reduced motion shortens it to nothing (index.css), which leaves a plain swap.
 */
function SlidingThumb({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  // The first placement is not a move, so it is not animated.
  const [placed, setPlaced] = useState(false);
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const read = () => {
      const a = host.querySelector<HTMLElement>(ACTIVE);
      if (!a || !a.offsetWidth) return setBox(null);
      const next = { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight, radius: getComputedStyle(a).borderRadius };
      setBox((p) => (p && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h && p.radius === next.radius ? p : next));
    };
    read();
    const raf = requestAnimationFrame(() => setPlaced(true));
    const mo = new MutationObserver(read);
    mo.observe(host, { attributes: true, attributeFilter: ["aria-pressed", "aria-selected"], childList: true, subtree: true });
    // Sizes change with the panel's width, a label's count badge, and the touch layout.
    const ro = new ResizeObserver(read);
    ro.observe(host);
    for (const c of host.children) ro.observe(c);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro.disconnect();
    };
  }, []);
  return (
    <span
      ref={ref}
      aria-hidden
      data-slot="sliding-thumb"
      className={cn(
        "pointer-events-none absolute top-0 left-0 bg-hull-3 shadow-thumb",
        placed && "transition-[translate,width,height,opacity] duration-300 ease-spring",
        !box && "opacity-0",
        className,
      )}
      style={box ? { translate: `${box.x}px ${box.y}px`, width: box.w, height: box.h, borderRadius: box.radius } : undefined}
    />
  );
}

export { SlidingThumb };
