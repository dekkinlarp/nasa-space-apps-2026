/**
 * Shared contract between the data pipeline (scripts/), the routing core
 * (packages/core) and the apps. Exported names and field names here are fixed;
 * add new optional fields rather than renaming.
 */

/** [longitude, latitude] in degrees. Longitude is east-positive (0-360), latitude planetocentric. */
export type LonLat = [lon: number, lat: number];

/**
 * A regular grid over the demo area. Row 0 is the NORTH edge, column 0 the WEST edge.
 * Cell (row, col) has flat index `row * width + col`. Cell centres sit half a cell in
 * from the bounds. Cells are square in metres (`cellSizeM`).
 */
export interface GridSpec {
  id: string;
  south: number;
  north: number;
  west: number;
  east: number;
  width: number;
  height: number;
  cellSizeM: number;
  marsRadiusM: number;
}

export type LayerDType = "float32" | "uint8";

/** One raster layer on the shared grid, stored as a raw little-endian binary file. */
export interface LayerEntry {
  /** "elevation" | "slope" | "surface" | "surface_confidence" | any future layer id */
  id: string;
  /** Path relative to the area's data folder, e.g. "elevation.f32". */
  file: string;
  dtype: LayerDType;
  units: string;
  /** Value meaning "no data" (NaN for float layers if omitted). */
  nodata?: number;
  /** Where the data came from (dataset name and URL). */
  source: string;
  /** How it was derived. */
  method: string;
  version: string;
  /** True when the layer is a rough estimate rather than a measurement. */
  estimated: boolean;
}

/** A georeferenced picture (orbital photo, thermal map) for display only. */
export interface ImageryEntry {
  id: string;
  name: string;
  /** Path relative to the area's data folder. */
  file: string;
  /** Bounds of the image in degrees. */
  south: number;
  north: number;
  west: number;
  east: number;
  widthPx: number;
  heightPx: number;
  source: string;
  metersPerPixel?: number;
}

/** data/<areaId>/layers.json */
export interface LayerManifest {
  grid: GridSpec;
  layers: LayerEntry[];
  imagery: ImageryEntry[];
  generatedAt: string;
}

export interface SurfaceClass {
  id: number;
  name: string;
  color: string;
  /** Multiplies walking speed (1 = unimpeded). */
  speedFactor: number;
  /** Terrain coefficient for the energy model (1 = firm ground). */
  terrainFactor: number;
  hazard: boolean;
}

/** In-memory rasters the routing core works on. */
export interface Layers {
  grid: GridSpec;
  /** metres relative to the Mars areoid */
  elevation: Float32Array;
  /** degrees */
  slope: Float32Array;
  /** SurfaceClass ids */
  surface: Uint8Array;
  surfaceClasses: SurfaceClass[];
}

/** Every tunable number of the walk model. Lives in config/walk-params.json; UI sliders edit a copy. */
export interface WalkParams {
  /** Suited walking speed on flat firm ground, m/s. */
  baseSpeedMps: number;
  /** Slopes steeper than this are impassable, degrees. */
  maxSlopeDeg: number;
  /** Slopes above this count as hazardous (still passable), degrees. */
  cautionSlopeDeg: number;
  bodyMassKg: number;
  suitMassKg: number;
  /** Mars surface gravity, m/s^2. */
  gravity: number;
  /** Total EVA time allowed outside, seconds. */
  evaLimitS: number;
  /** Usable life-support energy budget for the walk, kJ (metabolic). */
  energyBudgetKJ: number;
  /** Fraction of time/energy held back as a safety reserve (0-1). */
  reserveFraction: number;
  /** Default time spent working at each stop, seconds. */
  stopDwellS: number;
  /** Surface radiation dose rate, mSv per day. */
  radiationMSvPerDay: number;
  /**
   * (added by core, optional) Metabolic rate while working at a stop, W. Used to charge
   * dwell time against the energy budget. Falls back to 0 (dwell costs no energy) if absent.
   */
  dwellMetabolicW?: number;
}

/** What the search minimises: cost = time*timeW + energy*energyW + hazardMetres*hazardW. */
export interface RouteProfile {
  id: string;
  name: string;
  timeWeight: number;
  energyWeight: number;
  hazardWeight: number;
}

/** Cost of one step between neighbouring cells; null from the model means impassable. */
export interface StepCost {
  timeS: number;
  energyKJ: number;
  /** Metres of this step that cross hazardous ground or caution-level slope. */
  hazardM: number;
}

/**
 * The only place walking physics lives. The search engine calls this and nothing else,
 * so a new factor (radiation, shade, no-go zones) is a new term here.
 */
export interface CostModel {
  stepCost(fromIndex: number, toIndex: number, distanceM: number): StepCost | null;
}

export interface ProfilePoint {
  /** Distance along the segment, metres. */
  distanceM: number;
  elevationM: number;
  slopeDeg: number;
  surfaceId: number;
}

export interface RouteSegment {
  from: LonLat;
  to: LonLat;
  /** The walked line, one vertex per grid cell (may be simplified). */
  path: LonLat[];
  distanceM: number;
  timeS: number;
  energyKJ: number;
  ascentM: number;
  descentM: number;
  avgSlopeDeg: number;
  maxSlopeDeg: number;
  /** Fraction of the segment's length on each surface class id. */
  surfaceMix: Record<number, number>;
  hazardM: number;
  profile: ProfilePoint[];
  /** (added by core, optional) False when no path to `to` exists; the segment is then empty (all zeros). */
  reachable?: boolean;
}

export interface RouteTotals {
  distanceM: number;
  /** Walking time only. */
  walkTimeS: number;
  /** Walking time plus dwell at each stop. */
  totalTimeS: number;
  energyKJ: number;
  ascentM: number;
  descentM: number;
  hazardM: number;
  radiationMSv: number;
  /** True when the plan fits inside the time and energy limits after reserve. */
  withinLimits: boolean;
  /** Index of the first segment that breaks a limit, or null. */
  firstSegmentOverLimit: number | null;
  limitingFactor: "time" | "energy" | null;
  /** (added by core, optional) Energy spent working at stops (dwell time x dwellMetabolicW), kJ; included in energyKJ. */
  dwellEnergyKJ?: number;
  /** (added by core, optional) totalTimeS / (evaLimitS x (1 - reserveFraction)). > 1 means over. */
  timeUsedFraction?: number;
  /** (added by core, optional) energyKJ / (energyBudgetKJ x (1 - reserveFraction)). > 1 means over. */
  energyUsedFraction?: number;
}

export interface RouteResult {
  profile: RouteProfile;
  /** False when some stop cannot be reached at all. */
  reachable: boolean;
  segments: RouteSegment[];
  totals: RouteTotals;
  /** (added by core, optional) Indices into the input `points` that could not be reached. */
  unreachableStops?: number[];
}

/** Per-cell cost of walking out from the start and of walking back to it. Infinity = unreachable. */
export interface ReachField {
  start: LonLat;
  outTimeS: Float32Array;
  backTimeS: Float32Array;
  outEnergyKJ: Float32Array;
  backEnergyKJ: Float32Array;
}

/** One walk-limit ring: everything inside can be reached and returned from within the budget. */
export interface ReachRing {
  id: string;
  label: string;
  /** Round-trip walking time budget this ring represents, seconds. */
  budgetS: number;
  /** GeoJSON MultiPolygon coordinates in [lon, lat]. */
  coordinates: number[][][][];
}
