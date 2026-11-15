/**
 * Elevation contour lines, traced in the browser from the elevation rasters the app already has
 * (so they need no pipeline output). Marching squares on a box-averaged copy of the raster, with
 * the segments of each level joined into polylines.
 *
 * Levels are absolute elevations (multiples of the interval). Every line carries a `tier` so the
 * map can show more of them as it zooms in: 3 = every 250 m, 2 = every 50 m, 1 = every 10 m.
 */
import type { GridSpec } from "@marsmap/core";

/** Interval of the finest lines (full-resolution ground), of the regular lines, and of the heavy ones, m. */
export const CONTOUR_FINE_M = 10;
export const CONTOUR_MID_M = 50;
export const CONTOUR_INDEX_M = 250;
/** Zoom from which the 50 m lines show, and from which the 10 m lines show. */
export const CONTOUR_MID_ZOOM = 12;
export const CONTOUR_FINE_ZOOM = 14;
export const CONTOUR_COLOR = "#ecd9b8";

export interface ContourRaster {
  grid: GridSpec;
  elev: Float32Array;
}

export interface ContourOptions {
  /** Elevation between lines, m. */
  intervalM: number;
  /** Trace on blocks of this many metres (the raster is box-averaged down to it). */
  cellM: number;
  /** Leave this lon/lat box empty (another raster's lines cover it). */
  skip?: Pick<GridSpec, "west" | "south" | "east" | "north">;
}

export interface ContourLevel {
  levelM: number;
  lines: [lon: number, lat: number][][];
}

export const contourTier = (levelM: number) => (levelM % CONTOUR_INDEX_M === 0 ? 3 : levelM % CONTOUR_MID_M === 0 ? 2 : 1);

/** Mean of each `s` x `s` block (NaN where a block has a gap). Partial blocks at the far edges are dropped. */
function boxAverage(src: Float32Array, width: number, height: number, s: number) {
  if (s <= 1) return { w: width, h: height, v: src };
  const w = Math.floor(width / s), h = Math.floor(height / s);
  const v = new Float32Array(w * h);
  const n = s * s;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let sum = 0;
      for (let dr = 0; dr < s; dr++) {
        const o = (r * s + dr) * width + c * s;
        for (let dc = 0; dc < s; dc++) sum += src[o + dc]!;
      }
      v[r * w + c] = sum / n;
    }
  }
  return { w, h, v };
}

/** One Chaikin corner-cutting pass. An open line keeps its end points. */
function chaikin(p: number[], closed: boolean): number[] {
  const n = p.length / 2;
  if (n < 3) return p;
  const out: number[] = [];
  if (!closed) out.push(p[0]!, p[1]!);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const ax = p[2 * i]!, ay = p[2 * i + 1]!, bx = p[2 * j]!, by = p[2 * j + 1]!;
    out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
  }
  if (closed) out.push(out[0]!, out[1]!);
  else out.push(p[2 * n - 2]!, p[2 * n - 1]!);
  return out;
}

/**
 * Contour lines of a raster, one entry per level, lowest first.
 *
 * A line crosses a grid edge where the level lies between its two samples (a sample counts as
 * above when it is >= the level). Edges are numbered 2k for the one running east from sample k
 * and 2k + 1 for the one running south, so a crossing has one id shared by the two cells it borders.
 */
