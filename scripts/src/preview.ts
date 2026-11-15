/** Quick-look PNGs in data/<area>/preview/ for eyeballing the layers against the photo. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { readOverview } from "../../packages/core/src/tiles";
import type { LayerManifest } from "../../packages/core/src/types";
import { areaDir, isMain, loadArea, loadSurfaceClasses, log } from "./lib/area";
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
  const dir = areaDir(a);
  const out = areaDir(a, "preview");
  const manifest = JSON.parse(readFileSync(join(dir, "layers.json"), "utf8")) as LayerManifest;
  const fetchBinary = async (f: string) => {
    const b = readFileSync(join(dir, f));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const ov = async (id: string) => {
    const e = manifest.layers.find((l) => l.id === id);
    return e ? readOverview(e, manifest.grid, fetchBinary) : null;
  };
  // Quick-looks are drawn from the overviews (the whole region at full resolution would be 330 Mpx).
  const e = await ov("elevation");
  if (!e) throw new Error("no elevation overview");
  const g = e.grid;
  const W = g.width;
  const H = g.height;
  const N = W * H;
  const elev = e.data as Float32Array;
  const slope = ((await ov("slope"))?.data as Float32Array | undefined) ?? new Float32Array(N);
  const { dx, dy } = cellSizes(g);
  const hs = hillshade(Float32Array.from(elev, (v) => (Number.isNaN(v) ? 0 : v)), W, H, dx, dy, 315, 35, 2);
  await sharp(Buffer.from(hs), { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(out, "hillshade.png"));

  let mn = Infinity;
  let mx = -Infinity;
  for (const v of elev) if (!Number.isNaN(v)) (mn = Math.min(mn, v)), (mx = Math.max(mx, v));
  const er = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(elev[i]!)) continue;
    const c = ramp((elev[i]! - mn) / (mx - mn));
    const s = 0.35 + 0.65 * (hs[i]! / 255);
    for (let j = 0; j < 3; j++) er[i * 3 + j] = Math.round(c[j]! * s);
  }
  await sharp(er, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(out, "elevation.png"));

  const sr = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(slope[i]!)) continue;
    const c = ramp(slope[i]! / 40);
    for (let j = 0; j < 3; j++) sr[i * 3 + j] = c[j]!;
  }
  await sharp(sr, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(out, "slope.png"));

  const surf = (await ov("surface"))?.data as Uint8Array | undefined;
  if (surf) {
    const colors = new Map(loadSurfaceClasses().map((c) => [c.id, hex(c.color)]));
    const cr = Buffer.alloc(N * 3);
    for (let i = 0; i < N; i++) {
      const c = colors.get(surf[i]!) ?? [255, 0, 255];
      const s = 0.6 + 0.4 * (hs[i]! / 255);
      for (let j = 0; j < 3; j++) cr[i * 3 + j] = Math.round(c[j]! * s);
    }
    await sharp(cr, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(out, "surface.png"));
    const conf = (await ov("surface_confidence"))?.data as Uint8Array | undefined;
    if (conf) await sharp(Buffer.from(conf), { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(out, "surface_confidence.png"));
  }

  // Alignment check: the coarsest HiRISE picture (red) over the hillshade (cyan).
  const pics = manifest.imagery.filter((i) => (i.group ?? i.id) === "hirise");
  const topLevel = Math.max(...pics.map((i) => i.level ?? 0));
  const top = pics.filter((i) => (i.level ?? 0) === topLevel);
  if (top.length === 1 && existsSync(join(dir, top[0]!.file))) {
    const photo = await sharp(join(dir, top[0]!.file)).resize(W, H, { fit: "fill" }).greyscale().toColourspace("b-w").raw().toBuffer();
    const blend = Buffer.alloc(N * 3);
    for (let i = 0; i < N; i++) {
      blend[i * 3] = photo[i]!;
      blend[i * 3 + 1] = hs[i]!;
      blend[i * 3 + 2] = hs[i]!;
    }
    await sharp(blend, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(out, "align_photo_red_hillshade_cyan.png"));
  }
  log("preview", `wrote quick-looks to ${out}`);
}

if (isMain(import.meta.url)) await runPreview();
