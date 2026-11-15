/** Plan-tab safety budget: stacked time, energy and oxygen bars against the EVA limits, plus the turn-back point. */
import type { RouteResult, WalkParams } from "@marsmap/core";
import { fmtDist, fmtDur, fmtEnergy, fmtO2 } from "../format";
import type { PnrResult } from "../pnr";
import { PNR_METHOD_NOTE } from "../usePnr";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** Fill for each part of a bar and its legend key: walking, work at stops, suit leakage. */
const PART: Record<string, string> = { walk: "bg-mars", dwell: "bg-poi-science-target", leak: "bg-muted-foreground" };
/** The held-back reserve and anything over the usable budget are hatched. */
const RESERVE = "bg-[repeating-linear-gradient(135deg,#3d302a_0_3px,#241c18_3px_7px)]";
const OVER = "bg-[repeating-linear-gradient(135deg,rgba(255,90,79,0.95)_0_3px,rgba(255,90,79,0.45)_3px_7px)]";
const LEFT = "bg-[rgba(111,212,138,0.16)] shadow-[inset_0_0_0_1px_rgba(111,212,138,0.55)]";
const key = "mr-1 inline-block size-[9px] rounded-[2px] align-[-1px]";

/** Durations rounded to the minute (4h 59m 59s reads as 5h 00m, not 4h 59m). */
export const fmtMin = (s: number) => fmtDur(Math.round(s / 60) * 60);

interface Part {
  key: string;
  label: string;
  value: number;
}

function BudgetBar({
  title,
  hint,
  parts,
  limit,
  reserveFraction,
  fmt,
  limitLabel,
  marker,
  reserveKey = true,
}: {
  title: string;
  hint: string;
  parts: Part[];
  limit: number;
  reserveFraction: number;
  fmt: (v: number) => string;
  limitLabel: string;
  marker?: { at: number; label: string; kind: "pnr" | "clear" } | null;
  /** Show the "Reserve" swatch in the legend (one bar is enough; the value is in the tooltip). */
  reserveKey?: boolean;
}) {
  const used = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const usable = limit * (1 - reserveFraction);
  const reserve = limit - usable;
  const scale = Math.max(limit, used) || 1;
  const pct = (v: number) => `${(Math.max(0, v) / scale) * 100}%`;
  const left = usable - used;
  const over = used > usable;
  const f = usable > 0 ? used / usable : 0;
  const state = over ? "bad" : f > 0.85 ? "warn" : "ok";
  let x = 0;
  return (
    <div className="mb-3" title={`${hint}\n${limitLabel}.`}>
      <div className="mb-[7px] flex items-baseline justify-between text-[12px]">
        <span className="font-semibold">{title}</span>
        <span>
          <b className={cn("font-bold", state === "bad" && "text-bad", state === "warn" && "text-warn")}>{fmt(used)}</b>
          <span className="text-muted-foreground"> / {fmt(usable)}</span>
        </span>
      </div>
      <div
        className={cn("relative h-3.5 rounded-sm", state === "bad" ? "bg-well shadow-[inset_0_0_0_1px_var(--seam-2)]" : LEFT)}
        role="img"
        aria-label={`${title}: ${fmt(used)} used of ${fmt(usable)} usable, ${limitLabel}`}
      >
        <i className={cn("absolute inset-y-0 block rounded-r-sm shadow-[inset_1px_0_0_#6b5a50]", RESERVE)} style={{ left: pct(usable), width: pct(reserve) }} />
        {parts.map((p, k) => {
          const el = <i key={p.key} className={cn("absolute inset-y-0 block", PART[p.key], k === 0 && "rounded-l-sm")} style={{ left: pct(x), width: pct(p.value) }} />;
          x += Math.max(0, p.value);
          return el;
        })}
        {over && <i className={cn("absolute inset-y-0 block rounded-r-sm shadow-[0_0_0_1px_var(--bad)]", OVER)} style={{ left: pct(usable), width: pct(used - usable) }} />}
        <i className="absolute -inset-y-[3px] -ml-px block w-0.5 rounded-[1px] bg-foreground opacity-85" style={{ left: pct(usable) }} />
        {used > limit && <i className="absolute -inset-y-[3px] -ml-px block w-0.5 rounded-[1px] bg-bad opacity-85" style={{ left: pct(limit) }} />}
        {marker && marker.at >= 0 && (
          <span
            className="absolute -top-[7px] -ml-[5px] size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-warn drop-shadow-[0_1px_1px_#000]"
            style={{ left: pct(Math.min(marker.at, scale)) }}
            title={marker.label}
          />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-[9px] gap-y-[3px] text-xs text-muted-foreground *:whitespace-nowrap">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key}>
              <i className={cn(key, PART[p.key])} />
              {p.label} <b className="font-semibold text-foreground">{fmt(p.value)}</b>
            </span>
          ))}
        {over ? (
          <span>
            <i className={cn(key, OVER)} />
            Over by <b className="font-semibold text-bad">{fmt(used - usable)}</b>
          </span>
        ) : (
          <span>
            <i className={cn(key, LEFT)} />
            Left <b className="font-semibold text-foreground">{fmt(left)}</b>
          </span>
        )}
        {reserveKey && !over && (
          <span className="ml-auto cursor-help" title={`Safety reserve ${fmt(reserve)} (not planned into)`}>
            <i className={cn(key, RESERVE)} />
            Reserve
          </span>
        )}
      </div>
    </div>
  );
}

