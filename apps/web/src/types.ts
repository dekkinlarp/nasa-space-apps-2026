import type { LayerManifest, LonLat, SurfaceClass, WalkParams, GridSpec } from "@marsmap/core";

export type PoiType = "drill-site" | "science-target" | "start" | "viewpoint";

export interface PoiEvidence {
  claim: string;
  /** rover = measured on the ground; orbital = seen from orbit; inferred = our reading of the pictures. */
  basis: "rover" | "orbital" | "inferred";
  source?: string;
}

export type PoiPriority = "primary" | "secondary" | "optional";

export interface Poi {
  id: string;
  name: string;
  type: PoiType;
  lon: number;
  lat: number;
  summary: string;
  roverDid?: string;
  roverCouldNot?: string;
  humanCan?: string;
  positionSource: string;
  sources: string[];
  /** Planning priority for the walk's science objective. */
  priority?: PoiPriority;
  /** The question a stop here helps answer. */
  objective?: string;
  /** What the crew would do at the stop. */
  activity?: string;
  evidence?: PoiEvidence[];
  /** How sure we are that the stop is where and what the card says. */
  confidence?: "high" | "medium" | "low";
  confidenceNote?: string;
}

export interface MineralLayerInfo {
  id: string;
  band: string;
  name: string;
  indicates: string;
  caveat: string;
  stats?: { coveragePct: number; positivePct: number; p50: number; p90: number; p98: number; scenePct?: Record<string, number> };
}

export interface CrismAlignment {
  shiftPx: [number, number];
  shiftM: [number, number];
  corrUnshifted: number | null;
  corrBest: number | null;
  applied: boolean;
}

/** minerals.json, written by the pipeline's minerals step. */
export interface Minerals {
  observation: string;
  mission: string;
  acquired: string;
  source: string;
  parameterReference: string;
  pixelM: number;
  note: string;
  coregistration: CrismAlignment & { method: string };
  /** One entry per CRISM scene in the mosaic, first = preferred. Absent in single-scene data. */
  scenes?: { obs: string; acquired: string; coregistration: CrismAlignment }[];
  layers: MineralLayerInfo[];
  poiSamples: Record<string, Record<string, { value: number | null; percentile: number | null }>>;
}

/** The parts of preview/verify-report.json the app shows. */
export interface DataChecks {
  generatedAt?: string;
  georef?: { waypoints: number; meanDiffM: number; medianAbsDiffM: number; maxAbsDiffM: number };
  slopeVsTilt?: { waypoints: number; medianSlopeDeg: number; medianTiltDeg: number; medianAbsDiffDeg: number };
  problems?: string[];
}

export interface AppConfig {
  area: { id: string; name: string; note?: string; centerLat: number; centerLon: number } | null;
  surfaceClasses: SurfaceClass[];
  walkParams: WalkParams;
  walkParamsSource: string;
  pois: Poi[];
}

export interface RoverPhoto {
  sol: number;
  lon: number;
  lat: number;
  elevationM?: number;
  url: string;
  instrument?: string;
  dateTaken?: string;
  credit?: string;
  sourceUrl?: string;
}

export interface Waypoint {
  lonLat: LonLat;
  sol: number | null;
  props: Record<string, unknown>;
}

export interface DrillSite {
  name: string;
  lonLat: LonLat;
  sol?: number;
  props: Record<string, unknown>;
}

export interface RoverData {
  traverse: GeoJSON.FeatureCollection | null;
  waypoints: Waypoint[];
  photos: RoverPhoto[];
  drillSites: DrillSite[];
}

export interface Conditions {
  raw: Record<string, unknown>;
  tempMinC: number | null;
  tempMaxC: number | null;
  sunrise: string | null;
  sunset: string | null;
  radiationMSvPerDay: number | null;
  observed: string | null;
  source: string | null;
}

/** Display copy of the rasters (the worker holds its own copy for routing). */
export interface DisplayLayers {
  grid: GridSpec;
  elevation: Float32Array | null;
  slope: Float32Array | null;
  surface: Uint8Array | null;
  confidence: Uint8Array | null;
  elevMin: number;
  elevMax: number;
  /** Median elevation: the 0 m reference for 3D terrain. */
  elevRef: number;
}

export interface AreaData {
  areaId: string;
  base: string;
  synthetic: boolean;
  manifest: LayerManifest;
  config: AppConfig;
  layers: DisplayLayers;
  rover: RoverData;
  conditions: Conditions | null;
  minerals: Minerals | null;
  checks: DataChecks | null;
}

export interface Stop {
  id: string;
  lonLat: LonLat;
  name: string;
  poiId?: string;
  dwellS: number;
}

export interface StartPoint {
  lonLat: LonLat;
  name: string;
  poiId?: string;
}
