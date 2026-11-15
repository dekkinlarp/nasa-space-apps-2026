import type { GridSpec, LayerManifest, LonLat, ReachRing, RouteProfile, RouteResult, SurfaceClass, TileWindow, WalkParams } from "@marsmap/core";

export type WorkerIn =
  | { type: "init"; base: string; manifest: LayerManifest; surfaceClasses: SurfaceClass[] }
  /** Load the routing rasters of this window of tiles (tiled areas); later requests wait for it. */
  | { type: "window"; win: TileWindow }
  | { type: "plan"; id: number; points: LonLat[]; dwellS: number[]; params: WalkParams }
  | { type: "reach"; id: number; start: LonLat; params: WalkParams; profileId: string; budgetsS: number[]; dwellS: number };

export type WorkerOut =
  | { type: "ready"; ok: boolean; missing: string[]; profiles: RouteProfile[] }
  | { type: "error"; kind: "init" | "window" | "plan" | "reach"; id?: number; message: string }
  | { type: "window"; win: TileWindow; grid: GridSpec; ms: number }
  | { type: "plan"; id: number; results: RouteResult[]; ms: number }
  | {
      type: "reach";
      id: number;
      rings: ReachRing[];
      grid: GridSpec;
      /** True when ground at the edge of the planning window is still inside the walk limit (rings are cut there). */
      clipped: boolean;
      outTimeS: Float32Array;
      backTimeS: Float32Array;
      backEnergyKJ: Float32Array;
      ms: number;
    };
