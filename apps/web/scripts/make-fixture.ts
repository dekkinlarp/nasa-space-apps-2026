/**
 * Writes a SYNTHETIC dataset to data/fixture/ in the same format the data pipeline
 * produces for data/gale-boxwork/, so the web app can be developed before the real
 * data exists. Nothing in here is real Mars data. Run: pnpm --filter @marsmap/web fixture
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = join(ROOT, "data", "fixture");
const area = JSON.parse(readFileSync(join(ROOT, "config", "area.json"), "utf8"));

const W = 750;
const H = 750;
const grid = {
  id: "fixture",
  south: area.south,
  north: area.north,
  west: area.west,
  east: area.east,
  width: W,
  height: H,
  cellSizeM: 4,
  marsRadiusM: area.marsRadiusM,
};

// ---------- deterministic noise ----------
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const seeds: [number, number][] = Array.from({ length: 420 }, () => [rand() * W, rand() * H]);
const bucket = new Map<string, [number, number][]>();
const B = 40;
for (const s of seeds) {
  const k = `${Math.floor(s[0] / B)},${Math.floor(s[1] / B)}`;
  (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(s);
}
function worley(x: number, y: number): [number, number] {
  let f1 = 1e9, f2 = 1e9;
  const bx = Math.floor(x / B), by = Math.floor(y / B);
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++)
      for (const s of bucket.get(`${bx + dx},${by + dy}`) ?? []) {
        const d = Math.hypot(s[0] - x, s[1] - y);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
  return [f1, f2];
}
const smooth = (x: number, y: number) =>
  Math.sin(x * 0.011) * Math.cos(y * 0.013) * 6 + Math.sin((x + y) * 0.004) * 10;

// ---------- elevation ----------
const elev = new Float32Array(W * H);
const ridge = new Float32Array(W * H);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    const [f1, f2] = worley(c, r);
    const edge = f2 - f1; // small near cell boundaries -> ridges
    const rd = Math.max(0, 1 - edge / 3.2);
    // Boxwork is confined to a band across the middle of the area.
    const band = Math.exp(-(((r - 380) / 230) ** 2)) * (c > 80 ? 1 : 0.2);
    ridge[r * W + c] = rd * band;
    elev[r * W + c] = -4450 + (H - r) * 0.09 + c * 0.02 + smooth(c, r) + rd * band * 2.2 - (1 - rd) * band * 0.4;
  }

// ---------- slope ----------
const slope = new Float32Array(W * H);
const cs = grid.cellSizeM;
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    const at = (rr: number, cc: number) => elev[Math.min(H - 1, Math.max(0, rr)) * W + Math.min(W - 1, Math.max(0, cc))]!;
    const dzdx = (at(r, c + 1) - at(r, c - 1)) / (2 * cs);
    const dzdy = (at(r + 1, c) - at(r - 1, c)) / (2 * cs);
    slope[r * W + c] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  }

// ---------- surface classes ----------
const surface = new Uint8Array(W * H);
const conf = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const rg = ridge[i]!;
  const s = slope[i]!;
  let cls = 2;
  if (rg > 0.45) cls = 1;
  else if (rg < 0.05 && Math.exp(-(((Math.floor(i / W) - 380) / 230) ** 2)) > 0.5) cls = 3;
  if (s > 18) cls = 4;
  surface[i] = cls;
  conf[i] = Math.round(120 + 100 * Math.abs(rg - 0.3));
}

// ---------- PNG writer ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, rgb: Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function shaded(scale: number, tint: [number, number, number], noise: number) {
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = Math.min(H - 2, Math.floor(y / scale)), c = Math.min(W - 2, Math.floor(x / scale));
      const i = r * W + c;
      const dx = elev[i + 1]! - elev[i]!, dy = elev[i + W]! - elev[i]!;
      let v = 0.55 + (-dx * 0.7 + dy * 0.7) * 0.35;
      if (surface[i] === 3) v += 0.12;
      v += (rand() - 0.5) * noise;
      v = Math.max(0, Math.min(1, v));
      out[(y * w + x) * 3] = v * tint[0]; out[(y * w + x) * 3 + 1] = v * tint[1]; out[(y * w + x) * 3 + 2] = v * tint[2];
    }
  return { w, h, data: png(w, h, out) };
}

// ---------- write ----------
mkdirSync(join(OUT, "imagery"), { recursive: true });
mkdirSync(join(OUT, "rover", "photos"), { recursive: true });
const write = (p: string, d: Buffer | string) => writeFileSync(join(OUT, p), d);
write("grid.json", JSON.stringify(grid, null, 2));
write("elevation.f32", Buffer.from(elev.buffer));
write("slope.f32", Buffer.from(slope.buffer));
write("surface.u8", Buffer.from(surface.buffer));
write("surface_confidence.u8", Buffer.from(conf.buffer));
const hi = shaded(2, [235, 205, 180], 0.08);
const ctx = shaded(0.5, [220, 170, 130], 0.03);
write("imagery/hirise.png", hi.data);
write("imagery/ctx.png", ctx.data);

const bounds = { south: grid.south, north: grid.north, west: grid.west, east: grid.east };
const manifest = {
  grid,
  layers: [
    { id: "elevation", file: "elevation.f32", dtype: "float32", units: "m", source: "SYNTHETIC fixture (apps/web/scripts/make-fixture.ts)", method: "Worley-noise ridges on a tilted plane", version: "fixture-1", estimated: true },
    { id: "slope", file: "slope.f32", dtype: "float32", units: "deg", source: "SYNTHETIC fixture", method: "central differences of fixture elevation", version: "fixture-1", estimated: true },
    { id: "surface", file: "surface.u8", dtype: "uint8", units: "class", nodata: 255, source: "SYNTHETIC fixture", method: "ridges=bedrock, hollows=sand, steep=rubble", version: "fixture-1", estimated: true },
    { id: "surface_confidence", file: "surface_confidence.u8", dtype: "uint8", units: "0-255", source: "SYNTHETIC fixture", method: "random", version: "fixture-1", estimated: true },
  ],
  imagery: [
    { id: "hirise", name: "HiRISE (synthetic stand-in)", file: "imagery/hirise.png", ...bounds, widthPx: hi.w, heightPx: hi.h, source: "SYNTHETIC hillshade — not a real photo", metersPerPixel: 2 },
    { id: "ctx", name: "CTX (synthetic stand-in)", file: "imagery/ctx.png", ...bounds, widthPx: ctx.w, heightPx: ctx.h, source: "SYNTHETIC hillshade — not a real photo", metersPerPixel: 8 },
  ],
  generatedAt: new Date().toISOString(),
};
write("layers.json", JSON.stringify(manifest, null, 2));

// rover: a wandering track through the middle of the area
const lonOf = (c: number) => grid.west + ((c + 0.5) / W) * (grid.east - grid.west);
const latOf = (r: number) => grid.north - ((r + 0.5) / H) * (grid.north - grid.south);
const track: [number, number][] = [];
for (let t = 0; t <= 1; t += 0.01) track.push([lonOf(120 + t * 520), latOf(640 - t * 420 + Math.sin(t * 9) * 40)]);
write("rover/traverse.area.json", JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Curiosity traverse (synthetic)" }, geometry: { type: "LineString", coordinates: track } }] }));
const waypoints = track.filter((_, i) => i % 10 === 0).map((p, i) => ({
  type: "Feature",
  properties: { sol: 4669 + i * 8, site: 100 + i, drive: 0, elevationM: -4400 - i, tiltDeg: Math.round(rand() * 80) / 10 },
  geometry: { type: "Point", coordinates: p },
}));
write("rover/waypoints.area.json", JSON.stringify({ type: "FeatureCollection", features: waypoints }));
const photos = waypoints.slice(0, 6).map((w, i) => {
  const img = shaded(0.12, [230, 180, 140], 0.25);
  const file = `rover/photos/fixture_${i}.png`;
  write(file, img.data);
  return { sol: w.properties.sol, lon: w.geometry.coordinates[0], lat: w.geometry.coordinates[1], elevationM: w.properties.elevationM, file, instrument: "SYNTHETIC", dateTaken: "2025-07-01", credit: "fixture (not a real photo)", sourceUrl: "https://mars.nasa.gov/msl/multimedia/raw-images/" };
});
write("rover/photos.json", JSON.stringify(photos, null, 2));
write("rover/drill-sites.json", JSON.stringify([
  { name: "Altadena", sol: 4578, lon: 137.384, lat: -4.799, note: "synthetic fixture coordinate" },
  { name: "Valle de la Luna", sol: 4709, lon: 137.3810, lat: -4.80795, note: "synthetic fixture coordinate" },
  { name: "Nevado Sajama", sol: 4714, lon: 137.38108, lat: -4.80803, note: "synthetic fixture coordinate" },
], null, 2));
write("conditions.json", JSON.stringify({
  source: "SYNTHETIC fixture values",
  observedFrom: "2025-07-01", observedTo: "2025-07-08", sols: [4700, 4707],
  airTempC: { min: -78, max: -8 }, groundTempC: { min: -85, max: 5 },
  pressurePa: 740, uvIndex: "moderate", sunrise: "06:05", sunset: "18:10",
  radiation: { mSvPerDay: 0.67, source: "Typical MSL RAD surface dose rate" },
}, null, 2));
console.log(`fixture written to ${OUT}`);
