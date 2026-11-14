import { useStore } from "../store";
import { fmtDist, fmtLonLat, fmtNum } from "../format";
import { surfaceById } from "../lib";
import { marsDistanceM } from "../geo";

export function HoverReadout() {
  const hover = useStore((s) => s.hover);
  const area = useStore((s) => s.area)!;
  const start = useStore((s) => s.start);
  const picking = useStore((s) => s.pickingStart);
  const surf = surfaceById(area.config.surfaceClasses, hover?.surfaceId);
  return (
    <div className={`readout ${hover ? "" : "idle"}`}>
      {picking && <div className="readout-hint">Click the map to place the start</div>}
      {hover ? (
        <>
          <div className="readout-row">
            <span title="Elevation">{fmtNum(hover.elevationM, 0, " m")}</span>
            <span title="Slope">
              {fmtNum(hover.slopeDeg, 1, "°")} <small>slope</small>
            </span>
            <span title="Surface (mapped class)">
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
              <span title="Straight-line distance from the start">
                {fmtDist(marsDistanceM(start.lonLat, hover.lonLat))} <small>from start</small>
              </span>
            )}
          </div>
          <div className="readout-ll">{fmtLonLat(hover.lonLat)}</div>
        </>
      ) : (
        <div>Hover the map for slope and surface</div>
      )}
    </div>
  );
}
