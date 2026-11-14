/**
 * imagery/*.jpg: stitches NASA Mars Trek WMTS tiles (equirectangular, 2^(z+1) x 2^z tiles of
 * 256 px, top-left -180/90) and crops them to the area bounds.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { ImageryEntry } from "../../packages/core/src/types";
import { areaDir, cacheDir, gridFromArea, isMain, loadArea, log, needs, type AreaConfig } from "./lib/area";
import { cachedFile, fetchBuffer, HttpError, pool, writeAtomic, writeJson } from "./lib/net";

const TREK = "https://trek.nasa.gov/tiles/Mars/EQ";
const TILE = 256;
const MAX_SIDE = 4096;

interface LayerSpec {
  id: string;
  name: string;
  layer: string;
  preferZoom: number;
  source: string;
  /** Also write a 2x2 full-resolution split when the crop exceeds MAX_SIDE. */
  split?: boolean;
  /** Write a grayscale copy resampled onto the grid (for the surface estimate). */
  gridCopy?: boolean;
  optional?: boolean;
}

export const LAYERS: LayerSpec[] = [
  {
    id: "hirise",
    name: "HiRISE orthophoto mosaic (Curiosity traverse)",
    layer: "curiosity_hirise_mosaic",
    preferZoom: 16,
    source: "NASA Mars Trek WMTS curiosity_hirise_mosaic (MRO HiRISE, NASA/JPL/UArizona)",
    split: true,
    gridCopy: true,
  },
  {
    id: "ctx",
    name: "CTX mosaic (Gale, block-adjusted)",
    layer: "Gale_CTX_BlockAdj_dd",
    preferZoom: 12,
    source: "NASA Mars Trek WMTS Gale_CTX_BlockAdj_dd (MRO CTX, NASA/JPL/MSSS)",
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

async function maxZoom(layer: string): Promise<{ zoom: number; ext: string }> {
  const file = join(cacheDir("trek", layer), "WMTSCapabilities.xml");
  const xml = (await cachedFile(`${TREK}/${layer}/1.0.0/WMTSCapabilities.xml`, file)).toString("utf8").replace(/<!--[\s\S]*?-->/g, "");
  const ids = [...xml.matchAll(/<TileMatrix>\s*<ows:Identifier>(\d+)<\/ows:Identifier>/g)].map((m) => Number(m[1]));
  const fmt = /<Format>image\/(\w+)<\/Format>/.exec(xml)?.[1] ?? "png";
  if (!ids.length) throw new Error(`no TileMatrix in capabilities for ${layer}`);
  return { zoom: Math.max(...ids), ext: fmt === "jpeg" ? "jpg" : fmt };
}

async function tile(layer: string, z: number, row: number, col: number, ext: string): Promise<Buffer | null> {
  const file = join(cacheDir("trek", layer, String(z), String(row)), `${col}.${ext}`);
  const miss = file + ".404";
  if (existsSync(file)) return readFileSync(file);
  if (existsSync(miss)) return null;
  try {
    const buf = await fetchBuffer(`${TREK}/${layer}/1.0.0/default/default028mm/${z}/${row}/${col}.${ext}`);
    writeAtomic(file, buf);
    return buf;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      writeAtomic(miss, "");
      return null;
    }
    throw e;
  }
}

interface Crop {
  img: sharp.Sharp;
  raw: Buffer;
  width: number;
  height: number;
  bounds: { south: number; north: number; west: number; east: number };
  degPerPx: number;
  zoom: number;
  missing: number;
}

async function stitch(spec: LayerSpec, a: AreaConfig, zoom: number, ext: string): Promise<Crop> {
  const span = 180 / 2 ** zoom;
  const degPerPx = span / TILE;
  // Global pixel coords of the area (x from -180, y from +90).
  const x0 = Math.floor((a.west + 180) / degPerPx);
  const x1 = Math.ceil((a.east + 180) / degPerPx);
  const y0 = Math.floor((90 - a.north) / degPerPx);
  const y1 = Math.ceil((90 - a.south) / degPerPx);
  const c0 = Math.floor(x0 / TILE);
  const c1 = Math.floor((x1 - 1) / TILE);
  const r0 = Math.floor(y0 / TILE);
  const r1 = Math.floor((y1 - 1) / TILE);
  const jobs: { row: number; col: number }[] = [];
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) jobs.push({ row, col });
  log("imagery", `${spec.id}: z${zoom} tiles rows ${r0}-${r1} cols ${c0}-${c1} (${jobs.length} tiles)`);
  let missing = 0;
  let done = 0;
  const tiles = await pool(jobs, 6, async (j) => {
    const buf = await tile(spec.layer, zoom, j.row, j.col, ext);
    if (!buf) missing++;
    if (++done % 100 === 0) log("imagery", `${spec.id}: ${done}/${jobs.length}`);
    return { ...j, buf };
  });
  if (missing === jobs.length) throw new HttpError(404, `${spec.layer} z${zoom}: all tiles missing`);
  const W = (c1 - c0 + 1) * TILE;
  const H = (r1 - r0 + 1) * TILE;
  const parts: sharp.OverlayOptions[] = [];
  for (const t of tiles) {
    if (!t.buf) continue;
    const png = await sharp(t.buf).removeAlpha().toColourspace("srgb").png().toBuffer();
    parts.push({ input: png, left: (t.col - c0) * TILE, top: (t.row - r0) * TILE });
  }
  const composed = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } }, limitInputPixels: false })
    .composite(parts)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // composite() output carries an alpha channel; drop it so the buffer is plain RGB.
  const mosaic =
    composed.info.channels === 3
      ? composed.data
      : await sharp(composed.data, { raw: { width: W, height: H, channels: composed.info.channels }, limitInputPixels: false })
          .removeAlpha()
          .raw()
          .toBuffer();
  if (mosaic.length !== W * H * 3) throw new Error(`unexpected mosaic size ${mosaic.length}`);
  const width = x1 - x0;
  const height = y1 - y0;
  const raw = await sharp(mosaic, { raw: { width: W, height: H, channels: 3 }, limitInputPixels: false })
    .extract({ left: x0 - c0 * TILE, top: y0 - r0 * TILE, width, height })
    .raw()
    .toBuffer();
  return {
    img: sharp(raw, { raw: { width, height, channels: 3 }, limitInputPixels: false }),
    raw,
    width,
    height,
    bounds: { west: x0 * degPerPx - 180, east: x1 * degPerPx - 180, north: 90 - y0 * degPerPx, south: 90 - y1 * degPerPx },
    degPerPx,
    zoom,
    missing,
  };
}

