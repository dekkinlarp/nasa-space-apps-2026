import type * as React from "react";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** A section that starts folded: a labelled rule with an optional one-line summary on the right. */
function Disclosure({
  title,
  note,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Collapsible>, "title"> & { title: React.ReactNode; note?: React.ReactNode }) {
  return (
    <Collapsible data-slot="disclosure" className={cn("mt-3.5 border-t", className)} {...props}>
      <CollapsibleTrigger className="group/disclosure caps flex w-full cursor-pointer items-center gap-2 pt-2.5 pb-0.5 text-muted-foreground outline-none select-none hover:text-foreground focus-visible:text-foreground data-panel-open:mb-2">
        <ChevronRightIcon className="size-3 transition-transform group-data-panel-open/disclosure:rotate-90" />
        {title}
        {note != null && <span className="ml-auto text-xs font-medium tracking-normal whitespace-nowrap normal-case">{note}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

export { Disclosure };
