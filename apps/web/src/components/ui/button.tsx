import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Raised buttons drop the 1px border: their keyline and inner edge are in the shadow, flush with the fill.
        /** The one main action of a group: a filled, domed button. */
        default: "border-0 bg-primary text-primary-foreground shadow-raised-strong hover:bg-white active:shadow-pressed",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        /** The everyday button: a faint fill, raised off the panel. */
        secondary:
          "border-0 bg-secondary text-secondary-foreground shadow-raised hover:bg-white/13 active:bg-white/5 active:shadow-pressed aria-expanded:bg-secondary aria-expanded:text-secondary-foreground aria-pressed:bg-white/5 aria-pressed:shadow-pressed",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "h-auto px-0 font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground",
        /** Floats over the map on the glass material. */
        // bg-clip-border: buttons clip their fill to the padding box, which left the 1px edge showing the raw,
        // saturated backdrop blur (an orange ring over Mars) instead of the dark glass the panels have under theirs.
        // border-glass-edge is stated here because the base class's border-transparent otherwise wins over `glass`.
        // No border change on hover, press or toggle: over the map a brighter edge picks up the ground's colour and
        // reads as an orange outline. State shows in the icon's brightness; keyboard focus is a plain light outline.
        glass:
          "glass border-glass-edge bg-clip-border text-ink-2 shadow-float-sm inset-shadow-[0_1px_0_rgba(255,255,255,0.1)] hover:text-foreground active:inset-shadow-sunk aria-expanded:text-foreground focus-visible:border-glass-edge focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 coarse:h-10 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 coarse:size-10 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
        "icon-xl": "size-11 rounded-xl",
        /** No box: for link buttons that sit in running text. */
        inline: "h-auto gap-1 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
