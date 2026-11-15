import type { RouteResult } from "@marsmap/core";

/** Differences of one route alternative relative to a reference route (normally Fastest). */
export interface RouteDelta {
  /** Total time difference, s (positive = slower). */
  dTimeS: number;
  /** Relative differences, fractions (−0.49 = 49% less). null when the reference value is ~0. */
  dDist: number | null;
  dEnergy: number | null;
  dHazard: number | null;
  /** Absolute hazard difference, m. */
  dHazardM: number;
}

const rel = (v: number, ref: number, minRef: number) => (ref > minRef ? (v - ref) / ref : null);

export function routeDelta(r: RouteResult, ref: RouteResult): RouteDelta {
  const a = r.totals;
  const b = ref.totals;
  return {
    dTimeS: a.totalTimeS - b.totalTimeS,
    dDist: rel(a.distanceM, b.distanceM, 1),
    dEnergy: rel(a.energyKJ, b.energyKJ, 1),
    dHazard: rel(a.hazardM, b.hazardM, 5),
    dHazardM: a.hazardM - b.hazardM,
  };
}

const MINUS = "−";

/** "+1 min", "−3 min", "same time". */
export function fmtTimeDelta(dS: number): string {
  const m = Math.round(dS / 60);
  if (m === 0) return "same time";
  return `${m > 0 ? "+" : MINUS}${Math.abs(m)} min`;
}

export function fmtPct(f: number): string {
  const p = Math.round(f * 100);
  return `${p > 0 ? "+" : p < 0 ? MINUS : "±"}${Math.abs(p)}%`;
}

export interface DeltaPart {
  text: string;
  /** "good" = better than the reference, "cost" = worse, "neutral". */
  tone: "good" | "cost" | "neutral";
}

/** Short, ordered list of the differences that matter (time always, then hazard / energy / distance if ≥ 3%). */
export function deltaParts(d: RouteDelta, max = 3): DeltaPart[] {
  const out: DeltaPart[] = [];
  const m = Math.round(d.dTimeS / 60);
  out.push({ text: fmtTimeDelta(d.dTimeS), tone: m > 0 ? "cost" : m < 0 ? "good" : "neutral" });
  const add = (f: number | null, label: string) => {
    if (f == null || Math.abs(f) < 0.03) return;
    out.push({ text: `${fmtPct(f)} ${label}`, tone: f < 0 ? "good" : "cost" });
  };
  add(d.dHazard, "hazard");
  add(d.dEnergy, "energy");
  if (out.length < 3) add(d.dDist, "distance");
  return out.slice(0, max);
}

/** True when an alternative is practically the same walk as the reference. */
export function nearlyIdentical(d: RouteDelta, ref: RouteResult): boolean {
  const t = ref.totals.totalTimeS > 0 ? Math.abs(d.dTimeS) / ref.totals.totalTimeS : 0;
  const dist = Math.abs(d.dDist ?? 0);
  const hz = d.dHazard == null ? Math.abs(d.dHazardM) < 5 : Math.abs(d.dHazard) <= 0.05;
  return t <= 0.02 && dist <= 0.05 && hz;
}

/** Plain-language share of the reference hazard, e.g. "Half the", "A third of the", "62% less". */
function hazardShare(ratio: number): string {
  if (ratio <= 0.05) return "Avoids almost all";
  const near = (x: number) => Math.abs(ratio - x) <= 0.04;
  if (near(0.5)) return "Half the";
  if (near(1 / 3)) return "A third of the";
  if (near(0.25)) return "A quarter of the";
  if (near(0.2)) return "A fifth of the";
  return `${Math.round((1 - ratio) * 100)}% less`;
}

/**
 * Highlight wording for a route that meaningfully reduces hazard ground vs. the reference
 * (≥ 25% and ≥ 10 m less), e.g. "Half the hazardous ground for +1 min". null otherwise.
 */
export function hazardHighlight(r: RouteResult, ref: RouteResult): string | null {
  const share = hazardShareOf(r, ref);
  if (!share) return null;
  const what = `${share} hazardous ground`;
  const m = Math.round((r.totals.totalTimeS - ref.totals.totalTimeS) / 60);
  const cost = m <= 0 ? (m < 0 ? `and ${Math.abs(m)} min faster` : "at no extra time") : `for +${m} min`;
  return `${what} ${cost}`;
}

function hazardShareOf(r: RouteResult, ref: RouteResult): string | null {
  const h0 = ref.totals.hazardM;
  const h1 = r.totals.hazardM;
  if (h0 < 10 || h0 - h1 < 10) return null;
  const ratio = h1 / h0;
  if (ratio > 0.75) return null;
  return hazardShare(ratio);
}

/** Compact chip text for the same highlight, e.g. "Half the hazard", "62% less hazard". null otherwise. */
export function hazardChip(r: RouteResult, ref: RouteResult): string | null {
  const share = hazardShareOf(r, ref);
  if (!share) return null;
  return share === "Avoids almost all" ? "Almost no hazard" : `${share} hazard`;
}
