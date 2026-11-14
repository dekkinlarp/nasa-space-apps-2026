import { useStore } from "../store";
import { fmtDist, fmtLonLat, fmtNum } from "../format";
import { surfaceById } from "../lib";
import { cellIndex, marsDistanceM } from "../geo";
import { scienceLayers, scienceRamp } from "../map/MapView";

export function HoverReadout() {
  const hover = useStore((s) => s.hover);
  const area = useStore((s) => s.area)!;
  const start = useStore((s) => s.start);
  const picking = useStore((s) => s.pickingStart);
  const surf = surfaceById(area.config.surfaceClasses, hover?.surfaceId);
  const sci = useStore((s) => s.sci);
  const sciData = useStore((s) => s.sciData);
  const confOn = useStore((s) => s.overlays.confidence.on);
  const cell = hover ? cellIndex(area.layers.grid, hover.lonLat) : null;
  const sciOn = scienceLayers(area).filter((l) => sci[l.id]?.on && sciData[l.id]);
  const conf = confOn && cell != null ? area.layers.confidence?.[cell] : undefined;
  return (
    <div className="readout">
      {picking && <div className="readout-hint">Click the map to place the start</div>}
      {hover ? (
        <>
          <div className="mono">{fmtLonLat(hover.lonLat)}</div>
          <div className="readout-row">
            <span>
              <b>Elev</b> {fmtNum(hover.elevationM, 1, " m")}
            </span>
            <span>
              <b>Slope</b> {fmtNum(hover.slopeDeg, 1, "°")}
            </span>
            <span>
              <b>Surface</b>{" "}
              {surf ? (
                <>
                  <i className="swatch" style={{ background: surf.color }} />
                  {surf.name}
                </>
              ) : (
                "—"
              )}
            </span>
            {start && (
              <span>
                <b>From start</b> {fmtDist(marsDistanceM(start.lonLat, hover.lonLat))}
              </span>
            )}
          </div>
          {(sciOn.length > 0 || conf != null) && (
            <div className="readout-row">
              {sciOn.map((l) => {
                const v = cell != null ? sciData[l.id]![cell] : undefined;
                return (
                  <span key={l.id}>
                    <i className="swatch" style={{ background: scienceRamp(area, l.id)[1]![1] }} />
                    <b>{(l.name ?? l.id).replace(/\s*\(.*$/, "")}</b> {v != null && Number.isFinite(v) ? (v > 0 ? v.toFixed(4) : "none") : "—"}
                  </span>
                );
              })}
              {conf != null && (
                <span>
                  <b>Surface confidence</b> {conf}/200
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="dim">Hover the map for elevation, slope and surface</div>
      )}
    </div>
  );
}
