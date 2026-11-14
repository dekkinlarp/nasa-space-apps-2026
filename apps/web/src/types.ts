import type { LayerManifest, LonLat, SurfaceClass, WalkParams, GridSpec } from "@marsmap/core";

export type PoiType = "drill-site" | "science-target" | "start" | "viewpoint";

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
