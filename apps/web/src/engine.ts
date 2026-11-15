/**
 * Bridges the store and the routing workers: re-plans and re-computes rings on change (debounced).
 *
 * In a tiled region it also owns the planning window: an 8 km square of full-resolution tiles around
 * the start and stops. When the walk moves near the window's edge (or out of it) a new window is
 * chosen; the workers load its routing rasters and the page loads its display rasters (`detail`).
 */
import { chooseWindow, sameWindow, type LonLat, type TileWindow } from "@marsmap/core";
import { useStore, usableTimeS } from "./store";
import { loadDetail } from "./data";
import type { AreaData, StartPoint, Stop } from "./types";
import type { WorkerIn, WorkerOut } from "./worker/protocol";

/** Round-trip time rings at 15 and 30 minutes only. */
export const RING_STEPS_S = [15 * 60, 30 * 60];

/** Keep time rings clearly inside the time limit; the worker adds the actual safety-limit ring. */
export function ringBudgets(usableS: number, dwellS: number): number[] {
  const limit = Math.max(0, usableS - dwellS);
  return RING_STEPS_S.filter((b) => b < limit * 0.9);
}

/** Two workers so a slow reach flood (whole grid, out + back) never delays route planning. */
let planWorker: Worker | null = null;
let reachWorker: Worker | null = null;
let unsub: (() => void) | undefined;
let planSeq = 0;
let reachSeq = 0;
let planTimer: ReturnType<typeof setTimeout> | undefined;
let reachTimer: ReturnType<typeof setTimeout> | undefined;
let detailSeq = 0;

const send = (m: WorkerIn) => (m.type === "reach" ? reachWorker : planWorker)?.postMessage(m);

export function routePoints(start: StartPoint | null, stops: Stop[], returnToStart: boolean): { points: LonLat[]; dwellS: number[] } | null {
  if (!start || stops.length === 0) return null;
  const points: LonLat[] = [start.lonLat, ...stops.map((s) => s.lonLat)];
  const dwellS = [0, ...stops.map((s) => s.dwellS)];
  if (returnToStart) {
    points.push(start.lonLat);
    dwellS.push(0);
  }
  return { points, dwellS };
}

function schedulePlan() {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => {
    const s = useStore.getState();
    if (!s.engine.ready || !s.params) return;
    const rp = routePoints(s.start, s.stops, s.returnToStart);
    if (!rp) {
      s.set({ results: null, planStatus: "idle", planError: null });
      return;
    }
    if (!s.winFits) {
      s.set({
        results: null,
        planStatus: "error",
        planError: "The start and stops are too far apart to plan at full resolution: a walk is planned on an 8 km square around them. Pick stops closer together.",
      });
      return;
    }
    s.set({ planStatus: "calculating" });
    send({ type: "plan", id: ++planSeq, points: rp.points, dwellS: rp.dwellS, params: s.params });
  }, 120);
}

function scheduleReach() {
  clearTimeout(reachTimer);
  reachTimer = setTimeout(() => {
    const s = useStore.getState();
    if (!s.engine.ready || !s.params) return;
    if (!s.start) {
      s.set({ rings: null, reach: null, reachStatus: "idle" });
      return;
    }
    const usable = usableTimeS(s.params);
    s.set({ reachStatus: "calculating" });
    send({
      type: "reach",
      id: ++reachSeq,
      start: s.start.lonLat,
      params: s.params,
      profileId: s.selectedProfile,
      budgetsS: ringBudgets(usable, s.params.stopDwellS),
      dwellS: s.params.stopDwellS,
    });
  }, 200);
}

/** Points the planning window must hold: the start and every stop. */
function windowPoints(s: { start: StartPoint | null; stops: Stop[] }): LonLat[] {
  return [...(s.start ? [s.start.lonLat] : []), ...s.stops.map((x) => x.lonLat)];
}

