import {
  computeSlope,
  manifestTiles,
  readLayerWhole,
  readLayerWindow,
  readOverview,
  windowGrid,
  type GridSpec,
  type LayerManifest,
  type LonLat,
  type TileWindow,
} from "@marsmap/core";
import type { AppConfig, AreaData, Conditions, DataChecks, DisplayLayers, DrillSite, GridData, Minerals, RoverData, RoverPhoto, Waypoint } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Fetches a file of the area's data folder; used to read layers whole or in parts. */
const binaryFrom = (base: string) => async (file: string) => {
  const r = await fetch(`${base}/${file}`);
  if (!r.ok) throw new Error(`${base}/${file}: HTTP ${r.status}`);
  return r.arrayBuffer();
};

async function tryJson<T>(url: string): Promise<T | null> {
  try {
    return await getJson<T>(url);
  } catch {
    return null;
  }
}

export async function pickArea(): Promise<{ id: string; synthetic: boolean }> {
  const q = new URLSearchParams(location.search).get("area");
  const env = import.meta.env.VITE_AREA as string | undefined;
  const list = await getJson<{ areas: { id: string; synthetic: boolean }[]; defaultArea: string | null }>("/api/areas");
  const want = q ?? env ?? list.defaultArea;
  const found = list.areas.find((a) => a.id === want) ?? list.areas[0];
  if (!found) throw new Error("No data found. Run the data pipeline (pnpm data) or the fixture generator (pnpm --filter @marsmap/web fixture).");
  return found;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function features(x: unknown): GeoJSON.Feature[] {
  if (!x || typeof x !== "object") return [];
  if (Array.isArray(x)) return x as GeoJSON.Feature[];
  const fc = x as GeoJSON.FeatureCollection;
  if (Array.isArray(fc.features)) return fc.features;
  return [];
}

function lonLatOf(o: Record<string, unknown>): LonLat | null {
  const g = o.geometry as GeoJSON.Point | undefined;
  if (g?.type === "Point") return [g.coordinates[0]!, g.coordinates[1]!];
  const p = (o.properties as Record<string, unknown>) ?? o;
  const lon = num(p.lon) ?? num(p.longitude) ?? num(o.lon);
  const lat = num(p.lat) ?? num(p.latitude) ?? num(o.lat);
  return lon != null && lat != null ? [lon, lat] : null;
}

function photoUrl(base: string, file: string): string {
  if (/^https?:\/\//.test(file)) return file;
  const f = file.replace(/^\.?\//, "");
  if (f.startsWith("rover/")) return `${base}/${f}`;
  if (f.startsWith("photos/")) return `${base}/rover/${f}`;
  return `${base}/rover/photos/${f}`;
}

async function loadRover(base: string): Promise<RoverData> {
  const [traverse, wps, photos, drills] = await Promise.all([
    tryJson<GeoJSON.FeatureCollection | GeoJSON.Feature>(`${base}/rover/traverse.area.json`),
    tryJson<unknown>(`${base}/rover/waypoints.area.json`),
    tryJson<unknown>(`${base}/rover/photos.json`),
    tryJson<unknown>(`${base}/rover/drill-sites.json`),
  ]);
  const waypoints: Waypoint[] = [];
  for (const f of features(wps)) {
    const ll = lonLatOf(f as unknown as Record<string, unknown>);
    if (!ll) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    waypoints.push({ lonLat: ll, sol: num(props.sol) ?? num(props.SOL) ?? num(props.Sol), props });
  }
  const photoArr = Array.isArray(photos) ? photos : ((photos as { photos?: unknown[] })?.photos ?? []);
  const roverPhotos: RoverPhoto[] = [];
  for (const p of photoArr as Record<string, unknown>[]) {
    const lon = num(p.lon), lat = num(p.lat), file = str(p.file) ?? str(p.url);
    if (lon == null || lat == null || !file) continue;
    roverPhotos.push({
      sol: num(p.sol) ?? 0,
      lon,
      lat,
      elevationM: num(p.elevationM) ?? undefined,
      url: photoUrl(base, file),
      instrument: str(p.instrument) ?? undefined,
      dateTaken: str(p.dateTaken) ?? undefined,
      credit: str(p.credit) ?? undefined,
      sourceUrl: str(p.sourceUrl) ?? undefined,
    });
  }
  const drillArr = Array.isArray(drills) ? drills : features(drills).length ? features(drills) : ((drills as { sites?: unknown[] })?.sites ?? []);
  const drillSites: DrillSite[] = [];
  for (const d of drillArr as Record<string, unknown>[]) {
    const ll = lonLatOf(d);
    const props = ((d.properties as Record<string, unknown>) ?? d) as Record<string, unknown>;
    const name = str(props.name) ?? str(props.target) ?? str(props.id);
    if (ll && name) drillSites.push({ name, lonLat: ll, sol: num(props.sol) ?? undefined, props });
  }
  let tr: GeoJSON.FeatureCollection | null = null;
  if (traverse) tr = traverse.type === "FeatureCollection" ? traverse : { type: "FeatureCollection", features: [traverse as GeoJSON.Feature] };
  return { traverse: tr, waypoints, photos: roverPhotos, drillSites };
}

/** conditions.json is produced by the data pipeline; read the fields we know about defensively. */
function parseConditions(raw: Record<string, unknown> | null): Conditions | null {
  if (!raw) return null;
  const pick = (...paths: string[]): unknown => {
    for (const p of paths) {
      let v: unknown = raw;
      for (const k of p.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };
  const observed =
    str(pick("observed", "observedRange", "dateRange")) ??
    [str(pick("observedFrom", "from", "startDate", "weather.from")), str(pick("observedTo", "to", "endDate", "weather.to"))].filter(Boolean).join(" – ") ??
    null;
  const recent = (pick("weather.recentSols") as Record<string, unknown>[] | undefined)?.[0] ?? {};
  const lastDate = str(pick("weather.lastObservedEarthDate"));
  const lastSol = num(pick("weather.lastObservedSol"));
  const nSols = num(pick("weather.summary.sols"));
  return {
    raw,
    tempMinC: num(pick("weather.summary.minAirTempC", "airTempC.min", "minAirTempC", "minTempC")) ?? num(recent.minAirTempC),
    tempMaxC: num(pick("weather.summary.maxAirTempC", "airTempC.max", "maxAirTempC", "maxTempC")) ?? num(recent.maxAirTempC),
    sunrise: str(recent.sunriseLocal) ?? str(pick("sunrise", "weather.sunrise")),
    sunset: str(recent.sunsetLocal) ?? str(pick("sunset", "weather.sunset")),
    radiationMSvPerDay: num(pick("radiation.mSvPerDay", "radiationMSvPerDay")),
    observed: lastDate
      ? `${nSols ? `${nSols} sols to ` : ""}sol ${lastSol ?? "?"} (${lastDate})`
      : observed || str(pick("date", "weather.date", "terrestrialDate")),
    source: [str(pick("weather.source", "source")), str(pick("weather.staleNote")), str(pick("radiation.source"))].filter(Boolean).join("\n") || null,
  };
}

const median = (a: Float32Array) => {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(a.length / 200_000));
  for (let i = 0; i < a.length; i += step) if (Number.isFinite(a[i]!)) sample.push(a[i]!);
  sample.sort((p, q) => p - q);
  return sample[sample.length >> 1] ?? 0;
};

function minMax(a: Float32Array | null): [number, number] {
  let lo = Infinity, hi = -Infinity;
  if (a)
    for (let i = 0; i < a.length; i++) {
      const v = a[i]!;
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  return [lo, hi];
}

/**
 * The region-wide display layers: the overview copies of a tiled area, or the layers themselves
 * (full resolution) for a small untiled area such as the fixture.
 */
async function loadOverview(manifest: LayerManifest, base: string): Promise<DisplayLayers> {
  const fb = binaryFrom(base);
  const read = async (id: string) => {
    const e = manifest.layers.find((l) => l.id === id);
    if (!e) return null;
    try {
      return await readOverview(e, manifest.grid, fb);
    } catch {
      return null;
    }
  };
  const [elev, slope, surface, confidence] = await Promise.all([read("elevation"), read("slope"), read("surface"), read("surface_confidence")]);
  const grid = elev?.grid ?? manifest.grid;
  const same = <T extends { grid: GridSpec }>(x: T | null) => (x && x.grid.width === grid.width && x.grid.height === grid.height ? x : null);
  const elevation = (elev?.data as Float32Array | undefined) ?? null;
  const [elevMin, elevMax] = minMax(elevation);
  return {
    grid,
    elevation,
    slope: (same(slope)?.data as Float32Array | undefined) ?? (elevation ? computeSlope(grid, elevation) : null),
    surface: (same(surface)?.data as Uint8Array | undefined) ?? null,
    confidence: (same(confidence)?.data as Uint8Array | undefined) ?? null,
    elevMin,
    elevMax,
    elevRef: elevation ? median(elevation) : 0,
  };
}

export async function loadArea(areaId: string, synthetic: boolean): Promise<AreaData> {
  const base = `/data/${areaId}`;
  const [manifest, config, condRaw, minerals, report] = await Promise.all([
    getJson<LayerManifest>(`${base}/layers.json`),
    getJson<AppConfig>(`/api/config?area=${encodeURIComponent(areaId)}`),
    tryJson<Record<string, unknown>>(`${base}/conditions.json`),
    tryJson<Minerals>(`${base}/minerals.json`),
    tryJson<DataChecks & { georef?: { rows?: unknown } }>(`${base}/preview/verify-report.json`),
  ]);
  // The report lists every waypoint; the app only needs the summary.
  if (report?.georef) delete report.georef.rows;
  const checks: DataChecks | null = report;
  const [overview, rover] = await Promise.all([loadOverview(manifest, base), loadRover(base)]);
  return { areaId, base, synthetic, manifest, config, overview, tiles: manifestTiles(manifest), rover, conditions: parseConditions(condRaw), minerals, checks };
}

/**
 * Full-resolution display layers of a planning window of tiles. Slope is computed here from the
 * elevation (Horn), as the routing worker does. Colour range and 3D reference come from the overview,
 * so the window matches the map around it.
 */
export async function loadDetail(area: AreaData, win: TileWindow | null): Promise<DisplayLayers> {
  const m = area.manifest;
  if (!area.tiles || !win) return area.overview;
  const fb = binaryFrom(area.base);
  const read = async (id: string) => {
    const e = m.layers.find((l) => l.id === id && l.tiles);
    if (!e) return null;
    try {
      return await readLayerWindow(e, m.grid, win, fb);
    } catch {
      return null;
    }
  };
  const [elevation, surface, confidence] = await Promise.all([read("elevation"), read("surface"), read("surface_confidence")]);
  const grid = windowGrid(m.grid, area.tiles.size, win);
  const elev = (elevation as Float32Array | null) ?? null;
  return {
    grid,
    elevation: elev,
    slope: elev ? computeSlope(grid, elev) : null,
    surface: (surface as Uint8Array | null) ?? null,
    confidence: (confidence as Uint8Array | null) ?? null,
    elevMin: area.overview.elevMin,
    elevMax: area.overview.elevMax,
    elevRef: area.overview.elevRef,
  };
}

/** Fetch one float32 layer of the manifest on demand (science overlays are loaded when first switched on). */
export async function loadFloatLayer(area: AreaData, id: string): Promise<GridData | null> {
  const e = area.manifest.layers.find((l) => l.id === id);
  if (!e || e.dtype !== "float32" || e.tiles) return null;
  try {
    const { grid, data } = await readLayerWhole(e, area.manifest.grid, binaryFrom(area.base));
    return data instanceof Float32Array && data.length === grid.width * grid.height ? { grid, data } : null;
  } catch {
    return null;
  }
}
