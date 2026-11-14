import { useEffect, useMemo, useRef } from "react";
import type { LonLat } from "@marsmap/core";
import { selectedResult, usableTimeS, useStore } from "../store";
import { routePoints } from "../engine";
import { buildTimeline, pointNames, positionAt } from "../lib";
import { bearingDeg, cellIndex, marsDistanceM, nearestOnLine, offsetLonLat } from "../geo";
import { fmtClock, fmtDist, fmtDur, fmtEnergy } from "../format";
import { getMap } from "../map/MapView";

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

  // Keep the walker in view.
  useEffect(() => {
    const map = getMap();
    if (!map || !go.position || go.mode === "off") return;
    const b = map.getBounds();
    if (!b.contains(go.position)) map.easeTo({ center: go.position, duration: 400 });
  }, [go.position, go.mode]);

  if (go.mode === "off") return null;
  if (!r || !tl || !rp) {
    return (
      <div className="go-panel">
        <div className="small">No route to follow.</div>
        <button className="btn" onClick={() => setGo({ mode: "off" })}>
          Close
        </button>
      </div>
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
  const energyLeft = params.energyBudgetKJ * (1 - params.reserveFraction) - energyUsed;
  const cell = cellIndex(area.layers.grid, here);
  const homeS = reach && cell != null ? reach.backTimeS[cell] : undefined;
  const homeE = reach && cell != null ? reach.backEnergyKJ[cell] : undefined;
  const turnBack = homeS != null && Number.isFinite(homeS) && (timeLeft < homeS || (homeE != null && energyLeft < homeE));
  const brg = bearingDeg(here, nextPt);

  return (
    <div className="go-panel">
      <div className="go-head">
        <span className="badge sim">{go.mode === "sim" ? "SIMULATED POSITION" : "YOUR LOCATION, MAPPED ONTO MARS"}</span>
        <button className="icon-btn" onClick={() => setGo({ mode: "off", playing: false, position: null })} title="Stop">
          ×
        </button>
      </div>
      <div className="go-clock">{fmtClock(go.elapsedS)}</div>
      <div className="go-sub">{done ? "Walk complete" : pos?.dwelling ? `Working at ${names[seg + 1] ?? "stop"}` : `Next: ${names[Math.min(nextIdx, names.length - 1)] ?? "end"}`}</div>
      {!done && (
        <div className="go-grid">
          <div>
            <span>To next</span>
            <b>{fmtDist(marsDistanceM(here, nextPt))}</b>
          </div>
          <div>
            <span>Bearing</span>
            <b>
              {Math.round(brg)}° {COMPASS[Math.round(brg / 45) % 8]}
            </b>
          </div>
          <div>
            <span>Time left</span>
            <b className={timeLeft < 0 ? "bad" : ""}>{fmtDur(timeLeft)}</b>
          </div>
          <div>
            <span>Energy left</span>
            <b className={energyLeft < 0 ? "bad" : ""}>{fmtEnergy(energyLeft)}</b>
          </div>
          <div>
            <span>Walk home</span>
            <b>{homeS != null && Number.isFinite(homeS) ? fmtDur(homeS) : "—"}</b>
          </div>
          {go.mode === "gps" && (
            <div>
              <span>GPS ±</span>
              <b>{go.gpsAccuracyM != null ? `${Math.round(go.gpsAccuracyM)} m` : "…"}</b>
            </div>
          )}
        </div>
      )}
      {turnBack && !done && <div className="alert bad">Turn back: remaining budget is less than the walk home from here.</div>}
      {go.mode === "gps" && go.offRouteM != null && go.offRouteM > OFF_ROUTE_M && <div className="alert warn">Off route by {Math.round(go.offRouteM)} m</div>}
      {go.gpsError && <div className="alert bad">{go.gpsError}</div>}
      {go.mode === "sim" && (
        <div className="go-controls">
          <button className="btn" onClick={() => setGo(done ? { elapsedS: 0, playing: true } : { playing: !go.playing })}>
            {done ? "↺ Replay" : go.playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <div className="seg-ctl">
            {SPEEDS.map((s) => (
              <button key={s} className={go.speed === s ? "active" : ""} onClick={() => setGo({ speed: s })}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function measureLen(tl: ReturnType<typeof buildTimeline>, seg: number) {
  const a = Math.max(0, tl.segStartIdx[seg]! - (seg > 0 ? 1 : 0));
  const b = seg + 1 < tl.segStartIdx.length ? tl.segStartIdx[seg + 1]! - 1 : tl.line.pts.length - 1;
  return (tl.line.cum[b] ?? 0) - (tl.line.cum[a] ?? 0);
}
