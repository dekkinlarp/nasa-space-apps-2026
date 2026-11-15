/**
 * Orbital mineral indicators from CRISM targeted observations (MRO), resampled onto the
 * shared grid as float32 layers, plus minerals.json (stats, co-registration, POI samples).
 *
 * Source: CRISM MTRDR "summary parameter" product (map-projected, 18 m/px, 60 bands,
 * band-sequential float32). Only the image rows that cover the area are fetched with HTTP
 * Range requests (about 0.5 MB per band).
 *
 * These are spectral INDICATORS (band depths), not mineral abundances. Each CRISM pixel is
 * 18 m across, so a value describes a patch of ground, not a rock.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LayerEntry } from "../../packages/core/src/types";
import { CONFIG_DIR, areaDir, cacheDir, gridFromArea, isMain, loadArea, log, needs, type GridSpec } from "./lib/area";
import { cachedFile, fetchBuffer, writeAtomic, writeJson } from "./lib/net";
import { writeF32 } from "./lib/demgrid";

const PDS = "https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr";

export interface CrismScene {
  obs: string;
  acquired: string;
  /** URL of the summary-parameter product without its extension. */
  base: string;
}

/**
 * Scenes in priority order: a cell takes its value from the first scene that has data there.
 * The first covers the boxwork and most of the area; the second fills the strip west of it.
 */
export const CRISM_SCENES: CrismScene[] = [
  { obs: "FRT0000B6F1", acquired: "2008-07-09", base: `${PDS}/2008/2008_191/frt0000b6f1/frt0000b6f1_07_su165j_mtr3` },
  { obs: "FRT0001BBA1", acquired: "2010-11-06", base: `${PDS}/2010/2010_310/frt0001bba1/frt0001bba1_07_su165j_mtr3` },
];
export const CRISM_SOURCE = `MRO CRISM targeted observations ${CRISM_SCENES.map((s) => `${s.obs} (${s.acquired})`).join(" and ")}, MTRDR summary-parameter products (*_SU165J_MTR3), NASA PDS Geosciences Node, ${PDS}/`;
const PARAM_DOC = "Viviano-Beck et al. 2014, JGR Planets 119, doi:10.1002/2014JE004627 (revised CRISM summary parameters)";

/** Reflectance band used only to check alignment against the HiRISE photo. */
const ALIGN_BAND = "R770";
/** Search window for the alignment check, CRISM pixels each way. */
const MAX_SHIFT = 14;
/** Apply a shift only when it improves the correlation by at least this much. */
const MIN_GAIN = 0.05;

export interface MineralBand {
  id: string;
  band: string;
  name: string;
  indicates: string;
  caveat: string;
}

export const MINERAL_BANDS: MineralBand[] = [
  {
    id: "crism_clay",
    band: "D2300",
    name: "Clay indicator (D2300)",
    indicates: "Drop in reflectance near 2.3 µm, the signature of iron/magnesium clay minerals, which form in water.",
    caveat: "Mg-carbonate can raise it too.",
  },
  {
    id: "crism_sulfate",
    band: "SINDEX2",
    name: "Sulfate indicator (SINDEX2)",
    indicates: "Convexity near 2.29 µm caused by hydrated sulfate salts, left behind as water dried up.",
    caveat: "Ices raise it as well (not expected at this latitude).",
  },
  {
    id: "crism_hydration",
    band: "BD1900_2",
    name: "Bound water (BD1900_2)",
    indicates: "Depth of the 1.9 µm band of water held inside minerals (clays, hydrated sulfates, hydrated silica).",
    caveat: "Says that a hydrated mineral is present, not which one.",
  },
];

interface EnviHeader {
  samples: number;
  lines: number;
  bands: number;
  ulx: number;
  uly: number;
  pixelM: number;
  ignore: number;
  bandNames: string[];
}

