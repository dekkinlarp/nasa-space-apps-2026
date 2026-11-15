/**
 * Small pictures for the Layers tab: what each layer draws over one square of real ground.
 * Every preview covers the same square (the frame), so the rows can be compared, and each is painted
 * by the same function that paints the layer on the map.
 */
import type { GridSpec, LonLat, SurfaceClass } from "@marsmap/core";
import { M_PER_DEG_LAT } from "../geo";
import type { DisplayLayers, GridData } from "../types";
import type { ReachData } from "../store";
import { CONTOUR_COLOR, CONTOUR_FINE_M, CONTOUR_INDEX_M, CONTOUR_MID_M } from "./contours";
import { imageryPreview } from "./imageryTiles";
import { confidenceUrl, costUrl, elevationUrl, paint, scienceUrl, slopeUrl, surfaceUrl, toUrl } from "./rasters";

export interface Frame {
  west: number;
  east: number;
  north: number;
  south: number;
  /** Side of the square, m. */
  sideM: number;
}

/** Side of the ground a preview shows, m: the base-imagery cards and the layer previews share it. */
export const PREVIEW_M = 4000;
/** The mineral previews look closer in: a mineral pixel is 18 m, and at 4 km a 32 px preview is only speckle. */
export const MINERAL_PREVIEW_M = 1000;
/** Preview pictures are S x S pixels: a 32 px thumbnail on a 3x screen. */
const S = 96;

export function previewFrame([lon, lat]: LonLat, sideM: number): Frame {
  const dLat = sideM / 2 / M_PER_DEG_LAT;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return { west: lon - dLon, east: lon + dLon, north: lat + dLat, south: lat - dLat, sideM };
}

/** True when the grid covers the whole frame. */
export const covers = (g: GridSpec, f: Frame) => g.west <= f.west && g.east >= f.east && g.south <= f.south && g.north >= f.north;

/** The frame cut out of a raster, nearest cell per pixel. Pixels off the grid get `fill`. */
function crop<T extends Float32Array | Uint8Array>(g: GridSpec, src: T, f: Frame, fill: number): T {
  const out = new (src.constructor as new (n: number) => T)(S * S).fill(fill) as T;
  for (let py = 0; py < S; py++) {
    const lat = f.north - ((py + 0.5) / S) * (f.north - f.south);
    const row = Math.floor(((g.north - lat) / (g.north - g.south)) * g.height);
    if (row < 0 || row >= g.height) continue;
    for (let px = 0; px < S; px++) {
      const lon = f.west + ((px + 0.5) / S) * (f.east - f.west);
      const col = Math.floor(((lon - g.west) / (g.east - g.west)) * g.width);
      if (col >= 0 && col < g.width) out[py * S + px] = src[row * g.width + col]!;
    }
  }
  return out;
}

const frameGrid = (g: GridSpec, f: Frame): GridSpec => ({ ...g, west: f.west, east: f.east, north: f.north, south: f.south, width: S, height: S });

/** Shading from the north-west, as the map's hillshade layer lights the ground. */
function hillshadeUrl(elev: Float32Array, sideM: number) {
  // Gale's plains are gentle, so the relief is steepened or the picture would be flat grey.
  const k = 4 / (2 * (sideM / S));
  return toUrl(
    paint({ width: S, height: S }, (i, px, o) => {
      const x = i % S, y = (i - x) / S;
      const e = elev[i]!;
      const w = elev[y * S + Math.max(0, x - 1)]!, ea = elev[y * S + Math.min(S - 1, x + 1)]!;
      const n = elev[Math.max(0, y - 1) * S + x]!, s = elev[Math.min(S - 1, y + 1) * S + x]!;
      if (![e, w, ea, n, s].every(Number.isFinite)) return;
      const gx = (ea - w) * k, gn = (n - s) * k;
      // Surface normal (-gx, -gn, 1) against light from the north-west at 45 degrees.
      const lit = (gx - gn + 1) / Math.sqrt(3 * (gx * gx + gn * gn + 1)) - 1 / Math.sqrt(3);
      const v = lit > 0 ? 255 : 0;
      px[o] = v; px[o + 1] = v; px[o + 2] = v; px[o + 3] = Math.min(230, Math.abs(lit) * 520);
    }),
  );
}

