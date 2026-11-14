/**
 * THE walk model. Every piece of walking physics lives in this file; the search engine
 * (search.ts) only ever sees a number per step.
 *
 * A step between two neighbouring cells is evaluated by running a list of small
 * "factor" functions over one mutable StepState:
 *
 *   validity   -> blocks steps into/out of no-data cells
 *   slopeLimit -> blocks steps whose directional grade or destination slope > maxSlopeDeg
 *   speed      -> speedMps = baseSpeed x Tobler slope factor x mean surface speedFactor
 *   metabolic  -> metabolicW from Pandolf (1977) + Santee downhill correction, scaled to Mars g
 *   hazard     -> hazardM = metres of the step on hazard surface or slope >= cautionSlopeDeg
 *
 * then   timeS    = distanceM / speedMps + extraTimeS
 *        energyKJ = metabolicW x timeS / 1000 + extraEnergyKJ
 *
 * EXTENSION POINT: pass `extraFactors` to createCostModel. Each factor gets the same StepState
 * after the built-ins ran and may set `blocked`, multiply `speedMps`, add to `metabolicW`,
 * `hazardM`, `extraTimeS` or `extraEnergyKJ`. Factors must not allocate (they run ~20 M
 * times per reach flood). A factor that can make a step CHEAPER than the built-in model must
 * set `mayReduceCost: true` (this switches A* to a zero heuristic so routes stay optimal).
 * A factor can also forbid whole cells via `blocksCell` (used for corner-cutting checks).
 */
import { EARTH_GRAVITY } from "./params";
import type { CostModel, Layers, RouteProfile, StepCost, SurfaceClass, WalkParams } from "./types";

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

/** Mutable per-step scratchpad shared by all factors. One instance per cost model. */
export interface StepState {
  readonly layers: Layers;
  readonly params: WalkParams;
  // ---- inputs, filled before factors run ----
  from: number;
  to: number;
  /** Horizontal step length, m. */
  distanceM: number;
  fromElevationM: number;
  toElevationM: number;
  /** toElevation - fromElevation, m. */
  dzM: number;
  /** Signed rise over run in the direction of travel (+ = uphill). */
  grade: number;
  /** Signed directional grade angle, degrees. */
  gradeDeg: number;
  /** Terrain slope (steepest, any direction) at each cell, degrees. */
  fromSlopeDeg: number;
  toSlopeDeg: number;
  fromClass: SurfaceClass;
  toClass: SurfaceClass;
  // ---- outputs, written by factors ----
  blocked: boolean;
  speedMps: number;
  /** Pandolf terrain coefficient eta used for this step. */
  terrainFactor: number;
  metabolicW: number;
  hazardM: number;
  extraTimeS: number;
  extraEnergyKJ: number;
}

export interface CostFactor {
  id: string;
  description?: string;
  /** Read/modify the step state. Set `s.blocked = true` to make the step impassable. */
  apply(s: StepState): void;
  /** True if this factor can make a step cheaper than the built-in model (disables the A* heuristic). */
  mayReduceCost?: boolean;
  /** Optional cell-level ban (no-go zones). Banned cells are never entered and block diagonal corner cutting. */
  blocksCell?(layers: Layers, params: WalkParams, index: number): boolean;
}

// ----------------------------------------------------------------------------------------
// Built-in factors
// ----------------------------------------------------------------------------------------

/** Tobler (1993) hiking function normalised so flat ground = 1. Peaks at 1.19 at -2.86 deg. */
export function toblerFactor(grade: number): number {
  return Math.exp(-3.5 * Math.abs(grade + 0.05) + 0.175);
}