export function PnrNote({ pnr, names }: { pnr: PnrResult; names: string[] }) {
  const stopName = names[pnr.segment + 1] ?? "a stop";
  const where = pnr.atStop ? `at ${stopName}` : `${fmtDist(pnr.alongM)} along the route, on the way to ${names[pnr.segment + 1] ?? "the next stop"}`;
  const how = pnr.returnMethod === "path home" ? "cheapest path home" : pnr.returnMethod === "retrace" ? "retracing the route" : "finishing the loop";
  const tip = `${PNR_METHOD_NOTE}${pnr.usedReach ? "" : " (Walk-limit flood not ready yet: using retrace / finish-the-loop only.)"}`;
  const isPnr = pnr.kind === "pnr";
  return (
    <Collapsible
      className={cn("mt-0.5 mb-2.5 rounded-md border text-sm", isPnr ? "border-warn/55 bg-warn/7" : "border-ok/35 bg-well")}
    >
      <CollapsibleTrigger className="group/pnr flex w-full cursor-pointer items-center gap-2 px-2.5 py-[7px] text-left whitespace-nowrap outline-none">
        <span className={cn("text-[15px] leading-none font-bold", isPnr ? "text-warn" : "text-ok")}>⟲</span>
        <span className="min-w-0 truncate">
          <b className={isPnr ? "text-warn" : "text-ok"}>{isPnr ? `Turn back by ${fmtMin(pnr.elapsedS)}` : "No point of no return"}</b>{" "}
          <span className="text-muted-foreground">· {isPnr ? `${pnr.limitedBy} limit` : `${fmtMin(pnr.marginS)} margin`}</span>
        </span>
        <span className="caps ml-auto text-2xs tracking-[0.1em] text-muted-foreground group-hover/pnr:text-foreground group-data-panel-open/pnr:text-mars">details</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pr-2.5 pb-[9px] pl-[34px] text-[11.5px] leading-[1.4] text-muted-foreground">
        {isPnr ? (
          <>
            {pnr.atStop ? `Leave ${stopName} for home by ${fmtMin(pnr.elapsedS)} elapsed: the point of no return falls during the work there.` : `Point of no return ${where}, at ${fmtMin(pnr.elapsedS)} elapsed.`} From there it is about {fmtMin(pnr.returnS)} home ({how}). Later than that, the crew cannot get back inside the usable {pnr.limitedBy === "energy" ? "energy" : "time"}.
          </>
        ) : (
          <>
            The crew can turn for home anywhere on this route. Tightest spot is {where} at {fmtMin(pnr.elapsedS)} elapsed, still {fmtMin(pnr.marginS)} inside the usable time ({how}).
          </>
        )}
        <div className="mt-1.5 cursor-help text-2xs underline decoration-dotted underline-offset-2 opacity-85" title={tip}>
          How this is estimated <span className="opacity-70">ⓘ</span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SafetyBudget({ r, params, pnr, names }: { r: RouteResult; params: WalkParams; pnr: PnrResult | null; names: string[] }) {
  const t = r.totals;
  const dwellT = Math.max(0, t.totalTimeS - t.walkTimeS);
  const dwellE = t.dwellEnergyKJ ?? 0;
  const walkE = Math.max(0, t.energyKJ - dwellE);
  const rf = params.reserveFraction;
  // Oxygen model from the routing core: breathing follows metabolic energy, leakage follows time.
  const k = params.o2KgPerKJ ?? 0;
  const o2On = (params.o2BudgetKg ?? 0) > 0 && k > 0;
  return (
    <div>
      <BudgetBar
        title="EVA time"
        hint={`Total EVA time (walking + work at stops) against the ${fmtMin(params.evaLimitS)} EVA limit. The last ${Math.round(rf * 100)}% (${fmtMin(params.evaLimitS * rf)}) is held back as a safety reserve and is not planned into.`}
        parts={[
          { key: "walk", label: "Walk", value: t.walkTimeS },
          { key: "dwell", label: "Stops", value: dwellT },
        ]}
        limit={params.evaLimitS}
        reserveFraction={rf}
        fmt={fmtMin}
        limitLabel={`${fmtMin(params.evaLimitS)} limit`}
        marker={pnr ? { at: pnr.kind === "pnr" ? pnr.elapsedS : -1, label: `Turn back by ${fmtMin(pnr.elapsedS)}`, kind: pnr.kind } : null}
      />
      <BudgetBar
        title="Energy"
        hint={`Metabolic energy the crew burns (walking + working at stops), our stand-in for suit cooling and battery. The budget is ${fmtEnergy(params.energyBudgetKJ)} (a suit sized for 352 W average over 8 h); ${Math.round(rf * 100)}% is held in reserve. Suit consumables are not modelled directly.`}
        parts={[
          { key: "walk", label: "Walk", value: walkE },
          { key: "dwell", label: "Stops", value: dwellE },
        ]}
        limit={params.energyBudgetKJ}
        reserveFraction={rf}
        fmt={fmtEnergy}
        limitLabel={`${fmtEnergy(params.energyBudgetKJ)} budget, reserve ${fmtEnergy(params.energyBudgetKJ * rf)}`}
        reserveKey={false}
      />
      {o2On && (
        <BudgetBar
          title="Oxygen"
          hint={`Oxygen breathed (in proportion to the energy burned) plus suit leakage, against ${fmtO2(params.o2BudgetKg ?? 0)} carried. The tank size and leak rate are placeholder assumptions; change the tank under Walk settings.`}
          parts={[
            { key: "walk", label: "Walk", value: walkE * k },
            { key: "dwell", label: "Stops", value: dwellE * k },
            { key: "leak", label: "Leak", value: (t.totalTimeS / 3600) * (params.o2LeakKgPerH ?? 0) },
          ]}
          limit={params.o2BudgetKg ?? 0}
          reserveFraction={rf}
          fmt={fmtO2}
          limitLabel={`${fmtO2(params.o2BudgetKg ?? 0)} carried, reserve ${fmtO2((params.o2BudgetKg ?? 0) * rf)}`}
          reserveKey={false}
        />
      )}
      {pnr && <PnrNote pnr={pnr} names={names} />}
    </div>
  );
}
