/**
 * Keeps the 3D camera above the ground.
 *
 * MapLibre only stops the camera from going *below* the terrain height at its own position, and
 * then parks it exactly on the surface. The near clip plane sits a little in front of the camera, so
 * a camera on (or just above) a slope cuts into the hillside and shows the terrain from underneath.
 * This hook runs after MapLibre's own check on every camera change (gestures, easeTo, jumpTo) and,
 * when the camera would come closer than CLEARANCE to the ground around it, lowers the pitch until
 * it clears, keeping centre, zoom and heading. If even looking straight down is too close (a peak
 * right under the centre at max zoom), it zooms out instead.
 *
 * Reads transform internals (cameraToCenterDistance, worldSize, nearZ, tileZoom) checked against
 * maplibre-gl 5.24, like terrainPerf.ts.
 */
import maplibregl, { type LngLat, type Map as MLMap } from "maplibre-gl";
import { demHeight } from "./dem";

interface TransformInternals {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
  elevation: number;
  worldSize: number;
  tileZoom: number;
  cameraToCenterDistance: number;
  nearZ: number;
}

interface TerrainInternals {
  exaggeration: number;
  getElevationForLngLatZoom(ll: LngLat, zoom: number): number;
}

/** Minimum height of the camera above the ground near it, map metres (on top of the near plane distance). */
const CLEARANCE_M = 4;
const PITCH_STEP = 0.5;

export function keepCameraAboveGround(map: MLMap) {
  map.transformCameraUpdate = (next) => {
    const terrain = map.terrain as unknown as TerrainInternals | null;
    if (!terrain) return {};
    const tr = next as unknown as TransformInternals;
    const exag = terrain.exaggeration;
    const c = maplibregl.MercatorCoordinate.fromLngLat(tr.center);
    const unitsPerM = c.meterInMercatorCoordinateUnits();
    const pxPerM = unitsPerM * tr.worldSize;
    const distM = tr.cameraToCenterDistance / pxPerM;
    const nearM = tr.nearZ / pxPerM;

    // Drawn ground height (exaggerated map metres): the full-resolution grid, or the loaded terrain
    // mesh where that is higher (a coarse tile can bridge over a dip).
    const groundAt = (x: number, y: number) => {
      const ll = new maplibregl.MercatorCoordinate(x, y).toLngLat();
      return Math.max(demHeight(ll.lng, ll.lat) * exag, terrain.getElevationForLngLatZoom(ll, tr.tileZoom));
    };
    // The height the camera is drawn relative to. MapLibre holds it while a pan is in progress, so it
    // can lag the ground under the centre; the drawn camera still follows it.
    const centreElev = tr.elevation;
    const radius = (nearM * 2 + CLEARANCE_M) * unitsPerM;
    const b = (tr.bearing * Math.PI) / 180;
    const sb = Math.sin(b), cb = Math.cos(b);

    /** Height of the camera above the highest ground around it at a given pitch (negative = too low). */
    const margin = (pitchDeg: number, dist = distM) => {
      const p = (pitchDeg * Math.PI) / 180;
      const back = dist * Math.sin(p) * unitsPerM;
      // The camera sits behind the centre, opposite the heading (mercator y grows southward).
      const x = c.x - sb * back, y = c.y + cb * back;
      let ground = groundAt(x, y);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        ground = Math.max(ground, groundAt(x + Math.cos(a) * radius, y + Math.sin(a) * radius));
      }
      return centreElev + dist * Math.cos(p) - ground - nearM - CLEARANCE_M;
    };

    if (margin(tr.pitch) >= 0) return {};
    for (let p = tr.pitch - PITCH_STEP; p > 0; p -= PITCH_STEP) {
      if (margin(p) >= 0) return { pitch: p };
    }
    // Straight down is still too close: back the camera off.
    let dist = distM;
    for (let i = 0; i < 20 && margin(0, dist) < 0; i++) dist *= 1.25;
    return { pitch: 0, zoom: tr.zoom - Math.log2(dist / distM) };
  };
}
