import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** How fast the line slides, and how long it rests at each end. */
const SPEED_PX_S = 28;
const HOLD_MS = 1400;

/**
 * One line of content that may be wider than its box. While it fits, it is plain text. When it does not,
 * the clipped edge fades and blurs out, and the line slides slowly to its end and back so all of it can
 * be read. With reduced motion it rests longer and steps between the two ends instead of sliding.
 */
function Ticker({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let pos = 0;
    let dir = 1;
    let last = performance.now();
    let holdUntil = last + HOLD_MS;
    let shown = { left: false, right: false };
    const tick = (now: number) => {
      // Measured every frame: the content changes as the pointer moves, and so does how much overflows.
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) {
        pos = 0;
        dir = 1;
        holdUntil = now + HOLD_MS;
      } else if (now < holdUntil) {
        pos = Math.min(pos, max);
      } else if (reduce) {
        pos = dir > 0 ? max : 0;
        dir = -dir;
        holdUntil = now + HOLD_MS * 2;
      } else {
        pos += (dir * SPEED_PX_S * (now - last)) / 1000;
        if (pos >= max || pos <= 0) {
          pos = Math.max(0, Math.min(max, pos));
          dir = -dir;
          holdUntil = now + HOLD_MS;
        }
      }
      last = now;
      el.scrollLeft = pos;
      const left = pos > 1, right = max - pos > 1;
      if (left !== shown.left || right !== shown.right) {
        shown = { left, right };
        setClip(shown);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // The fade only reaches in from a side that is actually cut off.
  const fade = { "--fade-l": clip.left ? "22px" : "0px", "--fade-r": clip.right ? "22px" : "0px" } as CSSProperties;
  const blur = "pointer-events-none absolute inset-y-0 w-5 backdrop-blur-[2px] transition-opacity duration-200";
  return (
    <div data-slot="ticker" className={cn("relative min-w-0", className)}>
      <div
        ref={ref}
        style={fade}
        className="overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,transparent,#000_var(--fade-l),#000_calc(100%-var(--fade-r)),transparent)]"
      >
        <div className="w-max">{children}</div>
      </div>
      <i aria-hidden className={cn(blur, "left-0 [mask-image:linear-gradient(to_right,#000,transparent)]", clip.left ? "opacity-100" : "opacity-0")} />
      <i aria-hidden className={cn(blur, "right-0 [mask-image:linear-gradient(to_left,#000,transparent)]", clip.right ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

export { Ticker };
