/** Plan-tab safety budget: stacked time, energy and oxygen bars against the EVA limits, plus the turn-back point. */
import type { RouteResult, WalkParams } from "@marsmap/core";
import { fmtDist, fmtDur, fmtEnergy, fmtO2 } from "../format";
import type { PnrResult } from "../pnr";
import { PNR_METHOD_NOTE } from "../usePnr";
import "./safety.css";

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
    <div className={`budget is-${state}`} title={`${hint}\n${limitLabel}.`}>
      <div className="budget-head">
        <span className="budget-title">{title}</span>
        <span className="budget-sum">
          <b className={state === "bad" ? "bad" : state === "warn" ? "warnc" : ""}>{fmt(used)}</b>
          <span className="dim"> / {fmt(usable)}</span>
        </span>
      </div>
      <div className="budget-track" role="img" aria-label={`${title}: ${fmt(used)} used of ${fmt(usable)} usable, ${limitLabel}`}>
        <i className="bz reserve" style={{ left: pct(usable), width: pct(reserve) }} />
        {parts.map((p) => {
          const el = <i key={p.key} className={`bz p-${p.key}`} style={{ left: pct(x), width: pct(p.value) }} />;
          x += Math.max(0, p.value);
          return el;
        })}
        {over && <i className="bz over" style={{ left: pct(usable), width: pct(used - usable) }} />}
        <i className="btick usable" style={{ left: pct(usable) }} />
        {used > limit && <i className="btick limit" style={{ left: pct(limit) }} />}
        {marker && marker.at >= 0 && (
          <span className={`bpnr ${marker.kind}`} style={{ left: pct(Math.min(marker.at, scale)) }} title={marker.label} />
        )}
      </div>
      <div className="budget-legend">
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.key}>
            <i className={`sw p-${p.key}`} />
            {p.label} <b>{fmt(p.value)}</b>
          </span>
        ))}
        {over ? (
          <span className="is-over">
            <i className="sw over" />
            Over by <b>{fmt(used - usable)}</b>
          </span>
        ) : (
          <span>
            <i className="sw left" />
            Left <b>{fmt(left)}</b>
          </span>
        )}
        {reserveKey && !over && (
          <span className="budget-reserve" title={`Safety reserve ${fmt(reserve)} (not planned into)`}>
            <i className="sw reserve" />
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
    <details className={`pnr-note ${isPnr ? "is-bad" : "is-ok"}`}>
      <summary>
        <span className="pnr-ico">⟲</span>
        {isPnr ? (
          <span className="pnr-line">
            <b>Turn back by {fmtMin(pnr.elapsedS)}</b> <span className="dim">· {pnr.limitedBy} limit</span>
          </span>
        ) : (
          <span className="pnr-line">
            <b>No point of no return</b> <span className="dim">· {fmtMin(pnr.marginS)} margin</span>
          </span>
        )}
        <span className="pnr-more">details</span>
      </summary>
      <div className="pnr-body">
        {isPnr ? (
          <>
            {pnr.atStop ? `Leave ${stopName} for home by ${fmtMin(pnr.elapsedS)} elapsed: the point of no return falls during the work there.` : `Point of no return ${where}, at ${fmtMin(pnr.elapsedS)} elapsed.`} From there it is about {fmtMin(pnr.returnS)} home ({how}). Later than that, the crew cannot get back inside the usable {pnr.limitedBy === "energy" ? "energy" : "time"}.
          </>
        ) : (
          <>
            The crew can turn for home anywhere on this route. Tightest spot is {where} at {fmtMin(pnr.elapsedS)} elapsed, still {fmtMin(pnr.marginS)} inside the usable time ({how}).
          </>
        )}
        <div className="pnr-method" title={tip}>
          How this is estimated <span className="info">ⓘ</span>
        </div>
      </div>
    </details>
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
    <div className="safety">
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
