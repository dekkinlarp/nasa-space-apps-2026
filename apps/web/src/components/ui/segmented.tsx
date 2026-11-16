import type * as React from "react";
import { SlidingThumb } from "@/components/ui/sliding-thumb";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** A segmented control: a few peer options, exactly one picked. The thumb marks the one in effect and slides to a new pick.
 *  A sunk 6px track with 3px of padding and a raised 4px thumb. The picked option is written in the signal colour. */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  itemClassName,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; disabled?: boolean }[];
  className?: string;
  itemClassName?: string;
  "aria-label"?: string;
}) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      // Single choice: pressing the picked option again keeps it, rather than leaving none.
      onValueChange={(v: string[]) => v[0] != null && onValueChange(v[0] as T)}
      spacing={0.5}
      className={cn("sunk relative rounded-lg p-[3px] shadow-lip inset-shadow-sunk", className)}
    >
      <SlidingThumb />
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(
            // The fill behind the picked option is the sliding thumb, so the option itself stays clear.
            "relative h-[26px] min-w-0 rounded-md px-3 font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase transition-colors coarse:h-9 hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent aria-pressed:text-signal aria-pressed:hover:text-signal",
            itemClassName,
          )}
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export { Segmented };
