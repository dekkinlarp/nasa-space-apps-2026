/**
 * Base imagery as map tiles. The pipeline ships each imagery group as a pyramid of pictures: level 0
 * at full resolution in pieces of at most 2048 px, each level up 4x coarser, up to one picture of the
 * whole region (older data: one overview picture plus full-resolution pieces). Handing those to
 * MapLibre as image sources meant uploading whole textures on the main thread whenever a piece came
 * into view, and in 3D drawing them unmipmapped into every terrain tile. Instead a marsimg://
 * protocol cuts 256 px tiles out of the decoded pictures of the level that matches the tile's zoom,
 * so MapLibre only ever uploads small tiles and picks the level of detail itself.
 *
 *   marsimg://<group>/<t|r>/{z}/{x}/{y}     t = Mars tint, r = as delivered
 *
 * The Mars tint is cosmetic colouring of single-band (grayscale) visible imagery: the pixels'
 * brightness pattern is the data; the colour is not measured. Pictures marked `gray` are tinted here
 * with two canvas blend fills per tile (multiply by LIGHT, then screen with SHADOW); older data ships
 * ready-tinted copies (`tintFile`).
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
/** The base-imagery choice a picture belongs to. */
export const pictureGroup = (im: ImageryEntry) => im.group ?? imageryGroup(im.id);

/** Mars tint: white ground becomes LIGHT, black is lifted to SHADOW (same as the old pipeline step). */
const LIGHT = "#ffb47c";
const SHADOW = "#1c0d07";

interface Group {
  id: string;
  /** Pictures by pyramid level, finest (0) first; each level tiles the group. */
  levels: { mpp: number; pics: ImageryEntry[] }[];
  bounds: [number, number, number, number];
  /** Every picture can be shown Mars-tinted (thermal imagery cannot: it shows temperature, not the ground). */
  tinted: boolean;
}

let base = "";
const groups = new Map<string, Group>();

/** Mars metres per pixel of a picture. */
const mpp = (im: ImageryEntry) => im.metersPerPixel ?? ((im.east - im.west) * M_PER_DEG_LAT * Math.cos((((im.north + im.south) / 2) * Math.PI) / 180)) / im.widthPx;

export function setImageryArea(area: AreaData) {
  base = area.base;
  groups.clear();
  const byLevel = new Map<string, Map<number, ImageryEntry[]>>();
  for (const im of area.manifest.imagery) {
    const id = pictureGroup(im);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { id, levels: [], bounds: [im.west, im.south, im.east, im.north], tinted: true }));
    g.tinted &&= !!im.tintFile || !!im.gray;
    // Older data: the picture named like the group is the overview, the rest are full-resolution pieces.
    const level = im.level ?? (im.id === id ? 1 : 0);
    const lv = byLevel.get(id) ?? byLevel.set(id, new Map()).get(id)!;
    lv.set(level, [...(lv.get(level) ?? []), im]);
    g.bounds = [Math.min(g.bounds[0], im.west), Math.min(g.bounds[1], im.south), Math.max(g.bounds[2], im.east), Math.max(g.bounds[3], im.north)];
  }
  for (const [id, lv] of byLevel) {
    groups.get(id)!.levels = [...lv.entries()].sort((a, b) => a[0] - b[0]).map(([, pics]) => ({ mpp: Math.min(...pics.map(mpp)), pics }));
  }
  pictures.clear();
}

export const imageryGroups = () => [...groups.values()];

/** True when the group ships Mars-tinted pictures. */
export const tintable = (group: string) => !!groups.get(group)?.tinted;

export const imageryTilesUrl = (group: string, tint: boolean) => `${SCHEME}://${group}/${tint && tintable(group) ? "t" : "r"}/{z}/{x}/{y}`;

/** Zoom at which one tile pixel is about one pixel of the group's sharpest picture (MapLibre over-zooms beyond it). */
export function imageryMaxZoom(g: Group): number {
  const finest = g.levels[0]?.mpp ?? 1;
  const lat = ((g.bounds[1] + g.bounds[3]) / 2) * (Math.PI / 180);
  // The map draws a Mars degree as an Earth degree, so a Mars metre is R_earth / R_mars map metres.
  const mapMpp = finest * (EARTH_RADIUS_M / MARS_RADIUS_M);
  const z = Math.log2((2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat)) / IMAGERY_TILE_SIZE / mapMpp);
  return Math.max(0, Math.min(22, Math.ceil(z - 0.1)));
}

