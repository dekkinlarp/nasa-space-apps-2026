import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LonLat, ReachRing, RouteResult } from "@marsmap/core";
import { selectedResult, useStore, type OverlayId } from "../store";
import type { AreaData, Poi } from "../types";
import { cellIndex, M_PER_DEG_LAT } from "../geo";
import { costUrl, elevationUrl, slopeUrl, surfaceUrl } from "./rasters";
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
      map.addLayer({ id: "rings-line", type: "line", source: "rings", paint: { "line-color": ["interpolate", ["linear"], ["get", "t"], 0, "#36d1c4", 1, "#ffb347"], "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 1.2, 1, 2.2], "line-dasharray": [3, 2] } });

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
    for (const l of ["track", "track-casing", "waypoints"]) map.setLayoutProperty(l, "visibility", overlays.track.on ? "visible" : "none");
    map.setPaintProperty("track", "line-opacity", overlays.track.opacity);
    map.setPaintProperty("waypoints", "circle-opacity", overlays.track.opacity);
  }, [ready, overlays, reach, area]);

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
      const isLimit = r.budgetS === Math.max(...rings.map((x) => x.budgetS));
      el.textContent = isLimit ? `Walk limit · ${fmtDur(r.budgetS)} round trip + one stop` : `${fmtDur(r.budgetS)} round trip`;
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
