import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** A surface that floats over the map, on the shared glass material. */
/** The stage that lays panels out ignores the pointer so the map stays draggable; each panel takes it back. */
const panelVariants = cva("pointer-events-auto text-foreground", {
  variants: {
    size: {
      /** Small chrome: bars, readouts, the map key. A key that floats on the map. */
      default: "glass key rounded-md shadow-key",
      /** Cards and panels: bigger corner, deeper shadow. */
      lg: "glass rounded-2xl shadow-float",
      /** The side panel: thicker glass so text stays readable over bright ground. */
      thick: "glass-thick rounded-2xl shadow-float",
    },
  },
  defaultVariants: { size: "default" },
});

/** Renders a div; pass an element as `render` (e.g. `render={<dl />}`) to change the tag. */
function Panel({ className, size, render, ...props }: useRender.ComponentProps<"div"> & VariantProps<typeof panelVariants>) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ className: cn(panelVariants({ size }), className) }, props),
    render,
    state: { slot: "panel", size },
  });
}

export { Panel, panelVariants };
