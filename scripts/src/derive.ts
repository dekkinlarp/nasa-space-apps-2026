/**
 * The deployable rasters, one band of tile rows at a time:
 *   tiles/elevation/<r>_<c>.bin           2 m elevation (small holes filled), int16 row differences, zlib
 *   tiles/surface/…, tiles/surface_confidence/…   the ROUGH surface-class estimate and its confidence
 *   overview/{elevation,slope,surface,surface_confidence}.bin   coarse copies of the whole region
 * Slope at full resolution is not shipped: the app computes it from the elevation tiles (Horn), which
 * is what this step does too (for the overview and the statistics).
 *
 * The surface estimate turns four cues into percentile ranks over the whole region. A first pass over
 * the bands samples each cue to build the region-wide distributions; the second pass classifies.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { LayerCodec } from "../../packages/core/src/types";
import { areaDir, cacheDir, FORCE, gridFromArea, isMain, loadArea, log, type AreaConfig, type GridSpec } from "./lib/area";
import { writeAtomic, writeJson } from "./lib/net";
import { boxMean, hornSlope, localStd, majority3 } from "./lib/raster";
import { coarseGrid, deflateValues, elevationCodec, RegionFile, U8_CODEC, writeTile } from "./lib/tiles";
import { elevFile, elevStatsFile, roughFile, type ElevationStats } from "./elevation";

export function cellSizes(g: GridSpec): { dx: number; dy: number } {
  const D = Math.PI / 180;
  const midLat = (g.north + g.south) / 2;
  return {
    dx: (g.marsRadiusM * (g.east - g.west) * D * Math.cos(midLat * D)) / g.width,
    dy: (g.marsRadiusM * (g.north - g.south) * D) / g.height,
  };
}

export const SURFACE_METHOD = [
  "Rule-based estimate per grid cell from four relative cues, each converted to a percentile rank over the whole region:",
  "R = 1 m DEM micro-roughness (RMS of elevation minus its 5x5 m mean, in a 5x5 m window, averaged to the grid cell);",
  "T = topographic position index (elevation minus 30 m-window mean; high = ridge, low = hollow);",
  "B = HiRISE brightness (Mars Trek curiosity_hirise_mosaic, grayscale; Gale sand is dark basaltic, bedrock/ridges light-toned);",
  "X = HiRISE texture (local std of brightness over about 14 m).",
  "Scores: sand = 0.45(1-B)+0.30(1-R)+0.25(1-T), x0.75 if B>0.55, x0.3 if slope>20 deg; bedrock = 0.45T+0.25B+0.30*(1-|R-0.6|/0.6);",
  "rubble = 0.65*max(0,(R-0.85)/0.15)+0.35*max(0,(X-0.7)/0.3) + 0.4 if slope>30 deg; firm soil = constant 0.60.",
  "Class = argmax, then 3x3 majority filter. Confidence = 40 + 160*min(1,(best-second)/0.25), rounded to steps of 10 (max 200: never 'certain').",
  "Ranks come from a sample of every 29th cell of the region. Cells without elevation are class 0 (unknown).",
  "Not validated against ground truth; ranks make the class mix relative to this region.",
].join(" ");

/** Rows of context read above and below each band (the widest window below is 7 cells). */
const HALO = 16;
/** Holes in the DEM up to about this many cells from valid ground are filled; larger gaps stay nodata. */
const FILL_CELLS = 8;
/** Sample stride for the region-wide cue distributions. */
const SAMPLE_STRIDE = 29;

export const DERIVE_DONE = "derive.json";

/** Mean in a (2r+1)^2 window over valid (non-NaN) cells; NaN where the window has none. */
function nanBoxMean(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const v = new Float32Array(a.length), z = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) if (!Number.isNaN(a[i]!)) (v[i] = 1), (z[i] = a[i]!);
  const mv = boxMean(v, w, h, r), mz = boxMean(z, w, h, r);
  for (let i = 0; i < a.length; i++) mz[i] = mv[i]! > 1e-6 ? mz[i]! / mv[i]! : NaN;
  return mz;
}

