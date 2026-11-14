/**
 * rover/: Curiosity waypoints + traverse (MMGIS GeoJSON), clipped to the area, and the
 * boxwork drill sites inferred from the rover's position on the drill sol.
 */
import { join } from "node:path";
import { areaDir, gridFromArea, inBounds, isMain, loadArea, log, needs } from "./lib/area";
import { cachedFile, writeJson } from "./lib/net";

export const WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json";
export const TRAVERSE_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json";
/** ~110 m margin around the area for clipping. */
export const MARGIN_DEG = 0.002;

export interface Waypoint {
  sol: number;
  site: number;
  drive: number;
  lon: number;
  lat: number;
  elevationM: number;
  tiltDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  yawDeg: number | null;
  distTotalM: number | null;
  driveType: string | null;
  rawImagesUrl: string;
}

interface Feature<G> {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: G;
}
type Point = { type: "Point"; coordinates: number[] };
type Line = { type: "LineString"; coordinates: number[][] } | { type: "MultiLineString"; coordinates: number[][][] };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const rawImagesPage = (sol: number) =>
  `https://mars.nasa.gov/msl/multimedia/raw-images/?order=sol+desc&per_page=50&page=0&mission=msl&begin_sol=${sol}&end_sol=${sol}`;

export function tidyWaypoint(f: Feature<Point>): Waypoint {
  const p = f.properties;
  const [lon, lat, z] = f.geometry.coordinates as [number, number, number];
  const sol = Number(p.sol);
  return {
    sol,
    site: Number(p.site),
    drive: Number(p.drive),
    lon: num(p.lon) ?? lon,
    lat: num(p.lat) ?? lat,
    elevationM: num(p.elev_geoid) ?? z,
    tiltDeg: num(p.tilt),
    pitchDeg: num(p.pitch),
    rollDeg: num(p.roll),
    yawDeg: num(p.yaw),
    distTotalM: num(p.dist_total_m),
    driveType: typeof p.drive_type === "string" ? p.drive_type : null,
    rawImagesUrl: rawImagesPage(sol),
  };
}

const DRILL_SITES = [
  {
    name: "Altadena",
    sol: 4548,
    setting: "Last drill before the boxwork campaign (approx. -4.799, 137.384)",
    reference: "Prompt/team notes: ~sol 4548, mid-2025",
  },
  {
    name: "Valle de la Luna",
    sol: 4692,
    setting: "Boxwork hollow (Monte Grande hollow)",
    reference: "NASA Curiosity blog, sols 4689-4694 / 4695-4701: drilled ~Oct 18-19 2025 (sol ~4692)",
  },
  {
    name: "Nevado Sajama",
    sol: 4718,
    setting: "Boxwork ridge top, next to Monte Grande hollow",
    reference: "NASA Curiosity blog, sols 4716-4722: drill hole on Nov 13 2025 (sol 4718)",
  },
];

