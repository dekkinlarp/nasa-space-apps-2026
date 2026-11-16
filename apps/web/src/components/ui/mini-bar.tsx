import { cn } from "@/lib/utils";

/**
 * How much of a budget is left, as a status. The meter and its figure share this scale: the last quarter
 * is a caution, the last tenth (and anything over) is bad.
 */
export const meterLevel = (left: number) => (left <= 0.1 ? "bad" : left <= 0.25 ? "warn" : "ok");
const TEXT = { ok: "", warn: "text-warn", bad: "text-bad" } as const;
const LIT = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" } as const;

/**
 * A segmented meter of what is left, read like a battery: segments light from the left in a sunk track.
 * Every lit segment takes the one colour of the status: plain ink while there is room, orange in the last
 * quarter, red in the last tenth. Nothing is red while the walk is fine.
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
      className={cn("sunk flex h-3.5 gap-[2px] rounded-sm p-[2px] shadow-lip inset-shadow-sunk", className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} className={cn("block h-full min-w-0 flex-1 rounded-[1.5px]", i < lit ? LIT[meterLevel(k)] : "bg-white/10")} />
      ))}
    </span>
  );
}

/**
 * A plain meter of what is left: a full bar in a sunk track that drains toward the left as the budget is
 * spent. It is plain ink, turns orange once it drains to 25% left and red at 10% left (meterLevel's scale).
 */
function PlainMeter({ used, label, className }: { used: number; label?: string; className?: string }) {
  const k = Math.max(0, Math.min(1, 1 - used));
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(k * 100)}
      className={cn("sunk block h-2.5 overflow-hidden rounded-sm shadow-lip inset-shadow-sunk", className)}
    >
      <i className={cn("block h-full transition-[width,background-color] duration-300", LIT[meterLevel(k)])} style={{ width: `${k * 100}%` }} />
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
    <div className={cn("mt-1 grid items-center gap-1.5", value == null ? "grid-cols-[56px_1fr_34px]" : "grid-cols-[56px_1fr_64px]", text && "cursor-help", className)} title={text}>
      <span className="caps font-normal tracking-[0.08em] text-muted-foreground">{label}</span>
      <PlainMeter used={f} label={`${label}: ${Math.round(Math.max(0, left) * 100)}% left`} />
      <span className={cn("text-right font-mono font-medium whitespace-nowrap", TEXT[st])}>{value ?? `${Math.round(Math.max(0, left) * 100)}%`}</span>
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
    <div className={cn("flex items-end gap-3", className)}>
      <span className={cn("text-[56px] leading-[0.8] font-medium tracking-[-0.035em]", TEXT[meterLevel(left)])}>
        {Math.round(left * 100)}
        <span className="ml-0.5 text-2xl font-normal tracking-normal text-muted-foreground">%</span>
      </span>
      <span className="caps grid gap-0.5 font-normal tracking-[0.08em]">
        <span>{tight.name} left</span>
        <span className="text-muted-foreground">Tightest budget</span>
      </span>
    </div>
  );
}

export { MiniBar, PlainMeter, SegMeter, MeterHeadline };
