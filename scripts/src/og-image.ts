/**
 * Builds the 1200x630 link-preview image (apps/web/public/og.jpg) from the HiRISE mosaic,
 * Curiosity's track and the drill sites. Run: pnpm --filter @marsmap/scripts exec tsx src/og-image.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const area = JSON.parse(readFileSync(join(ROOT, "config/area.json"), "utf8"));
const dir = join(ROOT, "data", area.id);
const manifest = JSON.parse(readFileSync(join(dir, "layers.json"), "utf8"));
const img = manifest.imagery.find((i: { id: string }) => i.id === "hirise");
const W = 1200, H = 630, SRC_W = 2400, SRC_H = 1260;

const px = (lon: number, lat: number): [number, number] => [
  ((lon - img.west) / (img.east - img.west)) * img.widthPx,
  ((img.north - lat) / (img.north - img.south)) * img.heightPx,
];
// Centre the crop on the boxwork, shifted so the title has room on the left.
const [cx, cy] = px(area.centerLon, area.centerLat);
const left = Math.round(Math.min(Math.max(cx - SRC_W * 0.62, 0), img.widthPx - SRC_W));
const top = Math.round(Math.min(Math.max(cy - SRC_H / 2, 0), img.heightPx - SRC_H));
const toOut = (lon: number, lat: number) => {
  const [x, y] = px(lon, lat);
  return [((x - left) / SRC_W) * W, ((y - top) / SRC_H) * H] as const;
};

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
await sharp(join(dir, img.file))
  .extract({ left, top, width: SRC_W, height: SRC_H })
  .resize(W, H)
  .modulate({ brightness: 1.05 })
  .composite([{ input: Buffer.from(svg) }])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(out);
console.log(out);
