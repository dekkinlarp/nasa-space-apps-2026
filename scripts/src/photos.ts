/**
 * rover/photos/: 1-3 Curiosity raw images (Navcam / Mastcam full frames, end of sol) for
 * ~36 waypoints spread across the sols spent inside the area, resized to <= 1280 px wide.
 *
 * API notes (explored 2026-11): `&sol=N` returns every image of that sol in one response
 * (num/page are ignored); `search=` / `extended=sample_type::full,` work but then the sol
 * filter is ignored, so we filter by instrument + sample_type client-side.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { areaDir, cacheDir, isMain, loadArea, log, needs } from "./lib/area";
import { cachedFile, fetchBuffer, pool, writeAtomic, writeJson } from "./lib/net";
import { runRover, type Waypoint } from "./rover";

const TARGET_WAYPOINTS = 36;
const PER_WAYPOINT = 3;
const API = (sol: number) => `https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json&num=50&page=0&order=sol+desc&&sol=${sol}`;
const MUST_INCLUDE_SOLS = [4548, 4687, 4711];

interface RawImage {
  sol: number;
  imageid: string;
  image_files: { full_res: string; large?: string; medium?: string };
  camera: { instrument: string };
  sample_type: string;
  date_taken_utc: string;
  credit: string;
  link: string;
}

export interface PhotoEntry {
  sol: number;
  lon: number;
  lat: number;
  elevationM: number;
  file: string;
  instrument: string;
  dateTaken: string;
  credit: string;
  sourceUrl: string;
  pageUrl: string;
  widthPx: number;
  heightPx: number;
}

function pickWaypoints(wps: Waypoint[]): Waypoint[] {
  // one waypoint per sol (the last drive of the sol), then evenly spaced
  const bySol = new Map<number, Waypoint>();
  for (const w of wps) bySol.set(w.sol, w);
  const uniq = [...bySol.values()].sort((a, b) => a.sol - b.sol);
  const chosen = new Set<Waypoint>();
  for (let k = 0; k < TARGET_WAYPOINTS; k++) chosen.add(uniq[Math.round((k * (uniq.length - 1)) / (TARGET_WAYPOINTS - 1))]!);
  for (const s of MUST_INCLUDE_SOLS) {
    const w = bySol.get(s);
    if (w) chosen.add(w);
  }
  return [...chosen].sort((a, b) => a.sol - b.sol);
}

/** Ordered candidates: end-of-sol Navcam left frames (spread), then Mastcam, then other full frames. */
function candidates(imgs: RawImage[]): RawImage[] {
  const full = imgs.filter((i) => i.sample_type === "full" && i.image_files?.full_res);
  const latestFirst = (a: RawImage, b: RawImage) => b.date_taken_utc.localeCompare(a.date_taken_utc);
  const nav = full.filter((i) => i.camera.instrument === "NAV_LEFT_B").sort(latestFirst).slice(0, 16);
  const spread: RawImage[] = [];
  const step = Math.max(1, Math.floor(nav.length / PER_WAYPOINT));
  for (let k = 0; k < nav.length; k += step) spread.push(nav[k]!);
  for (const n of nav) if (!spread.includes(n)) spread.push(n);
  const mast = full.filter((i) => i.camera.instrument === "MAST_LEFT" || i.camera.instrument === "MAST_RIGHT").sort(latestFirst);
  const rest = full.filter((i) => /NAV_RIGHT_B|FHAZ_LEFT_B|RHAZ_LEFT_B/.test(i.camera.instrument)).sort(latestFirst);
  return [...spread, ...mast.slice(0, 6), ...rest.slice(0, 6)];
}

/** Rejects frames that are mostly black (vignetted close-ups, night or calibration shots). */
async function looksUsable(jpg: Buffer): Promise<boolean> {
  const { data } = await sharp(jpg).resize(64, 64, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (const v of data) if (v < 20) dark++;
  return dark / data.length < 0.2;
}

export async function runPhotos(): Promise<void> {
  const a = loadArea();
  const dir = areaDir(a, "rover");
  const photoDir = areaDir(a, "rover", "photos");
  const outFile = join(dir, "photos.json");
  if (!needs(outFile)) {
    log("photos", "photos.json exists, skipping");
    return;
  }
  const wps = pickWaypoints(await runRover());
  log("photos", `fetching raw-image lists for ${wps.length} sols`);
  const entries: PhotoEntry[] = [];
  const failures: string[] = [];
  await pool(wps, 3, async (w) => {
    let imgs: RawImage[] = [];
    try {
      const j = JSON.parse((await cachedFile(API(w.sol), join(cacheDir("raw-api"), `sol_${w.sol}.json`))).toString("utf8")) as {
        images?: RawImage[];
      };
      imgs = (j.images ?? []).filter((i) => i.sol === w.sol);
    } catch (e) {
      failures.push(`sol ${w.sol}: ${(e as Error).message}`);
      return;
    }
    let kept = 0;
    for (const img of candidates(imgs)) {
      if (kept >= PER_WAYPOINT) break;
      const name = `${w.sol}_${img.imageid.replace(/[^A-Za-z0-9_-]/g, "")}.jpg`;
      const file = join(photoDir, name);
      try {
        if (!existsSync(file)) {
          const buf = await fetchBuffer(img.image_files.full_res);
          const jpg = await sharp(buf).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
          if (!(await looksUsable(jpg))) continue;
          writeAtomic(file, jpg);
        }
        kept++;
        const m = await sharp(readFileSync(file)).metadata();
        entries.push({
          sol: w.sol,
          lon: w.lon,
          lat: w.lat,
          elevationM: w.elevationM,
          file: `rover/photos/${name}`,
          instrument: img.camera.instrument,
          dateTaken: img.date_taken_utc,
          credit: img.credit || "NASA/JPL-Caltech",
          sourceUrl: img.image_files.full_res,
          pageUrl: img.link,
          widthPx: m.width ?? 0,
          heightPx: m.height ?? 0,
        });
      } catch (e) {
        failures.push(`${img.imageid}: ${(e as Error).message}`);
      }
    }
  });
  entries.sort((p, q) => p.sol - q.sol || p.file.localeCompare(q.file));
  writeJson(outFile, entries);
  const sols = new Set(entries.map((e) => e.sol));
  log("photos", `${entries.length} photos for ${sols.size} waypoints; failures: ${failures.length}`);
  for (const f of failures.slice(0, 10)) log("photos", "  " + f);
}

if (isMain(import.meta.url)) await runPhotos();
