import { useEffect, useState, type ReactNode } from "react";
import { selectedResult, useStore } from "../store";
import { fmtDur } from "../format";
import { getMap, isTrackFaded, profileColor, RELAYOUT_LABELS, RING_COLOR, RING_LIMIT_COLOR } from "../map/MapView";
import { CONTOUR_COLOR, CONTOUR_FINE_M, CONTOUR_INDEX_M, CONTOUR_MID_M } from "../map/contours";
import { ROUTE_SLOPE_COLORS, slopeBands } from "../map/routeSlope";
import { ChevronDownIcon } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { POI_DOT } from "./Cards";
import { cn } from "@/lib/utils";

/** v2: the key now starts collapsed; an "open" choice saved by older builds is ignored. */
const LS_KEY = "marsmap.legendOpen.v2";

/** A short line sample, optionally dashed, with a dark casing like the map lines. */
function LineSwatch({ color, dash, casing, width = 3, opacity = 1 }: { color: string; dash?: string; casing?: string; width?: number; opacity?: number }) {
  return (
    <svg className="block" width="26" height="10" viewBox="0 0 26 10" aria-hidden>
      {casing && <line x1="2" y1="5" x2="24" y2="5" stroke={casing} strokeWidth={width + 3} strokeLinecap="round" />}
      <line x1="2" y1="5" x2="24" y2="5" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap={dash ? "butt" : "round"} opacity={opacity} />
    </svg>
  );
}

/** [dot colour, label, tooltip]: the same colours as the pins on the map. */
const POI_KEY: [string, string, string][] = [
  [POI_DOT["drill-site"]!, "Drill site", "Where Curiosity drilled a sample"],
  [POI_DOT["science-target"]!, "Target", "Science target a crew could visit"],
  [POI_DOT.viewpoint!, "Viewpoint", "Viewpoint over the boxwork"],
  [POI_DOT.start!, "Start spot", "Suggested start: a past Curiosity stop"],
];

/** A group of key rows, ruled off from the one above. */
function Section({ title, tip, children }: { title?: string; tip?: string; children: ReactNode }) {
  return (
    <div className="border-t pt-1.5 pb-0.5 first:border-t-0 first:pt-0" title={tip}>
      {title && <div className="mb-1 text-xs text-muted-foreground">{title}</div>}
      {children}
    </div>
  );
}

const dot = "inline-block size-[9px] rounded-full border-[1.5px] border-[#1a1210] shadow-[0_0_0_1px_rgba(255,255,255,.15)]";
const marker = "grid size-4 place-items-center border-[1.5px] border-white text-[9px] font-extrabold text-white shadow-[0_1px_4px_rgba(0,0,0,.6)]";

