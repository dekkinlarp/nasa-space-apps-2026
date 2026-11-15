import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

/**
 * A capsule switch in the macOS style: a white pill thumb on a track that is grey when off and green
 * when on. The thumb is white in both states, so the state reads from its position as well as the colour.
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
        "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 inset-ring inset-ring-white/25 transition-colors duration-200 after:absolute after:-inset-x-2 after:-inset-y-2.5 data-[size=default]:h-[22px] data-[size=default]:w-[38px] data-[size=sm]:h-[18px] data-[size=sm]:w-[30px] data-unchecked:bg-white/30 data-unchecked:hover:bg-white/38 data-checked:bg-ok data-checked:inset-ring-transparent data-disabled:cursor-not-allowed data-disabled:opacity-45",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-white shadow-thumb transition-[translate,width] duration-200 ease-spring group-data-[size=default]/switch:h-[18px] group-data-[size=default]/switch:w-[22px] group-data-[size=sm]/switch:h-[14px] group-data-[size=sm]/switch:w-[17px] group-data-[size=default]/switch:data-checked:translate-x-3 group-data-[size=sm]/switch:data-checked:translate-x-[9px] group-not-data-disabled/switch:group-active/switch:group-data-[size=default]/switch:w-[25px] group-not-data-disabled/switch:group-active/switch:group-data-[size=default]/switch:data-checked:translate-x-[9px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
