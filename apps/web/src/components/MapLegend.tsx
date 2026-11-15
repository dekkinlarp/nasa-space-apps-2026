import { useEffect, useState, type ReactNode } from "react";
import { selectedResult, useStore } from "../store";
import { fmtDur } from "../format";
import { getMap, isTrackFaded, profileColor, RELAYOUT_LABELS, RING_COLOR, RING_LIMIT_COLOR } from "../map/MapView";
import { ROUTE_SLOPE_COLORS, slopeBands } from "../map/routeSlope";

/** v2: the key now starts collapsed; an "open" choice saved by older builds is ignored. */
const LS_KEY = "marsmap.legendOpen.v2";

/** A short line sample, optionally dashed, with a dark casing like the map lines. */
function LineSwatch({ color, dash, casing, width = 3, opacity = 1 }: { color: string; dash?: string; casing?: string; width?: number; opacity?: number }) {
  return (
    <svg className="lg-sw" width="26" height="10" viewBox="0 0 26 10" aria-hidden>
      {casing && <line x1="2" y1="5" x2="24" y2="5" stroke={casing} strokeWidth={width + 3} strokeLinecap="round" />}
      <line x1="2" y1="5" x2="24" y2="5" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap={dash ? "butt" : "round"} opacity={opacity} />
    </svg>
  );
}

const POI_KEY: [string, string, string][] = [
  ["#ff7a2f", "Drill site", "Where Curiosity drilled a sample"],
  ["#b58cff", "Target", "Science target a crew could visit"],
  ["#4fc3f7", "Viewpoint", "Viewpoint over the boxwork"],
  ["#6fd48a", "Start spot", "Suggested start: a past Curiosity stop"],
];

function Row({ sw, children, tip }: { sw: ReactNode; children: ReactNode; tip?: string }) {
  return (
    <div className="lg-row" title={tip}>
      <span className="lg-key">{sw}</span>
      <span className="lg-text">{children}</span>
    </div>
  );
}

/** Collapsible key for the lines and markers drawn on the map. Shows only what is on screen. */
export function MapLegend() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(LS_KEY, open ? "0" : "1");
    } catch {
      /* ignore */
    }
  };
  const tab = useStore((s) => s.tab);
  const params = useStore((s) => s.params);
  const results = useStore((s) => s.results);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const overlays = useStore((s) => s.overlays);
  const rings = useStore((s) => s.rings);
  const start = useStore((s) => s.start);
  const stops = useStore((s) => s.stops);
  const area = useStore((s) => s.area)!;

  const sel = selectedResult({ results, selectedProfile });
  // The key changes size with its content: let the ring labels move out from under it.
  useEffect(() => {
    const id = requestAnimationFrame(() => getMap()?.fire(RELAYOUT_LABELS));
    return () => cancelAnimationFrame(id);
  }, [open, tab, !!sel, !!rings?.length, overlays.rings.on, overlays.track.on, overlays.pois.on, !!start, stops.length > 0]);
  const b = slopeBands(params);
  const C = ROUTE_SLOPE_COLORS;
  const alts = (results ?? []).map((r, i) => ({ id: r.profile.id, color: profileColor(r.profile.id, i) })).filter((r) => r.id !== sel?.profile.id);
  const showRings = !!rings?.length && overlays.rings.on;
  const ringBudgets = (rings ?? []).map((r) => r.budgetS).sort((x, y) => x - y);
  const limitS = ringBudgets[ringBudgets.length - 1];
  const showTrack = !!area.rover.traverse && overlays.track.on;
  const lastSol = area.rover.waypoints.reduce((m, w) => Math.max(m, w.sol ?? 0), 0);
  const trackFaded = isTrackFaded(tab, overlays.track);

  return (
    <div className={`map-legend ${open ? "open" : ""}`}>
      <button className="lg-head" onClick={toggle} aria-expanded={open} title={open ? "Hide map key" : "Show what the lines and markers mean"}>
        <span>Key</span>
        <span className="lg-chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="lg-body">
          {sel && (
            <div className="lg-sec" title={`Route coloured by slope underfoot. Hazard from ${b.caution}°, no entry over ${b.max}°.`}>
              <div className="lg-h">Route slope</div>
              <div className="lg-ramp">
                <span style={{ background: C.easy }} />
                <span style={{ background: C.moderate }} />
                <span style={{ background: C.caution }} />
                <span style={{ background: C.limit }} />
              </div>
              <div className="lg-ramp-ticks">
                <span style={{ left: "25%" }}>{b.easyBelow}°</span>
                <span style={{ left: "50%" }}>{b.caution}°</span>
                <span style={{ left: "75%" }}>{b.max}°</span>
              </div>
              {alts.length > 0 && (
                <Row
                  sw={
                    <span className="lg-multi">
                      {alts.map((a) => (
                        <LineSwatch key={a.id} color={a.color} opacity={0.5} width={3} />
                      ))}
                    </span>
                  }
                  tip="The other route options, faded"
                >
                  Other routes
                </Row>
              )}
              {sel.totals.firstSegmentOverLimit != null && (
                <Row sw={<LineSwatch color="#ffd2d2" dash="2 3" casing="#4a0d0b" width={2} />} tip="Legs walked after the EVA time or energy limit is used up">
                  Past limit
                </Row>
              )}
            </div>
          )}

          {(start || stops.length > 0) && (
            <div className="lg-sec">
              {start && (
                <Row sw={<span className="lg-marker lg-start">S</span>} tip="Start point. Drag it on the map to move it.">
                  Start
                </Row>
              )}
              {stops.length > 0 && (
                <Row sw={<span className="lg-marker lg-stop">1</span>} tip="Stops, numbered in walking order. Drag to move.">
                  Stops
                </Row>
              )}
            </div>
          )}

          {showRings && (
            <div className="lg-sec">
              {ringBudgets.length > 1 && (
                <Row
                  sw={<LineSwatch color={RING_COLOR} dash="4 3" width={2} />}
                  tip={`Round-trip walking time from the start: ${ringBudgets
                    .slice(0, -1)
                    .map((s) => fmtDur(s))
                    .join(", ")}`}
                >
                  Round trip
                </Row>
              )}
              {limitS != null && (
                <Row
                  sw={<LineSwatch color={RING_LIMIT_COLOR} width={1.8} />}
                  tip={`Walk limit: ${fmtDur(limitS)} of walking there and back, plus one stop. Loops inside it are slopes over ${b.max}°, no entry.`}
                >
                  Walk limit
                </Row>
              )}
            </div>
          )}

          {(showTrack || overlays.pois.on) && (
            <div className="lg-sec">
              {showTrack && (
                <Row
                  sw={
                    <span className="lg-track" style={{ opacity: trackFaded ? 0.45 : 1 }}>
                      <LineSwatch color="#f5f0e6" dash="3 2" casing="rgba(0,0,0,.5)" width={1.6} />
                      <span className="lg-dot" style={{ background: "#f5f0e6" }} />
                    </span>
                  }
                  tip={`Curiosity's localized drive${lastSol ? ` to sol ${lastSol}` : ""}. ${trackFaded ? "Faded while planning." : "Click a stop for photos."}`}
                >
                  Curiosity
                </Row>
              )}
              {overlays.pois.on &&
                POI_KEY.map(([color, label, tip]) => (
                  <Row key={label} sw={<span className={`lg-dot ${label === "Start spot" ? "sq" : ""}`} style={{ background: color }} />} tip={tip}>
                    {label}
                  </Row>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
