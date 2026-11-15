/**
 * Resample an external raster onto the shared grid and register it in layers.json.
 *
 *   pnpm --filter @marsmap/scripts run import-layer -- \
 *     --id thermal_inertia --in my.f32 --width 800 --height 600 --dtype float32 \
 *     --west 137.35 --east 137.41 --south -4.84 --north -4.78 \
 *     [--units "J m-2 K-1 s-1/2"] [--source "..."] [--method "..."] [--estimated] [--nearest]
 *
 * Input: a raw little-endian grid (--dtype float32|uint8, row 0 = north) OR any image sharp
 * can read (.png/.jpg/.tif; first band used, so pass --width/--height only for raw files).
 * The input must be in a lon/lat-linear (equirectangular) layout covering the given bounds.
 * Output dtype follows the input (images -> uint8). Use --nearest for class maps, e.g. a
 * better surface layer: `--id surface --nearest` replaces the surface tiles. The layer is written as
 * tiles on the 2 m grid (tiles/<id>/…) plus an overview, like the built-in layers.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";
import type { LayerCodec, LayerDType, LayerEntry } from "../../packages/core/src/types";
import { areaDir, cellCenter, gridFromArea, loadArea, log } from "./lib/area";
import { writeAtomic, writeJson } from "./lib/net";
import { coarseGrid, deflateValues, elevationCodec, tileTemplate, U8_CODEC, writeTile } from "./lib/tiles";
import { runManifest } from "./manifest";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function need(name: string): string {
  const v = arg(name);
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
}

const a = loadArea();
const g = gridFromArea(a);
const dir = areaDir(a);
const id = need("id");
const input = need("in");
const b = { west: Number(need("west")), east: Number(need("east")), south: Number(need("south")), north: Number(need("north")) };
const nearest = process.argv.includes("--nearest");

let src: Float32Array;
let sw: number;
let sh: number;
let dtype: LayerDType;
const ext = extname(input).toLowerCase();
if ([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"].includes(ext)) {
  const { data, info } = await sharp(input, { limitInputPixels: false }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  sw = info.width;
  sh = info.height;
  src = Float32Array.from(data);
  dtype = "uint8";
} else {
  sw = Number(need("width"));
  sh = Number(need("height"));
  dtype = (arg("dtype") ?? "float32") as LayerDType;
  const buf = readFileSync(input);
  src = dtype === "float32" ? new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + sw * sh * 4)) : Float32Array.from(buf.subarray(0, sw * sh));
}
if (src.length !== sw * sh) throw new Error(`input has ${src.length} values, expected ${sw}x${sh}`);

// Resample tile row by tile row onto the 2 m grid and write tiles (as the derive step does) plus an overview.
const T = a.tileSize ?? 512;
const F = a.overviewFactor ?? 8;
const og = coarseGrid(g, F, `${g.id}-overview`);
let lo = Infinity, hi = -Infinity;
for (const v of src) if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
const codec: LayerCodec = dtype === "uint8" ? U8_CODEC : { ...elevationCodec(lo, hi), scale: Math.max(1e-6, (hi - lo) / 60000), offset: (lo + hi) / 2 };
const ov = dtype === "float32" ? new Float32Array(og.width * og.height).fill(NaN) : new Uint8Array(og.width * og.height);
const present: string[] = [];
let outside = 0;
rmSync(join(dir, "tiles", id), { recursive: true, force: true });
for (let ty = 0; ty < g.height / T; ty++) {
  const band = dtype === "float32" ? new Float32Array(g.width * T) : new Uint8Array(g.width * T);
  const has = new Uint8Array(g.width / T);
  for (let rr = 0; rr < T; rr++)
    for (let c = 0; c < g.width; c++) {
      const r = ty * T + rr;
      const [lon, lat] = cellCenter(g, r, c);
      const x = ((lon - b.west) / (b.east - b.west)) * sw - 0.5;
      const y = ((b.north - lat) / (b.north - b.south)) * sh - 0.5;
      let v: number;
      if (x < -0.5 || y < -0.5 || x > sw - 0.5 || y > sh - 0.5) {
        outside++;
        v = dtype === "float32" ? NaN : 0;
      } else {
        has[Math.floor(c / T)] = 1;
        if (nearest) {
          v = src[Math.min(sh - 1, Math.max(0, Math.round(y))) * sw + Math.min(sw - 1, Math.max(0, Math.round(x)))]!;
        } else {
          const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x)));
          const y0 = Math.max(0, Math.min(sh - 2, Math.floor(y)));
          const fx = Math.max(0, Math.min(1, x - x0));
          const fy = Math.max(0, Math.min(1, y - y0));
          const at = (r2: number, c2: number) => src[r2 * sw + c2]!;
          v = at(y0, x0) * (1 - fx) * (1 - fy) + at(y0, x0 + 1) * fx * (1 - fy) + at(y0 + 1, x0) * (1 - fx) * fy + at(y0 + 1, x0 + 1) * fx * fy;
        }
      }
      band[rr * g.width + c] = dtype === "uint8" ? Math.round(Math.max(0, Math.min(255, v))) : v;
    }
  for (let tx = 0; tx < g.width / T; tx++) {
    present.push(has[tx] ? "1" : "0");
    if (has[tx]) writeTile(dir, id, ty, tx, band, g.width, T, codec);
  }
  // Overview: centre sample of each overview cell (class maps stay classes).
  for (let oy = (ty * T) / F; oy < ((ty + 1) * T) / F; oy++)
    for (let ox = 0; ox < og.width; ox++) ov[oy * og.width + ox] = band[(oy * F + (F >> 1) - ty * T) * g.width + Math.min(g.width - 1, ox * F + (F >> 1))]!;
}
const ovFile = `overview/${id}.bin`;
writeAtomic(join(dir, ovFile), deflateValues(ov, codec, og.width));
const file = tileTemplate(id);
const entry: LayerEntry = {
  id,
  file,
  tiles: { size: T, cols: g.width / T, rows: g.height / T, present: present.join("") },
  codec,
  overview: { file: ovFile, grid: og, codec, method: "Value at the centre of each overview cell." },
  dtype,
  units: arg("units") ?? "",
  source: arg("source") ?? `imported from ${input}`,
  method: arg("method") ?? `import-layer: ${nearest ? "nearest-neighbour" : "bilinear"} resample from bounds W${b.west} E${b.east} S${b.south} N${b.north} (${sw}x${sh})`,
  version: arg("version") ?? new Date().toISOString().slice(0, 10),
  estimated: process.argv.includes("--estimated"),
};
// Record in imported-layers.json (overrides a built-in layer with the same id on every manifest rebuild).
const importedFile = join(dir, "imported-layers.json");
const imported = (existsSync(importedFile) ? (JSON.parse(readFileSync(importedFile, "utf8")) as LayerEntry[]) : []).filter((l) => l.id !== id);
imported.push(entry);
writeJson(importedFile, imported);
runManifest();
log("import-layer", `wrote ${present.filter((p) => p === "1").length} tiles of ${id}; ${outside} cells outside the input bounds; layers.json updated`);
