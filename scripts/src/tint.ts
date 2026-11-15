/**
 * imagery/*.tint.jpg: Mars-coloured copies of the single-band (grayscale) visible imagery, so the app
 * shows the tint without colouring pixels at run time. Cosmetic: the brightness pattern is the data;
 * the colour is not measured. Thermal imagery shows temperature and is left alone.
 *
 * Works from the area's layers.json (fresh pipeline output or a downloaded data release), writes a
 * tinted copy next to each picture and records it as `tintFile`. Run after the manifest step.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { LayerManifest } from "../../packages/core/src/types";
import { areaDir, FORCE, isMain, loadArea, log } from "./lib/area";
import { writeAtomic, writeJson } from "./lib/net";

/** White ground becomes this; darker ground scales toward black. */
const LIGHT = [0xff, 0xb4, 0x7c];
/** Lifts pure black to a warm shadow so shaded slopes are not ink-black. */
const SHADOW = [0x1c, 0x0d, 0x07];
/** The source is already JPEG; a high quality keeps the second compression from showing. */
const QUALITY = 93;

export const tintable = (id: string) => !/themis|thermal|night/i.test(id);
export const tintFileFor = (file: string) => file.replace(/\.(jpe?g|png)$/i, "") + ".tint.jpg";

/**
 * Multiply by LIGHT, then screen with SHADOW, per channel (values 0-1):
 *   out = S + v * L * (1 - S)
 * which is one linear map per channel: out_255 = v_255 * L(1 - S) + 255 S.
 */
const SLOPE = LIGHT.map((l, i) => (l / 255) * (1 - SHADOW[i]! / 255));
const OFFSET = SHADOW;

export async function runTint(): Promise<void> {
  const a = loadArea();
  const dir = areaDir(a);
  const layersFile = join(dir, "layers.json");
  if (!existsSync(layersFile)) throw new Error(`${layersFile} missing; run the manifest step first`);
  const manifest = JSON.parse(readFileSync(layersFile, "utf8")) as LayerManifest;
  let written = 0;
  for (const im of manifest.imagery) {
    if (!tintable(im.id)) {
      delete im.tintFile;
      continue;
    }
    const src = join(dir, im.file);
    const rel = tintFileFor(im.file);
    const out = join(dir, rel);
    if (!existsSync(src)) continue;
    if (FORCE || !existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs) {
      const buf = await sharp(src, { limitInputPixels: false })
        .removeAlpha()
        .toColourspace("srgb")
        .linear(SLOPE, OFFSET)
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer();
      writeAtomic(out, buf);
      written++;
      log("tint", `${rel} (${(buf.length / 1e6).toFixed(1)} MB)`);
    }
    im.tintFile = rel;
  }
  writeJson(layersFile, manifest);
  log("tint", `${written} written, ${manifest.imagery.filter((i) => i.tintFile).length} tinted pictures in layers.json`);
}

if (isMain(import.meta.url)) await runTint();
