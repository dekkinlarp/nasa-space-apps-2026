import type { LonLat } from "@marsmap/core";
import { useStore } from "../store";
import { fmtLonLat, fmtNum } from "../format";
import { sampleAt, surfaceById } from "../lib";
import { inGrid } from "../geo";

export function ClickMenu({ lonLat }: { lonLat: LonLat }) {
  const area = useStore((s) => s.area)!;
  const set = useStore((s) => s.set);
  const setStart = useStore((s) => s.setStart);
  const addStop = useStore((s) => s.addStop);
  const stops = useStore((s) => s.stops);
  const smp = sampleAt(area.layers, lonLat);
  const surf = surfaceById(area.config.surfaceClasses, smp?.surfaceId);
  const inside = inGrid(area.layers.grid, lonLat);
  return (
    <div className="click-menu">
      <div className="mono small dim">{fmtLonLat(lonLat)}</div>
      {smp && (
        <div className="click-stats">
          <span>{fmtNum(smp.elevationM, 1, " m")}</span>
          <span>{fmtNum(smp.slopeDeg, 1, "°")}</span>
          {surf && (
            <span>
              <i className="swatch" style={{ background: surf.color }} /> {surf.name}
            </span>
          )}
        </div>
      )}
      {inside ? (
        <div className="click-actions">
          <button
            className="btn"
            onClick={() => {
              setStart({ lonLat, name: "Custom start" });
              set({ mapClick: null, tab: "plan" });
            }}
          >
            Set start here
          </button>
          <button
            className="btn primary"
            onClick={() => {
              addStop({ lonLat, name: `Map point ${stops.length + 1}` });
              set({ mapClick: null, tab: "plan" });
            }}
          >
            Add stop here
          </button>
        </div>
      ) : (
        <div className="small dim">Outside the mapped area.</div>
      )}
    </div>
  );
}
