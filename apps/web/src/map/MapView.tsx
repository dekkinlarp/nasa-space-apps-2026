import { CompassControl } from "./compassControl";
import { ZoomHomeControl } from "./zoomHomeControl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MLMap } from "maplibre-gl";
import { MAP_LABEL_BASE, MAP_LABEL_BOX, MAP_LABEL_POST, MAP_LABEL_TONE, STOP_BADGE, STOP_BADGE_NUMBER, STOP_BADGE_START } from "./mapLabel";
import { mapPalette } from "./mapPalette";
import type { GridSpec, LonLat, ReachRing, RouteResult } from "@marsmap/core";
import { selectedResult, useStore, type LayerState, type OverlayId } from "../store";
import type { AreaData, DisplayLayers, Poi } from "../types";
import { M_PER_DEG_LAT } from "../geo";
import { sampleBest } from "../lib";
import { confidenceUrl, costUrl, elevationUrl, SCIENCE_RAMPS, scienceUrl, slopeUrl, surfaceUrl } from "./rasters";
import { loadFloatLayer } from "../data";
import { CONTOUR_COLOR, CONTOUR_FINE_ZOOM, CONTOUR_MID_ZOOM, contourFeatures } from "./contours";
import { demHeight, demMaxZoom, demTilesUrl, DEM_TILE_SIZE, registerDemProtocol, setDemSource } from "./dem";
import { IMAGERY_TILE_SIZE, imageryGroups, imageryMaxZoom, imageryTilesUrl, registerImageryProtocol, setImageryArea } from "./imageryTiles";
import { fmtDur } from "../format";
import { ClickMenu } from "../components/ClickMenu";
import { routeSlopeFeatures, routeTickFeatures } from "./routeSlope";
import { setRenderDistance, tuneTerrain } from "./terrainPerf";
import { followGroundAfterEase, keepCameraAboveGround } from "./cameraClearance";

/**
 * The live map and the state that belongs to it. One object, so that in development it can be kept on
 * Vite's hot-module data: when a component this file imports is edited, Vite evaluates this file again,
 * and a fresh copy with no map would be swapped in under the mounted <MapView>, which then ignores the app.
 */
interface Live {
  map: MLMap | null;
  ready: boolean;
  /** The scale bar is MapLibre's element, moved out of its corner into a slot the app lays out. */
  scaleEl: HTMLElement | null;
  scaleSlot: HTMLElement | null;
  /** Set while the map is still opening: fits the opening view again (see the map's load handler). */
  refitOpening: (() => void) | null;
  pendingInsets: { top?: number; right?: number; bottom?: number; left?: number } | null;
  /** Set when a hold has just opened the menu, so the tap that ends the hold does not reopen it elsewhere. */
  suppressNextClick: number;
  /** True while the 2D/3D state is being changed by a tilt gesture rather than the 2D/3D buttons. */
  tiltDriven: boolean;
  /** True while the 2D/3D buttons are swinging the camera, so that animation is not read as a tilt gesture. */
  switching: boolean;
  stopTerrainAnim: (() => void) | null;
  stopGlide: (() => void) | null;
}
const newLive = (): Live => ({ map: null, ready: false, scaleEl: null, scaleSlot: null, refitOpening: null, pendingInsets: null, suppressNextClick: 0, tiltDriven: false, switching: false, stopTerrainAnim: null, stopGlide: null });
const hotData = import.meta.hot?.data as { live?: Live } | undefined;
const live: Live = hotData ? (hotData.live ??= newLive()) : newLive();
export const getMap = () => live.map;

const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export { imageryGroup } from "./imageryTiles";

/** How often POI labels are re-placed while the map is moving. */
const LABEL_MOVE_INTERVAL_MS = 120;
/** Round-trip time rings are dotted ink; the outermost (walk-limit) ring is the warning colour. Shared with the map key. */
export const ringColors = () => ({ ring: mapPalette().ink, limit: mapPalette().warn });
/** Opacity multiplier for Curiosity's traverse while the Plan tab is open. */
const TRACK_PLAN_FADE = 0.28;
const DEFAULT_TRACK_STATE = useStore.getState().overlays.track;
/** True when the traverse should recede: Plan tab open and the user has not set the track layer themselves. */
export const isTrackFaded = (tab: string, track: LayerState) => tab === "plan" && track === DEFAULT_TRACK_STATE;

const placeScaleBar = () => {
  if (live.scaleEl && live.scaleSlot && live.scaleEl.parentElement !== live.scaleSlot) live.scaleSlot.appendChild(live.scaleEl);
};
/** Give the scale bar a home in the app's own layout. Safe to call before or after the map exists. */
export function mountScaleBar(slot: HTMLElement | null) {
  live.scaleSlot = slot;
  placeScaleBar();
}
const OPENING_SETTLE_MS = 3000;

/**
 * Tell the map how much of its canvas is covered by floating panels, so "centre" means the centre of
 * the part the user can see. Eased, so the ground glides aside as a panel opens.
 */
export function setMapInsets(p: { top?: number; right?: number; bottom?: number; left?: number }, ms = 380) {
  const map = live.map;
  if (!map) return;
  if (!live.ready) {
    // Asked before the map's first frame: remembered, and applied without animation when it loads.
    live.pendingInsets = p;
    return;
  }
  const padding = { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 };
  const cur = map.getPadding();
  if (cur.top === padding.top && cur.right === padding.right && cur.bottom === padding.bottom && cur.left === padding.left) return;
  if (live.refitOpening) {
    // Still opening: take the insets at once and fit the opening view inside them.
    map.jumpTo({ padding });
    live.refitOpening();
    return;
  }
  map.easeTo({ padding, duration: ms, easing: (t) => 1 - Math.pow(1 - t, 3) });
}

