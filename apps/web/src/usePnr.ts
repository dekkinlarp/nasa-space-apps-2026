import { useMemo } from "react";
import { selectedResult, useStore } from "./store";
import { routePoints } from "./engine";
import { cellIndex } from "./geo";
import { computePnr, type PnrResult, type ReturnLookup } from "./pnr";

/** Point of no return for the selected route (see pnr.ts for the approximation). */
export function usePnr(): PnrResult | null {
  const results = useStore((s) => s.results);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const start = useStore((s) => s.start);
  const stops = useStore((s) => s.stops);
  const returnToStart = useStore((s) => s.returnToStart);
  const params = useStore((s) => s.params);
  const reach = useStore((s) => s.reach);
  const r = selectedResult({ results, selectedProfile });
  const dwellKey = stops.map((s) => s.dwellS).join(",");
  return useMemo(() => {
    if (!r || !params || !start || !r.reachable) return null;
    const rp = routePoints(start, stops, returnToStart);
    if (!rp) return null;
    // Only trust the reach field if it was flooded from the current start.
    const sameStart = reach && reach.start[0] === start.lonLat[0] && reach.start[1] === start.lonLat[1];
    const grid = reach?.grid;
    const lookup: ReturnLookup | null =
      sameStart && grid
        ? {
            timeS: (p) => {
              const i = cellIndex(grid, p);
              return i == null ? undefined : reach.backTimeS[i];
            },
            energyKJ: (p) => {
              const i = cellIndex(grid, p);
              return i == null ? undefined : reach.backEnergyKJ[i];
            },
          }
        : null;
    return computePnr({ result: r, dwellS: rp.dwellS, params, loopsHome: returnToStart, reach: lookup });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, params, start, dwellKey, returnToStart, reach]);
}

export const PNR_METHOD_NOTE =
  "Estimate: we step along the route adding up walking time and time at stops already passed. At each point the time home is the best of " +
  "the cheapest path home from the walk-limit flood (reach field), retracing your steps (same time as the way out; real uphill/downhill differ), " +
  "or, for loop plans, finishing the loop without more stop work. The point of no return is where elapsed time + time home first exceeds the usable " +
  "time or energy (limit minus reserve). Model estimates on a 2 m grid, not a flight rule.";