export function contourLines(raster: ContourRaster, opts: ContourOptions): ContourLevel[] {
  const g = raster.grid;
  const step = opts.intervalM;
  const s = Math.max(1, Math.round(opts.cellM / g.cellSizeM));
  const { w, h, v } = boxAverage(raster.elev, g.width, g.height, s);
  if (w < 2 || h < 2) return [];
  // Sample (r, c) sits at ((c + 0.5) * s, (r + 0.5) * s) in cells of the raster.
  const lonOf = (x: number) => g.west + (((x + 0.5) * s) / g.width) * (g.east - g.west);
  const latOf = (y: number) => g.north - (((y + 0.5) * s) / g.height) * (g.north - g.south);

  // Squares of samples that lie wholly inside the skipped box, as index ranges.
  let sc0 = 0, sc1 = -1, sr0 = 0, sr1 = -1;
  if (opts.skip) {
    const k = opts.skip;
    const xOf = (lon: number) => (((lon - g.west) / (g.east - g.west)) * g.width) / s - 0.5;
    const yOf = (lat: number) => (((g.north - lat) / (g.north - g.south)) * g.height) / s - 0.5;
    sc0 = Math.ceil(xOf(k.west));
    sc1 = Math.floor(xOf(k.east)) - 1;
    sr0 = Math.ceil(yOf(k.north));
    sr1 = Math.floor(yOf(k.south)) - 1;
  }

  /** Per level number (level / interval): the edge ids of each segment's two ends, flat. */
  const segs = new Map<number, number[]>();
  const hit = [0, 0, 0, 0];
  for (let r = 0; r < h - 1; r++) {
    const skipRow = r >= sr0 && r <= sr1;
    for (let c = 0; c < w - 1; c++) {
      if (skipRow && c >= sc0 && c <= sc1) continue;
      const i = r * w + c;
      const tl = v[i]!, tr = v[i + 1]!, bl = v[i + w]!, br = v[i + w + 1]!;
      const lo = Math.min(tl, tr, bl, br), hi = Math.max(tl, tr, bl, br);
      if (!Number.isFinite(lo + hi)) continue; // a gap in the data
      for (let k = Math.floor(lo / step) + 1; k * step <= hi; k++) {
        const L = k * step;
        const a = tl >= L, b = tr >= L, d = br >= L, e = bl >= L;
        let n = 0;
        if (a !== b) hit[n++] = 2 * i; // top
        if (b !== d) hit[n++] = 2 * (i + 1) + 1; // right
        if (e !== d) hit[n++] = 2 * (i + w); // bottom
        if (a !== e) hit[n++] = 2 * i + 1; // left
        let list = segs.get(k);
        if (!list) segs.set(k, (list = []));
        if (n === 2) list.push(hit[0]!, hit[1]!);
        else if (n === 4) {
          // Saddle: the centre decides which pair of opposite corners is joined.
          const centreAbove = (tl + tr + bl + br) / 4 >= L;
          if (centreAbove === a) list.push(hit[0]!, hit[1]!, hit[2]!, hit[3]!); // cuts off top-right and bottom-left
          else list.push(hit[0]!, hit[3]!, hit[1]!, hit[2]!); // cuts off top-left and bottom-right
        }
      }
    }
  }

  const out: ContourLevel[] = [];
  for (const k of [...segs.keys()].sort((x, y) => x - y)) {
    const list = segs.get(k)!;
    const L = k * step;
    // Every crossing joins at most two segments, so the segments form chains and loops.
    const adj = new Map<number, number[]>();
    const link = (p: number, q: number) => {
      const nb = adj.get(p);
      if (nb) nb.push(q);
      else adj.set(p, [q]);
    };
    for (let j = 0; j < list.length; j += 2) {
      link(list[j]!, list[j + 1]!);
      link(list[j + 1]!, list[j]!);
    }
    const seen = new Set<number>();
    const walk = (start: number): number[] => {
      const chain = [start];
      seen.add(start);
      for (let cur = start; ; ) {
        const nx = adj.get(cur)!.find((q) => !seen.has(q));
        if (nx === undefined) break;
        seen.add(nx);
        chain.push(nx);
        cur = nx;
      }
      return chain;
    };
    const emit = (chain: number[], closed: boolean): [number, number][] | null => {
      // A loop round a single sample is noise at this scale.
      if (chain.length < 2 || (closed && chain.length <= 4)) return null;
      const flat: number[] = [];
      for (const id of chain) {
        const kk = id >> 1, vert = id & 1;
        const p = v[kk]!, q = v[vert ? kk + w : kk + 1]!;
        const t = (L - p) / (q - p);
        const col = kk % w, row = (kk - col) / w;
        flat.push(vert ? col : col + t, vert ? row + t : row);
      }
      const sm = chaikin(flat, closed);
      const line: [number, number][] = [];
      for (let j = 0; j < sm.length; j += 2) line.push([lonOf(sm[j]!), latOf(sm[j + 1]!)]);
      return line;
    };
    const lines: [number, number][][] = [];
    for (const [id, nb] of adj) {
      if (nb.length !== 1 || seen.has(id)) continue;
      const line = emit(walk(id), false);
      if (line) lines.push(line);
    }
    for (const id of adj.keys()) {
      if (seen.has(id)) continue;
      const line = emit(walk(id), true);
      if (line) lines.push(line);
    }
    if (lines.length) out.push({ levelM: L, lines });
  }
  return out;
}

/**
 * The map's contour lines as GeoJSON: `coarse` everywhere at the regular interval and, when there is
 * full-resolution ground (`fine`), 10 m lines on it, with the coarse lines left out under it.
 */
export function contourFeatures(coarse: ContourRaster | null, fine: ContourRaster | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const add = (levels: ContourLevel[]) => {
    for (const { levelM, lines } of levels) {
      features.push({ type: "Feature", properties: { elev: levelM, tier: contourTier(levelM) }, geometry: { type: "MultiLineString", coordinates: lines } });
    }
  };
  if (coarse) add(contourLines(coarse, { intervalM: CONTOUR_MID_M, cellM: 32, skip: fine?.grid }));
  if (fine) add(contourLines(fine, { intervalM: CONTOUR_FINE_M, cellM: 8 }));
  return { type: "FeatureCollection", features };
}
