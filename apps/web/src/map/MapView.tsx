import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MLMap } from "maplibre-gl";
import type { GridSpec, LonLat, ReachRing, RouteResult } from "@marsmap/core";
import { selectedResult, useStore, type LayerState, type OverlayId } from "../store";
import type { AreaData, DisplayLayers, Poi } from "../types";
import { M_PER_DEG_LAT } from "../geo";
import { sampleBest } from "../lib";
import { confidenceUrl, costUrl, elevationUrl, SCIENCE_RAMPS, scienceUrl, slopeUrl, surfaceUrl } from "./rasters";
import { loadFloatLayer } from "../data";
import { demMaxZoom, demTilesUrl, DEM_TILE_SIZE, registerDemProtocol, setDemSource } from "./dem";
import { IMAGERY_TILE_SIZE, imageryGroups, imageryMaxZoom, imageryTilesUrl, registerImageryProtocol, setImageryArea } from "./imageryTiles";
import { fmtDur } from "../format";
import { ClickMenu } from "../components/ClickMenu";
import { routeSlopeFeatures } from "./routeSlope";
import { setRenderDistance, tuneTerrain } from "./terrainPerf";
import { keepCameraAboveGround } from "./cameraClearance";

let mapInstance: MLMap | null = null;
export const getMap = () => mapInstance;

const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export const PROFILE_COLORS: Record<string, string> = {
  fastest: "#f4f5f7",
  "least-effort": "#4fc3f7",
  leastEffort: "#4fc3f7",
  least_effort: "#4fc3f7",
  safest: "#7ee081",
};
export const profileColor = (id: string, i = 0) => PROFILE_COLORS[id] ?? ["#f4f5f7", "#4fc3f7", "#7ee081"][i % 3]!;

export { imageryGroup } from "./imageryTiles";

/** How often POI labels are re-placed while the map is moving. */
const LABEL_MOVE_INTERVAL_MS = 120;
/** Round-trip time rings are teal; the outermost (walk-limit) ring is amber. Shared with the map key. */
export const RING_COLOR = "#36d1c4";
export const RING_LIMIT_COLOR = "#ffb347";
/** Opacity multiplier for Curiosity's traverse while the Plan tab is open. */
const TRACK_PLAN_FADE = 0.28;
const DEFAULT_TRACK_STATE = useStore.getState().overlays.track;
/** True when the traverse should recede: Plan tab open and the user has not set the track layer themselves. */
export const isTrackFaded = (tab: string, track: LayerState) => tab === "plan" && track === DEFAULT_TRACK_STATE;
let mapReady = false;
let pendingInsets: { top?: number; right?: number; bottom?: number; left?: number } | null = null;

/**
 * Tell the map how much of its canvas is covered by floating panels, so "centre" means the centre of
 * the part the user can see. Eased, so the ground glides aside as a panel opens.
 */
export function setMapInsets(p: { top?: number; right?: number; bottom?: number; left?: number }, ms = 380) {
  const map = mapInstance;
  if (!map) return;
  if (!mapReady) {
    // Asked before the map's first frame: remembered, and applied without animation when it loads.
    pendingInsets = p;
    return;
  }
  const padding = { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 };
  const cur = map.getPadding();
  if (cur.top === padding.top && cur.right === padding.right && cur.bottom === padding.bottom && cur.left === padding.left) return;
  map.easeTo({ padding, duration: ms, easing: (t) => 1 - Math.pow(1 - t, 3) });
}

