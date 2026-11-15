import type * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@/lib/utils";

/** The small uppercase heading that opens each section of a panel. */
function SectionHeading({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="section-heading" className={cn("caps mt-6 mb-2 flex items-center gap-2 text-muted-foreground [.tab-body>&:first-child]:mt-0", className)} {...props} />;
}

/** Right-aligned extra in a section heading: a count, a note or a control. Reads in sentence case.
 *  Renders a span; pass `render={<label />}` to wrap a checkbox. */
function SectionHeadingAside({ className, render, ...props }: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ className: cn("ml-auto text-xs font-medium tracking-normal normal-case", className) }, props),
    render,
    state: { slot: "section-heading-aside" },
  });
}

export { SectionHeading, SectionHeadingAside };
