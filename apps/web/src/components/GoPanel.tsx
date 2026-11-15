import { useEffect, useMemo, useRef } from "react";
import { oxygenUsedKg, type LonLat } from "@marsmap/core";
import { selectedResult, usableTimeS, useStore } from "../store";
import { routePoints } from "../engine";
import { buildTimeline, pointNames, positionAt } from "../lib";
import { bearingDeg, cellIndex, marsDistanceM, nearestOnLine, offsetLonLat } from "../geo";
import { fmtClock, fmtDist, fmtDur, fmtEnergy, fmtO2 } from "../format";
import { FollowToggle } from "./GoWalker";
import { XIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MiniBar } from "@/components/ui/mini-bar";
import { Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/** On the bottom-sheet layout the Go panel takes the row and replaces the POI card and the hover readout. */
// sheet:mt-2: on the bottom-sheet layout the view controls wrap onto a line above, and this is the space between.
const GO_PANEL = "go-panel w-80 max-w-full flex-none sheet:mt-2 sheet:w-auto sheet:flex-1";

const SPEEDS = [30, 120, 600, 1800];
const OFF_ROUTE_M = 25;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function GoPanel() {
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
      <Panel size="lg" className={cn(GO_PANEL, "grid gap-2 p-4")}>
        <div className="text-sm">No route to follow.</div>
        <Button variant="secondary" onClick={() => setGo({ mode: "off" })}>
          Close
        </Button>
      </Panel>
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

  return (
    <Panel size="lg" className={cn(GO_PANEL, "p-4 phone:p-3")}>
      <div className="flex items-center gap-1.5">
        {/* Plain text in the simulated-position colour: the same colour as the walker and its line on the map. */}
        <span className="mr-auto min-w-0 truncate text-xs text-sim">{go.mode === "sim" ? "Simulated position" : "Your location, mapped onto Mars"}</span>
        <FollowToggle />
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={() => setGo({ mode: "off", playing: false, position: null })} title="Stop" aria-label="Stop the walk">
          <XIcon />
        </Button>
      </div>
      <div className="mt-2 text-3xl font-normal tracking-[-0.03em] phone:mt-0.5 phone:text-2xl">{fmtClock(go.elapsedS)}</div>
      {/* One line for what is happening now, and under it the crew task while they work at a stop. */}
      <div className="text-ink-2">{done ? "Walk complete" : pos?.dwelling ? `Working at ${names[seg + 1] ?? "stop"}` : `Next: ${names[Math.min(nextIdx, names.length - 1)] ?? "end"}`}</div>
      {task && !done && <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{task}</div>}
      {!done && (
        <div className="mt-2 border-t pt-2 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">To the next point</span>
            <span className="text-sm">
              {fmtDist(marsDistanceM(here, nextPt))} · {Math.round(brg)}° {COMPASS[Math.round(brg / 45) % 8]}
            </span>
          </div>
          {/* What is left of each budget, on the bars the suit meter uses. */}
          <div className="mt-1.5">
            <MiniBar label="Time left" f={go.elapsedS / (usable || 1)} value={fmtDur(timeLeft)} />
            <MiniBar label="Energy left" f={energyUsed / (usableE || 1)} value={fmtEnergy(energyLeft)} />
            {o2On && <MiniBar label="O₂ left" f={1 - o2Left / (usableO || 1)} value={fmtO2(o2Left)} />}
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t pt-1.5">
            <span className="text-muted-foreground">Walk home</span>
            <span className="text-sm">{homeS != null && Number.isFinite(homeS) ? fmtDur(homeS) : "—"}</span>
          </div>
          {go.mode === "gps" && <div className="mt-1 text-muted-foreground">GPS accurate to {go.gpsAccuracyM != null ? `±${Math.round(go.gpsAccuracyM)} m` : "…"}</div>}
        </div>
      )}
      {turnBack && !done && <Alert variant="destructive">Turn back: remaining budget is less than the walk home from here.</Alert>}
      {go.mode === "gps" && go.offRouteM != null && go.offRouteM > OFF_ROUTE_M && <Alert variant="warning">Off route by {Math.round(go.offRouteM)} m</Alert>}
      {go.gpsError && <Alert variant="destructive">{go.gpsError}</Alert>}
      {go.mode === "sim" && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button variant="secondary" onClick={() => setGo(done ? { elapsedS: 0, playing: true } : { playing: !go.playing })}>
            {done ? "Replay" : go.playing ? "Pause" : "Play"}
          </Button>
          <Segmented
            aria-label="Playback speed"
            value={String(go.speed)}
            onValueChange={(v) => setGo({ speed: Number(v) })}
            options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
            itemClassName="px-[7px]"
          />
        </div>
      )}
    </Panel>
  );
}

function measureLen(tl: ReturnType<typeof buildTimeline>, seg: number) {
  const a = Math.max(0, tl.segStartIdx[seg]! - (seg > 0 ? 1 : 0));
  const b = seg + 1 < tl.segStartIdx.length ? tl.segStartIdx[seg + 1]! - 1 : tl.line.pts.length - 1;
  return (tl.line.cum[b] ?? 0) - (tl.line.cum[a] ?? 0);
}