/** Resize the map on every frame for a while, so it tracks a panel that is sliding open or shut. */
export function resizeMapDuring(ms: number) {
  const until = performance.now() + ms + 80;
  const step = () => {
    mapInstance?.resize();
    if (performance.now() < until) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const RASTER_OVERLAYS = ["elevation", "slope", "surface", "confidence", "cost"] as const;
/** Overlays drawn from the rasters (cost is drawn from the reach field instead). */
const LAYER_OVERLAYS = ["elevation", "slope", "surface", "confidence"] as const;
type LayerOverlay = (typeof LAYER_OVERLAYS)[number];

/** Picture of one raster overlay of a set of display layers (null when that layer is missing). */
function overlayUrl(id: LayerOverlay, L: DisplayLayers, a: AreaData): Promise<string> | null {
  const g = L.grid;
  if (id === "elevation" && L.elevation) return elevationUrl(g, L.elevation, L.elevMin, L.elevMax);
  if (id === "slope" && L.slope) return slopeUrl(g, L.slope);
  if (id === "surface" && L.surface) return surfaceUrl(g, L.surface, a.config.surfaceClasses);
  if (id === "confidence" && L.confidence) return confidenceUrl(g, L.confidence);
  return null;
}

/** Manifest layers the pipeline marked as science overlays (e.g. CRISM mineral indicators). */
export const scienceLayers = (a: AreaData) => a.manifest.layers.filter((l) => l.group === "science" && l.dtype === "float32");
export const scienceRamp = (a: AreaData, id: string) => SCIENCE_RAMPS[Math.max(0, scienceLayers(a).findIndex((l) => l.id === id)) % SCIENCE_RAMPS.length]!;

/**
 * Trackpad, mouse-wheel and Safari pinch handling. Replaces MapLibre's scrollZoom, which treats
 * every scroll as a zoom, so a two-finger scroll can pan the map the way it does in native map apps.
 *
 *   two-finger scroll            pan
 *   pinch (ctrl/cmd + scroll)    zoom about the pointer
 *   shift + scroll               rotate
 *   alt/option + scroll          tilt (3D only: 2D caps the pitch at 0)
 *   mouse wheel                  zoom about the pointer
 *
 * Mouse wheel vs trackpad: a wheel reports whole lines (Firefox, deltaMode 1) or a legacy
 * wheelDeltaY in steps of 120 that is NOT simply -3 x deltaY, which is what trackpads report.
 * The verdict is held for events less than 120 ms apart so one gesture is never split.
 * Touch screens are left to MapLibre's own handlers (drag, pinch, two-finger rotate and tilt).
 */
/** Touch-and-hold time and allowed finger drift before it stops counting as a hold. */
const HOLD_MS = 500;
const HOLD_SLOP_PX = 10;
/** A single tap waits this long for a second tap (double-tap zoom) before it opens the point menu. */
const TAP_DELAY_MS = 260;
/** Tilting past ENTER switches the terrain on; levelling below LEAVE switches it off. */
const TILT_ENTER_3D = 4;
const TILT_LEAVE_3D = 1;
/** Set when a hold has just opened the menu, so the tap that ends the hold does not reopen it elsewhere. */
let suppressNextClick = 0;
/** True while the 2D/3D state is being changed by a tilt gesture rather than the 2D/3D buttons. */
let tiltDriven = false;
/** True while the 2D button is levelling the camera, so that animation is not read as a tilt gesture. */
let levelling = false;

function attachGestures(map: MLMap): () => void {
  const el = map.getCanvasContainer();
  let lastT = 0, lastMouse = false, targetZoom = map.getZoom();
  const isMouseWheel = (e: WheelEvent): boolean => {
    if (e.deltaMode !== 0) return true;
    const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    return e.deltaX === 0 && wd != null && wd !== 0 && wd % 120 === 0 && Math.abs(wd) !== Math.round(Math.abs(e.deltaY) * 3);
  };
  const pointer = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return map.unproject([e.clientX - r.left, e.clientY - r.top]);
  };
  const clampZoom = (z: number) => Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z));
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const fresh = e.timeStamp - lastT > 120;
    const mouse = fresh ? isMouseWheel(e) : lastMouse;
    lastT = e.timeStamp;
    lastMouse = mouse;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      map.easeTo({ zoom: clampZoom(map.getZoom() - dy * 0.01), around: pointer(e), duration: 0 });
    } else if (e.shiftKey) {
      // Browsers turn shift + vertical scroll into horizontal scroll, so take whichever axis moved.
      map.jumpTo({ bearing: map.getBearing() + (Math.abs(dx) > Math.abs(dy) ? dx : dy) * 0.3 });
    } else if (e.altKey) {
      // Orbit: Chromium never delivers a trackpad twist to a page, so Option + two-finger scroll stands in
      // for it. Sideways turns the map, up/down tilts it. Mostly-sideways or mostly-vertical motion is
      // locked to that one axis so a turn does not also tilt.
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const turn = ax > ay * 1.5 ? dx : ay > ax * 1.5 ? 0 : dx;
      const tilt = ay > ax * 1.5 ? dy : ax > ay * 1.5 ? 0 : dy;
      map.jumpTo({
        bearing: map.getBearing() + turn * 0.3,
        pitch: map.getMaxPitch() > 0 ? Math.max(0, Math.min(map.getMaxPitch(), map.getPitch() - tilt * 0.25)) : 0,
      });
    } else if (mouse) {
      const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      const step = Math.max(-1, Math.min(1, wd ? wd / 240 : -dy / 100)); // one notch = half a zoom level
      targetZoom = clampZoom((fresh ? map.getZoom() : targetZoom) + step);
      map.easeTo({ zoom: targetZoom, around: pointer(e), duration: 160, easing: (t) => t });
    } else {
      map.panBy([dx, dy], { animate: false });
    }
  };
  // Safari sends pinch and rotate on a Mac trackpad as gesture events instead of ctrl + wheel.
  // On iPad the same events accompany real touches, which MapLibre already handles.
  type GestureEvent = Event & { scale: number; rotation: number; clientX: number; clientY: number };
  let touches = 0;
  let g0: { zoom: number; bearing: number } | null = null;
  const onTouch = (e: TouchEvent) => (touches = e.touches.length);
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    g0 = touches > 0 ? null : { zoom: map.getZoom(), bearing: map.getBearing() };
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as GestureEvent;
    if (!g0 || touches > 0 || !(g.scale > 0)) return;
    map.easeTo({ zoom: clampZoom(g0.zoom + Math.log2(g.scale)), bearing: g0.bearing - g.rotation, around: pointer(g), duration: 0 });
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    g0 = null;
  };
  // Touch and hold drops a pin (opens the "set start / add stop" menu), as in Apple Maps.
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let holdAt: { x: number; y: number } | null = null;
  const cancelHold = () => {
    clearTimeout(holdTimer);
    holdAt = null;
  };
  const onHoldStart = (e: TouchEvent) => {
    cancelHold();
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    holdAt = { x: t.clientX, y: t.clientY };
    holdTimer = setTimeout(() => {
      if (!holdAt) return;
      const ll = pointer({ clientX: holdAt.x, clientY: holdAt.y });
      holdAt = null;
      suppressNextClick = performance.now();
      useStore.getState().set({ mapClick: [ll.lng, ll.lat], selectedWaypoint: null });
    }, HOLD_MS);
  };
  const onHoldMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!holdAt || !t || e.touches.length !== 1 || Math.hypot(t.clientX - holdAt.x, t.clientY - holdAt.y) > HOLD_SLOP_PX) cancelHold();
  };
  el.addEventListener("touchstart", onHoldStart, { passive: true });
  el.addEventListener("touchmove", onHoldMove, { passive: true });
  el.addEventListener("touchend", cancelHold, { passive: true });
  el.addEventListener("touchcancel", cancelHold, { passive: true });
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("touchstart", onTouch, { passive: true });
  el.addEventListener("touchend", onTouch, { passive: true });
  el.addEventListener("touchcancel", onTouch, { passive: true });
  el.addEventListener("gesturestart", onGestureStart);
  el.addEventListener("gesturechange", onGestureChange);
  el.addEventListener("gestureend", onGestureEnd);
  return () => {
    cancelHold();
    el.removeEventListener("touchstart", onHoldStart);
    el.removeEventListener("touchmove", onHoldMove);
    el.removeEventListener("touchend", cancelHold);
    el.removeEventListener("touchcancel", cancelHold);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("touchstart", onTouch);
    el.removeEventListener("touchend", onTouch);
    el.removeEventListener("touchcancel", onTouch);
    el.removeEventListener("gesturestart", onGestureStart);
    el.removeEventListener("gesturechange", onGestureChange);
    el.removeEventListener("gestureend", onGestureEnd);
  };
}

function gridCoords(g: GridSpec): [[number, number], [number, number], [number, number], [number, number]] {
  return [[g.west, g.north], [g.east, g.north], [g.east, g.south], [g.west, g.south]];
}

function routeFeatures(results: RouteResult[] | null): GeoJSON.FeatureCollection {
  if (!results) return EMPTY_FC;
  const features: GeoJSON.Feature[] = [];
  results.forEach((r, ri) => {
    const over = r.totals.firstSegmentOverLimit;
    r.segments.forEach((s, si) => {
      if (s.path.length < 2) return;
      features.push({
        type: "Feature",
        properties: { profile: r.profile.id, seg: si, over: over != null && si >= over ? 1 : 0, color: profileColor(r.profile.id, ri) },
        geometry: { type: "LineString", coordinates: s.path },
      });
    });
  });
  return { type: "FeatureCollection", features };
}

