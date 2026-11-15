import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A slot that takes the width of its content, and eases to the new width when the content changes instead of
 * jumping. What sits after it in a row slides along rather than snapping. The content is clipped while the slot
 * is still growing to fit it. With reduced motion the width changes at once.
 */
function FluidWidth({ className, children }: { className?: string; children: ReactNode }) {
  const inner = useRef<HTMLSpanElement>(null);
  // Unset until measured, so the first paint is at the natural width with nothing to animate from.
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setWidth(Math.ceil(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <span
      data-slot="fluid-width"
      style={{ width }}
      className={cn("inline-flex flex-none overflow-x-clip transition-[width] duration-200 ease-out-quint motion-reduce:transition-none", className)}
    >
      <span ref={inner} className="flex w-max flex-none items-center">
        {children}
      </span>
    </span>
  );
}

export { FluidWidth };
