/**
 * The Go walker: an animated astronaut that walks the selected route (simulated walk) or follows the
 * user's mapped GPS position. Draws, on the map:
 *  - an upright, screen-facing astronaut marker whose stride follows the walking speed and slope, that
 *    faces the direction of travel, kneels and works at stops (with a countdown of the work left), and idles at the end;
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
import { getMap, isCameraGliding, showOnMap } from "../map/MapView";
import { GROUND_SVG, WALKER_SVG, bootPrintImage } from "./walkerArt";
import { cycleSeconds, headingAlong, lerpAngle, meanSpeed, routePrints, trackPrints, walkedLine, walkerFrame, type Print, type WalkerState } from "./walkerMath";
import { LocateFixedIcon, LocateIcon } from "lucide-react";
import { MAP_LABEL_BOX, MAP_LABEL_MARK, MAP_LABEL_TONE } from "../map/mapLabel";
import { mapPalette } from "../map/mapPalette";
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
  const before = map.getLayer("route-ticks") ? "route-ticks" : map.getLayer("cursor-halo") ? "cursor-halo" : undefined;
  map.addSource("go-done", { type: "geojson", data: EMPTY_FC });
  map.addSource("go-trail", { type: "geojson", data: EMPTY_FC });
  // The walked part of the route: one solid line in the simulated-position colour, over the route's own casing.
  map.addLayer({ id: "go-done", type: "line", source: "go-done", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": mapPalette().sim, "line-width": 3 } }, before);
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
/** The walker's label is a map label like the others, in the simulated-position colour. It holds only what belongs
    at the walker: the work time left at a stop. What the crew is doing and where is in the walk panel. */
const LABEL_HTML = `<svg class="w-ring ${MAP_LABEL_MARK.sim}" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="10" cy="10" r="${RING_R}" opacity=".3"/><circle cx="10" cy="10" r="${RING_R}" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" transform="rotate(-90 10 10)"/></svg><span class="w-l1"></span>`;

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
    ensureLayers(map);
    const doneSrc = map.getSource("go-done") as GeoJSONSource;
    const trailSrc = map.getSource("go-trail") as GeoJSONSource;

    // ----- DOM -----
    const el = document.createElement("div");
    el.className = "walker idle";
    el.innerHTML = `<div class="w-label"><div class="${MAP_LABEL_BOX} ${MAP_LABEL_TONE.strong} gap-[5px]">${LABEL_HTML}</div></div><div class="w-shadow"></div><div class="w-flip"><div class="w-lean">${WALKER_SVG}</div></div>`;
    const lean = el.querySelector(".w-lean") as HTMLElement;
    const l1 = el.querySelector(".w-l1") as HTMLElement;
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
    if (useWalkerUi.getState().follow && map.getZoom() < FOLLOW_MIN_ZOOM) showOnMap({ center: first, zoom: FOLLOW_MIN_ZOOM }, 1200);

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
      // While working at a stop: [time left, fraction of the work done].
      let label: [string, number] | null = null;
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
          label = [`${mmss(f.dwellLeftS)} left`, f.dwellF];
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
      const nextCls = `walker ${state}${faceLeft ? " face-left" : ""}${paused ? " paused" : ""}`;
      if (nextCls !== cls) el.className = cls = nextCls;
      const q = Math.round(cyc * 20) / 20;
      if (q !== cycle) el.style.setProperty("--cycle", `${(cycle = q)}s`);
      const ln = state === "walking" ? Math.max(-12, Math.min(12, grade * 45)) : 0;
      if (Math.abs(ln - leanDeg) > 0.5 || Number.isNaN(leanDeg)) lean.style.transform = `rotate(${(leanDeg = ln)}deg)`;
      if (label) {
        if (label[0] !== labelKey) l1.textContent = labelKey = label[0];
        ringArc.style.strokeDashoffset = String(RING_C * (1 - label[1]));
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
      // Eased in lon/lat, not screen pixels: the map has padding for the floating panels, so the
      // camera centre is not the container's middle, and steering toward the middle made it oscillate.
      if (useWalkerUi.getState().follow && !map.isMoving() && !isCameraGliding()) {
        const center = map.getCenter();
        const cp = map.project(center);
        const off = Math.hypot(a.x - cp.x, a.y - cp.y);
        if (off > 1.5) {
          const c = map.getContainer();
          const k = off > Math.max(c.clientWidth, c.clientHeight) / 2 ? 1 : 1 - Math.exp(-dt * 2.2);
          map.jumpTo({ center: [center.lng + (here[0] - center.lng) * k, center.lat + (here[1] - center.lat) * k] });
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

/** "Follow" toggle for the Go panel: an ordinary pressed-state toggle. It carries no status colour of its own. */
/** `compact` is the icon alone, for the folded Go panel. */
export function FollowToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const follow = useWalkerUi((s) => s.follow);
  const setFollow = useWalkerUi((s) => s.setFollow);
  const title = follow ? "The camera follows the walker" : "The camera stays put";
  if (compact)
    return (
      // Raised when off, pressed in while the camera follows.
      <Button variant="secondary" size="icon-sm" className={cn(className, follow && "text-foreground")} aria-pressed={follow} aria-label="Follow the walker" onClick={() => setFollow(!follow)} title={title}>
        {follow ? <LocateFixedIcon aria-hidden /> : <LocateIcon aria-hidden />}
      </Button>
    );
  return (
    <Button
      variant="secondary"
      size="xs"
      className={cn("flex-none coarse:h-9 coarse:px-3", follow ? "border-seam-strong bg-white/16 text-foreground" : "text-ink-2")}
      aria-pressed={follow}
      onClick={() => setFollow(!follow)}
      title={follow ? "The camera follows the walker" : "The camera stays put"}
    >
      {follow ? <LocateFixedIcon aria-hidden /> : <LocateIcon aria-hidden />}
      Follow
    </Button>
  );
}
