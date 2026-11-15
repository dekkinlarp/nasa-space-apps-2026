/**
 * Base imagery as map tiles. The pipeline ships each imagery group as one overview picture and,
 * for HiRISE, a grid of full-resolution pieces (about 10 megapixels each). Handing those to MapLibre
 * as image sources meant uploading whole 40 MB textures on the main thread whenever a piece came
 * into view, and in 3D drawing them unmipmapped into every terrain tile. Instead a marsimg://
 * protocol cuts 256 px tiles out of the decoded pictures, so MapLibre only ever uploads small tiles
 * and picks the level of detail itself.
 *
 *   marsimg://<group>/<t|r>/{z}/{x}/{y}     t = Mars tint, r = as delivered
 *
 * The Mars tint is cosmetic colouring of single-band (grayscale) visible imagery: the pixels'
 * brightness pattern is the data; the colour is not measured. The data pipeline ships it ready-made
 * (scripts/src/tint.ts writes `tintFile` beside each picture), so tinted tiles cost nothing extra here.
 */
import maplibregl from "maplibre-gl";
import type { ImageryEntry } from "@marsmap/core";
import type { AreaData } from "../types";
import { MARS_RADIUS_M, M_PER_DEG_LAT } from "../geo";
import { EARTH_RADIUS_M } from "./dem";

const SCHEME = "marsimg";
export const IMAGERY_TILE_SIZE = 256;

/** Strip a tile suffix like _0_1 / _r0_c1 so a set of pieces is one base-imagery choice. */
export const imageryGroup = (id: string) => id.replace(/[_-]r?\d+[_-]c?\d+$/, "");

interface Group {
  id: string;
  /** Pictures that cover the whole group at its coarsest resolution (usually one). */
  overview: ImageryEntry[];
  /** Full-resolution pieces, if any. */
  detail: ImageryEntry[];
  bounds: [number, number, number, number];
  /** Every picture has a Mars-tinted copy (thermal imagery has none: it shows temperature, not the ground). */
  tinted: boolean;
}

let base = "";
const groups = new Map<string, Group>();

/** Mars metres per pixel of a picture. */
const mpp = (im: ImageryEntry) => im.metersPerPixel ?? ((im.east - im.west) * M_PER_DEG_LAT * Math.cos((((im.north + im.south) / 2) * Math.PI) / 180)) / im.widthPx;

export function setImageryArea(area: AreaData) {
  base = area.base;
  groups.clear();
  for (const im of area.manifest.imagery) {
    const id = imageryGroup(im.id);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { id, overview: [], detail: [], bounds: [im.west, im.south, im.east, im.north], tinted: true }));
    g.tinted &&= !!im.tintFile;
    (im.id === id ? g.overview : g.detail).push(im);
    g.bounds = [Math.min(g.bounds[0], im.west), Math.min(g.bounds[1], im.south), Math.max(g.bounds[2], im.east), Math.max(g.bounds[3], im.north)];
  }
  for (const g of groups.values()) {
    // A group delivered only in pieces draws them at every zoom.
    if (!g.overview.length) [g.overview, g.detail] = [g.detail, []];
  }
  pictures.clear();
}

export const imageryGroups = () => [...groups.values()];

/** True when the group ships Mars-tinted pictures. */
export const tintable = (group: string) => !!groups.get(group)?.tinted;

export const imageryTilesUrl = (group: string, tint: boolean) => `${SCHEME}://${group}/${tint && tintable(group) ? "t" : "r"}/{z}/{x}/{y}`;

/** Zoom at which one tile pixel is about one pixel of the group's sharpest picture (MapLibre over-zooms beyond it). */
export function imageryMaxZoom(g: Group): number {
  const finest = Math.min(...[...g.overview, ...g.detail].map(mpp));
  const lat = ((g.bounds[1] + g.bounds[3]) / 2) * (Math.PI / 180);
  // The map draws a Mars degree as an Earth degree, so a Mars metre is R_earth / R_mars map metres.
  const mapMpp = finest * (EARTH_RADIUS_M / MARS_RADIUS_M);
  const z = Math.log2((2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat)) / IMAGERY_TILE_SIZE / mapMpp);
  return Math.max(0, Math.min(22, Math.ceil(z - 0.1)));
}

