/**
 * Client-side DEM tiles for MapLibre terrain. MapLibre thinks the map is Earth, so a Mars
 * degree is drawn as an Earth degree (1.88x larger in Earth metres). To keep true vertical
 * proportions, heights are multiplied by R_earth / R_mars before encoding; the
 * exaggeration slider then means real vertical exaggeration. Heights are relative to the
 * area's median elevation so the map centre sits near 0 m (negatives are fine in Terrarium). Encoding: Terrarium
 * (h = R*256 + G + B/256 - 32768).
 */
import maplibregl from "maplibre-gl";
import type { GridSpec } from "@marsmap/core";
import { sampleBilinear } from "../geo";

export const EARTH_RADIUS_M = 6378137;
export const DEM_TILE_SIZE = 256;

interface DemSource {
  grid: GridSpec;
  elev: Float32Array;
  min: number;
  vscale: number;
  /** Lowest and highest terrain height as drawn (map metres, before exaggeration). */
  lo: number;
  hi: number;
}
let current: DemSource | null = null;
let registered = false;

/** Encoded tiles, shared by the terrain and hillshade sources (both ask for the same tiles). */
const tileCache = new Map<string, ImageData>();
const TILE_CACHE_MAX = 96;

export function setDemSource(grid: GridSpec, elev: Float32Array, ref: number) {
  const vscale = EARTH_RADIUS_M / grid.marsRadiusM;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < elev.length; i++) {
    const v = elev[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // Ground outside the area (no DEM tiles) is drawn at 0.
  current = { grid, elev, min: ref, vscale, lo: Math.min(0, (lo - ref) * vscale), hi: Math.max(0, (hi - ref) * vscale) };
  tileCache.clear();
}

/** Terrain height MapLibre draws at a point, in map metres before exaggeration (0 outside the area). */
export function demHeight(lon: number, lat: number): number {
  const c = current;
  if (!c) return 0;
  const g = c.grid;
  if (lon < g.west || lon > g.east || lat < g.south || lat > g.north) return 0;
  const e = sampleBilinear(g, c.elev, lon, lat);
  return Number.isFinite(e) ? (e - c.min) * c.vscale : 0;
}

/** Lowest and highest drawn terrain height, map metres before exaggeration. */
export const demRange = (): [number, number] => (current ? [current.lo, current.hi] : [0, 0]);

function tileLon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
function tileLat(y: number, z: number) {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function renderTile(z: number, x: number, y: number): ImageData {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const S = DEM_TILE_SIZE;
  const img = new ImageData(S, S);
  const d = img.data;
  const cur = current;
  const lons = new Float64Array(S);
  for (let px = 0; px < S; px++) lons[px] = tileLon(x + (px + 0.5) / S, z);
  for (let py = 0; py < S; py++) {
    const lat = tileLat(y + (py + 0.5) / S, z);
    for (let px = 0; px < S; px++) {
      let h = 0;
      if (cur) {
        const e = sampleBilinear(cur.grid, cur.elev, lons[px]!, lat);
        h = Number.isFinite(e) ? (e - cur.min) * cur.vscale : 0;
      }
      const v = h + 32768;
      const o = (py * S + px) * 4;
      d[o] = Math.floor(v / 256);
      d[o + 1] = Math.floor(v) % 256;
      d[o + 2] = Math.floor((v - Math.floor(v)) * 256);
      d[o + 3] = 255;
    }
  }
  tileCache.set(key, img);
  if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value!);
  return img;
}

export function registerDemProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol("marsdem", async (params) => {
    const m = /marsdem:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`bad DEM url ${params.url}`);
    // An ImageBitmap goes straight to MapLibre: no PNG encode here and no decode on its side.
    const data = await createImageBitmap(renderTile(Number(m[1]), Number(m[2]), Number(m[3])));
    return { data };
  });
}

/** Zoom at which one DEM tile pixel is about one grid cell. */
export function demMaxZoom(grid: GridSpec) {
  const cellDeg = (grid.east - grid.west) / grid.width;
  const tileDeg = cellDeg * DEM_TILE_SIZE;
  return Math.max(10, Math.min(18, Math.round(Math.log2(360 / tileDeg))));
}
