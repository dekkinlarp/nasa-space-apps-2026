import { createCostModel, type CostFactor, type MarsCostModel } from "./costModel";
import { cellToLonLat, lonLatToCell } from "./grid";
import { oxygenModelOn, oxygenUsedKg } from "./params";
import { astar } from "./search";
import type {
  GridSpec,
  Layers,
  LonLat,
  ProfilePoint,
  RouteProfile,
  RouteResult,
  RouteSegment,
  RouteTotals,
  WalkParams,
} from "./types";

/**
 * Cost = time[s] x timeWeight + energy[kJ] x energyWeight + hazard[m] x hazardWeight.
 * Walking burns ~0.4 kJ/s, so energyWeight 1 is "worth" ~0.4 s per kJ-equivalent; hazardWeight 5
 * makes each hazardous metre cost like ~5 extra seconds of walking.
 */
export const DEFAULT_PROFILES: RouteProfile[] = [
  { id: "fastest", name: "Fastest", timeWeight: 1, energyWeight: 0, hazardWeight: 0 },
  { id: "least-effort", name: "Least effort", timeWeight: 0.02, energyWeight: 1, hazardWeight: 0 },
  { id: "safest", name: "Safest", timeWeight: 1, energyWeight: 0.5, hazardWeight: 5 },
];

/** Max ring radius (cells) searched when a stop lands on an impassable cell. */
export const SNAP_RADIUS_CELLS = 3;
/** Max vertices in a segment's elevation profile. */
export const MAX_PROFILE_POINTS = 300;
/** Douglas-Peucker tolerance for drawn paths, in cells (0.5 cell = 1 m on the 2 m grid). */
export const PATH_SIMPLIFY_CELLS = 0.5;

export interface PlanOptions {
  /** Reuse a prebuilt cost model (must match layers/params). */
  model?: MarsCostModel;
  /** Extra cost factors (radiation, shade, no-go...). Ignored when `model` is given. */
  extraFactors?: CostFactor[];
}

