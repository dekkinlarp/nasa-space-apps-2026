/**
 * imagery/<layer>/l<level>/<r>_<c>.jpg: Mars Trek WMTS imagery over the region as a picture pyramid.
 *
 * Level 0 is the layer at its finest zoom, cut into pieces of at most PIECE px; each level up is 4x
 * coarser, until one piece holds the whole region. The app draws map tiles from the pieces of the level
 * that matches the zoom (apps/web/src/map/imageryTiles.ts), so it never decodes more than a few pieces.
 * Level 0 is built one band of PIECE rows at a time: the full-resolution HiRISE mosaic of the region
 * (about 52 000 x 63 000 px) is never held in memory.
 *
 * HiRISE also gets grayscale copies on the shared grid for the surface estimate and the CRISM alignment:
 * data/cache/<id>/hirise_grid.u8 (2 m cells) and hirise_ov.u8 (overview cells).
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { ImageryEntry } from "../../packages/core/src/types";
import { areaDir, cacheDir, FORCE, gridFromArea, isMain, loadArea, log, type AreaConfig } from "./lib/area";
import { writeAtomic, writeJson } from "./lib/net";
import { bandGrid, coarseGrid, RegionFile } from "./lib/tiles";
import { degPerPx, pixelWindow, stitchGray, trekMaxZoom } from "./lib/trek";
import { BAND_ROWS } from "./elevation";

/** Largest side of one picture: a decoded piece is PIECE^2 x 4 bytes (16 MB) in the browser. */
const PIECE = 2048;
const QUALITY = 84;

interface LayerSpec {
  id: string;
  name: string;
  layer: string;
  preferZoom: number;
  source: string;
  /** Write grayscale copies on the grid (for the surface estimate and the CRISM alignment). */
  gridCopy?: boolean;
  /** Single-band visible imagery: the app may tint it Mars-coloured. Thermal imagery is left alone. */
  gray?: boolean;
  optional?: boolean;
}

export const LAYERS: LayerSpec[] = [
  {
    id: "hirise",
    name: "HiRISE orthophoto mosaic (Curiosity traverse)",
    layer: "curiosity_hirise_mosaic",
    preferZoom: 16,
    source: "NASA Mars Trek WMTS curiosity_hirise_mosaic (MRO HiRISE, NASA/JPL/UArizona)",
    gridCopy: true,
    gray: true,
  },
  {
    id: "ctx",
    name: "CTX mosaic (Gale, block-adjusted)",
    layer: "Gale_CTX_BlockAdj_dd",
    preferZoom: 12,
    source: "NASA Mars Trek WMTS Gale_CTX_BlockAdj_dd (MRO CTX, NASA/JPL/MSSS)",
    gray: true,
  },
  {
    id: "themis_night",
    name: "THEMIS night-time IR (thermal inertia proxy, ~100 m)",
    layer: "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018",
    preferZoom: 9,
    source: "NASA Mars Trek WMTS THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018 (Mars Odyssey THEMIS, NASA/JPL/ASU)",
    optional: true,
  },
  {
    id: "themis_day",
    name: "THEMIS day-time IR (~100 m)",
    layer: "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018",
    preferZoom: 9,
    source: "NASA Mars Trek WMTS THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018 (Mars Odyssey THEMIS, NASA/JPL/ASU)",
    optional: true,
  },
];

const mPerDeg = (a: AreaConfig) => (Math.PI / 180) * a.marsRadiusM;

/** A picture level held in memory (levels 1 and up): gray pixels and a mask of real ones. */
interface Level {
  w: number;
  h: number;
  gray: Uint8Array;
  valid: Uint8Array;
}

/** 4x4 block average over valid pixels of rows [0, h) of src into rows starting at dstRow of dst. */
function shrink4(src: { gray: Uint8Array; valid: Uint8Array }, w: number, h: number, dst: Level, dstRow: number): void {
  const dh = Math.ceil(h / 4);
  for (let y = 0; y < dh; y++) {
    const dy = dstRow + y;
    if (dy >= dst.h) break;
    for (let x = 0; x < dst.w; x++) {
      let s = 0, n = 0;
      for (let yy = y * 4; yy < Math.min(h, y * 4 + 4); yy++)
        for (let xx = x * 4; xx < Math.min(w, x * 4 + 4); xx++) {
          const i = yy * w + xx;
          if (src.valid[i]) (s += src.gray[i]!), n++;
        }
      if (n) {
        dst.gray[dy * dst.w + x] = Math.round(s / n);
        dst.valid[dy * dst.w + x] = 1;
      }
    }
  }
}

