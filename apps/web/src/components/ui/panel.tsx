import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** A surface that floats over the map, on the shared glass material. */
const panelVariants = cva("text-foreground", {
  variants: {
    size: {
      /** Small chrome: bars, readouts, the map key. */
      default: "glass rounded-xl shadow-float-sm",
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