/** Resize the map on every frame for a while, so it tracks a panel that is sliding open or shut. */
export function resizeMapDuring(ms: number) {
  const until = performance.now() + ms + 80;
  const step = () => {
    live.map?.resize();
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

/** How long the ground takes to rise when the 3D button is pressed, to sink for the 2D button, and to do either for a tilt gesture. */
const TERRAIN_RISE_MS = 900;
const TERRAIN_LEVEL_MS = 650;
const TERRAIN_TILT_MS = 350;
/** Longest the transition waits for the first terrain heights before starting anyway. */
const TERRAIN_WAIT_MS = 600;
/** Terrain is switched on at this height (not 0, so loaded heights can be told from missing ones). */
const TERRAIN_FLAT = 0.001;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The 2D/3D transition: ease the height of the terrain to a vertical exaggeration (0 is flat) and, when
 * `camera` is given, swing the camera to that pitch and heading in the same motion. `done` runs when it gets there.
 *
 * The camera is moved with jumpTo on every frame rather than one easeTo: jumpTo puts the camera on the
 * ground under the centre each time, so it rides up with the rising ground, where easeTo (MapLibre 5.24)
 * holds the height it started with. Touching the map hands the camera back to the user; the ground still finishes moving.
 */
function animateTerrain(map: MLMap, exaggeration: number, camera: { pitch: number; bearing: number } | null, ms: number, done?: () => void) {
  live.stopTerrainAnim?.();
  if (camera) live.stopGlide?.();
  const terrain = map.terrain;
  if (!terrain) return;
  const from = { exaggeration: terrain.exaggeration, pitch: map.getPitch(), bearing: map.getBearing() };
  // Turn the short way round.
  const turn = camera ? ((camera.bearing - from.bearing + 540) % 360) - 180 : 0;
  const el = map.getCanvasContainer();
  const INPUT = ["pointerdown", "wheel", "touchstart"] as const;
  let raf = 0;
  let steering = !!camera;
  const release = () => {
    steering = false;
    live.switching = false;
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    for (const ev of INPUT) el.removeEventListener(ev, release);
    if (steering) live.switching = false;
    live.stopTerrainAnim = null;
  };
  live.stopTerrainAnim = stop;
  if (steering) {
    live.switching = true;
    for (const ev of INPUT) el.addEventListener(ev, release, { passive: true });
  }
  // Rising from flat waits (briefly) for the heights under the centre to load, so the camera is never
  // moved against ground MapLibre cannot measure yet.
  const asked = performance.now();
  let t0 = asked;
  let waiting = from.exaggeration < 0.01 && exaggeration > 0;
  const groundLoaded = () => {
    const c = map.getCenter();
    const want = demHeight(c.lng, c.lat);
    const got = terrain.getElevationForLngLatZoom(c, map.transform.tileZoom) / (terrain.exaggeration || 1);
    return Math.abs(got - want) <= Math.max(50, Math.abs(want) * 0.1);
  };
  const step = () => {
    if (map.terrain !== terrain) return stop();
    if (waiting) {
      t0 = performance.now();
      waiting = t0 - asked < TERRAIN_WAIT_MS && !groundLoaded();
      if (waiting) {
        map.triggerRepaint();
        raf = requestAnimationFrame(step);
        return;
      }
    }
    const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
    const e = easeInOut(k);
    terrain.exaggeration = from.exaggeration + (exaggeration - from.exaggeration) * e;
    if (steering && camera) map.jumpTo({ pitch: from.pitch + (camera.pitch - from.pitch) * e, bearing: from.bearing + turn * e });
    else map.triggerRepaint();
    if (k < 1) raf = requestAnimationFrame(step);
    else {
      stop();
      done?.();
    }
  };
  step();
}

/** True while glideTo is moving the camera (map.isMoving() is false between its steps). */
export const isCameraGliding = () => !!live.stopGlide;

/**
 * Move the camera to a view over `ms`, one jumpTo per frame. Used instead of easeTo because in 3D
 * easeTo (MapLibre 5.24) keeps the ground height of the place it left for the whole move, which
 * buries the camera when the destination is higher. Each step here is given the ground height under
 * its own centre. Touching the map stops it where it is.
 */
function glideTo(map: MLMap, to: { center: maplibregl.LngLat; zoom: number; pitch: number; bearing: number }, ms: number) {
  live.stopGlide?.();
  const from = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  const turn = ((to.bearing - from.bearing + 540) % 360) - 180;
  const el = map.getCanvasContainer();
  const INPUT = ["pointerdown", "wheel", "touchstart"] as const;
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    for (const ev of INPUT) el.removeEventListener(ev, stop);
    live.switching = false;
    live.stopGlide = null;
  };
  live.stopGlide = stop;
  live.switching = true;
  for (const ev of INPUT) el.addEventListener(ev, stop, { passive: true });
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    const e = easeInOut(k);
    const lng = from.center.lng + (to.center.lng - from.center.lng) * e, lat = from.center.lat + (to.center.lat - from.center.lat) * e;
    map.jumpTo({
      center: [lng, lat],
      zoom: from.zoom + (to.zoom - from.zoom) * e,
      pitch: from.pitch + (to.pitch - from.pitch) * e,
      bearing: from.bearing + turn * e,
      ...(map.terrain ? { elevation: demHeight(lng, lat) * map.terrain.exaggeration } : {}),
    });
    if (k < 1) raf = requestAnimationFrame(step);
    else stop();
  };
  step();
}

/**
 * Fly the camera to a point or to a box of ground: the app's "show on the map" move. In 2D this is
 * MapLibre's own flight; in 3D it is glideTo, keeping the tilt and heading the user has set.
 */
