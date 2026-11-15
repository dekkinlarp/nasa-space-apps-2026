/** Colour the selected route along its length by what the slope means (from the segment profiles), and mark its distance. */
import type { LonLat, RouteResult, WalkParams } from "@marsmap/core";
import { M_PER_DEG_LAT } from "../geo";
import { mapPalette } from "./mapPalette";

/** Slope thresholds, degrees, derived from the walk params (caution / max slope). */
export function slopeBands(p: Pick<WalkParams, "cautionSlopeDeg" | "maxSlopeDeg"> | null) {
  const caution = p?.cautionSlopeDeg ?? 15;
  const max = Math.max(p?.maxSlopeDeg ?? 20, caution + 1);
  return { easyBelow: Math.max(0, caution - 5), caution, max };
}

/** What the slope underfoot means for a walker: nothing to report, hazard ground, or the no-go slope. */
export type SlopeState = "clear" | "caution" | "nogo";
export function slopeState(slopeDeg: number, p: Pick<WalkParams, "cautionSlopeDeg" | "maxSlopeDeg"> | null): SlopeState {
  const b = slopeBands(p);
  // Routes never cross ground steeper than the limit, so "at the limit" is the last degree below it.
  return slopeDeg >= b.max - 1 ? "nogo" : slopeDeg >= b.caution ? "caution" : "clear";
}

/**
 * The colour of the route line at a slope. Like the budget bars, the line carries no colour until there is
 * a status to report: ink on clear ground, the warning colour on hazard slope, the over-limit colour at the
 * no-go slope.
 */
export function routeSlopeColor(slopeDeg: number, p: Pick<WalkParams, "cautionSlopeDeg" | "maxSlopeDeg"> | null): string {
  const c = mapPalette();
  const st = slopeState(slopeDeg, p);
  return st === "nogo" ? c.bad : st === "caution" ? c.warn : c.ink;
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

/** Distance between the ticks drawn across the selected route, metres. */
export const ROUTE_TICK_M = 100;

/**
 * One point every `stepM` along the whole route (the count runs on across stops), each with `rot`, the
 * compass bearing the route is heading in there, and `m`, its distance from the start. The map draws a
 * short bar across the line at each, so the route reads as a ruler.
 */
export function routeTickFeatures(r: RouteResult | null, stepM = ROUTE_TICK_M): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (!r || stepM <= 0) return { type: "FeatureCollection", features };
  let before = 0;
  let next = stepM;
  for (const s of r.segments) {
    const path = s.path;
    if (path.length < 2) continue;
    const cum = cumMetres(path);
    const len = cum[cum.length - 1]!;
    let hint = 0;
    while (next <= before + len) {
      const [pt, j] = pointAt(path, cum, next - before, hint);
      hint = j;
      const a = path[j]!, b = path[j + 1] ?? a;
      const kx = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
      const rot = (Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI;
      features.push({ type: "Feature", properties: { rot: (rot + 360) % 360, m: next }, geometry: { type: "Point", coordinates: pt } });
      next += stepM;
    }
    before += len;
  }
  return { type: "FeatureCollection", features };
}
