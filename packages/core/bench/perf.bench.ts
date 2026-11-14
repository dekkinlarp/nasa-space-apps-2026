/**
 * Timing benchmark on a synthetic 1500 x 1500 fractal terrain, plus a smoke route on the real
 * data if data/gale-boxwork/layers.json exists. Run: pnpm --filter @marsmap/core bench
 * Prints timings; only loose sanity assertions.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import surfaceConfig from "../../../config/surface-classes.json";
import {
  computeReach,
  computeSlope,
  createCostModel,
  DEFAULT_PROFILES,
  DEFAULT_WALK_PARAMS,
  loadLayers,
  planRoute,
  planRouteAlternatives,
  reachRings,
  type LayerManifest,
  type Layers,
  type LonLat,
} from "../src/index";
import { at, makeGrid } from "../test/helpers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const P = { ...DEFAULT_WALK_PARAMS };

function fractalLayers(N: number): Layers {
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grid = makeGrid(N, N, 2);
  const elevation = new Float32Array(N * N);
  // Sum of value-noise octaves: wavelengths 1024 m .. 8 m, amplitude ~ wavelength^1.15.
  for (let o = 0; o < 8; o++) {
    const cells = 4 << o; // lattice cells across the grid
    const amp = 40 / Math.pow(2, o * 1.15);
    const L = cells + 2;
    const lat = new Float32Array(L * L).map(() => rnd() * 2 - 1);
    const step = N / cells;
    for (let r = 0; r < N; r++) {
      const fy = r / step, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let c = 0; c < N; c++) {
        const fx = c / step, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const a = lat[y0 * L + x0]!, b = lat[y0 * L + x0 + 1]!, cc = lat[(y0 + 1) * L + x0]!, d = lat[(y0 + 1) * L + x0 + 1]!;
        elevation[r * N + c]! += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (cc * (1 - sx) + d * sx) * sy);
      }
    }
  }
  const surface = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const h = elevation[i]!;
    surface[i] = h < -18 ? 3 : h > 22 ? 4 : (i * 2654435761) % 7 === 0 ? 2 : 1;
  }
  return { grid, elevation, slope: computeSlope(grid, elevation), surface, surfaceClasses: surfaceConfig.classes };
}

function time<T>(label: string, f: () => T): T {
  const t0 = performance.now();
  const r = f();
  console.log(`${label.padEnd(48)} ${(performance.now() - t0).toFixed(0).padStart(6)} ms`);
  return r;
}

it("synthetic 1500 x 1500 benchmark", () => {
  const N = 1500;
  const layers = time("generate fractal terrain + slope", () => fractalLayers(N));
  let steep = 0;
  for (const s of layers.slope) if (s > P.maxSlopeDeg) steep++;
  console.log(`  cells over ${P.maxSlopeDeg} deg: ${((100 * steep) / (N * N)).toFixed(1)}%`);
  const model = time("createCostModel", () => createCostModel(layers, P));
  const a: LonLat = at(layers, 750, 300), b: LonLat = at(layers, 750, 1050), c: LonLat = at(layers, 300, 900);
  for (const prof of DEFAULT_PROFILES) {
    const r = time(`planRoute ${prof.id} 1.5 km`, () => planRoute(layers, P, prof, [a, b], undefined, { model }));
    const s = r.segments[0]!;
    console.log(
      `  reachable=${r.reachable} dist=${s.distanceM.toFixed(0)} m time=${(s.timeS / 60).toFixed(1)} min energy=${s.energyKJ.toFixed(0)} kJ hazard=${s.hazardM.toFixed(0)} m verts=${s.path.length}`,
    );
  }
  time("planRouteAlternatives a->b->c->a (3 x 3 legs)", () => planRouteAlternatives(layers, P, [a, b, c, a], undefined, { model }));
  const reach = time("computeReach (2 full floods)", () => computeReach(layers, P, DEFAULT_PROFILES[0]!, a, { model }));
  const rings = time("reachRings 1 h / 2 h / 5 h", () => reachRings(layers.grid, reach, [3600, 7200, 18000]));
  for (const r of rings) {
    const verts = r.coordinates.reduce((n, poly) => n + poly.reduce((m, ring) => m + ring.length, 0), 0);
    console.log(`  ${r.label}: ${r.coordinates.length} polygons, ${verts} vertices`);
  }
  expect(rings.length).toBe(3);
});

it("smoke route on real data (if present)", async () => {
  const dir = join(ROOT, "data/gale-boxwork");
  const manifestPath = join(dir, "layers.json");
  if (!existsSync(manifestPath)) {
    console.log(`no ${manifestPath}; skipping real-data smoke test`);
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as LayerManifest;
  const layers = await time("loadLayers (real)", () =>
    loadLayers(manifest, async (f) => {
      const b = readFileSync(join(dir, f));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    }, surfaceConfig.classes),
  );
  const g = layers.grid;
  const cLon = (g.west + g.east) / 2, cLat = (g.north + g.south) / 2;
  const dLon = (g.east - g.west) / 6, dLat = (g.north - g.south) / 6;
  const pts: LonLat[] = [[cLon - dLon, cLat], [cLon + dLon, cLat + dLat * 0.5], [cLon, cLat - dLat], [cLon - dLon, cLat]];
  const alts = await time("planRouteAlternatives (real, 3 legs)", async () => planRouteAlternatives(layers, P, pts));
  for (const r of alts) {
    const t = r.totals;
    console.log(
      `  ${r.profile.id}: reachable=${r.reachable} dist=${t.distanceM.toFixed(0)} m walk=${(t.walkTimeS / 60).toFixed(0)} min total=${(t.totalTimeS / 60).toFixed(0)} min energy=${t.energyKJ.toFixed(0)} kJ ascent=${t.ascentM.toFixed(0)} m hazard=${t.hazardM.toFixed(0)} m rad=${t.radiationMSv.toFixed(3)} mSv within=${t.withinLimits}`,
    );
  }
  const reach = time("computeReach (real)", () => computeReach(layers, P, DEFAULT_PROFILES[0]!, pts[0]!));
  const rings = time("reachRings (real)", () => reachRings(layers.grid, reach, [3600, 7200]));
  console.log(`  rings: ${rings.map((r) => `${r.label}=${r.coordinates.length} polys`).join(", ")}`);
});
