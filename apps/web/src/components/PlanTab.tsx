import { Fragment, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { RouteResult, RouteSegment, SurfaceClass } from "@marsmap/core";
import { selectedResult, usableTimeS, useStore } from "../store";
import { fmtDist, fmtDur, fmtEnergy, fmtLonLat, fmtO2 } from "../format";
import { limitMessage, pointNames } from "../lib";
import { profileColor } from "../map/MapView";
import { flyTo } from "./ExploreTab";
import { deltaParts, hazardChip, hazardHighlight, nearlyIdentical, routeDelta } from "./routeCompare";
import type { Poi, Stop } from "../types";
import { fmtMin, SafetyBudget } from "./SafetyBudget";
import { usePnr } from "../usePnr";

function Slider({ label, value, min, max, step, fmt, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="param" title={hint}>
      <div className="param-head">
        <span>{label}</span>
        <b>{fmt(value)}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function SurfaceMixBar({ mix, classes }: { mix: Record<number, number>; classes: SurfaceClass[] }) {
  const entries = Object.entries(mix)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([, v]) => v > 0.001)
    .sort((a, b) => a[0] - b[0]);
  return (
    <div className="mixbar" title={entries.map(([k, v]) => `${classes.find((c) => c.id === k)?.name ?? k}: ${Math.round(v * 100)}%`).join("\n")}>
      {entries.map(([k, v]) => (
        <i key={k} style={{ width: `${v * 100}%`, background: classes.find((c) => c.id === k)?.color ?? "#888" }} />
      ))}
    </div>
  );
}

function Segment({ s, i, names, over, classes }: { s: RouteSegment; i: number; names: string[]; over: boolean; classes: SurfaceClass[] }) {
  return (
    <li className={`seg ${over ? "over" : ""}`} onClick={() => flyTo(s.to[0], s.to[1], 16)}>
      <div className="seg-head">
        <span className="seg-name">
          {names[i] ?? "?"} → {names[i + 1] ?? "?"}
        </span>
        <span className="seg-time">{fmtDur(s.timeS)}</span>
      </div>
      <div className="seg-stats" title={`Slope ${s.avgSlopeDeg.toFixed(1)}° avg, ${s.maxSlopeDeg.toFixed(1)}° max · energy ${fmtEnergy(s.energyKJ)}`}>
        <span>{fmtDist(s.distanceM)}</span>
        <span>
          ↑{Math.round(s.ascentM)} ↓{Math.round(s.descentM)} m
        </span>
        <span>≤{Math.round(s.maxSlopeDeg)}°</span>
        <span className={s.hazardM > 0 ? "warnc" : "dim"}>{Math.round(s.hazardM)} m hazard</span>
        <span className="dim">{fmtEnergy(s.energyKJ)}</span>
      </div>
      <SurfaceMixBar mix={s.surfaceMix} classes={classes} />
    </li>
  );
}

function AltCard({ r, i, selected, onPick, ref0, highlight, chip }: { r: RouteResult; i: number; selected: boolean; onPick: () => void; ref0: RouteResult | null; highlight?: string | null; chip?: string | null }) {
  const t = r.totals;
  const isRef = !ref0 || ref0.profile.id === r.profile.id;
  const all = !isRef && ref0 ? deltaParts(routeDelta(r, ref0)) : [];
  // One line: time delta + either the hazard chip or the next most important difference. The rest is in the tooltip.
  const parts = chip ? all.slice(0, 1) : all.slice(0, 2);
  const status = !r.reachable ? "Unreachable" : t.withinLimits ? "Within limits" : `Over ${t.limitingFactor ?? "limit"}`;
  const ok = r.reachable && t.withinLimits;
  const tip = [
    `${r.profile.name}: ${fmtDur(t.totalTimeS)} total (walk + stops)`,
    `${fmtDist(t.distanceM)} · ${fmtEnergy(t.energyKJ)} · ${Math.round(t.hazardM)} m on hazard ground`,
    isRef ? "Reference route for the comparison" : `vs Fastest: ${all.map((p) => p.text).join(" · ")}`,
    highlight ?? "",
    status,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <button className={`alt ${selected ? "active" : ""}`} onClick={onPick} style={{ ["--c" as string]: profileColor(r.profile.id, i) }} title={tip}>
      <div className="alt-top">
        <span className="alt-name">{r.profile.name}</span>
        {ok && <span className="alt-dot ok" aria-label={status} />}
      </div>
      <div className="alt-big">{fmtDur(t.totalTimeS)}</div>
      <div className="alt-sub">
        {fmtDist(t.distanceM)} · {fmtEnergy(t.energyKJ)}
      </div>
      <div className="alt-sub">{Math.round(t.hazardM)} m hazard</div>
      <div className="alt-delta">
        {isRef ? (
          <span className="neutral">Reference</span>
        ) : (
          parts.map((p, k) => (
            <Fragment key={k}>
              {k > 0 && <span className="sep"> · </span>}
              <span className={p.tone}>{p.text}</span>
            </Fragment>
          ))
        )}
        {chip && <span className="alt-chip">{chip}</span>}
      </div>
      {!ok && <div className="alt-status bad">{status}</div>}
    </button>
  );
}

function RouteAlternatives({ results, selectedId, onPick }: { results: RouteResult[]; selectedId: string | undefined; onPick: (id: string) => void }) {
  const [showSimilar, setShowSimilar] = useState(false);
  const ref0 = results.find((r) => r.profile.id === "fastest" && r.reachable) ?? null;
  const similar = new Set<string>();
  if (ref0) {
    for (const r of results) {
      if (r.profile.id === "least-effort" && r.reachable && nearlyIdentical(routeDelta(r, ref0), ref0)) similar.add(r.profile.id);
    }
  }
  const visible = results.filter((r) => !similar.has(r.profile.id) || showSimilar || r.profile.id === selectedId);
  const hidden = results.filter((r) => !visible.includes(r));
  return (
    <>
      <div className={`alts n${visible.length}`} style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
        {visible.map((r) => {
          const i = results.indexOf(r);
          const hl = ref0 && r.profile.id === "safest" && r.reachable ? hazardHighlight(r, ref0) : null;
          const chip = ref0 && r.profile.id === "safest" && r.reachable ? hazardChip(r, ref0) : null;
          return <AltCard key={r.profile.id} r={r} i={i} selected={selectedId === r.profile.id} onPick={() => onPick(r.profile.id)} ref0={ref0} highlight={hl} chip={chip} />;
        })}
      </div>
      {similar.size > 0 && (
        <div className="alts-note small dim" title="Routes whose line, time and hazard are within a few percent of Fastest are folded together.">
          {hidden.length > 0 ? (
            <>
              {hidden.map((r) => r.profile.name).join(", ")} ≈ Fastest ·{" "}
              <button className="link-btn inline" onClick={() => setShowSimilar(true)}>
                show
              </button>
            </>
          ) : (
            <>
              {[...similar].map((id) => results.find((r) => r.profile.id === id)?.profile.name).join(", ")} ≈ Fastest{showSimilar ? " · " : ""}
              {showSimilar && (
                <button className="link-btn inline" onClick={() => setShowSimilar(false)}>
                  hide
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** One-line version of limitMessage(); the full sentence (numbers and advice) goes in the tooltip. */
function shortLimit(r: RouteResult, names: string[]): string {
  if (!r.reachable) {
    const idx = (r as RouteResult & { unreachableStops?: number[] }).unreachableStops?.[0];
    return `No walkable path${idx != null && names[idx] ? ` to ${names[idx]}` : ""} · too steep or off the map`;
  }
  const i = r.totals.firstSegmentOverLimit ?? 0;
  const what = r.totals.limitingFactor === "energy" ? "energy" : "time";
  return `Over the ${what} budget from ${names[i + 1] ?? `leg ${i + 1}`}`;
}

/** One line under a stop: what the crew does there (from the POI's "what a crew can do") and the dwell. */
function StopTask({ stop, poi }: { stop: Stop; poi?: Poi }) {
  const dwell = stop.dwellS > 0 ? fmtDur(stop.dwellS) : "pass through";
  const task = poi?.humanCan?.trim().replace(/\.$/, "") || (poi ? poi.summary.replace(/\.$/, "") : "Custom stop: observe and sample");
  return (
    <span className="stop-task" title={`${task} · ${dwell}`}>
      <span className="stop-task-text">{task}</span>
      {stop.dwellS <= 0 && <span className="stop-task-dwell"> · {dwell}</span>}
    </span>
  );
}

export function PlanTab() {
  const area = useStore((s) => s.area)!;
  const st = useStore(
    useShallow((s) => {
      const { hover: _h, profileHoverM: _p, profileCursor: _c, go: _g, ...rest } = s;
      return rest;
    }),
  );
  const { start, stops, returnToStart, params, defaultParams, engine, planStatus, planError, results, reachStatus } = st;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const pnr = usePnr();
  const starts = area.config.pois.filter((p) => p.type === "start");
  const stopPois = area.config.pois.filter((p) => p.type !== "start");
  const poiById = new Map(area.config.pois.map((p) => [p.id, p] as const));
  const sel = selectedResult(st);
  const names = pointNames(start, stops, returnToStart);
  const classes = area.config.surfaceClasses;
  if (!params) return null;
  const usableT = usableTimeS(params);
  const src = ((area.config.walkParams as unknown as { _sources?: Record<string, string> })._sources ?? {}) as Record<string, string | undefined>;
  const usableE = params.energyBudgetKJ * (1 - params.reserveFraction);
  const o2On = (params.o2BudgetKg ?? 0) > 0 && (params.o2KgPerKJ ?? 0) > 0;
  const usableO = (params.o2BudgetKg ?? 0) * (1 - params.reserveFraction);
  const msg = sel ? limitMessage(sel, names, params) : null;
  const calculating = planStatus === "calculating" || reachStatus === "calculating";

  return (
    <div className="tab-body">
      {!engine.ready && (
        <div className={`alert ${engine.error ? "bad" : ""}`}>
          {engine.error ?? "Loading routing layers…"}
          {engine.missing.length > 0 && <div className="small">Routes, rings and walk cost need @marsmap/core. The map, layers and POIs still work.</div>}
        </div>
      )}

      <h4 className="section-h">Start</h4>
      <div className="start-box" title={start ? `${fmtLonLat(start.lonLat)} · drag the S marker on the map to move it` : undefined}>
        <select
          value={start?.poiId ?? (start ? "__custom" : "")}
          onChange={(e) => {
            const p = starts.find((x) => x.id === e.target.value) ?? area.config.pois.find((x) => x.id === e.target.value);
            if (p) {
              st.setStart({ lonLat: [p.lon, p.lat], name: p.name, poiId: p.id });
              flyTo(p.lon, p.lat, 15.5);
            }
          }}
        >
          <option value="" disabled>
            Choose a start spot…
          </option>
          {starts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name.replace(/^Start:\s*/, "")}
            </option>
          ))}
          {start && !start.poiId && <option value="__custom">Custom point</option>}
        </select>
        <button className={`btn ${st.pickingStart ? "primary" : ""}`} onClick={() => st.set({ pickingStart: !st.pickingStart })}>
          {st.pickingStart ? "Click map…" : "Pick on map"}
        </button>
      </div>

      <h4 className="section-h">
        Stops <span className="count-dim">{stops.length}</span>
        <label className="toggle head-toggle" title="Plan a loop that ends back at the start">
          <input type="checkbox" checked={returnToStart} onChange={(e) => st.set({ returnToStart: e.target.checked })} />
          Return to start
        </label>
      </h4>
      {stops.length === 0 && <div className="small dim empty">Add a stop below, from a POI card, or by clicking the map.</div>}
      <ol className="stops">
        {stops.map((s, i) => {
          const over = sel && sel.totals.firstSegmentOverLimit != null && i >= sel.totals.firstSegmentOverLimit;
          return (
            <li
              key={s.id}
              draggable
              className={`stop ${dragIdx === i ? "dragging" : ""} ${overIdx === i && dragIdx !== i ? "drop" : ""} ${over ? "over" : ""}`}
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIdx(i);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx != null && dragIdx !== i) st.moveStop(dragIdx, i);
                setDragIdx(null);
                setOverIdx(null);
              }}
            >
              <span className="grip" title="Drag to reorder">
                ⋮⋮
              </span>
              <span className="stop-num">{i + 1}</span>
              <span className="stop-main" onClick={() => flyTo(s.lonLat[0], s.lonLat[1])}>
                <span className="stop-name">{s.name}</span>
              </span>
              <label className="dwell" title="Time working at this stop">
                <input type="number" min={0} max={240} step={5} value={Math.round(s.dwellS / 60)} onChange={(e) => st.setDwell(s.id, Math.max(0, Number(e.target.value)) * 60)} />
                min
              </label>
              <button className="icon-btn" onClick={() => st.removeStop(s.id)} title="Remove stop">
                ×
              </button>
              <StopTask stop={s} poi={s.poiId ? poiById.get(s.poiId) : undefined} />
            </li>
          );
        })}
      </ol>
      <div className="add-row">
        <select
          value=""
          onChange={(e) => {
            const p = stopPois.find((x) => x.id === e.target.value);
            if (p) st.addStop({ lonLat: [p.lon, p.lat], name: p.name, poiId: p.id });
          }}
        >
          <option value="">+ Add a stop…</option>
          {stopPois.map((p) => (
            <option key={p.id} value={p.id} disabled={stops.some((s) => s.poiId === p.id)}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {planError && <div className="alert bad">Routing failed: {planError}</div>}

      {((results && results.length > 0) || calculating) && (
        <h4 className="section-h">
          Routes {calculating && <span className="spinner" title="Calculating" />}
        </h4>
      )}
      {results && results.length > 0 && <RouteAlternatives results={results} selectedId={sel?.profile.id} onPick={(id) => st.set({ selectedProfile: id })} />}

      {sel && (
        <>
          {msg && (
            <div className="alert bad one-line" title={msg}>
              {shortLimit(sel, names)}
            </div>
          )}
          <h4 className="section-h">
            Safety budget
            {!msg && (
              <span className="head-chip ok" title={`Plan fits the EVA time, energy and oxygen limits with ${Math.round(params.reserveFraction * 100)}% held in reserve.`}>
                ✓ Fits limits
              </span>
            )}
          </h4>
          <div className="totals">
            <SafetyBudget r={sel} params={params} pnr={pnr} names={names} />
            <div className="route-facts" title={`${sel.profile.name}: total climb and descent, and estimated radiation dose for the whole EVA.`}>
              <span>
                Climb <b>↑{Math.round(sel.totals.ascentM)} ↓{Math.round(sel.totals.descentM)} m</b>
              </span>
              <span>
                Dose <b>{sel.totals.radiationMSv.toFixed(3)} mSv</b>
              </span>
            </div>
          </div>
          <div className="go-buttons">
            <button className="btn primary" onClick={() => st.setGo({ mode: "sim", playing: true, elapsedS: 0, alongM: 0, position: start?.lonLat ?? null, gpsError: null })}>
              Simulate walk
            </button>
            <button className="btn" onClick={() => st.setGo({ mode: "gps", playing: true, elapsedS: 0, alongM: 0, position: start?.lonLat ?? null, gpsError: null })}>
              Use my location
            </button>
          </div>
          <details className="disc">
            <summary>
              Segment details <span className="disc-note">{sel.segments.length} legs</span>
            </summary>
            <ol className="segs">
              {sel.segments.map((s, i) => (
                <Segment key={i} s={s} i={i} names={names} classes={classes} over={sel.totals.firstSegmentOverLimit != null && i >= sel.totals.firstSegmentOverLimit} />
              ))}
            </ol>
          </details>
        </>
      )}

      <details className="disc">
        <summary>
          Walk settings
          <span className="disc-note">
            {fmtMin(params.evaLimitS)} · {params.baseSpeedMps.toFixed(2)} m/s · {Math.round(params.reserveFraction * 100)}% reserve
          </span>
        </summary>
        <div className="params">
          <Slider hint={src.evaLimitS} label="EVA time limit" value={params.evaLimitS / 3600} min={1} max={9} step={0.25} fmt={(v) => fmtMin(v * 3600)} onChange={(v) => st.setParams({ evaLimitS: v * 3600 })} />
          <Slider hint={src.baseSpeedMps} label="Walking speed" value={params.baseSpeedMps} min={0.3} max={1.8} step={0.05} fmt={(v) => `${v.toFixed(2)} m/s`} onChange={(v) => st.setParams({ baseSpeedMps: v })} />
          <Slider
            label="Dwell per stop"
            hint={`Sets the work time at every stop. ${src.stopDwellS ?? ""}`.trim()}
            value={params.stopDwellS / 60}
            min={0}
            max={90}
            step={5}
            fmt={(v) => fmtMin(v * 60)}
            onChange={(v) => {
              st.setParams({ stopDwellS: v * 60 });
              st.set({ stops: useStore.getState().stops.map((s) => ({ ...s, dwellS: v * 60 })) });
            }}
          />
          {o2On && (
            <Slider hint={src.o2BudgetKg} label="Oxygen carried" value={params.o2BudgetKg!} min={0.2} max={1.5} step={0.05} fmt={(v) => `${v.toFixed(2)} kg`} onChange={(v) => st.setParams({ o2BudgetKg: v })} />
          )}
          <Slider hint={src.reserveFraction} label="Safety reserve" value={params.reserveFraction * 100} min={0} max={50} step={1} fmt={(v) => `${Math.round(v)}%`} onChange={(v) => st.setParams({ reserveFraction: v / 100 })} />
        </div>
        <div className="params-foot">
          <span className="small dim" title={`Usable = limit minus the safety reserve. Max slope is the no-go steepness for routing. Source: ${area.config.walkParamsSource}`}>
            Usable {fmtMin(usableT)} · {fmtEnergy(usableE)}
            {o2On ? ` · ${fmtO2(usableO)} O₂` : ""} · slope ≤ {params.maxSlopeDeg}° <span className="info">ⓘ</span>
          </span>
          {defaultParams && JSON.stringify(defaultParams) !== JSON.stringify(params) && (
            <button className="link-btn" onClick={() => st.set({ params: defaultParams })}>
              reset
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