/** Nearest enterable cell to a lon/lat (the cell itself, or within SNAP_RADIUS_CELLS), else -1. */
export function snapToPassable(model: MarsCostModel, lonLat: LonLat): number {
  const grid = model.layers.grid;
  const cell = lonLatToCell(grid, lonLat);
  if (!cell) return -1;
  if (model.blocked[cell.index] !== 1) return cell.index;
  let best = -1;
  let bestD = Infinity;
  for (let dr = -SNAP_RADIUS_CELLS; dr <= SNAP_RADIUS_CELLS; dr++) {
    for (let dc = -SNAP_RADIUS_CELLS; dc <= SNAP_RADIUS_CELLS; dc++) {
      const r = cell.row + dr;
      const c = cell.col + dc;
      if (r < 0 || r >= grid.height || c < 0 || c >= grid.width) continue;
      const i = r * grid.width + c;
      const d = dr * dr + dc * dc;
      if (model.blocked[i] !== 1 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

function emptySegment(from: LonLat, to: LonLat): RouteSegment {
  return {
    from,
    to,
    path: [],
    distanceM: 0,
    timeS: 0,
    energyKJ: 0,
    ascentM: 0,
    descentM: 0,
    avgSlopeDeg: 0,
    maxSlopeDeg: 0,
    surfaceMix: {},
    hazardM: 0,
    profile: [],
    reachable: false,
  };
}

/** Douglas-Peucker on cell (row, col) coordinates; returns kept vertex positions in `cells`. */
function simplifyCells(W: number, cells: Int32Array, tol: number): number[] {
  const n = cells.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ia = cells[a]!, ib = cells[b]!;
    const ar = (ia / W) | 0, ac = ia - ar * W;
    const br = (ib / W) | 0, bc = ib - br * W;
    const dr = br - ar, dc = bc - ac;
    const len2 = dr * dr + dc * dc;
    let maxD = -1;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const ii = cells[i]!;
      const r = (ii / W) | 0, c = ii - r * W;
      let d2: number;
      if (len2 === 0) d2 = (r - ar) ** 2 + (c - ac) ** 2;
      else {
        const cross = (r - ar) * dc - (c - ac) * dr;
        d2 = (cross * cross) / len2;
      }
      if (d2 > maxD) {
        maxD = d2;
        maxI = i;
      }
    }
    if (maxD > tol2 && maxI > 0) {
      keep[maxI] = 1;
      stack.push(a, maxI, maxI, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Turn a cell path into a RouteSegment with stats measured by the cost model. */
export function buildSegment(model: MarsCostModel, from: LonLat, to: LonLat, cells: Int32Array): RouteSegment {
  const { grid, elevation, slope, surface } = model.layers;
  const W = grid.width;
  const cs = grid.cellSizeM;
  const n = cells.length;
  const out = new Float64Array(3);
  const cum = new Float64Array(n);
  let timeS = 0, energyKJ = 0, hazardM = 0, ascentM = 0, descentM = 0, slopeDist = 0;
  let maxSlope = n > 0 ? slope[cells[0]!]! : 0;
  const mix: Record<number, number> = {};
  let total = 0;
  for (let i = 1; i < n; i++) {
    const a = cells[i - 1]!, b = cells[i]!;
    const ar = (a / W) | 0, br = (b / W) | 0;
    const diag = ar !== br && a - ar * W !== b - br * W;
    const d = diag ? cs * Math.SQRT2 : cs;
    total += d;
    cum[i] = total;
    if (model.stepInto(a, b, d, out)) {
      timeS += out[0]!;
      energyKJ += out[1]!;
      hazardM += out[2]!;
    }
    const dz = elevation[b]! - elevation[a]!;
    if (dz > 0) ascentM += dz;
    else descentM -= dz;
    const sa = slope[a]!, sb = slope[b]!;
    slopeDist += 0.5 * (sa + sb) * d;
    if (sb > maxSlope) maxSlope = sb;
    const ka = surface[a]!, kb = surface[b]!;
    mix[ka] = (mix[ka] ?? 0) + 0.5 * d;
    mix[kb] = (mix[kb] ?? 0) + 0.5 * d;
  }
  if (total > 0) for (const k of Object.keys(mix)) mix[+k] = mix[+k]! / total;
  else if (n > 0) mix[surface[cells[0]!]!] = 1;

  // Profile: every vertex if short, else ~MAX_PROFILE_POINTS evenly spaced by distance.
  const profile: ProfilePoint[] = [];
  const pushProfile = (i: number) => {
    const c = cells[i]!;
    profile.push({ distanceM: cum[i]!, elevationM: elevation[c]!, slopeDeg: slope[c]!, surfaceId: surface[c]! });
  };
  if (n <= MAX_PROFILE_POINTS) for (let i = 0; i < n; i++) pushProfile(i);
  else {
    let j = 0;
    for (let k = 0; k < MAX_PROFILE_POINTS; k++) {
      const target = (total * k) / (MAX_PROFILE_POINTS - 1);
      while (j < n - 1 && cum[j + 1]! <= target) j++;
      if (k === MAX_PROFILE_POINTS - 1) j = n - 1;
      pushProfile(j);
    }
  }

  const keep = simplifyCells(W, cells, PATH_SIMPLIFY_CELLS);
  const path = keep.map((i) => cellToLonLat(grid, cells[i]!));

  return {
    from,
    to,
    path,
    distanceM: total,
    timeS,
    energyKJ,
    ascentM,
    descentM,
    avgSlopeDeg: total > 0 ? slopeDist / total : n > 0 ? slope[cells[0]!]! : 0,
    maxSlopeDeg: maxSlope,
    surfaceMix: mix,
    hazardM,
    profile,
    reachable: true,
  };
}

function sameCell(grid: GridSpec, a: LonLat, b: LonLat): boolean {
  const ca = lonLatToCell(grid, a);
  const cb = lonLatToCell(grid, b);
  return !!ca && !!cb && ca.index === cb.index;
}

/**
 * Dwell per point. dwellS[i] (if given) is the time spent at points[i]. Defaults: 0 at the start,
 * 0 at the final point if it returns to the start cell, params.stopDwellS everywhere else.
 */
export function resolveDwell(grid: GridSpec, params: WalkParams, points: LonLat[], dwellS?: number[]): number[] {
  const n = points.length;
  return points.map((p, i) => {
    const given = dwellS?.[i];
    if (given !== undefined && Number.isFinite(given)) return Math.max(0, given);
    if (i === 0) return 0;
    if (i === n - 1 && n > 1 && sameCell(grid, p, points[0]!)) return 0;
    return params.stopDwellS;
  });
}

/**
 * Plan a walk visiting `points` in order (points[0] = start). Does NOT return to the start
 * unless the caller repeats it as the last point.
 */
export function planRoute(
  layers: Layers,
  params: WalkParams,
  profile: RouteProfile,
  points: LonLat[],
  dwellS?: number[],
  options: PlanOptions = {},
): RouteResult {
  const model = options.model ?? createCostModel(layers, params, options.extraFactors ?? []);
  const grid = layers.grid;
  const graph = { width: grid.width, height: grid.height, cellSizeM: grid.cellSizeM, blocked: model.blocked };
  const edge = model.edgeCost(profile);
  const hRate = model.minCostPerMetre(profile);

  const cells = points.map((p) => snapToPassable(model, p));
  const unreachable = new Set<number>();
  cells.forEach((c, i) => {
    if (c < 0) unreachable.add(i);
  });

  // Segment i is the leg arriving at points[i + 1]. When a stop cannot be reached, its segment is
  // empty (reachable: false) and the next leg starts from the last stop that WAS reached, so
  // one bad stop does not wipe out the rest of the plan (that leg's `from` says where it starts).
  const segments: RouteSegment[] = [];
  let last = cells[0]! >= 0 ? 0 : -1;
  for (let i = 0; i + 1 < points.length; i++) {
    const to = points[i + 1]!;
    const b = cells[i + 1]!;
    const from = points[last >= 0 ? last : i]!;
    if (last < 0 || b < 0) {
      segments.push(emptySegment(from, to));
      unreachable.add(i + 1);
      continue;
    }
    const res = astar(graph, edge, cells[last]!, b, hRate);
    if (!res.path) {
      segments.push(emptySegment(from, to));
      unreachable.add(i + 1);
      continue;
    }
    segments.push(buildSegment(model, from, to, res.path));
    last = i + 1;
  }

  const dwell = resolveDwell(grid, params, points, dwellS);
  const totals = computeTotals(params, segments, dwell, unreachable.size === 0);
  const result: RouteResult = { profile, reachable: unreachable.size === 0, segments, totals };
  if (unreachable.size) result.unreachableStops = [...unreachable].sort((x, y) => x - y);
  return result;
}

export function computeTotals(
  params: WalkParams,
  segments: RouteSegment[],
  dwell: number[],
  reachable: boolean,
): RouteTotals {
  const dwellW = params.dwellMetabolicW ?? 0;
  const timeLimit = params.evaLimitS * (1 - params.reserveFraction);
  const energyLimit = params.energyBudgetKJ * (1 - params.reserveFraction);
  let distanceM = 0, walkTimeS = 0, walkEnergy = 0, ascentM = 0, descentM = 0, hazardM = 0;
  let t = dwell[0] ?? 0;
  let dwellEnergy = (t * dwellW) / 1000;
  let e = dwellEnergy;
  const o2On = oxygenModelOn(params);
  const o2Limit = o2On ? params.o2BudgetKg! * (1 - params.reserveFraction) : Infinity;
  let firstOver: number | null = null;
  let limiting: "time" | "energy" | "oxygen" | null = null;
  segments.forEach((s, k) => {
    distanceM += s.distanceM;
    walkTimeS += s.timeS;
    walkEnergy += s.energyKJ;
    ascentM += s.ascentM;
    descentM += s.descentM;
    hazardM += s.hazardM;
    const dw = dwell[k + 1] ?? 0;
    const de = (dw * dwellW) / 1000;
    dwellEnergy += de;
    t += s.timeS + dw;
    e += s.energyKJ + de;
    const o = oxygenUsedKg(params, t, e);
    if (firstOver === null && (t > timeLimit || e > energyLimit || o > o2Limit)) {
      firstOver = k;
      // The budget that is most over its limit is reported (time wins ties, then energy).
      const tr = t / timeLimit, er = e / energyLimit, or = o / o2Limit;
      limiting = tr >= er && tr >= or ? "time" : er >= or ? "energy" : "oxygen";
    }
  });
  const totalTimeS = t;
  const energyKJ = walkEnergy + dwellEnergy;
  const o2Kg = oxygenUsedKg(params, totalTimeS, energyKJ);
  return {
    distanceM,
    walkTimeS,
    totalTimeS,
    energyKJ,
    ascentM,
    descentM,
    hazardM,
    radiationMSv: (totalTimeS / 86400) * params.radiationMSvPerDay,
    withinLimits: reachable && firstOver === null,
    firstSegmentOverLimit: firstOver,
    limitingFactor: limiting,
    dwellEnergyKJ: dwellEnergy,
    timeUsedFraction: timeLimit > 0 ? totalTimeS / timeLimit : Infinity,
    energyUsedFraction: energyLimit > 0 ? energyKJ / energyLimit : Infinity,
    ...(o2On ? { o2Kg, o2UsedFraction: o2Kg / o2Limit } : {}),
  };
}

/** One route per DEFAULT_PROFILES entry (shares one cost model). */
export function planRouteAlternatives(
  layers: Layers,
  params: WalkParams,
  points: LonLat[],
  dwellS?: number[],
  options: PlanOptions = {},
): RouteResult[] {
  const model = options.model ?? createCostModel(layers, params, options.extraFactors ?? []);
  return DEFAULT_PROFILES.map((p) => planRoute(layers, params, p, points, dwellS, { model }));
}

