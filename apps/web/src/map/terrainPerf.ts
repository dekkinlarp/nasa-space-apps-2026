/**
 * Makes MapLibre's 3D terrain cheap enough to pan at 60 fps. Three changes, applied to the map's
 * Terrain object each time terrain is switched on (MapLibre makes a new one every time).
 *
 * 1. Picking without GPU readbacks. MapLibre finds what terrain is under a screen point by drawing
 *    the terrain into an offscreen buffer and reading pixels back. A readback stalls the CPU until
 *    the GPU has finished, and it happens on every mouse move (each mouse event carries a lngLat),
 *    on every pan step and, for every HTML marker, several times a second to fade markers hidden
 *    behind a ridge. That was over 60% of main-thread time while panning in 3D. Our elevation grid is
 *    already in memory, so a ray from the camera is marched across it on the CPU instead.
 *
 * 2. Elevation lookups that do not recompute the tile cover. Terrain.getElevationForLngLat works out
 *    which tiles cover the view on every call, only to learn their finest zoom; every marker calls it
 *    every frame. The zoom is taken once per frame from the terrain tile manager instead.
 *
 * 3. Render distance. MapLibre covers the whole screen with terrain tiles out to the horizon, also
 *    past the edge of the data where there is nothing to draw, and renders every layer into each of
 *    them. Only tiles inside the data area and inside a square of `renderDistanceKm` around the
 *    point the camera looks at are kept (widened to reach back to the camera, so the foreground is never cut).
 *
 * All three rely on MapLibre internals (Terrain.pointCoordinate / depthAtPoint / getElevationForLngLat, TerrainTileManager.update,
 * the transform's inverse view-projection matrix), checked against maplibre-gl 5.24; package.json pins
 * it to 5.24.x, so re-check these before moving to a newer minor version.
 */
import maplibregl, { type LngLat, type Map as MLMap } from "maplibre-gl";
import type { GridSpec } from "@marsmap/core";
import { M_PER_DEG_LAT } from "../geo";
import { demHeight, demRange } from "./dem";

type Pt = { x: number; y: number };
type Mat4 = ArrayLike<number>;

interface TransformInternals {
  width: number;
  height: number;
  worldSize: number;
  center: LngLat;
  _invViewProjMatrix: Mat4;
  getCameraLngLat(): LngLat;
  lngLatToCameraDepth(ll: LngLat, elevation: number): number;
}

interface TileID {
  canonical: { z: number; x: number; y: number };
}

interface TerrainInternals {
  exaggeration: number;
  pointCoordinate(p: Pt): maplibregl.MercatorCoordinate | null;
  depthAtPoint(p: Pt): number;
  getElevationForLngLat(ll: LngLat, transform: unknown): number;
  getElevationForLngLatZoom(ll: LngLat, zoom: number): number;
  tileManager: {
    maxzoom: number;
    update(transform: unknown, terrain: unknown): void;
    _renderableTilesKeys: string[];
    _tiles: Record<string, { tileID: TileID }>;
  };
  __marsTuned?: boolean;
}

