/**
 * Client-side DEM tiles for MapLibre terrain. MapLibre thinks the map is Earth, so a Mars
 * degree is drawn as an Earth degree (1.88x larger in Earth metres). To keep true vertical
 * proportions, heights are multiplied by R_earth / R_mars before encoding; the
 * exaggeration slider then means real vertical exaggeration. Heights are relative to the
 * area's median elevation so the map centre sits near 0 m (negatives are fine in Terrarium). Encoding: Terrarium
 * (h = R*256 + G + B/256 - 32768).
 *
 * Cells with no elevation (the strips beside the DEM mosaic, holes in it) take the height of the nearest
 * measured cell in their row, for drawing only. Left at the reference height they stood kilometres
 * below the ground next to them and showed as a wall of smeared imagery around the map.
 *
 * Heights come from the full-resolution planning window where there is one, and from the region's
 * coarse overview everywhere else. When the window moves, the tile URLs get a new version so MapLibre
 * fetches fresh tiles (see demTilesUrl).
 */
import maplibregl from "maplibre-gl";
import type { GridSpec } from "@marsmap/core";
import { sampleBilinear } from "../geo";

export const EARTH_RADIUS_M = 6378137;
export const DEM_TILE_SIZE = 256;

interface Raster {
  grid: GridSpec;
  elev: Float32Array;
}
interface DemSource {
  overview: Raster;
  detail: Raster | null;
  min: number;
  vscale: number;
  /** Lowest and highest terrain height as drawn (map metres, before exaggeration). */
  lo: number;
  hi: number;
}
let current: DemSource | null = null;
let registered = false;
let version = 0;

/** Encoded tiles, shared by the terrain and hillshade sources (both ask for the same tiles). */
const tileCache = new Map<string, ImageData>();
const TILE_CACHE_MAX = 96;

/** Gap-filled copies of elevation rasters, by the raster they were made from. */
const filled = new WeakMap<Float32Array, Float32Array>();

/** The raster with every no-data cell given the nearest measured height in its row (or, for an empty row, of the nearest row). */
function fillGaps(r: Raster): Raster {
  let out = filled.get(r.elev);
  if (!out) {
    const { width: w, height: h } = r.grid;
    out = r.elev;
    let copied = false;
    const emptyRows: number[] = [];
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let left = -1; // last measured cell seen in this row
      for (let x = 0; x <= w; x++) {
        if (x < w && !Number.isFinite(r.elev[o + x]!)) continue;
        // Cells left+1 .. x-1 are a gap between measured cells `left` and `x` (either may be off the row).
        if (x - left > 1) {
          if (left < 0 && x === w) {
            emptyRows.push(y);
            break;
          }
          if (!copied) {
            out = new Float32Array(r.elev);
            copied = true;
          }
          const mid = left < 0 ? left : x === w ? w : (left + x) >> 1;
          for (let i = left + 1; i < x; i++) out[o + i] = i <= mid ? out[o + left]! : out[o + x]!;
        }
        left = x;
      }
    }
    if (emptyRows.length && emptyRows.length < h) {
      if (!copied) out = new Float32Array(r.elev);
      const empty = new Set(emptyRows);
      for (const y of emptyRows) {
        let d = 1;
        while (empty.has(y - d) || y - d < 0) {
          if (y + d < h && !empty.has(y + d)) break;
          d++;
        }
        const src = y - d >= 0 && !empty.has(y - d) ? y - d : y + d;
        out.copyWithin(y * w, src * w, src * w + w);
      }
    }
    filled.set(r.elev, out);
  }
  return out === r.elev ? r : { grid: r.grid, elev: out };
}

/**
 * Elevation for the terrain: the region overview, plus the planning window at full resolution (or null).
 * Returns the tile URL template to give the DEM sources (it changes whenever the heights do).
 */
export function setDemSource(overview: Raster, detail: Raster | null, ref: number): string {
  const vscale = EARTH_RADIUS_M / overview.grid.marsRadiusM;
  let lo = Infinity, hi = -Infinity;
  for (const r of [overview, detail]) {
    if (!r) continue;
    for (let i = 0; i < r.elev.length; i++) {
      const v = r.elev[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  // 0 is kept inside the range for the ground beyond the DEM tiles, which MapLibre draws flat.
  current = { overview: fillGaps(overview), detail, min: ref, vscale, lo: Math.min(0, (lo - ref) * vscale), hi: Math.max(0, (hi - ref) * vscale) };
  tileCache.clear();
  version++;
  return demTilesUrl();
}

/** Tile URL template of the current heights. */
export const demTilesUrl = () => `marsdem://v${version}/{z}/{x}/{y}`;

const inside = (g: GridSpec, lon: number, lat: number) => lon >= g.west && lon <= g.east && lat >= g.south && lat <= g.north;

/**
 * Elevation (m) at a point from the window if it covers it, else the overview. Past the edge of the
 * area the edge height carries on, so a tile that straddles the edge does not end in a cliff down to 0.
 */
function elevAt(c: DemSource, lon: number, lat: number): number {
  if (c.detail && inside(c.detail.grid, lon, lat)) {
    const e = sampleBilinear(c.detail.grid, c.detail.elev, lon, lat);
    if (Number.isFinite(e)) return e;
  }
  return sampleBilinear(c.overview.grid, c.overview.elev, lon, lat);
}

/** Terrain height MapLibre draws at a point, in map metres before exaggeration. */
export function demHeight(lon: number, lat: number): number {
  const c = current;
  if (!c) return 0;
  const e = elevAt(c, lon, lat);
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
        const e = elevAt(cur, lons[px]!, lat);
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
    const m = /marsdem:\/\/(?:v\d+\/)?(\d+)\/(\d+)\/(\d+)/.exec(params.url);
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