export function showOnMap(target: { center: LonLat; zoom: number } | { bounds: [LonLat, LonLat]; padding: number; maxZoom: number }, ms = 900) {
  const map = live.map;
  if (!map) return;
  if ("center" in target) {
    if (!map.terrain) map.flyTo({ center: target.center, zoom: target.zoom, duration: ms });
    else glideTo(map, { center: maplibregl.LngLat.convert(target.center), zoom: target.zoom, pitch: map.getPitch(), bearing: map.getBearing() }, ms);
    return;
  }
  if (!map.terrain) return void map.fitBounds(target.bounds, { padding: target.padding, maxZoom: target.maxZoom, duration: ms });
  const cam = map.cameraForBounds(target.bounds, { padding: target.padding, maxZoom: target.maxZoom, bearing: map.getBearing() });
  if (cam?.center && cam.zoom != null) glideTo(map, { center: maplibregl.LngLat.convert(cam.center), zoom: cam.zoom, pitch: map.getPitch(), bearing: map.getBearing() }, ms);
}

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
      live.suppressNextClick = performance.now();
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

/**
 * The planning window as four corner brackets. It is a boundary, not an estimate, so it is not drawn dashed;
 * brackets mark the square without ruling a line across the ground.
 */
function windowBrackets(c: [number, number][]): GeoJSON.FeatureCollection {
  const [nw, ne, se, sw] = c as [[number, number], [number, number], [number, number], [number, number]];
  const ARM = 0.06;
  const dx = (ne[0] - nw[0]) * ARM, dy = (nw[1] - sw[1]) * ARM;
  const corner = (p: [number, number], sx: number, sy: number): GeoJSON.Feature => ({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [[p[0] + sx * dx, p[1]], p, [p[0], p[1] + sy * dy]] },
  });
  return { type: "FeatureCollection", features: [corner(nw, 1, -1), corner(ne, -1, -1), corner(se, -1, 1), corner(sw, 1, 1)] };
}

/**
 * A waypoint of the rover's track: the same lit dome as a place pin, drawn as an image because the track's
 * dots are on the map canvas. 20 px across at twice the screen's pixels, so 10 px on screen at full size.
 */
