/**
 * slope.f32 (Horn, degrees) and the ROUGH surface-class estimate surface.u8 +
 * surface_confidence.u8, derived from the DEM and the HiRISE photo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { areaDir, cacheDir, gridFromArea, isMain, loadArea, log, needs, type GridSpec } from "./lib/area";
import { loadWindow, readF32, windowToGrid, writeF32 } from "./lib/demgrid";
import { writeAtomic, writeJson } from "./lib/net";
import { boxMean, hornSlope, localStd, majority3, percentileRank, percentiles } from "./lib/raster";

export function cellSizes(g: GridSpec): { dx: number; dy: number } {
  const D = Math.PI / 180;
  const midLat = (g.north + g.south) / 2;
  return {
    dx: (g.marsRadiusM * (g.east - g.west) * D * Math.cos(midLat * D)) / g.width,
    dy: (g.marsRadiusM * (g.north - g.south) * D) / g.height,
  };
}

export const SURFACE_METHOD = [
  "Rule-based estimate per grid cell from four relative cues, each converted to a percentile rank over the area:",
  "R = 1 m DEM micro-roughness (RMS of elevation minus its 5x5 m mean, in a 5x5 m window, averaged to the grid cell);",
  "T = topographic position index (elevation minus 30 m-window mean; high = ridge, low = hollow);",
  "B = HiRISE brightness (Mars Trek curiosity_hirise_mosaic, grayscale; Gale sand is dark basaltic, bedrock/ridges light-toned);",
  "X = HiRISE texture (local std of brightness over about 14 m).",
  "Scores: sand = 0.45(1-B)+0.30(1-R)+0.25(1-T), x0.75 if B>0.55, x0.3 if slope>20 deg; bedrock = 0.45T+0.25B+0.30*(1-|R-0.6|/0.6);",
  "rubble = 0.65*max(0,(R-0.85)/0.15)+0.35*max(0,(X-0.7)/0.3) + 0.4 if slope>30 deg; firm soil = constant 0.60.",
  "Class = argmax, then 3x3 majority filter. Confidence = 40 + 160*min(1,(best-second)/0.25) (max 200: never 'certain').",
  "Not validated against ground truth; ranks make the class mix relative to this area.",
].join(" ");

export async function runDerive(): Promise<void> {
  const a = loadArea();
  const g = gridFromArea(a);
  const dir = areaDir(a);
  const elevFile = join(dir, "elevation.f32");
  const elev = readF32(elevFile);
  const { dx, dy } = cellSizes(g);
  const N = g.width * g.height;

  const slopeFile = join(dir, "slope.f32");
  let slope: Float32Array;
  if (needs(slopeFile)) {
    slope = hornSlope(elev, g.width, g.height, dx, dy);
    writeF32(slopeFile, slope);
    log("derive", `slope.f32 written (cell ${dx.toFixed(3)} x ${dy.toFixed(3)} m)`);
  } else slope = readF32(slopeFile);
  const sp = percentiles(slope, [5, 25, 50, 75, 90, 95, 99, 100]);
  log("derive", `slope percentiles p5/25/50/75/90/95/99/max: ${sp.map((v) => v.toFixed(1)).join(" / ")} deg`);

  const surfFile = join(dir, "surface.u8");
  const confFile = join(dir, "surface_confidence.u8");
  if (!needs(surfFile) && existsSync(confFile)) {
    log("derive", "surface.u8 exists, skipping");
    return;
  }

  // R: micro-roughness from the 1 m DEM.
  const win = loadWindow(cacheDir(a.id));
  if (!win) throw new Error("1 m DEM window missing: run the elevation step first");
  const smooth = boxMean(win.data, win.width, win.height, 2);
  const hp = new Float32Array(win.data.length);
  for (let i = 0; i < hp.length; i++) hp[i] = win.data[i]! - smooth[i]!;
  const sq = new Float32Array(hp.length);
  for (let i = 0; i < hp.length; i++) sq[i] = hp[i]! * hp[i]!;
  const rms1m = boxMean(sq, win.width, win.height, 2);
  for (let i = 0; i < rms1m.length; i++) rms1m[i] = Math.sqrt(rms1m[i]!);
  const rough = windowToGrid(win, rms1m, g);
  for (let i = 0; i < N; i++) if (Number.isNaN(rough[i]!)) rough[i] = 0;

  // Window sizes are fixed in metres so the estimate means the same thing at any cell size.
  const cells = (radiusM: number) => Math.max(1, Math.round(radiusM / g.cellSizeM));
  // T: topographic position index (about a 30 m window: radius 14 m).
  const mean30 = boxMean(elev, g.width, g.height, cells(14));
  const tpi = new Float32Array(N);
  for (let i = 0; i < N; i++) tpi[i] = elev[i]! - mean30[i]!;

  // B, X: HiRISE brightness and texture on the grid.
  const grayFile = join(cacheDir(a.id), "hirise_grid.u8");
  if (!existsSync(grayFile)) throw new Error("hirise_grid.u8 missing: run the imagery step first");
  const grayU8 = readFileSync(grayFile);
  const gray = new Float32Array(N);
  for (let i = 0; i < N; i++) gray[i] = grayU8[i]!;
  const bright = boxMean(gray, g.width, g.height, cells(2));
  const texture = localStd(gray, g.width, g.height, cells(6));

  const R = percentileRank(rough);
  const T = percentileRank(tpi);
  const B = percentileRank(bright);
  const X = percentileRank(texture);

  const cls = new Uint8Array(N);
  const conf = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = R[i]!, t = T[i]!, b = B[i]!, x = X[i]!, s = slope[i]!;
    let sand = 0.45 * (1 - b) + 0.3 * (1 - r) + 0.25 * (1 - t);
    if (b > 0.55) sand *= 0.75; // Gale sand is dark: bright smooth ground is more likely firm soil / dusty bedrock
    if (s > 20) sand *= 0.3;
    const bedrock = 0.45 * t + 0.25 * b + 0.3 * (1 - Math.abs(r - 0.6) / 0.6);
    const rubble = 0.65 * Math.max(0, (r - 0.85) / 0.15) + 0.35 * Math.max(0, (x - 0.7) / 0.3) + (s > 30 ? 0.4 : 0);
    const firm = 0.6;
    const scores: [number, number][] = [
      [1, bedrock],
      [2, firm],
      [3, sand],
      [4, rubble],
    ];
    scores.sort((p, q) => q[1] - p[1]);
    cls[i] = scores[0]![0];
    conf[i] = Math.round(40 + 160 * Math.min(1, (scores[0]![1] - scores[1]![1]) / 0.25));
  }
  const filtered = majority3(cls, g.width, g.height, 5);
  // where the filter changed the class, lower confidence
  for (let i = 0; i < N; i++) if (filtered[i] !== cls[i]) conf[i] = Math.min(conf[i]!, 60);
  writeAtomic(surfFile, filtered);
  writeAtomic(confFile, conf);

  const hist = [0, 0, 0, 0, 0];
  for (const v of filtered) hist[v]!++;
  const names = ["unknown", "bedrock", "firm soil", "loose sand", "rocky rubble"];
  const pct = hist.map((h) => (100 * h) / N);
  log("derive", "surface histogram: " + names.map((n, k) => `${n} ${pct[k]!.toFixed(1)}%`).join(", "));
  let cs = 0;
  for (const v of conf) cs += v;
  log("derive", `mean confidence ${(cs / N).toFixed(0)}/255`);
  const rp = percentiles(rough, [10, 50, 90, 99]);
  const tp = percentiles(tpi, [5, 50, 95]);
  writeJson(join(cacheDir(a.id), "surface-stats.json"), {
    histogramPct: Object.fromEntries(names.map((n, k) => [n, Number(pct[k]!.toFixed(2))])),
    roughnessM_p10_p50_p90_p99: rp,
    tpiM_p5_p50_p95: tp,
  });
  log("derive", `roughness p10/50/90/99 ${rp.map((v) => v.toFixed(3)).join("/")} m; TPI p5/50/95 ${tp.map((v) => v.toFixed(2)).join("/")} m`);
  if (Math.max(...pct) > 90) log("derive", "WARNING: surface classes look degenerate (>90% one class)");
}

if (isMain(import.meta.url)) await runDerive();