export function parseEnviHeader(text: string): EnviHeader {
  const num = (k: string) => {
    const m = new RegExp(`^${k}\\s*=\\s*([-+0-9.eE]+)`, "m").exec(text);
    if (!m) throw new Error(`CRISM header: missing ${k}`);
    return Number(m[1]);
  };
  const block = (k: string) => {
    const m = new RegExp(`${k}\\s*=\\s*\\{([^}]*)\\}`).exec(text);
    if (!m) throw new Error(`CRISM header: missing ${k}`);
    return m[1]!.split(",").map((s) => s.trim());
  };
  if (!/interleave\s*=\s*bsq/i.test(text) || num("data type") !== 4 || num("byte order") !== 0 || num("header offset") !== 0) {
    throw new Error("CRISM header: expected band-sequential little-endian float32 with no header offset");
  }
  const map = block("map info");
  if (!/Equirectangular/i.test(map[0] ?? "") || Number(map[1]) !== 1 || Number(map[2]) !== 1) throw new Error("CRISM header: unexpected map info");
  // The app's lon = x / R assumes centre longitude 0 and standard parallel 0 on a 3396190 m sphere.
  const proj = block("projection info").map(Number);
  if (proj[1] !== 3396190 || proj[2] !== 0 || proj[3] !== 0) throw new Error("CRISM header: unexpected projection parameters");
  return {
    samples: num("samples"),
    lines: num("lines"),
    bands: num("bands"),
    ulx: Number(map[3]),
    uly: Number(map[4]),
    pixelM: Number(map[5]),
    ignore: num("data ignore value"),
    bandNames: block("band names"),
  };
}

/** Rows [r0, r1] of one band, full width. Cached on disk. */
async function bandRows(scene: CrismScene, h: EnviHeader, band: string, r0: number, r1: number, dir: string): Promise<Float32Array> {
  const b = h.bandNames.indexOf(band);
  if (b < 0) throw new Error(`CRISM ${scene.obs} has no band ${band}`);
  const file = join(dir, `${band}_rows_${r0}_${r1}.f32`);
  let buf: Buffer;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    const rowBytes = h.samples * 4;
    const start = b * h.lines * rowBytes + r0 * rowBytes;
    buf = await fetchBuffer(`${scene.base}.img`, { range: [start, start + (r1 - r0 + 1) * rowBytes - 1] });
    writeAtomic(file, buf);
  }
  const out = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  for (let i = 0; i < out.length; i++) if (out[i] === h.ignore || !Number.isFinite(out[i]!)) out[i] = NaN;
  return out;
}

interface Coreg {
  observation: string;
  shiftPx: [number, number];
  shiftM: [number, number];
  corrUnshifted: number | null;
  corrBest: number | null;
  applied: boolean;
}

interface OpenScene {
  scene: CrismScene;
  pixelM: number;
  coreg: Coreg;
  /** Sampler for one band: value of the (shifted) CRISM pixel under a lon/lat, NaN outside the scene. */
  sampler(band: string): Promise<(lon: number, lat: number) => number>;
}

const COREG_METHOD = `Pearson correlation between CRISM ${"R770"} reflectance and the HiRISE photo averaged to CRISM pixels, over whole-pixel shifts of up to 14 px, separately for each scene; a shift is applied only if it raises the correlation by 0.05 or more and is not at the edge of the search window.`;

