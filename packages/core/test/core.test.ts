import { describe, expect, it } from "vitest";
import area from "../../../config/area.json";
import walkParamsJson from "../../../config/walk-params.json";
import {
  astar,
  cellToLonLat,
  computeReach,
  createCostModel,
  DEFAULT_PROFILES,
  DEFAULT_WALK_PARAMS,
  distanceM,
  loadLayers,
  lonLatToCell,
  pandolfSanteeW,
  planRoute,
  planRouteAlternatives,
  reachRings,
  samplePoint,
  type CostFactor,
  type GridSpec,
  type LayerManifest,
  type RouteProfile,
  type WalkParams,
} from "../src/index";
import { at, BEDROCK, CLASSES, makeLayers, SAND, toMetres } from "./helpers";

const P: WalkParams = { ...DEFAULT_WALK_PARAMS };
const profile = (id: string): RouteProfile => DEFAULT_PROFILES.find((p) => p.id === id)!;
const FASTEST = profile("fastest");
const SAFEST = profile("safest");
const EFFORT = profile("least-effort");

const gale: GridSpec = {
  id: area.id,
  south: area.south,
  north: area.north,
  west: area.west,
  east: area.east,
  width: area.width,
  height: area.height,
  cellSizeM: area.cellSizeM,
  marsRadiusM: area.marsRadiusM,
};

describe("params", () => {
  it("DEFAULT_WALK_PARAMS matches config/walk-params.json", () => {
    const { _sources, ...json } = walkParamsJson as typeof walkParamsJson & { _sources: Record<string, string> };
    expect({ ...DEFAULT_WALK_PARAMS }).toEqual(json);
    for (const k of Object.keys(json)) expect(_sources[k], `source for ${k}`).toBeTruthy();
  });
});

describe("grid", () => {
  it("lonLat <-> cell round trip", () => {
    for (const idx of [0, 1, 1499, 1500, 1125750, 1500 * 1500 - 1, 777777]) {
      const ll = cellToLonLat(gale, idx);
      expect(lonLatToCell(gale, ll)?.index).toBe(idx);
    }
    const nw = lonLatToCell(gale, [gale.west, gale.north]);
    expect(nw).toEqual({ row: 0, col: 0, index: 0 });
    const se = lonLatToCell(gale, [gale.east, gale.south]);
    expect(se?.index).toBe(1500 * 1500 - 1);
    expect(lonLatToCell(gale, [gale.west - 1e-6, gale.north])).toBeNull();
    expect(lonLatToCell(gale, [NaN, 0])).toBeNull();
  });

  it("distanceM matches the 3 km demo square", () => {
    const lat = (gale.north + gale.south) / 2;
    expect(distanceM(gale, [gale.west, gale.south], [gale.west, gale.north])).toBeCloseTo(3000, -1);
    expect(distanceM(gale, [gale.west, lat], [gale.east, lat])).toBeCloseTo(3000, -1);
    // Neighbouring cell centres are one cell apart.
    expect(distanceM(gale, cellToLonLat(gale, 0), cellToLonLat(gale, 1))).toBeCloseTo(2, 1);
  });

  it("samplePoint reads rasters and is null outside", () => {
    const L = makeLayers(10, 10, (r, c) => r * 10 + c, (r) => (r < 5 ? BEDROCK : SAND));
    expect(samplePoint(L, at(L, 7, 3))).toEqual({ elevationM: 73, slopeDeg: expect.any(Number), surfaceId: SAND });
    expect(samplePoint(L, [0, 50])).toBeNull();
  });
});