function mul(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return [(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w, (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w, (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w];
}

const lonOfX = (x: number) => x * 360 - 180;
const latOfY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** Mercator units per metre at a latitude (MapLibre's own conversion). */
const mercPerMetre = (lat: number) => maplibregl.MercatorCoordinate.fromLngLat([0, lat], 1).z;

/**
 * First point where the ray through a screen pixel meets the terrain, as world coordinates
 * (x, y in mercator 0-1, z in exaggerated metres), or null if it misses (sky).
 */
function raycast(tr: TransformInternals, exaggeration: number, p: Pt): { x: number; y: number; z: number } | null {
  const cx = (2 * p.x) / tr.width - 1, cy = 1 - (2 * p.y) / tr.height;
  const inv = tr._invViewProjMatrix;
  const ws = tr.worldSize;
  const n = mul(inv, cx, cy, -1), f = mul(inv, cx, cy, 1);
  const [lo, hi] = demRange();
  const zLo = lo * exaggeration - 1, zHi = hi * exaggeration + 1;
  const dz = f[2] - n[2];
  // Part of the ray that lies between the lowest and highest ground.
  let t0 = 0, t1 = 1;
  if (Math.abs(dz) < 1e-9) {
    if (n[2] > zHi || n[2] < zLo) return null;
  } else {
    const a = (zHi - n[2]) / dz, b = (zLo - n[2]) / dz;
    t0 = Math.max(0, Math.min(a, b));
    t1 = Math.min(1, Math.max(a, b));
  }
  if (t1 <= t0) return null;
  const at = (t: number) => [n[0] + (f[0] - n[0]) * t, n[1] + (f[1] - n[1]) * t, n[2] + dz * t] as const;
  const groundAt = (x: number, y: number) => demHeight(lonOfX(x / ws), latOfY(y / ws)) * exaggeration;
  // Step about every 4 map metres (two 2 m grid cells on Mars) along the ground.
  const metresPerWorld = 1 / (ws * mercPerMetre(tr.center.lat));
  const span = Math.hypot(f[0] - n[0], f[1] - n[1]) * (t1 - t0) * metresPerWorld;
  const steps = Math.max(16, Math.min(1500, Math.ceil(span / 4)));
  let prev = t0;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const [x, y, z] = at(t);
    if (z > groundAt(x, y)) {
      prev = t;
      continue;
    }
    if (i === 0) return { x: x / ws, y: y / ws, z: groundAt(x, y) };
    // Refine between the last point above ground and this one.
    let a = prev, b = t;
    for (let k = 0; k < 10; k++) {
      const m = (a + b) / 2;
      const [mx, my, mz] = at(m);
      if (mz > groundAt(mx, my)) a = m;
      else b = m;
    }
    const [hx, hy] = at(b);
    return { x: hx / ws, y: hy / ws, z: groundAt(hx, hy) };
  }
  return null;
}

let renderDistanceKm = 8;
/** Side of the square kept around the look-at point in 3D. Takes effect on the next frame. */
export function setRenderDistance(map: MLMap | null, km: number) {
  renderDistanceKm = km;
  map?.triggerRepaint();
}

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => latOfY(y / 2 ** z);

/** Patch the map's current Terrain (call after every setTerrain). */
export function tuneTerrain(map: MLMap, grid: GridSpec) {
  const terrain = map.terrain as unknown as TerrainInternals | null;
  if (!terrain || terrain.__marsTuned) return;
  terrain.__marsTuned = true;
  const tr = () => map.transform as unknown as TransformInternals;

  terrain.pointCoordinate = (p) => {
    const hit = raycast(tr(), terrain.exaggeration, p);
    return hit ? new maplibregl.MercatorCoordinate(hit.x, hit.y, hit.z) : null;
  };
  terrain.depthAtPoint = (p) => {
    const t = tr();
    const hit = raycast(t, terrain.exaggeration, p);
    if (!hit) return Infinity;
    return t.lngLatToCameraDepth(new maplibregl.MercatorCoordinate(hit.x, hit.y).toLngLat(), hit.z);
  };

  // getElevationForLngLat works out the whole tile cover of the view just to learn its finest
  // zoom, on every call, and markers call it every frame. The terrain tile manager computes the same
  // cover (same tile size and zoom range) once per frame, so the zoom is taken from there.
  const tm = terrain.tileManager;
  const elevAtZoom = terrain.getElevationForLngLatZoom.bind(terrain);
  const original = terrain.getElevationForLngLat.bind(terrain);
  let coverZoom = -1;
  terrain.getElevationForLngLat = (ll, transform) => (coverZoom >= 0 ? elevAtZoom(ll, coverZoom) : original(ll, transform));

  const update = tm.update.bind(tm);
  tm.update = (transform, t) => {
    update(transform, t);
    let z = 0;
    for (const key of tm._renderableTilesKeys) z = Math.max(z, tm._tiles[key]?.tileID.canonical.z ?? 0);
    coverZoom = Math.min(z, tm.maxzoom);
    const tf = tr();
    const c = tf.center, cam = tf.getCameraLngLat();
    const half = (renderDistanceKm * 1000) / 2;
    const dLat = half / M_PER_DEG_LAT, dLon = half / (M_PER_DEG_LAT * Math.cos((c.lat * Math.PI) / 180));
    // Window around the look-at point, stretched to reach the camera's ground position.
    const w = Math.max(grid.west, Math.min(c.lng - dLon, cam.lng));
    const e = Math.min(grid.east, Math.max(c.lng + dLon, cam.lng));
    const s = Math.max(grid.south, Math.min(c.lat - dLat, cam.lat));
    const nn = Math.min(grid.north, Math.max(c.lat + dLat, cam.lat));
    tm._renderableTilesKeys = tm._renderableTilesKeys.filter((key) => {
      const id = tm._tiles[key]?.tileID.canonical;
      if (!id) return true;
      return tileLon(id.x, id.z) < e && tileLon(id.x + 1, id.z) > w && tileLat(id.y + 1, id.z) < nn && tileLat(id.y, id.z) > s;
    });
  };
}