const mPerDeg = (a: AreaConfig) => (Math.PI / 180) * a.marsRadiusM;

async function writeJpeg(raw: Buffer, w: number, h: number, file: string, maxSide = MAX_SIDE): Promise<[number, number]> {
  let img = sharp(raw, { raw: { width: w, height: h, channels: 3 }, limitInputPixels: false });
  let ow = w;
  let oh = h;
  if (Math.max(w, h) > maxSide) {
    const s = maxSide / Math.max(w, h);
    ow = Math.round(w * s);
    oh = Math.round(h * s);
    img = img.resize(ow, oh, { kernel: "lanczos3", fit: "fill" });
  }
  const buf = await img.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  writeAtomic(file, buf);
  return [ow, oh];
}

export async function runImagery(): Promise<ImageryEntry[]> {
  const a = loadArea();
  const g = gridFromArea(a);
  const dir = areaDir(a, "imagery");
  const indexFile = join(cacheDir(a.id), "imagery-entries.json");
  const entries: ImageryEntry[] = [];
  const prev: ImageryEntry[] = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as ImageryEntry[]) : [];
  for (const spec of LAYERS) {
    const mainFile = join(dir, `${spec.id}.jpg`);
    const prevEntries = prev.filter((e) => e.id === spec.id || e.id.startsWith(`${spec.id}_`));
    const gridFile = join(cacheDir(a.id), `${spec.id}_grid.u8`);
    if (!needs(mainFile) && prevEntries.length && (!spec.gridCopy || existsSync(gridFile))) {
      log("imagery", `${spec.id}.jpg exists, skipping`);
      entries.push(...prevEntries);
      continue;
    }
    let crop: Crop | null = null;
    try {
      const { zoom: maxZ, ext } = await maxZoom(spec.layer);
      for (let z = Math.min(spec.preferZoom, maxZ); z >= Math.min(spec.preferZoom, maxZ) - 3 && !crop; z--) {
        try {
          crop = await stitch(spec, a, z, ext);
        } catch (e) {
          if (e instanceof HttpError && e.status === 404) log("imagery", `${spec.id}: z${z} unavailable, trying lower`);
          else throw e;
        }
      }
    } catch (e) {
      if (!spec.optional) throw e;
      log("imagery", `${spec.id}: skipped (${(e as Error).message})`);
      continue;
    }
    if (!crop) {
      if (spec.optional) continue;
      throw new Error(`no imagery for ${spec.id}`);
    }
    const mpp = crop.degPerPx * mPerDeg(a);
    log("imagery", `${spec.id}: crop ${crop.width}x${crop.height} px @ z${crop.zoom} (${mpp.toFixed(2)} m/px), missing tiles ${crop.missing}`);
    const [w, h] = await writeJpeg(crop.raw, crop.width, crop.height, mainFile);
    entries.push({
      id: spec.id,
      name: spec.name,
      file: `imagery/${spec.id}.jpg`,
      ...crop.bounds,
      widthPx: w,
      heightPx: h,
      source: `${spec.source}, z${crop.zoom}`,
      metersPerPixel: Number(((mpp * crop.width) / w).toFixed(3)),
    });
    if (spec.split && Math.max(crop.width, crop.height) > MAX_SIDE) {
      const xs = [0, Math.round(crop.width / 2), crop.width];
      const ys = [0, Math.round(crop.height / 2), crop.height];
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 2; c++) {
          const left = xs[c]!;
          const top = ys[r]!;
          const pw = xs[c + 1]! - left;
          const ph = ys[r + 1]! - top;
          const part = await sharp(crop.raw, { raw: { width: crop.width, height: crop.height, channels: 3 }, limitInputPixels: false })
            .extract({ left, top, width: pw, height: ph })
            .raw()
            .toBuffer();
          const name = `${spec.id}_${r}_${c}`;
          const [ow, oh] = await writeJpeg(part, pw, ph, join(dir, `${name}.jpg`));
          entries.push({
            id: name,
            name: `${spec.name}, full-res tile row ${r} col ${c} (row 0 = north)`,
            file: `imagery/${name}.jpg`,
            west: crop.bounds.west + left * crop.degPerPx,
            east: crop.bounds.west + (left + pw) * crop.degPerPx,
            north: crop.bounds.north - top * crop.degPerPx,
            south: crop.bounds.north - (top + ph) * crop.degPerPx,
            widthPx: ow,
            heightPx: oh,
            source: `${spec.source}, z${crop.zoom}`,
            metersPerPixel: Number(mpp.toFixed(3)),
          });
        }
    }
    if (spec.gridCopy) {
      // Grayscale copy on the shared grid (crop bounds match the area to < 1 image pixel).
      const gray = await sharp(crop.raw, { raw: { width: crop.width, height: crop.height, channels: 3 }, limitInputPixels: false })
        .toColourspace("b-w")
        .resize(g.width, g.height, { kernel: "cubic", fit: "fill" })
        .raw()
        .toBuffer();
      writeAtomic(gridFile, gray.subarray(0, g.width * g.height));
    }
  }
  writeJson(indexFile, entries);
  return entries;
}

if (isMain(import.meta.url)) await runImagery();
