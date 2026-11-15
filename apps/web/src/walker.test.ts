/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LonLat, RouteResult, RouteSegment } from "@marsmap/core";
import { buildTimeline, positionAt } from "./lib";
import { M_PER_DEG_LAT } from "./geo";
import { cycleSeconds, headingAlong, lerpAngle, meanSpeed, routePrints, walkerFrame } from "./components/walkerMath";

const east = (m: number): LonLat => [m / M_PER_DEG_LAT, 0];
const north = (x: number, m: number): LonLat => [x / M_PER_DEG_LAT, m / M_PER_DEG_LAT];
const seg = (path: LonLat[], distanceM: number, timeS: number): RouteSegment =>
  ({ from: path[0]!, to: path[path.length - 1]!, path, distanceM, timeS, profile: [] }) as unknown as RouteSegment;
// 100 m east in 100 s, dwell 50 s, then 100 m north in 200 s (half speed).
const r = { segments: [seg([east(0), east(50), east(100)], 100, 100), seg([east(100), north(100, 50), north(100, 100)], 100, 200)] } as unknown as RouteResult;
const tl = buildTimeline(r, [0, 50, 0]);
const mean = meanSpeed(r);

test("walker state follows the timeline: walking, working at the stop, idle at the end", () => {
  const at = (e: number) => {
    const p = positionAt(tl, e);
    return walkerFrame(tl, r, e, p.seg, p.dwelling, p.along, mean);
  };
  assert.equal(at(50).state, "walking");
  const w = at(125);
  assert.equal(w.state, "working");
  assert.ok(Math.abs(w.dwellF - 0.5) < 1e-6 && Math.abs(w.dwellLeftS - 25) < 1e-6);
  assert.equal(at(1e6).state, "idle");
  // Second leg is walked at half the speed of the first.
  assert.ok(at(50).speedRatio > at(250).speedRatio * 1.9);
});

test("heading points along the route", () => {
  assert.ok(Math.abs(headingAlong(tl, 40, 6)! - 90) < 0.5);
  assert.ok(Math.abs(headingAlong(tl, 160, 6)! - 0) < 0.5 || Math.abs(headingAlong(tl, 160, 6)! - 360) < 0.5);
  assert.equal(Math.round(lerpAngle(350, 10, 0.5)), 0);
});

test("faster walking means a quicker stride; steep ground a slower one", () => {
  assert.ok(cycleSeconds(1.5, 0, 1) < cycleSeconds(1, 0, 1));
  assert.ok(cycleSeconds(1, 20, 1) > cycleSeconds(1, 0, 1));
});

test("boot prints stay put along the route as the walker advances, alternating sides", () => {
  const a = routePrints(tl, 40, 2, 0.3, 10), b = routePrints(tl, 40.5, 2, 0.3, 10);
  assert.deepEqual(a[0]!.p, b[0]!.p);
  assert.ok(a[0]!.fresh > a[5]!.fresh);
  assert.ok(Math.sign(a[0]!.p[1]) !== Math.sign(a[1]!.p[1]));
});
