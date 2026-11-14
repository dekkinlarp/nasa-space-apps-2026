import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { RouteResult, RouteSegment, SurfaceClass } from "@marsmap/core";
import { selectedResult, usableTimeS, useStore } from "../store";
import { fmtDist, fmtDur, fmtEnergy, fmtLonLat, fmtO2 } from "../format";
import { limitMessage, pointNames } from "../lib";
import { profileColor } from "../map/MapView";
import { flyTo } from "./ExploreTab";

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

function Meter({ label, used, limit, fmt }: { label: string; used: number; limit: number; fmt: (v: number) => string }) {
  const f = limit > 0 ? used / limit : 0;
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span>
          <b className={f > 1 ? "bad" : f > 0.85 ? "warnc" : ""}>{fmt(used)}</b> <span className="dim">/ {fmt(limit)}</span>
        </span>
      </div>
      <div className="meter-bar">
        <i style={{ width: `${Math.min(100, f * 100)}%` }} className={f > 1 ? "bad" : f > 0.85 ? "warnc" : ""} />
      </div>
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
      <div className="seg-stats">
        <span>{fmtDist(s.distanceM)}</span>
        <span>
          ↑{Math.round(s.ascentM)} ↓{Math.round(s.descentM)} m
        </span>
        <span>
          {s.avgSlopeDeg.toFixed(1)}° avg / {s.maxSlopeDeg.toFixed(1)}° max
        </span>
        <span className={s.hazardM > 0 ? "warnc" : "dim"}>{Math.round(s.hazardM)} m hazard</span>
        <span className="dim">{fmtEnergy(s.energyKJ)}</span>
      </div>
      <SurfaceMixBar mix={s.surfaceMix} classes={classes} />
    </li>
  );
}

