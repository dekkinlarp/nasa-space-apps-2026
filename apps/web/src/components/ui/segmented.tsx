import type * as React from "react";
import { SlidingThumb } from "@/components/ui/sliding-thumb";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** A segmented control: a few peer options, exactly one picked. The thumb marks the one in effect and slides to a new pick.
 *  An 8px control with 2px of padding, so the thumb is 6px and the corners stay concentric. */
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
      className={cn("relative rounded-lg border border-input bg-black/25 p-0.5 inset-shadow-sunk", className)}
    >
      <SlidingThumb />
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(
            // The fill behind the picked option is the sliding thumb, so the option itself stays clear.
            "relative h-[26px] min-w-0 rounded-md px-3 text-sm text-muted-foreground transition-colors coarse:h-9 hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent aria-pressed:text-foreground",
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