// ---------- decoded pictures (decoded off the main thread by createImageBitmap) ----------

const pictures = new Map<string, Promise<ImageBitmap>>();
/** A 2048 px piece is 16 MB decoded; keep only the most recently used. */
const MAX_PICTURES = 20;

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

function renderTile(g: Group, tint: boolean, z: number, x: number, y: number, signal: AbortSignal): Promise<ImageBitmap> {
  return renderBounds(g, tint, lonOf(x, z), lonOf(x + 1, z), latOf(y, z), latOf(y + 1, z), signal);
}

/**
 * One square picture of a base-imagery choice over any bounds, drawn the way the map draws it (same
 * pyramid level, same tint). The Layers tab uses it for its previews. Null for an unknown group.
 */
export function imageryPreview(group: string, tint: boolean, b: { west: number; east: number; north: number; south: number }, signal: AbortSignal): Promise<ImageBitmap> | null {
  const g = groups.get(group);
  return g ? renderBounds(g, tint && g.tinted, b.west, b.east, b.north, b.south, signal) : null;
}

async function renderBounds(g: Group, tint: boolean, W: number, E: number, N: number, Sth: number, signal: AbortSignal): Promise<ImageBitmap> {
  const S = IMAGERY_TILE_SIZE;
  const y0 = mercY(N), y1 = mercY(Sth);
  const hits = (im: ImageryEntry) => im.west < E && im.east > W && im.south < N && im.north > Sth;
  // The coarsest level that is still about as sharp as the tile (finest level when zoomed past it).
  const tileMpp = ((E - W) * M_PER_DEG_LAT * Math.cos((((N + Sth) / 2) * Math.PI) / 180)) / S;
  let lv = g.levels[0];
  for (const l of g.levels) if (l.mpp <= tileMpp * 1.33) lv = l;
  const ims = (lv?.pics ?? []).filter(hits);
  const selfTint = (im: ImageryEntry) => tint && !im.tintFile && !!im.gray;
  const bitmaps = await Promise.all(ims.map((im) => picture(tint && im.tintFile ? im.tintFile : im.file)));
  if (signal.aborted) throw new DOMException("aborted", "AbortError");

  canvas ??= new OffscreenCanvas(S, S);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, S, S);
  ctx.imageSmoothingQuality = "medium";
  const tintRects: [number, number, number, number][] = [];
  ims.forEach((im, i) => {
    const bmp = bitmaps[i]!;
    // Part of the picture inside the tile, in picture pixels (rows are linear in latitude) ...
    const w = Math.max(W, im.west), e = Math.min(E, im.east), n = Math.min(N, im.north), s = Math.max(Sth, im.south);
    const sx = ((w - im.west) / (im.east - im.west)) * bmp.width, sw = ((e - w) / (im.east - im.west)) * bmp.width;
    const sy = ((im.north - n) / (im.north - im.south)) * bmp.height, sh = ((n - s) / (im.north - im.south)) * bmp.height;
    // ... and in tile pixels (rows are Web Mercator).
    const dx = ((w - W) / (E - W)) * S, dw = ((e - w) / (E - W)) * S;
    const dy = ((mercY(n) - y0) / (y1 - y0)) * S, dh = ((mercY(s) - mercY(n)) / (y1 - y0)) * S;
    if (sw > 0 && sh > 0) {
      ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
      if (selfTint(im)) tintRects.push([dx, dy, dw, dh]);
    }
  });
  if (tintRects.length) {
    // Multiply by LIGHT, then screen with SHADOW, only over the pictures drawn (not the empty ground).
    ctx.save();
    ctx.beginPath();
    for (const r of tintRects) ctx.rect(...r);
    ctx.clip();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = LIGHT;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = SHADOW;
    ctx.fillRect(0, 0, S, S);
    ctx.restore();
  }
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