describe("cost model", () => {
  it("Pandolf/Santee behaves: uphill > flat, steep downhill > gentle downhill, Mars < Earth", () => {
    const flat = pandolfSanteeW(82, 104, 1, 0, 1, 3.71);
    expect(pandolfSanteeW(82, 104, 1, 10, 1, 3.71)).toBeGreaterThan(flat);
    expect(pandolfSanteeW(82, 104, 1, -30, 1, 3.71)).toBeGreaterThan(pandolfSanteeW(82, 104, 1, -5, 1, 3.71));
    expect(flat).toBeLessThan(pandolfSanteeW(82, 104, 1, 0, 1, 9.80665));
    expect(pandolfSanteeW(82, 104, 1, 0, 2.1, 3.71)).toBeGreaterThan(flat);
    // Sanity range for a suited walk at 1 m/s on Mars: a few hundred watts.
    expect(flat).toBeGreaterThan(250);
    expect(flat).toBeLessThan(700);
  });

  it("stepCost is direction-aware and blocks steep steps", () => {
    const tilt = Math.tan((8 * Math.PI) / 180) * 2; // 8 deg per 2 m row
    const L = makeLayers(5, 5, (r) => -r * tilt);
    const m = createCostModel(L, P);
    const up = m.stepCost(3 * 5 + 2, 2 * 5 + 2, 2)!; // north = uphill
    const down = m.stepCost(2 * 5 + 2, 3 * 5 + 2, 2)!;
    expect(up.timeS).toBeGreaterThan(down.timeS);
    expect(up.energyKJ).toBeGreaterThan(down.energyKJ);
    const steep = makeLayers(5, 5, (r) => -r * Math.tan((25 * Math.PI) / 180) * 2);
    expect(createCostModel(steep, P).stepCost(12, 7, 2)).toBeNull();
  });

  it("extraFactors can add cost or ban cells", () => {
    const L = makeLayers(20, 20);
    const radiation: CostFactor = {
      id: "test-radiation",
      apply(s) {
        s.extraEnergyKJ += 1;
      },
    };
    const base = createCostModel(L, P).stepCost(0, 1, 2)!;
    const more = createCostModel(L, P, [radiation]).stepCost(0, 1, 2)!;
    expect(more.energyKJ).toBeCloseTo(base.energyKJ + 1);
    const noGo: CostFactor = {
      id: "no-go",
      apply(s) {
        if (s.to % 20 === 10) s.blocked = true;
      },
      blocksCell: (_l, _p, i) => i % 20 === 10,
    };
    const r = planRoute(L, P, FASTEST, [at(L, 10, 2), at(L, 10, 18)], undefined, { extraFactors: [noGo] });
    expect(r.reachable).toBe(false);
  });
});

