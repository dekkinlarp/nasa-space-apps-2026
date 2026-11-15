import test from "node:test";
import assert from "node:assert/strict";
import type { LonLat, RouteResult } from "@marsmap/core";
import { M_PER_DEG_LAT } from "./geo";
import { ROUTE_TICK_M, routeTickFeatures, slopeState } from "./map/routeSlope";

const LAT0 = -4.8, LON0 = 137.38;
/** A straight path north from (LON0, lat) for `m` metres. */
const north = (fromM: number, m: number): LonLat[] => [0, 0.25, 0.5, 0.75, 1].map((k) => [LON0, LAT0 + (fromM + m * k) / M_PER_DEG_LAT] as LonLat);
const route = (...legs: LonLat[][]) => ({ segments: legs.map((path) => ({ path })) }) as unknown as RouteResult;

test("a tick every 100 m, none at the start", () => {
  const fc = routeTickFeatures(route(north(0, 350)));
  assert.equal(ROUTE_TICK_M, 100);
  assert.equal(fc.features.length, 3);
  fc.features.forEach((f, i) => {
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    assert.equal(lon, LON0);
    assert.ok(Math.abs((lat - LAT0) * M_PER_DEG_LAT - (i + 1) * 100) < 0.01);
    assert.equal(f.properties!.m, (i + 1) * 100);
  });
});

test("the count runs on across stops", () => {
  // 150 m then 120 m: ticks at 100 and 200 along the whole walk, the second 50 m into the second leg.
  const fc = routeTickFeatures(route(north(0, 150), north(150, 120)));
  assert.deepEqual(fc.features.map((f) => f.properties!.m), [100, 200]);
  const lat = ((fc.features[1]!.geometry as GeoJSON.Point).coordinates as [number, number])[1];
  assert.ok(Math.abs((lat - LAT0) * M_PER_DEG_LAT - 200) < 0.01);
});

test("a tick carries the heading of the route there", () => {
  const east: LonLat[] = [[LON0, LAT0], [LON0 + 0.01, LAT0]];
  assert.ok(Math.abs(routeTickFeatures(route(north(0, 250))).features[0]!.properties!.rot) < 0.01);
  assert.ok(Math.abs(routeTickFeatures(route(east)).features[0]!.properties!.rot - 90) < 0.01);
});

test("no route, no ticks", () => {
  assert.equal(routeTickFeatures(null).features.length, 0);
  assert.equal(routeTickFeatures(route(north(0, 60))).features.length, 0);
});

test("slope is clear, then hazard from the caution slope, then no-go in the last degree", () => {
  const p = { cautionSlopeDeg: 15, maxSlopeDeg: 20 };
  assert.equal(slopeState(4, p), "clear");
  assert.equal(slopeState(14.9, p), "clear");
  assert.equal(slopeState(15, p), "caution");
  assert.equal(slopeState(18.9, p), "caution");
  assert.equal(slopeState(19, p), "nogo");
});
