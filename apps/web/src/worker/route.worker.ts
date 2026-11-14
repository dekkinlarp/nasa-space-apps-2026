/// <reference lib="webworker" />
/**
 * Runs @marsmap/core off the main thread. Requests of the same kind are coalesced:
 * only the newest plan / reach request is computed, so slider drags never queue up.
 */
import type { Layers, LayerManifest, LonLat, SurfaceClass, WalkParams } from "@marsmap/core";
import { core, missingCoreFunctions } from "../core";
import type { WorkerIn, WorkerOut } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let layers: Layers | null = null;
const pending: Partial<Record<"plan" | "reach", WorkerIn>> = {};
let scheduled = false;

const post = (m: WorkerOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);

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
  try {
    layers = await core.loadLayers!(manifest, fetchBinary, surfaceClasses);
    post({ type: "ready", ok: true, missing: [], profiles: core.DEFAULT_PROFILES ?? [] });
  } catch (e) {
    post({ type: "error", kind: "init", message: String((e as Error)?.message ?? e) });
  }
}

function runPlan(id: number, points: LonLat[], dwellS: number[], params: WalkParams) {
  const t0 = performance.now();
  const results = core.planRouteAlternatives!(layers!, params, points, dwellS);
  post({ type: "plan", id, results, ms: performance.now() - t0 });
}

function runReach(id: number, start: LonLat, params: WalkParams, profileId: string, budgetsS: number[]) {
  const t0 = performance.now();
  const profiles = core.DEFAULT_PROFILES ?? [];
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0]!;
  const reach = core.computeReach!(layers!, params, profile, start);
  const rings = core.reachRings!(layers!.grid, reach, budgetsS);
  const out = reach.outTimeS.slice();
  const back = reach.backTimeS.slice();
  const backE = reach.backEnergyKJ.slice();
  post({ type: "reach", id, rings, outTimeS: out, backTimeS: back, backEnergyKJ: backE, ms: performance.now() - t0 }, [
    out.buffer,
    back.buffer,
    backE.buffer,
  ]);
}

function drain() {
  scheduled = false;
  for (const kind of ["plan", "reach"] as const) {
    const m = pending[kind];
    if (!m) continue;
    delete pending[kind];
    if (!layers) {
      post({ type: "error", kind, id: "id" in m ? m.id : undefined, message: "Routing layers are not loaded." });
      continue;
    }
    try {
      if (m.type === "plan") runPlan(m.id, m.points, m.dwellS, m.params);
      else if (m.type === "reach") runReach(m.id, m.start, m.params, m.profileId, m.budgetsS);
    } catch (e) {
      post({ type: "error", kind, id: "id" in m ? m.id : undefined, message: String((e as Error)?.message ?? e) });
    }
    // Yield so newer requests that arrived during the computation replace older ones.
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
    void init(m.base, m.manifest, m.surfaceClasses).then(() => {
      if (!scheduled && (pending.plan || pending.reach)) {
        scheduled = true;
        setTimeout(drain, 0);
      }
    });
    return;
  }
  pending[m.type] = m;
  if (!scheduled && layers) {
    scheduled = true;
    setTimeout(drain, 0);
  }
};
