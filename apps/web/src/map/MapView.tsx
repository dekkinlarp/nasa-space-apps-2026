import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LonLat, ReachRing, RouteResult } from "@marsmap/core";
import { selectedResult, useStore, type OverlayId } from "../store";
import type { AreaData, Poi } from "../types";
import { cellIndex, M_PER_DEG_LAT } from "../geo";
import { confidenceUrl, costUrl, elevationUrl, SCIENCE_RAMPS, scienceUrl, slopeUrl, surfaceUrl } from "./rasters";
import { loadFloatLayer } from "../data";
import { demMaxZoom, DEM_TILE_SIZE, registerDemProtocol, setDemSource } from "./dem";
import { fmtDur } from "../format";
import { ClickMenu } from "../components/ClickMenu";

let mapInstance: MLMap | null = null;
export const getMap = () => mapInstance;

const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export const PROFILE_COLORS: Record<string, string> = {
  fastest: "#ff8a3d",
  "least-effort": "#4fc3f7",
  leastEffort: "#4fc3f7",
  least_effort: "#4fc3f7",
  safest: "#7ee081",
};
export const profileColor = (id: string, i = 0) => PROFILE_COLORS[id] ?? ["#ff8a3d", "#4fc3f7", "#7ee081"][i % 3]!;

/** Strip a tile suffix like _0_1 / _r0_c1 so a 2x2 image set is one base-imagery choice. */
export const imageryGroup = (id: string) => id.replace(/[_-]r?\d+[_-]c?\d+$/, "");

const TILE_SWITCH_ZOOM = 17;
/** True for a full-resolution piece of an imagery group that also has an overview image (e.g. hirise_0_1). */
const isDetailTile = (a: AreaData, id: string) => id !== imageryGroup(id) && a.manifest.imagery.some((o) => o.id === imageryGroup(id));
const RASTER_OVERLAYS = ["elevation", "slope", "surface", "confidence", "cost"] as const;

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

function gridCoords(a: AreaData): [[number, number], [number, number], [number, number], [number, number]] {
  const g = a.layers.grid;
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
          .map((poly) => [poly[0]!, ...poly.slice(1).filter((h) => ringAreaM2(h) >= MIN_RING_PART_M2)]),
      },
    })),
  };
}

function poiEl(p: Poi): HTMLElement {
  const el = document.createElement("div");
  el.className = `poi-pin poi-${p.type}`;
  el.innerHTML = `<span class="poi-dot"></span><span class="poi-label"></span>`;
  (el.querySelector(".poi-label") as HTMLElement).textContent = p.name;
  el.title = p.name;
  return el;
}