describe("routing", () => {
  it("flat grid: straight line, distance and time", () => {
    const L = makeLayers(100, 100);
    const r = planRoute(L, P, FASTEST, [at(L, 50, 10), at(L, 50, 90)]);
    expect(r.reachable).toBe(true);
    const s = r.segments[0]!;
    expect(s.distanceM).toBeCloseTo(160, 6);
    expect(s.timeS).toBeCloseTo(160 / P.baseSpeedMps, 6);
    const w = pandolfSanteeW(P.bodyMassKg, P.suitMassKg, P.baseSpeedMps, 0, 1, P.gravity);
    expect(s.energyKJ).toBeCloseTo((w * 160) / 1000, 6);
    expect(s.path.length).toBe(2); // straight line simplifies to its end points
    expect(s.ascentM).toBe(0);
    expect(s.surfaceMix[BEDROCK]).toBeCloseTo(1);
    expect(s.profile.length).toBe(81); // one point per cell when short
    // Dwell at the destination (it is not the start) and radiation.
    expect(r.totals.totalTimeS).toBeCloseTo(160 + P.stopDwellS, 6);
    expect(r.totals.radiationMSv).toBeCloseTo(((160 + P.stopDwellS) / 86400) * 0.67, 9);
    expect(r.totals.withinLimits).toBe(true);
    expect(r.totals.limitingFactor).toBeNull();
  });

  it("long segments sample at most 300 profile points", () => {
    const L = makeLayers(800, 10);
    const s = planRoute(L, P, FASTEST, [at(L, 5, 0), at(L, 5, 799)]).segments[0]!;
    expect(s.profile.length).toBe(300);
    expect(s.profile.at(-1)!.distanceM).toBeCloseTo(1598);
  });

  it("a wall of steep slope forces a detour through the gap", () => {
    // 60 m high block in columns 45-54, rows 0-79; gap in rows 80-99.
    const L = makeLayers(100, 100, (r, c) => (c >= 45 && c <= 54 && r < 80 ? 60 : 0));
    const r = planRoute(L, P, FASTEST, [at(L, 20, 20), at(L, 20, 80)]);
    expect(r.reachable).toBe(true);
    const s = r.segments[0]!;
    expect(s.distanceM).toBeGreaterThan(180);
    const southmost = Math.min(...s.path.map((p) => p[1]));
    expect(lonLatToCell(L.grid, [s.path[0]![0], southmost])!.row).toBeGreaterThanOrEqual(80);
    expect(s.maxSlopeDeg).toBeLessThanOrEqual(P.maxSlopeDeg);
  });

  it("uphill costs more than downhill, so out != back", () => {
    const tilt = Math.tan((10 * Math.PI) / 180) * 2;
    const L = makeLayers(60, 60, (r) => -r * tilt); // north is higher
    const north = at(L, 10, 30), south = at(L, 50, 30);
    const up = planRoute(L, P, FASTEST, [south, north]).segments[0]!;
    const down = planRoute(L, P, FASTEST, [north, south]).segments[0]!;
    expect(up.timeS).toBeGreaterThan(down.timeS);
    expect(up.energyKJ).toBeGreaterThan(down.energyKJ);
    expect(up.ascentM).toBeCloseTo(down.descentM, 3);
    const reach = computeReach(L, P, FASTEST, south);
    const i = 10 * 60 + 30;
    expect(reach.outTimeS[i]).toBeCloseTo(up.timeS, 2);
    expect(reach.backTimeS[i]).toBeCloseTo(down.timeS, 2);
    expect(reach.outTimeS[i]).not.toBeCloseTo(reach.backTimeS[i]!, 0);
  });

  it("sand patch: crossed by fastest, avoided by safest", () => {
    // Thin (10-cell) but tall (rows 10-89) sand band across the straight line.
    const L = makeLayers(100, 100, () => 0, (r, c) => (c >= 45 && c < 55 && r >= 10 && r < 90 ? SAND : BEDROCK));
    const pts = [at(L, 50, 10), at(L, 50, 90)];
    const [fast, effort, safe] = planRouteAlternatives(L, P, pts);
    expect(fast!.profile.id).toBe("fastest");
    expect(effort!.profile.id).toBe("least-effort");
    expect(fast!.segments[0]!.hazardM).toBeGreaterThan(15);
    expect(fast!.segments[0]!.surfaceMix[SAND]).toBeGreaterThan(0.05);
    expect(safe!.segments[0]!.hazardM).toBe(0);
    expect(safe!.segments[0]!.distanceM).toBeGreaterThan(fast!.segments[0]!.distanceM);
    expect(fast!.totals.walkTimeS).toBeLessThan(safe!.totals.walkTimeS);
  });

  it("A* with heuristic matches Dijkstra on rough terrain", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bumps = Array.from({ length: 12 }, () => [rnd() * 120, rnd() * 120, 2 + rnd() * 6, 4 + rnd() * 10] as const);
    const L = makeLayers(
      120,
      120,
      (r, c) => bumps.reduce((z, [br, bc, h, w]) => z + h * Math.exp(-((r - br) ** 2 + (c - bc) ** 2) / (w * w)), 0),
      (r, c) => ((r * 7 + c * 13) % 23 === 0 ? SAND : ((r + c) % 17 === 0 ? 4 : BEDROCK)),
    );
    const m = createCostModel(L, P);
    const graph = { width: 120, height: 120, cellSizeM: 2, blocked: m.blocked };
    for (const prof of DEFAULT_PROFILES) {
      const edge = m.edgeCost(prof);
      const h = m.minCostPerMetre(prof);
      expect(h).toBeGreaterThan(0);
      const a = astar(graph, edge, 5 * 120 + 5, 110 * 120 + 100, h);
      const d = astar(graph, edge, 5 * 120 + 5, 110 * 120 + 100, 0);
      expect(a.cost).toBeCloseTo(d.cost, 6);
      expect(a.expanded).toBeLessThanOrEqual(d.expanded);
    }
  });

  it("unreachable stops are flagged and the rest is still planned", () => {
    // Steep moat (ring of 50 m deep cells) around the centre.
    const L = makeLayers(80, 80, (r, c) => {
      const d = Math.hypot(r - 40, c - 40);
      return d >= 8 && d <= 12 ? -50 : 0;
    });
    const r = planRoute(L, P, FASTEST, [at(L, 5, 5), at(L, 40, 40), at(L, 70, 70), [10, 10]]);
    expect(r.reachable).toBe(false);
    expect(r.unreachableStops).toEqual([1, 3]);
    expect(r.segments.map((s) => s.reachable)).toEqual([false, true, false]);
    expect(r.segments[1]!.from).toEqual(at(L, 5, 5)); // re-planned from the last reached stop
    expect(r.totals.withinLimits).toBe(false);

    const ok = planRoute(L, P, FASTEST, [at(L, 5, 5), at(L, 70, 70), at(L, 40, 40)]);
    expect(ok.segments[0]!.reachable).toBe(true);
    expect(ok.segments[1]!.reachable).toBe(false);
    expect(ok.segments[0]!.distanceM).toBeGreaterThan(0);
    expect(ok.unreachableStops).toEqual([2]);
  });

  it("dwell defaults: none at start, none on return to start", () => {
    const L = makeLayers(50, 50);
    const a = at(L, 10, 10), b = at(L, 10, 40);
    const r = planRoute(L, P, FASTEST, [a, b, a]);
    expect(r.totals.totalTimeS - r.totals.walkTimeS).toBeCloseTo(P.stopDwellS);
    expect(r.totals.dwellEnergyKJ).toBeCloseTo((P.stopDwellS * P.dwellMetabolicW!) / 1000);
    const custom = planRoute(L, P, FASTEST, [a, b, a], [100, 200, 300]);
    expect(custom.totals.totalTimeS - custom.totals.walkTimeS).toBeCloseTo(600);
  });

  it("limits flagging: time and energy", () => {
    const L = makeLayers(300, 20);
    const pts = [at(L, 10, 5), at(L, 10, 150), at(L, 10, 295)];
    const dwell = [0, 0, 0];
    // Each segment is 290 m (~290 s). Usable time 400 s -> second segment breaks it.
    const tight: WalkParams = { ...P, evaLimitS: 400 / (1 - P.reserveFraction) };
    const t = planRoute(L, tight, FASTEST, pts, dwell);
    expect(t.totals.withinLimits).toBe(false);
    expect(t.totals.firstSegmentOverLimit).toBe(1);
    expect(t.totals.limitingFactor).toBe("time");
    const e1 = t.segments[0]!.energyKJ;
    const lowEnergy: WalkParams = { ...P, energyBudgetKJ: (e1 * 0.5) / (1 - P.reserveFraction) };
    const e = planRoute(L, lowEnergy, FASTEST, pts, dwell);
    expect(e.totals.firstSegmentOverLimit).toBe(0);
    expect(e.totals.limitingFactor).toBe("energy");
    expect(e.totals.energyUsedFraction).toBeGreaterThan(1);
    const fine = planRoute(L, P, EFFORT, pts, dwell);
    expect(fine.totals.withinLimits).toBe(true);
    expect(fine.totals.firstSegmentOverLimit).toBeNull();
  });
});

