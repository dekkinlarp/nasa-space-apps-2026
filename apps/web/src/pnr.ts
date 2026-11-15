/**
 * Point of no return ("turn back by") for a planned EVA. Pure logic, no store or map access.
 *
 * APPROXIMATION (also shown in the UI tooltip):
 * We walk along the selected route in small steps (<= SAMPLE_STEP_M), keeping the elapsed EVA time
 * (walking + dwell at every stop already passed) and the energy spent so far. At each sample we
 * estimate how long it would take to get back to the start from there, as the best of up to three
 * options:
 *   1. "path home": the cheapest walk home from that cell taken from the reach field (the same
 *      out-and-back flood that draws the walk-limit rings, for the selected route profile);
 *   2. "retrace": walking back the way you came. Its time and energy are taken as the outbound
 *      walking time / energy so far (uphill and downhill are treated as symmetric, which they are not);
 *   3. "continue": for plans that end at the start, finishing the planned route while skipping the
 *      remaining stop work.
 * A sample is safe if some option fits inside the usable time (evaLimitS x (1 - reserveFraction))
 * AND usable energy (energyBudgetKJ x (1 - reserveFraction)). The point of no return is where the
 * route first stops being safe (linearly interpolated between samples, including partway through a
 * stop's work time). Its "turn back by" time is the elapsed EVA time when the crew gets there.
 * If the whole route stays safe there is no point of no return; we instead report the smallest
 * spare time to the usable limit over the route and where it occurs.
 * Times are the walk model's estimates; the reach field is on the 2 m grid, so this is a planning
 * aid, not a flight rule.
 */
import type { LonLat, RouteResult, WalkParams } from "@marsmap/core";
import { marsDistanceM } from "./geo";

export const SAMPLE_STEP_M = 5;

export type ReturnMethod = "path home" | "retrace" | "continue";

export interface ReturnLookup {
  /** Walking time home from this point, s, or undefined/Infinity when unknown. */
  timeS(p: LonLat): number | undefined;
  /** Energy to walk home from this point, kJ, or undefined/Infinity when unknown. */
  energyKJ(p: LonLat): number | undefined;
}

export interface PnrInput {
  result: RouteResult;
  /** Dwell at each route point (index 0 = start), s. Same array the plan was made with. */
  dwellS: number[];
  params: WalkParams;
  /** True when the plan ends back at the start (enables the "continue" option). */
  loopsHome: boolean;
  /** Optional reach-field lookup (enables the "path home" option). */
  reach?: ReturnLookup | null;
}

export interface PnrResult {
  /** "pnr": there is a point after which the crew can no longer get home in time. "clear": no such point. */
  kind: "pnr" | "clear";
  /** Where to draw the marker: the PNR, or for "clear" the point with the least spare time. */
  point: LonLat;
  /** Elapsed EVA time (walk + dwell) at the marker point, s. For "pnr" this is the turn-back deadline. */
  elapsedS: number;
  /** Distance along the whole route, m. */
  alongM: number;
  /** Segment (leg) index the point is on. */
  segment: number;
  /** True when the point is at a stop, during its work time. */
  atStop: boolean;
  /** Estimated time to get home from the point by the best option, s. */
  returnS: number;
  returnMethod: ReturnMethod;
  /** Spare time to the usable limit at the marker point if you turn back there, s (0 at a PNR). */
  marginS: number;
  /** Which limit sets the PNR (for "clear": the tighter one at the marker point). */
  limitedBy: "time" | "energy";
  /** True when the reach field was used for at least part of the route. */
  usedReach: boolean;
  usableS: number;
  usableKJ: number;
}

interface Sample {
  p: LonLat;
  t: number; // elapsed incl. dwell
  e: number; // energy incl. dwell
  walkT: number; // walking time so far
  walkE: number; // walking energy so far
  along: number;
  seg: number;
  atStop: boolean;
}

interface Eval {
  /** Normalised slack: max over options of min(timeSlack/usableT, energySlack/usableE). >= 0 is safe. */
  s: number;
  returnS: number;
  method: ReturnMethod;
  marginS: number;
  limitedBy: "time" | "energy";
  reach: boolean;
}

const finite = (v: number | undefined): v is number => v != null && Number.isFinite(v);

