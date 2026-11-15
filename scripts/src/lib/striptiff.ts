/**
 * Minimal remote reader for a classic little-endian, stripped, LZW (or uncompressed),
 * float32 GeoTIFF over HTTP Range requests. Built for the USGS MSL Gale 1 m DEM mosaic
 * (32980 x 57440, one row per strip) so we only fetch the rows we need.
 *
 * Compressed strips are cached on disk in chunks of CHUNK_ROWS rows, so re-runs or a
 * larger area re-use what is already downloaded.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lzwDecode } from "./lzw";
import { fetchBuffer, pool, writeAtomic, writeJson } from "./net";
import { log } from "./area";

const CHUNK_ROWS = 64;

export interface TiffMeta {
  url: string;
  width: number;
  height: number;
  bitsPerSample: number;
  sampleFormat: number;
  compression: number;
  predictor: number;
  rowsPerStrip: number;
  pixelScale: number[];
  tiepoint: number[];
  /** 1 = PixelIsArea, 2 = PixelIsPoint (GTRasterTypeGeoKey) */
  rasterType: number;
  geoAscii: string;
  geoDoubles: number[];
  geoKeys: number[];
  nodata: number | null;
  stripCount: number;
}

interface Tag {
  tag: number;
  type: number;
  count: number;
  valueOrOffset: number;
  raw: Buffer;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

export class RemoteStripTiff {
  meta!: TiffMeta;
  offsets!: Float64Array;
  counts!: Uint32Array;

  constructor(
    public url: string,
    public cacheDir: string,
  ) {}

  async open(): Promise<void> {
    const metaFile = join(this.cacheDir, "tiff-meta.json");
    const offFile = join(this.cacheDir, "strip-offsets.f64");
    const cntFile = join(this.cacheDir, "strip-counts.u32");
    if (existsSync(metaFile) && existsSync(offFile) && existsSync(cntFile)) {
      this.meta = JSON.parse(readFileSync(metaFile, "utf8")) as TiffMeta;
      const o = readFileSync(offFile);
      const c = readFileSync(cntFile);
      this.offsets = new Float64Array(o.buffer, o.byteOffset, o.byteLength / 8).slice();
      this.counts = new Uint32Array(c.buffer, c.byteOffset, c.byteLength / 4).slice();
      return;
    }
    const head = await fetchBuffer(this.url, { range: [0, 7] });
    if (head.toString("latin1", 0, 2) !== "II" || head.readUInt16LE(2) !== 42) throw new Error("not a classic little-endian TIFF");
    const ifdOff = head.readUInt32LE(4);
    const nBuf = await fetchBuffer(this.url, { range: [ifdOff, ifdOff + 1] });
    const n = nBuf.readUInt16LE(0);
    const ifd = await fetchBuffer(this.url, { range: [ifdOff, ifdOff + 2 + n * 12 + 3] });
    const tags = new Map<number, Tag>();
    const pending: Tag[] = [];
    for (let i = 0; i < n; i++) {
      const e = 2 + i * 12;
      const t: Tag = {
        tag: ifd.readUInt16LE(e),
        type: ifd.readUInt16LE(e + 2),
        count: ifd.readUInt32LE(e + 4),
        valueOrOffset: ifd.readUInt32LE(e + 8),
        raw: ifd.subarray(e + 8, e + 12),
      };
      const size = (TYPE_SIZE[t.type] ?? 1) * t.count;
      if (size > 4) pending.push(t);
      tags.set(t.tag, t);
    }
    // fetch out-of-line tag values
    await pool(pending, 4, async (t) => {
      const size = (TYPE_SIZE[t.type] ?? 1) * t.count;
      t.raw = await fetchBuffer(this.url, { range: [t.valueOrOffset, t.valueOrOffset + size - 1] });
    });
    const nums = (tag: number): number[] => {
      const t = tags.get(tag);
      if (!t) return [];
      const r: number[] = [];
      for (let i = 0; i < t.count; i++) {
        if (t.type === 3) r.push(t.raw.readUInt16LE(i * 2));
        else if (t.type === 4) r.push(t.raw.readUInt32LE(i * 4));
        else if (t.type === 12) r.push(t.raw.readDoubleLE(i * 8));
        else if (t.type === 16) r.push(Number(t.raw.readBigUInt64LE(i * 8)));
      }
      return r;
    };
    const ascii = (tag: number): string => {
      const t = tags.get(tag);
      return t ? t.raw.toString("latin1", 0, t.count).replace(/\0+$/, "") : "";
    };
    const one = (tag: number, def: number): number => nums(tag)[0] ?? def;
    const geoKeys = nums(34735);
    let rasterType = 1;
    for (let k = 4; k + 3 < geoKeys.length; k += 4) if (geoKeys[k] === 1025) rasterType = geoKeys[k + 3]!;
    const nodataStr = ascii(42113).trim();
    this.meta = {
      url: this.url,
      width: one(256, 0),
      height: one(257, 0),
      bitsPerSample: one(258, 0),
      sampleFormat: one(339, 1),
      compression: one(259, 1),
      predictor: one(317, 1),
      rowsPerStrip: one(278, one(257, 0)),
      pixelScale: nums(33550),
      tiepoint: nums(33922),
      rasterType,
      geoAscii: ascii(34737),
      geoDoubles: nums(34736),
      geoKeys,
      nodata: nodataStr ? Number(nodataStr) : null,
      stripCount: tags.get(273)?.count ?? 0,
    };
    const m = this.meta;
    if (m.bitsPerSample !== 32 || m.sampleFormat !== 3) throw new Error("expected float32 samples");
    if (m.compression !== 5 && m.compression !== 1) throw new Error(`unsupported compression ${m.compression}`);
    if (m.predictor !== 1) throw new Error(`unsupported predictor ${m.predictor}`);
    this.offsets = Float64Array.from(nums(273));
    this.counts = Uint32Array.from(nums(279));
    writeAtomic(offFile, new Uint8Array(this.offsets.buffer));
    writeAtomic(cntFile, new Uint8Array(this.counts.buffer));
    writeJson(metaFile, m);
  }

