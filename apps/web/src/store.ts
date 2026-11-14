import { create } from "zustand";
import type { LonLat, ReachRing, RouteProfile, RouteResult, WalkParams } from "@marsmap/core";
import type { AreaData, Poi, StartPoint, Stop, Waypoint } from "./types";

export type Tab = "explore" | "plan" | "layers";
export type Status = "idle" | "calculating" | "ready" | "error";

export interface LayerState {
  on: boolean;
  opacity: number;
}

export interface ReachData {
  outTimeS: Float32Array;
  backTimeS: Float32Array;
  backEnergyKJ: Float32Array;
  start: LonLat;
  usableS: number;
}

export interface HoverInfo {
  lonLat: LonLat;
  elevationM: number | null;
  slopeDeg: number | null;
  surfaceId: number | null;
}

export interface GoState {
  mode: "off" | "sim" | "gps";
  playing: boolean;
  speed: number;
  /** Simulated or measured elapsed walking time, s. */
  elapsedS: number;
  /** Distance along the selected route, m. */
  alongM: number;
  position: LonLat | null;
  gpsAccuracyM: number | null;
  gpsError: string | null;
  offRouteM: number | null;
}

export const OVERLAY_IDS = ["hillshade", "elevation", "slope", "surface", "confidence", "cost", "rings", "track", "pois"] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

interface State {
  area: AreaData | null;
  loadError: string | null;
  tab: Tab;

  baseImagery: string | null;
  baseOpacity: number;
  overlays: Record<OverlayId, LayerState>;
  /** Science layers from the manifest (group "science"), keyed by layer id. */
  sci: Record<string, LayerState>;
  /** Their data, loaded the first time each is switched on. */
  sciData: Record<string, Float32Array>;
  view3d: boolean;
  exaggeration: number;

  selectedPoi: Poi | null;
  selectedWaypoint: Waypoint | null;
  hover: HoverInfo | null;
  /** A clicked empty-map point awaiting "set start / add stop". */
  mapClick: LonLat | null;
  /** When set, the next map click sets the start. */
  pickingStart: boolean;

  start: StartPoint | null;
  stops: Stop[];
  returnToStart: boolean;
  params: WalkParams | null;
  defaultParams: WalkParams | null;

  engine: { ready: boolean; missing: string[]; error: string | null; profiles: RouteProfile[] };
  planStatus: Status;
  planError: string | null;
  planMs: number | null;
  results: RouteResult[] | null;
  selectedProfile: string;
  reachStatus: Status;
  rings: ReachRing[] | null;
  reach: ReachData | null;

  profileHoverM: number | null;
  profileCursor: LonLat | null;
  go: GoState;

  set: (p: Partial<State>) => void;
  setOverlay: (id: OverlayId, p: Partial<LayerState>) => void;
  setSci: (id: string, p: Partial<LayerState>) => void;
  setParams: (p: Partial<WalkParams>) => void;
  setStart: (s: StartPoint | null) => void;
  addStop: (s: Omit<Stop, "id" | "dwellS"> & { dwellS?: number }) => void;
  removeStop: (id: string) => void;
  moveStop: (from: number, to: number) => void;
  setDwell: (id: string, dwellS: number) => void;
  setGo: (p: Partial<GoState>) => void;
}

let stopSeq = 0;

export const useStore = create<State>((set, get) => ({
  area: null,
  loadError: null,
  tab: "explore",

  baseImagery: null,
  baseOpacity: 1,
  overlays: {
    hillshade: { on: false, opacity: 0.35 },
    elevation: { on: false, opacity: 0.55 },
    slope: { on: false, opacity: 0.6 },
    surface: { on: false, opacity: 0.5 },
    confidence: { on: false, opacity: 0.7 },
    cost: { on: false, opacity: 0.55 },
    rings: { on: true, opacity: 0.9 },
    track: { on: true, opacity: 0.9 },
    pois: { on: true, opacity: 1 },
  },
  sci: {},
  sciData: {},
  view3d: false,
  exaggeration: 3,

  selectedPoi: null,
  selectedWaypoint: null,
  hover: null,
  mapClick: null,
  pickingStart: false,

  start: null,
  stops: [],
  returnToStart: true,
  params: null,
  defaultParams: null,

  engine: { ready: false, missing: [], error: null, profiles: [] },
  planStatus: "idle",
  planError: null,
  planMs: null,
  results: null,
  selectedProfile: "fastest",
  reachStatus: "idle",
  rings: null,
  reach: null,

  profileHoverM: null,
  profileCursor: null,
  go: { mode: "off", playing: false, speed: 120, elapsedS: 0, alongM: 0, position: null, gpsAccuracyM: null, gpsError: null, offRouteM: null },

  set: (p) => set(p),
  setOverlay: (id, p) => set({ overlays: { ...get().overlays, [id]: { ...get().overlays[id], ...p } } }),
  setSci: (id, p) => set({ sci: { ...get().sci, [id]: { on: false, opacity: 0.75, ...get().sci[id], ...p } } }),
  setParams: (p) => {
    const cur = get().params;
    if (cur) set({ params: { ...cur, ...p } });
  },
  setStart: (s) => set({ start: s, pickingStart: false }),
  addStop: (s) =>
    set({
      stops: [...get().stops, { ...s, id: `stop-${++stopSeq}`, dwellS: s.dwellS ?? get().params?.stopDwellS ?? 1200 }],
    }),
  removeStop: (id) => set({ stops: get().stops.filter((s) => s.id !== id) }),
  moveStop: (from, to) => {
    const arr = [...get().stops];
    const [it] = arr.splice(from, 1);
    if (!it) return;
    arr.splice(to, 0, it);
    set({ stops: arr });
  },
  setDwell: (id, dwellS) => set({ stops: get().stops.map((s) => (s.id === id ? { ...s, dwellS } : s)) }),
  setGo: (p) => set({ go: { ...get().go, ...p } }),
}));

export function selectedResult(s: Pick<State, "results" | "selectedProfile">): RouteResult | null {
  if (!s.results?.length) return null;
  return s.results.find((r) => r.profile.id === s.selectedProfile) ?? s.results[0] ?? null;
}

/** Walking time available after the reserve, s. */
export function usableTimeS(p: WalkParams): number {
  return p.evaLimitS * (1 - p.reserveFraction);
}

if (import.meta.env.DEV) (globalThis as unknown as { __store: typeof useStore }).__store = useStore;
