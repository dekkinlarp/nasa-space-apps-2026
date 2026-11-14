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
        </>
      ) : (
        <div className="dim">Hover the map for elevation, slope and surface</div>
      )}
    </div>
  );
}
