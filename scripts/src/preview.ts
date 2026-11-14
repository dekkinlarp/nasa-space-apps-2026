/** Quick-look PNGs in data/<area>/preview/ for eyeballing the layers against the photo. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { areaDir, gridFromArea, isMain, loadArea, loadSurfaceClasses, log } from "./lib/area";
import { readF32 } from "./lib/demgrid";
import { hillshade } from "./lib/raster";
import { cellSizes } from "./derive";

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Simple perceptual-ish ramp (dark blue -> green -> yellow -> red). */
function ramp(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [30, 40, 120]],
    [0.25, [40, 140, 160]],
    [0.5, [120, 190, 80]],
    [0.75, [240, 200, 50]],
    [1, [200, 40, 30]],
  ];
  t = Math.max(0, Math.min(1, t));
  for (let k = 1; k < stops.length; k++) {
    const [t1, c1] = stops[k]!;
    const [t0, c0] = stops[k - 1]!;
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j]! + f * (c1[j]! - c0[j]!))) as [number, number, number];
    }
  }
  return stops[stops.length - 1]![1];
}

export async function runPreview(): Promise<void> {
  const a = loadArea();
  const g = gridFromArea(a);
  const dir = areaDir(a);
  const out = areaDir(a, "preview");
  const W = g.width;
  const H = g.height;
  const N = W * H;
  const elev = readF32(join(dir, "elevation.f32"));
  const slope = readF32(join(dir, "slope.f32"));
  const { dx, dy } = cellSizes(g);
  const hs = hillshade(elev, W, H, dx, dy, 315, 35, 2);
  await sharp(Buffer.from(hs), { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(out, "hillshade.png"));

  // colour-relief elevation blended with hillshade
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of elev) {
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
  const er = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    const c = ramp((elev[i]! - mn) / (mx - mn));
    const s = 0.35 + 0.65 * (hs[i]! / 255);
    for (let j = 0; j < 3; j++) er[i * 3 + j] = Math.round(c[j]! * s);
  }
  await sharp(er, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(out, "elevation.png"));

  const sr = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    const c = ramp(slope[i]! / 40);
    for (let j = 0; j < 3; j++) sr[i * 3 + j] = c[j]!;
  }
  await sharp(sr, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(out, "slope.png"));

  const surfFile = join(dir, "surface.u8");
  if (existsSync(surfFile)) {
    const surf = readFileSync(surfFile);
    const colors = new Map(loadSurfaceClasses().map((c) => [c.id, hex(c.color)]));
    const cr = Buffer.alloc(N * 3);
    for (let i = 0; i < N; i++) {
      const c = colors.get(surf[i]!) ?? [255, 0, 255];
      const s = 0.6 + 0.4 * (hs[i]! / 255);
      for (let j = 0; j < 3; j++) cr[i * 3 + j] = Math.round(c[j]! * s);
    }
    await sharp(cr, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(out, "surface.png"));
    const conf = readFileSync(join(dir, "surface_confidence.u8"));
    await sharp(conf, { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(out, "surface_confidence.png"));
  }

  // Alignment check: HiRISE (left) | hillshade (right), plus a red/cyan blend.
  const hiriseFile = join(dir, "imagery", "hirise.jpg");
  if (existsSync(hiriseFile)) {
    const photo = await sharp(hiriseFile).resize(W, H, { fit: "fill" }).greyscale().toColourspace("b-w").raw().toBuffer();
    const blend = Buffer.alloc(N * 3);
    for (let i = 0; i < N; i++) {
      blend[i * 3] = photo[i]!;
      blend[i * 3 + 1] = hs[i]!;
      blend[i * 3 + 2] = hs[i]!;
    }
    await sharp(blend, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(out, "align_photo_red_hillshade_cyan.png"));
    // zoomed (up to) 400x400-cell crops around the centre, side by side
    const S = Math.min(400, W, H);
    const cx = Math.floor((W - S) / 2);
    const cy = Math.floor((H - S) / 2);
    const ph = await sharp(photo, { raw: { width: W, height: H, channels: 1 } }).extract({ left: cx, top: cy, width: S, height: S }).png().toBuffer();
    const hh = await sharp(Buffer.from(hs), { raw: { width: W, height: H, channels: 1 } }).extract({ left: cx, top: cy, width: S, height: S }).png().toBuffer();
    await sharp({ create: { width: 2 * S + 10, height: S, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([
        { input: ph, left: 0, top: 0 },
        { input: hh, left: S + 10, top: 0 },
      ])
      .png()
      .toFile(join(out, "align_centre_photo_vs_hillshade.png"));
  }
  log("preview", `wrote quick-looks to ${out}`);
}

if (isMain(import.meta.url)) await runPreview();
