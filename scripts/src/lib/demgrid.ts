/** Projection maths + resampling between the 1 m DEM window and the shared grid. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GridSpec } from "./area";
import type { TiffMeta } from "./striptiff";
import { writeAtomic, writeJson } from "./net";

export const DEM_URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif";
export const DEM_LABEL_URL =
  "https://astrogeology.usgs.gov/ckan/dataset/b3d63877-8544-49bb-b0f3-532cf2c648d1/resource/d1a8afb0-3a48-4dcb-92a8-6c5794bb662f/download/msl_gale_dem_mosaic_1m_v3.lbl";
export const DEM_NAME = "USGS Astrogeology, Mars MSL Gale Merged DEM 1m v3 (MSL_Gale_DEM_Mosaic_1m_v3.tif)";

/** Equirectangular projection read from the GeoTIFF GeoKeys. */
export interface EqcProjection {
  radiusM: number;
  centerLonDeg: number;
  centerLatDeg: number;
  stdParallelDeg: number;
  falseEasting: number;
  falseNorthing: number;
  /** X of the LEFT EDGE of pixel column 0, Y of the TOP EDGE of row 0. */
  originX: number;
  originY: number;
  pixelX: number;
  pixelY: number;
}

export function projectionFromMeta(m: TiffMeta): EqcProjection {
  const keys = m.geoKeys;
  const val = (id: number): number | undefined => {
    for (let k = 4; k + 3 < keys.length; k += 4) {
      if (keys[k] !== id) continue;
      const loc = keys[k + 1]!;
      const off = keys[k + 3]!;
      return loc === 0 ? off : loc === 34736 ? m.geoDoubles[off] : undefined;
    }
    return undefined;
  };
  const coordTrans = val(3075);
  if (coordTrans !== 17) throw new Error(`expected CT_Equirectangular (17), got ${coordTrans}`);
  const [sx, sy] = m.pixelScale as [number, number];
  const tp = m.tiepoint;
  // Tiepoint (I,J)->(X,Y). PixelIsPoint: (I,J) refers to the pixel centre.
  const half = m.rasterType === 2 ? 0.5 : 0;
  return {
    radiusM: val(2057) ?? 3396190,
    centerLonDeg: val(3088) ?? 0,
    centerLatDeg: val(3089) ?? 0,
    stdParallelDeg: val(3078) ?? 0,
    falseEasting: val(3082) ?? 0,
    falseNorthing: val(3083) ?? 0,
    originX: tp[3]! - (tp[0]! + half) * sx,
    originY: tp[4]! + (tp[1]! + half) * sy,
    pixelX: sx,
    pixelY: sy,
  };
}

const D2R = Math.PI / 180;

/** lon/lat (deg, east-positive) -> continuous DEM pixel coords (u = col, v = row; 0 = edge). */
export function lonLatToPixel(p: EqcProjection, lon: number, lat: number): [number, number] {
  let dLon = lon - p.centerLonDeg;
  dLon = ((((dLon + 180) % 360) + 360) % 360) - 180;
  const x = p.falseEasting + p.radiusM * dLon * D2R * Math.cos(p.stdParallelDeg * D2R);
  const y = p.falseNorthing + p.radiusM * (lat - p.centerLatDeg) * D2R;
  return [(x - p.originX) / p.pixelX, (p.originY - y) / p.pixelY];
}

/** Window of the 1 m DEM held in memory / on disk. */
export interface DemWindow {
  r0: number;
  c0: number;
  width: number;
  height: number;
  proj: EqcProjection;
  data: Float32Array;
}

export function saveWindow(dir: string, w: DemWindow): void {
  writeAtomic(join(dir, "dem_1m.f32"), new Uint8Array(w.data.buffer, w.data.byteOffset, w.data.byteLength));
  writeJson(join(dir, "dem_1m.json"), { r0: w.r0, c0: w.c0, width: w.width, height: w.height, proj: w.proj });
}

export function loadWindow(dir: string): DemWindow | null {
  const j = join(dir, "dem_1m.json");
  const f = join(dir, "dem_1m.f32");
  if (!existsSync(j) || !existsSync(f)) return null;
  const meta = JSON.parse(readFileSync(j, "utf8")) as Omit<DemWindow, "data">;
  const b = readFileSync(f);
  const data = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (data.length !== meta.width * meta.height) return null;
  return { ...meta, data };
}

type Weights = { idx: Int32Array; w: Float32Array; start: Int32Array };