/** Move the planning window if the walk needs it; tell the workers and load the display rasters. */
function updateWindow(area: AreaData, focus?: LonLat) {
  if (!area.tiles) return;
  const s = useStore.getState();
  const pts = windowPoints(s);
  if (!pts.length && focus) pts.push(focus);
  if (!pts.length && s.win) return;
  const { win, fits } = chooseWindow(area.manifest.grid, area.tiles, pts, s.win);
  if (fits !== s.winFits) s.set({ winFits: fits });
  if (sameWindow(win, s.win)) return;
  setWindow(area, win);
}

function setWindow(area: AreaData, win: TileWindow) {
  useStore.getState().set({ win, rings: null, reach: null });
  for (const w of [planWorker, reachWorker]) w?.postMessage({ type: "window", win });
  const seq = ++detailSeq;
  void loadDetail(area, win).then(
    (detail) => {
      if (seq === detailSeq) useStore.getState().set({ detail });
    },
    (e) => console.error("planning window", e),
  );
}

export function startEngine(area: AreaData) {
  planWorker?.terminate();
  reachWorker?.terminate();
  const onmessage = (ev: MessageEvent<WorkerOut>) => {
    const m = ev.data;
    const s = useStore.getState();
    if (m.type === "ready") {
      if (s.engine.ready && m.ok) return; // second worker
      s.set({
        engine: { ready: m.ok, missing: m.missing, error: m.ok ? null : `Routing core not available yet (missing: ${m.missing.join(", ")})`, profiles: m.profiles },
        selectedProfile: m.profiles.some((p) => p.id === s.selectedProfile) ? s.selectedProfile : (m.profiles[0]?.id ?? s.selectedProfile),
      });
      if (m.ok) {
        schedulePlan();
        scheduleReach();
      }
    } else if (m.type === "window") {
      // Nothing to do: requests queued in the worker run now. Logged for the curious.
      if (import.meta.env.DEV) console.debug(`planning window ${m.grid.id} loaded in ${Math.round(m.ms)} ms`);
    } else if (m.type === "error") {
      if (m.kind === "init" || m.kind === "window") s.set({ engine: { ...s.engine, ready: false, error: m.message } });
      else if (m.kind === "plan") s.set({ planStatus: "error", planError: m.message });
      else s.set({ reachStatus: "error" });
    } else if (m.type === "plan") {
      if (m.id !== planSeq) return;
      s.set({ results: m.results, planStatus: "ready", planError: null, planMs: m.ms });
    } else if (m.type === "reach") {
      if (m.id !== reachSeq || !s.start || !s.params) return;
      s.set({
        rings: m.rings,
        reach: { grid: m.grid, clipped: m.clipped, outTimeS: m.outTimeS, backTimeS: m.backTimeS, backEnergyKJ: m.backEnergyKJ, start: s.start.lonLat, usableS: usableTimeS(s.params) },
        reachStatus: "ready",
      });
    }
  };
  const init: WorkerIn = { type: "init", base: new URL(area.base, location.href).href, manifest: area.manifest, surfaceClasses: area.config.surfaceClasses };
  const make = () => {
    const w = new Worker(new URL("./worker/route.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = onmessage;
    w.onerror = (e) => useStore.getState().set({ engine: { ready: false, missing: [], error: `Worker failed: ${e.message}`, profiles: [] } });
    w.postMessage(init);
    return w;
  };
  planWorker = make();
  reachWorker = make();
  if (area.tiles) {
    // First window: around the start (or the points of interest when there is none).
    const pois = area.config.pois;
    const focus: LonLat | undefined = pois.length ? [pois.reduce((p, q) => p + q.lon, 0) / pois.length, pois.reduce((p, q) => p + q.lat, 0) / pois.length] : undefined;
    useStore.getState().set({ win: null, detail: null });
    updateWindow(area, focus);
  } else useStore.getState().set({ win: null, detail: area.overview });

  unsub?.();
  unsub = useStore.subscribe((s, prev) => {
    if (s.start !== prev.start || s.stops !== prev.stops) updateWindow(area);
    if (s.start !== prev.start || s.stops !== prev.stops || s.returnToStart !== prev.returnToStart || s.params !== prev.params) schedulePlan();
    if (s.start !== prev.start || s.params !== prev.params || s.selectedProfile !== prev.selectedProfile) scheduleReach();
  });
}
