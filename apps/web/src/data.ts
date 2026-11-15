import type { LayerManifest, LonLat } from "@marsmap/core";
import type { AppConfig, AreaData, Conditions, DataChecks, DisplayLayers, DrillSite, Minerals, RoverData, RoverPhoto, Waypoint } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

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
  const g = manifest.grid;
  const n = g.width * g.height;
  const bin = async (id: string) => {
    const e = manifest.layers.find((l) => l.id === id);
    if (!e) return null;
    const r = await fetch(`${base}/${e.file}`);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const arr = e.dtype === "float32" ? new Float32Array(buf) : new Uint8Array(buf);
    if (arr.length !== n) return null;
    if (arr instanceof Float32Array && e.nodata != null && Number.isFinite(e.nodata)) {
      const nd = Math.fround(e.nodata);
      for (let i = 0; i < n; i++) if (arr[i] === nd) arr[i] = NaN;
    }
    return arr;
  };
  const [elevation, slope, surface, confidence, rover] = await Promise.all([
    bin("elevation") as Promise<Float32Array | null>,
    bin("slope") as Promise<Float32Array | null>,
    bin("surface") as Promise<Uint8Array | null>,
    bin("surface_confidence") as Promise<Uint8Array | null>,
    loadRover(base),
  ]);
  let elevMin = Infinity, elevMax = -Infinity;
  if (elevation) {
    const nd = manifest.layers.find((l) => l.id === "elevation")?.nodata;
    for (let i = 0; i < elevation.length; i++) {
      const v = elevation[i]!;
      if (!Number.isFinite(v) || v === nd) continue;
      if (v < elevMin) elevMin = v;
      if (v > elevMax) elevMax = v;
    }
  }
  let elevRef = 0;
  if (elevation) {
    const sample: number[] = [];
    for (let i = 0; i < elevation.length; i += 97) if (Number.isFinite(elevation[i]!)) sample.push(elevation[i]!);
    sample.sort((a, b) => a - b);
    elevRef = sample[sample.length >> 1] ?? elevMin;
  }
  const layers: DisplayLayers = { grid: g, elevation, slope, surface, confidence, elevMin, elevMax, elevRef };
  return { areaId, base, synthetic, manifest, config, layers, rover, conditions: parseConditions(condRaw), minerals, checks };
}

/** Fetch one float32 layer of the manifest on demand (science overlays are loaded when first switched on). */
export async function loadFloatLayer(area: AreaData, id: string): Promise<Float32Array | null> {
  const e = area.manifest.layers.find((l) => l.id === id);
  const g = area.manifest.grid;
  if (!e || e.dtype !== "float32") return null;
  const r = await fetch(`${area.base}/${e.file}`);
  if (!r.ok) return null;
  const arr = new Float32Array(await r.arrayBuffer());
  return arr.length === g.width * g.height ? arr : null;
}
