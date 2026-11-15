import { describe, expect, it } from "vitest";
import {
  chooseWindow,
  decodeRaster,
  encodeValues,
  loadWindowLayers,
  readLayerWindow,
  windowGrid,
  type GridSpec,
  type LayerCodec,
  type LayerEntry,
  type LayerManifest,
} from "../src";

const ELEV: LayerCodec = { kind: "int16", scale: 0.02, offset: -4000, delta: true, deflate: true };
const U8: LayerCodec = { kind: "uint8", deflate: true };

const grid: GridSpec = { id: "t", west: 137, east: 137.01, south: -4.01, north: -4, width: 8, height: 8, cellSizeM: 2, marsRadiusM: 3396190 };
/** zlib-deflate (what the pipeline writes with node:zlib deflateSync). */
const deflate = async (u: Uint8Array): Promise<ArrayBuffer> =>
  new Response(new Blob([u as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();

describe("tile codec", () => {
  it("round-trips int16 deltas with nodata and wrapping differences", async () => {
    const w = 5, h = 3;
    const v = Float32Array.from([-4000, -3999.98, NaN, -3400.5, -4600, -4100.02, -4100, -4100.04, NaN, NaN, -3345, -4655, -3345, -4655, -4000]);
    const out = (await decodeRaster(await deflate(encodeValues(v, ELEV, w)), { id: "e", dtype: "float32", codec: ELEV }, w, h)) as Float32Array;
    for (let i = 0; i < v.length; i++) {
      if (Number.isNaN(v[i]!)) expect(out[i]).toBeNaN();
      else expect(out[i]).toBeCloseTo(v[i]!, 1);
    }
  });

  it("round-trips uint8", async () => {
    const v = Uint8Array.from([0, 1, 2, 3, 4, 200, 255, 7, 9]);
    const out = await decodeRaster(await deflate(encodeValues(v, U8, 3)), { id: "s", dtype: "uint8", codec: U8 }, 3, 3);
    expect([...out]).toEqual([...v]);
  });
});

describe("planning window", () => {
  const tiles = { size: 2, cols: 4, rows: 4, present: "1111111111111111" };

  it("builds the window's grid from whole tiles", () => {
    const g = windowGrid(grid, 2, { row0: 1, col0: 2, rows: 2, cols: 2 });
    expect(g.width).toBe(4);
    expect(g.west).toBeCloseTo(137.005, 9);
    expect(g.east).toBeCloseTo(137.01, 9);
    expect(g.north).toBeCloseTo(-4.0025, 9);
    expect(g.south).toBeCloseTo(-4.0075, 9);
  });

  it("keeps the current window while points stay inside its margin, and recentres otherwise", () => {
    const opts = { sideM: 8, marginM: 2 }; // 2 x 2 tiles, 1-cell margin
    const cur = { row0: 1, col0: 1, rows: 2, cols: 2 };
    const centre: [number, number] = [137.005, -4.005];
    expect(chooseWindow(grid, tiles, [centre], cur, opts)).toEqual({ win: cur, fits: true });
    const east: [number, number] = [137.0095, -4.005];
    const moved = chooseWindow(grid, tiles, [east], cur, opts);
    expect(moved.win.col0).toBe(2);
    expect(moved.fits).toBe(true);
    const far = chooseWindow(grid, tiles, [[137.0005, -4.0005], [137.0095, -4.0095]], null, opts);
    expect(far.fits).toBe(false);
  });

  it("reads a window across tiles, with missing tiles as nodata", async () => {
    const T = 2;
    const full = new Float32Array(64).map((_, i) => -4000 + i);
    const files = new Map<string, ArrayBuffer>();
    const present = "1110" + "1111" + "1111" + "1111";
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        const t = new Float32Array(T * T);
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) t[y * T + x] = full[(r * T + y) * 8 + c * T + x]!;
        files.set(`tiles/elevation/${r}_${c}.bin`, await deflate(encodeValues(t, ELEV, T)));
      }
    const entry: LayerEntry = {
      id: "elevation",
      file: "tiles/elevation/{r}_{c}.bin",
      dtype: "float32",
      units: "m",
      source: "",
      method: "",
      version: "1",
      estimated: false,
      codec: ELEV,
      tiles: { size: T, cols: 4, rows: 4, present },
    };
    const fetchBinary = async (f: string) => files.get(f)!;
    const win = { row0: 0, col0: 2, rows: 2, cols: 2 };
    const out = (await readLayerWindow(entry, grid, win, fetchBinary)) as Float32Array;
    expect(out.length).toBe(16);
    // Row 0 of the window: cells 4..7 of the full grid; tile (0, 3) is absent.
    expect(out[0]).toBeCloseTo(-3996, 1);
    expect(out[1]).toBeCloseTo(-3995, 1);
    expect(out[2]).toBeNaN();
    expect(out[3 * 4 + 3]).toBeCloseTo(full[3 * 8 + 7]!, 1);

    const manifest: LayerManifest = { grid, layers: [entry], imagery: [], generatedAt: "" };
    const layers = await loadWindowLayers(manifest, win, fetchBinary, []);
    expect(layers.grid.width).toBe(4);
    expect(layers.slope.length).toBe(16);
    expect(layers.surface.length).toBe(16);
  });
});
