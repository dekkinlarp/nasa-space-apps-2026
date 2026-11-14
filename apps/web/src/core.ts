/**
 * Typed view of the @marsmap/core API (see packages/core/src/index.ts). Accessed through
 * the module namespace so the app still builds while the core is being implemented;
 * `missingCoreFunctions()` reports what is not there yet, and the UI says so instead of
 * faking routes.
 */
import * as coreModule from "@marsmap/core";
import type {
  CostModel,
  GridSpec,
  LayerManifest,
  Layers,
  LonLat,
  ReachField,
  ReachRing,
  RouteProfile,
  RouteResult,
  SurfaceClass,
  WalkParams,
} from "@marsmap/core";

export interface CoreApi {
  lonLatToCell(grid: GridSpec, lonLat: LonLat): { row: number; col: number; index: number } | null;
  cellToLonLat(grid: GridSpec, index: number): LonLat;
  distanceM(grid: GridSpec, a: LonLat, b: LonLat): number;
  loadLayers(
    manifest: LayerManifest,
    fetchBinary: (file: string) => Promise<ArrayBuffer>,
    surfaceClasses: SurfaceClass[],
  ): Promise<Layers>;
  createCostModel(layers: Layers, params: WalkParams): CostModel;
  DEFAULT_PROFILES: RouteProfile[];
  planRoute(layers: Layers, params: WalkParams, profile: RouteProfile, points: LonLat[], dwellS?: number[]): RouteResult;
  planRouteAlternatives(layers: Layers, params: WalkParams, points: LonLat[], dwellS?: number[]): RouteResult[];
  computeReach(layers: Layers, params: WalkParams, profile: RouteProfile, start: LonLat): ReachField;
  reachRings(grid: GridSpec, reach: ReachField, budgetsS: number[]): ReachRing[];
  walkLimitRing(grid: GridSpec, reach: ReachField, params: WalkParams, dwellS?: number): ReachRing;
  samplePoint(layers: Layers, lonLat: LonLat): { elevationM: number; slopeDeg: number; surfaceId: number } | null;
}

export const core = coreModule as unknown as Partial<CoreApi>;

const REQUIRED: (keyof CoreApi)[] = [
  "loadLayers",
  "DEFAULT_PROFILES",
  "planRouteAlternatives",
  "computeReach",
  "reachRings",
];

export function missingCoreFunctions(): string[] {
  return REQUIRED.filter((k) => core[k] === undefined);
}
