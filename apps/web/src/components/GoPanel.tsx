import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { oxygenUsedKg, type LonLat } from "@marsmap/core";
import { selectedResult, usableTimeS, useStore } from "../store";
import { routePoints } from "../engine";
import { buildTimeline, pointNames, positionAt } from "../lib";
import { bearingDeg, cellIndex, marsDistanceM, nearestOnLine, offsetLonLat } from "../geo";
import { fmtClock, fmtDist, fmtDur, fmtEnergy, fmtO2 } from "../format";
import { FollowToggle } from "./GoWalker";
import { ChevronUpIcon, PauseIcon, PlayIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { MiniBar } from "@/components/ui/mini-bar";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/** It floats at the top left of the map, clear of the route's foot and the view controls. On the bottom-sheet
    layout it takes the row above the sheet instead, and replaces the POI card and the hover readout. */
// sheet:mt-2: on the bottom-sheet layout the view controls wrap onto a line above, and this is the space between.
const GO_PANEL = "go-panel w-80 max-w-full flex-none sheet:mt-2 sheet:w-auto sheet:flex-1";
/** Docked: a section of the side panel, under its tabs, on the side panel's own glass. */
const GO_DOCKED = "go-panel pointer-events-auto flex-none border-b text-foreground";

/** The header's buttons: raised, like the side panel's other buttons, and the same in both states so they never move. */
const HEAD_BTN = "size-7 text-ink-2 coarse:size-9 [&_svg:not([class*='size-'])]:size-3.5";

const SPEEDS = [30, 120, 600, 1800];
const OFF_ROUTE_M = 25;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * `startFolded`: each walk opens as the single row (the bottom-sheet layout, where the full panel and the open
 * sheet together leave no map). `onExpand` is told when the planner unfolds it, so the sheet can make room.
 * `docked`: drawn as a section of the side panel, under its tabs, instead of floating over the map.
 */
export function GoPanel({ startFolded = false, onExpand, docked = false }: { startFolded?: boolean; onExpand?: () => void; docked?: boolean } = {}) {
  const go = useStore((s) => s.go);
  const setGo = useStore((s) => s.setGo);
  const results = useStore((s) => s.results);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const start = useStore((s) => s.start);
  const stops = useStore((s) => s.stops);
  const returnToStart = useStore((s) => s.returnToStart);
  const params = useStore((s) => s.params)!;
  const reach = useStore((s) => s.reach);
  const area = useStore((s) => s.area)!;
  const r = selectedResult({ results, selectedProfile });
  const rp = routePoints(start, stops, returnToStart);
  const tl = useMemo(() => (r && rp ? buildTimeline(r, rp.dwellS) : null), [r, rp?.dwellS.join(",")]);
  const names = pointNames(start, stops, returnToStart);
  const raf = useRef<number>(0);
  // Folded, the panel is a single row.
  const [collapsed, setCollapsed] = useState(startFolded);
  const walking = go.mode !== "off";
  useEffect(() => {
    if (walking) setCollapsed(startFolded);
  }, [walking, startFolded]);

  // ---------- simulated walk ----------
  useEffect(() => {
    if (go.mode !== "sim" || !go.playing || !tl) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const g = useStore.getState().go;
      const e = Math.min(tl.totalS, g.elapsedS + dt * g.speed);
      const pos = positionAt(tl, e);
      setGo({ elapsedS: e, alongM: pos.along, position: pos.p, playing: e < tl.totalS });
      if (e < tl.totalS) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [go.mode, go.playing, tl, setGo]);

  // ---------- real location, offset onto the Mars start ----------
  useEffect(() => {
    if (go.mode !== "gps" || !start || !tl) return;
    if (!("geolocation" in navigator)) {
      setGo({ gpsError: "This browser has no geolocation." });
      return;
    }
    if (!window.isSecureContext) {
      setGo({ gpsError: "Location needs HTTPS (or localhost). Open the app over HTTPS on a phone." });
      return;
    }
    let origin: { lat: number; lon: number } | null = null;
    let smooth: LonLat | null = null;
    const t0 = performance.now();
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, accuracy } = p.coords;
        if (!origin) origin = { lat: latitude, lon: longitude };
        // Earth metres from the first fix -> Mars metres from the start.
        const northM = (latitude - origin.lat) * 111320;
        const eastM = (longitude - origin.lon) * 111320 * Math.cos((origin.lat * Math.PI) / 180);
        const raw = offsetLonLat(start.lonLat, eastM, northM);
        smooth = smooth ? [smooth[0] + (raw[0] - smooth[0]) * 0.35, smooth[1] + (raw[1] - smooth[1]) * 0.35] : raw;
        const near = nearestOnLine(tl.line, smooth);
        setGo({ position: smooth, alongM: near.along, offRouteM: near.offM, gpsAccuracyM: accuracy, gpsError: null, elapsedS: (performance.now() - t0) / 1000 });
      },
      (err) => setGo({ gpsError: err.message || "Location permission denied." }),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [go.mode, start, tl, setGo]);

  // Camera follow (and the walker itself) live in GoWalker.

  if (go.mode === "off") return null;
  if (!r || !tl || !rp) {
    return (
      <Shell docked={docked} size="lg" className={cn(docked ? GO_DOCKED : GO_PANEL, "grid gap-2 p-4")}>
        <div className="text-sm">No route to follow.</div>
        <Button variant="secondary" onClick={() => setGo({ mode: "off" })}>
          Close
        </Button>
      </Shell>
    );
  }

  const pos = go.mode === "sim" ? positionAt(tl, go.elapsedS) : null;
  const seg = pos?.seg ?? (() => {
    let s = 0;
    for (let i = 0; i < tl.segStartIdx.length; i++) if (tl.line.cum[tl.segStartIdx[i]!]! <= go.alongM) s = i;
    return s;
  })();
  const nextIdx = pos?.dwelling ? seg + 2 : seg + 1;
  const nextPt = rp.points[Math.min(nextIdx, rp.points.length - 1)]!;
  const here = go.position ?? start!.lonLat;
  const done = go.mode === "sim" && go.elapsedS >= tl.totalS;
  const usable = usableTimeS(params);
  const timeLeft = usable - go.elapsedS;
  // Energy so far: segments fully walked plus the walked fraction of the current one.
  let energyUsed = 0;
  for (let i = 0; i < r.segments.length; i++) {
    const s = r.segments[i]!;
    const segStartAlong = tl.line.cum[Math.max(0, tl.segStartIdx[i]! - (i > 0 ? 1 : 0))] ?? 0;
    const f = s.distanceM > 0 ? Math.max(0, Math.min(1, (go.alongM - segStartAlong) / Math.max(1, measureLen(tl, i)))) : 1;
    energyUsed += s.energyKJ * f;
  }
  const usableE = params.energyBudgetKJ * (1 - params.reserveFraction);
  const energyLeft = usableE - energyUsed;
  const cell = reach ? cellIndex(reach.grid, here) : null;
  const homeS = reach && cell != null ? reach.backTimeS[cell] : undefined;
  const homeE = reach && cell != null ? reach.backEnergyKJ[cell] : undefined;
  const o2On = (params.o2BudgetKg ?? 0) > 0 && (params.o2KgPerKJ ?? 0) > 0;
  const usableO = (params.o2BudgetKg ?? 0) * (1 - params.reserveFraction);
  const o2Left = usableO - oxygenUsedKg(params, go.elapsedS, energyUsed);
  const homeO2 = homeS != null && homeE != null && Number.isFinite(homeS) ? oxygenUsedKg(params, homeS, homeE) : undefined;
  const turnBack =
    homeS != null && Number.isFinite(homeS) && (timeLeft < homeS || (homeE != null && energyLeft < homeE) || (o2On && homeO2 != null && o2Left < homeO2));
  const brg = bearingDeg(here, nextPt);
  // While the crew works at a stop, what they are there to do: the place's own crew task.
  const workStop = pos?.dwelling ? stops[seg] : undefined;
  const workPoi = workStop?.poiId ? area.config.pois.find((p) => p.id === workStop.poiId) : undefined;
  const task = workStop ? (workPoi?.humanCan?.trim() || workPoi?.summary || "Custom stop: observe and sample").replace(/\.$/, "") : null;
  const status = done ? "Walk complete" : pos?.dwelling ? `Working at ${names[seg + 1] ?? "stop"}` : `Next: ${names[Math.min(nextIdx, names.length - 1)] ?? "end"}`;
  const playLabel = done ? "Replay" : go.playing ? "Pause" : "Play";
  const togglePlay = () => setGo(done ? { elapsedS: 0, playing: true } : { playing: !go.playing });

  return (
    // Folded it is a bar the size and material of the sidebar button it sits beside (glass Button, icon-lg).
    // The header row is the same row folded and unfolded, so its buttons never move: only what is under it changes.
    <Shell
      docked={docked}
      size={collapsed ? "default" : "lg"}
      className={cn(docked ? GO_DOCKED : GO_PANEL, docked ? "pr-2.5 pl-4" : "pr-1.5 pl-3", !docked && collapsed && "inset-shadow-[0_1px_0_rgba(255,255,255,0.1)]")}
    >
      <div className={cn("flex min-w-0 items-center gap-1.5", docked ? "h-10" : "h-9 coarse:h-11")}>
        {collapsed ? (
          <>
            <span className="flex-none text-sm text-sim tabular-nums">{fmtClock(go.elapsedS)}</span>
            <span className="mr-auto min-w-0 truncate pl-1 text-xs text-ink-2">{status}</span>
          </>
        ) : (
          // Plain text in the simulated-position colour: the same colour as the walker and its line on the map.
          <span className="mr-auto min-w-0 truncate text-xs text-sim">{go.mode === "sim" ? "Simulated position" : "Your location, mapped onto Mars"}</span>
        )}
        {go.mode === "sim" && (
          <Button variant="secondary" size="icon-sm" className={HEAD_BTN} onClick={togglePlay} title={playLabel} aria-label={playLabel}>
            {done ? <RotateCcwIcon /> : go.playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
        )}
        <FollowToggle compact className={HEAD_BTN} />
        <Button
          variant="secondary"
          size="icon-sm"
          className={HEAD_BTN}
          onClick={() => {
            if (collapsed) onExpand?.();
            setCollapsed(!collapsed);
          }}
          aria-expanded={!collapsed}
          title={collapsed ? "Show details" : "Hide details"}
          aria-label={collapsed ? "Show walk details" : "Hide walk details"}
        >
          <ChevronUpIcon className={cn("transition-transform", collapsed && "rotate-180")} />
        </Button>
        <Button variant="secondary" size="icon-sm" className={HEAD_BTN} onClick={() => setGo({ mode: "off", playing: false, position: null })} title="Stop" aria-label="Stop the walk">
          <XIcon />
        </Button>
      </div>
      {/* Under the header: the details when unfolded, and the warnings either way. The panel's right padding is
          narrower so the header's last button sits near the edge; pr-1.5 here evens the two sides. */}
      <div className="pr-1.5 pb-4 empty:hidden phone:pb-3">
        {!collapsed && (
          <>
            {/* The clock, then one line for what is happening now and, while the crew works at a stop, their task. */}
            <div className="text-2xl leading-tight font-normal tracking-[-0.02em] tabular-nums">{fmtClock(go.elapsedS)}</div>
            <div className="truncate text-sm text-ink-2">{status}</div>
            {task && !done && (
              <div className="truncate text-xs text-muted-foreground" title={task}>
                {task}
              </div>
            )}
          </>
        )}
        {!done && !collapsed && (
          <div className="mt-2.5 text-xs">
            {/* What is left of each budget, on the plain meters the Plan tab uses. */}
            <MiniBar label="Time" f={go.elapsedS / (usable || 1)} value={fmtDur(timeLeft)} />
            <MiniBar label="Energy" f={energyUsed / (usableE || 1)} value={fmtEnergy(energyLeft)} />
            {o2On && <MiniBar label="O₂" f={1 - o2Left / (usableO || 1)} value={fmtO2(o2Left)} />}
            {/* Where to head next and how far home is, side by side. */}
            <div className="mt-2 flex items-baseline justify-between gap-3 text-muted-foreground">
              <span className="truncate">
                Next <span className="text-foreground">{fmtDist(marsDistanceM(here, nextPt))} {COMPASS[Math.round(brg / 45) % 8]}</span>
              </span>
              <span className="flex-none">
                Home <span className="text-foreground">{homeS != null && Number.isFinite(homeS) ? fmtDur(homeS) : "—"}</span>
              </span>
            </div>
            {go.mode === "gps" && <div className="mt-1 text-muted-foreground">GPS accurate to {go.gpsAccuracyM != null ? `±${Math.round(go.gpsAccuracyM)} m` : "…"}</div>}
          </div>
        )}
        {turnBack && !done && <Alert variant="destructive">Turn back: remaining budget is less than the walk home from here.</Alert>}
        {go.mode === "gps" && go.offRouteM != null && go.offRouteM > OFF_ROUTE_M && <Alert variant="warning">Off route by {Math.round(go.offRouteM)} m</Alert>}
        {go.gpsError && <Alert variant="destructive">{go.gpsError}</Alert>}
        {go.mode === "sim" && !collapsed && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Speed</span>
            <Segmented
              aria-label="Playback speed"
              value={String(go.speed)}
              onValueChange={(v) => setGo({ speed: Number(v) })}
              options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
              itemClassName="px-[7px]"
            />
          </div>
        )}
      </div>
    </Shell>
  );
}

/** A floating glass Panel, or, docked in the side panel, a plain section on the side panel's glass. */
function Shell({ docked, size, className, children }: { docked: boolean; size: "default" | "lg"; className: string; children: ReactNode }) {
  if (docked)
    return (
      <section className={className} aria-label="Walk">
        {children}
      </section>
    );
  return (
    <Panel size={size} className={className}>
      {children}
    </Panel>
  );
}

function measureLen(tl: ReturnType<typeof buildTimeline>, seg: number) {
  const a = Math.max(0, tl.segStartIdx[seg]! - (seg > 0 ? 1 : 0));
  const b = seg + 1 < tl.segStartIdx.length ? tl.segStartIdx[seg + 1]! - 1 : tl.line.pts.length - 1;
  return (tl.line.cum[b] ?? 0) - (tl.line.cum[a] ?? 0);
}
