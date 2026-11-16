import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

/**
 * A capsule switch: a knob in a sunk track. Off, the track is black and the knob light; on, the track is
 * the signal colour and the knob dark. The state reads from the knob's position as well as the colour.
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 inset-ring inset-ring-white/16 inset-shadow-[0_2px_3px_rgba(0,0,0,0.5)] transition-colors duration-200 after:absolute after:-inset-x-2 after:-inset-y-2.5 data-[size=default]:h-[22px] data-[size=default]:w-[38px] data-[size=sm]:h-[18px] data-[size=sm]:w-[30px] data-unchecked:bg-well data-unchecked:hover:bg-hull-2 data-checked:bg-signal data-checked:inset-ring-transparent data-disabled:cursor-not-allowed data-disabled:opacity-45",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-ink-2 shadow-thumb data-checked:bg-hull-3 transition-[translate,width] duration-200 ease-spring group-data-[size=default]/switch:h-[18px] group-data-[size=default]/switch:w-[22px] group-data-[size=sm]/switch:h-[14px] group-data-[size=sm]/switch:w-[17px] group-data-[size=default]/switch:data-checked:translate-x-3 group-data-[size=sm]/switch:data-checked:translate-x-[9px] group-not-data-disabled/switch:group-active/switch:group-data-[size=default]/switch:w-[25px] group-not-data-disabled/switch:group-active/switch:group-data-[size=default]/switch:data-checked:translate-x-[9px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
