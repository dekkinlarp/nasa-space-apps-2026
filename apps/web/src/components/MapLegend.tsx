import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { selectedResult, useStore } from "../store";
import { fmtDur } from "../format";
import { getMap, isTrackFaded, RELAYOUT_LABELS, scienceLayers, scienceRamp } from "../map/MapView";
import { cssGradient } from "../map/rasters";
import { CONTOUR_COLOR, CONTOUR_FINE_M, CONTOUR_INDEX_M, CONTOUR_MID_M } from "../map/contours";
import { ROUTE_TICK_M, slopeBands } from "../map/routeSlope";
import { ChevronDownIcon } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { POI_DOT } from "./Cards";
import { cn } from "@/lib/utils";
import { STOP_BADGE, STOP_BADGE_NUMBER, STOP_BADGE_START } from "../map/mapLabel";

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

/** The pins and waypoints in miniature: the same lit dome as on the map. */
const dot = "inline-block size-[9px] rounded-full shadow-dome-sm";
/** The start and stop markers in miniature: the same badge as on the map and in the Plan tab. */
const marker = cn(STOP_BADGE, "size-4 rounded-sm text-[9px]");

function Row({ sw, children, tip }: { sw: ReactNode; children: ReactNode; tip?: string }) {
  return (
    <div className="mb-1 flex cursor-help items-center gap-2" title={tip}>
      <span className="flex min-h-3.5 w-7 flex-none items-center justify-center">{sw}</span>
      <span className="whitespace-nowrap text-foreground">{children}</span>
    </div>
  );
}