const DOME_IMG = "rover-dome";
function domeImage(fill: string, casing: string): ImageData | null {
  const S = 28;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d");
  if (!g) return null;
  const cx = S / 2, cy = S / 2 - 1, r = 9;
  // The shadow it casts on the ground, then the keyline, the dome, a highlight under its top edge and shade below.
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.beginPath();
  g.ellipse(cx, cy + 4, r + 1, r - 1, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = casing;
  g.beginPath();
  g.arc(cx, cy, r + 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fill;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.clip();
  const shade = g.createLinearGradient(0, cy - r, 0, cy + r);
  shade.addColorStop(0, "rgba(255,255,255,0.75)");
  shade.addColorStop(0.3, "rgba(255,255,255,0)");
  shade.addColorStop(0.6, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = shade;
  g.fillRect(0, 0, S, S);
  g.restore();
  return g.getImageData(0, 0, S, S);
}

/** The bar drawn across the selected route every 100 m: ink with a black keyline, 14 x 4 px. */
const TICK_IMG = "route-tick";
function tickImage(ink: string, casing: string): ImageData | null {
  const c = document.createElement("canvas");
  c.width = 28;
  c.height = 8;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = casing;
  g.fillRect(0, 0, 28, 8);
  g.fillStyle = ink;
  g.fillRect(2, 2, 24, 4);
  return g.getImageData(0, 0, 28, 8);
}

/**
 * In 3D nearer markers draw over farther ones: each marker's stacking order is how far down the screen it
 * sits. In 2D the order is left to the markers themselves.
 */
function sortMarkersByDepth(map: MLMap) {
  const c = map.getContainer();
  const in3d = c.classList.contains("map-3d");
  c.querySelectorAll<HTMLElement>(".maplibregl-marker").forEach((el) => {
    el.style.zIndex = in3d ? String(Math.round(el.getBoundingClientRect().bottom)) : "";
  });
}

function routeFeatures(results: RouteResult[] | null): GeoJSON.FeatureCollection {
  if (!results) return EMPTY_FC;
  const features: GeoJSON.Feature[] = [];
  results.forEach((r) => {
    const over = r.totals.firstSegmentOverLimit;
    r.segments.forEach((s, si) => {
      if (s.path.length < 2) return;
      features.push({
        type: "Feature",
        properties: { profile: r.profile.id, seg: si, over: over != null && si >= over ? 1 : 0 },
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
const LABEL_OBSTACLES = ".view-ctl, .maplibregl-ctrl-top-right, .map-legend, .readout, .card-slot > *, .go-panel, .map-safety, .profile, .status-bar";

/** The floating panels live beside the map layer, not inside it, so obstacles are looked up from the app root. */
const obstacleRoot = (container: HTMLElement) => container.closest(".app") ?? container.parentElement;

/**
 * Put each ring label on the topmost point of its ring that keeps the whole label inside the
 * visible map, clear of the map controls and of the other ring labels; hide it if there is none.
 */
function placeRingLabels(map: MLMap, markers: maplibregl.Marker[], labels: { el: HTMLElement; outline: number[][] }[]) {
  const container = map.getContainer();
  const W = container.clientWidth, H = container.clientHeight;
  const cr = container.getBoundingClientRect();
  const obstacles: Box[] = [];
  obstacleRoot(container)?.querySelectorAll(LABEL_OBSTACLES).forEach((n) => {
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
 * Domed shapes with a dark keyline and a light ring, legible on bright and dark ground.
 */
const POI_FILL: Record<string, string> = {
  "drill-site": "scale-[0.82] rotate-45 rounded-[1px]! bg-poi-drill-site",
  "science-target": "bg-well inset-ring-[2.5px] inset-ring-poi-science-target",
  start: "rounded-[2px]! bg-poi-start",
  viewpoint: "bg-poi-viewpoint",
};
/** MapLibre makes markers position: absolute, which also anchors the label. */
const POI_PIN = "poi-pin group/pin flex size-3.5 cursor-pointer items-center gap-1.5 hover:z-[100000]! [&.selected]:z-[100000]!";
/** A pin is a small dome lit from above (shadow-dome in index.css), in the colour of its kind of place. */
const POI_DOT = "block size-3 rounded-full shadow-dome transition-transform duration-[120ms] ease-out-quint group-[:is(:hover,.selected)]/pin:scale-120 coarse:size-4";
/** A place name is a plate (MAP_LABEL_BOX). In 2D it sits beside the dot (further out once the pin carries a stop
    number) and flips to the left near an edge. In 3D it stands on a post above the dot, which is the post's foot.
    Either way it hides when it would collide, and shows the full name on hover or when selected. */
const POI_LABEL = `poi-label ${MAP_LABEL_BOX} ${MAP_LABEL_TONE.strong} pointer-events-none absolute -top-[5px] left-[19px] tracking-[0.06em] uppercase transition-[top,left,right,translate] duration-200 ease-out-quint group-[.in-plan]/pin:left-[23px] group-[.flip]/pin:right-[19px] group-[.flip]/pin:left-auto group-[.in-plan.flip]/pin:right-[23px] group-[.in-plan.flip]/pin:left-auto group-[.lbl-off:not(:hover,.selected)]/pin:invisible [.lowzoom_&]:hidden [.lowzoom_.poi-pin:hover_&]:inline-flex [.map-3d_&]:-top-[36px] [.map-3d_&]:right-auto! [.map-3d_&]:left-1/2! [.map-3d_&]:-translate-x-1/2 [.map-3d_&]:after:absolute [.map-3d_&]:after:top-full [.map-3d_&]:after:left-1/2 [.map-3d_&]:after:-ml-px [.map-3d_&]:after:map-post [.map-3d_&]:after:content-['']`;
/** Stop markers carry the same badge as the stop numbers in the Plan tab's list, larger and with a keyline for the ground. */
const STOP_MARKER = `stop-marker ${STOP_BADGE} size-[22px] cursor-grab text-[11px] coarse:size-[30px] coarse:text-base`;
const STOP_NUMBER = `${STOP_MARKER} ${STOP_BADGE_NUMBER} shadow-[0_0_0_1px_rgba(0,0,0,0.6)]`;
const STOP_START = `${STOP_MARKER} ${STOP_BADGE_START} shadow-[0_0_0_1px_rgba(255,255,255,0.8)]`;
/** A ring label: the plate, and in 3D the post and foot under it. The marker is anchored at its bottom, on the ring. */
const RING_LABEL = "ring-label pointer-events-none flex cursor-help flex-col items-center";

function poiEl(p: Poi): HTMLElement {
  const el = document.createElement("div");
  el.className = POI_PIN;
  el.innerHTML = `<span class="${POI_DOT} ${POI_FILL[p.type] ?? ""} ${p.type === "start" ? "rounded-[2px]" : ""}"></span><span class="${POI_LABEL}"><span class="pl-short group-[:is(:hover,.selected)]/pin:hidden"></span><span class="pl-full hidden group-[:is(:hover,.selected)]/pin:inline"></span></span>`;
  (el.querySelector(".pl-short") as HTMLElement).textContent = poiShortName(p);
  (el.querySelector(".pl-full") as HTMLElement).textContent = p.name;
  el.title = p.name;
  // MapLibre would call every marker "Map marker"; a pin is named for its place.
  el.setAttribute("aria-label", `${p.name}, ${p.type.replace("-", " ")}`);
  el.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    el.click();
  });
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
  obstacleRoot(container)?.querySelectorAll(`${LABEL_OBSTACLES}, .stop-marker, .pnr-chip, .ring-label`).forEach((n) => {
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
  // In 3D the plate stands above its dot on a 14px post; in 2D it lies to one side.
  const in3d = container.classList.contains("map-3d");
  [...pins]
    .map((pin, i) => ({ ...pin, i }))
    .sort((a, b) => a.rank - b.rank)
    .forEach(({ el, i }) => {
      const label = el.querySelector(".poi-label") as HTMLElement | null;
      const w = label?.offsetWidth || 94, h = 18;
      const d = dots[i]!;
      const cx = (d.l + d.r) / 2, cy = (d.t + d.b) / 2;
      // Gap between pin centre and label: wider when a plan marker (S / 1, 2, ...) sits on the pin.
      const off = el.classList.contains("in-plan") ? 14 : 10;
      const sides = in3d
        ? [{ flip: false, box: { l: cx - w / 2, t: cy - 7 - 14 - h, r: cx + w / 2, b: cy - 7 } }]
        : [
            { flip: false, box: { l: cx + off, t: cy - h / 2, r: cx + off + w, b: cy + h / 2 } },
            { flip: true, box: { l: cx - off - w, t: cy - h / 2, r: cx - off, b: cy + h / 2 } },
          ];
      // A plan marker sitting on the pin is its own, not an obstacle. A panel over the pin still is: the label hides with it.
      const own = (o: Box) => o.r - o.l <= 40 && o.l <= cx && o.r >= cx && o.t <= cy && o.b >= cy;
      const ok = sides.find(({ box }) => {
        if (box.l < M || box.t < M || box.r > W - M || box.b > H - M) return false;
        if (obstacles.some((o) => !own(o) && boxesHit(box, o)) || placed.some((o) => boxesHit(box, o))) return false;
        return !dots.some((o, j) => j !== i && boxesHit(box, o));
      });
      el.classList.toggle("flip", !in3d && (ok ? ok.flip : d.r + w > W - M));
      el.classList.toggle("lbl-off", !ok);
      if (ok) placed.push(ok.box);
    });
}

/** Margin kept round the points of interest in the opening (and home) view, px. */
const HOME_PADDING = 40;
const HOME_MS = 900;
/** The angle the 3D button and the home button put the camera at. */
/**
 * The heading the map opens at and comes home to: south at the top of the screen, i.e. the map turned
 * half a turn from north-up. The compass still turns north up when clicked.
 */
const HOME_BEARING = 180;
const HOME_3D = { pitch: 60, bearing: HOME_BEARING - 20 };

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
      bearing: HOME_BEARING,
      fitBoundsOptions: { padding: HOME_PADDING, bearing: HOME_BEARING },
      maxBounds: [g.west - padLon, g.south - padLat, g.east + padLon, g.north + padLat],
      minZoom: 10,
      maxZoom: 21,
      maxPitch: 80,
      attributionControl: false,
      dragRotate: true,
      scrollZoom: false, // replaced by attachGestures
      renderWorldCopies: false,
    });
    live.map = map;
    const detachGestures = attachGestures(map);
    keepCameraAboveGround(map);
    followGroundAfterEase(map);
    // Home: the opening view of the points of interest, at the default angle of the current mode
    // (3D: tilted and turned a little; 2D: straight down, at the home heading).
    const goHome = () => {
      const in3d = useStore.getState().view3d && !!map.terrain;
      const bearing = in3d ? HOME_3D.bearing : HOME_BEARING;
      const cam = map.cameraForBounds(initialBounds(area), { padding: HOME_PADDING, bearing });
      // Not while the 2D/3D switch is still swinging the camera.
      if (!cam?.center || cam.zoom == null || (live.switching && !live.stopGlide)) return;
      glideTo(map, { center: maplibregl.LngLat.convert(cam.center), zoom: cam.zoom, pitch: in3d ? HOME_3D.pitch : 0, bearing }, HOME_MS);
    };
    // Top-right corner, stacking downward: the zoom and home strip, then the compass dial.
    map.addControl(new ZoomHomeControl(goHome), "top-right");
    map.addControl(new CompassControl(), "top-right");
    // MapLibre draws the scale bar; the app shows it beside the view controls (see mountScaleBar).
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    live.scaleEl = map.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-scale");
    placeScaleBar();
    (window as unknown as { __map: MLMap }).__map = map;

    map.on("load", () => {
      live.ready = true;
      if (live.pendingInsets) {
        const p = live.pendingInsets;
        live.pendingInsets = null;
        setMapInsets(p, 0);
      }
      // Fit the opening view again now the map has its final size and insets, so it is the view home returns to.
      // The panels report their insets a little after load, so the fit is repeated for those until the user touches the map.
      const refit = () => {
        const cam = map.cameraForBounds(initialBounds(area), { padding: HOME_PADDING, bearing: HOME_BEARING });
        if (cam) map.jumpTo(cam);
      };
      refit();
      live.refitOpening = refit;
      const settle = () => {
        live.refitOpening = null;
        for (const ev of ["pointerdown", "wheel", "touchstart"]) map.getCanvasContainer().removeEventListener(ev, settle);
      };
      for (const ev of ["pointerdown", "wheel", "touchstart"]) map.getCanvasContainer().addEventListener(ev, settle, { passive: true });
      setTimeout(settle, OPENING_SETTLE_MS);
      const coords = gridCoords(g);
      // The mapped square is solid ground: with imagery faded or off it stays dark instead of showing stars through it.
      map.addSource("ground", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] } } });
      map.addLayer({ id: "ground", type: "fill", source: "ground", paint: { "fill-color": "#0a0b0d", "fill-antialias": false } });
      // Base imagery: one tiled source per imagery group (overview and full-resolution pieces together).
      for (const grp of imageryGroups()) {
        const url = imageryTilesUrl(grp.id, useStore.getState().marsTint);
        shownUrl.current.set(grp.id, url);
        map.addSource(`img-${grp.id}`, { type: "raster", tiles: [url], tileSize: IMAGERY_TILE_SIZE, maxzoom: imageryMaxZoom(grp), bounds: grp.bounds });
        // The ground is dimmed a little so the white route and the black chrome both hold against it.
        map.addLayer({ id: `img-${grp.id}`, type: "raster", source: `img-${grp.id}`, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": "linear", "raster-brightness-max": 0.68, "raster-contrast": 0.12 } });
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
      // Contour lines: heavy every 250 m; the 50 m and then the 10 m lines join in as the map zooms in.
      map.addSource("contours", { type: "geojson", data: EMPTY_FC, tolerance: 0.2 });
      const contourLayer = (id: string, tier: number, minzoom: number, width: maplibregl.ExpressionSpecification | number) =>
        map.addLayer({ id, type: "line", source: "contours", minzoom, filter: ["==", ["get", "tier"], tier], layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": CONTOUR_COLOR, "line-width": width } });
      contourLayer("contours-fine", 1, CONTOUR_FINE_ZOOM, 0.6);
      // Among the 10 m lines the 50 m ones are the heavy ones too.
      contourLayer("contours-mid", 2, CONTOUR_MID_ZOOM, ["step", ["zoom"], 0.6, CONTOUR_FINE_ZOOM, 1.3]);
      contourLayer("contours-index", 3, 0, 1.3);
      map.addSource("window", { type: "geojson", data: EMPTY_FC });
      const C = mapPalette();
      map.addLayer({ id: "window-casing", type: "line", source: "window", layout: { "line-cap": "square", "line-join": "miter" }, paint: { "line-color": C.casing, "line-width": 4, "line-opacity": 0.5 } });
      map.addLayer({ id: "window", type: "line", source: "window", layout: { "line-cap": "square", "line-join": "miter" }, paint: { "line-color": C.ink, "line-width": 1.5, "line-opacity": 0.85 } });
      map.addSource("rings", { type: "geojson", data: EMPTY_FC });
      // Time rings are modelled, so they are broken lines: dotted ink on a dark keyline.
      map.addLayer({ id: "rings-casing", type: "line", source: "rings", layout: { "line-join": "round" }, paint: { "line-color": C.casing, "line-width": 3.5, "line-opacity": 0.45 } });
      map.addLayer({ id: "rings-line", type: "line", source: "rings", filter: ["<", ["get", "t"], 1], paint: { "line-color": C.ink, "line-width": 1.25, "line-dasharray": [1.6, 3] } });
      // Walk-limit ring (and the no-go loops inside it): solid, in the warning colour, drawn over the time rings where they coincide.
      map.addLayer({ id: "rings-limit", type: "line", source: "rings", filter: [">=", ["get", "t"], 1], layout: { "line-join": "round" }, paint: { "line-color": C.warn, "line-width": 1.6 } });

      map.addSource("track", { type: "geojson", data: area.rover.traverse ?? EMPTY_FC });
      // The rover's track was measured, so it is a solid line.
      map.addLayer({ id: "track-casing", type: "line", source: "track", layout: { "line-join": "round" }, paint: { "line-color": C.casing, "line-width": 3.5, "line-opacity": 0.5 } });
      map.addLayer({ id: "track", type: "line", source: "track", layout: { "line-join": "round" }, paint: { "line-color": C.rover, "line-width": 1.25 } });
      map.addSource("waypoints", {
        type: "geojson",
        data: { type: "FeatureCollection", features: area.rover.waypoints.map((w, i) => ({ type: "Feature", properties: { i, sol: w.sol }, geometry: { type: "Point", coordinates: w.lonLat } })) },
      });
      // Waypoints are domes like the place pins: an image, standing up to the viewer, growing as the map zooms in.
      const dome = domeImage(C.rover, C.casing);
      if (dome && !map.hasImage(DOME_IMG)) map.addImage(DOME_IMG, dome, { pixelRatio: 2 });
      map.addLayer({ id: "waypoints", type: "symbol", source: "waypoints", layout: { "icon-image": DOME_IMG, "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.45, 18, 1], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-pitch-alignment": "viewport" } });

      map.addSource("routes", { type: "geojson", data: EMPTY_FC });
      // The routes not chosen: grey hairlines on a thin casing. The one pointed at in the route table is brightened (see hoverProfile).
      map.addLayer({ id: "routes-alt-casing", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": C.casing, "line-width": 4, "line-opacity": 0.7 } });
      map.addLayer({ id: "routes-alt", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": C.ink2, "line-width": 1.5 } });
      map.addLayer({ id: "route-casing", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": C.casing, "line-width": 7 } });
      // Selected route: ink, taking the warning colour on hazard slope and the over-limit colour at the no-go slope
      // (pieces built from the segment profiles).
      map.addSource("route-slope", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "route-sel", type: "line", source: "route-slope", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3 } });
      // Legs past the limit are hypothetical, so they are dashed.
      map.addLayer({ id: "route-over", type: "line", source: "routes", layout: { "line-join": "round" }, paint: { "line-color": C.bad, "line-width": 3, "line-dasharray": [1.2, 1.2] } });
      // A bar across the selected route every 100 m, so the line reads as a ruler.
      const tick = tickImage(C.ink, C.casing);
      if (tick && !map.hasImage(TICK_IMG)) map.addImage(TICK_IMG, tick, { pixelRatio: 2 });
      map.addSource("route-ticks", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "route-ticks", type: "symbol", source: "route-ticks", layout: { "icon-image": TICK_IMG, "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true } });

      map.addSource("cursor", { type: "geojson", data: EMPTY_FC });
      // The walk's position is a dot in a thin ring, both keylined; the profile's cursor keeps its soft halo.
      map.addLayer({ id: "cursor-ring-casing", type: "circle", source: "cursor", filter: ["==", ["get", "kind"], "go"], paint: { "circle-radius": 12, "circle-opacity": 0, "circle-stroke-color": C.casing, "circle-stroke-width": 4 } });
      map.addLayer({ id: "cursor-halo", type: "circle", source: "cursor", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "go"], 12, 9], "circle-color": "#ffffff", "circle-opacity": ["case", ["==", ["get", "kind"], "go"], 0, 0.25], "circle-stroke-color": C.sim, "circle-stroke-width": ["case", ["==", ["get", "kind"], "go"], 1.5, 0] } });
      map.addLayer({ id: "cursor", type: "circle", source: "cursor", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "go"], 5.5, 5], "circle-color": ["case", ["==", ["get", "kind"], "go"], C.sim, "#ffffff"], "circle-stroke-color": C.casing, "circle-stroke-width": 2 } });

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
    // Place names hide when the map is zoomed far out. A tilted view shows the same ground at a lower zoom
    // (the 3D opening view sits just under the flat map's cut-off), so it keeps its names a level further out.
    const zoomClass = () => containerRef.current?.classList.toggle("lowzoom", map.getZoom() < (map.getPitch() > 30 ? 14.6 : 15.6));
    map.on("zoom", zoomClass);
    map.on("pitch", zoomClass);
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
      if (performance.now() - live.suppressNextClick < 700) return;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => useStore.getState().set({ mapClick: ll, selectedWaypoint: null }), TAP_DELAY_MS);
    });
    map.on("dblclick", () => clearTimeout(tapTimer));
    // Apple Maps style: tilting the flat map slides into 3D, levelling it out returns to 2D.
    // The map opens in 3D while still level, before the camera has swung down. Levelling only returns to 2D
    // once the view has actually been tilted, so the opening moves do not switch 3D off again.
    let tilted = false;
    map.on("pitch", () => {
      if (map.getPitch() > TILT_LEAVE_3D) tilted = true;
      if (live.switching || !area.overview.elevation || useStore.getState().view3d || map.getPitch() < TILT_ENTER_3D) return;
      live.tiltDriven = true;
      useStore.getState().set({ view3d: true });
    });
    map.on("moveend", () => {
      if (live.switching || !tilted || !useStore.getState().view3d || map.getPitch() > TILT_LEAVE_3D || map.isMoving()) return;
      tilted = false;
      live.tiltDriven = true;
      useStore.getState().set({ view3d: false });
    });

    return () => {
      live.stopTerrainAnim?.();
      live.stopGlide?.();
      live.refitOpening = null;
      detachGestures();
      map.remove();
      live.map = null;
      live.ready = false;
      // Fast Refresh runs this effect again and keeps the state: the other effects must wait for the new map to load.
      setReady(false);
    };
  }, [area]);

  // ---------- base imagery ----------
  const baseImagery = useStore((s) => s.baseImagery);
  const baseOpacity = useStore((s) => s.baseOpacity);
  const marsTint = useStore((s) => s.marsTint);
  useEffect(() => {
    const map = live.map;
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
    const map = live.map;
    const ov = area.overview;
    if (!ready || !map || !ov.elevation || !area.tiles) return;
    const url = setDemSource({ grid: ov.grid, elev: ov.elevation }, detail?.elevation ? { grid: detail.grid, elev: detail.elevation } : null, ov.elevRef);
    for (const id of ["dem", "dem-hs"]) (map.getSource(id) as maplibregl.RasterDEMTileSource | undefined)?.setTiles([url]);
  }, [ready, detail, area]);
  useEffect(() => {
    const map = live.map;
    if (!ready || !map || !area.tiles) return;
    const c = detail ? gridCoords(detail.grid) : null;
    (map.getSource("window") as GeoJSONSource | undefined)?.setData(c ? windowBrackets(c) : EMPTY_FC);
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
    const map = live.map;
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
    // Hillshade is for the flat map; the 3D effect below switches it with the view.
    map.setLayoutProperty("hillshade", "visibility", overlays.hillshade.on && !useStore.getState().view3d ? "visible" : "none");
    map.setPaintProperty("hillshade", "hillshade-exaggeration", overlays.hillshade.opacity);
    for (const [l, k] of [["contours-fine", 0.75], ["contours-mid", 1], ["contours-index", 1]] as const) {
      map.setLayoutProperty(l, "visibility", overlays.contours.on ? "visible" : "none");
      map.setPaintProperty(l, "line-opacity", overlays.contours.opacity * k);
    }
    for (const l of ["rings-casing", "rings-line"]) map.setLayoutProperty(l, "visibility", overlays.rings.on ? "visible" : "none");
    map.setPaintProperty("rings-casing", "line-opacity", 0.45 * overlays.rings.opacity);
    map.setPaintProperty("rings-line", "line-opacity", overlays.rings.opacity);
    map.setLayoutProperty("rings-limit", "visibility", overlays.rings.on ? "visible" : "none");
    map.setPaintProperty("rings-limit", "line-opacity", overlays.rings.opacity * 0.85);
    for (const l of ["track", "track-casing", "waypoints"]) map.setLayoutProperty(l, "visibility", overlays.track.on ? "visible" : "none");
    // While planning, Curiosity's track recedes so the planned route stands out — unless the user
    // has set the track layer themselves in the Layers tab (its state object then differs from the default).
    const fade = isTrackFaded(tab, overlays.track) ? TRACK_PLAN_FADE : 1;
    map.setPaintProperty("track", "line-opacity", overlays.track.opacity * fade);
    map.setPaintProperty("track-casing", "line-opacity", 0.5 * fade);
    map.setPaintProperty("waypoints", "icon-opacity", overlays.track.opacity * fade);
  }, [ready, overlays, reach, area, tab, detail]);

  // ---------- contour lines (traced the first time they are switched on, and again when the window moves) ----------
  const contoursOn = overlays.contours.on;
  const contoursFor = useRef<DisplayLayers | null | undefined>(undefined);
  useEffect(() => {
    const map = live.map;
    const ov = area.overview;
    if (!ready || !map || !contoursOn || !ov.elevation || contoursFor.current === detail) return;
    // After this frame, so the switch moves before the tracing starts.
    const timer = setTimeout(() => {
      const whole = { grid: ov.grid, elev: ov.elevation! };
      const win = area.tiles && detail?.elevation ? { grid: detail.grid, elev: detail.elevation } : null;
      // An untiled area is full-resolution ground throughout.
      const data = area.tiles ? contourFeatures(whole, win) : contourFeatures(null, whole);
      (map.getSource("contours") as GeoJSONSource | undefined)?.setData(data);
      contoursFor.current = detail;
    }, 0);
    return () => clearTimeout(timer);
  }, [ready, contoursOn, detail, area]);

  // ---------- science overlays (data fetched the first time each is switched on) ----------
  const sci = useStore((s) => s.sci);
  const sciData = useStore((s) => s.sciData);
  const sciUrls = useRef<Record<string, string>>({});
  useEffect(() => {
    const map = live.map;
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
    const map = live.map;
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
      const plate = document.createElement("div");
      const isLimit = r.kind ? r.kind === "limit" : r.budgetS === Math.max(...rings.map((x) => x.budgetS));
      // The limit is a status, shown once on a dot in the line's own warning colour; the times are plain measures.
      if (isLimit) plate.innerHTML = "";
      plate.append(isLimit ? `Limit${r.limitedBy ? ` · ${r.limitedBy}` : ""}` : fmtDur(r.budgetS));
      el.title = isLimit
        ? `Walk limit: the farthest you can go, work one stop and still get home with the reserve intact on time, energy and oxygen${r.limitedBy ? `. Here ${r.limitedBy} runs out first` : ""}`
        : `Reachable and back to the start in ${fmtDur(r.budgetS)} of walking (round trip)`;
      plate.className = `${MAP_LABEL_BOX} ${isLimit ? MAP_LABEL_TONE.strong : MAP_LABEL_TONE.neutral}`;
      el.append(plate);
      el.insertAdjacentHTML("beforeend", `<i class="${MAP_LABEL_POST}"></i><i class="${MAP_LABEL_BASE}"></i>`);
      el.setAttribute("aria-label", el.title);
      ringMarkers.current.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(outline[0] as [number, number]).addTo(map));
      el.tabIndex = -1;
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
    const map = live.map;
    if (!ready || !map) return;
    (map.getSource("routes") as GeoJSONSource).setData(routeFeatures(results));
    const sel = selectedResult({ results, selectedProfile })?.profile.id ?? "";
    for (const l of ["routes-alt-casing", "routes-alt"]) map.setFilter(l, ["!=", ["get", "profile"], sel]);
    map.setFilter("route-casing", ["==", ["get", "profile"], sel]);
    // Legs past the limit are drawn by route-over alone.
    map.setFilter("route-sel", ["all", ["==", ["get", "profile"], sel], ["==", ["get", "over"], 0]]);
    map.setFilter("route-over", ["all", ["==", ["get", "profile"], sel], ["==", ["get", "over"], 1]]);
  }, [ready, results, selectedProfile]);

  // ---------- selected route coloured by slope ----------
  const walkParams = useStore((s) => s.params);
  useEffect(() => {
    const map = live.map;
    if (!ready || !map) return;
    const sel = selectedResult({ results, selectedProfile });
    (map.getSource("route-slope") as GeoJSONSource | undefined)?.setData(routeSlopeFeatures(sel, walkParams));
    (map.getSource("route-ticks") as GeoJSONSource | undefined)?.setData(routeTickFeatures(sel));
  }, [ready, results, selectedProfile, walkParams]);

  // ---------- the route pointed at in the route table ----------
  // The routes not chosen are all the same grey, so the one under the pointer (or keyboard focus) is brightened.
  const hoverProfile = useStore((s) => s.hoverProfile);
  useEffect(() => {
    const map = live.map;
    if (!ready || !map) return;
    const C = mapPalette();
    const hot: maplibregl.ExpressionSpecification = ["==", ["get", "profile"], hoverProfile ?? ""];
    map.setPaintProperty("routes-alt", "line-color", ["case", hot, C.ink, C.ink2]);
    map.setPaintProperty("routes-alt", "line-width", ["case", hot, 2.5, 1.5]);
  }, [ready, hoverProfile]);

  // ---------- POI markers ----------
  const poisOn = useStore((s) => s.overlays.pois.on);
  const selectedPoi = useStore((s) => s.selectedPoi);
  const poiPins = useRef<{ el: HTMLElement; poi: Poi }[]>([]);
  useEffect(() => {
    const map = live.map;
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
    const map = live.map;
    if (!ready || !map) return;
    const ms: maplibregl.Marker[] = [];
    if (start) {
      const el = document.createElement("div");
      el.className = STOP_START;
      el.textContent = "S";
      el.title = `Start: ${start.name.replace(/^start:\s*/i, "")} (drag to move)`;
      el.setAttribute("aria-label", `Start: ${start.name.replace(/^start:\s*/i, "")}`);
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
      el.setAttribute("aria-label", `Stop ${i + 1}: ${s.name}`);
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
    const map = live.map;
    if (!ready || !map || !poisOn) return;
    const inPlan = new Set([start?.poiId, ...stops.map((s) => s.poiId)].filter(Boolean));
    const pins = poiPins.current.map(({ el, poi }, i) => {
      const sel = selectedPoi?.id === poi.id;
      el.classList.toggle("selected", sel);
      el.classList.toggle("in-plan", inPlan.has(poi.id));
      return { el, ll: [poi.lon, poi.lat] as LonLat, rank: (sel ? 0 : inPlan.has(poi.id) ? 100 : 200) + i };
    });
    const place = () => {
      sortMarkersByDepth(map);
      placePoiLabels(map, pins);
    };
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
    const map = live.map;
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
    const map = live.map;
    if (!ready || !map) return;
    const byTilt = live.tiltDriven;
    live.tiltDriven = false;
    // Only a 2D/3D switch moves the camera; changing the vertical scale must not.
    const switched = last3d.current !== view3d;
    last3d.current = view3d;
    // Tilt gestures work from the flat map too (they switch 3D on), so only a map without elevation is locked flat.
    const hasElev = !!area.overview.elevation;
    map.setMaxPitch(hasElev ? 80 : 0);
    if (hasElev) map.touchPitch.enable();
    else map.touchPitch.disable();
    // In 3D the label plates stand on posts (see mapLabel.ts); the labels are then placed again for their new shape.
    containerRef.current?.classList.toggle("map-3d", view3d && hasElev);
    // In 3D the ground has its own relief, so the hillshade is for the flat map only.
    if (map.getLayer("hillshade")) map.setLayoutProperty("hillshade", "visibility", useStore.getState().overlays.hillshade.on && !view3d ? "visible" : "none");
    if (switched) map.fire(RELAYOUT_LABELS);
    if (view3d && hasElev) {
      // The ground rises out of the flat map while the camera swings down, instead of popping up at full height.
      if (!map.terrain) {
        map.setTerrain({ source: "dem", exaggeration: TERRAIN_FLAT });
        tuneTerrain(map, area.manifest.grid);
      }
      // The 3D button swings the camera down; a tilt gesture is already holding it where the user wants.
      const swing = switched && !byTilt && map.getPitch() < 30 ? { pitch: HOME_3D.pitch, bearing: Math.abs(map.getBearing() - HOME_BEARING) < 0.5 ? HOME_3D.bearing : map.getBearing() } : null;
      animateTerrain(map, exaggeration, swing, !switched ? 0 : byTilt ? TERRAIN_TILT_MS : TERRAIN_RISE_MS);
    } else if (map.terrain) {
      // The ground sinks back into the flat map, and only then is the terrain switched off.
      // The 2D button also levels the camera and turns back to the home heading; levelling by gesture keeps the heading.
      const level = switched && !byTilt && map.getPitch() > 0 ? { pitch: 0, bearing: HOME_BEARING } : null;
      animateTerrain(map, 0, level, level ? TERRAIN_LEVEL_MS : TERRAIN_TILT_MS, () => map.setTerrain(null));
    }
  }, [ready, view3d, exaggeration, area]);

  const renderDistanceKm = useStore((s) => s.renderDistanceKm);
  useEffect(() => setRenderDistance(live.map, renderDistanceKm), [ready, renderDistanceKm]);

  // ---------- click popup ----------
  const mapClick = useStore((s) => s.mapClick);
  useEffect(() => {
    const map = live.map;
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