// ---------- decoded pictures (decoded off the main thread by createImageBitmap) ----------

const pictures = new Map<string, Promise<ImageBitmap>>();
/** Full-resolution pieces are ~40 MB each decoded; keep only the most recently used few. */
const MAX_PICTURES = 8;

function picture(file: string): Promise<ImageBitmap> {
  let p = pictures.get(file);
  if (p) {
    pictures.delete(file);
    pictures.set(file, p);
    return p;
  }
  p = (async () => {
    const res = await fetch(`${base}/${file}`);
    if (!res.ok) throw new Error(`imagery ${res.status} ${file}`);
    return createImageBitmap(await res.blob());
  })();
  p.catch(() => pictures.delete(file));
  pictures.set(file, p);
  // Dropped pictures are not closed: a tile may still be drawing from one. They are freed once unreferenced.
  while (pictures.size > MAX_PICTURES) pictures.delete(pictures.keys().next().value!);
  return p;
}

// ---------- tiles ----------

const lonOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const mercY = (lat: number) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
const latOf = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

let canvas: OffscreenCanvas | null = null;

async function renderTile(g: Group, tint: boolean, z: number, x: number, y: number, signal: AbortSignal): Promise<ImageBitmap> {
  const S = IMAGERY_TILE_SIZE;
  const W = lonOf(x, z), E = lonOf(x + 1, z), N = latOf(y, z), Sth = latOf(y + 1, z);
  const y0 = mercY(N), y1 = mercY(Sth);
  const hits = (im: ImageryEntry) => im.west < E && im.east > W && im.south < N && im.north > Sth;
  // Full-resolution pieces once the tile is sharper than the overview can show.
  const tileMpp = ((E - W) * M_PER_DEG_LAT * Math.cos((((N + Sth) / 2) * Math.PI) / 180)) / S;
  const overview = g.overview.filter(hits);
  const detail = g.detail.length && tileMpp < Math.min(...g.overview.map(mpp)) * 0.75 ? g.detail.filter(hits) : [];
  const ims = [...overview, ...detail];
  const bitmaps = await Promise.all(ims.map((im) => picture(tint && im.tintFile ? im.tintFile : im.file)));
  if (signal.aborted) throw new DOMException("aborted", "AbortError");

  canvas ??= new OffscreenCanvas(S, S);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, S, S);
  ctx.imageSmoothingQuality = "medium";
  ims.forEach((im, i) => {
    const bmp = bitmaps[i]!;
    // Part of the picture inside the tile, in picture pixels (rows are linear in latitude) ...
    const w = Math.max(W, im.west), e = Math.min(E, im.east), n = Math.min(N, im.north), s = Math.max(Sth, im.south);
    const sx = ((w - im.west) / (im.east - im.west)) * bmp.width, sw = ((e - w) / (im.east - im.west)) * bmp.width;
    const sy = ((im.north - n) / (im.north - im.south)) * bmp.height, sh = ((n - s) / (im.north - im.south)) * bmp.height;
    // ... and in tile pixels (rows are Web Mercator).
    const dx = ((w - W) / (E - W)) * S, dw = ((e - w) / (E - W)) * S;
    const dy = ((mercY(n) - y0) / (y1 - y0)) * S, dh = ((mercY(s) - mercY(n)) / (y1 - y0)) * S;
    if (sw > 0 && sh > 0) ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
  });
  return canvas.transferToImageBitmap();
}

let registered = false;
export function registerImageryProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(SCHEME, async (params, abort) => {
    const m = /^marsimg:\/\/([^/]+)\/([tr])\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    const g = m && groups.get(m[1]!);
    if (!m || !g) throw new Error(`bad imagery url ${params.url}`);
    // An ImageBitmap goes straight to MapLibre: no encode here and no decode on its side.
    return { data: await renderTile(g, m[2] === "t", Number(m[3]), Number(m[4]), Number(m[5]), abort.signal) };
  });
}
