import type { ReactNode } from "react";
import { useStore, type OverlayId } from "../store";
import type { LayerEntry } from "@marsmap/core";
import { imageryGroup, scienceLayers, scienceRamp } from "../map/MapView";
import { tintable } from "../map/tint";
import { CONFIDENCE_CLEAR, CONFIDENCE_LOW, COST_RAMP, cssGradient, ELEV_RAMP, SLOPE_STOPS } from "../map/rasters";
import type { AreaData } from "../types";

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

/** "THEMIS night-time IR (thermal inertia proxy, ~100 m)" → "THEMIS night-time IR"; the full name stays in the tooltip. */
const shortName = (name: string) => name.replace(/\s*\(?tile.*$/i, "").replace(/\s*\([^)]*\)\s*$/, "") || name;
/** Instrument credit from a source string, e.g. "… (MRO HiRISE, NASA/JPL/UArizona), z16" → "MRO HiRISE". */
const credit = (src: string) => /\(([^,)]+)/.exec(src)?.[1]?.trim() ?? src;
const fmtRes = (v: number) => (v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
/** One science layer from the manifest: switch, opacity, legend, what it means and where it comes from. */
function ScienceRow({ area, layer }: { area: AreaData; layer: LayerEntry }) {
  const st = useStore((s) => s.sci[layer.id]) ?? { on: false, opacity: 0.75 };
  const setSci = useStore((s) => s.setSci);
  const loaded = useStore((s) => !!s.sciData[layer.id]);
  const info = area.minerals?.layers.find((l) => l.id === layer.id);
  const max = layer.display?.max ?? 1;
  return (
    <div className="layer-row">
      <div className="layer-head">
        <label className="switch">
          <input type="checkbox" checked={st.on} onChange={(e) => setSci(layer.id, { on: e.target.checked })} />
          <span />
        </label>
        <span className="layer-title">{layer.name ?? layer.id}</span>
        {layer.estimated && <span className="badge est tiny">estimated</span>}
        <input className="opacity" type="range" min={0} max={1} step={0.05} value={st.opacity} disabled={!st.on} onChange={(e) => setSci(layer.id, { opacity: Number(e.target.value) })} title="Opacity" />
      </div>
      {st.on && (
        <>
          <div className="legend-bar" style={{ background: cssGradient(scienceRamp(area, layer.id)) }} />
          <div className="legend-ticks">
            <span>just above 0</span>
            <span>{loaded ? "" : "loading…"}</span>
            <span>{max}+ (strongest 2%)</span>
          </div>
          {info && (
            <div className="small">
              {info.indicates} <span className="dim">{info.caveat}</span>
            </div>
          )}
          {info?.stats && <div className="small dim">Present (above 0) over {info.stats.positivePct}% of this area. Ground with no signal is left clear.</div>}
        </>
      )}
    </div>
  );
}

function DataChecks({ area }: { area: AreaData }) {
  const c = area.checks;
  const m = area.minerals;
  const scenes = m ? (m.scenes ?? [{ obs: m.observation, acquired: m.acquired, coregistration: m.coregistration }]) : [];
  const share = m?.layers[0]?.stats?.scenePct;
  if (!c?.georef && !c?.slopeVsTilt && !scenes.length) return null;
  return (
    <>
      <h4 className="section-h">Checks against the rover</h4>
      <ul className="checks">
        {c?.georef && (
          <li>
            <b>Elevation.</b> At {c.georef.waypoints} Curiosity waypoints the map's elevation differs from the rover's own by a median of {c.georef.medianAbsDiffM.toFixed(2)} m (largest{" "}
            {c.georef.maxAbsDiffM.toFixed(2)} m). This confirms the map is in the right place; it does not prove the elevation data itself is that accurate.
          </li>
        )}
        {c?.slopeVsTilt && (
          <li>
            <b>Slope.</b> At {c.slopeVsTilt.waypoints} waypoints the map's median slope is {c.slopeVsTilt.medianSlopeDeg.toFixed(1)}° and the rover's median recorded tilt is{" "}
            {c.slopeVsTilt.medianTiltDeg.toFixed(1)}°; spot by spot they differ by a median of {c.slopeVsTilt.medianAbsDiffDeg.toFixed(1)}°.
          </li>
        )}
        {scenes.map(({ obs, coregistration: co }) =>
          co.corrBest == null ? null : (
            <li key={obs}>
              <b>Minerals, scene {obs}</b>
              {share?.[obs] != null ? ` (${share[obs]}% of the area)` : ""}.{" "}
              {co.applied
                ? `As delivered it sat ${Math.round(Math.hypot(co.shiftM[0], co.shiftM[1]))} m off the photo. Shifting it ${Math.abs(co.shiftPx[0])} px ${co.shiftPx[0] > 0 ? "west" : "east"} and ${Math.abs(co.shiftPx[1])} px ${co.shiftPx[1] > 0 ? "north" : "south"} raised its match with the HiRISE photo from r = ${co.corrUnshifted} to r = ${co.corrBest}.`
                : `It matches the HiRISE photo at r = ${co.corrUnshifted} without any shift (best nearby shift: r = ${co.corrBest}).`}
            </li>
          ),
        )}
        {scenes.length > 0 && (
          <li>
            Each scene is moved as a whole, so expect mineral pixels to be within one to two pixels ({m?.pixelM}–{(m?.pixelM ?? 0) * 2} m) of their true place.
            {scenes.length > 1 ? " Where two scenes meet there is a seam: they were taken in different years, so compare values across it with care." : ""}
          </li>
        )}
        {c?.problems && c.problems.length > 0 && <li className="bad">Pipeline problems: {c.problems.join("; ")}</li>}
      </ul>
    </>
  );
}

function Source({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="layer-src one-line" title={text}>
      {text}
    </div>
  );
}

export function LayersTab() {
  const area = useStore((s) => s.area)!;
  const base = useStore((s) => s.baseImagery);
  const baseOpacity = useStore((s) => s.baseOpacity);
  const marsTint = useStore((s) => s.marsTint);
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
            <label key={g} className={`base-opt ${base === g ? "active" : ""}`} title={`${im.name}\n${im.source}`}>
              <input type="radio" name="base" checked={base === g} onChange={() => set({ baseImagery: g })} />
              <div>
                <div className="layer-title">{shortName(im.name)}</div>
                <div className="layer-src one-line">
                  {[credit(im.source), im.metersPerPixel ? `${fmtRes(im.metersPerPixel)} m/px` : "", ims.length > 1 ? `${ims.length} tiles` : ""].filter(Boolean).join(" · ")}
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
      <div className={`layer-row ${base && tintable(base) ? "" : "disabled"}`}>
        <div className="layer-head">
          <label className="switch">
            <input type="checkbox" checked={marsTint && !!base && tintable(base)} disabled={!base || !tintable(base)} onChange={(e) => set({ marsTint: e.target.checked })} />
            <span />
          </label>
          <span className="layer-title">Mars colour tint</span>
          <span className="badge est tiny">cosmetic</span>
        </div>
        <div className="small dim">
          {base && !tintable(base)
            ? "Thermal imagery shows temperature, so it is left as captured."
            : "This imagery is one band of brightness, with no colour in it. The tint only makes it read as Mars; switch it off to see the image as captured."}
        </div>
      </div>

      {scienceLayers(area).length > 0 && (
        <>
          <h4 className="section-h">
            Minerals from orbit <span className="badge sim tiny">science</span>
          </h4>
          {scienceLayers(area).map((l) => (
            <ScienceRow key={l.id} area={area} layer={l} />
          ))}
          {area.minerals && (
            <div className="layer-src">
              {area.minerals.mission}, observation {area.minerals.observation}, {area.minerals.acquired}, {area.minerals.pixelM} m per pixel. {area.minerals.note}
            </div>
          )}
        </>
      )}

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
      <Row id="confidence" title="Surface uncertainty" note={est("surface_confidence")} disabled={L.confidence ? undefined : "No confidence layer in this dataset"}>
        <div className="legend-bar" style={{ background: "linear-gradient(90deg, rgba(232,62,140,.9), rgba(232,62,140,0))" }} />
        <div className="legend-ticks">
          <span>least sure ({CONFIDENCE_LOW} or less)</span>
          <span>clear = {CONFIDENCE_CLEAR}+ of 200</span>
        </div>
        <div className="small dim">Pink marks ground where the surface estimate is a close call between two classes. Treat routes across it as less certain.</div>
        <Source text={layer("surface_confidence")?.method} />
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
            <div className="small dim">Round trip as % of usable EVA time · dark = beyond budget</div>
          </>
        ) : (
          <div className="small dim">Calculating…</div>
        )}
      </Row>
      <Row id="rings" title="Walk-limit rings" disabled={!start ? "Set a start to see walk-limit rings" : undefined}>
        <div className="small dim" title="Dashed rings: 15 min, 30 min and 1 h of round-trip walking from the start. Solid ring: the walk limit, the farthest you can go, work one stop and still get home with the reserve intact on time, energy and oxygen. Its label names the one that runs out first.">
          Round trip: 15 min · 30 min · 1h · walk limit
        </div>
      </Row>
      <Row id="track" title="Curiosity traverse + waypoints" disabled={area.rover.traverse ? undefined : "No rover traverse in this dataset"}>
        <div className="layer-src">NASA/JPL-Caltech MSL localized traverse</div>
      </Row>
      <Row id="pois" title="Points of interest" />

      <DataChecks area={area} />

      <h4 className="section-h">Data</h4>
      <div
        className="small dim data-note"
        title={`Manifest generated ${new Date(m.generatedAt).toLocaleString()}.\nMap uses Mars lon/lat on a Web Mercator canvas (≈0.35% scale distortion at 4.8°S). All distances and times come from the routing core.`}
      >
        Area <span className="mono">{area.areaId}</span> · generated {new Date(m.generatedAt).toLocaleDateString()} <span className="info">ⓘ</span>
      </div>
    </div>
  );
}