/** Open one scene over the area: fetch its header, check its alignment against the HiRISE grid copy. Null if it misses the area. */
async function openScene(scene: CrismScene, g: GridSpec, gray: Buffer | null): Promise<OpenScene | null> {
  const cdir = cacheDir(`crism-${scene.obs.toLowerCase()}`);
  const h = parseEnviHeader((await cachedFile(`${scene.base}.hdr`, join(cdir, "su.hdr"))).toString("latin1"));
  const D = 180 / Math.PI;
  const R = g.marsRadiusM;
  // Pixel edges: column c spans x = ulx + c*p .. ulx + (c+1)*p; row r spans y = uly - r*p .. uly - (r+1)*p.
  const colOf = (lon: number) => ((lon / D) * R - h.ulx) / h.pixelM;
  const rowOf = (lat: number) => (h.uly - (lat / D) * R) / h.pixelM;
  const r0 = Math.max(0, Math.floor(rowOf(g.north)) - MAX_SHIFT - 1);
  const r1 = Math.min(h.lines - 1, Math.ceil(rowOf(g.south)) + MAX_SHIFT + 1);
  const c0 = Math.max(0, Math.floor(colOf(g.west)));
  const c1 = Math.min(h.samples - 1, Math.ceil(colOf(g.east)));
  if (r1 <= r0 || c1 <= c0) return null;
  const nRows = r1 - r0 + 1;
  log("minerals", `CRISM ${scene.obs}: ${h.samples}x${h.lines} px @ ${h.pixelM} m; area uses rows ${r0}-${r1}, cols ${c0}-${c1}`);

  const coreg: Coreg = { observation: scene.obs, shiftPx: [0, 0], shiftM: [0, 0], corrUnshifted: null, corrBest: null, applied: false };
  if (gray) {
    const ref = await bandRows(scene, h, ALIGN_BAND, r0, r1, cdir);
    // Mean HiRISE brightness inside each CRISM pixel footprint (unshifted position).
    const sum = new Float64Array(nRows * h.samples);
    const cnt = new Uint32Array(nRows * h.samples);
    for (let r = 0; r < g.height; r++) {
      const lat = g.north - ((r + 0.5) / g.height) * (g.north - g.south);
      const pr = Math.floor(rowOf(lat)) - r0;
      if (pr < 0 || pr >= nRows) continue;
      for (let c = 0; c < g.width; c++) {
        const lon = g.west + ((c + 0.5) / g.width) * (g.east - g.west);
        const pc = Math.floor(colOf(lon));
        if (pc < 0 || pc >= h.samples) continue;
        sum[pr * h.samples + pc]! += gray[r * g.width + c]!;
        cnt[pr * h.samples + pc]!++;
      }
    }
    const full = Math.round((h.pixelM / g.cellSizeM) ** 2 * 0.8); // only CRISM pixels mostly inside the area
    const corrAt = (sx: number, sy: number): number => {
      const xs: number[] = [], ys: number[] = [];
      for (let pr = 0; pr < nRows; pr++)
        for (let pc = c0; pc <= c1; pc++) {
          const k = pr * h.samples + pc;
          if (cnt[k]! < full) continue;
          const rr = pr + sy, cc = pc + sx;
          if (rr < 0 || rr >= nRows || cc < 0 || cc >= h.samples) continue;
          const v = ref[rr * h.samples + cc]!;
          if (Number.isNaN(v)) continue;
          xs.push(v);
          ys.push(sum[k]! / cnt[k]!);
        }
      return pearson(xs, ys);
    };
    let best = { sx: 0, sy: 0, c: corrAt(0, 0) };
    const c00 = best.c;
    for (let sy = -MAX_SHIFT; sy <= MAX_SHIFT; sy++)
      for (let sx = -MAX_SHIFT; sx <= MAX_SHIFT; sx++) {
        const c = corrAt(sx, sy);
        if (c > best.c) best = { sx, sy, c };
      }
    const apply = Number.isFinite(best.c) && best.c - c00 >= MIN_GAIN && Math.max(Math.abs(best.sx), Math.abs(best.sy)) < MAX_SHIFT;
    coreg.corrUnshifted = Number.isFinite(c00) ? Number(c00.toFixed(3)) : null;
    coreg.corrBest = Number.isFinite(best.c) ? Number(best.c.toFixed(3)) : null;
    if (apply) {
      coreg.shiftPx = [best.sx, best.sy];
      coreg.shiftM = [best.sx * h.pixelM, -best.sy * h.pixelM];
      coreg.applied = true;
    }
    log("minerals", `${scene.obs} alignment vs HiRISE: r = ${c00.toFixed(3)} unshifted, best r = ${best.c.toFixed(3)} at (${best.sx}, ${best.sy}) px -> ${apply ? "shift applied" : "no shift applied"}`);
  }
  const [sx, sy] = coreg.shiftPx;
  return {
    scene,
    pixelM: h.pixelM,
    coreg,
    async sampler(band) {
      const src = await bandRows(scene, h, band, r0, r1, cdir);
      return (lon, lat) => {
        const pr = Math.floor(rowOf(lat)) - r0 + sy;
        const pc = Math.floor(colOf(lon)) + sx;
        return pr < 0 || pr >= nRows || pc < 0 || pc >= h.samples ? NaN : src[pr * h.samples + pc]!;
      };
    },
  };
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 50) return NaN;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma, y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}

function quantile(sorted: Float32Array, q: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : NaN;
}