/** Approximate area of a lon/lat ring in square metres (shoelace on a local projection). */
function ringAreaM2(ring: number[][]): number {
  let a = 0;
  const k = M_PER_DEG_LAT * Math.cos(((ring[0]?.[1] ?? 0) * Math.PI) / 180);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j]![0]! * k) * (ring[i]![1]! * M_PER_DEG_LAT) - (ring[i]![0]! * k) * (ring[j]![1]! * M_PER_DEG_LAT);
  }
  return Math.abs(a / 2);
}

/** Small islands and holes (single blocked boulders / steep pits) are visual noise at map scale. */
const MIN_RING_PART_M2 = 1500;

function ringFeatures(rings: ReachRing[] | null): GeoJSON.FeatureCollection {
  if (!rings) return EMPTY_FC;
  const n = rings.length;
  return {
    type: "FeatureCollection",
    features: rings.map((r, i) => ({
      type: "Feature",
      properties: { id: r.id, i, t: n > 1 ? i / (n - 1) : 1, limit: r.kind === "limit" ? 1 : 0 },
      geometry: {
        type: "MultiPolygon",
        coordinates: r.coordinates
          .filter((poly) => poly[0] && ringAreaM2(poly[0]) >= MIN_RING_PART_M2)
          // Holes (no-go ground inside a ring) are drawn once, on the walk-limit ring, not repeated on every ring.
          .map((poly) => [poly[0]!, ...(i === n - 1 ? poly.slice(1).filter((h) => ringAreaM2(h) >= MIN_RING_PART_M2) : [])]),
      },
    })),
  };
}

/** Most outline points tried as a ring label spot. */
const RING_LABEL_CANDIDATES = 300;
/** Labels are re-placed once the map has been still this long (trackpad panning ends a move on every scroll event). */
const LABEL_SETTLE_MS = 150;

/** Fire on the map when map furniture (e.g. the map key) changes size, so ring labels re-place. */
export const RELAYOUT_LABELS = "marsmap:relayout-labels";
type Box = { l: number; t: number; r: number; b: number };
const boxesHit = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
/** Map furniture a ring label must not sit under (relative to the map container). */
const LABEL_OBSTACLES = ".view-ctl, .maplibregl-ctrl-top-right, .map-legend, .readout, .card-slot > *, .go-panel, .maplibregl-ctrl-bottom-right";

/**
 * Put each ring label on the topmost point of its ring that keeps the whole label inside the
 * visible map, clear of the map controls and of the other ring labels; hide it if there is none.
 */
function placeRingLabels(map: MLMap, markers: maplibregl.Marker[], labels: { el: HTMLElement; outline: number[][] }[]) {
  const container = map.getContainer();
  const W = container.clientWidth, H = container.clientHeight;
  const cr = container.getBoundingClientRect();
  const obstacles: Box[] = [];
  container.parentElement?.querySelectorAll(LABEL_OBSTACLES).forEach((n) => {
    const r = (n as HTMLElement).getBoundingClientRect();
    if (r.width && r.height) obstacles.push({ l: r.left - cr.left - 4, t: r.top - cr.top - 4, r: r.right - cr.left + 4, b: r.bottom - cr.top + 4 });
  });
  const M = 6;
  labels.forEach(({ el, outline }, i) => {
    el.style.visibility = "hidden";
    const w = el.offsetWidth || 120, h = el.offsetHeight || 18;
    let best: { ll: number[]; y: number } | null = null;
    // Outlines have thousands of vertices and projecting one is costly in 3D; a few hundred candidates are plenty.
    const stride = Math.max(1, Math.ceil(outline.length / RING_LABEL_CANDIDATES));
    for (let k = 0; k < outline.length; k += stride) {
      const ll = outline[k]!;
      const p = map.project(ll as [number, number]);
      const box = { l: p.x - w / 2, t: p.y - h - 1, r: p.x + w / 2, b: p.y };
      if (box.l < M || box.t < M || box.r > W - M || box.b > H - M) continue;
      if (best && p.y >= best.y) continue;
      if (obstacles.some((o) => boxesHit(box, o))) continue;
      best = { ll, y: p.y };
    }
    if (!best) return;
    markers[i]?.setLngLat(best.ll as [number, number]);
    const p = map.project(best.ll as [number, number]);
    obstacles.push({ l: p.x - w / 2 - 4, t: p.y - h - 5, r: p.x + w / 2 + 4, b: p.y + 4 });
    el.style.visibility = "";
  });
}

