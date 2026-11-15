/** Colour the selected route along its length by terrain slope (from the segment profiles). */
import type { LonLat, RouteResult, WalkParams } from "@marsmap/core";
import { M_PER_DEG_LAT } from "../geo";

/** Route slope colours, bright enough to read on the grey HiRISE photo. */
export const ROUTE_SLOPE_COLORS = {
  easy: "#4fdc7a",
  moderate: "#ffe14d",
  caution: "#ff9a2e",
  limit: "#ff3b3b",
} as const;

type RGB = [number, number, number];
const hex = (c: string): RGB => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Slope thresholds, degrees, derived from the walk params (caution / max slope). */
export function slopeBands(p: Pick<WalkParams, "cautionSlopeDeg" | "maxSlopeDeg"> | null) {
  const caution = p?.cautionSlopeDeg ?? 15;
  const max = Math.max(p?.maxSlopeDeg ?? 20, caution + 1);
  return { easyBelow: Math.max(0, caution - 5), caution, max };
}

/** Piecewise colour ramp: green below caution-5°, yellow up to caution, orange to the limit, red at it. */
export function routeSlopeColor(slopeDeg: number, p: Pick<WalkParams, "cautionSlopeDeg" | "maxSlopeDeg"> | null): string {
  const b = slopeBands(p);
  const C = ROUTE_SLOPE_COLORS;
  const stops: [number, string][] = [
    [b.easyBelow - 1, C.easy],
    [b.easyBelow + 1, C.moderate],
    [b.caution - 0.75, C.moderate],
    [b.caution + 0.75, C.caution],
    [b.max - 1.5, C.caution],
    [b.max, C.limit],
  ];
  if (slopeDeg <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    const [t0, c0] = stops[i - 1]!;
    if (slopeDeg <= t1) {
      const k = (slopeDeg - t0) / (t1 - t0 || 1);
      const a = hex(c0), z = hex(c1);
      return toHex([a[0] + (z[0] - a[0]) * k, a[1] + (z[1] - a[1]) * k, a[2] + (z[2] - a[2]) * k]);
    }
  }
  return C.limit;
}

function cumMetres(path: LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const [lo0, la0] = path[i - 1]!, [lo1, la1] = path[i]!;
    const kx = M_PER_DEG_LAT * Math.cos((((la0 + la1) / 2) * Math.PI) / 180);
    out.push(out[i - 1]! + Math.hypot((lo1 - lo0) * kx, (la1 - la0) * M_PER_DEG_LAT));
  }
  return out;
}

/** Point at distance d (metres) along a path with cumulative distances `cum`; `j` is a search hint. */
function pointAt(path: LonLat[], cum: number[], d: number, j: number): [LonLat, number] {
  while (j < cum.length - 2 && cum[j + 1]! < d) j++;
  const a = path[j]!, b = path[j + 1] ?? a;
  const span = cum[j + 1]! - cum[j]!;
  const k = span > 0 ? Math.min(1, Math.max(0, (d - cum[j]!) / span)) : 0;
  return [[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], j];
}

/** Smoothing half-window along the route, metres: hides single-cell DEM noise, keeps real steep pitches. */
const SMOOTH_M = 3;

/**
 * One LineString per run of similar slope along every segment of `r`. Each feature carries
 * `color`, `slope` (deg) and `seg`/`over` like the main route source.
 */
export function routeSlopeFeatures(r: RouteResult | null, params: WalkParams | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (!r) return { type: "FeatureCollection", features };
  const over = r.totals.firstSegmentOverLimit;
  r.segments.forEach((s, si) => {
    const path = s.path;
    const prof = s.profile;
    if (path.length < 2) return;
    const props = { profile: r.profile.id, seg: si, over: over != null && si >= over ? 1 : 0 };
    const cum = cumMetres(path);
    const pathLen = cum[cum.length - 1]!;
    const profLen = prof.length ? prof[prof.length - 1]!.distanceM : 0;
    if (prof.length < 2 || pathLen <= 0 || profLen <= 0) {
      features.push({ type: "Feature", properties: { ...props, slope: s.avgSlopeDeg, color: routeSlopeColor(s.avgSlopeDeg, params) }, geometry: { type: "LineString", coordinates: path } });
      return;
    }
    // Light distance-window smoothing of the per-cell slope.
    const sm = prof.map((p, i) => {
      let sum = 0, n = 0;
      for (let j = i; j >= 0 && p.distanceM - prof[j]!.distanceM <= SMOOTH_M; j--) (sum += prof[j]!.slopeDeg), n++;
      for (let j = i + 1; j < prof.length && prof[j]!.distanceM - p.distanceM <= SMOOTH_M; j++) (sum += prof[j]!.slopeDeg), n++;
      return sum / n;
    });
    // Intervals between profile points, merged into runs of the same 0.5° bin.
    const scale = pathLen / profLen;
    let runStart = 0;
    let runBin = Math.round(Math.max(sm[0]!, sm[1]!) * 2);
    let hint = 0;
    const flush = (endIdx: number, bin: number) => {
      const d0 = prof[runStart]!.distanceM * scale, d1 = prof[endIdx]!.distanceM * scale;
      if (d1 <= d0) return;
      const [p0, h0] = pointAt(path, cum, d0, hint);
      const coords: LonLat[] = [p0];
      let j = h0 + 1;
      while (j < cum.length - 1 && cum[j]! < d1) coords.push(path[j++]!);
      const [p1, h1] = pointAt(path, cum, d1, h0);
      coords.push(p1);
      hint = h1;
      const slope = bin / 2;
      features.push({ type: "Feature", properties: { ...props, slope, color: routeSlopeColor(slope, params) }, geometry: { type: "LineString", coordinates: coords } });
    };
    for (let i = 1; i < prof.length - 1; i++) {
      const bin = Math.round(Math.max(sm[i]!, sm[i + 1]!) * 2);
      if (bin !== runBin) {
        flush(i, runBin);
        runStart = i;
        runBin = bin;
      }
    }
    flush(prof.length - 1, runBin);
  });
  return { type: "FeatureCollection", features };
}
