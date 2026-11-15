import type { LayerManifest, LonLat, ReachRing, RouteProfile, RouteResult, SurfaceClass, WalkParams } from "@marsmap/core";

export type WorkerIn =
  | { type: "init"; base: string; manifest: LayerManifest; surfaceClasses: SurfaceClass[] }
  | { type: "plan"; id: number; points: LonLat[]; dwellS: number[]; params: WalkParams }
  | { type: "reach"; id: number; start: LonLat; params: WalkParams; profileId: string; budgetsS: number[]; dwellS: number };

export type WorkerOut =
  | { type: "ready"; ok: boolean; missing: string[]; profiles: RouteProfile[] }
  | { type: "error"; kind: "init" | "plan" | "reach"; id?: number; message: string }
  | { type: "plan"; id: number; results: RouteResult[]; ms: number }
  | {
      type: "reach";
      id: number;
      rings: ReachRing[];
      outTimeS: Float32Array;
      backTimeS: Float32Array;
      backEnergyKJ: Float32Array;
      ms: number;
    };
