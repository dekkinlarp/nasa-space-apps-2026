import type { GridSpec, LayerEntry, LayerManifest, Layers, SurfaceClass } from "./types";
import { loadWindowLayers } from "./tiles";

/**
 * The bytes of one layer: the single file, or its numbered parts fetched together and joined.
 * `fetchBinary` receives a path relative to the area's data folder.
 */
export async function fetchLayerBytes(entry: LayerEntry, fetchBinary: (file: string) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
  if (!entry.parts || entry.parts < 2) return fetchBinary(entry.file);
  const bufs = await Promise.all(Array.from({ length: entry.parts }, (_, i) => fetchBinary(`${entry.file}.${i}`)));
  const out = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const b of bufs) {
    out.set(new Uint8Array(b), at);
    at += b.byteLength;
  }
  return out.buffer;
}

/**
 * Slope in degrees from elevation using Horn's 3x3 method. Edge cells reuse the nearest
 * in-grid neighbour. NaN elevation propagates to NaN slope (treated as impassable).
 */
export function computeSlope(grid: GridSpec, elevation: Float32Array): Float32Array {
  const { width: W, height: H, cellSizeM: cs } = grid;
  const out = new Float32Array(W * H);
  const R2D = 180 / Math.PI;
  for (let r = 0; r < H; r++) {
    const rn = r > 0 ? r - 1 : r;
    const rs = r < H - 1 ? r + 1 : r;
    for (let c = 0; c < W; c++) {
      const cw = c > 0 ? c - 1 : c;
      const ce = c < W - 1 ? c + 1 : c;
      const a = elevation[rn * W + cw]!, b = elevation[rn * W + c]!, cc = elevation[rn * W + ce]!;
      const d = elevation[r * W + cw]!, f = elevation[r * W + ce]!;
      const g = elevation[rs * W + cw]!, h = elevation[rs * W + c]!, i = elevation[rs * W + ce]!;
      const dzdx = (cc + 2 * f + i - (a + 2 * d + g)) / (4 * (ce - cw) * cs || 1);
      const dzdy = (g + 2 * h + i - (a + 2 * b + cc)) / (4 * (rs - rn) * cs || 1);
      out[r * W + c] = Math.atan(Math.hypot(dzdx, dzdy)) * R2D;
    }
  }
  return out;
}

/**
 * Load the routing rasters named in a layers.json manifest, over the whole grid. `fetchBinary` receives
 * the manifest's relative `file` and returns its bytes (fetch() in a browser, fs.readFile in Node).
 * Elevation is required; slope is computed from elevation if missing; surface defaults to 0 (Unknown).
 * For a tiled region use loadWindowLayers with a window instead: the whole region does not fit in memory.
 */
export async function loadLayers(
  manifest: LayerManifest,
  fetchBinary: (file: string) => Promise<ArrayBuffer>,
  surfaceClasses: SurfaceClass[],
): Promise<Layers> {
  return loadWindowLayers(manifest, null, fetchBinary, surfaceClasses);
}
