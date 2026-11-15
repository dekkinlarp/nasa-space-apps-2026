import type { LonLat, RouteResult, SurfaceClass, WalkParams } from "@marsmap/core";
import { marsDistanceM, measure, type Measured } from "./geo";
import type { DisplayLayers, RoverPhoto, StartPoint, Stop } from "./types";
import { cellIndex } from "./geo";
import { fmtDur, fmtEnergy, fmtO2 } from "./format";

export function nearestPhoto(photos: RoverPhoto[], p: LonLat): { photo: RoverPhoto; distM: number } | null {
  let best: RoverPhoto | null = null, bd = Infinity;
  for (const ph of photos) {
    const d = marsDistanceM(p, [ph.lon, ph.lat]);
    if (d < bd) { bd = d; best = ph; }
  }
  return best ? { photo: best, distM: bd } : null;
}

export function sampleAt(L: DisplayLayers, p: LonLat) {
  const i = cellIndex(L.grid, p);
  if (i == null) return null;
  const e = L.elevation?.[i];
  return {
    elevationM: e != null && Number.isFinite(e) ? e : null,
    slopeDeg: L.slope?.[i] ?? null,
    surfaceId: L.surface?.[i] ?? null,
  };
}

export function surfaceById(classes: SurfaceClass[], id: number | null | undefined) {
  return classes.find((c) => c.id === id) ?? null;
}

/** Names of the route points in order, matching the core's segment indices. */
export function pointNames(start: StartPoint | null, stops: Stop[], returnToStart: boolean): string[] {
  if (!start) return [];
  const n = ["Start", ...stops.map((s, i) => `${i + 1} · ${s.name}`)];
  if (returnToStart) n.push("Back at start");
  return n;
}

export function limitMessage(r: RouteResult, names: string[], params: WalkParams): string | null {
  const t = r.totals;
  if (!r.reachable) {
    const idx = (r as RouteResult & { unreachableStops?: number[] }).unreachableStops?.[0];
    const bad = idx != null ? names[idx] : null;
    return `No walkable path found${bad ? ` to ${bad}` : ""}: every way in is steeper than ${params.maxSlopeDeg}° or outside the map.`;
  }
  if (t.withinLimits) return null;
  const i = t.firstSegmentOverLimit ?? 0;
  const who = names[i + 1] ?? `segment ${i + 1}`;
  const usableT = params.evaLimitS * (1 - params.reserveFraction);
  const usableE = params.energyBudgetKJ * (1 - params.reserveFraction);
  const usableO = (params.o2BudgetKg ?? 0) * (1 - params.reserveFraction);
  const factor =
    t.limitingFactor === "oxygen"
      ? `the oxygen supply (${fmtO2(t.o2Kg ?? NaN)} needed vs ${fmtO2(usableO)} usable after reserve)`
      : t.limitingFactor === "energy"
      ? `the energy budget (${fmtEnergy(t.energyKJ)} needed vs ${fmtEnergy(usableE)} usable after reserve)`
      : `the EVA time budget (${fmtDur(t.totalTimeS)} needed vs ${fmtDur(usableT)} usable after reserve)`;
  return `Reaching ${who} breaks ${factor}. Remove or reorder stops, shorten dwell times, or pick a closer start.`;
}

/** The selected route as one measured line plus the time at each vertex (simulated walk). */
export interface Timeline {
  line: Measured;
  /** Elapsed time (walk + dwell) at each vertex. */
  t: number[];
  segStartIdx: number[];
  /** [startTime, endTime] of dwell after each segment. */
  dwell: [number, number][];
  totalS: number;
}

export function buildTimeline(r: RouteResult, dwellS: number[]): Timeline {
  const pts: LonLat[] = [];
  const t: number[] = [];
  const segStartIdx: number[] = [];
  const dwell: [number, number][] = [];
  let clock = 0;
  r.segments.forEach((s, si) => {
    const m = measure(s.path);
    segStartIdx.push(pts.length);
    s.path.forEach((p, i) => {
      if (si > 0 && i === 0) return; // shared vertex
      pts.push(p);
      t.push(clock + (m.total > 0 ? (m.cum[i]! / m.total) * s.timeS : 0));
    });
    clock += s.timeS;
    const d = dwellS[si + 1] ?? 0;
    dwell.push([clock, clock + d]);
    clock += d;
  });
  return { line: measure(pts), t, segStartIdx, dwell, totalS: clock };
}

/** Position and context at elapsed time `e` of a timeline. */
export function positionAt(tl: Timeline, e: number): { p: LonLat; along: number; seg: number; dwelling: boolean } {
  const { t, line } = tl;
  if (t.length === 0) return { p: [0, 0], along: 0, seg: 0, dwelling: false };
  if (e >= t[t.length - 1]!) return { p: line.pts[line.pts.length - 1]!, along: line.total, seg: tl.segStartIdx.length - 1, dwelling: false };
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= e) lo = mid; else hi = mid;
  }
  let seg = 0;
  while (seg + 1 < tl.segStartIdx.length && lo >= tl.segStartIdx[seg + 1]!) seg++;
  const dw = tl.dwell.find(([a, b]) => e >= a && e < b);
  if (dw) return { p: line.pts[lo]!, along: line.cum[lo]!, seg, dwelling: true };
  const span = t[hi]! - t[lo]!;
  const k = span > 0 ? (e - t[lo]!) / span : 0;
  const a = line.pts[lo]!, b = line.pts[hi]!;
  return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], along: line.cum[lo]! + (line.cum[hi]! - line.cum[lo]!) * k, seg, dwelling: false };
}
