/**
 * Tiled, compressed rasters and the planning window.
 *
 * A wide region is too big to hold at full resolution (33 x 40 km at 2 m is 330 million cells), so the
 * pipeline stores each full-resolution layer as square tiles and the app loads only a window of them
 * around the walk: the routing core then works on that window exactly as it would on a small area,
 * with the window's own GridSpec. Layers that are coarse anyway (overviews, CRISM) are single files
 * on their own grid.
 *
 * Encoding (LayerCodec): int16 or uint8 values, int16 optionally as wrapping differences along each row
 * (smooth terrain becomes small numbers that compress well), then zlib. Decoding uses
 * DecompressionStream, which browsers, web workers and Node 18+ all provide.
 */
import { computeSlope, fetchLayerBytes } from "./load";
import type { GridSpec, LayerCodec, LayerEntry, LayerManifest, Layers, LonLat, SurfaceClass, TileSet } from "./types";

export const INT16_NODATA = -32768;

/** A window of whole tiles: top-left tile (row0, col0) and its size in tiles. */
export interface TileWindow {
  row0: number;
  col0: number;
  rows: number;
  cols: number;
}

/** zlib-inflate bytes (DecompressionStream "deflate" is the zlib format). */
export async function inflate(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * Values -> bytes before compression (the pipeline deflates the result). `width` is the row length
 * used for row differences. Float input is quantised with the codec's scale/offset; NaN -> nodata.
 */
export function encodeValues(values: Float32Array | Uint8Array, codec: LayerCodec, width: number): Uint8Array {
  const n = values.length;
  if (codec.kind === "uint8") return values instanceof Uint8Array ? values : Uint8Array.from(values, (v) => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0));
  const scale = codec.scale ?? 1, offset = codec.offset ?? 0;
  const q = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    q[i] = Number.isFinite(v) ? Math.max(-32767, Math.min(32767, Math.round((v - offset) / scale))) : INT16_NODATA;
  }
  if (codec.delta) {
    for (let r = 0; r < n / width; r++) {
      const o = r * width;
      for (let c = width - 1; c > 0; c--) q[o + c] = (q[o + c]! - q[o + c - 1]!) << 16 >> 16;
    }
  }
  const out = new Uint8Array(n * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < n; i++) dv.setInt16(i * 2, q[i]!, true);
  return out;
}

/** Inverse of encodeValues (after inflating). int16 decodes to Float32Array with NaN for nodata. */
export function decodeValues(bytes: Uint8Array, codec: LayerCodec, width: number, n: number): Float32Array | Uint8Array {
  if (codec.kind === "uint8") {
    if (bytes.length !== n) throw new Error(`expected ${n} bytes, got ${bytes.length}`);
    return bytes;
  }
  if (bytes.length !== n * 2) throw new Error(`expected ${n * 2} bytes, got ${bytes.length}`);
  let q: Int16Array;
  if (LITTLE_ENDIAN && bytes.byteOffset % 2 === 0) q = new Int16Array(bytes.buffer, bytes.byteOffset, n);
  else {
    q = new Int16Array(n);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) q[i] = dv.getInt16(i * 2, true);
  }
  const scale = codec.scale ?? 1, offset = codec.offset ?? 0;
  const out = new Float32Array(n);
  for (let r = 0; r < n / width; r++) {
    const o = r * width;
    let acc = 0;
    for (let c = 0; c < width; c++) {
      const v = codec.delta ? (acc = (acc + q[o + c]!) << 16 >> 16) : q[o + c]!;
      out[o + c] = v === INT16_NODATA ? NaN : v * scale + offset;
    }
  }
  return out;
}