/** Contour lines at the finest of the map's intervals that leaves the picture readable. */
function contoursUrl(elev: Float32Array) {
  let lo = Infinity, hi = -Infinity;
  for (const v of elev) if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  const step = [CONTOUR_FINE_M, CONTOUR_MID_M, CONTOUR_INDEX_M].find((m) => (hi - lo) / m <= 9) ?? CONTOUR_INDEX_M;
  const band = (i: number) => Math.floor(elev[i]! / step);
  const edge = (i: number) => {
    const x = i % S;
    const b = band(i);
    return Number.isFinite(b) && ((x + 1 < S && band(i + 1) !== b && Number.isFinite(band(i + 1))) || (i + S < S * S && band(i + S) !== b && Number.isFinite(band(i + S))));
  };
  const c = parseInt(CONTOUR_COLOR.slice(1), 16);
  return toUrl(
    paint({ width: S, height: S }, (i, px, o) => {
      // Two pixels wide, so a line survives being drawn at 32 px.
      if (!(edge(i) || (i % S > 0 && edge(i - 1)) || (i >= S && edge(i - S)))) return;
      px[o] = c >> 16; px[o + 1] = (c >> 8) & 255; px[o + 2] = c & 255; px[o + 3] = 255;
    }),
  );
}

export type TerrainPreviewId = "elevation" | "slope" | "surface" | "confidence" | "hillshade" | "contours";

/** Previews of the layers that come from the terrain rasters. A layer the dataset lacks is left out. */
export async function terrainPreviews(L: DisplayLayers, classes: SurfaceClass[], f: Frame): Promise<Partial<Record<TerrainPreviewId, string>>> {
  const g = frameGrid(L.grid, f);
  const out: Partial<Record<TerrainPreviewId, string>> = {};
  const jobs: Promise<void>[] = [];
  const add = (id: TerrainPreviewId, url: Promise<string>) => jobs.push(url.then((u) => void (out[id] = u)));
  if (L.elevation) {
    const e = crop(L.grid, L.elevation, f, NaN);
    add("elevation", elevationUrl(g, e, L.elevMin, L.elevMax));
    add("hillshade", hillshadeUrl(e, f.sideM));
    add("contours", contoursUrl(e));
  }
  if (L.slope) add("slope", slopeUrl(g, crop(L.grid, L.slope, f, NaN)));
  if (L.surface) add("surface", surfaceUrl(g, crop(L.grid, L.surface, f, 255), classes));
  if (L.confidence) add("confidence", confidenceUrl(g, crop(L.grid, L.confidence, f, 255)));
  await Promise.all(jobs);
  return out;
}

/** Walk cost from the start, once the reach has been computed. */
export function costPreview(reach: ReachData, f: Frame) {
  return costUrl(frameGrid(reach.grid, f), crop(reach.grid, reach.outTimeS, f, NaN), crop(reach.grid, reach.backTimeS, f, NaN), reach.usableS);
}

/**
 * A science layer inside the frame. Where it has no signal there, the picture is of the ground round its
 * strongest cell instead (`elsewhere`), so the preview still shows what the layer looks like.
 */
export async function sciencePreview(gd: GridData, min: number, max: number, stops: [number, string][], f: Frame): Promise<{ url: string; elsewhere: boolean } | null> {
  let data = crop(gd.grid, gd.data, f, NaN);
  let elsewhere = false;
  if (!data.some((v) => v > min)) {
    let best = -1, top = min;
    for (let i = 0; i < gd.data.length; i++) if (gd.data[i]! > top) (top = gd.data[i]!), (best = i);
    if (best < 0) return null;
    const g = gd.grid;
    const col = best % g.width, row = (best - col) / g.width;
    f = previewFrame([g.west + ((col + 0.5) / g.width) * (g.east - g.west), g.north - ((row + 0.5) / g.height) * (g.north - g.south)], f.sideM);
    data = crop(g, gd.data, f, NaN);
    elsewhere = true;
  }
  return { url: await scienceUrl(frameGrid(gd.grid, f), data, min, max, stops), elsewhere };
}

function bitmapUrl(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  return toUrl(c);
}

/** A base-imagery choice over the frame, tinted or as captured. Null when the group is unknown. */
export async function basePreview(group: string, tint: boolean, f: Frame, signal: AbortSignal): Promise<string | null> {
  const bmp = await imageryPreview(group, tint, f, signal);
  return bmp && bitmapUrl((ctx) => ctx.drawImage(bmp, 0, 0), bmp.width);
}

/** The same ground as captured (left half) and with the Mars tint (right half). */
export async function tintPreview(group: string, f: Frame, signal: AbortSignal): Promise<string | null> {
  const raw = await imageryPreview(group, false, f, signal);
  const tinted = await imageryPreview(group, true, f, signal);
  if (!raw || !tinted) return null;
  return bitmapUrl((ctx, n) => {
    ctx.drawImage(raw, 0, 0);
    ctx.drawImage(tinted, n / 2, 0, n / 2, n, n / 2, 0, n / 2, n);
  }, raw.width);
}
