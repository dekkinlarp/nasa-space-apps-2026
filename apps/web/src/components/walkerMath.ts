/** Pure helpers for the Go walker: where it is facing, how fast its legs move, where its boot prints are. */
import type { LonLat, RouteResult } from "@marsmap/core";
import type { Timeline } from "../lib";
import { bearingDeg, marsDistanceM, offsetLonLat, pointAt } from "../geo";

/** Real time for one full stride (two steps) at the route's average walking speed, s. */
export const BASE_CYCLE_S = 1.1;

export type WalkerState = "walking" | "working" | "idle";

export interface WalkerFrame {
  state: WalkerState;
  seg: number;
  /** Walking speed here relative to the route's average (1 = average). */
  speedRatio: number;
  /** Terrain grade along the direction of travel, rise / run (+ = uphill). */
  grade: number;
  slopeDeg: number;
  /** Dwell progress 0..1 and simulated seconds left, while working. */
  dwellF: number;
  dwellLeftS: number;
}

/** Distance along the timeline line where segment `seg` begins. */
export function segStartAlong(tl: Timeline, seg: number): number {
  return tl.line.cum[Math.max(0, (tl.segStartIdx[seg] ?? 0) - (seg > 0 ? 1 : 0))] ?? 0;
}

/** Route average walking speed, m/s (walking time only). */
export function meanSpeed(r: RouteResult): number {
  const t = r.segments.reduce((a, s) => a + s.timeS, 0);
  const d = r.segments.reduce((a, s) => a + s.distanceM, 0);
  return t > 0 ? d / t : 1;
}

/** Interpolate a segment profile (elevation, slope) at a distance along the segment. */
function profileAt(r: RouteResult, seg: number, d: number): { elev: number; slope: number } | null {
  const pr = r.segments[seg]?.profile;
  if (!pr?.length) return null;
  if (d <= pr[0]!.distanceM) return { elev: pr[0]!.elevationM, slope: pr[0]!.slopeDeg };
  for (let i = 1; i < pr.length; i++) {
    const b = pr[i]!;
    if (b.distanceM >= d) {
      const a = pr[i - 1]!;
      const k = b.distanceM > a.distanceM ? (d - a.distanceM) / (b.distanceM - a.distanceM) : 0;
      return { elev: a.elevationM + (b.elevationM - a.elevationM) * k, slope: a.slopeDeg + (b.slopeDeg - a.slopeDeg) * k };
    }
  }
  const z = pr[pr.length - 1]!;
  return { elev: z.elevationM, slope: z.slopeDeg };
}

/** What the walker is doing at simulated time `e` (see positionAt in lib.ts for where). */
export function walkerFrame(tl: Timeline, r: RouteResult, e: number, seg: number, dwelling: boolean, alongM: number, mean: number): WalkerFrame {
  if (e >= tl.totalS) return { state: "idle", seg, speedRatio: 0, grade: 0, slopeDeg: 0, dwellF: 1, dwellLeftS: 0 };
  if (dwelling) {
    const [a, b] = tl.dwell[seg] ?? [e, e];
    return { state: "working", seg, speedRatio: 0, grade: 0, slopeDeg: 0, dwellF: b > a ? (e - a) / (b - a) : 1, dwellLeftS: Math.max(0, b - e) };
  }
  const s = r.segments[seg];
  const v = s && s.timeS > 0 ? s.distanceM / s.timeS : mean;
  const d = alongM - segStartAlong(tl, seg);
  const p0 = profileAt(r, seg, d - 3), p1 = profileAt(r, seg, d + 3), p = profileAt(r, seg, d);
  const grade = p0 && p1 ? (p1.elev - p0.elev) / 6 : 0;
  return { state: "walking", seg, speedRatio: mean > 0 ? v / mean : 1, grade: Number.isFinite(grade) ? grade : 0, slopeDeg: p?.slope ?? 0, dwellF: 0, dwellLeftS: 0 };
}

/**
 * Seconds of animation per stride. Faster walking -> quicker stride, steeper ground -> shorter, slower
 * steps; a fast-forwarded walk gets a little brisker so it still reads as "fast" without becoming a blur.
 */
export function cycleSeconds(speedRatio: number, slopeDeg: number, simSpeed: number): number {
  const slow = 1 / (1 + Math.max(0, slopeDeg) / 25);
  const ratio = Math.max(0.45, Math.min(1.8, speedRatio * slow));
  const boost = simSpeed > 1 ? Math.max(1, Math.min(1.9, 1 + Math.log10(simSpeed / 30) * 0.45)) : 1;
  return BASE_CYCLE_S / ratio / boost;
}

/** Heading (deg clockwise from north) looking from a bit behind to a bit ahead on the line: smooths grid zig-zags. */
export function headingAlong(tl: Timeline, alongM: number, aheadM: number): number | null {
  const L = tl.line;
  if (L.total <= 0) return null;
  let a = Math.max(0, alongM - aheadM * 0.35), b = Math.min(L.total, alongM + aheadM);
  if (b - a < 0.5) a = Math.max(0, b - aheadM);
  if (b - a < 0.5) return null;
  return bearingDeg(pointAt(L, a).p, pointAt(L, b).p);
}

/** Shortest-way blend of two angles in degrees. */
export function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

export interface Print {
  p: LonLat;
  rot: number;
  /** 0 (old, faded) .. 1 (fresh). */
  fresh: number;
}

/**
 * Boot prints behind the walker along the route, alternating left/right. Spacing is fixed along the
 * route (prints don't slide as the walker moves); `stepM` and `sideM` are chosen per zoom by the caller.
 */
export function routePrints(tl: Timeline, alongM: number, stepM: number, sideM: number, count: number): Print[] {
  const out: Print[] = [];
  const L = tl.line;
  if (stepM <= 0 || L.total <= 0) return out;
  const last = Math.floor((alongM - stepM * 0.6) / stepM);
  for (let k = last, n = 0; k >= 0 && n < count; k--, n++) {
    const d = k * stepM;
    const { p } = pointAt(L, d);
    const h = headingAlong(tl, d, stepM * 2) ?? 0;
    const side = k % 2 === 0 ? 1 : -1;
    const rad = ((h + 90) * Math.PI) / 180;
    const off = side * sideM;
    out.push({ p: offsetLonLat(p, Math.sin(rad) * off, Math.cos(rad) * off), rot: h, fresh: 1 - n / count });
  }
  return out;
}

/** Boot prints from a list of past positions (GPS mode). */
export function trackPrints(track: LonLat[], stepM: number, sideM: number, count: number): Print[] {
  const out: Print[] = [];
  let acc = 0;
  for (let i = track.length - 1, k = 0; i > 0 && out.length < count; i--) {
    const a = track[i]!, b = track[i - 1]!;
    acc += marsDistanceM(a, b);
    if (acc < stepM) continue;
    acc = 0;
    const h = bearingDeg(b, a);
    const side = k++ % 2 === 0 ? 1 : -1;
    const rad = ((h + 90) * Math.PI) / 180;
    out.push({ p: offsetLonLat(b, Math.sin(rad) * side * sideM, Math.cos(rad) * side * sideM), rot: h, fresh: 1 - out.length / count });
  }
  return out;
}

/** The part of the route already walked, for the progress line. */
export function walkedLine(tl: Timeline, alongM: number, here: LonLat): LonLat[] {
  const L = tl.line;
  const out: LonLat[] = [];
  for (let i = 0; i < L.pts.length && L.cum[i]! < alongM; i++) out.push(L.pts[i]!);
  out.push(here);
  return out;
}
