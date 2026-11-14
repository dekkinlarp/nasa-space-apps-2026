/** Bridges the store and the routing worker: re-plans and re-computes rings on change (debounced). */
import type { LonLat } from "@marsmap/core";
import { useStore, usableTimeS } from "./store";
import type { AreaData, StartPoint, Stop } from "./types";
import type { WorkerIn, WorkerOut } from "./worker/protocol";

/** Round-trip walking-time rings, seconds. The outermost ring is the real limit (see ringBudgets). */
export const RING_STEPS_S = [15 * 60, 30 * 60, 60 * 60];

/**
 * Ring budgets: fixed round-trip walking times, plus the walk limit = usable EVA time
 * (after reserve) minus one stop's work time, i.e. the farthest you can go, work once and get home.
 */
export function ringBudgets(usableS: number, dwellS: number): number[] {
  const limit = Math.max(0, usableS - dwellS);
  return [...RING_STEPS_S.filter((b) => b < limit * 0.9), limit];
}

/** Two workers so a slow reach flood (whole grid, out + back) never delays route planning. */
let planWorker: Worker | null = null;
let reachWorker: Worker | null = null;
let unsub: (() => void) | undefined;
let planSeq = 0;
let reachSeq = 0;
let planTimer: ReturnType<typeof setTimeout> | undefined;
let reachTimer: ReturnType<typeof setTimeout> | undefined;

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
    });
  }, 200);
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
    } else if (m.type === "error") {
      if (m.kind === "init") s.set({ engine: { ...s.engine, ready: false, error: m.message } });
      else if (m.kind === "plan") s.set({ planStatus: "error", planError: m.message });
      else s.set({ reachStatus: "error" });
    } else if (m.type === "plan") {
      if (m.id !== planSeq) return;
      s.set({ results: m.results, planStatus: "ready", planError: null, planMs: m.ms });
    } else if (m.type === "reach") {
      if (m.id !== reachSeq || !s.start || !s.params) return;
      s.set({
        rings: m.rings,
        reach: { outTimeS: m.outTimeS, backTimeS: m.backTimeS, backEnergyKJ: m.backEnergyKJ, start: s.start.lonLat, usableS: usableTimeS(s.params) },
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

  unsub?.();
  unsub = useStore.subscribe((s, prev) => {
    if (s.start !== prev.start || s.stops !== prev.stops || s.returnToStart !== prev.returnToStart || s.params !== prev.params) schedulePlan();
    if (s.start !== prev.start || s.params !== prev.params || s.selectedProfile !== prev.selectedProfile) scheduleReach();
  });
}
