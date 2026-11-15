/**
 * The Go walker: an animated astronaut that walks the selected route (simulated walk) or follows the
 * user's mapped GPS position. Draws, on the map:
 *  - an upright, screen-facing astronaut marker whose stride follows the walking speed and slope, that
 *    faces the direction of travel, kneels and works at stops (stop name + countdown), and idles at the end;
 *  - a flat direction ring under it, rotated to the heading;
 *  - fading boot prints behind it and a progress line over the walked part of the route;
 * and gently keeps the camera on the walker unless the user turns "Follow" off (or drags the map).
 */
import { useEffect, useMemo } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import { create } from "zustand";
import type { LonLat } from "@marsmap/core";
import { selectedResult, useStore } from "../store";
import { routePoints } from "../engine";
import { buildTimeline, pointNames, positionAt } from "../lib";
import { bearingDeg, marsDistanceM, MARS_RADIUS_M, offsetLonLat } from "../geo";
import { getMap } from "../map/MapView";
import { GROUND_SVG, WALKER_SVG, bootPrintImage } from "./walkerArt";
import { cycleSeconds, headingAlong, lerpAngle, meanSpeed, routePrints, trackPrints, walkedLine, walkerFrame, type Print, type WalkerState } from "./walkerMath";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** UI state for the walker that is not part of the plan: whether the camera follows it. */
export const useWalkerUi = create<{ follow: boolean; setFollow: (f: boolean) => void }>((set) => ({
  follow: true,
  setFollow: (follow) => set({ follow }),
}));

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const BOOT_IMG = "go-boot";
const PRINTS = 36;
/** Zoom the camera in to at least this when a walk starts with Follow on, so the walker reads. */
const FOLLOW_MIN_ZOOM = 16.8;

const metersPerPixel = (map: MLMap, lat: number) => (2 * Math.PI * MARS_RADIUS_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());