export async function runImagery(): Promise<ImageryEntry[]> {
  const a = loadArea();
  const dir = areaDir(a, "imagery");
  const indexFile = join(cacheDir(a.id), "imagery-entries.json");
  const prev: ImageryEntry[] = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as ImageryEntry[]) : [];
  const entries: ImageryEntry[] = [];
  for (const spec of LAYERS) {
    const mine = prev.filter((e) => e.group === spec.id);
    const gridDone = !spec.gridCopy || (existsSync(join(cacheDir(a.id), "hirise_grid.u8")) && existsSync(join(cacheDir(a.id), "hirise_ov.u8")));
    if (!FORCE && mine.length && mine.every((e) => existsSync(join(areaDir(a), e.file))) && gridDone && existsSync(join(cacheDir(a.id), `imagery-${spec.id}.done`))) {
      log("imagery", `${spec.id}: ${mine.length} pictures exist, skipping`);
      entries.push(...mine);
      continue;
    }
    try {
      const { zoom: maxZ, ext } = await trekMaxZoom(spec.layer);
      const z = Math.min(spec.preferZoom, maxZ);
      entries.push(...(await pyramid(spec, a, z, ext, dir)));
      if (spec.gridCopy) await gridCopy(spec, a, z, ext);
      writeAtomic(join(cacheDir(a.id), `imagery-${spec.id}.done`), new Date().toISOString());
    } catch (e) {
      if (!spec.optional) throw e;
      log("imagery", `${spec.id}: skipped (${(e as Error).message})`);
    }
    // Saved after every layer, so a failed run keeps what it finished.
    writeJson(indexFile, [...entries, ...prev.filter((p) => !entries.some((e) => e.group === p.group) && !mine.includes(p))]);
  }
  writeJson(indexFile, entries);
  return entries;
}

async function pyramid(spec: LayerSpec, a: AreaConfig, z: number, ext: string, dir: string): Promise<ImageryEntry[]> {
  const px = pixelWindow(a, z);
  const d = degPerPx(z);
  const W = px.x1 - px.x0, H = px.y1 - px.y0;
  const bounds = { west: px.x0 * d - 180, north: 90 - px.y0 * d };
  const mpp0 = d * mPerDeg(a);
  rmSync(join(dir, spec.id), { recursive: true, force: true });
  // Levels up to the first that fits in one piece.
  let top = 0;
  while (Math.max(W, H) / 4 ** top > PIECE) top++;
  const levels = Array.from({ length: top + 1 }, (_, i) => i);
  log("imagery", `${spec.id}: z${z}, ${W}x${H} px (${mpp0.toFixed(2)} m/px), ${levels.length} level(s)`);
  const entries: ImageryEntry[] = [];
  let pieces = 0, bytes = 0;

  const writePieces = async (level: number, rowOff: number, band: { gray: Uint8Array; valid: Uint8Array; w: number; h: number }) => {
    const scale = 4 ** level;
    for (let x = 0; x < band.w; x += PIECE) {
      const pw = Math.min(PIECE, band.w - x), ph = band.h;
      const crop = new Uint8Array(pw * ph);
      let any = false;
      for (let y = 0; y < ph; y++) {
        crop.set(band.gray.subarray(y * band.w + x, y * band.w + x + pw), y * pw);
        if (!any) for (let k = 0; k < pw; k++) if (band.valid[y * band.w + x + k]) { any = true; break; }
      }
      if (!any) continue;
      const r = Math.floor(rowOff / PIECE), c = Math.floor(x / PIECE);
      const rel = `imagery/${spec.id}/l${level}/${r}_${c}.jpg`;
      const buf = await sharp(Buffer.from(crop.buffer, crop.byteOffset, crop.byteLength), { raw: { width: pw, height: ph, channels: 1 }, limitInputPixels: false })
        // sharp would otherwise write 1-channel input as RGB.
        .toColourspace("b-w")
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer();
      writeAtomic(join(dir, "..", rel), buf);
      pieces++;
      bytes += buf.length;
      entries.push({
        id: `${spec.id}_l${level}_${r}_${c}`,
        group: spec.id,
        level,
        gray: spec.gray,
        name: spec.name,
        file: rel,
        west: bounds.west + x * scale * d,
        east: bounds.west + Math.min(W, (x + pw) * scale) * d,
        north: bounds.north - rowOff * scale * d,
        south: bounds.north - Math.min(H, (rowOff + ph) * scale) * d,
        widthPx: pw,
        heightPx: ph,
        source: `${spec.source}, z${z}`,
        metersPerPixel: Number((mpp0 * scale).toFixed(3)),
      });
    }
  };

  // Level 0 in bands of PIECE rows straight from the tiles; level 1 accumulates in memory.
  const mk = (w: number, h: number): Level => ({ w, h, gray: new Uint8Array(w * h), valid: new Uint8Array(w * h) });
  let next: Level | null = levels.length > 1 ? mk(Math.ceil(W / 4), Math.ceil(H / 4)) : null;
  for (let y = 0; y < H; y += PIECE) {
    const bh = Math.min(PIECE, H - y);
    const band = await stitchGray(spec.layer, z, ext, px.x0, px.y0 + y, W, bh);
    await writePieces(0, y, { ...band, w: W, h: bh });
    if (next) shrink4(band, W, bh, next, y / 4);
    if ((y / PIECE) % 4 === 3 || y + PIECE >= H) log("imagery", `${spec.id}: level 0 rows ${y + bh}/${H}, ${pieces} pieces, ${(bytes / 1e6).toFixed(0)} MB`);
  }
  for (let level = 1; level < levels.length && next; level++) {
    const cur: Level = next;
    next = level + 1 < levels.length ? mk(Math.ceil(cur.w / 4), Math.ceil(cur.h / 4)) : null;
    for (let y = 0; y < cur.h; y += PIECE) {
      const bh = Math.min(PIECE, cur.h - y);
      const sub = { gray: cur.gray.subarray(y * cur.w, (y + bh) * cur.w), valid: cur.valid.subarray(y * cur.w, (y + bh) * cur.w) };
      await writePieces(level, y, { ...sub, w: cur.w, h: bh });
      if (next) shrink4(sub, cur.w, bh, next, y / 4);
    }
    log("imagery", `${spec.id}: level ${level} ${cur.w}x${cur.h} px done`);
  }
  log("imagery", `${spec.id}: ${pieces} pictures, ${(bytes / 1e6).toFixed(0)} MB`);
  return entries;
}

