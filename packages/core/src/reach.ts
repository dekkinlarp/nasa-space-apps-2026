import { createCostModel, type CostFactor, type MarsCostModel } from "./costModel";
import { snapToPassable } from "./route";
import { flood, type FloodResult } from "./search";
import type { Layers, LonLat, ReachField, RouteProfile, WalkParams } from "./types";

export interface ReachOptions {
  model?: MarsCostModel;
  extraFactors?: CostFactor[];
  /** Stop each flood at this weighted cost (same units as the profile's cost). Default: whole grid. */
  maxCost?: number;
}

/**
 * Accumulate time and energy along a flood's cheapest-path tree. `reverse` means the flood
 * measured cost of walking from each cell TO the source.
 */
function accumulate(
  model: MarsCostModel,
  f: FloodResult,
  reverse: boolean,
  timeOut: Float32Array,
  energyOut: Float32Array,
): void {
  const { width: W, cellSizeM: cs } = model.layers.grid;
  const diag = cs * Math.SQRT2;
  const time = new Float64Array(timeOut.length).fill(Infinity);
  const energy = new Float64Array(timeOut.length).fill(Infinity);
  const step = new Float64Array(3);
  for (let k = 0; k < f.count; k++) {
    const v = f.order[k]!;
    const p = f.parent[v]!;
    if (p < 0) {
      time[v] = 0;
      energy[v] = 0;
      continue;
    }
    const vr = (v / W) | 0, pr = (p / W) | 0;
    const d = vr !== pr && v - vr * W !== p - pr * W ? diag : cs;
    const ok = reverse ? model.stepInto(v, p, d, step) : model.stepInto(p, v, d, step);
    if (!ok) continue; // cannot happen: the flood only used passable steps
    time[v] = time[p]! + step[0]!;
    energy[v] = energy[p]! + step[1]!;
  }
  timeOut.set(time);
  energyOut.set(energy);
}

/**
 * Outbound and return cost fields from `start` under `profile`. Paths minimise the profile's
 * weighted cost; time/energy are measured along those paths. Infinity where unreachable.
 */
export function computeReach(
  layers: Layers,
  params: WalkParams,
  profile: RouteProfile,
  start: LonLat,
  options: ReachOptions = {},
): ReachField {
  const model = options.model ?? createCostModel(layers, params, options.extraFactors ?? []);
  const { grid } = layers;
  const n = grid.width * grid.height;
  const field: ReachField = {
    start,
    outTimeS: new Float32Array(n).fill(Infinity),
    backTimeS: new Float32Array(n).fill(Infinity),
    outEnergyKJ: new Float32Array(n).fill(Infinity),
    backEnergyKJ: new Float32Array(n).fill(Infinity),
  };
  const source = snapToPassable(model, start);
  if (source < 0) return field;
  const graph = { width: grid.width, height: grid.height, cellSizeM: grid.cellSizeM, blocked: model.blocked };
  const edge = model.edgeCost(profile);
  const opts = { maxCost: options.maxCost };
  const out = flood(graph, edge, source, opts);
  accumulate(model, out, false, field.outTimeS, field.outEnergyKJ);
  const back = flood(graph, edge, source, { ...opts, reverse: true });
  accumulate(model, back, true, field.backTimeS, field.backEnergyKJ);
  return field;
}