/**
 * Metabolic rate in W for walking at `speedMps` on grade `gradePct` (percent, + uphill).
 * Pandolf et al. (1977) with the Santee et al. (2001/2003) downhill correction, as used by
 * NASA JSC's traverse model (Kim et al., IEEE EMBC 2024):
 *   MP = 1.5W + 2.0(W+L)(L/W)^2 + eta(W+L)(1.5V^2 + 0.35 V G)
 *   CF = eta[ G(W+L)V/3.5 - (W+L)(G+6)^2/W + (25 - V^2) ]      (G < 0 only)
 *   M  = MP - CF
 * Reduced gravity (ASSUMPTION, see README): the load-bearing terms (everything except the
 * standing 1.5W term) scale with g/g_earth. The result is floored at 1.5W (standing rest).
 */
export function pandolfSanteeW(
  bodyKg: number,
  loadKg: number,
  speedMps: number,
  gradePct: number,
  eta: number,
  gravity: number,
): number {
  const W = bodyKg;
  const L = loadKg;
  const V = speedMps;
  const G = gradePct;
  const WL = W + L;
  const gRatio = gravity / EARTH_GRAVITY;
  const rest = 1.5 * W;
  let load = 2.0 * WL * (L / W) * (L / W) + eta * WL * (1.5 * V * V + 0.35 * V * G);
  if (G < 0) {
    const cf = eta * ((G * WL * V) / 3.5 - (WL * (G + 6) * (G + 6)) / W + (25 - V * V));
    load -= cf;
  }
  const m = rest + gRatio * load;
  return m > rest ? m : rest;
}

export const validityFactor: CostFactor = {
  id: "validity",
  description: "No-data elevation or slope is impassable.",
  apply(s) {
    if (s.fromElevationM !== s.fromElevationM || s.toElevationM !== s.toElevationM || s.toSlopeDeg !== s.toSlopeDeg) {
      s.blocked = true;
    }
  },
  blocksCell(layers, _p, i) {
    const e = layers.elevation[i]!;
    const sl = layers.slope[i]!;
    return e !== e || sl !== sl;
  },
};

export const slopeLimitFactor: CostFactor = {
  id: "slope-limit",
  description: "Directional grade or destination-cell slope above maxSlopeDeg is impassable.",
  apply(s) {
    const max = s.params.maxSlopeDeg;
    if (s.gradeDeg > max || s.gradeDeg < -max || s.toSlopeDeg > max) s.blocked = true;
  },
  blocksCell(layers, p, i) {
    return layers.slope[i]! > p.maxSlopeDeg;
  },
};

export const speedFactor: CostFactor = {
  id: "speed",
  description: "baseSpeedMps x Tobler slope factor x mean surface speedFactor of the two cells.",
  apply(s) {
    const surf = 0.5 * (s.fromClass.speedFactor + s.toClass.speedFactor);
    s.speedMps = s.params.baseSpeedMps * toblerFactor(s.grade) * surf;
    s.terrainFactor = 0.5 * (s.fromClass.terrainFactor + s.toClass.terrainFactor);
  },
};

export const metabolicFactor: CostFactor = {
  id: "metabolic",
  description: "Pandolf + Santee load-carriage metabolic rate, load terms scaled to Mars gravity.",
  apply(s) {
    const p = s.params;
    s.metabolicW += pandolfSanteeW(p.bodyMassKg, p.suitMassKg, s.speedMps, s.grade * 100, s.terrainFactor, p.gravity);
  },
};

export const hazardFactor: CostFactor = {
  id: "hazard",
  description: "Half the step is charged to each cell; a cell is hazardous if its class is or slope >= cautionSlopeDeg.",
  apply(s) {
    const caution = s.params.cautionSlopeDeg;
    const half = 0.5 * s.distanceM;
    if (s.fromClass.hazard || s.fromSlopeDeg >= caution) s.hazardM += half;
    if (s.toClass.hazard || s.toSlopeDeg >= caution) s.hazardM += half;
  },
};

/** The built-in walk model, in evaluation order. (createCostModel calls these directly in this order for speed; keep both in sync.) */
export const BUILTIN_FACTORS: readonly CostFactor[] = Object.freeze([
  validityFactor,
  slopeLimitFactor,
  speedFactor,
  metabolicFactor,
  hazardFactor,
]);