/** Grayscale copies of the layer on the 2 m grid and on the overview grid, one band of grid rows at a time. */
async function gridCopy(spec: LayerSpec, a: AreaConfig, z: number, ext: string): Promise<void> {
  const g = gridFromArea(a);
  const F = a.overviewFactor ?? 8;
  const og = coarseGrid(g, F);
  const d = degPerPx(z);
  const full = new RegionFile(join(cacheDir(a.id), `${spec.id}_grid.u8`), g.width, g.height, "uint8", true);
  const ov = new Uint8Array(og.width * og.height);
  for (let r0 = 0; r0 < g.height; r0 += BAND_ROWS) {
    const r1 = Math.min(g.height, r0 + BAND_ROWS);
    const bg = bandGrid(g, r0, r1);
    // Pixel window of the band (fractional), snapped outwards to whole pixels and resampled to the cells.
    const fx0 = (bg.west + 180) / d, fx1 = (bg.east + 180) / d, fy0 = (90 - bg.north) / d, fy1 = (90 - bg.south) / d;
    const x0 = Math.floor(fx0), y0 = Math.floor(fy0), w = Math.ceil(fx1) - x0, h = Math.ceil(fy1) - y0;
    const { gray } = await stitchGray(spec.layer, z, ext, x0, y0, w, h);
    // Crop to the exact band footprint (sharp needs whole pixels: error < 1 px = 0.64 m).
    const left = Math.round(fx0 - x0), top = Math.round(fy0 - y0);
    const cw = Math.min(w - left, Math.round(fx1 - fx0)), ch = Math.min(h - top, Math.round(fy1 - fy0));
    const cells = await sharp(Buffer.from(gray.buffer, gray.byteOffset, gray.byteLength), { raw: { width: w, height: h, channels: 1 }, limitInputPixels: false })
      .extract({ left, top, width: cw, height: ch })
      .resize(bg.width, bg.height, { kernel: "cubic", fit: "fill" })
      // Without this sharp returns 3 channels (sRGB) for 1-channel input.
      .toColourspace("b-w")
      .raw()
      .toBuffer();
    if (cells.length !== bg.width * bg.height) throw new Error(`grid copy: ${cells.length} bytes, expected ${bg.width * bg.height}`);
    const band = new Uint8Array(cells.buffer, cells.byteOffset, bg.width * bg.height);
    full.write(r0, band);
    // Overview cells: plain block mean.
    for (let oy = Math.floor(r0 / F); oy < Math.ceil(r1 / F); oy++)
      for (let ox = 0; ox < og.width; ox++) {
        let s = 0, n = 0;
        for (let y = oy * F; y < Math.min(r1, oy * F + F); y++)
          for (let x = ox * F; x < Math.min(g.width, ox * F + F); x++) (s += band[(y - r0) * g.width + x]!), n++;
        if (n) ov[oy * og.width + ox] = Math.round(s / n);
      }
    if ((r0 / BAND_ROWS) % 8 === 7 || r1 === g.height) log("imagery", `${spec.id}: grid copy rows ${r1}/${g.height}`);
  }
  full.close();
  writeAtomic(join(cacheDir(a.id), `${spec.id}_ov.u8`), ov);
}

if (isMain(import.meta.url)) await runImagery();
