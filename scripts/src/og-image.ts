/**
 * Builds the 1200x630 link-preview image (apps/web/public/og.jpg) from the HiRISE picture pyramid,
 * Curiosity's track and the drill sites. Run: pnpm --filter @marsmap/scripts exec vite-node src/og-image.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const area = JSON.parse(readFileSync(join(ROOT, "config/area.json"), "utf8"));
const dir = join(ROOT, "data", area.id);
const manifest = JSON.parse(readFileSync(join(dir, "layers.json"), "utf8"));
type Pic = { id: string; group?: string; level?: number; file: string; west: number; east: number; north: number; south: number; widthPx: number; heightPx: number; metersPerPixel?: number };
const W = 1200, H = 630;
// HiRISE pyramid level closest to 2 m/px (about 4.7 x 2.5 km in the picture).
const pics = (manifest.imagery as Pic[]).filter((i) => (i.group ?? i.id) === "hirise");
const levelOf = (i: Pic) => i.level ?? 0;
const levels = [...new Set(pics.map(levelOf))];
const level = levels.reduce((best, l) => {
  const mpp = (x: number) => pics.find((p) => levelOf(p) === x)?.metersPerPixel ?? 1;
  return Math.abs(Math.log(mpp(l) / 2)) < Math.abs(Math.log(mpp(best) / 2)) ? l : best;
}, levels[0]!);
const lv = pics.filter((p) => levelOf(p) === level);
const degPx = (lv[0]!.east - lv[0]!.west) / lv[0]!.widthPx;
const west0 = Math.min(...lv.map((p) => p.west)), north0 = Math.max(...lv.map((p) => p.north));
const SRC_W = Math.round((4700 / (lv[0]!.metersPerPixel ?? 2)) | 0), SRC_H = Math.round((SRC_W * H) / W);
const px = (lon: number, lat: number): [number, number] => [(lon - west0) / degPx, (north0 - lat) / degPx];
// Centre the crop on the boxwork drill sites, shifted so the title has room on the left.
const boxwork = JSON.parse(readFileSync(join(dir, "rover/drill-sites.json"), "utf8")).sites as { lon: number; lat: number }[];
const [cx, cy] = px(boxwork.reduce((p, q) => p + q.lon, 0) / boxwork.length, boxwork.reduce((p, q) => p + q.lat, 0) / boxwork.length);
const left = Math.round(cx - SRC_W * 0.62);
const top = Math.round(cy - SRC_H / 2);
const toOut = (lon: number, lat: number) => {
  const [x, y] = px(lon, lat);
  return [((x - left) / SRC_W) * W, ((y - top) / SRC_H) * H] as const;
};
// Stitch the crop from the pieces it overlaps.
const parts: sharp.OverlayOptions[] = [];
for (const p of lv) {
  const [x0, y0] = px(p.west, p.north);
  const l = Math.max(left, Math.round(x0)), t = Math.max(top, Math.round(y0));
  const r = Math.min(left + SRC_W, Math.round(x0) + p.widthPx), b = Math.min(top + SRC_H, Math.round(y0) + p.heightPx);
  if (r <= l || b <= t) continue;
  const input = await sharp(join(dir, p.file)).extract({ left: l - Math.round(x0), top: t - Math.round(y0), width: r - l, height: b - t }).toBuffer();
  parts.push({ input, left: l - left, top: t - top });
}
const crop = await sharp({ create: { width: SRC_W, height: SRC_H, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite(parts).png().toBuffer();

const traverse = JSON.parse(readFileSync(join(dir, "rover/traverse.area.json"), "utf8"));
const lines: string[] = [];
for (const f of traverse.features) {
  const parts = f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates];
  for (const part of parts) lines.push(part.map((c: number[]) => toOut(c[0]!, c[1]!).map((v) => v.toFixed(1)).join(",")).join(" "));
}
const drills = JSON.parse(readFileSync(join(dir, "rover/drill-sites.json"), "utf8")).sites as { lon: number; lat: number }[];
const dots = drills.map((d) => toOut(d.lon, d.lat));

const font = "DejaVu Sans, Helvetica, Arial, sans-serif";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#0f0c0b" stop-opacity="0.94"/>
      <stop offset="0.48" stop-color="#0f0c0b" stop-opacity="0.72"/>
      <stop offset="0.8" stop-color="#0f0c0b" stop-opacity="0.08"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#c1440e" opacity="0.16"/>
  ${lines.map((p) => `<polyline points="${p}" fill="none" stroke="#ffffff" stroke-width="3" stroke-dasharray="7 6" stroke-linejoin="round" opacity="0.9"/>`).join("")}
  ${dots.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="#ff6a2b" stroke="#fff" stroke-width="3"/>`).join("")}
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <circle cx="92" cy="96" r="20" fill="#c1440e"/>
  <text x="126" y="105" font-family="${font}" font-size="26" font-weight="700" letter-spacing="5" fill="#f3e9e2">MARTIAN MAP</text>
  <text x="72" y="270" font-family="${font}" font-size="68" font-weight="700" fill="#ffffff">Plan a walk</text>
  <text x="72" y="350" font-family="${font}" font-size="68" font-weight="700" fill="#ff8a4c">on Mars</text>
  <text x="72" y="420" font-family="${font}" font-size="27" fill="#e6d8cf">Routes, slope, surface and walk limits</text>
  <text x="72" y="458" font-family="${font}" font-size="27" fill="#e6d8cf">at the Gale Crater boxwork.</text>
  <text x="72" y="560" font-family="${font}" font-size="19" fill="#b8a69b">NASA Space Apps 2026 · Imagery NASA/JPL/UArizona (MRO HiRISE)</text>
</svg>`;

const out = join(ROOT, "apps/web/public/og.jpg");
await sharp(crop)
  .resize(W, H)
  .modulate({ brightness: 1.05 })
  .composite([{ input: Buffer.from(svg) }])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(out);
console.log(out);