/** Short on-map name: config `short`, else the name without "Start:", a trailing "(...)" or a ": subtitle". */
export function poiShortName(p: Poi): string {
  if (p.short) return p.short;
  let s = p.name.replace(/^start:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").split(":")[0]!.trim();
  if (s.length > 22) s = `${s.slice(0, 21).replace(/\s+\S*$/, "")}…`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/*
 * Markers are built by hand for MapLibre, so their styles are utility strings rather than JSX.
 * The class names in front (poi-pin, poi-label, stop-marker…) are hooks the label placement reads,
 * and the pin's state classes (selected, in-plan, flip, lbl-off) drive the group-[…]/pin variants.
 * Crisp shapes with a dark keyline and a light ring, legible on bright and dark ground.
 */
const POI_FILL: Record<string, string> = {
  "drill-site": "bg-poi-drill-site",
  "science-target": "bg-poi-science-target",
  start: "bg-poi-start",
  viewpoint: "bg-poi-viewpoint",
};
/** MapLibre makes markers position: absolute, which also anchors the label. */
const POI_PIN = "poi-pin group/pin flex size-3.5 cursor-pointer items-center gap-1.5 hover:z-3 [&.selected]:z-3";
const POI_DOT = "block size-3 rounded-full border-[1.5px] border-well shadow-[0_0_0_1px_rgba(255,255,255,0.75)] transition-transform duration-[120ms] ease-out-quint group-[:is(:hover,.selected)]/pin:scale-120 coarse:size-4";
/** One label style for everything named on the map: 11px semibold, white, dark halo. */
const MAP_LABEL = "text-[11px]/4 font-semibold whitespace-nowrap";
/** Sits beside the dot (further out once the pin carries a stop number), flips to the left near an edge,
    hides when it would collide, and becomes a boxed full name on hover or when selected. */
const POI_LABEL = `poi-label ${MAP_LABEL} pointer-events-none absolute -top-px left-[19px] text-white text-shadow-[0_0_2px_#000,0_0_4px_#000,0_1px_6px_#000] group-[.in-plan]/pin:left-[23px] group-[.flip]/pin:right-[19px] group-[.flip]/pin:left-auto group-[.in-plan.flip]/pin:right-[23px] group-[.in-plan.flip]/pin:left-auto group-[.lbl-off:not(:hover,.selected)]/pin:invisible group-[:is(:hover,.selected)]/pin:-top-0.5 group-[:is(:hover,.selected)]/pin:rounded-sm group-[:is(:hover,.selected)]/pin:border group-[:is(:hover,.selected)]/pin:border-input group-[:is(:hover,.selected)]/pin:bg-[rgba(15,12,11,0.9)] group-[:is(:hover,.selected)]/pin:px-1.5 group-[:is(:hover,.selected)]/pin:text-shadow-none [.lowzoom_&]:hidden [.lowzoom_.poi-pin:hover_&]:inline`;
const STOP_MARKER = "stop-marker grid size-[22px] cursor-grab place-items-center rounded-lg border-[1.5px] text-[11px] font-semibold coarse:size-[30px] coarse:text-base";
const STOP_NUMBER = `${STOP_MARKER} border-white bg-well text-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]`;
const STOP_START = `${STOP_MARKER} border-well bg-white text-well shadow-[0_0_0_1px_rgba(255,255,255,0.8)]`;
const RING_LABEL = `ring-label ${MAP_LABEL} pointer-events-none cursor-help rounded-sm border bg-[rgba(15,17,20,0.86)] px-[5px]`;

function poiEl(p: Poi): HTMLElement {
  const el = document.createElement("div");
  el.className = POI_PIN;
  el.innerHTML = `<span class="${POI_DOT} ${POI_FILL[p.type] ?? ""} ${p.type === "start" ? "rounded-[2px]" : ""}"></span><span class="${POI_LABEL}"><span class="pl-short group-[:is(:hover,.selected)]/pin:hidden"></span><span class="pl-full hidden group-[:is(:hover,.selected)]/pin:inline"></span></span>`;
  (el.querySelector(".pl-short") as HTMLElement).textContent = poiShortName(p);
  (el.querySelector(".pl-full") as HTMLElement).textContent = p.name;
  el.title = p.name;
  return el;
}

/**
 * Show each POI label on whichever side of its pin keeps it inside the map and clear of the
 * map furniture, the plan markers and the labels already placed; hide it (hover still shows it) if neither does.
 */
function placePoiLabels(map: MLMap, pins: { el: HTMLElement; ll: LonLat; rank: number }[]) {
  const container = map.getContainer();
  const W = container.clientWidth, H = container.clientHeight;
  const cr = container.getBoundingClientRect();
  const rel = (r: DOMRect): Box => ({ l: r.left - cr.left, t: r.top - cr.top, r: r.right - cr.left, b: r.bottom - cr.top });
  const obstacles: Box[] = [];
  container.parentElement?.querySelectorAll(`${LABEL_OBSTACLES}, .stop-marker, .pnr-chip, .ring-label`).forEach((n) => {
    const r = (n as HTMLElement).getBoundingClientRect();
    if (r.width && r.height && (n as HTMLElement).style.visibility !== "hidden") obstacles.push(rel(r));
  });
  // Every pin's dot is an obstacle for every label.
  const dots = pins.map(({ ll }) => {
    const p = map.project(ll as [number, number]);
    return { l: p.x - 8, t: p.y - 8, r: p.x + 8, b: p.y + 8 };
  });
  const placed: Box[] = [];
  const M = 6;
  [...pins]
    .map((pin, i) => ({ ...pin, i }))
    .sort((a, b) => a.rank - b.rank)
    .forEach(({ el, i }) => {
      const label = el.querySelector(el.classList.contains("selected") ? ".pl-full" : ".pl-short") as HTMLElement | null;
      const w = (label?.offsetWidth || 80) + 14, h = 16;
      const d = dots[i]!;
      const cx = (d.l + d.r) / 2, cy = (d.t + d.b) / 2;
      // Gap between pin centre and label: wider when a plan marker (S / 1, 2, ...) sits on the pin.
      const off = el.classList.contains("in-plan") ? 14 : 10;
      const sides = [
        { flip: false, box: { l: cx + off, t: cy - h / 2, r: cx + off + w, b: cy + h / 2 } },
        { flip: true, box: { l: cx - off - w, t: cy - h / 2, r: cx - off, b: cy + h / 2 } },
      ];
      const own = (o: Box) => o.l <= cx && o.r >= cx && o.t <= cy && o.b >= cy;
      const ok = sides.find(({ box }) => {
        if (box.l < M || box.t < M || box.r > W - M || box.b > H - M) return false;
        if (obstacles.some((o) => !own(o) && boxesHit(box, o)) || placed.some((o) => boxesHit(box, o))) return false;
        return !dots.some((o, j) => j !== i && boxesHit(box, o));
      });
      el.classList.toggle("flip", ok ? ok.flip : d.r + w > W - M);
      el.classList.toggle("lbl-off", !ok);
      if (ok) placed.push(ok.box);
    });
}

/** Open on the points of interest (the boxwork), not the whole region. */
function initialBounds(a: AreaData): [number, number, number, number] {
  const g = a.manifest.grid;
  const pts = a.config.pois.filter((p) => p.lon >= g.west && p.lon <= g.east && p.lat >= g.south && p.lat <= g.north);
  if (pts.length < 2) return [g.west, g.south, g.east, g.north];
  const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function MapView() {
  const area = useStore((s) => s.area)!;
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [popupEl, setPopupEl] = useState<HTMLElement | null>(null);
  const urls = useRef<Partial<Record<OverlayId, string>>>({});
  /** The same for the planning window's full-resolution copies of the overlays. */
  const detailUrls = useRef<Partial<Record<OverlayId, string>>>({});
  /** The tile URL each imagery source currently uses, so a tint switch only reloads what changed. */
  const shownUrl = useRef(new Map<string, string>());

  // ---------- create map ----------
  useEffect(() => {
    const g = area.manifest.grid;
    const ov = area.overview;
    if (ov.elevation) setDemSource({ grid: ov.grid, elev: ov.elevation }, null, ov.elevRef);
    registerDemProtocol();
    setImageryArea(area);
    registerImageryProtocol();
    const padLon = (g.east - g.west) * 0.6, padLat = (g.north - g.south) * 0.6;
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: {
        version: 8,
        sources: {},
        // Nothing is painted behind the map, so the star backdrop shows wherever there is no ground.
        layers: [{ id: "bg", type: "background", paint: { "background-color": "rgba(0,0,0,0)" } }],
      },
      bounds: initialBounds(area),
      fitBoundsOptions: { padding: 40 },
      maxBounds: [g.west - padLon, g.south - padLat, g.east + padLon, g.north + padLat],
      minZoom: 10,
      maxZoom: 21,
      maxPitch: 80,
      attributionControl: false,
      dragRotate: true,
      scrollZoom: false, // replaced by attachGestures
      renderWorldCopies: false,
    });
    mapInstance = map;
    const detachGestures = attachGestures(map);
    keepCameraAboveGround(map);
    // Bottom-right corner, scale under the zoom buttons (controls added later stack above earlier ones).
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    (window as unknown as { __map: MLMap }).__map = map;

    map.on("load", () => {
      mapReady = true;
      if (pendingInsets) {
        const p = pendingInsets;
        pendingInsets = null;
        setMapInsets(p, 0);
      }
      const coords = gridCoords(g);
      // The mapped square is solid ground: with imagery faded or off it stays dark instead of showing stars through it.
      map.addSource("ground", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] } } });
      map.addLayer({ id: "ground", type: "fill", source: "ground", paint: { "fill-color": "#0a0b0d", "fill-antialias": false } });
      // Base imagery: one tiled source per imagery group (overview and full-resolution pieces together).
      for (const grp of imageryGroups()) {
        const url = imageryTilesUrl(grp.id, useStore.getState().marsTint);
        shownUrl.current.set(grp.id, url);
        map.addSource(`img-${grp.id}`, { type: "raster", tiles: [url], tileSize: IMAGERY_TILE_SIZE, maxzoom: imageryMaxZoom(grp), bounds: grp.bounds });
        map.addLayer({ id: `img-${grp.id}`, type: "raster", source: `img-${grp.id}`, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } });
      }
      // DEM: one source for terrain, one for hillshade (MapLibre recommends separate sources).
      const demMax = demMaxZoom(g);
      for (const id of ["dem", "dem-hs"]) {
        map.addSource(id, { type: "raster-dem", tiles: [demTilesUrl()], tileSize: DEM_TILE_SIZE, encoding: "terrarium", maxzoom: demMax, minzoom: 8, bounds: [g.west, g.south, g.east, g.north] });
      }
      map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hs", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.6, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#1c1e22" } });
      // Each overlay is drawn twice where the area is tiled: the region overview, and on top of it the
      // planning window at full resolution (ovd-*).
      for (const id of RASTER_OVERLAYS) {
        const resampling = id === "surface" ? "nearest" : "linear";
        map.addSource(`ov-${id}`, { type: "image", url: BLANK, coordinates: coords });
        map.addLayer({ id: `ov-${id}`, type: "raster", source: `ov-${id}`, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": resampling } });
        if (!area.tiles || id === "cost") continue;
        map.addSource(`ovd-${id}`, { type: "image", url: BLANK, coordinates: coords });
        map.addLayer({ id: `ovd-${id}`, type: "raster", source: `ovd-${id}`, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": resampling } });
      }
      // Science layers keep their source pixels visible (nearest), so an 18 m CRISM pixel reads as one block.
      for (const l of scienceLayers(area)) {
        map.addSource(`sci-${l.id}`, { type: "image", url: BLANK, coordinates: gridCoords(l.grid ?? g) });
        map.addLayer({ id: `sci-${l.id}`, type: "raster", source: `sci-${l.id}`, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": "nearest" } });
      }
      // Outline of the planning window (the square of full-resolution ground routing runs on).
      map.addSource("window", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "window", type: "line", source: "window", paint: { "line-color": "#ffffff", "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [4, 3] } });
      map.addSource("rings", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "rings-line", type: "line", source: "rings", filter: ["<", ["get", "t"], 1], paint: { "line-color": RING_COLOR, "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 1.2, 1, 2.2], "line-dasharray": [3, 2] } });
      // Walk-limit ring (and the no-go loops inside it): solid amber, drawn over the time rings where they coincide.
      map.addLayer({ id: "rings-limit", type: "line", source: "rings", filter: [">=", ["get", "t"], 1], layout: { "line-join": "round" }, paint: { "line-color": RING_LIMIT_COLOR, "line-width": 1.6 } });

      map.addSource("track", { type: "geojson", data: area.rover.traverse ?? EMPTY_FC });
      map.addLayer({ id: "track-casing", type: "line", source: "track", paint: { "line-color": "#000", "line-width": 4, "line-opacity": 0.5 } });
      map.addLayer({ id: "track", type: "line", source: "track", paint: { "line-color": "#f5f0e6", "line-width": 1.6, "line-dasharray": [2, 1.5] } });
      map.addSource("waypoints", {
        type: "geojson",
        data: { type: "FeatureCollection", features: area.rover.waypoints.map((w, i) => ({ type: "Feature", properties: { i, sol: w.sol }, geometry: { type: "Point", coordinates: w.lonLat } })) },
      });
      map.addLayer({ id: "waypoints", type: "circle", source: "waypoints", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 18, 6], "circle-color": "#f5f0e6", "circle-stroke-color": "#0a0b0d", "circle-stroke-width": 1.5, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } });

      map.addSource("routes", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "routes-alt", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.35 } });
      map.addLayer({ id: "route-casing", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["case", ["==", ["get", "over"], 1], "#4a0d0b", "#120c0a"], "line-width": 8.5, "line-opacity": 0.9 } });
      // Selected route, coloured along its length by slope (pieces built from the segment profiles).
      map.addSource("route-slope", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "route-sel", type: "line", source: "route-slope", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4.5 } });
      map.addLayer({ id: "route-over", type: "line", source: "routes", layout: { "line-join": "round" }, paint: { "line-color": "#ffd2d2", "line-width": 1.5, "line-dasharray": [1, 2] } });

      map.addSource("cursor", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "cursor-halo", type: "circle", source: "cursor", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "go"], 14, 9], "circle-color": ["case", ["==", ["get", "kind"], "go"], "#36d1c4", "#ffffff"], "circle-opacity": 0.25 } });
      map.addLayer({ id: "cursor", type: "circle", source: "cursor", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "go"], 7, 5], "circle-color": ["case", ["==", ["get", "kind"], "go"], "#36d1c4", "#ffffff"], "circle-stroke-color": "#0a0b0d", "circle-stroke-width": 2 } });

      setReady(true);
    });

    // Hover readout.
    map.on("mousemove", (e) => {
      const ll: LonLat = [e.lngLat.lng, e.lngLat.lat];
      const s = useStore.getState();
      const smp = sampleBest(area, s.detail, ll);
      s.set({ hover: { lonLat: ll, elevationM: smp?.elevationM ?? null, slopeDeg: smp?.slopeDeg ?? null, surfaceId: smp?.surfaceId ?? null } });
    });
    map.on("mouseleave", () => useStore.getState().set({ hover: null }));
    const zoomClass = () => containerRef.current?.classList.toggle("lowzoom", map.getZoom() < 15.6);
    map.on("zoom", zoomClass);
    zoomClass();
    map.on("mouseenter", "waypoints", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "waypoints", () => (map.getCanvas().style.cursor = ""));

    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    map.on("click", (e) => {
      const s = useStore.getState();
      const ll: LonLat = [e.lngLat.lng, e.lngLat.lat];
      if (s.pickingStart) {
        s.setStart({ lonLat: ll, name: "Custom start" });
        return;
      }
      const wp = map.getLayer("waypoints") ? map.queryRenderedFeatures(e.point, { layers: ["waypoints"] }) : [];
      const hit = wp[0];
      if (hit && s.overlays.track.on) {
        const w = area.rover.waypoints[Number(hit.properties?.i)];
        if (w) {
          s.set({ selectedWaypoint: w, selectedPoi: null, mapClick: null });
          return;
        }
      }
      if (performance.now() - suppressNextClick < 700) return;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => useStore.getState().set({ mapClick: ll, selectedWaypoint: null }), TAP_DELAY_MS);
    });
    map.on("dblclick", () => clearTimeout(tapTimer));
    // Apple Maps style: tilting the flat map slides into 3D, levelling it out returns to 2D.
    map.on("pitch", () => {
      if (levelling || !area.overview.elevation || useStore.getState().view3d || map.getPitch() < TILT_ENTER_3D) return;
      tiltDriven = true;
      useStore.getState().set({ view3d: true });
    });
    map.on("moveend", () => {
      if (!useStore.getState().view3d || map.getPitch() > TILT_LEAVE_3D || map.isMoving()) return;
      tiltDriven = true;
      useStore.getState().set({ view3d: false });
    });

    return () => {
      detachGestures();
      map.remove();
      mapInstance = null;
      mapReady = false;
    };
  }, [area]);

  // ---------- base imagery ----------
  const baseImagery = useStore((s) => s.baseImagery);
  const baseOpacity = useStore((s) => s.baseOpacity);
  const marsTint = useStore((s) => s.marsTint);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    for (const grp of imageryGroups()) {
      const id = `img-${grp.id}`;
      if (!map.getLayer(id)) continue;
      const url = imageryTilesUrl(grp.id, marsTint);
      if (shownUrl.current.get(grp.id) !== url) {
        shownUrl.current.set(grp.id, url);
        (map.getSource(id) as maplibregl.RasterTileSource | undefined)?.setTiles([url]);
      }
      map.setLayoutProperty(id, "visibility", grp.id === baseImagery ? "visible" : "none");
      map.setPaintProperty(id, "raster-opacity", baseOpacity);
    }
  }, [ready, baseImagery, baseOpacity, marsTint, area]);

  // ---------- planning window: terrain heights ----------
  const detail = useStore((s) => s.detail);
  useEffect(() => {
    const map = mapInstance;
    const ov = area.overview;
    if (!ready || !map || !ov.elevation || !area.tiles) return;
    const url = setDemSource({ grid: ov.grid, elev: ov.elevation }, detail?.elevation ? { grid: detail.grid, elev: detail.elevation } : null, ov.elevRef);
    for (const id of ["dem", "dem-hs"]) (map.getSource(id) as maplibregl.RasterDEMTileSource | undefined)?.setTiles([url]);
  }, [ready, detail, area]);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map || !area.tiles) return;
    const c = detail ? gridCoords(detail.grid) : null;
    (map.getSource("window") as GeoJSONSource | undefined)?.setData(
      c ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...c, c[0]]] } } : EMPTY_FC,
    );
  }, [ready, detail, area]);

  // ---------- raster overlays ----------
  const overlays = useStore((s) => s.overlays);
  const tab = useStore((s) => s.tab);
  const reach = useStore((s) => s.reach);
  const gens = useRef<Partial<Record<OverlayId, number>>>({});
  const detailGen = useRef(0);
  // Walk-cost heat is invalidated whenever the reach field changes (declared first so it runs first).
  useEffect(() => {
    const old = urls.current.cost;
    if (old && old !== "pending") URL.revokeObjectURL(old);
    delete urls.current.cost;
    gens.current.cost = (gens.current.cost ?? 0) + 1;
  }, [reach]);
  // The window's full-resolution overlays are redrawn when the window moves.
  useEffect(() => {
    for (const u of Object.values(detailUrls.current)) if (u && u !== "pending") URL.revokeObjectURL(u);
    detailUrls.current = {};
    detailGen.current++;
  }, [detail]);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    const show = (layer: string, on: boolean, opacity: number) => {
      if (!map.getLayer(layer)) return;
      map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
      map.setPaintProperty(layer, "raster-opacity", opacity);
    };
    for (const id of RASTER_OVERLAYS) {
      const st = overlays[id];
      if (id === "cost") {
        const vis = st.on && reach != null;
        show("ov-cost", vis, st.opacity);
        if (!vis || urls.current.cost || !reach) continue;
        urls.current.cost = "pending";
        const gen = gens.current.cost ?? 0;
        const g = reach.grid;
        void costUrl(g, reach.outTimeS, reach.backTimeS, reach.usableS).then((url) => {
          if ((gens.current.cost ?? 0) !== gen) return URL.revokeObjectURL(url);
          urls.current.cost = url;
          (map.getSource("ov-cost") as ImageSource | undefined)?.updateImage({ url, coordinates: gridCoords(g) });
        });
        continue;
      }
      show(`ov-${id}`, st.on, st.opacity);
      if (st.on && !urls.current[id]) {
        const p = overlayUrl(id, area.overview, area);
        if (p) {
          urls.current[id] = "pending";
          const g = area.overview.grid;
          void p.then((url) => {
            urls.current[id] = url;
            (map.getSource(`ov-${id}`) as ImageSource | undefined)?.updateImage({ url, coordinates: gridCoords(g) });
          });
        }
      }
      if (!area.tiles) continue;
      show(`ovd-${id}`, st.on && !!detail, st.opacity);
      if (!st.on || !detail || detailUrls.current[id]) continue;
      const p = overlayUrl(id, detail, area);
      if (!p) continue;
      detailUrls.current[id] = "pending";
      const gen = detailGen.current;
      void p.then((url) => {
        if (detailGen.current !== gen) return URL.revokeObjectURL(url);
        detailUrls.current[id] = url;
        (map.getSource(`ovd-${id}`) as ImageSource | undefined)?.updateImage({ url, coordinates: gridCoords(detail.grid) });
      });
    }
    map.setLayoutProperty("hillshade", "visibility", overlays.hillshade.on ? "visible" : "none");
    map.setPaintProperty("hillshade", "hillshade-exaggeration", overlays.hillshade.opacity);
    map.setLayoutProperty("rings-line", "visibility", overlays.rings.on ? "visible" : "none");
    map.setPaintProperty("rings-line", "line-opacity", overlays.rings.opacity);
    map.setLayoutProperty("rings-limit", "visibility", overlays.rings.on ? "visible" : "none");
    map.setPaintProperty("rings-limit", "line-opacity", overlays.rings.opacity * 0.85);
    for (const l of ["track", "track-casing", "waypoints"]) map.setLayoutProperty(l, "visibility", overlays.track.on ? "visible" : "none");
    // While planning, Curiosity's track recedes so the planned route stands out — unless the user
    // has set the track layer themselves in the Layers tab (its state object then differs from the default).
    const fade = isTrackFaded(tab, overlays.track) ? TRACK_PLAN_FADE : 1;
    map.setPaintProperty("track", "line-opacity", overlays.track.opacity * fade);
    map.setPaintProperty("track-casing", "line-opacity", 0.5 * fade);
    map.setPaintProperty("waypoints", "circle-opacity", overlays.track.opacity * fade);
    map.setPaintProperty("waypoints", "circle-stroke-opacity", fade);
  }, [ready, overlays, reach, area, tab, detail]);

  // ---------- science overlays (data fetched the first time each is switched on) ----------
  const sci = useStore((s) => s.sci);
  const sciData = useStore((s) => s.sciData);
  const sciUrls = useRef<Record<string, string>>({});
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    for (const l of scienceLayers(area)) {
      const st = sci[l.id];
      const on = !!st?.on;
      map.setLayoutProperty(`sci-${l.id}`, "visibility", on ? "visible" : "none");
      if (st) map.setPaintProperty(`sci-${l.id}`, "raster-opacity", st.opacity);
      if (!on || sciUrls.current[l.id]) continue;
      sciUrls.current[l.id] = "pending";
      void (async () => {
        const gd = useStore.getState().sciData[l.id] ?? (await loadFloatLayer(area, l.id));
        if (!gd) {
          delete sciUrls.current[l.id];
          return;
        }
        if (!useStore.getState().sciData[l.id]) useStore.getState().set({ sciData: { ...useStore.getState().sciData, [l.id]: gd } });
        const url = await scienceUrl(gd.grid, gd.data, l.display?.min ?? 0, l.display?.max ?? 1, scienceRamp(area, l.id));
        sciUrls.current[l.id] = url;
        (map.getSource(`sci-${l.id}`) as ImageSource | undefined)?.updateImage({ url, coordinates: gridCoords(gd.grid) });
      })();
    }
  }, [ready, sci, sciData, area]);

  // ---------- rings ----------
  const rings = useStore((s) => s.rings);
  const ringMarkers = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    (map.getSource("rings") as GeoJSONSource).setData(ringFeatures(rings));
    ringMarkers.current.forEach((m) => m.remove());
    ringMarkers.current = [];
    if (!rings || !overlays.rings.on) return;
    const usable = reach?.usableS ?? 0;
    const labels: { el: HTMLElement; outline: number[][] }[] = [];
    for (const r of rings) {
      // Candidate label spots: every vertex of the ring's (non-trivial) outer boundaries.
      const outline = r.coordinates.filter((poly) => poly[0] && ringAreaM2(poly[0]) >= MIN_RING_PART_M2).flatMap((poly) => poly[0]!);
      if (!outline.length) continue;
      const el = document.createElement("div");
      el.className = RING_LABEL;
      const isLimit = r.kind ? r.kind === "limit" : r.budgetS === Math.max(...rings.map((x) => x.budgetS));
      el.textContent = isLimit ? `Limit${r.limitedBy ? ` · ${r.limitedBy}` : ""}` : fmtDur(r.budgetS);
      el.title = isLimit
        ? `Walk limit: the farthest you can go, work one stop and still get home with the reserve intact on time, energy and oxygen${r.limitedBy ? `. Here ${r.limitedBy} runs out first` : ""}`
        : `Reachable and back to the start in ${fmtDur(r.budgetS)} of walking (round trip)`;
      el.className += isLimit ? " border-warn/55 text-warn" : " border-input text-ink-2";
      ringMarkers.current.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(outline[0] as [number, number]).addTo(map));
      labels.push({ el, outline });
    }
    const place = () => placeRingLabels(map, ringMarkers.current, labels);
    place();
    let settle: number | undefined;
    const placeWhenStill = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(place, LABEL_SETTLE_MS);
    };
    map.on("moveend", placeWhenStill);
    map.on("resize", placeWhenStill);
    map.on(RELAYOUT_LABELS, place);
    return () => {
      window.clearTimeout(settle);
      map.off("moveend", placeWhenStill);
      map.off("resize", placeWhenStill);
      map.off(RELAYOUT_LABELS, place);
    };
  }, [ready, rings, overlays.rings.on, reach]);

  // ---------- routes ----------
  const results = useStore((s) => s.results);
  const selectedProfile = useStore((s) => s.selectedProfile);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    (map.getSource("routes") as GeoJSONSource).setData(routeFeatures(results));
    const sel = selectedResult({ results, selectedProfile })?.profile.id ?? "";
    map.setFilter("routes-alt", ["!=", ["get", "profile"], sel]);
    map.setFilter("route-casing", ["==", ["get", "profile"], sel]);
    map.setFilter("route-sel", ["==", ["get", "profile"], sel]);
    map.setFilter("route-over", ["all", ["==", ["get", "profile"], sel], ["==", ["get", "over"], 1]]);
  }, [ready, results, selectedProfile]);

  // ---------- selected route coloured by slope ----------
  const walkParams = useStore((s) => s.params);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    (map.getSource("route-slope") as GeoJSONSource | undefined)?.setData(routeSlopeFeatures(selectedResult({ results, selectedProfile }), walkParams));
  }, [ready, results, selectedProfile, walkParams]);

  // ---------- POI markers ----------
  const poisOn = useStore((s) => s.overlays.pois.on);
  const selectedPoi = useStore((s) => s.selectedPoi);
  const poiPins = useRef<{ el: HTMLElement; poi: Poi }[]>([]);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map || !poisOn) return;
    poiPins.current = [];
    const markers = area.config.pois.map((p) => {
      const el = poiEl(p);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        useStore.getState().set({ selectedPoi: p, selectedWaypoint: null, mapClick: null, tab: useStore.getState().tab });
      });
      poiPins.current.push({ el, poi: p });
      return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(map);
    });
    return () => {
      markers.forEach((m) => m.remove());
      poiPins.current = [];
    };
  }, [ready, poisOn, area]);

  // ---------- start + stop markers ----------
  const start = useStore((s) => s.start);
  const stops = useStore((s) => s.stops);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    const ms: maplibregl.Marker[] = [];
    if (start) {
      const el = document.createElement("div");
      el.className = STOP_START;
      el.textContent = "S";
      el.title = `Start: ${start.name.replace(/^start:\s*/i, "")} (drag to move)`;
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(start.lonLat).addTo(map);
      m.on("dragend", () => {
        const ll = m.getLngLat();
        useStore.getState().setStart({ lonLat: [ll.lng, ll.lat], name: "Custom start" });
      });
      ms.push(m);
    }
    stops.forEach((s, i) => {
      const el = document.createElement("div");
      el.className = STOP_NUMBER;
      el.textContent = String(i + 1);
      el.title = `${i + 1}. ${s.name} (drag to move)`;
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(s.lonLat).addTo(map);
      m.on("dragend", () => {
        const ll = m.getLngLat();
        const st = useStore.getState();
        st.set({ stops: st.stops.map((x) => (x.id === s.id ? { ...x, lonLat: [ll.lng, ll.lat], poiId: undefined, name: x.poiId ? `${x.name} (moved)` : x.name } : x)) });
      });
      ms.push(m);
    });
    return () => ms.forEach((m) => m.remove());
  }, [ready, start, stops]);

  // ---------- POI label placement (after the plan markers, which are obstacles) ----------
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map || !poisOn) return;
    const inPlan = new Set([start?.poiId, ...stops.map((s) => s.poiId)].filter(Boolean));
    const pins = poiPins.current.map(({ el, poi }, i) => {
      const sel = selectedPoi?.id === poi.id;
      el.classList.toggle("selected", sel);
      el.classList.toggle("in-plan", inPlan.has(poi.id));
      return { el, ll: [poi.lon, poi.lat] as LonLat, rank: (sel ? 0 : inPlan.has(poi.id) ? 100 : 200) + i };
    });
    const place = () => placePoiLabels(map, pins);
    const raf = requestAnimationFrame(place);
    // Again once cards / chips that mount in the same update have laid out.
    const late = window.setTimeout(place, 300);
    // Placing reads the layout of every marker, so while the map moves it runs a few times a second, not every frame.
    let last = 0, trailing: number | undefined;
    const onMove = () => {
      const now = performance.now();
      window.clearTimeout(trailing);
      if (now - last >= LABEL_MOVE_INTERVAL_MS) {
        last = now;
        place();
      } else trailing = window.setTimeout(place, LABEL_MOVE_INTERVAL_MS);
    };
    map.on("move", onMove);
    map.on("resize", place);
    map.on(RELAYOUT_LABELS, place);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      window.clearTimeout(trailing);
      map.off("move", onMove);
      map.off("resize", place);
      map.off(RELAYOUT_LABELS, place);
    };
  }, [ready, poisOn, area, selectedPoi, start, stops, rings, results, tab]);

  // ---------- cursor (profile scrub; the Go position is the animated walker in GoWalker) ----------
  const cursor = useStore((s) => s.profileCursor);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    const f: GeoJSON.Feature[] = [];
    if (cursor) f.push({ type: "Feature", properties: { kind: "profile" }, geometry: { type: "Point", coordinates: cursor } });
    (map.getSource("cursor") as GeoJSONSource).setData({ type: "FeatureCollection", features: f });
  }, [ready, cursor]);

  // ---------- 3D ----------
  const view3d = useStore((s) => s.view3d);
  const exaggeration = useStore((s) => s.exaggeration);
  const last3d = useRef(false);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    const byTilt = tiltDriven;
    tiltDriven = false;
    // Only a 2D/3D switch moves the camera; changing the vertical scale must not.
    const switched = last3d.current !== view3d;
    last3d.current = view3d;
    // Tilt gestures work from the flat map too (they switch 3D on), so only a map without elevation is locked flat.
    const hasElev = !!area.overview.elevation;
    map.setMaxPitch(hasElev ? 80 : 0);
    if (hasElev) map.touchPitch.enable();
    else map.touchPitch.disable();
    if (view3d && hasElev) {
      map.setTerrain({ source: "dem", exaggeration });
      tuneTerrain(map, area.manifest.grid);
      // The camera keeps its altitude above the *centre* elevation; refresh it once DEM tiles are
      // in so the camera is not left inside a raised mesa.
      const lift = () => {
        const e = map.queryTerrainElevation(map.getCenter());
        if (e != null) map.jumpTo({ elevation: e });
      };
      map.once("idle", lift);
      // The 3D button swings the camera down; a tilt gesture is already holding it where the user wants.
      if (switched && !byTilt && map.getPitch() < 30) map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, duration: 900 });
    } else {
      map.setTerrain(null);
      // The 2D button levels the camera and faces north; levelling by gesture keeps the heading.
      if (switched && !byTilt && map.getPitch() > 0) {
        levelling = true;
        map.once("moveend", () => (levelling = false));
        map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      }
    }
  }, [ready, view3d, exaggeration, area]);

  const renderDistanceKm = useStore((s) => s.renderDistanceKm);
  useEffect(() => setRenderDistance(mapInstance, renderDistanceKm), [ready, renderDistanceKm]);

  // ---------- click popup ----------
  const mapClick = useStore((s) => s.mapClick);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map || !mapClick) {
      setPopupEl(null);
      return;
    }
    const el = document.createElement("div");
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, className: "click-popup", maxWidth: "260px", offset: 8 })
      .setLngLat(mapClick)
      .setDOMContent(el)
      .addTo(map);
    popup.on("close", () => {
      if (useStore.getState().mapClick === mapClick) useStore.getState().set({ mapClick: null });
    });
    setPopupEl(el);
    return () => {
      popup.remove();
    };
  }, [ready, mapClick]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 touch-none" />
      {popupEl && mapClick && createPortal(<ClickMenu lonLat={mapClick} />, popupEl)}
    </>
  );
}