function Row({ sw, children, tip }: { sw: ReactNode; children: ReactNode; tip?: string }) {
  return (
    <div className="mb-1 flex cursor-help items-center gap-2" title={tip}>
      <span className="flex min-h-3.5 w-7 flex-none items-center justify-center">{sw}</span>
      <span className="whitespace-nowrap text-foreground">{children}</span>
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
  const clipped = useStore((s) => !!s.reach?.clipped && !!s.area?.tiles);
  const windowOn = useStore((s) => !!s.area?.tiles && !!s.detail);
  const start = useStore((s) => s.start);
  const stops = useStore((s) => s.stops);
  const area = useStore((s) => s.area)!;

  const sel = selectedResult({ results, selectedProfile });
  // The key changes size with its content: let the ring labels move out from under it.
  useEffect(() => {
    const id = requestAnimationFrame(() => getMap()?.fire(RELAYOUT_LABELS));
    return () => cancelAnimationFrame(id);
  }, [open, tab, !!sel, !!rings?.length, overlays.rings.on, overlays.contours.on, overlays.track.on, overlays.pois.on, !!start, stops.length > 0]);
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
    <Panel className={cn("map-legend scrollbar-thin z-4 max-h-[min(60dvh,440px)] flex-none overflow-y-auto text-sm sheet:max-h-[38dvh]", open ? "w-[164px]" : "w-auto")}>
      <button
        className="flex h-[42px] w-full cursor-pointer items-center justify-between gap-2 px-3 text-sm font-medium text-foreground"
        onClick={toggle}
        aria-expanded={open}
        title={open ? "Hide map key" : "Show what the lines and markers mean"}
      >
        <span>Key</span>
        <ChevronDownIcon className={cn("size-3 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden />
      </button>
      {open && (
        <div className="px-3 pb-2">
          {sel && (
            <Section title="Route slope" tip={`Route coloured by slope underfoot. Hazard from ${b.caution}°, no entry over ${b.max}°.`}>
              <div className="m-0.5 flex h-1.5 overflow-hidden rounded-[3px] shadow-[0_0_0_2px_#120c0a]">
                <span className="flex-1" style={{ background: C.easy }} />
                <span className="flex-1" style={{ background: C.moderate }} />
                <span className="flex-1" style={{ background: C.caution }} />
                <span className="flex-1" style={{ background: C.limit }} />
              </div>
              <div className="relative mx-0.5 mb-1 h-3.5 text-xs text-muted-foreground *:absolute *:-translate-x-1/2">
                <span style={{ left: "25%" }}>{b.easyBelow}°</span>
                <span style={{ left: "50%" }}>{b.caution}°</span>
                <span style={{ left: "75%" }}>{b.max}°</span>
              </div>
              {alts.length > 0 && (
                <Row
                  sw={
                    <span className="flex flex-col items-center gap-px">
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
            </Section>
          )}

          {(start || stops.length > 0) && (
            <Section>
              {start && (
                <Row sw={<span className={cn(marker, "rounded-sm bg-[#1f8a4c]")}>S</span>} tip="Start point. Drag it on the map to move it.">
                  Start
                </Row>
              )}
              {stops.length > 0 && (
                <Row sw={<span className={cn(marker, "rounded-full bg-mars-deep")}>1</span>} tip="Stops, numbered in walking order. Drag to move.">
                  Stops
                </Row>
              )}
            </Section>
          )}

          {showRings && (
            <Section>
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
              {clipped && (
                <Row
                  sw={<LineSwatch color={RING_LIMIT_COLOR} dash="1 3" width={1.8} />}
                  tip="This walk reaches past the 8 km square of full-resolution ground loaded around it, so the rings stop at that square's edge. Move the start, or add a stop, to shift the square."
                >
                  Cut at planning window
                </Row>
              )}
            </Section>
          )}

          {windowOn && (
            <Section>
              <Row
                sw={<LineSwatch color="rgba(255,255,255,.75)" dash="4 3" width={1.2} />}
                tip="Routes and walk limits are worked out on 2 m ground loaded for this 8 km square around the walk. Elsewhere the map shows a 16 m overview. The square follows the start and stops."
              >
                Planning window
              </Row>
            </Section>
          )}

          {overlays.contours.on && !!area.overview.elevation && (
            <Section>
              <Row
                sw={<LineSwatch color={CONTOUR_COLOR} width={1.3} opacity={overlays.contours.opacity} />}
                tip={
                  area.tiles
                    ? `Lines of equal elevation: every ${CONTOUR_MID_M} m, heavier every ${CONTOUR_INDEX_M} m. Zoomed in on the planning window: every ${CONTOUR_FINE_M} m, heavier every ${CONTOUR_MID_M} m.`
                    : `Lines of equal elevation: every ${CONTOUR_FINE_M} m, heavier every ${CONTOUR_MID_M} m.`
                }
              >
                Contours
              </Row>
            </Section>
          )}

          {(showTrack || overlays.pois.on) && (
            <Section>
              {showTrack && (
                <Row
                  sw={
                    <span className="relative block h-2.5 w-[26px]" style={{ opacity: trackFaded ? 0.45 : 1 }}>
                      <LineSwatch color="#f5f0e6" dash="3 2" casing="rgba(0,0,0,.5)" width={1.6} />
                      <span className={cn(dot, "absolute top-px left-[9px]")} style={{ background: "#f5f0e6" }} />
                    </span>
                  }
                  tip={`Curiosity's localized drive${lastSol ? ` to sol ${lastSol}` : ""}. ${trackFaded ? "Faded while planning." : "Click a stop for photos."}`}
                >
                  Curiosity
                </Row>
              )}
              {overlays.pois.on &&
                POI_KEY.map(([cls, label, tip]) => (
                  <Row key={label} sw={<span className={cn(dot, cls, label === "Start spot" && "rounded-[2px]")} />} tip={tip}>
                    {label}
                  </Row>
                ))}
            </Section>
          )}
        </div>
      )}
    </Panel>
  );
}