/** Fill NaN cells next to valid ground by neighbour averaging, at most `iters` cells deep. */
function fillSmallHoles(a: Float32Array, w: number, h: number, iters: number): number {
  let filled = 0;
  for (let it = 0; it < iters; it++) {
    const fills: [number, number][] = [];
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (!Number.isNaN(a[i]!)) continue;
        let s = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
            const v = a[rr * w + cc]!;
            if (!Number.isNaN(v)) (s += v), n++;
          }
        if (n >= 3) fills.push([i, s / n]);
      }
    if (!fills.length) break;
    for (const [i, v] of fills) a[i] = v;
    filled += fills.length;
  }
  return filled;
}

interface Cues {
  /** Rows [h0, h0 + n) of the region held in these arrays (band plus halo). */
  h0: number;
  rows: number;
  elev: Float32Array;
  slope: Float32Array;
  R: Float32Array;
  T: Float32Array;
  B: Float32Array;
  X: Float32Array;
  filled: number;
}

function computeCues(a: AreaConfig, g: GridSpec, files: { elev: RegionFile; rough: RegionFile; gray: RegionFile }, r0: number, r1: number): Cues {
  const W = g.width;
  const h0 = Math.max(0, r0 - HALO), h1 = Math.min(g.height, r1 + HALO), rows = h1 - h0;
  const elev = files.elev.read(h0, h1) as Float32Array;
  const filled = fillSmallHoles(elev, W, rows, FILL_CELLS);
  const { dx, dy } = cellSizes(g);
  const slope = hornSlope(elev, W, rows, dx, dy);
  const R = files.rough.read(h0, h1) as Float32Array;
  const cells = (radiusM: number) => Math.max(1, Math.round(radiusM / g.cellSizeM));
  // T: topographic position index (about a 30 m window: radius 14 m).
  const mean30 = nanBoxMean(elev, W, rows, cells(14));
  const T = new Float32Array(elev.length);
  for (let i = 0; i < T.length; i++) T[i] = elev[i]! - mean30[i]!;
  // B, X: HiRISE brightness and texture.
  const grayU8 = files.gray.read(h0, h1) as Uint8Array;
  const gray = Float32Array.from(grayU8);
  const B = boxMean(gray, W, rows, cells(2));
  const X = localStd(gray, W, rows, cells(6));
  void a;
  return { h0, rows, elev, slope, R, T, B, X, filled };
}

/** Fraction of the sorted sample below v. */
function rank(sorted: Float32Array, v: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo / Math.max(1, sorted.length - 1);
}

export interface DeriveResult {
  grid: GridSpec;
  tileSize: number;
  overviewGrid: GridSpec;
  codecs: { elevation: LayerCodec; overviewSlope: LayerCodec };
  present: string;
  stats: Record<string, unknown>;
}