/** Whether the key is open. Shared, because its button is in the status bar and its panel floats beside the bar. */
const useLegendUi = create<{ open: boolean; toggle: () => void }>((set, get) => ({
  open: (() => {
    try {
      return localStorage.getItem(LS_KEY) === "1";
    } catch {
      return false;
    }
  })(),
  toggle: () => {
    const open = !get().open;
    set({ open });
    try {
      localStorage.setItem(LS_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  },
}));

/**
 * The key's button, in the status bar. On the bottom sheet the key opens from the button itself. On wide screens
 * the bar is glass, and a panel inside it could not blur the map (a blur nested in a blurred element only sees that
 * element), so there the bar's wrapper renders MapLegendPanel beside the bar and this is `detached`.
 */
export function MapLegend({ detached = false }: { detached?: boolean }) {
  const open = useLegendUi((u) => u.open);
  const toggle = useLegendUi((u) => u.toggle);
  return (
    <div className="relative flex-none">
      <button
        className="-mx-1 flex h-7 cursor-pointer items-center gap-1 rounded-sm px-1 text-xs font-medium text-foreground coarse:px-2"
        onClick={toggle}
        aria-expanded={open}
        title={open ? "Hide map key" : "Show what the lines and markers mean"}
      >
        <span>Key</span>
        <ChevronDownIcon className={cn("size-3 text-muted-foreground transition-transform", !open && "rotate-180")} aria-hidden />
      </button>
      {/* Inside the sheet it opens over the sheet's own glass, so it is solid there. */}
      {!detached && <MapLegendPanel className="absolute bottom-full -left-2.5 z-4 mb-2.5 bg-popover!" />}
    </div>
  );
}

/** The key itself: the lines and markers drawn on the map. Shows only what is on screen. */
export function MapLegendPanel({ className }: { className?: string }) {
  const open = useLegendUi((u) => u.open);
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
  const sci = useStore((s) => s.sci);
  // The mineral layers that are switched on, each with the colour ramp it is drawn in.
  const minerals = scienceLayers(area).filter((l) => sci[l.id]?.on);

  const sel = selectedResult({ results, selectedProfile });
  // The key changes size with its content: let the ring labels move out from under it.
  useEffect(() => {
    const id = requestAnimationFrame(() => getMap()?.fire(RELAYOUT_LABELS));
    return () => cancelAnimationFrame(id);
  }, [open, tab, !!sel, !!rings?.length, overlays.rings.on, overlays.contours.on, overlays.track.on, overlays.pois.on, !!start, stops.length > 0, minerals.length]);
  const b = slopeBands(params);
  const alts = (results ?? []).filter((r) => r.profile.id !== sel?.profile.id);
  const showRings = !!rings?.length && overlays.rings.on;
  const ringBudgets = (rings ?? []).map((r) => r.budgetS).sort((x, y) => x - y);
  const limitS = ringBudgets[ringBudgets.length - 1];
  const showTrack = !!area.rover.traverse && overlays.track.on;
  const lastSol = area.rover.waypoints.reduce((m, w) => Math.max(m, w.sol ?? 0), 0);
  const trackFaded = isTrackFaded(tab, overlays.track);

  if (!open) return null;
  return (
        <Panel className={cn("map-legend scrollbar-thin max-h-[min(60dvh,440px)] w-max max-w-[240px] min-w-[164px] overflow-y-auto px-3 py-2 text-sm text-foreground sheet:max-h-[34dvh]", className)}>
          {sel && (
            <Section title="Route">
              <Row sw={<LineSwatch color="var(--ink)" casing="#000" width={3} />} tip={`The chosen route. A bar crosses it every ${ROUTE_TICK_M} m.`}>
                Chosen route
              </Row>
              <Row sw={<LineSwatch color="var(--warn)" casing="#000" width={3} />} tip={`The route crosses hazard slope here: ${b.caution}° or steeper underfoot.`}>
                Hazard slope, from {b.caution}°
              </Row>
              <Row sw={<LineSwatch color="var(--bad)" casing="#000" width={3} />} tip={`The route is at the no-go slope here. Ground over ${b.max}° is not walked at all.`}>
                No-go slope, {b.max}°
              </Row>
              {alts.length > 0 && (
                <Row sw={<LineSwatch color="var(--ink-2)" casing="#000" width={1.5} />} tip="The other route options. Point at a route in the Plan tab's table to pick its line out.">
                  Other routes
                </Row>
              )}
              {sel.totals.firstSegmentOverLimit != null && (
                <Row sw={<LineSwatch color="var(--bad)" dash="3 3" casing="#000" width={3} />} tip="Legs walked after the EVA time, energy or oxygen limit is used up">
                  Past limit
                </Row>
              )}
            </Section>
          )}

          {(start || stops.length > 0) && (
            <Section>
              {start && (
                <Row sw={<span className={cn(marker, STOP_BADGE_START)}>S</span>} tip="Start point. Drag it on the map to move it.">
                  Start
                </Row>
              )}
              {stops.length > 0 && (
                <Row sw={<span className={cn(marker, STOP_BADGE_NUMBER)}>1</span>} tip="Stops, numbered in walking order. Drag to move.">
                  Stops
                </Row>
              )}
            </Section>
          )}

          {showRings && (
            <Section>
              {ringBudgets.length > 1 && (
                <Row
                  sw={<LineSwatch color="var(--ink)" dash="1.6 3" casing="rgba(0,0,0,.45)" width={1.25} />}
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
                  sw={<LineSwatch color="var(--warn)" width={1.8} />}
                  tip={`Walk limit: ${fmtDur(limitS)} of walking there and back, plus one stop. Loops inside it are slopes over ${b.max}°, no entry.`}
                >
                  Walk limit
                </Row>
              )}
              {clipped && (
                <Row
                  sw={<LineSwatch color="var(--warn)" dash="1 3" width={1.8} />}
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
                sw={
                  <svg className="block" width="26" height="10" viewBox="0 0 26 10" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="square" aria-hidden>
                    <path d="M5 8.5V1.5h5M21 8.5V1.5h-5" />
                  </svg>
                }
                tip="Brackets at the corners of the 8 km square of 2 m ground loaded around the walk. Routes and walk limits are worked out on it. Elsewhere the map shows a 16 m overview. The square follows the start and stops."
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

          {minerals.length > 0 && (
            <Section>
              {minerals.map((l) => (
                <Row
                  key={l.id}
                  sw={<span className="block h-2.5 w-[26px] rounded-[1px] shadow-dome-sm" style={{ background: cssGradient(scienceRamp(area, l.id)), opacity: sci[l.id]?.opacity ?? 1 }} />}
                  tip={`Seen from orbit (CRISM${area.minerals ? `, ${area.minerals.pixelM} m pixels` : ""}), weak on the left to strong on the right. Sand or dust hides minerals from orbit, so bare ground does not mean none.`}
                >
                  {(l.name ?? l.id).replace(/\s*\(.*$/, "")}
                </Row>
              ))}
            </Section>
          )}

          {(showTrack || overlays.pois.on) && (
            <Section>
              {showTrack && (
                <Row
                  sw={
                    <span className="relative block h-2.5 w-[26px]" style={{ opacity: trackFaded ? 0.45 : 1 }}>
                      <LineSwatch color="var(--poi-rover)" casing="rgba(0,0,0,.5)" width={1.25} />
                      <span className={cn(dot, "absolute top-px left-[9px]")} style={{ background: "var(--poi-rover)" }} />
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
        </Panel>
  );
}
