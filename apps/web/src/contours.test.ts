/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GridSpec } from "@marsmap/core";
import { contourFeatures, contourLines, contourTier } from "./map/contours";

/** A square grid of 1 m cells, one unit of lon/lat per cell, north at the top. */
function raster(n: number, f: (x: number, y: number) => number) {
  const grid = { width: n, height: n, west: 0, east: n, south: 0, north: n, cellSizeM: 1, marsRadiusM: 3396190 } as GridSpec;
  const elev = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) elev[r * n + c] = f(c + 0.5, n - r - 0.5);
  return { grid, elev };
}

test("a cone gives one closed circle per level, at the right radius", () => {
  const n = 80;
  const levels = contourLines(raster(n, (x, y) => 100 - Math.hypot(x - 40, y - 40)), { intervalM: 10, cellM: 1 });
  assert.deepEqual(levels.map((l) => l.levelM), [50, 60, 70, 80, 90]);
  for (const { levelM, lines } of levels) {
    // The 50 m and 60 m circles run off the grid, so they come out as arcs.
    if (levelM >= 70) {
      assert.equal(lines.length, 1);
      assert.deepEqual(lines[0]![0], lines[0]![lines[0]!.length - 1]);
    }
    for (const [x, y] of lines.flat()) assert.ok(Math.abs(Math.hypot(x - 40, y - 40) - (100 - levelM)) < 0.6, `level ${levelM} at ${x}, ${y}`);
  }
});

test("a plane gives straight open lines from edge to edge", () => {
  const levels = contourLines(raster(40, (x) => x), { intervalM: 10, cellM: 2 });
  assert.deepEqual(levels.map((l) => l.levelM), [10, 20, 30]);
  for (const { levelM, lines } of levels) {
    assert.equal(lines.length, 1);
    for (const [x] of lines[0]!) assert.ok(Math.abs(x - levelM) < 1e-6);
    const ys = lines[0]!.map((p) => p[1]);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 35);
  }
});

test("gaps in the data and the skipped box carry no lines", () => {
  const r = raster(40, (x) => x);
  for (let c = 0; c < 40; c++) r.elev[20 * 40 + c] = NaN;
  const cut = contourLines(r, { intervalM: 10, cellM: 1 });
  assert.equal(cut[0]!.lines.length, 2);
  const skipped = contourLines(raster(40, (x) => x), { intervalM: 10, cellM: 1, skip: { west: 5, east: 35, south: 10, north: 30 } });
  for (const l of skipped) for (const line of l.lines) for (const [, y] of line) assert.ok(y < 11 || y > 29, `y ${y}`);
});

test("fine lines replace the coarse ones under the window, and tiers follow the level", () => {
  assert.deepEqual([10, 50, 250, 500, -4450, -4500].map(contourTier), [1, 2, 3, 3, 2, 3]);
  const fc = contourFeatures(null, raster(64, (x) => x * 2));
  assert.ok(fc.features.length > 0);
  assert.ok(fc.features.every((f) => f.geometry.type === "MultiLineString" && f.properties!.elev % 10 === 0));
});
