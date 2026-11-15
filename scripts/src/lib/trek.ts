/**
 * NASA Mars Trek WMTS tiles (equirectangular, 2^(z+1) x 2^z tiles of 256 px, top-left -180/90),
 * cached on disk under data/cache/trek/<layer>/<z>/<row>/<col>.<ext> (404s as an empty .404 file).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { cacheDir, log } from "./area";
import { cachedFile, fetchBuffer, HttpError, pool, writeAtomic } from "./net";

export const TREK = "https://trek.nasa.gov/tiles/Mars/EQ";
export const TREK_TILE = 256;

/** Degrees per pixel at zoom z. */
export const degPerPx = (z: number) => 180 / 2 ** z / TREK_TILE;

export async function trekMaxZoom(layer: string): Promise<{ zoom: number; ext: string }> {
  const file = join(cacheDir("trek", layer), "WMTSCapabilities.xml");
  const xml = (await cachedFile(`${TREK}/${layer}/1.0.0/WMTSCapabilities.xml`, file)).toString("utf8").replace(/<!--[\s\S]*?-->/g, "");
  const ids = [...xml.matchAll(/<TileMatrix>\s*<ows:Identifier>(\d+)<\/ows:Identifier>/g)].map((m) => Number(m[1]));
  const fmt = /<Format>image\/(\w+)<\/Format>/.exec(xml)?.[1] ?? "png";
  if (!ids.length) throw new Error(`no TileMatrix in capabilities for ${layer}`);
  return { zoom: Math.max(...ids), ext: fmt === "jpeg" ? "jpg" : fmt };
}

const tileFile = (layer: string, z: number, row: number, col: number, ext: string) => join(cacheDir("trek", layer, String(z), String(row)), `${col}.${ext}`);

/** One tile's bytes (downloaded once), or null if the server has no such tile. */
export async function trekTile(layer: string, z: number, row: number, col: number, ext: string): Promise<Buffer | null> {
  const file = tileFile(layer, z, row, col, ext);
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

/** Global pixel window [x0, x1) x [y0, y1) at zoom z that covers the bounds (x from -180, y from +90). */
export function pixelWindow(b: { west: number; east: number; south: number; north: number }, z: number) {
  const d = degPerPx(z);
  return {
    x0: Math.floor((b.west + 180) / d),
    x1: Math.ceil((b.east + 180) / d),
    y0: Math.floor((90 - b.north) / d),
    y1: Math.ceil((90 - b.south) / d),
  };
}

/** Download every tile covering the global pixel window (cached; 404s are remembered). Returns the count missing. */
export async function prefetchTiles(layer: string, z: number, ext: string, px: { x0: number; x1: number; y0: number; y1: number }, concurrency = 8): Promise<{ total: number; missing: number }> {
  const c0 = Math.floor(px.x0 / TREK_TILE), c1 = Math.floor((px.x1 - 1) / TREK_TILE);
  const r0 = Math.floor(px.y0 / TREK_TILE), r1 = Math.floor((px.y1 - 1) / TREK_TILE);
  const jobs: [number, number][] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) jobs.push([r, c]);
  let missing = 0, done = 0, last = 0;
  await pool(jobs, concurrency, async ([r, c]) => {
    if (!(await trekTile(layer, z, r, c, ext))) missing++;
    done++;
    if (Date.now() - last > 10_000 || done === jobs.length) {
      last = Date.now();
      log("trek", `${layer} z${z}: ${done}/${jobs.length} tiles (${missing} missing)`);
    }
  });
  return { total: jobs.length, missing };
}

/**
 * Grayscale pixels of the global pixel window [x0, x0+w) x [y0, y0+h) at zoom z, stitched from cached
 * tiles (downloaded if needed). Missing tiles and transparent pixels are 0; `valid` marks real pixels.
 */
export async function stitchGray(layer: string, z: number, ext: string, x0: number, y0: number, w: number, h: number): Promise<{ gray: Uint8Array; valid: Uint8Array }> {
  const gray = new Uint8Array(w * h);
  const valid = new Uint8Array(w * h);
  const c0 = Math.floor(x0 / TREK_TILE), c1 = Math.floor((x0 + w - 1) / TREK_TILE);
  const r0 = Math.floor(y0 / TREK_TILE), r1 = Math.floor((y0 + h - 1) / TREK_TILE);
  const jobs: [number, number][] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) jobs.push([r, c]);
  await pool(jobs, 8, async ([r, c]) => {
    const buf = await trekTile(layer, z, r, c, ext);
    if (!buf) return;
    const { data, info } = await sharp(buf).ensureAlpha().toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
    // b-w with alpha gives 2 channels (gray, alpha).
    const ch = info.channels;
    const tx = c * TREK_TILE - x0, ty = r * TREK_TILE - y0;
    for (let yy = Math.max(0, -ty); yy < info.height && ty + yy < h; yy++) {
      const so = yy * info.width * ch;
      const dy = (ty + yy) * w;
      for (let xx = Math.max(0, -tx); xx < info.width && tx + xx < w; xx++) {
        const a = ch >= 2 ? data[so + xx * ch + ch - 1]! : 255;
        if (a < 128) continue;
        gray[dy + tx + xx] = data[so + xx * ch]!;
        valid[dy + tx + xx] = 1;
      }
    }
  });
  return { gray, valid };
}
