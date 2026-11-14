import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LonLat, ReachRing, RouteResult } from "@marsmap/core";
import { selectedResult, useStore, type LayerState, type OverlayId } from "../store";
import type { AreaData, Poi } from "../types";
import { cellIndex, M_PER_DEG_LAT } from "../geo";
import { costUrl, elevationUrl, slopeUrl, surfaceUrl } from "./rasters";
import { demMaxZoom, DEM_TILE_SIZE, registerDemProtocol, setDemSource } from "./dem";
import { fmtDur } from "../format";
import { ClickMenu } from "../components/ClickMenu";
import { routeSlopeFeatures } from "./routeSlope";

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
/** Round-trip time rings are teal; the outermost (walk-limit) ring is amber. Shared with the map key. */
export const RING_COLOR = "#36d1c4";
export const RING_LIMIT_COLOR = "#ffb347";
/** Opacity multiplier for Curiosity's traverse while the Plan tab is open. */
const TRACK_PLAN_FADE = 0.28;
const DEFAULT_TRACK_STATE = useStore.getState().overlays.track;
/** True when the traverse should recede: Plan tab open and the user has not set the track layer themselves. */
export const isTrackFaded = (tab: string, track: LayerState) => tab === "plan" && track === DEFAULT_TRACK_STATE;
const RASTER_OVERLAYS = ["elevation", "slope", "surface", "cost"] as const;

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
      properties: { id: r.id, i, t: n > 1 ? i / (n - 1) : 1 },
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
    for (const ll of outline) {
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

function poiEl(p: Poi): HTMLElement {
  const el = document.createElement("div");
  el.className = `poi-pin poi-${p.type}`;
  el.innerHTML = `<span class="poi-dot"></span><span class="poi-label"><span class="pl-short"></span><span class="pl-full"></span></span>`;
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
      renderWorldCopies: false,
    });
    mapInstance = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    (window as unknown as { __map: MLMap }).__map = map;

    map.on("load", () => {
      const coords = gridCoords(area);
      // Base imagery: one image source per manifest entry.
      for (const im of area.manifest.imagery) {
        map.addSource(`img-${im.id}`, {
          type: "image",
          url: `${area.base}/${im.file}`,
          coordinates: [[im.west, im.north], [im.east, im.north], [im.east, im.south], [im.west, im.south]],
        });
        // A group with both an overview image and a full-res tile set: overview when zoomed out, tiles when in.
        const group = imageryGroup(im.id);
        const hasTiles = area.manifest.imagery.some((o) => imageryGroup(o.id) === group && o.id !== group);
        const zoomRange = !hasTiles ? {} : im.id === group ? { maxzoom: TILE_SWITCH_ZOOM } : { minzoom: TILE_SWITCH_ZOOM };
        map.addLayer({ id: `img-${im.id}`, type: "raster", source: `img-${im.id}`, ...zoomRange, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } });
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
      map.addLayer({ id: "waypoints", type: "circle", source: "waypoints", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 18, 6], "circle-color": "#f5f0e6", "circle-stroke-color": "#1a1210", "circle-stroke-width": 1.5, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } });

      map.addSource("routes", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "routes-alt", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.35 } });
      map.addLayer({ id: "route-casing", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["case", ["==", ["get", "over"], 1], "#4a0d0b", "#120c0a"], "line-width": 8.5, "line-opacity": 0.9 } });
      // Selected route, coloured along its length by slope (pieces built from the segment profiles).
      map.addSource("route-slope", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "route-sel", type: "line", source: "route-slope", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4.5 } });
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
      s.set({ mapClick: ll, selectedWaypoint: null });
    });

    return () => {
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
      const on = imageryGroup(im.id) === baseImagery;
      map.setLayoutProperty(`img-${im.id}`, "visibility", on ? "visible" : "none");
      map.setPaintProperty(`img-${im.id}`, "raster-opacity", baseOpacity);
    }
  }, [ready, baseImagery, baseOpacity, area]);

  // ---------- raster overlays ----------
  const overlays = useStore((s) => s.overlays);
  const tab = useStore((s) => s.tab);
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
  }, [ready, overlays, reach, area, tab]);

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
      el.className = "ring-label";
      const isLimit = r.budgetS === Math.max(...rings.map((x) => x.budgetS));
      el.textContent = isLimit ? `Limit ${fmtDur(r.budgetS)}` : fmtDur(r.budgetS);
      el.title = isLimit
        ? `Walk limit: ground you can reach and get back from in ${fmtDur(r.budgetS)} of walking, leaving time for one stop`
        : `Reachable and back to the start in ${fmtDur(r.budgetS)} of walking (round trip)`;
      if (isLimit) el.classList.add("limit");
      ringMarkers.current.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(outline[0] as [number, number]).addTo(map));
      labels.push({ el, outline });
    }
    const place = () => placeRingLabels(map, ringMarkers.current, labels);
    place();
    map.on("moveend", place);
    map.on("resize", place);
    map.on(RELAYOUT_LABELS, place);
    return () => {
      map.off("moveend", place);
      map.off("resize", place);
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
      el.className = "stop-marker start-marker";
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
      el.className = "stop-marker";
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
    map.on("move", place);
    map.on("resize", place);
    map.on(RELAYOUT_LABELS, place);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      map.off("move", place);
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
  useEffect(() => {
    const map = mapInstance;
    if (!ready || !map) return;
    if (view3d && area.layers.elevation) {
      map.setTerrain({ source: "dem", exaggeration });
      // The camera keeps its altitude above the *centre* elevation; refresh it once DEM tiles are
      // in so the camera is not left inside a raised mesa.
      const lift = () => {
        const e = map.queryTerrainElevation(map.getCenter());
        if (e != null) map.jumpTo({ elevation: e });
      };
      map.once("idle", lift);
      if (map.getPitch() < 30) map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, duration: 900 });
    } else {
      map.setTerrain(null);
      if (map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
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
