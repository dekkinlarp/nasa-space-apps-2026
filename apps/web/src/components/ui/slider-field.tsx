import { useId } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/** A labelled slider with its current value on the right. */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onValueChange,
  hint,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onValueChange: (v: number) => void;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div data-slot="slider-field" className={cn("grid gap-1.5", className)} title={hint}>
      <div className="flex justify-between text-sm text-ink-2">
        <span id={id}>{label}</span>
        <b className="font-normal text-foreground">{format(value)}</b>
      </div>
      <Slider aria-labelledby={id} value={[value]} min={min} max={max} step={step} onValueChange={(v) => onValueChange(Array.isArray(v) ? v[0]! : v)} />
    </div>
  );
}

export { SliderField };
