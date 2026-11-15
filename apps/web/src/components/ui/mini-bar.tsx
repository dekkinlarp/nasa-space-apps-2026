import { cn } from "@/lib/utils";

/**
 * How much of a budget is left, as a status. The meter and its figure share this scale: the last quarter
 * is a caution, the last tenth (and anything over) is bad.
 */
export const meterLevel = (left: number) => (left <= 0.1 ? "bad" : left <= 0.25 ? "warn" : "ok");
const TEXT = { ok: "", warn: "text-warn", bad: "text-bad" } as const;
const LIT = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" } as const;

/**
 * A segmented meter of what is left, read like a battery: segments light from the left, and each one is
 * coloured for what being down to it means (red, then amber, then green). So the colour of the last lit
 * segment is the status. The track is sunk; lit segments have a lit top edge.
 */
function SegMeter({ left, segments = 14, label, className }: { left: number; segments?: number; label?: string; className?: string }) {
  const k = Math.max(0, Math.min(1, left));
  // A sliver left still lights one segment; only nothing left lights none.
  const lit = k > 0 ? Math.max(1, Math.round(k * segments)) : 0;
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(k * 100)}
      className={cn("flex h-3 gap-[2px] rounded-[4px] bg-black/35 p-[2px] inset-shadow-sunk", className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} className={cn("block h-full min-w-0 flex-1 rounded-[1.5px]", i < lit ? cn(LIT[meterLevel((i + 1) / segments)], "inset-shadow-[0_1px_0_rgba(255,255,255,0.35)]") : "bg-white/10")} />
      ))}
    </span>
  );
}

/**
 * One budget as a line: label, the meter of what is left, and a figure. `f` is the fraction used. The
 * figure is the percentage left unless `value` gives something else (the amount left, during a walk).
 */
function MiniBar({ label, f, text, value, className }: { label: string; f: number; text?: string; value?: string; className?: string }) {
  const left = 1 - f;
  const st = meterLevel(left);
  return (
    <div className={cn("mt-1 grid items-center gap-1.5", value == null ? "grid-cols-[42px_1fr_30px]" : "grid-cols-[62px_1fr_62px]", text && "cursor-help", className)} title={text}>
      <span className="text-muted-foreground">{label}</span>
      <SegMeter left={left} segments={value == null ? 14 : 20} label={`${label}: ${Math.round(Math.max(0, left) * 100)}% left`} />
      <span className={cn("text-right font-semibold whitespace-nowrap", TEXT[st])}>{value ?? `${Math.round(Math.max(0, left) * 100)}%`}</span>
    </div>
  );
}

/**
 * The one number to glance at: what is left of whichever budget is tightest, large, with its name under it.
 * `budgets` are fractions used.
 */
function MeterHeadline({ budgets, className }: { budgets: { name: string; f: number }[]; className?: string }) {
  const tight = budgets.reduce((a, b) => (b.f > a.f ? b : a));
  const left = Math.max(0, 1 - tight.f);
  return (
    <div className={cn("flex items-baseline gap-1.5", className)}>
      <span className={cn("text-2xl leading-none font-medium tracking-[-0.02em]", TEXT[meterLevel(left)])}>{Math.round(left * 100)}%</span>
      <span className="text-xs text-muted-foreground">{tight.name} left</span>
    </div>
  );
}

export { MiniBar, SegMeter, MeterHeadline };
