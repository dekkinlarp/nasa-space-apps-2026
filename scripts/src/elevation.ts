/**
 * Elevation and 1 m micro-roughness on the 2 m grid, for the whole region, one band of rows at a time.
 *
 * Range-reads the DEM rows covering each band from the USGS 1 m Gale mosaic (strips cached under
 * data/cache/dem-gale-1m-v3), box-averages the 1 m pixels onto the 2 m cells and writes two raw
 * region rasters to data/cache/<id>/: elev2m.f32 (holes left as NaN; the derive step fills small ones)
 * and rough2m.f32 (RMS of the 1 m elevation minus its 5 x 5 m mean, averaged to each cell: an input of
 * the surface estimate). The deployable tiles are written by the derive step.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, FORCE, gridFromArea, isMain, loadArea, log, type AreaConfig } from "./lib/area";
import { DEM_URL, lonLatToPixel, projectionFromMeta, windowToGrid, type DemWindow } from "./lib/demgrid";
import { RemoteStripTiff } from "./lib/striptiff";
import { writeJson } from "./lib/net";
import { boxMean } from "./lib/raster";
import { bandGrid, RegionFile } from "./lib/tiles";

/** Extra DEM pixels around each band (for roughness at its edges). */
const MARGIN_PX = 8;
/** Grid rows per band. */
export const BAND_ROWS = 512;

export const elevFile = (a: AreaConfig) => join(cacheDir(a.id), "elev2m.f32");
export const roughFile = (a: AreaConfig) => join(cacheDir(a.id), "rough2m.f32");
export const elevStatsFile = (a: AreaConfig) => join(cacheDir(a.id), "elevation-stats.json");

export interface ElevationStats {
  grid: unknown;
  min: number;
  max: number;
  nodataCells: number;
  bands: number;
}

/** RMS of (z - 5x5 mean) in a 5x5 window, NaN-aware (NaN stays NaN). */
function microRoughness(z: Float32Array, w: number, h: number): Float32Array {
  const valid = new Float32Array(z.length);
  const zz = new Float32Array(z.length);
  for (let i = 0; i < z.length; i++) if (!Number.isNaN(z[i]!)) (valid[i] = 1), (zz[i] = z[i]!);
  const vm = boxMean(valid, w, h, 2);
  const sm = boxMean(zz, w, h, 2);
  // high-pass, then mean of squares
  for (let i = 0; i < z.length; i++) zz[i] = valid[i]! && vm[i]! > 0 ? (z[i]! - sm[i]! / vm[i]!) ** 2 : 0;
  const sq = boxMean(zz, w, h, 2);
  for (let i = 0; i < z.length; i++) sq[i] = valid[i]! && vm[i]! > 0 ? Math.sqrt(sq[i]! / vm[i]!) : NaN;
  return sq;
}

export async function runElevation(): Promise<void> {
  const a = loadArea();
  const g = gridFromArea(a);
  const statsFile = elevStatsFile(a);
  if (!FORCE && existsSync(statsFile) && existsSync(elevFile(a)) && existsSync(roughFile(a))) {
    const st = JSON.parse(readFileSync(statsFile, "utf8")) as ElevationStats;
    if (JSON.stringify(st.grid) === JSON.stringify(g)) {
      log("elevation", "elev2m.f32 exists for this grid, skipping (use --force to rebuild)");
      return;
    }
  }
  const tiff = new RemoteStripTiff(DEM_URL, cacheDir("dem-gale-1m-v3"));
  await tiff.open();
  const proj = projectionFromMeta(tiff.meta);
  log("elevation", "projection", proj);
  const elev = new RegionFile(elevFile(a), g.width, g.height, "float32", true);
  const rough = new RegionFile(roughFile(a), g.width, g.height, "float32", true);
  let mn = Infinity, mx = -Infinity, nodata = 0;
  const bands = Math.ceil(g.height / BAND_ROWS);
  for (let b = 0; b < bands; b++) {
    const t0 = Date.now();
    const r0g = b * BAND_ROWS, r1g = Math.min(g.height, r0g + BAND_ROWS);
    const bg = bandGrid(g, r0g, r1g);
    const nw = lonLatToPixel(proj, bg.west, bg.north), se = lonLatToPixel(proj, bg.east, bg.south);
    const r0 = Math.max(0, Math.floor(nw[1]) - MARGIN_PX), r1 = Math.min(tiff.meta.height, Math.ceil(se[1]) + MARGIN_PX);
    const c0 = Math.max(0, Math.floor(nw[0]) - MARGIN_PX), c1 = Math.min(tiff.meta.width, Math.ceil(se[0]) + MARGIN_PX);
    const data = await tiff.readWindow(r0, r1, c0, c1);
    const win: DemWindow = { r0, c0, width: c1 - c0, height: r1 - r0, proj, data };
    const e = windowToGrid(win, data, bg);
    const rms = windowToGrid(win, microRoughness(data, win.width, win.height), bg);
    for (const v of e) {
      if (Number.isNaN(v)) nodata++;
      else {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    elev.write(r0g, e);
    rough.write(r0g, rms);
    log("elevation", `band ${b + 1}/${bands}: DEM rows ${r0}-${r1} (${win.width} px wide), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  elev.close();
  rough.close();
  log("elevation", `region ${g.width}x${g.height}: min ${mn.toFixed(2)} m, max ${mx.toFixed(2)} m, nodata cells ${nodata} (${((100 * nodata) / (g.width * g.height)).toFixed(2)}%)`);
  writeJson(statsFile, { grid: g, min: mn, max: mx, nodataCells: nodata, bands } satisfies ElevationStats);
}

if (isMain(import.meta.url)) await runElevation();
