import type { GridSpec, LayerEntry, LayerManifest, Layers, SurfaceClass } from "./types";

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function readFloat32(buf: ArrayBuffer, n: number, entry: LayerEntry): Float32Array {
  if (buf.byteLength !== n * 4) {
    throw new Error(`layer ${entry.id}: expected ${n * 4} bytes, got ${buf.byteLength}`);
  }
  let out: Float32Array;
  if (LITTLE_ENDIAN) {
    out = new Float32Array(buf.slice(0));
  } else {
    out = new Float32Array(n);
    const dv = new DataView(buf);
    for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  }
  if (entry.nodata !== undefined && !Number.isNaN(entry.nodata)) {
    const nd = Math.fround(entry.nodata);
    for (let i = 0; i < n; i++) if (out[i] === nd) out[i] = NaN;
  }
  return out;
}

function readUint8(buf: ArrayBuffer, n: number, entry: LayerEntry): Uint8Array {
  if (buf.byteLength !== n) throw new Error(`layer ${entry.id}: expected ${n} bytes, got ${buf.byteLength}`);
  const out = new Uint8Array(buf.slice(0));
  if (entry.nodata !== undefined && entry.nodata !== 0) {
    for (let i = 0; i < n; i++) if (out[i] === entry.nodata) out[i] = 0; // 0 = Unknown
  }
  return out;
}

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
 * Load the routing rasters named in a layers.json manifest. `fetchBinary` receives the
 * manifest's relative `file` and returns its bytes (fetch() in a browser, fs.readFile in Node).
 * Elevation is required; slope is computed from elevation if missing; surface defaults to 0 (Unknown).
 */
export async function loadLayers(
  manifest: LayerManifest,
  fetchBinary: (file: string) => Promise<ArrayBuffer>,
  surfaceClasses: SurfaceClass[],
): Promise<Layers> {
  const grid = manifest.grid;
  const n = grid.width * grid.height;
  const byId = (id: string) => manifest.layers.find((l) => l.id === id);

  const elevEntry = byId("elevation");
  if (!elevEntry) throw new Error("layers.json has no 'elevation' layer");
  const slopeEntry = byId("slope");
  const surfEntry = byId("surface");

  const [elevBuf, slopeBuf, surfBuf] = await Promise.all([
    fetchLayerBytes(elevEntry, fetchBinary),
    slopeEntry ? fetchLayerBytes(slopeEntry, fetchBinary) : Promise.resolve(null),
    surfEntry ? fetchLayerBytes(surfEntry, fetchBinary) : Promise.resolve(null),
  ]);

  const elevation = readFloat32(elevBuf, n, elevEntry);
  const slope = slopeBuf && slopeEntry ? readFloat32(slopeBuf, n, slopeEntry) : computeSlope(grid, elevation);
  const surface = surfBuf && surfEntry ? readUint8(surfBuf, n, surfEntry) : new Uint8Array(n);
  return { grid, elevation, slope, surface, surfaceClasses };
}
