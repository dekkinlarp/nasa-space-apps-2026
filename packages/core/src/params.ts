import type { WalkParams } from "./types";

/**
 * Defaults for every walk-model number. This duplicates config/walk-params.json (a test asserts
 * they are equal) so that bundlers never have to reach outside the package. Sources for each
 * value are in config/walk-params.json `_sources` and in packages/core/README.md.
 */
export const DEFAULT_WALK_PARAMS: Readonly<WalkParams> = Object.freeze({
  baseSpeedMps: 1.0,
  maxSlopeDeg: 20,
  cautionSlopeDeg: 15,
  bodyMassKg: 82,
  suitMassKg: 104,
  gravity: 3.71,
  evaLimitS: 21600,
  energyBudgetKJ: 10130,
  reserveFraction: 0.1667,
  stopDwellS: 1800,
  radiationMSvPerDay: 0.67,
  dwellMetabolicW: 249,
});

/** Standard Earth gravity, m/s^2 (the Pandolf equation was fitted at 1 g). */
export const EARTH_GRAVITY = 9.80665;