/** Open on the points of interest (the boxwork), not the whole 3 km square. */
function initialBounds(a: AreaData): [number, number, number, number] {
  const g = a.layers.grid;
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

  // ---------- create map ----------
  useEffect(() => {
    const g = area.layers.grid;
    if (area.layers.elevation) setDemSource(g, area.layers.elevation, area.layers.elevRef);
    registerDemProtocol();
    const padLon = (g.east - g.west) * 0.6, padLat = (g.north - g.south) * 0.6;
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0a0c" } }],
      },
      bounds: initialBounds(area),
      fitBoundsOptions: { padding: 40 },
      maxBounds: [g.west - padLon, g.south - padLat, g.east + padLon, g.north + padLat],
      minZoom: 11,
      maxZoom: 21,
      maxPitch: 80,
      attributionControl: false,
      dragRotate: true,
      scrollZoom: false, // replaced by attachGestures
      renderWorldCopies: false,
    });
    mapInstance = map;
    const detachGestures = attachGestures(map);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    (window as unknown as { __map: MLMap }).__map = map;

    map.on("load", () => {
      const coords = gridCoords(area);
      // Base imagery: one image source per manifest entry.
      // Full-resolution tiles of a group are added on demand (see syncTiles); everything else loads now.
      for (const im of area.manifest.imagery) {
        if (isDetailTile(area, im.id)) continue;
        map.addSource(`img-${im.id}`, {
          type: "image",
          url: `${area.base}/${im.file}`,
          coordinates: [[im.west, im.north], [im.east, im.north], [im.east, im.south], [im.west, im.south]],
        });
        map.addLayer({ id: `img-${im.id}`, type: "raster", source: `img-${im.id}`, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } });
      }
      // DEM: one source for terrain, one for hillshade (MapLibre recommends separate sources).
      const demMax = demMaxZoom(g);
      for (const id of ["dem", "dem-hs"]) {
        map.addSource(id, { type: "raster-dem", tiles: ["marsdem://{z}/{x}/{y}"], tileSize: DEM_TILE_SIZE, encoding: "terrarium", maxzoom: demMax, minzoom: 8, bounds: [g.west, g.south, g.east, g.north] });
      }
      map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hs", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.6, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#ffe8d0", "hillshade-accent-color": "#3a1f14" } });
      for (const id of RASTER_OVERLAYS) {
        map.addSource(`ov-${id}`, { type: "image", url: BLANK, coordinates: coords });
        map.addLayer({ id: `ov-${id}`, type: "raster", source: `ov-${id}`, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": id === "surface" ? "nearest" : "linear" } });
      }
      // Science layers keep their source pixels visible (nearest), so an 18 m CRISM pixel reads as one block.
      for (const l of scienceLayers(area)) {
        map.addSource(`sci-${l.id}`, { type: "image", url: BLANK, coordinates: coords });
        map.addLayer({ id: `sci-${l.id}`, type: "raster", source: `sci-${l.id}`, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": "nearest" } });
      }
      map.addSource("rings", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "rings-limit", type: "line", source: "rings", filter: ["==", ["get", "limit"], 1], paint: { "line-color": "#ffb347", "line-width": 2.6 } });
      map.addLayer({ id: "rings-line", type: "line", source: "rings", filter: ["==", ["get", "limit"], 0], paint: { "line-color": ["interpolate", ["linear"], ["get", "t"], 0, "#36d1c4", 1, "#ffb347"], "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 1.2, 1, 2.2], "line-dasharray": [3, 2] } });

      map.addSource("track", { type: "geojson", data: area.rover.traverse ?? EMPTY_FC });
      map.addLayer({ id: "track-casing", type: "line", source: "track", paint: { "line-color": "#000", "line-width": 4, "line-opacity": 0.5 } });
      map.addLayer({ id: "track", type: "line", source: "track", paint: { "line-color": "#f5f0e6", "line-width": 1.6, "line-dasharray": [2, 1.5] } });
      map.addSource("waypoints", {
        type: "geojson",
        data: { type: "FeatureCollection", features: area.rover.waypoints.map((w, i) => ({ type: "Feature", properties: { i, sol: w.sol }, geometry: { type: "Point", coordinates: w.lonLat } })) },
      });
      map.addLayer({ id: "waypoints", type: "circle", source: "waypoints", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 18, 6], "circle-color": "#f5f0e6", "circle-stroke-color": "#1a1210", "circle-stroke-width": 1.5, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } });

      map.addSource("routes", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "routes-alt", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.35 } });
      map.addLayer({ id: "route-casing", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#120c0a", "line-width": 8, "line-opacity": 0.85 } });
      map.addLayer({ id: "route-sel", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["case", ["==", ["get", "over"], 1], "#ff3b3b", ["get", "color"]], "line-width": 4.5 } });
      map.addLayer({ id: "route-over", type: "line", source: "routes", layout: { "line-join": "round" }, paint: { "line-color": "#ffd2d2", "line-width": 1.5, "line-dasharray": [1, 2] } });

      map.addSource("cursor", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "cursor-halo", type: "circle", source: "cursor", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "go"], 14, 9], "circle-color": ["case", ["==", ["get", "kind"], "go"], "#36d1c4", "#ffffff"], "circle-opacity": 0.25 } });
      map.addLayer({ id: "cursor", type: "circle", source: "cursor", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "go"], 7, 5], "circle-color": ["case", ["==", ["get", "kind"], "go"], "#36d1c4", "#ffffff"], "circle-stroke-color": "#0b0a0c", "circle-stroke-width": 2 } });

      setReady(true);
    });

    // Hover readout.
    map.on("mousemove", (e) => {
      const ll: LonLat = [e.lngLat.lng, e.lngLat.lat];
      const L = area.layers;
      const i = cellIndex(L.grid, ll);
      const s = useStore.getState();
      if (i == null) {
        s.set({ hover: { lonLat: ll, elevationM: null, slopeDeg: null, surfaceId: null } });
        return;
      }
      const ev = L.elevation?.[i];
      s.set({
        hover: {
          lonLat: ll,
          elevationM: ev != null && Number.isFinite(ev) ? ev : null,
          slopeDeg: L.slope?.[i] ?? null,
          surfaceId: L.surface?.[i] ?? null,
        },
      });
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
      if (levelling || !area.layers.elevation || useStore.getState().view3d || map.getPitch() < TILT_ENTER_3D) return;
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
    };
  }, [area]);

  // ---------- base imagery ----------
  const baseImagery = useStore((s) => s.baseImagery);
  const baseOpacity = useStore((s) => s.baseOpacity);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    for (const im of area.manifest.imagery) {
      if (!map.getLayer(`img-${im.id}`)) continue;
      const on = imageryGroup(im.id) === baseImagery;
      map.setLayoutProperty(`img-${im.id}`, "visibility", on ? "visible" : "none");
      map.setPaintProperty(`img-${im.id}`, "raster-opacity", baseOpacity);
    }
    // Full-resolution tiles: only the ones in view while zoomed in, drawn over the overview image.
    // An 8 km area has 16 of them (about 40 MB of texture each), far too much to hold at once.
    const syncTiles = () => {
      const zoomedIn = map.getZoom() >= TILE_SWITCH_ZOOM - 0.5;
      const b = map.getBounds();
      for (const im of area.manifest.imagery) {
        if (!isDetailTile(area, im.id)) continue;
        const id = `img-${im.id}`;
        const want = zoomedIn && imageryGroup(im.id) === baseImagery && im.west < b.getEast() && im.east > b.getWest() && im.south < b.getNorth() && im.north > b.getSouth();
        const has = !!map.getSource(id);
        if (want && !has) {
          map.addSource(id, { type: "image", url: `${area.base}/${im.file}`, coordinates: [[im.west, im.north], [im.east, im.north], [im.east, im.south], [im.west, im.south]] });
          map.addLayer({ id, type: "raster", source: id, minzoom: TILE_SWITCH_ZOOM - 0.5, paint: { "raster-fade-duration": 0, "raster-resampling": "linear", "raster-opacity": baseOpacity } }, "hillshade");
        } else if (want) {
          map.setPaintProperty(id, "raster-opacity", baseOpacity);
        } else if (has) {
          map.removeLayer(id);
          map.removeSource(id);
        }
      }
    };
    syncTiles();
    map.on("moveend", syncTiles);
    return () => {
      map.off("moveend", syncTiles);
    };
  }, [ready, baseImagery, baseOpacity, area]);

  // ---------- raster overlays ----------
  const overlays = useStore((s) => s.overlays);
  const reach = useStore((s) => s.reach);
  const gens = useRef<Partial<Record<OverlayId, number>>>({});
  // Walk-cost heat is invalidated whenever the reach field changes (declared first so it runs first).
  useEffect(() => {
    const old = urls.current.cost;
    if (old && old !== "pending") URL.revokeObjectURL(old);
    delete urls.current.cost;
    gens.current.cost = (gens.current.cost ?? 0) + 1;
  }, [reach]);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    const L = area.layers;
    const g = L.grid;
    for (const id of RASTER_OVERLAYS) {
      const st = overlays[id];
      const vis = st.on && (id !== "cost" || reach != null);
      map.setLayoutProperty(`ov-${id}`, "visibility", vis ? "visible" : "none");
      map.setPaintProperty(`ov-${id}`, "raster-opacity", st.opacity);
      if (!vis || urls.current[id]) continue;
      let p: Promise<string> | null = null;
      if (id === "elevation" && L.elevation) p = elevationUrl(g, L.elevation, L.elevMin, L.elevMax);
      if (id === "slope" && L.slope) p = slopeUrl(g, L.slope);
      if (id === "surface" && L.surface) p = surfaceUrl(g, L.surface, area.config.surfaceClasses);
      if (id === "confidence" && L.confidence) p = confidenceUrl(g, L.confidence);
      if (id === "cost" && reach) p = costUrl(g, reach.outTimeS, reach.backTimeS, reach.usableS);
      if (!p) continue;
      urls.current[id] = "pending";
      const gen = gens.current[id] ?? 0;
      void p.then((url) => {
        if ((gens.current[id] ?? 0) !== gen) return URL.revokeObjectURL(url);
        urls.current[id] = url;
        (map.getSource(`ov-${id}`) as ImageSource | undefined)?.updateImage({ url, coordinates: gridCoords(area) });
      });
    }
    map.setLayoutProperty("hillshade", "visibility", overlays.hillshade.on ? "visible" : "none");
    map.setPaintProperty("hillshade", "hillshade-exaggeration", overlays.hillshade.opacity);
    for (const l of ["rings-line", "rings-limit"]) {
      map.setLayoutProperty(l, "visibility", overlays.rings.on ? "visible" : "none");
      map.setPaintProperty(l, "line-opacity", overlays.rings.opacity);
    }
    for (const l of ["track", "track-casing", "waypoints"]) map.setLayoutProperty(l, "visibility", overlays.track.on ? "visible" : "none");
    map.setPaintProperty("track", "line-opacity", overlays.track.opacity);
    map.setPaintProperty("waypoints", "circle-opacity", overlays.track.opacity);
  }, [ready, overlays, reach, area]);

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
        const data = useStore.getState().sciData[l.id] ?? (await loadFloatLayer(area, l.id));
        if (!data) {
          delete sciUrls.current[l.id];
          return;
        }
        if (!useStore.getState().sciData[l.id]) useStore.getState().set({ sciData: { ...useStore.getState().sciData, [l.id]: data } });
        const url = await scienceUrl(area.layers.grid, data, l.display?.min ?? 0, l.display?.max ?? 1, scienceRamp(area, l.id));
        sciUrls.current[l.id] = url;
        (map.getSource(`sci-${l.id}`) as ImageSource | undefined)?.updateImage({ url, coordinates: gridCoords(area) });
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
    for (const r of rings) {
      // Label at the northernmost vertex of the ring.
      let best: number[] | null = null;
      for (const poly of r.coordinates) for (const p of poly[0] ?? []) if (!best || p[1]! > best[1]!) best = p;
      if (!best) continue;
      const el = document.createElement("div");
      el.className = "ring-label";
      const isLimit = r.kind ? r.kind === "limit" : r.budgetS === Math.max(...rings.map((x) => x.budgetS));
      el.textContent = isLimit ? `Walk limit${r.limitedBy ? ` · ${r.limitedBy} runs out first` : ""} · round trip + one stop` : `${fmtDur(r.budgetS)} round trip`;
      if (isLimit) el.classList.add("limit");
      ringMarkers.current.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(best as [number, number]).addTo(map));
    }
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

  // ---------- POI markers ----------
  const poisOn = useStore((s) => s.overlays.pois.on);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map || !poisOn) return;
    const markers = area.config.pois.map((p) => {
      const el = poiEl(p);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        useStore.getState().set({ selectedPoi: p, selectedWaypoint: null, mapClick: null, tab: useStore.getState().tab });
      });
      return new maplibregl.Marker({ element: el, anchor: "left", offset: [-7, 0] }).setLngLat([p.lon, p.lat]).addTo(map);
    });
    return () => markers.forEach((m) => m.remove());
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
      el.className = "stop-marker start-marker";
      el.textContent = "S";
      el.title = `Start: ${start.name}`;
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(start.lonLat).addTo(map);
      m.on("dragend", () => {
        const ll = m.getLngLat();
        useStore.getState().setStart({ lonLat: [ll.lng, ll.lat], name: "Custom start" });
      });
      ms.push(m);
    }
    stops.forEach((s, i) => {
      const el = document.createElement("div");
      el.className = "stop-marker";
      el.textContent = String(i + 1);
      el.title = s.name;
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

  // ---------- cursor (profile scrub + go position) ----------
  const cursor = useStore((s) => s.profileCursor);
  const goPos = useStore((s) => s.go.position);
  const goMode = useStore((s) => s.go.mode);
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    const f: GeoJSON.Feature[] = [];
    if (cursor) f.push({ type: "Feature", properties: { kind: "profile" }, geometry: { type: "Point", coordinates: cursor } });
    if (goPos && goMode !== "off") f.push({ type: "Feature", properties: { kind: "go" }, geometry: { type: "Point", coordinates: goPos } });
    (map.getSource("cursor") as GeoJSONSource).setData({ type: "FeatureCollection", features: f });
  }, [ready, cursor, goPos, goMode]);

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
    map.setMaxPitch(area.layers.elevation ? 80 : 0);
    if (area.layers.elevation) map.touchPitch.enable();
    else map.touchPitch.disable();
    if (view3d && area.layers.elevation) {
      map.setTerrain({ source: "dem", exaggeration });
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
      <div ref={containerRef} className="map" />
      {popupEl && mapClick && createPortal(<ClickMenu lonLat={mapClick} />, popupEl)}
    </>
  );
}
