/**
 * elevation.f32: range-reads only the DEM rows covering the area from the USGS 1 m Gale
 * mosaic, caches the compressed strips + the 1 m window, and box-averages onto the 2 m grid.
 */
import { join } from "node:path";
import { areaDir, cacheDir, gridFromArea, isMain, loadArea, log, needs, FORCE } from "./lib/area";
import { DEM_URL, fillHoles, loadWindow, lonLatToPixel, projectionFromMeta, saveWindow, windowToGrid, writeF32, type DemWindow } from "./lib/demgrid";
import { RemoteStripTiff } from "./lib/striptiff";
import { writeJson } from "./lib/net";

/** Extra DEM pixels around the area (for slope/roughness at the edges). */
const MARGIN_PX = 8;

export async function getDemWindow(): Promise<DemWindow> {
  const area = loadArea();
  const winDir = cacheDir(area.id);
  const cached = loadWindow(winDir);
  const tiff = new RemoteStripTiff(DEM_URL, cacheDir("dem-gale-1m-v3"));
  await tiff.open();
  const proj = projectionFromMeta(tiff.meta);
  const corners = [
    lonLatToPixel(proj, area.west, area.north),
    lonLatToPixel(proj, area.east, area.south),
  ];
  const r0 = Math.max(0, Math.floor(corners[0]![1]) - MARGIN_PX);
  const r1 = Math.min(tiff.meta.height, Math.ceil(corners[1]![1]) + MARGIN_PX);
  const c0 = Math.max(0, Math.floor(corners[0]![0]) - MARGIN_PX);
  const c1 = Math.min(tiff.meta.width, Math.ceil(corners[1]![0]) + MARGIN_PX);
  if (cached && !FORCE && cached.r0 === r0 && cached.c0 === c0 && cached.width === c1 - c0 && cached.height === r1 - r0) return cached;
  log("elevation", `projection`, proj);
  log("elevation", `DEM window rows ${r0}..${r1} cols ${c0}..${c1} (${c1 - c0} x ${r1 - r0} px)`);
  const data = await tiff.readWindow(r0, r1, c0, c1);
  const win: DemWindow = { r0, c0, width: c1 - c0, height: r1 - r0, proj, data };
  saveWindow(winDir, win);
  return win;
}

export async function runElevation(): Promise<void> {
  const area = loadArea();
  const g = gridFromArea(area);
  const dir = areaDir(area);
  const out = join(dir, "elevation.f32");
  if (!needs(out)) {
    log("elevation", "elevation.f32 exists, skipping (use --force to rebuild)");
    return;
  }
  const win = await getDemWindow();
  let nanWin = 0;
  for (const v of win.data) if (Number.isNaN(v)) nanWin++;
  log("elevation", `1 m window: ${win.width}x${win.height}, nodata px ${nanWin}`);
  const elev = windowToGrid(win, win.data, g);
  const holes = fillHoles(elev, g.width, g.height);
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of elev) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  log("elevation", `2 m grid ${g.width}x${g.height}: min ${mn.toFixed(2)} m, max ${mx.toFixed(2)} m, filled holes ${holes}`);
  writeF32(out, elev);
  writeJson(join(cacheDir(area.id), "elevation-stats.json"), { min: mn, max: mx, filledHoles: holes, windowNodataPx: nanWin });
}

if (isMain(import.meta.url)) await runElevation();