export async function runRover(): Promise<Waypoint[]> {
  const a = loadArea();
  const g = gridFromArea(a);
  const dir = areaDir(a, "rover");
  const wpAll = JSON.parse(
    (await cachedFile(WAYPOINTS_URL, join(dir, "MSL_waypoints.json"))).toString("utf8"),
  ) as { features: Feature<Point>[] };
  const trAll = JSON.parse((await cachedFile(TRAVERSE_URL, join(dir, "MSL_traverse.json"))).toString("utf8")) as {
    features: Feature<Line>[];
  };
  const all = wpAll.features.map(tidyWaypoint).sort((p, q) => p.sol - q.sol || p.site - q.site || p.drive - q.drive);
  const inArea = all.filter((w) => inBounds(g, w.lon, w.lat, MARGIN_DEG));

  const wpFile = join(dir, "waypoints.area.json");
  if (needs(wpFile)) {
    writeJson(wpFile, {
      type: "FeatureCollection",
      source: WAYPOINTS_URL,
      note: `Curiosity end-of-drive waypoints within the area bounds + ${MARGIN_DEG} deg margin. elevationM = elev_geoid (m, Mars areoid). insideArea=false marks margin points.`,
      features: inArea.map((w) => ({
        type: "Feature",
        properties: { ...w, insideArea: inBounds(g, w.lon, w.lat) },
        geometry: { type: "Point", coordinates: [w.lon, w.lat, w.elevationM] },
      })),
    });
  }

  // Traverse: give each drive line the sol of the waypoint at its end vertex, clip to bounds+margin.
  const trFile = join(dir, "traverse.area.json");
  if (needs(trFile)) {
    const key = (lon: number, lat: number) => `${lon.toFixed(5)},${lat.toFixed(5)}`;
    const byEnd = new Map(all.map((w) => [key(w.lon, w.lat), w]));
    const feats: unknown[] = [];
    for (const f of trAll.features) {
      const geom = f.geometry;
      if (!geom?.coordinates?.length) continue;
      const cs: number[][] = geom.type === "MultiLineString" ? geom.coordinates.flat() : geom.coordinates;
      const end = cs[cs.length - 1]!;
      let wp = byEnd.get(key(end[0]!, end[1]!));
      if (!wp) {
        // nearest waypoint within ~5 m
        let best = Infinity;
        for (const w of all) {
          const d = Math.hypot(w.lon - end[0]!, w.lat - end[1]!);
          if (d < best) {
            best = d;
            wp = w;
          }
        }
        if (best > 1e-4) wp = undefined;
      }
      // split into runs of vertices inside bounds+margin
      let run: number[][] = [];
      const flush = () => {
        if (run.length >= 2)
          feats.push({
            type: "Feature",
            properties: { sol: wp?.sol ?? null, site: wp?.site ?? null, drive: wp?.drive ?? null, lengthM: num(f.properties.Length) },
            geometry: { type: "LineString", coordinates: run.map((c) => c.map((v) => Number(v.toFixed(7)))) },
          });
        run = [];
      };
      for (const c of cs) {
        if (inBounds(g, c[0]!, c[1]!, MARGIN_DEG)) run.push(c);
        else flush();
      }
      flush();
    }
    writeJson(trFile, {
      type: "FeatureCollection",
      source: TRAVERSE_URL,
      note: `Curiosity drive paths clipped to the area bounds + ${MARGIN_DEG} deg margin; coordinates [lon, lat, elevation m]. sol = sol of the waypoint ending the drive (null if unmatched).`,
      features: feats,
    });
    log("rover", `traverse.area.json: ${feats.length} line pieces`);
  }

  const dsFile = join(dir, "drill-sites.json");
  if (needs(dsFile)) {
    const sites = DRILL_SITES.map((s) => {
      // rover position on that sol = last waypoint at or before the sol
      const before = all.filter((w) => w.sol <= s.sol);
      const w = before[before.length - 1]!;
      return {
        name: s.name,
        drillSol: s.sol,
        setting: s.setting,
        lon: w.lon,
        lat: w.lat,
        elevationM: w.elevationM,
        waypointSol: w.sol,
        insideArea: inBounds(g, w.lon, w.lat),
        reference: s.reference,
        rawImagesUrl: rawImagesPage(s.sol),
      };
    });
    writeJson(dsFile, {
      note: "Positions are INFERRED from the rover's last end-of-drive waypoint at or before the drill sol (the arm reaches ~1-2 m from the rover centre, so the hole is within a few metres). Not surveyed drill-hole coordinates.",
      sites,
    });
    for (const s of sites) log("rover", `drill site ${s.name}: sol ${s.drillSol} -> waypoint sol ${s.waypointSol} (${s.lon}, ${s.lat}) inside=${s.insideArea}`);
  }
  log("rover", `waypoints: ${all.length} total, ${inArea.length} in area+margin (sols ${inArea[0]?.sol}-${inArea[inArea.length - 1]?.sol})`);
  return inArea.filter((w) => inBounds(g, w.lon, w.lat));
}

if (isMain(import.meta.url)) await runRover();
