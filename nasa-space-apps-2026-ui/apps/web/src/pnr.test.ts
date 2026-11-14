/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LonLat, RouteResult, RouteSegment, WalkParams } from "@marsmap/core";
import { computePnr } from "./pnr";
import { M_PER_DEG_LAT } from "./geo";

const params = { evaLimitS: 10800, reserveFraction: 1 / 6, energyBudgetKJ: 1e9, dwellMetabolicW: 0 } as WalkParams; // usable 9000 s
const east = (m: number): LonLat => [m / M_PER_DEG_LAT, 0];

function seg(a: number, b: number, timeS: number): RouteSegment {
  const n = 20;
  const path = Array.from({ length: n + 1 }, (_, i) => east(a + ((b - a) * i) / n));
  return { from: path[0]!, to: path[n]!, path, distanceM: Math.abs(b - a), timeS, energyKJ: timeS * 0.3, ascentM: 0, descentM: 0, avgSlopeDeg: 0, maxSlopeDeg: 0, surfaceMix: {}, hazardM: 0, profile: [] };
}
const route = (segments: RouteSegment[]) => ({ segments, reachable: true }) as unknown as RouteResult;

test("loop that fits has no point of no return", () => {
  const r = computePnr({ result: route([seg(0, 1000, 1000), seg(1000, 0, 1000)]), dwellS: [0, 3600, 0], params, loopsHome: true })!;
  assert.equal(r.kind, "clear");
  assert.ok(r.marginS > 0);
});

test("long dwell puts the PNR at the stop, usable minus the walk home", () => {
  const r = computePnr({ result: route([seg(0, 1000, 1000), seg(1000, 0, 1000)]), dwellS: [0, 8000, 0], params, loopsHome: true })!;
  assert.equal(r.kind, "pnr");
  assert.ok(r.atStop);
  assert.ok(Math.abs(r.elapsedS - 8000) < 1, `elapsed ${r.elapsedS}`);
});

test("one-way walk: retrace gives PNR halfway through the usable time", () => {
  const r = computePnr({ result: route([seg(0, 6000, 6000)]), dwellS: [0, 0], params, loopsHome: false })!;
  assert.equal(r.kind, "pnr");
  assert.ok(Math.abs(r.elapsedS - 4500) < 5, `elapsed ${r.elapsedS}`);
  assert.ok(Math.abs(r.alongM - 4500) < 10, `along ${r.alongM}`);
});

test("reach field shortcut moves the PNR further out", () => {
  // Pretend the way home is always 1000 s regardless of position.
  const reach = { timeS: () => 1000, energyKJ: () => 0 };
  const r = computePnr({ result: route([seg(0, 9500, 9500)]), dwellS: [0, 0], params, loopsHome: false, reach })!;
  assert.equal(r.kind, "pnr");
  assert.ok(Math.abs(r.elapsedS - 8000) < 5, `elapsed ${r.elapsedS}`);
  assert.equal(r.returnMethod, "path home");
});
