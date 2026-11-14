import type { ReactNode } from "react";
import { useStore, type OverlayId } from "../store";
import { imageryGroup } from "../map/MapView";
import { COST_RAMP, cssGradient, ELEV_RAMP, SLOPE_STOPS } from "../map/rasters";

function Row({ id, title, children, disabled, note }: { id: OverlayId; title: string; children?: ReactNode; disabled?: string; note?: ReactNode }) {
  const st = useStore((s) => s.overlays[id]);
  const setOverlay = useStore((s) => s.setOverlay);
  return (
    <div className={`layer-row ${disabled ? "disabled" : ""}`}>
      <div className="layer-head">
        <label className="switch">
          <input type="checkbox" checked={st.on && !disabled} disabled={!!disabled} onChange={(e) => setOverlay(id, { on: e.target.checked })} />
          <span />
        </label>
        <span className="layer-title">{title}</span>
        {note}
        <input
          className="opacity"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={st.opacity}
          disabled={!st.on || !!disabled}
          onChange={(e) => setOverlay(id, { opacity: Number(e.target.value) })}
          title="Opacity"
        />
      </div>
      {disabled ? <div className="small dim">{disabled}</div> : st.on && children}
    </div>
  );
}

function Source({ text }: { text?: string }) {
  if (!text) return null;
  return <div className="layer-src">{text}</div>;
}

export function LayersTab() {
  const area = useStore((s) => s.area)!;
  const base = useStore((s) => s.baseImagery);
  const baseOpacity = useStore((s) => s.baseOpacity);
  const set = useStore((s) => s.set);
  const reach = useStore((s) => s.reach);
  const start = useStore((s) => s.start);
  const m = area.manifest;
  const layer = (id: string) => m.layers.find((l) => l.id === id);
  const groups = new Map<string, (typeof m.imagery)[number][]>();
  for (const im of m.imagery) {
    const g = imageryGroup(im.id);
    groups.set(g, [...(groups.get(g) ?? []), im]);
  }
  const est = (id: string) => (layer(id)?.estimated ? <span className="badge est tiny">estimated</span> : null);
  const L = area.layers;
  return (
    <div className="tab-body">
      <h4 className="section-h">Base imagery</h4>
      <div className="base-list">
        {[...groups.entries()].map(([g, ims]) => {
          const im = ims[0]!;
          return (
            <label key={g} className={`base-opt ${base === g ? "active" : ""}`}>
              <input type="radio" name="base" checked={base === g} onChange={() => set({ baseImagery: g })} />
              <div>
                <div className="layer-title">
                  {im.name.replace(/\s*\(?tile.*$/i, "")}
                  {ims.length > 1 && <span className="dim small"> · {ims.length} tiles</span>}
                </div>
                <div className="layer-src">
                  {im.source}
                  {im.metersPerPixel ? ` · ${im.metersPerPixel} m/px` : ""}
                </div>
              </div>
            </label>
          );
        })}
        <label className={`base-opt ${base === null ? "active" : ""}`}>
          <input type="radio" name="base" checked={base === null} onChange={() => set({ baseImagery: null })} />
          <div className="layer-title">None</div>
        </label>
      </div>
      <div className="slider-row">
        <span className="small dim">Imagery opacity</span>
        <input type="range" min={0} max={1} step={0.05} value={baseOpacity} onChange={(e) => set({ baseOpacity: Number(e.target.value) })} />
      </div>

      <h4 className="section-h">Overlays</h4>
      <Row id="surface" title="Surface conditions" note={est("surface")} disabled={L.surface ? undefined : "No surface layer in this dataset"}>
        <div className="legend-classes">
          {area.config.surfaceClasses.map((c) => (
            <span key={c.id}>
              <i className="swatch" style={{ background: c.color }} />
              {c.name}
              {c.hazard && <span className="hz">hazard</span>}
            </span>
          ))}
        </div>
        <Source text={layer("surface") && `${layer("surface")!.source} · ${layer("surface")!.method}`} />
      </Row>
      <Row id="slope" title="Slope" note={est("slope")} disabled={L.slope ? undefined : "No slope layer"}>
        <div className="legend-bar" style={{ background: cssGradient(SLOPE_STOPS) }} />
        <div className="legend-ticks">
          <span>0°</span>
          <span>10°</span>
          <span>15°</span>
          <span>25°</span>
          <span>35°+</span>
        </div>
        <Source text={layer("slope") && `${layer("slope")!.source} · ${layer("slope")!.method}`} />
      </Row>
      <Row id="elevation" title="Elevation" note={est("elevation")} disabled={L.elevation ? undefined : "No elevation layer"}>
        <div className="legend-bar" style={{ background: cssGradient(ELEV_RAMP) }} />
        <div className="legend-ticks">
          <span>{Math.round(L.elevMin)} m</span>
          <span>{Math.round(L.elevMax)} m</span>
        </div>
        <Source text={layer("elevation")?.source} />
      </Row>
      <Row id="hillshade" title="Hillshade (from DEM)" disabled={L.elevation ? undefined : "No elevation layer"}>
        <div className="small dim">Opacity slider sets shading strength.</div>
      </Row>
      <Row id="cost" title="Walk cost from start" disabled={!start ? "Set a start to see walk cost" : undefined} note={<span className="badge sim tiny">model</span>}>
        {reach ? (
          <>
            <div className="legend-bar" style={{ background: cssGradient(COST_RAMP) }} />
            <div className="legend-ticks abs">
              {COST_RAMP.map(([t]) => (
                <span key={t} style={{ left: `${t * 100}%` }}>
                  {Math.round(t * 100)}%
                </span>
              ))}
            </div>
            <div className="small dim">Round-trip walking time as a share of usable EVA time. Dark = beyond the budget.</div>
          </>
        ) : (
          <div className="small dim">Calculating…</div>
        )}
      </Row>
      <Row id="rings" title="Walk-limit rings" disabled={!start ? "Set a start to see walk-limit rings" : undefined}>
        <div className="small dim">Round-trip walking time from the start: 15 min, 30 min, 1 h, and the walk limit (usable EVA time minus one stop of work).</div>
      </Row>
      <Row id="track" title="Curiosity traverse + waypoints" disabled={area.rover.traverse ? undefined : "No rover traverse in this dataset"}>
        <div className="layer-src">NASA/JPL-Caltech MSL localized traverse</div>
      </Row>
      <Row id="pois" title="Points of interest" />

      <h4 className="section-h">Data</h4>
      <div className="small dim">
        Area <span className="mono">{area.areaId}</span> · manifest generated {new Date(m.generatedAt).toLocaleString()}
        <br />
        Map uses Mars lon/lat on a Web Mercator canvas (≈0.35% scale distortion at 4.8°S). All distances and times come from the routing core.
      </div>
    </div>
  );
}
