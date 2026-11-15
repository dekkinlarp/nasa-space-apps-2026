import type * as React from "react";
import { cn } from "@/lib/utils";

/** A small colour key: a surface class, a mineral ramp, a route. */
function Swatch({ color, className, style, ...props }: React.ComponentProps<"i"> & { color: string }) {
  return (
    <i
      data-slot="swatch"
      aria-hidden
      className={cn("mr-1.5 inline-block size-2 shrink-0 rounded-[1px] ring-1 ring-white/18", className)}
      style={{ background: color, ...style }}
      {...props}
    />
  );
}

export { Swatch };