describe("reach", () => {
  it("flat grid ring is roughly a circle of the expected radius", () => {
    const L = makeLayers(161, 161);
    const start = at(L, 80, 80);
    const reach = computeReach(L, P, FASTEST, start);
    expect(reach.outTimeS[80 * 161 + 80]).toBe(0);
    const budget = 200; // 100 s out + 100 s back at 1 m/s -> 100 m radius
    const [ring] = reachRings(L.grid, reach, [budget]);
    expect(ring!.budgetS).toBe(budget);
    expect(ring!.coordinates.length).toBe(1);
    const outer = ring!.coordinates[0]![0]!;
    expect(outer[0]).toEqual(outer.at(-1)); // closed
    const xy = outer.map((p) => toMetres(L.grid, start, p));
    let a = 0;
    for (let i = 0; i + 1 < xy.length; i++) a += xy[i]![0] * xy[i + 1]![1] - xy[i + 1]![0] * xy[i]![1];
    a /= 2;
    expect(a).toBeGreaterThan(0); // counter-clockwise outer ring
    const rEq = Math.sqrt(a / Math.PI);
    expect(rEq).toBeGreaterThan(90);
    expect(rEq).toBeLessThan(105);
    for (const [x, y] of xy) {
      const d = Math.hypot(x, y);
      expect(d).toBeGreaterThan(85);
      expect(d).toBeLessThan(104);
    }
  });

  it("rings have holes around impassable ground and nest by budget", () => {
    const L = makeLayers(121, 121, (r, c) => (r >= 55 && r <= 65 && c >= 85 && c <= 95 ? NaN : 0));
    const start = at(L, 60, 60);
    const reach = computeReach(L, P, FASTEST, start);
    expect(reach.outTimeS[60 * 121 + 90]).toBe(Infinity);
    const rings = reachRings(L.grid, reach, [60, 200]);
    expect(rings[0]!.coordinates[0]!.length).toBe(1);
    const big = rings[1]!.coordinates;
    expect(big.length).toBe(1);
    expect(big[0]!.length).toBe(2); // outer + hole
    expect(rings[1]!.label).toBe("3 min round trip");
  });

  it("unreachable start gives an all-Infinity field and no rings", () => {
    const L = makeLayers(20, 20);
    const reach = computeReach(L, P, FASTEST, [0, 60]);
    expect(reach.outTimeS.every((v) => v === Infinity)).toBe(true);
    expect(reachRings(L.grid, reach, [600])[0]!.coordinates).toEqual([]);
  });
});