  /** Compressed bytes for strips [s0, s1) — contiguous range request, cached per chunk. */
  private async chunk(c: number): Promise<{ buf: Buffer; base: number }> {
    const s0 = c * CHUNK_ROWS;
    const s1 = Math.min(this.meta.stripCount, s0 + CHUNK_ROWS);
    let lo = Infinity;
    let hi = -Infinity;
    for (let s = s0; s < s1; s++) {
      lo = Math.min(lo, this.offsets[s]!);
      hi = Math.max(hi, this.offsets[s]! + this.counts[s]!);
    }
    const file = join(this.cacheDir, `strips_${String(s0).padStart(6, "0")}_${s1 - s0}.bin`);
    if (existsSync(file)) {
      const buf = readFileSync(file);
      if (buf.length === hi - lo) return { buf, base: lo };
    }
    const buf = await fetchBuffer(this.url, { range: [lo, hi - 1], timeoutMs: 300_000 });
    writeAtomic(file, buf);
    return { buf, base: lo };
  }

  /** Download (and cache) the strips for rows [r0, r1) without decoding them. */
  async prefetchRows(r0: number, r1: number, concurrency = 4): Promise<void> {
    const chunks: number[] = [];
    for (let c = Math.floor(r0 / CHUNK_ROWS); c <= Math.floor((r1 - 1) / CHUNK_ROWS); c++) chunks.push(c);
    let done = 0, last = 0;
    await pool(chunks, concurrency, async (c) => {
      await this.chunk(c);
      done++;
      if (Date.now() - last > 10_000 || done === chunks.length) {
        last = Date.now();
        log("elevation", `DEM chunks downloaded ${done}/${chunks.length}`);
      }
    });
  }

  /**
   * Read rows [r0, r1) and columns [c0, c1) as float32 (nodata -> NaN).
   * Requires rowsPerStrip = 1 (true for the Gale mosaic).
   */
  async readWindow(r0: number, r1: number, c0: number, c1: number, concurrency = 4): Promise<Float32Array> {
    const m = this.meta;
    if (m.rowsPerStrip !== 1) throw new Error("readWindow assumes one row per strip");
    const w = c1 - c0;
    const out = new Float32Array((r1 - r0) * w);
    const rowBytes = m.width * 4;
    const chunks: number[] = [];
    for (let c = Math.floor(r0 / CHUNK_ROWS); c <= Math.floor((r1 - 1) / CHUNK_ROWS); c++) chunks.push(c);
    let done = 0;
    let lastLog = 0;
    await pool(chunks, concurrency, async (c) => {
      const { buf, base } = await this.chunk(c);
      const s0 = c * CHUNK_ROWS;
      const s1 = Math.min(m.stripCount, s0 + CHUNK_ROWS);
      for (let s = Math.max(s0, r0); s < Math.min(s1, r1); s++) {
        const start = this.offsets[s]! - base;
        const comp = buf.subarray(start, start + this.counts[s]!);
        const raw = m.compression === 5 ? lzwDecode(comp, rowBytes) : new Uint8Array(comp);
        const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const o = (s - r0) * w;
        for (let x = 0; x < w; x++) {
          const v = dv.getFloat32((c0 + x) * 4, true);
          out[o + x] = m.nodata !== null && (v === m.nodata || v < -1e30) ? NaN : v;
        }
      }
      done++;
      if (Date.now() - lastLog > 3000 || done === chunks.length) {
        lastLog = Date.now();
        log("elevation", `DEM chunks ${done}/${chunks.length}`);
      }
    });
    return out;
  }
}