export async function runMinerals(): Promise<void> {
  const a = loadArea();
  const g: GridSpec = gridFromArea(a);
  const dir = areaDir(a);
  const outJson = join(dir, "minerals.json");
  const entriesFile = join(cacheDir(a.id), "mineral-layers.json");
  if (!needs(outJson) && existsSync(entriesFile) && MINERAL_BANDS.every((m) => existsSync(join(dir, `${m.id}.f32`)))) {
    log("minerals", "minerals.json exists, skipping");
    return;
  }
  const grayFile = join(cacheDir(a.id), "hirise_grid.u8");
  const gray = existsSync(grayFile) ? readFileSync(grayFile) : null;
  if (!gray) log("minerals", "hirise_grid.u8 missing: alignment not checked");
  const scenes: OpenScene[] = [];
  for (const sc of CRISM_SCENES) {
    const o = await openScene(sc, g, gray);
    if (o) scenes.push(o);
  }
  if (!scenes.length) throw new Error("no CRISM scene covers the area");
  const pixelM = scenes[0]!.pixelM;
  const lonOf = (c: number) => g.west + ((c + 0.5) / g.width) * (g.east - g.west);
  const latOf = (r: number) => g.north - ((r + 0.5) / g.height) * (g.north - g.south);
  const N = g.width * g.height;

  const pois = (JSON.parse(readFileSync(join(CONFIG_DIR, "pois.json"), "utf8")) as { pois: { id: string; lon: number; lat: number }[] }).pois;
  const entries: LayerEntry[] = [];
  const layerInfo: unknown[] = [];
  const poiSamples: Record<string, Record<string, { value: number | null; percentile: number | null }>> = {};
  // Which scene each cell came from (0 = none, 1 = first scene, ...): the same for every band.
  const sceneOf = new Uint8Array(N);
  for (const m of MINERAL_BANDS) {
    const samplers = await Promise.all(scenes.map((s) => s.sampler(m.band)));
    // Later scenes were taken in a different season and atmosphere, so their values sit at a slightly
    // different level. Each is moved by the median difference to the first scene where the two overlap.
    const match: { observation: string; offset: number; overlapR: number | null; overlapSamples: number }[] = [];
    const offsets = [0];
    const step = Math.max(1, Math.round(pixelM / g.cellSizeM)); // about one sample per CRISM pixel
    for (let k = 1; k < scenes.length; k++) {
      const xs: number[] = [], ys: number[] = [];
      for (let r = 0; r < g.height; r += step)
        for (let c = 0; c < g.width; c += step) {
          const p = samplers[0]!(lonOf(c), latOf(r)), q = samplers[k]!(lonOf(c), latOf(r));
          if (!Number.isNaN(p) && !Number.isNaN(q)) {
            xs.push(p);
            ys.push(q);
          }
        }
      const diffs = Float32Array.from(xs.map((x, i) => x - ys[i]!)).sort();
      const offset = diffs.length >= 200 ? quantile(diffs, 0.5) : 0;
      const r = pearson(xs, ys);
      offsets.push(offset);
      match.push({ observation: scenes[k]!.scene.obs, offset: Number(offset.toPrecision(3)), overlapR: Number.isFinite(r) ? Number(r.toFixed(2)) : null, overlapSamples: xs.length });
      log("minerals", `${m.band}: ${scenes[k]!.scene.obs} vs ${scenes[0]!.scene.obs} in ${xs.length} overlapping pixels: r = ${r.toFixed(2)}, median offset ${offset.toPrecision(3)}`);
    }
    const out = new Float32Array(N);
    const used = new Array<number>(scenes.length).fill(0);
    for (let r = 0; r < g.height; r++) {
      const lat = latOf(r);
      for (let c = 0; c < g.width; c++) {
        const lon = lonOf(c);
        let v = NaN;
        for (let k = 0; k < scenes.length && Number.isNaN(v); k++) {
          v = samplers[k]!(lon, lat) + offsets[k]!;
          if (!Number.isNaN(v)) {
            used[k]!++;
            sceneOf[r * g.width + c] = k + 1;
          }
        }
        out[r * g.width + c] = v;
      }
    }
    writeF32(join(dir, `${m.id}.f32`), out);
    const sorted = out.filter((v) => !Number.isNaN(v)).sort();
    const p = (q: number) => Number(quantile(sorted, q).toPrecision(4));
    let positive = 0;
    for (const v of sorted) if (v > 0) positive++;
    const positivePct = Number(((positive / Math.max(1, sorted.length)) * 100).toFixed(1));
    const max = Number(Math.max(p(0.98), 1e-4).toPrecision(2));
    const stats = {
      band: m.band,
      coveragePct: Number(((sorted.length / N) * 100).toFixed(1)),
      positivePct,
      p50: p(0.5),
      p90: p(0.9),
      p98: p(0.98),
      scenePct: Object.fromEntries(scenes.map((s, k) => [s.scene.obs, Number(((used[k]! / N) * 100).toFixed(1))])),
      sceneMatch: match,
    };
    layerInfo.push({ ...m, stats });
    for (const poi of pois) {
      const col = Math.floor(((poi.lon - g.west) / (g.east - g.west)) * g.width);
      const row = Math.floor(((g.north - poi.lat) / (g.north - g.south)) * g.height);
      const v = col < 0 || row < 0 || col >= g.width || row >= g.height ? NaN : out[row * g.width + col]!;
      let rank: number | null = null;
      if (!Number.isNaN(v)) {
        let lo = 0, hi = sorted.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (sorted[mid]! < v) lo = mid + 1;
          else hi = mid;
        }
        rank = Math.round((lo / Math.max(1, sorted.length)) * 100);
      }
      (poiSamples[poi.id] ??= {})[m.id] = { value: Number.isNaN(v) ? null : Number(v.toPrecision(3)), percentile: rank };
    }
    const shifts = scenes.filter((s) => s.coreg.applied).map((s) => `${s.scene.obs} by (${s.coreg.shiftPx.join(", ")}) px`);
    entries.push({
      id: m.id,
      file: `${m.id}.f32`,
      dtype: "float32",
      units: "band depth (unitless; above 0 means the absorption is present)",
      source: CRISM_SOURCE,
      method: `Band ${m.band} of the summary-parameter product (${PARAM_DOC}). ${m.indicates} ${m.caveat} Nearest-neighbour resample of the ${pixelM} m CRISM pixels onto the grid${shifts.length ? `, after whole-pixel shifts found by matching CRISM reflectance to the HiRISE photo (${shifts.join("; ")})` : ""}.${scenes.length > 1 ? ` Cells outside ${scenes[0]!.scene.obs} are filled from ${scenes.slice(1).map((s) => s.scene.obs).join(", ")}, moved by the median difference between the scenes where they overlap.` : ""} An indicator, not an abundance.`,
      version: "2",
      estimated: false,
      name: m.name,
      group: "science",
      nativeResolutionM: pixelM,
      display: { min: 0, max },
    });
    log("minerals", `${m.id} (${m.band}): coverage ${stats.coveragePct}% (${Object.entries(stats.scenePct).map(([k, v]) => `${k} ${v}%`).join(", ")}), ${positivePct}% above 0, p98 ${p(0.98)}`);
  }
  writeAtomic(join(dir, "crism_scene.u8"), sceneOf);
  writeJson(entriesFile, entries);
  writeJson(outJson, {
    generatedAt: new Date().toISOString(),
    observation: scenes.map((s) => s.scene.obs).join(" + "),
    mission: "Mars Reconnaissance Orbiter (CRISM)",
    acquired: scenes.map((s) => s.scene.acquired).join(", "),
    source: CRISM_SOURCE,
    parameterReference: PARAM_DOC,
    pixelM,
    note:
      "Spectral indicators, not abundances. One CRISM pixel is 18 m across, so a value describes a patch of ground rather than a rock, and dust or sand cover weakens every indicator." +
      (scenes.length > 1 ? ` The ${scenes[0]!.scene.obs} scene is used wherever it has data; the rest is filled from a second scene taken at a different time, so expect a visible seam and compare values across it with care.` : ""),
    // First scene's alignment, kept at the top level for readers that expect a single scene.
    coregistration: { method: COREG_METHOD, ...scenes[0]!.coreg },
    scenes: scenes.map((s) => ({ ...s.scene, coregistration: s.coreg })),
    layers: layerInfo,
    poiSamples,
  });
  log("minerals", "minerals.json written");
}

if (isMain(import.meta.url)) await runMinerals();