/** Box-filter weights for each output cell along one axis: overlap of [a,b) with DEM pixels. */
function axisWeights(n: number, edge: (i: number) => [number, number], limit: number): Weights {
  const idx: number[] = [];
  const w: number[] = [];
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    start[i] = idx.length;
    let [a, b] = edge(i);
    if (a > b) [a, b] = [b, a];
    for (let p = Math.floor(a); p < Math.ceil(b); p++) {
      const ov = Math.min(b, p + 1) - Math.max(a, p);
      if (ov <= 1e-9 || p < 0 || p >= limit) continue;
      idx.push(p);
      w.push(ov);
    }
  }
  start[n] = idx.length;
  return { idx: Int32Array.from(idx), w: Float32Array.from(w), start };
}

/**
 * Area-weighted average of a window raster (same layout as the DEM window) onto the grid.
 * Cells with < 30% valid coverage become NaN.
 */
export function windowToGrid(win: DemWindow, src: Float32Array, g: GridSpec): Float32Array {
  const lonOf = (c: number) => g.west + (c / g.width) * (g.east - g.west);
  const latOf = (r: number) => g.north - (r / g.height) * (g.north - g.south);
  const midLat = (g.north + g.south) / 2;
  const cols = axisWeights(
    g.width,
    (c) => [lonLatToPixel(win.proj, lonOf(c), midLat)[0] - win.c0, lonLatToPixel(win.proj, lonOf(c + 1), midLat)[0] - win.c0],
    win.width,
  );
  const rows = axisWeights(
    g.height,
    (r) => [lonLatToPixel(win.proj, g.west, latOf(r))[1] - win.r0, lonLatToPixel(win.proj, g.west, latOf(r + 1))[1] - win.r0],
    win.height,
  );
  const out = new Float32Array(g.width * g.height);
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      let sum = 0;
      let wsum = 0;
      let wall = 0;
      for (let i = rows.start[r]!; i < rows.start[r + 1]!; i++) {
        const rowOff = rows.idx[i]! * win.width;
        const wy = rows.w[i]!;
        for (let j = cols.start[c]!; j < cols.start[c + 1]!; j++) {
          const ww = wy * cols.w[j]!;
          wall += ww;
          const v = src[rowOff + cols.idx[j]!]!;
          if (Number.isNaN(v)) continue;
          sum += v * ww;
          wsum += ww;
        }
      }
      out[r * g.width + c] = wsum > 0.3 * wall && wsum > 0 ? sum / wsum : NaN;
    }
  }
  return out;
}

/** Fill NaN holes by repeated 8-neighbour averaging (only used for small DEM gaps). */
export function fillHoles(a: Float32Array, w: number, h: number): number {
  let holes = 0;
  for (const v of a) if (Number.isNaN(v)) holes++;
  const initial = holes;
  for (let iter = 0; iter < 10000 && holes > 0; iter++) {
    const fills: [number, number][] = [];
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (!Number.isNaN(a[i]!)) continue;
        let s = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
            const v = a[rr * w + cc]!;
            if (!Number.isNaN(v)) {
              s += v;
              n++;
            }
          }
        if (n > 0) fills.push([i, s / n]);
      }
    if (fills.length === 0) break;
    for (const [i, v] of fills) a[i] = v;
    holes -= fills.length;
  }
  return initial;
}

/** Bilinear sample of a grid raster at a lon/lat (cell-centre based). */
export function sampleGrid(g: GridSpec, a: Float32Array, lon: number, lat: number): number {
  const x = ((lon - g.west) / (g.east - g.west)) * g.width - 0.5;
  const y = ((g.north - lat) / (g.north - g.south)) * g.height - 0.5;
  const x0 = Math.max(0, Math.min(g.width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(g.height - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const at = (r: number, c: number) => a[r * g.width + c]!;
  return (
    at(y0, x0) * (1 - fx) * (1 - fy) + at(y0, x0 + 1) * fx * (1 - fy) + at(y0 + 1, x0) * (1 - fx) * fy + at(y0 + 1, x0 + 1) * fx * fy
  );
}

/** Bilinear sample of the 1 m window at a lon/lat. */
export function sampleWindow(win: DemWindow, lon: number, lat: number): number {
  const [u, v] = lonLatToPixel(win.proj, lon, lat);
  const x = u - win.c0 - 0.5;
  const y = v - win.r0 - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= win.width || y0 + 1 >= win.height) return NaN;
  const fx = x - x0;
  const fy = y - y0;
  const at = (r: number, c: number) => win.data[r * win.width + c]!;
  return (
    at(y0, x0) * (1 - fx) * (1 - fy) + at(y0, x0 + 1) * fx * (1 - fy) + at(y0 + 1, x0) * (1 - fx) * fy + at(y0 + 1, x0 + 1) * fx * fy
  );
}

export function readF32(file: string): Float32Array {
  const b = readFileSync(file);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export function writeF32(file: string, a: Float32Array): void {
  writeAtomic(file, new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
}
