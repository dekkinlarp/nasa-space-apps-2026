import type * as React from "react";
import { InfoIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** A small "i" button that opens a note. Use it for explanations a reader may need: unlike a title tooltip it works by touch and keyboard. */
function InfoTip({ label = "More information", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn("inline-grid size-5 flex-none cursor-pointer place-items-center rounded-sm align-middle text-muted-foreground hover:text-foreground coarse:size-8", className)}
          />
        }
      >
        <InfoIcon className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-64 max-w-[calc(100vw-24px)] text-sm leading-snug font-normal tracking-normal whitespace-pre-line wrap-anywhere text-ink-2 normal-case">{children}</PopoverContent>
    </Popover>
  );
}

export { InfoTip };