export async function runDerive(): Promise<DeriveResult> {
  const a = loadArea();
  const g = gridFromArea(a);
  const T = a.tileSize ?? 512;
  const F = a.overviewFactor ?? 8;
  if (g.width % T || g.height % T) throw new Error(`area width/height must be multiples of tileSize ${T}`);
  const dir = areaDir(a);
  const doneFile = join(cacheDir(a.id), DERIVE_DONE);
  if (!FORCE && existsSync(doneFile)) {
    const done = JSON.parse(readFileSync(doneFile, "utf8")) as DeriveResult;
    if (JSON.stringify(done.grid) === JSON.stringify(g) && done.tileSize === T) {
      log("derive", "tiles exist for this grid, skipping (use --force to rebuild)");
      return done;
    }
  }
  const st = JSON.parse(readFileSync(elevStatsFile(a), "utf8")) as ElevationStats;
  const files = {
    elev: new RegionFile(elevFile(a), g.width, g.height, "float32"),
    rough: new RegionFile(roughFile(a), g.width, g.height, "float32"),
    gray: new RegionFile(join(cacheDir(a.id), "hirise_grid.u8"), g.width, g.height, "uint8"),
  };
  const W = g.width;
  const tilesX = W / T, tilesY = g.height / T;

  // ---- pass 1: region-wide distributions of the four cues ----
  const t0 = Date.now();
  const samples: number[][] = [[], [], [], []];
  for (let ty = 0; ty < tilesY; ty++) {
    const r0 = ty * T, r1 = r0 + T;
    const cu = computeCues(a, g, files, r0, r1);
    for (let r = r0; r < r1; r++) {
      const o = (r - cu.h0) * W;
      for (let c = (r * 7) % SAMPLE_STRIDE; c < W; c += SAMPLE_STRIDE) {
        const i = o + c;
        if (Number.isNaN(cu.elev[i]!)) continue;
        samples[0]!.push(Number.isNaN(cu.R[i]!) ? 0 : cu.R[i]!);
        samples[1]!.push(cu.T[i]!);
        samples[2]!.push(cu.B[i]!);
        samples[3]!.push(cu.X[i]!);
      }
    }
    if (ty % 8 === 7 || ty === tilesY - 1) log("derive", `pass 1: tile row ${ty + 1}/${tilesY} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  const sorted = samples.map((s) => Float32Array.from(s.filter((v) => Number.isFinite(v))).sort());
  samples.length = 0;
  log("derive", `cue samples: ${sorted[0]!.length}`);

  // ---- pass 2: classify, write tiles and overviews ----
  const elevCodec = elevationCodec(st.min, st.max);
  const og = coarseGrid(g, F, `${g.id}-overview`);
  const ovElev = new Float32Array(og.width * og.height).fill(NaN);
  const ovSlope = new Float32Array(og.width * og.height).fill(NaN);
  const ovSurf = new Uint8Array(og.width * og.height);
  const ovConf = new Uint8Array(og.width * og.height);
  for (const id of ["elevation", "surface", "surface_confidence", "slope"]) rmSync(join(dir, "tiles", id), { recursive: true, force: true });
  const present: string[] = [];
  const hist = [0, 0, 0, 0, 0];
  let valid = 0, filledTotal = 0, confSum = 0;
  const bytes: Record<string, number> = { elevation: 0, surface: 0, surface_confidence: 0 };
  const slopeSample: number[] = [];
  const t1 = Date.now();
  for (let ty = 0; ty < tilesY; ty++) {
    const r0 = ty * T, r1 = r0 + T;
    const cu = computeCues(a, g, files, r0, r1);
    filledTotal += cu.filled;
    const n = cu.rows * W;
    const cls = new Uint8Array(n);
    const conf = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(cu.elev[i]!)) continue;
      const r = rank(sorted[0]!, Number.isNaN(cu.R[i]!) ? 0 : cu.R[i]!), t = rank(sorted[1]!, cu.T[i]!), b = rank(sorted[2]!, cu.B[i]!), x = rank(sorted[3]!, cu.X[i]!);
      const s = cu.slope[i]!;
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
      // Steps of 10: the score is a rough heuristic, and the noisy last digit tripled the size of its tiles.
      conf[i] = Math.round((40 + 160 * Math.min(1, (scores[0]![1] - scores[1]![1]) / 0.25)) / 10) * 10;
    }
    const filtered = majority3(cls, W, cu.rows, 5);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(cu.elev[i]!)) (filtered[i] = 0), (conf[i] = 0);
      else if (filtered[i] !== cls[i]) conf[i] = Math.min(conf[i]!, 60);
    }
    // The band's own rows.
    const off = (r0 - cu.h0) * W, end = off + T * W;
    const bElev = cu.elev.subarray(off, end), bSurf = filtered.subarray(off, end), bConf = conf.subarray(off, end), bSlope = cu.slope.subarray(off, end);
    for (let tx = 0; tx < tilesX; tx++) {
      let any = false;
      for (let y = 0; y < T && !any; y++) for (let x = 0; x < T; x++) if (!Number.isNaN(bElev[y * W + tx * T + x]!)) { any = true; break; }
      present.push(any ? "1" : "0");
      if (!any) continue;
      bytes.elevation! += writeTile(dir, "elevation", ty, tx, bElev, W, T, elevCodec);
      bytes.surface! += writeTile(dir, "surface", ty, tx, bSurf, W, T, U8_CODEC);
      bytes.surface_confidence! += writeTile(dir, "surface_confidence", ty, tx, bConf, W, T, U8_CODEC);
    }
    // Overview cells and statistics.
    for (let oy = r0 / F; oy < r1 / F; oy++)
      for (let ox = 0; ox < og.width; ox++) {
        let se = 0, ss = 0, sc = 0, nv = 0;
        const counts = [0, 0, 0, 0, 0];
        for (let y = oy * F; y < oy * F + F; y++)
          for (let x = ox * F; x < Math.min(W, ox * F + F); x++) {
            const i = (y - r0) * W + x;
            const e = bElev[i]!;
            counts[bSurf[i]!]!++;
            if (Number.isNaN(e)) continue;
            se += e;
            ss += Number.isFinite(bSlope[i]!) ? bSlope[i]! : 0;
            sc += bConf[i]!;
            nv++;
          }
        const k = oy * og.width + ox;
        if (nv) {
          ovElev[k] = se / nv;
          ovSlope[k] = ss / nv;
          ovConf[k] = Math.round(sc / nv);
          let best = 1;
          for (let c = 2; c < 5; c++) if (counts[c]! > counts[best]!) best = c;
          ovSurf[k] = counts[best]! > 0 ? best : 0;
        }
      }
    for (let i = 0; i < bSurf.length; i++) {
      if (Number.isNaN(bElev[i]!)) continue;
      valid++;
      hist[bSurf[i]!]!++;
      confSum += bConf[i]!;
      if (i % 101 === 0 && Number.isFinite(bSlope[i]!)) slopeSample.push(bSlope[i]!);
    }
    if (ty % 4 === 3 || ty === tilesY - 1)
      log("derive", `pass 2: tile row ${ty + 1}/${tilesY}, tiles so far ${(Object.values(bytes).reduce((p, q) => p + q, 0) / 1e6).toFixed(0)} MB (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
  }
  files.elev.close();
  files.rough.close();
  files.gray.close();

  // Overviews.
  const ovSlopeCodec: LayerCodec = { kind: "int16", scale: 0.01, offset: 0, delta: true, deflate: true };
  writeAtomic(join(dir, "overview", "elevation.bin"), deflateValues(ovElev, elevCodec, og.width));
  writeAtomic(join(dir, "overview", "slope.bin"), deflateValues(ovSlope, ovSlopeCodec, og.width));
  writeAtomic(join(dir, "overview", "surface.bin"), deflateValues(ovSurf, U8_CODEC, og.width));
  writeAtomic(join(dir, "overview", "surface_confidence.bin"), deflateValues(ovConf, U8_CODEC, og.width));

  const names = ["unknown", "bedrock", "firm soil", "loose sand", "rocky rubble"];
  const pct = hist.map((h) => (100 * h) / Math.max(1, valid));
  slopeSample.sort((p, q) => p - q);
  const sp = (p: number) => slopeSample[Math.min(slopeSample.length - 1, Math.round((p / 100) * (slopeSample.length - 1)))] ?? NaN;
  const stats = {
    validCells: valid,
    validPct: Number(((100 * valid) / (g.width * g.height)).toFixed(2)),
    filledHoleCells: filledTotal,
    tilesPresent: present.filter((p) => p === "1").length,
    tilesTotal: present.length,
    tileBytes: bytes,
    surfaceHistogramPct: Object.fromEntries(names.map((nm, k) => [nm, Number(pct[k]!.toFixed(2))])),
    meanConfidence: Math.round(confSum / Math.max(1, valid)),
    slopePercentiles: { p5: sp(5), p25: sp(25), p50: sp(50), p75: sp(75), p90: sp(90), p95: sp(95), p99: sp(99) },
  };
  log("derive", "surface histogram: " + names.map((nm, k) => `${nm} ${pct[k]!.toFixed(1)}%`).join(", "));
  log("derive", `slope p5/25/50/75/90/95/99: ${[5, 25, 50, 75, 90, 95, 99].map((p) => sp(p).toFixed(1)).join(" / ")} deg`);
  log("derive", `${stats.tilesPresent}/${stats.tilesTotal} tiles with data; ${Object.entries(bytes).map(([k, v]) => `${k} ${(v / 1e6).toFixed(0)} MB`).join(", ")}; filled ${filledTotal} hole cells`);
  if (Math.max(...pct) > 90) log("derive", "WARNING: surface classes look degenerate (>90% one class)");
  const result: DeriveResult = { grid: g, tileSize: T, overviewGrid: og, codecs: { elevation: elevCodec, overviewSlope: ovSlopeCodec }, present: present.join(""), stats };
  writeJson(doneFile, result);
  writeJson(join(cacheDir(a.id), "surface-stats.json"), stats);
  return result;
}

if (isMain(import.meta.url)) await runDerive();