// ----------------------------------------------------------------------------------------
// Model
// ----------------------------------------------------------------------------------------

/** Weighted cost of a step, Infinity if impassable. */
export type EdgeCostFn = (from: number, to: number, distanceM: number) => number;

export interface MarsCostModel extends CostModel {
  readonly layers: Layers;
  readonly params: WalkParams;
  readonly factors: readonly CostFactor[];
  /** 1 = cell can never be entered (no data, too steep, or banned by a factor). */
  readonly blocked: Uint8Array;
  /**
   * Allocation-free fast path: writes [timeS, energyKJ, hazardM] into out[0..2] and returns
   * true, or returns false if the step is impassable.
   */
  stepInto(fromIndex: number, toIndex: number, distanceM: number, out: Float64Array): boolean;
  /** Weighted step cost for a profile (what the search minimises). */
  edgeCost(profile: RouteProfile): EdgeCostFn;
  /** Lower bound on weighted cost per metre for this profile (0 if no bound can be guaranteed). */
  minCostPerMetre(profile: RouteProfile): number;
}

export interface CostModelOptions {
  /** Replace the built-in factor list entirely (advanced; extraFactors still run after it). */
  factors?: readonly CostFactor[];
}

function fallbackClass(classes: SurfaceClass[]): SurfaceClass {
  return (
    classes.find((c) => c.id === 0) ??
    classes[0] ?? { id: 0, name: "Unknown", color: "#888", speedFactor: 1, terrainFactor: 1, hazard: false }
  );
}

export function createCostModel(
  layers: Layers,
  params: WalkParams,
  extraFactors: readonly CostFactor[] = [],
  options: CostModelOptions = {},
): MarsCostModel {
  const factors: readonly CostFactor[] = [...(options.factors ?? BUILTIN_FACTORS), ...extraFactors];
  // Performance: a loop over different factor objects is a megamorphic call site that V8 cannot
  // inline. When the built-ins are in use, call them directly (same objects, same order), then
  // loop over whatever extra factors were supplied.
  const builtins = !options.factors;
  const loopFactors = builtins ? extraFactors : factors;
  const nf = loopFactors.length;
  const { elevation, slope, surface } = layers;
  const n = layers.grid.width * layers.grid.height;

  const fb = fallbackClass(layers.surfaceClasses);
  const classById: SurfaceClass[] = new Array(256).fill(fb);
  for (const c of layers.surfaceClasses) if (c.id >= 0 && c.id < 256) classById[c.id] = c;

  const blocked = new Uint8Array(n);
  const cellRules = factors.filter((f) => f.blocksCell);
  if (cellRules.length) {
    for (let i = 0; i < n; i++) {
      for (const f of cellRules) {
        if (f.blocksCell!(layers, params, i)) {
          blocked[i] = 1;
          break;
        }
      }
    }
  }

  const s: StepState = {
    layers,
    params,
    from: 0,
    to: 0,
    distanceM: 0,
    fromElevationM: 0,
    toElevationM: 0,
    dzM: 0,
    grade: 0,
    gradeDeg: 0,
    fromSlopeDeg: 0,
    toSlopeDeg: 0,
    fromClass: fb,
    toClass: fb,
    blocked: false,
    speedMps: 0,
    terrainFactor: 1,
    metabolicW: 0,
    hazardM: 0,
    extraTimeS: 0,
    extraEnergyKJ: 0,
  };

  let rTime = 0;
  let rEnergy = 0;
  let rHazard = 0;

  function evaluate(from: number, to: number, d: number): boolean {
    if (blocked[to] === 1) return false;
    const ef = elevation[from]!;
    const et = elevation[to]!;
    s.from = from;
    s.to = to;
    s.distanceM = d;
    s.fromElevationM = ef;
    s.toElevationM = et;
    const dz = et - ef;
    s.dzM = dz;
    const grade = dz / d;
    s.grade = grade;
    s.gradeDeg = Math.atan(grade) * R2D;
    s.fromSlopeDeg = slope[from]!;
    s.toSlopeDeg = slope[to]!;
    s.fromClass = classById[surface[from]!]!;
    s.toClass = classById[surface[to]!]!;
    s.blocked = false;
    s.speedMps = 0;
    s.terrainFactor = 1;
    s.metabolicW = 0;
    s.hazardM = 0;
    s.extraTimeS = 0;
    s.extraEnergyKJ = 0;
    if (builtins) {
      validityFactor.apply(s);
      if (s.blocked) return false;
      slopeLimitFactor.apply(s);
      if (s.blocked) return false;
      speedFactor.apply(s);
      metabolicFactor.apply(s);
      hazardFactor.apply(s);
    }
    for (let k = 0; k < nf; k++) {
      loopFactors[k]!.apply(s);
      if (s.blocked) return false;
    }
    const v = s.speedMps;
    if (!(v > 0)) return false;
    const t = d / v + s.extraTimeS;
    rTime = t;
    rEnergy = (s.metabolicW * t) / 1000 + s.extraEnergyKJ;
    rHazard = s.hazardM;
    return true;
  }

  function stepCost(from: number, to: number, d: number): StepCost | null {
    if (!evaluate(from, to, d)) return null;
    return { timeS: rTime, energyKJ: rEnergy, hazardM: rHazard };
  }

  function stepInto(from: number, to: number, d: number, out: Float64Array): boolean {
    if (!evaluate(from, to, d)) return false;
    out[0] = rTime;
    out[1] = rEnergy;
    out[2] = rHazard;
    return true;
  }

  function edgeCost(profile: RouteProfile): EdgeCostFn {
    const tw = profile.timeWeight;
    const ew = profile.energyWeight;
    const hw = profile.hazardWeight;
    return (from, to, d) => (evaluate(from, to, d) ? rTime * tw + rEnergy * ew + rHazard * hw : Infinity);
  }

  function minCostPerMetre(profile: RouteProfile): number {
    if (options.factors || factors.some((f) => f.mayReduceCost)) return 0;
    return builtinMinCostPerMetre(layers.surfaceClasses.length ? layers.surfaceClasses : [fb], params, profile);
  }

  return { layers, params, factors, blocked, stepCost, stepInto, edgeCost, minCostPerMetre };
}

