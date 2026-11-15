/**
 * Public API of @marsmap/core. The function names and signatures listed in
 * API.md-style comments below are the contract the web app codes against.
 *
 *   lonLatToCell(grid, lonLat) -> { row, col, index } | null
 *   cellToLonLat(grid, index) -> LonLat
 *   distanceM(grid, a, b) -> number
 *   loadLayers(manifest, fetchBinary, surfaceClasses) -> Promise<Layers>
 *   createCostModel(layers, params) -> CostModel
 *   DEFAULT_PROFILES: RouteProfile[]            (fastest, least effort, safest)
 *   planRoute(layers, params, profile, points: LonLat[], dwellS?: number[]) -> RouteResult
 *   planRouteAlternatives(layers, params, points, dwellS?) -> RouteResult[]   (one per DEFAULT_PROFILES)
 *   computeReach(layers, params, profile, start: LonLat) -> ReachField
 *   reachRings(layers.grid, reach, budgetsS: number[]) -> ReachRing[]
 *   samplePoint(layers, lonLat) -> { elevationM, slopeDeg, surfaceId } | null
 *
 * Additions (all optional / extra): DEFAULT_WALK_PARAMS, createCostModel(..., extraFactors?),
 * BUILTIN_FACTORS + CostFactor/StepState (extension point), a trailing `options` argument on
 * planRoute / planRouteAlternatives / computeReach ({ model?, extraFactors?, maxCost? }),
 * computeSlope, snapToPassable, the generic search engine (astar, flood, MinHeap), the oxygen
 * model (oxygenUsedKg, oxygenModelOn; optional o2* fields on WalkParams) and
 * walkLimitRing(grid, reach, params, dwellS?) -> ReachRing (time, energy and oxygen together).
 * Tiled regions: loadWindowLayers(manifest, window, fetchBinary, surfaceClasses) loads the routing rasters
 * of a window of tiles (chooseWindow picks it); routing then runs on that window's own GridSpec.
 */
export * from "./types";
export { DEFAULT_WALK_PARAMS, EARTH_GRAVITY, oxygenUsedKg, oxygenModelOn } from "./params";
export { lonLatToCell, cellToLonLat, rowColToLonLat, distanceM, samplePoint, type CellRef } from "./grid";
export { loadLayers, computeSlope, fetchLayerBytes } from "./load";
export {
  INT16_NODATA,
  inflate,
  encodeValues,
  decodeValues,
  decodeRaster,
  tilePath,
  manifestTiles,
  windowGrid,
  sameWindow,
  chooseWindow,
  readLayerWindow,
  readLayerWhole,
  readOverview,
  loadWindowLayers,
  WINDOW_SIDE_M,
  WINDOW_MARGIN_M,
  type TileWindow,
} from "./tiles";
export {
  createCostModel,
  BUILTIN_FACTORS,
  validityFactor,
  slopeLimitFactor,
  speedFactor,
  metabolicFactor,
  hazardFactor,
  toblerFactor,
  pandolfSanteeW,
  type CostFactor,
  type StepState,
  type MarsCostModel,
  type CostModelOptions,
  type EdgeCostFn,
} from "./costModel";
export { astar, flood, MinHeap, type GridGraph, type StepCostFn, type AStarResult, type FloodResult, type FloodOptions } from "./search";
export {
  DEFAULT_PROFILES,
  planRoute,
  planRouteAlternatives,
  buildSegment,
  computeTotals,
  resolveDwell,
  snapToPassable,
  SNAP_RADIUS_CELLS,
  MAX_PROFILE_POINTS,
  PATH_SIMPLIFY_CELLS,
  type PlanOptions,
} from "./route";
export { computeReach, type ReachOptions } from "./reach";
export { reachRings, walkLimitRing, isolines, type ReachRingOptions } from "./contour";