function AltCard({ r, i, selected, onPick }: { r: RouteResult; i: number; selected: boolean; onPick: () => void }) {
  const t = r.totals;
  return (
    <button className={`alt ${selected ? "active" : ""}`} onClick={onPick} style={{ ["--c" as string]: profileColor(r.profile.id, i) }}>
      <div className="alt-name">{r.profile.name}</div>
      <div className="alt-big">{fmtDur(t.totalTimeS)}</div>
      <div className="alt-sub">
        {fmtDist(t.distanceM)} · {fmtEnergy(t.energyKJ)}
      </div>
      <div className="alt-sub">{Math.round(t.hazardM)} m hazard</div>
      <div className={`alt-status ${!r.reachable ? "bad" : t.withinLimits ? "ok" : "bad"}`}>{!r.reachable ? "Unreachable" : t.withinLimits ? "Within limits" : `Over ${t.limitingFactor ?? "limit"}`}</div>
    </button>
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
  const starts = area.config.pois.filter((p) => p.type === "start");
  const stopPois = area.config.pois.filter((p) => p.type !== "start");
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
      <div className="start-box">
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
      {start && <div className="small dim mono">{fmtLonLat(start.lonLat)} · drag the S marker to move</div>}

      <h4 className="section-h">
        Stops <span className="dim small">({stops.length})</span>
      </h4>
      {stops.length === 0 && <div className="small dim empty">Add stops from the list below, from a POI card, or by clicking the map.</div>}
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
              <span className="stop-name" onClick={() => flyTo(s.lonLat[0], s.lonLat[1])}>
                {s.name}
              </span>
              <label className="dwell" title="Time working at this stop">
                <input type="number" min={0} max={240} step={5} value={Math.round(s.dwellS / 60)} onChange={(e) => st.setDwell(s.id, Math.max(0, Number(e.target.value)) * 60)} />
                min
              </label>
              <button className="icon-btn" onClick={() => st.removeStop(s.id)} title="Remove stop">
                ×
              </button>
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
          <option value="">+ Add stop from a point of interest…</option>
          {stopPois.map((p) => (
            <option key={p.id} value={p.id} disabled={stops.some((s) => s.poiId === p.id)}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={returnToStart} onChange={(e) => st.set({ returnToStart: e.target.checked })} />
          Return to start
        </label>
      </div>

      <h4 className="section-h">
        Walk limits {calculating && <span className="spinner" title="Calculating" />}
        {defaultParams && JSON.stringify(defaultParams) !== JSON.stringify(params) && (
          <button className="link-btn" onClick={() => st.set({ params: defaultParams })}>
            reset
          </button>
        )}
      </h4>
      <div className="params">
        <Slider hint={src.evaLimitS} label="EVA time limit" value={params.evaLimitS / 3600} min={1} max={9} step={0.25} fmt={(v) => `${v.toFixed(2).replace(/\.?0+$/, "")} h`} onChange={(v) => st.setParams({ evaLimitS: v * 3600 })} />
        <Slider hint={src.baseSpeedMps} label="Base walking speed" value={params.baseSpeedMps} min={0.3} max={1.8} step={0.05} fmt={(v) => `${v.toFixed(2)} m/s`} onChange={(v) => st.setParams({ baseSpeedMps: v })} />
        <Slider
          label="Dwell per stop (all stops)"
          hint={src.stopDwellS}
          value={params.stopDwellS / 60}
          min={0}
          max={90}
          step={5}
          fmt={(v) => `${v} min`}
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
      <div className="small dim">
        Usable after reserve: {fmtDur(usableT)} · {fmtEnergy(usableE)}
        {o2On ? ` · ${fmtO2(usableO)} oxygen` : ""} · max slope {params.maxSlopeDeg}° · source {area.config.walkParamsSource}
      </div>

      {planError && <div className="alert bad">Routing failed: {planError}</div>}

      {results && results.length > 0 && (
        <>
          <h4 className="section-h">Routes</h4>
          <div className="alts">
            {results.map((r, i) => (
              <AltCard key={r.profile.id} r={r} i={i} selected={sel?.profile.id === r.profile.id} onPick={() => st.set({ selectedProfile: r.profile.id })} />
            ))}
          </div>
        </>
      )}

      {sel && (
        <>
          {msg && <div className="alert bad">{msg}</div>}
          {!msg && <div className="alert ok">Plan fits the time, energy{o2On ? " and oxygen" : ""} limits with {Math.round(params.reserveFraction * 100)}% held in reserve.</div>}
          <div className="totals">
            <Meter label="Total time (walk + dwell)" used={sel.totals.totalTimeS} limit={usableT} fmt={fmtDur} />
            <Meter label="Energy" used={sel.totals.energyKJ} limit={usableE} fmt={fmtEnergy} />
            {o2On && sel.totals.o2Kg != null && <Meter label="Oxygen (breathing + leakage, modelled)" used={sel.totals.o2Kg} limit={usableO} fmt={fmtO2} />}
            <dl className="stats compact">
              <div>
                <dt>Distance</dt>
                <dd>{fmtDist(sel.totals.distanceM)}</dd>
              </div>
              <div>
                <dt>Walking time</dt>
                <dd>{fmtDur(sel.totals.walkTimeS)}</dd>
              </div>
              <div>
                <dt>Ascent / descent</dt>
                <dd>
                  {Math.round(sel.totals.ascentM)} / {Math.round(sel.totals.descentM)} m
                </dd>
              </div>
              <div>
                <dt>Hazard ground</dt>
                <dd>{Math.round(sel.totals.hazardM)} m</dd>
              </div>
              <div>
                <dt>Radiation dose</dt>
                <dd>{sel.totals.radiationMSv.toFixed(3)} mSv</dd>
              </div>
            </dl>
          </div>
          <ol className="segs">
            {sel.segments.map((s, i) => (
              <Segment key={i} s={s} i={i} names={names} classes={classes} over={sel.totals.firstSegmentOverLimit != null && i >= sel.totals.firstSegmentOverLimit} />
            ))}
          </ol>
          <div className="go-buttons">
            <button className="btn primary" onClick={() => st.setGo({ mode: "sim", playing: true, elapsedS: 0, alongM: 0, position: start?.lonLat ?? null, gpsError: null })}>
              ▶ Go (simulated walk)
            </button>
            <button className="btn" onClick={() => st.setGo({ mode: "gps", playing: true, elapsedS: 0, alongM: 0, position: start?.lonLat ?? null, gpsError: null })}>
              Use my location
            </button>
          </div>
        </>
      )}
    </div>
  );
}