describe("loadLayers", () => {
  it("reads layers by id, maps nodata, computes missing slope", async () => {
    const L = makeLayers(8, 6, (r, c) => r + c * 0.5);
    const elev = new Float32Array(L.elevation);
    elev[3] = -9999;
    const files: Record<string, ArrayBuffer> = { "elevation.f32": elev.buffer, "surface.u8": L.surface.buffer as ArrayBuffer };
    const manifest: LayerManifest = {
      grid: L.grid,
      layers: [
        { id: "elevation", file: "elevation.f32", dtype: "float32", units: "m", nodata: -9999, source: "", method: "", version: "1", estimated: false },
        { id: "surface", file: "surface.u8", dtype: "uint8", units: "class", source: "", method: "", version: "1", estimated: true },
      ],
      imagery: [],
      generatedAt: "",
    };
    const loaded = await loadLayers(manifest, async (f) => files[f]!, CLASSES);
    expect(Number.isNaN(loaded.elevation[3])).toBe(true);
    expect(loaded.slope.length).toBe(48);
    expect(loaded.slope[20]).toBeCloseTo(L.slope[20]!, 5);
    expect(loaded.surface[0]).toBe(BEDROCK);
    await expect(loadLayers({ ...manifest, layers: [] }, async () => new ArrayBuffer(0), CLASSES)).rejects.toThrow();
  });
});
