/// <reference lib="webworker" />
/**
 * Runs @marsmap/core off the main thread. Requests of the same kind are coalesced:
 * only the newest plan / reach request is computed, so slider drags never queue up.
 *
 * A tiled region is routed one planning window at a time: a "window" message loads the routing
 * rasters of that window of tiles, and plan / reach requests wait until it is in. An untiled area
 * is loaded whole at init.
 */
import { loadWindowLayers, manifestTiles, type Layers, type LayerManifest, type LonLat, type SurfaceClass, type TileWindow, type WalkParams } from "@marsmap/core";
import { core, missingCoreFunctions } from "../core";
import type { WorkerIn, WorkerOut } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let layers: Layers | null = null;
let ctx: { manifest: LayerManifest; surfaceClasses: SurfaceClass[]; fetchBinary: (f: string) => Promise<ArrayBuffer> } | null = null;
/** Bumped by every window request, so a slow load that has been superseded is dropped. */
let loadSeq = 0;
const pending: Partial<Record<"plan" | "reach", WorkerIn>> = {};
let scheduled = false;

const post = (m: WorkerOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);

function kick() {
  if (!scheduled && layers && (pending.plan || pending.reach)) {
    scheduled = true;
    setTimeout(drain, 0);
  }
}

async function init(base: string, manifest: LayerManifest, surfaceClasses: SurfaceClass[]) {
  const missing = missingCoreFunctions();
  if (missing.length) {
    post({ type: "ready", ok: false, missing, profiles: [] });
    return;
  }
  const fetchBinary = async (file: string) => {
    const url = /^(https?:)?\//.test(file) ? file : `${base}/${file.replace(/^\.?\//, "")}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.arrayBuffer();
  };
  ctx = { manifest, surfaceClasses, fetchBinary };
  try {
    // Small areas are routed whole; tiled regions wait for a window.
    if (!manifestTiles(manifest)) layers = await loadWindowLayers(manifest, null, fetchBinary, surfaceClasses);
    post({ type: "ready", ok: true, missing: [], profiles: core.DEFAULT_PROFILES ?? [] });
  } catch (e) {
    post({ type: "error", kind: "init", message: String((e as Error)?.message ?? e) });
  }
}

async function loadWindow(win: TileWindow) {
  if (!ctx) return;
  const seq = ++loadSeq;
  layers = null;
  const t0 = performance.now();
  try {
    const next = await loadWindowLayers(ctx.manifest, win, ctx.fetchBinary, ctx.surfaceClasses);
    if (seq !== loadSeq) return;
    layers = next;
    post({ type: "window", win, grid: next.grid, ms: performance.now() - t0 });
    kick();
  } catch (e) {
    if (seq === loadSeq) post({ type: "error", kind: "window", message: String((e as Error)?.message ?? e) });
  }
}

function runPlan(id: number, points: LonLat[], dwellS: number[], params: WalkParams) {
  const t0 = performance.now();
  const results = core.planRouteAlternatives!(layers!, params, points, dwellS);
  post({ type: "plan", id, results, ms: performance.now() - t0 });
}

function runReach(id: number, start: LonLat, params: WalkParams, profileId: string, budgetsS: number[], dwellS: number) {
  const t0 = performance.now();
  const profiles = core.DEFAULT_PROFILES ?? [];
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0]!;
  const reach = core.computeReach!(layers!, params, profile, start);
  // Fixed time rings, then the real limit (time, energy and oxygen together) as the outermost ring.
  const usableS = params.evaLimitS * (1 - params.reserveFraction) - dwellS;
  const rings = core.walkLimitRing
    ? [...core.reachRings!(layers!.grid, reach, budgetsS), core.walkLimitRing(layers!.grid, reach, params, dwellS)]
    : core.reachRings!(layers!.grid, reach, [...budgetsS, Math.max(0, usableS)]);
  // Is any cell on the window's edge reachable and back within the time and energy left after one stop?
  const g = layers!.grid, W = g.width, H = g.height;
  const usableE = params.energyBudgetKJ * (1 - params.reserveFraction) - ((params.dwellMetabolicW ?? 0) * dwellS) / 1000;
  const within = (i: number) =>
    reach.outTimeS[i]! + reach.backTimeS[i]! <= usableS && reach.outEnergyKJ[i]! + reach.backEnergyKJ[i]! <= usableE;
  let clipped = false;
  for (let c = 0; c < W && !clipped; c++) clipped = within(c) || within((H - 1) * W + c);
  for (let r = 0; r < H && !clipped; r++) clipped = within(r * W) || within(r * W + W - 1);
  const out = reach.outTimeS.slice();
  const back = reach.backTimeS.slice();
  const backE = reach.backEnergyKJ.slice();
  post({ type: "reach", id, rings, grid: layers!.grid, clipped, outTimeS: out, backTimeS: back, backEnergyKJ: backE, ms: performance.now() - t0 }, [
    out.buffer,
    back.buffer,
    backE.buffer,
  ]);
}

function drain() {
  scheduled = false;
  for (const kind of ["plan", "reach"] as const) {
    // Layers are swapped out while a new window loads; whatever is pending runs once it is in.
    if (!layers) return;
    const m = pending[kind];
    if (!m) continue;
    delete pending[kind];
    try {
      if (m.type === "plan") runPlan(m.id, m.points, m.dwellS, m.params);
      else if (m.type === "reach") runReach(m.id, m.start, m.params, m.profileId, m.budgetsS, m.dwellS);
    } catch (e) {
      post({ type: "error", kind, id: "id" in m ? m.id : undefined, message: String((e as Error)?.message ?? e) });
    }
    // Yield so newer requests (or a new window) that arrived during the computation come first.
    if (pending.plan || pending.reach) {
      scheduled = true;
      setTimeout(drain, 0);
      return;
    }
  }
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  if (m.type === "init") {
    void init(m.base, m.manifest, m.surfaceClasses).then(kick);
    return;
  }
  if (m.type === "window") {
    void loadWindow(m.win);
    return;
  }
  pending[m.type] = m;
  kick();
};
