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
 * better surface layer: `--id surface --nearest` replaces surface.u8 in place.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";
import type { LayerDType, LayerEntry } from "../../packages/core/src/types";
import { areaDir, cellCenter, gridFromArea, loadArea, log } from "./lib/area";
import { writeAtomic, writeJson } from "./lib/net";
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

const out = dtype === "float32" ? new Float32Array(g.width * g.height) : new Uint8Array(g.width * g.height);
let outside = 0;
for (let r = 0; r < g.height; r++)
  for (let c = 0; c < g.width; c++) {
    const [lon, lat] = cellCenter(g, r, c);
    const x = ((lon - b.west) / (b.east - b.west)) * sw - 0.5;
    const y = ((b.north - lat) / (b.north - b.south)) * sh - 0.5;
    let v: number;
    if (x < -0.5 || y < -0.5 || x > sw - 0.5 || y > sh - 0.5) {
      outside++;
      v = dtype === "float32" ? NaN : 0;
    } else if (nearest) {
      v = src[Math.min(sh - 1, Math.max(0, Math.round(y))) * sw + Math.min(sw - 1, Math.max(0, Math.round(x)))]!;
    } else {
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x)));
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(y)));
      const fx = Math.max(0, Math.min(1, x - x0));
      const fy = Math.max(0, Math.min(1, y - y0));
      const at = (rr: number, cc: number) => src[rr * sw + cc]!;
      v = at(y0, x0) * (1 - fx) * (1 - fy) + at(y0, x0 + 1) * fx * (1 - fy) + at(y0 + 1, x0) * (1 - fx) * fy + at(y0 + 1, x0 + 1) * fx * fy;
    }
    out[r * g.width + c] = dtype === "uint8" ? Math.round(Math.max(0, Math.min(255, v))) : v;
  }

const file = `${id}.${dtype === "float32" ? "f32" : "u8"}`;
writeAtomic(join(dir, file), new Uint8Array(out.buffer));
const entry: LayerEntry = {
  id,
  file,
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
log("import-layer", `wrote ${file}; ${outside} cells outside the input bounds; layers.json updated`);
