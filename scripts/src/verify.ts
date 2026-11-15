/**
 * Checks the outputs the way the app reads them (tiles decoded with @marsmap/core): file sizes and
 * counts against the static-asset limits, value ranges, georeferencing against rover waypoints, slope
 * against the rover's recorded tilt, mineral-layer coverage and alignment, imagery and photos.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";
import { decodeRaster, readOverview, tilePath } from "../../packages/core/src/tiles";
import type { LayerEntry, LayerManifest } from "../../packages/core/src/types";
import { areaDir, cacheDir, inBounds, isMain, loadArea, loadSurfaceClasses, log } from "./lib/area";
import { writeJson } from "./lib/net";
import { cellSizes } from "./derive";

/** Cloudflare Workers static assets: at most 25 MiB per file and 20 000 files per version (free plan). */
const MAX_ASSET_BYTES = 25 * 2 ** 20;
const MAX_ASSETS = 20_000;

function listFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

export async function runVerify(): Promise<boolean> {
  const a = loadArea();
  const dir = areaDir(a);
  const problems: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) problems.push(msg);
  };
  const manifest = JSON.parse(readFileSync(join(dir, "layers.json"), "utf8")) as LayerManifest;
  const g = manifest.grid;
  const fetchBinary = async (f: string) => {
    const b = readFileSync(join(dir, f));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  // ---- what gets deployed ----
  const shipped = listFiles(dir).filter((f) => {
    const r = relative(dir, f);
    return !r.startsWith("preview") && !/^rover[\\/]MSL_/.test(r) && !r.startsWith(".") && !r.includes(`${"/"}.`);
  });
  const sizes = shipped.map((f) => statSync(f).size);
  const total = sizes.reduce((p, q) => p + q, 0);
  const biggest = Math.max(...sizes);
  log("verify", `deployable files: ${shipped.length}, ${(total / 1e6).toFixed(0)} MB, largest ${(biggest / 2 ** 20).toFixed(1)} MiB`);
  ok(biggest <= MAX_ASSET_BYTES, `a data file is over 25 MiB (${(biggest / 2 ** 20).toFixed(1)} MiB)`);
  ok(shipped.length < MAX_ASSETS - 500, `${shipped.length} data files: too close to the ${MAX_ASSETS} static-asset limit`);

  // ---- tiled layers: every listed tile exists and decodes ----
  const classes = loadSurfaceClasses();
  const tileStats: Record<string, { tiles: number; checked: number; min: number; max: number }> = {};
  for (const l of manifest.layers.filter((x) => x.tiles)) {
    const ts = l.tiles!;
    let n = 0, checked = 0, mn = Infinity, mx = -Infinity;
    for (let r = 0; r < ts.rows; r++)
      for (let c = 0; c < ts.cols; c++) {
        if (ts.present[r * ts.cols + c] !== "1") continue;
        n++;
        const f = join(dir, tilePath(l, r, c));
        if (!existsSync(f)) {
          problems.push(`missing tile ${tilePath(l, r, c)}`);
          continue;
        }
        if ((r * ts.cols + c) % 23 !== 0) continue;
        const v = await decodeRaster(await fetchBinary(tilePath(l, r, c)), l, ts.size, ts.size);
        checked++;
        for (const x of v) if (Number.isFinite(x)) (mn = Math.min(mn, x)), (mx = Math.max(mx, x));
      }
    tileStats[l.id] = { tiles: n, checked, min: mn, max: mx };
    log("verify", `${l.id}: ${n} tiles, ${checked} decoded, values ${mn.toFixed(2)}..${mx.toFixed(2)}`);
  }
  const te = tileStats.elevation;
  ok(!!te && te.min > -5200 && te.max < -300, "elevation tiles out of plausible range");
  ok(!tileStats.surface || tileStats.surface.max <= Math.max(...classes.map((c) => c.id)), "surface tiles hold unknown class ids");

  // ---- overview ----
  const byId = (id: string) => manifest.layers.find((l) => l.id === id);
  const ovElev = byId("elevation") ? await readOverview(byId("elevation")!, g, fetchBinary) : null;
  ok(!!ovElev, "no elevation overview");
  let evMin = Infinity, evMax = -Infinity, evNan = 0;
  if (ovElev) for (const v of ovElev.data) Number.isNaN(v) ? evNan++ : ((evMin = Math.min(evMin, v)), (evMax = Math.max(evMax, v)));
  log("verify", `elevation overview: ${evMin.toFixed(1)}..${evMax.toFixed(1)} m, ${((100 * evNan) / (ovElev?.data.length ?? 1)).toFixed(1)}% nodata`);
  const stats = existsSync(join(cacheDir(a.id), "surface-stats.json")) ? (JSON.parse(readFileSync(join(cacheDir(a.id), "surface-stats.json"), "utf8")) as Record<string, unknown>) : {};
  const slopeP = (stats.slopePercentiles ?? {}) as Record<string, number>;
  ok((slopeP.p50 ?? 0) > 0.5 && (slopeP.p50 ?? 99) < 40, "slope median implausible");
  const histPct = classes.map((c) => ({ id: c.id, name: c.name, pct: Number((stats.surfaceHistogramPct as Record<string, number> | undefined)?.[c.name.toLowerCase()] ?? 0) }));
  ok(Math.max(...Object.values((stats.surfaceHistogramPct ?? {}) as Record<string, number>), 0) < 80, "surface classes degenerate");

  // ---- georeferencing and slope at rover waypoints, from the decoded tiles ----
  const elevEntry = byId("elevation") as LayerEntry;
  const T = elevEntry.tiles?.size ?? g.width;
  const tileCache = new Map<string, Float32Array | null>();
  const elevTile = async (r: number, c: number) => {
    const k = `${r}_${c}`;
    if (!tileCache.has(k)) {
      const ts = elevEntry.tiles!;
      tileCache.set(k, ts.present[r * ts.cols + c] === "1" ? ((await decodeRaster(await fetchBinary(tilePath(elevEntry, r, c)), elevEntry, T, T)) as Float32Array) : null);
    }
    return tileCache.get(k)!;
  };
  const at = async (row: number, col: number) => {
    if (row < 0 || col < 0 || row >= g.height || col >= g.width) return NaN;
    const t = await elevTile(Math.floor(row / T), Math.floor(col / T));
    return t ? t[(row % T) * T + (col % T)]! : NaN;
  };
  const bilinear = async (lon: number, lat: number) => {
    const fx = ((lon - g.west) / (g.east - g.west)) * g.width - 0.5, fy = ((g.north - lat) / (g.north - g.south)) * g.height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const [p, q, r, s] = await Promise.all([at(y0, x0), at(y0, x0 + 1), at(y0 + 1, x0), at(y0 + 1, x0 + 1)]);
    return (p * (1 - tx) + q * tx) * (1 - ty) + (r * (1 - tx) + s * tx) * ty;
  };
  const { dx, dy } = cellSizes(g);
  const slopeAt = async (lon: number, lat: number) => {
    const c = Math.floor(((lon - g.west) / (g.east - g.west)) * g.width), r = Math.floor(((g.north - lat) / (g.north - g.south)) * g.height);
    const z = await Promise.all([-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => at(r + dr, c + dc))));
    const [p, b, cc, d, , f, gg, h, i] = z as number[];
    const dzdx = (cc! + 2 * f! + i! - (p! + 2 * d! + gg!)) / (8 * dx), dzdy = (gg! + 2 * h! + i! - (p! + 2 * b! + cc!)) / (8 * dy);
    return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  };
  const wp = JSON.parse(readFileSync(join(dir, "rover", "waypoints.area.json"), "utf8")) as {
    features: { properties: { sol: number; lon: number; lat: number; elevationM: number; tiltDeg?: number | null } }[];
  };
  const inside = wp.features.map((f) => f.properties).filter((p) => inBounds(g, p.lon, p.lat));
  const rows: { sol: number; lon: number; lat: number; waypointElevM: number; grid2mM: number; diff2m: number }[] = [];
  const tilt: { slope: number; tilt: number }[] = [];
  for (const p of inside) {
    const e = await bilinear(p.lon, p.lat);
    if (Number.isFinite(e)) rows.push({ sol: p.sol, lon: p.lon, lat: p.lat, waypointElevM: p.elevationM, grid2mM: e, diff2m: e - p.elevationM });
    if (typeof p.tiltDeg === "number") {
      const s = await slopeAt(p.lon, p.lat);
      if (Number.isFinite(s)) tilt.push({ slope: s, tilt: Math.abs(p.tiltDeg) });
    }
  }
  const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? NaN;
  const absd = rows.map((r) => Math.abs(r.diff2m)).sort((x, y) => x - y);
  const mean = rows.reduce((s, r) => s + r.diff2m, 0) / Math.max(1, rows.length);
  log("verify", `waypoints in region: ${inside.length} (${rows.length} on elevation); DEM - waypoint elev: mean ${mean.toFixed(3)} m, median |d| ${med(absd).toFixed(3)} m, p95 |d| ${(absd[Math.floor(absd.length * 0.95)] ?? NaN).toFixed(2)} m`);
  ok(rows.length > 0 && med(absd) < 2, "DEM vs waypoint elevations disagree (georeferencing?)");
  const slopeVsTilt = {
    waypoints: tilt.length,
    medianSlopeDeg: med(tilt.map((r) => r.slope)),
    medianTiltDeg: med(tilt.map((r) => r.tilt)),
    medianAbsDiffDeg: med(tilt.map((r) => Math.abs(r.slope - r.tilt))),
  };
  log("verify", `slope vs rover tilt at ${tilt.length} waypoints: median slope ${slopeVsTilt.medianSlopeDeg.toFixed(1)} deg, median tilt ${slopeVsTilt.medianTiltDeg.toFixed(1)} deg, median |d| ${slopeVsTilt.medianAbsDiffDeg.toFixed(1)} deg`);

  // ---- mineral layers ----
  const mineralsFile = join(dir, "minerals.json");
  let mineralCheck: unknown = null;
  if (existsSync(mineralsFile)) {
    const m = JSON.parse(readFileSync(mineralsFile, "utf8")) as {
      coregistration: { corrBest: number | null };
      layers: { id: string; stats: { coveragePct: number } }[];
      scenes?: { obs: string; coregistration: { corrBest: number | null; applied: boolean } }[];
    };
    mineralCheck = { coregistration: m.coregistration, scenes: m.scenes, coveragePct: Object.fromEntries(m.layers.map((l) => [l.id, l.stats.coveragePct])) };
    for (const l of m.layers) ok(l.stats.coveragePct > 40, `${l.id} covers only ${l.stats.coveragePct}% of the region`);
    ok((m.coregistration.corrBest ?? 0) > 0.5, `the main CRISM scene does not line up with the HiRISE photo (best r = ${m.coregistration.corrBest})`);
    for (const sc of m.scenes ?? []) if ((sc.coregistration.corrBest ?? 0) < 0.4) log("verify", `note: ${sc.obs} matches the photo poorly (best r = ${sc.coregistration.corrBest}); its alignment is uncertain`);
  }

  // ---- imagery ----
  let pics = 0;
  for (const im of manifest.imagery) {
    const f = join(dir, im.file);
    if (!existsSync(f)) {
      problems.push(`missing ${im.file}`);
      continue;
    }
    pics++;
    if (pics % 50 !== 1) continue;
    const md = await sharp(f).metadata();
    ok(md.width === im.widthPx && md.height === im.heightPx, `${im.file} size mismatch`);
  }
  ok(manifest.imagery.every((im) => Math.max(im.widthPx, im.heightPx) <= 4096), "a picture is larger than 4096 px");
  log("verify", `imagery: ${pics} pictures in ${new Set(manifest.imagery.map((i) => i.group ?? i.id)).size} groups`);

  const photos = JSON.parse(readFileSync(join(dir, "rover", "photos.json"), "utf8")) as { file: string }[];
  const missingPhotos = photos.filter((p) => !existsSync(join(dir, p.file))).length;
  log("verify", `photos: ${photos.length} listed, ${missingPhotos} missing`);
  ok(missingPhotos === 0 && photos.length > 0, "photos missing");

  writeJson(join(dir, "preview", "verify-report.json"), {
    generatedAt: new Date().toISOString(),
    deploy: { files: shipped.length, bytes: total, largestBytes: biggest },
    tiles: tileStats,
    elevation: { min: evMin, max: evMax, overviewNodataPct: Number(((100 * evNan) / (ovElev?.data.length ?? 1)).toFixed(2)) },
    slopePercentiles: slopeP,
    surfaceHistogramPct: histPct,
    slopeVsTilt,
    minerals: mineralCheck,
    georef: { waypoints: rows.length, meanDiffM: mean, medianAbsDiffM: med(absd), maxAbsDiffM: absd[absd.length - 1], rows },
    problems,
  });
  if (problems.length) for (const p of problems) log("verify", "PROBLEM: " + p);
  else log("verify", "all checks passed");
  return problems.length === 0;
}

if (isMain(import.meta.url)) process.exitCode = (await runVerify()) ? 0 : 1;
