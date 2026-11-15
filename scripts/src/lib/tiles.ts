/**
 * Region-scale storage for the pipeline.
 *
 * - RegionFile: one big raw raster on disk (data/cache/<id>/…), read and written a band of rows at a
 *   time, so no step has to hold the whole 33 x 40 km region at 2 m in memory.
 * - writeTile / tile codecs: the deployable tiles (see packages/core/src/tiles.ts for the format).
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { encodeValues } from "../../../packages/core/src/tiles";
import type { GridSpec, LayerCodec } from "../../../packages/core/src/types";
import { writeAtomic } from "./net";

export const U8_CODEC: LayerCodec = { kind: "uint8", deflate: true };

/** int16 code for elevation over [min, max] (row differences: smooth terrain compresses well). */
export function elevationCodec(min: number, max: number): LayerCodec {
  const span = Math.max(1, max - min);
  // 65 000 steps over the range, rounded up to a whole millimetre, at least 1 cm.
  const scale = Math.max(0.01, Math.ceil((span / 65000) * 1000) / 1000);
  return { kind: "int16", scale, offset: Math.round((min + max) / 2), delta: true, deflate: true };
}

export function deflateValues(values: Float32Array | Uint8Array, codec: LayerCodec, width: number): Buffer {
  return deflateSync(encodeValues(values, codec, width), { level: 9 });
}

/** A raw float32 or uint8 raster of `width` x `height` on disk, accessed by rows. */
export class RegionFile {
  readonly bpp: number;
  private fd: number;
  constructor(
    readonly file: string,
    readonly width: number,
    readonly height: number,
    readonly dtype: "float32" | "uint8",
    create = false,
  ) {
    this.bpp = dtype === "float32" ? 4 : 1;
    mkdirSync(dirname(file), { recursive: true });
    if (create || !existsSync(file)) {
      this.fd = openSync(file, "w+");
      // Size the file up front; unwritten rows read back as zero bytes.
      writeSync(this.fd, Buffer.alloc(1), 0, 1, width * height * this.bpp - 1);
    } else {
      this.fd = openSync(file, "r+");
      const size = fstatSync(this.fd).size;
      if (size !== width * height * this.bpp) throw new Error(`${file}: ${size} bytes, expected ${width * height * this.bpp}`);
    }
  }

  /** Rows [r0, r1); rows outside the raster come back as NaN (float) or 0. */
  read(r0: number, r1: number): Float32Array | Uint8Array {
    const W = this.width;
    const out = this.dtype === "float32" ? new Float32Array((r1 - r0) * W).fill(NaN) : new Uint8Array((r1 - r0) * W);
    const a = Math.max(0, r0), b = Math.min(this.height, r1);
    if (b > a) {
      const bytes = new Uint8Array(out.buffer, (a - r0) * W * this.bpp, (b - a) * W * this.bpp);
      let done = 0;
      while (done < bytes.length) {
        const n = readSync(this.fd, bytes, done, Math.min(bytes.length - done, 1 << 30), a * W * this.bpp + done);
        if (n <= 0) throw new Error(`${this.file}: short read`);
        done += n;
      }
    }
    return out;
  }

  write(r0: number, data: Float32Array | Uint8Array): void {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    writeSync(this.fd, bytes, 0, bytes.length, r0 * this.width * this.bpp);
  }

  close(): void {
    closeSync(this.fd);
  }
}

/** Sub-grid of rows [r0, r1) of `g` (all columns). */
export function bandGrid(g: GridSpec, r0: number, r1: number): GridSpec {
  const dLat = (g.north - g.south) / g.height;
  return { ...g, north: g.north - r0 * dLat, south: g.north - r1 * dLat, height: r1 - r0 };
}

/** Coarse grid with the same bounds and `factor` x larger cells. */
export function coarseGrid(g: GridSpec, factor: number, id = `${g.id}-x${factor}`): GridSpec {
  return { ...g, id, width: Math.ceil(g.width / factor), height: Math.ceil(g.height / factor), cellSizeM: g.cellSizeM * factor };
}

/** Write one tile (cells [ty*T, ty*T+T) x [tx*T, …) of a band holding rows [ty*T, ty*T+T) and all columns). */
export function writeTile(dir: string, layerId: string, ty: number, tx: number, band: Float32Array | Uint8Array, bandWidth: number, T: number, codec: LayerCodec): number {
  const tile = band instanceof Float32Array ? new Float32Array(T * T) : new Uint8Array(T * T);
  for (let y = 0; y < T; y++) tile.set(band.subarray(y * bandWidth + tx * T, y * bandWidth + tx * T + T), y * T);
  const buf = deflateValues(tile, codec, T);
  writeAtomic(join(dir, "tiles", layerId, `${ty}_${tx}.bin`), buf);
  return buf.length;
}

/** Template path of a tiled layer, relative to the area folder. */
export const tileTemplate = (layerId: string) => `tiles/${layerId}/{r}_{c}.bin`;
