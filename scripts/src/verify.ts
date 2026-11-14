/** Checks the outputs: sizes, ranges, distributions, georeferencing against rover waypoints. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { LayerManifest } from "../../packages/core/src/types";
import { areaDir, cacheDir, gridFromArea, inBounds, isMain, loadArea, loadSurfaceClasses, log } from "./lib/area";
import { loadWindow, readF32, sampleGrid, sampleWindow } from "./lib/demgrid";
import { writeJson } from "./lib/net";
import { percentiles } from "./lib/raster";

export async function runVerify(): Promise<boolean> {
  const a = loadArea();
  const g = gridFromArea(a);
  const dir = areaDir(a);
  const N = g.width * g.height;
  const problems: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) problems.push(msg);
  };

  const manifest = JSON.parse(readFileSync(join(dir, "layers.json"), "utf8")) as LayerManifest;
  for (const l of manifest.layers) {
    const f = join(dir, l.file);
    const want = N * (l.dtype === "float32" ? 4 : 1);
    const have = existsSync(f) ? statSync(f).size : -1;
    log("verify", `${l.file}: ${have} bytes (expected ${want})`);
    ok(have === want, `${l.file} size ${have} != ${want}`);
  }

  const elev = readF32(join(dir, "elevation.f32"));
  let mn = Infinity, mx = -Infinity, nan = 0;
  for (const v of elev) {
    if (Number.isNaN(v)) nan++;
    else {
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
  }
  log("verify", `elevation min ${mn.toFixed(2)} max ${mx.toFixed(2)} m, NaN ${nan}`);
  ok(nan === 0 && mn > -4700 && mx < -300, "elevation out of plausible range or has NaN");

  const slope = readF32(join(dir, "slope.f32"));
  const sp = percentiles(slope, [1, 10, 25, 50, 75, 90, 99]);
  log("verify", `slope p1/10/25/50/75/90/99: ${sp.map((v) => v.toFixed(1)).join(" / ")} deg`);
  ok(sp[3]! > 0.5 && sp[3]! < 40, "slope median implausible");

  const surf = readFileSync(join(dir, "surface.u8"));
  const hist = new Map<number, number>();
  for (const v of surf) hist.set(v, (hist.get(v) ?? 0) + 1);
  const classes = loadSurfaceClasses();
  const histPct = classes.map((c) => ({ id: c.id, name: c.name, pct: Number((((hist.get(c.id) ?? 0) * 100) / N).toFixed(2)) }));
  log("verify", "surface: " + histPct.map((h) => `${h.name} ${h.pct}%`).join(", "));
  ok(Math.max(...histPct.map((h) => h.pct)) < 80, "surface classes degenerate");

  // Georeferencing: DEM vs. rover waypoint elevations.
  const wp = JSON.parse(readFileSync(join(dir, "rover", "waypoints.area.json"), "utf8")) as {
    features: { properties: { sol: number; lon: number; lat: number; elevationM: number } }[];
  };
  const win = loadWindow(cacheDir(a.id));
  const rows = wp.features
    .map((f) => f.properties)
    .filter((p) => inBounds(g, p.lon, p.lat))
    .map((p) => {
      const grid = sampleGrid(g, elev, p.lon, p.lat);
      const dem1m = win ? sampleWindow(win, p.lon, p.lat) : NaN;
      return { sol: p.sol, lon: p.lon, lat: p.lat, waypointElevM: p.elevationM, grid2mM: grid, dem1mM: dem1m, diff2m: grid - p.elevationM, diff1m: dem1m - p.elevationM };
    });
  const absd = rows.map((r) => Math.abs(r.diff2m)).sort((x, y) => x - y);
  const abs1 = rows.map((r) => Math.abs(r.diff1m)).filter((v) => !Number.isNaN(v)).sort((x, y) => x - y);
  const med = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? NaN;
  const mean = rows.reduce((s, r) => s + r.diff2m, 0) / rows.length;
  log("verify", `waypoints in area: ${rows.length}; DEM(2 m grid) - waypoint elev: mean ${mean.toFixed(3)} m, median |d| ${med(absd).toFixed(3)} m, max |d| ${absd[absd.length - 1]?.toFixed(3)} m; 1 m DEM median |d| ${med(abs1).toFixed(3)} m`);
  for (const r of rows.filter((_, i) => i % Math.ceil(rows.length / 8) === 0))
    log("verify", `  sol ${r.sol} (${r.lon.toFixed(5)}, ${r.lat.toFixed(5)}): waypoint ${r.waypointElevM.toFixed(2)}  grid ${r.grid2mM.toFixed(2)}  1m ${r.dem1mM.toFixed(2)}`);
  ok(med(absd) < 2, "DEM vs waypoint elevations disagree (georeferencing?)");

  for (const im of manifest.imagery) {
    const f = join(dir, im.file);
    if (!existsSync(f)) {
      problems.push(`missing ${im.file}`);
      continue;
    }
    const m = await sharp(f).metadata();
    ok(m.width === im.widthPx && m.height === im.heightPx, `${im.file} size mismatch`);
    ok(Math.max(im.widthPx, im.heightPx) <= 4096, `${im.file} larger than 4096`);
    log("verify", `${im.file}: ${m.width}x${m.height}, bounds W${im.west.toFixed(6)} E${im.east.toFixed(6)} S${im.south.toFixed(6)} N${im.north.toFixed(6)}`);
  }

  const photos = JSON.parse(readFileSync(join(dir, "rover", "photos.json"), "utf8")) as { file: string }[];
  const missingPhotos = photos.filter((p) => !existsSync(join(dir, p.file))).length;
  log("verify", `photos: ${photos.length} listed, ${missingPhotos} missing`);
  ok(missingPhotos === 0 && photos.length > 0, "photos missing");

  writeJson(join(dir, "preview", "verify-report.json"), {
    generatedAt: new Date().toISOString(),
    elevation: { min: mn, max: mx, nan },
    slopePercentiles: { p1: sp[0], p10: sp[1], p25: sp[2], p50: sp[3], p75: sp[4], p90: sp[5], p99: sp[6] },
    surfaceHistogramPct: histPct,
    georef: { waypoints: rows.length, meanDiffM: mean, medianAbsDiffM: med(absd), maxAbsDiffM: absd[absd.length - 1], rows },
    problems,
  });
  if (problems.length) for (const p of problems) log("verify", "PROBLEM: " + p);
  else log("verify", "all checks passed");
  return problems.length === 0;
}

if (isMain(import.meta.url)) process.exitCode = (await runVerify()) ? 0 : 1;
