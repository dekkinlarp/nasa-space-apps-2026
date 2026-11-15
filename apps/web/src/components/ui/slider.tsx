import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/lib/utils"

/** A macOS-style slider: a capsule track filled up to a white pill thumb. */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("w-full data-vertical:h-full data-vertical:w-auto", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex min-h-4 w-full touch-none items-center select-none data-disabled:opacity-45 coarse:min-h-5 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-white/25 select-none data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block h-4 w-6 shrink-0 cursor-grab rounded-full bg-white shadow-thumb transition-[scale] duration-150 select-none after:absolute after:-inset-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground active:scale-x-110 active:cursor-grabbing data-disabled:cursor-not-allowed coarse:h-5 coarse:w-7 data-vertical:h-6 data-vertical:w-4"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