export function computePnr(inp: PnrInput): PnrResult | null {
  const { result, dwellS, params, loopsHome, reach } = inp;
  const usableT = params.evaLimitS * (1 - params.reserveFraction);
  const usableE = params.energyBudgetKJ * (1 - params.reserveFraction);
  if (!(usableT > 0) || !(usableE > 0)) return null;
  const dwellW = params.dwellMetabolicW ?? 0;

  // ---- build samples ----
  const samples: Sample[] = [];
  let t = dwellS[0] ?? 0;
  let e = (t * dwellW) / 1000;
  let walkT = 0, walkE = 0, along = 0;
  result.segments.forEach((s, si) => {
    const path = s.path;
    if (path.length >= 1) {
      const lens: number[] = [];
      let total = 0;
      for (let i = 1; i < path.length; i++) {
        const d = marsDistanceM(path[i - 1]!, path[i]!);
        lens.push(d);
        total += d;
      }
      const push = (p: LonLat, fr: number, alongM: number) =>
        samples.push({ p, t: t + fr * s.timeS, e: e + fr * s.energyKJ, walkT: walkT + fr * s.timeS, walkE: walkE + fr * s.energyKJ, along: alongM, seg: si, atStop: false });
      if (samples.length === 0 || si === 0) push(path[0]!, 0, along);
      let acc = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!, b = path[i]!, d = lens[i - 1]!;
        const n = Math.max(1, Math.ceil(d / SAMPLE_STEP_M));
        for (let k = 1; k <= n; k++) {
          const f = k / n;
          const dd = acc + d * f;
          push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], total > 0 ? dd / total : 1, along + dd);
        }
        acc += d;
      }
      if (path.length === 1 && si > 0) push(path[0]!, 1, along);
      along += total;
    }
    t += s.timeS;
    e += s.energyKJ;
    walkT += s.timeS;
    walkE += s.energyKJ;
    const dw = dwellS[si + 1] ?? 0;
    const last = samples[samples.length - 1];
    if (dw > 0 && last) {
      // Arrival sample is already in; add a departure sample at the same spot after the work time.
      last.atStop = true;
      t += dw;
      e += (dw * dwellW) / 1000;
      samples.push({ ...last, t, e, atStop: true });
    }
  });
  if (samples.length === 0) return null;
  const endWalkT = walkT, endWalkE = walkE;

  // ---- evaluate ----
  const evalAt = (x: Sample): Eval => {
    const opts: { m: ReturnMethod; t: number; e: number; reach: boolean }[] = [{ m: "retrace", t: x.walkT, e: x.walkE, reach: false }];
    if (reach) {
      const rt = reach.timeS(x.p), re = reach.energyKJ(x.p);
      if (finite(rt) && finite(re)) opts.push({ m: "path home", t: rt, e: re, reach: true });
    }
    if (loopsHome) opts.push({ m: "continue", t: Math.max(0, endWalkT - x.walkT), e: Math.max(0, endWalkE - x.walkE), reach: false });
    let best: Eval | null = null;
    for (const o of opts) {
      const st = (usableT - (x.t + o.t)) / usableT;
      const se = (usableE - (x.e + o.e)) / usableE;
      const s = Math.min(st, se);
      if (!best || s > best.s) best = { s, returnS: o.t, method: o.m, marginS: usableT - (x.t + o.t), limitedBy: se < st ? "energy" : "time", reach: o.reach };
    }
    return best!;
  };

  const evals = samples.map(evalAt);
  const usedReach = evals.some((v) => v.reach);
  const base = { usedReach, usableS: usableT, usableKJ: usableE };

  const firstBad = evals.findIndex((v) => v.s < 0);
  if (firstBad >= 0) {
    if (firstBad === 0) {
      const x = samples[0]!, v = evals[0]!;
      return { kind: "pnr", point: x.p, elapsedS: x.t, alongM: 0, segment: 0, atStop: x.atStop, returnS: v.returnS, returnMethod: v.method, marginS: 0, limitedBy: v.limitedBy, ...base };
    }
    const a = samples[firstBad - 1]!, b = samples[firstBad]!;
    const va = evals[firstBad - 1]!, vb = evals[firstBad]!;
    const f = va.s - vb.s > 0 ? Math.min(1, Math.max(0, va.s / (va.s - vb.s))) : 0;
    const lerp = (x: number, y: number) => x + (y - x) * f;
    const sameSpot = a.p[0] === b.p[0] && a.p[1] === b.p[1];
    return {
      kind: "pnr",
      point: [lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1])],
      elapsedS: lerp(a.t, b.t),
      alongM: lerp(a.along, b.along),
      segment: a.seg,
      atStop: sameSpot && a.atStop,
      returnS: lerp(va.returnS, vb.returnS),
      returnMethod: va.method,
      marginS: 0,
      limitedBy: vb.limitedBy,
      ...base,
    };
  }

  // No PNR: report the tightest point (least spare time).
  let k = 0;
  // Small tolerance so ties (e.g. a whole final leg of a loop) keep the earliest point, usually a stop.
  for (let i = 1; i < evals.length; i++) if (evals[i]!.s < evals[k]!.s - 1e-6) k = i;
  const x = samples[k]!, v = evals[k]!;
  return { kind: "clear", point: x.p, elapsedS: x.t, alongM: x.along, segment: x.seg, atStop: x.atStop, returnS: v.returnS, returnMethod: v.method, marginS: v.marginS, limitedBy: v.limitedBy, ...base };
}