function ensureLayers(map: MLMap) {
  if (map.getSource("go-trail")) return;
  const img = bootPrintImage();
  if (img && !map.hasImage(BOOT_IMG)) map.addImage(BOOT_IMG, img, { pixelRatio: 2 });
  const before = map.getLayer("cursor-halo") ? "cursor-halo" : undefined;
  map.addSource("go-done", { type: "geojson", data: EMPTY_FC });
  map.addSource("go-trail", { type: "geojson", data: EMPTY_FC });
  map.addLayer({ id: "go-done-glow", type: "line", source: "go-done", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#36d1c4", "line-width": 9, "line-opacity": 0.22, "line-blur": 3 } }, before);
  map.addLayer({ id: "go-done", type: "line", source: "go-done", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#e9fffc", "line-width": 2.2, "line-opacity": 0.95 } }, before);
  map.addLayer(
    {
      id: "go-trail",
      type: "symbol",
      source: "go-trail",
      layout: {
        "icon-image": BOOT_IMG,
        "icon-rotate": ["get", "rot"],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": 0.6,
      },
      paint: { "icon-opacity": ["*", 0.95, ["get", "fresh"]] },
    },
    before,
  );
}

const printsFC = (ps: Print[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: ps.map((p) => ({ type: "Feature", properties: { rot: p.rot, fresh: p.fresh }, geometry: { type: "Point", coordinates: p.p } })),
});

const mmss = (s: number) => {
  s = Math.max(0, Math.ceil(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

const RING_R = 8, RING_C = 2 * Math.PI * RING_R;
const LABEL_HTML = `<svg class="w-ring" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="${RING_R}" fill="none" stroke="rgba(54,209,196,.25)" stroke-width="3"/><circle cx="10" cy="10" r="${RING_R}" fill="none" stroke="#36d1c4" stroke-width="3" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" transform="rotate(-90 10 10)"/></svg><div><span class="w-l1"></span><small class="w-l2"></small></div>`;

export function GoWalker() {
  const mode = useStore((s) => s.go.mode);
  const results = useStore((s) => s.results);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const start = useStore((s) => s.start);
  const stops = useStore((s) => s.stops);
  const returnToStart = useStore((s) => s.returnToStart);
  const r = selectedResult({ results, selectedProfile });
  const rp = routePoints(start, stops, returnToStart);
  const tl = useMemo(() => (r && rp ? buildTimeline(r, rp.dwellS) : null), [r, rp?.dwellS.join(",")]);
  const namesKey = pointNames(start, stops, returnToStart).join("\u0001");

  useEffect(() => {
    const map = getMap();
    if (!map || mode === "off" || !tl || !r) return;
    const names = namesKey.split("\u0001");
    ensureLayers(map);
    const doneSrc = map.getSource("go-done") as GeoJSONSource;
    const trailSrc = map.getSource("go-trail") as GeoJSONSource;

    // ----- DOM -----
    const el = document.createElement("div");
    el.className = "walker idle";
    el.innerHTML = `<div class="w-label">${LABEL_HTML}</div><div class="w-shadow"></div><div class="w-flip"><div class="w-lean">${WALKER_SVG}</div></div>`;
    const lean = el.querySelector(".w-lean") as HTMLElement;
    const l1 = el.querySelector(".w-l1") as HTMLElement;
    const l2 = el.querySelector(".w-l2") as HTMLElement;
    const ringArc = el.querySelector(".w-ring circle:last-child") as SVGCircleElement;
    const groundEl = document.createElement("div");
    groundEl.className = "walker-ground";
    groundEl.innerHTML = GROUND_SVG;

    const first = useStore.getState().go.position ?? tl.line.pts[0] ?? start?.lonLat ?? [0, 0];
    const ground = new maplibregl.Marker({ element: groundEl, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(first).addTo(map);
    // Feet (y = 66 of the 72-unit tall figure) sit on the point.
    const figure = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, 6], rotationAlignment: "viewport", pitchAlignment: "viewport" }).setLngLat(first).addTo(map);

    // ----- camera follow -----
    const stopFollowOnDrag = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) useWalkerUi.getState().setFollow(false);
    };
    map.on("dragstart", stopFollowOnDrag);
    if (useWalkerUi.getState().follow && map.getZoom() < FOLLOW_MIN_ZOOM) map.easeTo({ center: first, zoom: FOLLOW_MIN_ZOOM, duration: 1200 });

    // ----- per-frame state -----
    const mean = meanSpeed(r);
    let heading = headingAlong(tl, 0, 6) ?? 0;
    let faceLeft = false;
    let cls = "";
    let cycle = 0;
    let leanDeg = NaN;
    let labelKey = "";
    let lastAlong = -1, lastZoom = -1, lastPos: LonLat | null = null;
    const track: { p: LonLat; t: number }[] = [];
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const g = useStore.getState().go;
      let here: LonLat | null;
      let along: number;
      let state: WalkerState;
      let target: number | null = null;
      let cyc = cycleSeconds(1, 0, 1);
      let grade = 0;
      let label: [string, string, number] | null = null;
      const mpp = metersPerPixel(map, (g.position ?? first)[1]);

      if (g.mode === "sim") {
        const pos = positionAt(tl, g.elapsedS);
        here = pos.p;
        along = pos.along;
        const f = walkerFrame(tl, r, g.elapsedS, pos.seg, pos.dwelling, pos.along, mean);
        state = f.state;
        if (state === "walking") {
          target = headingAlong(tl, along, Math.max(3, mpp * 16));
          cyc = cycleSeconds(f.speedRatio, f.slopeDeg, g.speed);
          grade = f.grade;
        } else if (state === "working") {
          label = [`Working at ${names[pos.seg + 1] ?? "stop"}`, `${mmss(f.dwellLeftS)} left`, f.dwellF];
        } else {
          label = ["Walk complete", names[names.length - 1] ? `at ${names[names.length - 1]}` : "", 1];
        }
      } else {
        here = g.position;
        along = g.alongM;
        if (here && (!lastPos || here !== lastPos)) {
          const prev = track[track.length - 1];
          if (!prev || marsDistanceM(prev.p, here) > 0.15) track.push({ p: here, t: now });
          if (track.length > 400) track.splice(0, track.length - 400);
        }
        // Speed over the last few seconds of fixes.
        const recent = track.filter((x) => now - x.t < 4000);
        let v = 0;
        if (recent.length >= 2) {
          const a = recent[0]!, b = recent[recent.length - 1]!;
          v = marsDistanceM(a.p, b.p) / Math.max(0.5, (now - a.t) / 1000);
          if (marsDistanceM(a.p, b.p) > 0.6) target = bearingDeg(a.p, b.p);
        }
        state = v > 0.25 ? "walking" : "idle";
        cyc = cycleSeconds(v / Math.max(0.3, mean), 0, 1);
      }
      lastPos = here;
      if (!here) return;

      // Heading, eased so grid-cell zig-zags don't make the figure twitch.
      if (target != null) heading = lerpAngle(heading, target, 1 - Math.exp(-dt * 7));
      const a = map.project(here), b = map.project(offsetLonLat(here, Math.sin((heading * Math.PI) / 180) * 10, Math.cos((heading * Math.PI) / 180) * 10));
      const dx = b.x - a.x;
      if (dx < -0.5) faceLeft = true;
      else if (dx > 0.5) faceLeft = false;

      const paused = g.mode === "sim" && !g.playing && state !== "idle";
      const nextCls = `walker ${state}${faceLeft ? " face-left" : ""}${paused ? " paused" : ""}${label && state === "idle" ? " done" : ""}`;
      if (nextCls !== cls) el.className = cls = nextCls;
      const q = Math.round(cyc * 20) / 20;
      if (q !== cycle) el.style.setProperty("--cycle", `${(cycle = q)}s`);
      const ln = state === "walking" ? Math.max(-12, Math.min(12, grade * 45)) : 0;
      if (Math.abs(ln - leanDeg) > 0.5 || Number.isNaN(leanDeg)) lean.style.transform = `rotate(${(leanDeg = ln)}deg)`;
      if (label) {
        const key = `${label[0]}|${label[1]}`;
        if (key !== labelKey) {
          labelKey = key;
          l1.textContent = label[0];
          l2.textContent = label[1];
        }
        ringArc.style.strokeDashoffset = String(RING_C * (1 - label[2]));
      }

      figure.setLngLat(here);
      ground.setLngLat(here).setRotation(heading);
      groundEl.classList.toggle("is-still", state !== "walking");

      // Trail + progress line: only when the walker moved or the zoom changed (print spacing is per zoom).
      const z = map.getZoom();
      if (Math.abs(along - lastAlong) > 0.02 || Math.abs(z - lastZoom) > 0.05 || g.mode === "gps") {
        lastAlong = along;
        lastZoom = z;
        // Prints sit just outside the route casing (~4 px each side), one every ~13 px.
        const stepM = Math.max(0.7, mpp * 13), sideM = Math.max(0.16, mpp * 6.5);
        trailSrc.setData(printsFC(g.mode === "sim" ? routePrints(tl, along, stepM, sideM, PRINTS) : trackPrints(track.map((x) => x.p), stepM, sideM, PRINTS)));
        doneSrc.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: walkedLine(tl, along, here) } });
      }

      // Gentle camera follow (skipped while the map is animating or being zoomed by the user).
      if (useWalkerUi.getState().follow && !map.isMoving()) {
        const c = map.getContainer();
        const cx = c.clientWidth / 2, cy = c.clientHeight / 2;
        const off = Math.hypot(a.x - cx, a.y - cy);
        if (off > 1.5) {
          const k = off > Math.max(cx, cy) ? 1 : 1 - Math.exp(-dt * 2.2);
          map.jumpTo({ center: map.unproject([cx + (a.x - cx) * k, cy + (a.y - cy) * k]) });
        }
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      map.off("dragstart", stopFollowOnDrag);
      figure.remove();
      ground.remove();
      if (map.getSource("go-trail")) {
        trailSrc.setData(EMPTY_FC);
        doneSrc.setData(EMPTY_FC);
      }
    };
  }, [mode, tl, r, namesKey, start]);

  return null;
}

/** "Follow" toggle for the Go panel. */
export function FollowToggle() {
  const follow = useWalkerUi((s) => s.follow);
  const setFollow = useWalkerUi((s) => s.setFollow);
  return (
    <Button
      variant="secondary"
      size="xs"
      className={cn("mr-1.5 ml-auto px-[9px]", follow && "border-sim/70 text-sim")}
      aria-pressed={follow}
      onClick={() => setFollow(!follow)}
      title={follow ? "Camera follows the walker. Click (or drag the map) to pan freely." : "Camera stays put. Click to follow the walker."}
    >
      {follow ? "◎ Following" : "◎ Follow"}
    </Button>
  );
}
