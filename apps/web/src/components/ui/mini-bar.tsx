import { cn } from "@/lib/utils";

/** Status for a used fraction of a budget: caution from 85 %, over at 100 %. */
export const budgetLevel = (f: number) => (f > 1 ? "bad" : f > 0.85 ? "warn" : "ok");
const TEXT = { ok: "", warn: "text-warn", bad: "text-bad" } as const;
const FILL = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" } as const;

/**
 * One budget as a line: label, a thin bar of the fraction used, and a figure. The figure is the
 * percentage used unless `value` gives something else (what is left, during a walk).
 */
function MiniBar({ label, f, text, value, className }: { label: string; f: number; text?: string; value?: string; className?: string }) {
  const st = budgetLevel(f);
  return (
    <div className={cn("mt-[3px] grid items-center gap-1.5", value == null ? "grid-cols-[62px_1fr_34px]" : "grid-cols-[62px_1fr_62px]", text && "cursor-help", className)} title={text}>
      <span className="text-muted-foreground">{label}</span>
      <span className="h-[5px] overflow-hidden rounded-sm bg-well shadow-[inset_0_0_0_1px_var(--seam)]">
        <i className={cn("block h-full rounded-sm", FILL[st])} style={{ width: `${Math.max(0, Math.min(100, f * 100))}%` }} />
      </span>
      <span className={cn("text-right font-semibold whitespace-nowrap", TEXT[st])}>{value ?? `${Math.round(f * 100)}%`}</span>
    </div>
  );
}

export { MiniBar };