/**
 * Lower bound on weighted cost per horizontal metre under the built-in factors, found by
 * scanning every allowed grade against every pair-mean surface speed factor and the terrain
 * factor extremes, minus a 5% safety margin. Used as the A* heuristic rate.
 */
function builtinMinCostPerMetre(classes: SurfaceClass[], p: WalkParams, profile: RouteProfile): number {
  const tw = Math.max(0, profile.timeWeight);
  const ew = Math.max(0, profile.energyWeight);
  // M is linear in eta (and the eta term can be negative on steep descents), so both extremes are checked.
  const etas = [Math.min(...classes.map((c) => c.terrainFactor)), Math.max(...classes.map((c) => c.terrainFactor))];
  const speeds = new Set<number>();
  for (const a of classes) for (const b of classes) speeds.add(0.5 * (a.speedFactor + b.speedFactor));
  const gMax = Math.tan(Math.min(p.maxSlopeDeg, 89) * D2R);
  let best = Infinity;
  const N = 2000;
  for (let k = 0; k <= N; k++) {
    const g = -gMax + (2 * gMax * k) / N;
    const tob = toblerFactor(g);
    for (const sf of speeds) {
      const v = p.baseSpeedMps * tob * sf;
      if (!(v > 0)) continue;
      for (const eta of etas) {
        const m = pandolfSanteeW(p.bodyMassKg, p.suitMassKg, v, g * 100, eta, p.gravity);
        const perM = tw / v + (ew * m) / v / 1000;
        if (perM < best) best = perM;
      }
    }
  }
  return Number.isFinite(best) ? best * 0.95 : 0;
}
