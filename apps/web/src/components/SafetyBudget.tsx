/** Plan-tab safety budget: stacked time, energy and oxygen bars against the EVA limits, plus the turn-back point. */
import { useState } from "react";
import { ChevronRightIcon, Undo2Icon } from "lucide-react";
import type { RouteResult, WalkParams } from "@marsmap/core";
import { fmtDist, fmtDur, fmtEnergy, fmtO2 } from "../format";
import type { PnrResult } from "../pnr";
import { PNR_METHOD_NOTE } from "../usePnr";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/** Fill for each part of a bar and its legend key: walking, work at stops, suit leakage. */
const PART: Record<string, string> = { walk: "bg-mars", dwell: "bg-poi-science-target", leak: "bg-muted-foreground" };
/** The held-back reserve and anything over the usable budget are hatched. */
const RESERVE = "bg-[repeating-linear-gradient(135deg,var(--ink-4)_0_2px,var(--hull)_2px_6px)]";
const OVER = "bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--bad)_95%,transparent)_0_3px,color-mix(in_srgb,var(--bad)_45%,transparent)_3px_7px)]";
const LEFT = "bg-ok/16 ring-1 ring-ok/55 ring-inset";
const key = "mr-1 inline-block size-[9px] rounded-[2px] align-[-1px]";

/** Durations rounded to the minute (4h 59m 59s reads as 5h 00m, not 4h 59m). */
export const fmtMin = (s: number) => fmtDur(Math.round(s / 60) * 60);

interface Part {
  key: string;
  label: string;
  value: number;
}

interface Budget {
  id: string;
  title: string;
  hint: string;
  parts: Part[];
  limit: number;
  fmt: (v: number) => string;
  limitLabel: string;
  marker?: { at: number; label: string } | null;
}

/**
 * One budget as one row of the grid: its name, the bar, and used / usable. What each colour means is said
 * once, in the legend under the rows; the split between walking and stops is behind the info button.
 */