/** Raw (codec-less) layer bytes -> typed array, with nodata mapped to NaN (float) or 0 (uint8). */
function decodeRaw(buf: ArrayBuffer, entry: LayerEntry, n: number): Float32Array | Uint8Array {
  if (entry.dtype === "uint8") {
    if (buf.byteLength !== n) throw new Error(`layer ${entry.id}: expected ${n} bytes, got ${buf.byteLength}`);
    const out = new Uint8Array(buf.slice(0));
    if (entry.nodata !== undefined && entry.nodata !== 0) for (let i = 0; i < n; i++) if (out[i] === entry.nodata) out[i] = 0;
    return out;
  }
  if (buf.byteLength !== n * 4) throw new Error(`layer ${entry.id}: expected ${n * 4} bytes, got ${buf.byteLength}`);
  let out: Float32Array;
  if (LITTLE_ENDIAN) out = new Float32Array(buf.slice(0));
  else {
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

/** Decode one stored file (whole layer or one tile) of `width` x `height` cells. */
export async function decodeRaster(buf: ArrayBuffer, entry: Pick<LayerEntry, "id" | "dtype" | "nodata" | "codec">, width: number, height: number, codec = entry.codec): Promise<Float32Array | Uint8Array> {
  if (!codec) return decodeRaw(buf, entry as LayerEntry, width * height);
  const bytes = codec.deflate ? await inflate(buf) : new Uint8Array(buf);
  return decodeValues(bytes, codec, width, width * height);
}

/** Path of one tile of a tiled layer. */
export const tilePath = (entry: LayerEntry, r: number, c: number) => entry.file.replace("{r}", String(r)).replace("{c}", String(c));

/** The tiling every tiled layer of the manifest shares (the elevation layer's), or null for an untiled area. */
export function manifestTiles(manifest: LayerManifest): TileSet | null {
  return manifest.layers.find((l) => l.id === "elevation")?.tiles ?? null;
}

/** GridSpec of a window of whole tiles of `grid`. */
export function windowGrid(grid: GridSpec, tileSize: number, w: TileWindow): GridSpec {
  const dLon = (grid.east - grid.west) / grid.width;
  const dLat = (grid.north - grid.south) / grid.height;
  const c0 = w.col0 * tileSize, r0 = w.row0 * tileSize;
  const width = w.cols * tileSize, height = w.rows * tileSize;
  return {
    ...grid,
    id: `${grid.id}@${w.row0},${w.col0}`,
    west: grid.west + c0 * dLon,
    east: grid.west + (c0 + width) * dLon,
    north: grid.north - r0 * dLat,
    south: grid.north - (r0 + height) * dLat,
    width,
    height,
  };
}

export const sameWindow = (a: TileWindow | null | undefined, b: TileWindow | null | undefined) =>
  !!a && !!b && a.row0 === b.row0 && a.col0 === b.col0 && a.rows === b.rows && a.cols === b.cols;

/** Planning window side, in metres (8 km: room for a 6-hour walk out and back from near its centre). */
export const WINDOW_SIDE_M = 8192;
/** A point closer than this to a window edge (that is not the region's edge) moves the window. */
export const WINDOW_MARGIN_M = 2000;

/**
 * The window of tiles to plan in: the current one if every point sits at least `marginM` inside it
 * (edges that are the region's own edges do not count), otherwise one centred on the points.
 * `fits` is false when the points are spread wider than one window.
 */
export function chooseWindow(
  grid: GridSpec,
  tiles: TileSet,
  points: LonLat[],
  current: TileWindow | null,
  opts: { sideM?: number; marginM?: number } = {},
): { win: TileWindow; fits: boolean } {
  const T = tiles.size;
  const side = Math.max(1, Math.min(Math.round((opts.sideM ?? WINDOW_SIDE_M) / (grid.cellSizeM * T)), tiles.cols, tiles.rows));
  const margin = (opts.marginM ?? WINDOW_MARGIN_M) / grid.cellSizeM;
  const cells = points.map(([lon, lat]) => [
    Math.max(0, Math.min(grid.width - 1, ((lon - grid.west) / (grid.east - grid.west)) * grid.width)),
    Math.max(0, Math.min(grid.height - 1, ((grid.north - lat) / (grid.north - grid.south)) * grid.height)),
  ]);
  const inside = (w: TileWindow, m: number) =>
    cells.every(([c, r]) => {
      const x0 = w.col0 * T, x1 = (w.col0 + w.cols) * T, y0 = w.row0 * T, y1 = (w.row0 + w.rows) * T;
      return (
        c! >= x0 + (w.col0 > 0 ? m : 0) &&
        c! < x1 - (w.col0 + w.cols < tiles.cols ? m : 0) &&
        r! >= y0 + (w.row0 > 0 ? m : 0) &&
        r! < y1 - (w.row0 + w.rows < tiles.rows ? m : 0)
      );
    });
  if (current && current.cols === side && current.rows === side && inside(current, margin)) return { win: current, fits: true };
  let cx = grid.width / 2, cy = grid.height / 2;
  if (cells.length) {
    const xs = cells.map((p) => p[0]!), ys = cells.map((p) => p[1]!);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const win: TileWindow = {
    col0: clamp(Math.round(cx / T - side / 2), tiles.cols - side),
    row0: clamp(Math.round(cy / T - side / 2), tiles.rows - side),
    cols: side,
    rows: side,
  };
  return { win, fits: inside(win, 0) };
}

/** Read one layer over a window of tiles (tiled layer) or over the whole grid (untiled layer, `win` null). */
export async function readLayerWindow(
  entry: LayerEntry,
  grid: GridSpec,
  win: TileWindow | null,
  fetchBinary: (file: string) => Promise<ArrayBuffer>,
): Promise<Float32Array | Uint8Array> {
  const float = entry.codec ? entry.codec.kind === "int16" : entry.dtype === "float32";
  if (!entry.tiles) {
    const whole = await decodeRaster(await fetchLayerBytes(entry, fetchBinary), entry, grid.width, grid.height);
    if (!win) return whole;
    throw new Error(`layer ${entry.id} is not tiled; it cannot be read by window`);
  }
  const ts = entry.tiles;
  const w = win ?? { row0: 0, col0: 0, rows: ts.rows, cols: ts.cols };
  const T = ts.size;
  const W = w.cols * T;
  const out = float ? new Float32Array(W * w.rows * T).fill(NaN) : new Uint8Array(W * w.rows * T);
  const jobs: Promise<void>[] = [];
  for (let r = w.row0; r < w.row0 + w.rows; r++)
    for (let c = w.col0; c < w.col0 + w.cols; c++) {
      if (r < 0 || c < 0 || r >= ts.rows || c >= ts.cols || ts.present[r * ts.cols + c] !== "1") continue;
      jobs.push(
        (async () => {
          const tile = await decodeRaster(await fetchBinary(tilePath(entry, r, c)), entry, T, T);
          const ox = (c - w.col0) * T, oy = (r - w.row0) * T;
          for (let y = 0; y < T; y++) out.set(tile.subarray(y * T, (y + 1) * T), (oy + y) * W + ox);
        })(),
      );
    }
  await Promise.all(jobs);
  return out;
}

/** A layer stored as one file on its own grid (overview, CRISM) or on the manifest grid. */
export async function readLayerWhole(
  entry: LayerEntry,
  manifestGrid: GridSpec,
  fetchBinary: (file: string) => Promise<ArrayBuffer>,
): Promise<{ grid: GridSpec; data: Float32Array | Uint8Array }> {
  const grid = entry.grid ?? manifestGrid;
  return { grid, data: await decodeRaster(await fetchLayerBytes(entry, fetchBinary), entry, grid.width, grid.height) };
}

/** The overview copy of a layer: its `overview`, or the layer itself when it is already a whole file on a coarse grid. */
export async function readOverview(
  entry: LayerEntry,
  manifestGrid: GridSpec,
  fetchBinary: (file: string) => Promise<ArrayBuffer>,
): Promise<{ grid: GridSpec; data: Float32Array | Uint8Array } | null> {
  if (entry.overview) {
    const o = entry.overview;
    const data = await decodeRaster(await fetchBinary(o.file), { ...entry, codec: o.codec }, o.grid.width, o.grid.height, o.codec);
    return { grid: o.grid, data };
  }
  if (!entry.tiles) return readLayerWhole(entry, manifestGrid, fetchBinary);
  return null;
}

/**
 * Routing rasters for a window of tiles (or the whole grid when the area is not tiled or `win` is null).
 * Elevation is required; slope comes from a full-resolution slope layer if there is one, else it is
 * computed from elevation (Horn); surface defaults to 0 (Unknown).
 */
export async function loadWindowLayers(
  manifest: LayerManifest,
  win: TileWindow | null,
  fetchBinary: (file: string) => Promise<ArrayBuffer>,
  surfaceClasses: SurfaceClass[],
): Promise<Layers> {
  const tiles = manifestTiles(manifest);
  const w = tiles ? win : null;
  const grid = tiles && w ? windowGrid(manifest.grid, tiles.size, w) : manifest.grid;
  const byId = (id: string) => manifest.layers.find((l) => l.id === id && !l.grid);
  const elevEntry = byId("elevation");
  if (!elevEntry) throw new Error("layers.json has no 'elevation' layer");
  const slopeEntry = byId("slope");
  const surfEntry = byId("surface");
  const [elevation, slope, surface] = await Promise.all([
    readLayerWindow(elevEntry, manifest.grid, w, fetchBinary) as Promise<Float32Array>,
    slopeEntry ? (readLayerWindow(slopeEntry, manifest.grid, w, fetchBinary) as Promise<Float32Array>) : Promise.resolve(null),
    surfEntry ? (readLayerWindow(surfEntry, manifest.grid, w, fetchBinary) as Promise<Uint8Array>) : Promise.resolve(null),
  ]);
  return {
    grid,
    elevation,
    slope: slope ?? computeSlope(grid, elevation),
    surface: surface ?? new Uint8Array(grid.width * grid.height),
    surfaceClasses,
  };
}