function BudgetRow({ b, reserveFraction }: { b: Budget; reserveFraction: number }) {
  const { title, parts, limit, fmt } = b;
  const used = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const usable = limit * (1 - reserveFraction);
  const reserve = limit - usable;
  const scale = Math.max(limit, used) || 1;
  const pct = (v: number) => `${(Math.max(0, v) / scale) * 100}%`;
  const over = used > usable;
  const f = usable > 0 ? used / usable : 0;
  const state = over ? "bad" : f > 0.85 ? "warn" : "ok";
  const split = [...parts.filter((p) => p.value > 0).map((p) => `${p.label} ${fmt(p.value)}`), over ? `Over by ${fmt(used - usable)}` : `Left ${fmt(usable - used)}`].join(" · ");
  let x = 0;
  return (
    <>
      <span className="flex items-center gap-0.5 text-sm font-medium whitespace-nowrap">
        {title}
        <InfoTip label={`About ${title}`}>{`${b.hint}\n${b.limitLabel}.\n\n${split}`}</InfoTip>
      </span>
      <div
        className={cn("relative h-3 min-w-0 rounded-sm", state === "bad" ? "bg-well shadow-[inset_0_0_0_1px_var(--seam-2)]" : LEFT)}
        role="img"
        aria-label={`${title}: ${fmt(used)} used of ${fmt(usable)} usable, ${b.limitLabel}. ${split}`}
      >
        <i className={cn("absolute inset-y-0 block rounded-r-sm shadow-[inset_1px_0_0_var(--ink-4)]", RESERVE)} style={{ left: pct(usable), width: pct(reserve) }} />
        {parts.map((p, k) => {
          const el = <i key={p.key} className={cn("absolute inset-y-0 block", PART[p.key], k === 0 && "rounded-l-sm")} style={{ left: pct(x), width: pct(p.value) }} />;
          x += Math.max(0, p.value);
          return el;
        })}
        {over && <i className={cn("absolute inset-y-0 block rounded-r-sm shadow-[0_0_0_1px_var(--bad)]", OVER)} style={{ left: pct(usable), width: pct(used - usable) }} />}
        <i className="absolute -inset-y-[3px] -ml-px block w-0.5 rounded-[1px] bg-foreground opacity-85" style={{ left: pct(usable) }} />
        {used > limit && <i className="absolute -inset-y-[3px] -ml-px block w-0.5 rounded-[1px] bg-bad opacity-85" style={{ left: pct(limit) }} />}
        {b.marker && b.marker.at >= 0 && (
          <span
            className="absolute -top-[7px] -ml-[5px] size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-warn drop-shadow-[0_1px_1px_#000]"
            style={{ left: pct(Math.min(b.marker.at, scale)) }}
            title={b.marker.label}
          />
        )}
      </div>
      <span className="text-right text-sm whitespace-nowrap">
        <b className={cn("font-semibold", state === "bad" && "text-bad", state === "warn" && "text-warn")}>{fmt(used)}</b>
        <span className="text-muted-foreground"> / {fmt(usable)}</span>
      </span>
    </>
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
      // A turn-back time is a warning and gets a box; "you can turn back anywhere" is reassurance and stays a quiet line.
      className={cn("mt-2 text-sm", isPnr && "rounded-md border border-warn/55 bg-warn/7")}
    >
      <CollapsibleTrigger className={cn("group/pnr flex w-full cursor-pointer items-center gap-2 py-1.5 text-left whitespace-nowrap coarse:py-3", isPnr && "px-2.5")}>
        <Undo2Icon className={cn("size-3.5 flex-none", isPnr ? "text-warn" : "text-muted-foreground")} aria-hidden />
        <span className="min-w-0 truncate">
          {isPnr ? (
            <>
              <b className="font-semibold text-warn">Turn back by {fmtMin(pnr.elapsedS)}</b> <span className="text-muted-foreground">({pnr.limitedBy} limit)</span>
            </>
          ) : (
            <span className="text-ink-2">The crew can turn back anywhere</span>
          )}
        </span>
        <ChevronRightIcon className="ml-auto size-3 flex-none text-muted-foreground transition-transform group-data-panel-open/pnr:rotate-90" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn("pb-2 pl-[22px] text-xs leading-[1.4] text-muted-foreground", isPnr && "pr-2.5 pl-8")}>
        {isPnr ? (
          <>
            {pnr.atStop ? `Leave ${stopName} for home by ${fmtMin(pnr.elapsedS)} elapsed: the point of no return falls during the work there.` : `Point of no return ${where}, at ${fmtMin(pnr.elapsedS)} elapsed.`} From there it is about {fmtMin(pnr.returnS)} home ({how}). Later than that, the crew cannot get back inside the usable {pnr.limitedBy === "energy" ? "energy" : "time"}.
          </>
        ) : (
          <>
            The crew can turn for home anywhere on this route. Tightest spot is {where} at {fmtMin(pnr.elapsedS)} elapsed, still {fmtMin(pnr.marginS)} inside the usable time ({how}).
          </>
        )}
        <div className="mt-1 flex items-center gap-0.5">
          How this is estimated <InfoTip label="How the turn-back point is estimated">{tip}</InfoTip>
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
  const [all, setAll] = useState(false);
  const leakKg = (t.totalTimeS / 3600) * (params.o2LeakKgPerH ?? 0);
  // The three limits a walk is checked against, always in the same order.
  const budgets: Budget[] = [
    {
      id: "time",
      title: "EVA time",
      hint: `Total EVA time (walking + work at stops) against the ${fmtMin(params.evaLimitS)} EVA limit. The last ${Math.round(rf * 100)}% (${fmtMin(params.evaLimitS * rf)}) is held back as a safety reserve and is not planned into.`,
      parts: [
        { key: "walk", label: "Walk", value: t.walkTimeS },
        { key: "dwell", label: "Stops", value: dwellT },
      ],
      limit: params.evaLimitS,
      fmt: fmtMin,
      limitLabel: `${fmtMin(params.evaLimitS)} limit`,
      marker: pnr ? { at: pnr.kind === "pnr" ? pnr.elapsedS : -1, label: `Turn back by ${fmtMin(pnr.elapsedS)}` } : null,
    },
    {
      id: "energy",
      title: "Energy",
      hint: `Metabolic energy the crew burns (walking + working at stops), our stand-in for suit cooling and battery. The budget is ${fmtEnergy(params.energyBudgetKJ)} (a suit sized for 352 W average over 8 h); ${Math.round(rf * 100)}% is held in reserve. Suit consumables are not modelled directly.`,
      parts: [
        { key: "walk", label: "Walk", value: walkE },
        { key: "dwell", label: "Stops", value: dwellE },
      ],
      limit: params.energyBudgetKJ,
      fmt: fmtEnergy,
      limitLabel: `${fmtEnergy(params.energyBudgetKJ)} budget, reserve ${fmtEnergy(params.energyBudgetKJ * rf)}`,
    },
    ...(o2On
      ? [
          {
            id: "oxygen",
            title: "Oxygen",
            hint: `Oxygen breathed (in proportion to the energy burned) plus suit leakage, against ${fmtO2(params.o2BudgetKg ?? 0)} carried. The tank size and leak rate are placeholder assumptions; change the tank under Walk settings.`,
            parts: [
              { key: "walk", label: "Walk", value: walkE * k },
              { key: "dwell", label: "Stops", value: dwellE * k },
              { key: "leak", label: "Leak", value: leakKg },
            ],
            limit: params.o2BudgetKg ?? 0,
            fmt: fmtO2,
            limitLabel: `${fmtO2(params.o2BudgetKg ?? 0)} carried, reserve ${fmtO2((params.o2BudgetKg ?? 0) * rf)}`,
          },
        ]
      : []),
  ];
  const anyOver = budgets.some((b) => b.parts.reduce((a, p) => a + Math.max(0, p.value), 0) > b.limit * (1 - rf));
  return (
    <div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2.5 pt-2">
        {budgets.map((b) => (
          <BudgetRow key={b.id} b={b} reserveFraction={rf} />
        ))}
      </div>
      {/* One legend for all the bars. */}
      <div className="mt-2 flex flex-wrap gap-x-[9px] gap-y-[3px] text-xs text-muted-foreground *:whitespace-nowrap">
        <span>
          <i className={cn(key, PART.walk)} />
          Walk
        </span>
        <span>
          <i className={cn(key, PART.dwell)} />
          Stops
        </span>
        {o2On && leakKg > 0 && (
          <span>
            <i className={cn(key, PART.leak)} />
            Leak
          </span>
        )}
        <span>
          <i className={cn(key, LEFT)} />
          Left
        </span>
        <span>
          <i className={cn(key, RESERVE)} />
          Reserve
        </span>
        {anyOver && (
          <span>
            <i className={cn(key, OVER)} />
            Over
          </span>
        )}
        <Button variant="link" size="inline" className="ml-auto text-xs coarse:py-2" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Hide climb and dose" : "Climb and dose"}
        </Button>
      </div>
      {all && (
        <div className="mt-1.5 flex gap-4 text-xs text-muted-foreground">
          <span>
            Climb{" "}
            <b className="font-semibold text-foreground">
              ↑{Math.round(t.ascentM)} ↓{Math.round(t.descentM)} m
            </b>
          </span>
          <span>
            Radiation dose <b className="font-semibold text-foreground">{t.radiationMSv.toFixed(3)} mSv</b>
          </span>
        </div>
      )}
      {pnr && <PnrNote pnr={pnr} names={names} />}
    </div>
  );
}
