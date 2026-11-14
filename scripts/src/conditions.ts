/** conditions.json: recent REMS weather summary (stale by months) + a static radiation figure. */
import { join } from "node:path";
import { areaDir, cacheDir, isMain, loadArea, log, needs } from "./lib/area";
import { cachedFile, writeJson } from "./lib/net";

export const WEATHER_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json";
const N_SOLS = 30;

interface Sole {
  terrestrial_date: string;
  sol: string;
  ls: string;
  season: string;
  min_temp: string;
  max_temp: string;
  pressure: string;
  atmo_opacity: string;
  sunrise: string;
  sunset: string;
  local_uv_irradiance_index: string;
  min_gts_temp: string;
  max_gts_temp: string;
}

const n = (s: string): number | null => (s && s !== "--" && Number.isFinite(Number(s)) ? Number(s) : null);
const t = (s: string): string | null => (s && s !== "--" ? s : null);

export async function runConditions(): Promise<void> {
  const a = loadArea();
  const out = join(areaDir(a), "conditions.json");
  if (!needs(out)) {
    log("conditions", "conditions.json exists, skipping");
    return;
  }
  let weather: unknown = null;
  try {
    // The feed is Latin-1 encoded; we only use ASCII fields.
    const buf = await cachedFile(WEATHER_URL, join(cacheDir("rems"), "weather.json"));
    const j = JSON.parse(buf.toString("latin1")) as { soles: Sole[] };
    const soles = j.soles
      .filter((s) => n(s.min_temp) !== null || n(s.pressure) !== null)
      .sort((p, q) => Number(q.sol) - Number(p.sol))
      .slice(0, N_SOLS);
    const rows = soles.map((s) => ({
      sol: Number(s.sol),
      earthDate: s.terrestrial_date,
      ls: n(s.ls),
      season: s.season,
      minAirTempC: n(s.min_temp),
      maxAirTempC: n(s.max_temp),
      minGroundTempC: n(s.min_gts_temp),
      maxGroundTempC: n(s.max_gts_temp),
      pressurePa: n(s.pressure),
      opacity: t(s.atmo_opacity),
      uvIndex: t(s.local_uv_irradiance_index),
      sunriseLocal: t(s.sunrise),
      sunsetLocal: t(s.sunset),
    }));
    const vals = (k: keyof (typeof rows)[number]) => rows.map((r) => r[k]).filter((v): v is number => typeof v === "number");
    const avg = (xs: number[]) => (xs.length ? Number((xs.reduce((p, q) => p + q, 0) / xs.length).toFixed(1)) : null);
    weather = {
      source: `${WEATHER_URL} (REMS, Centro de Astrobiologia CAB/INTA-CSIC; outreach data)`,
      lastObservedSol: rows[0]?.sol ?? null,
      lastObservedEarthDate: rows[0]?.earthDate ?? null,
      stale: true,
      staleNote: "The public REMS feed lags months behind the mission; treat as typical recent conditions, not today's weather.",
      summary: {
        sols: rows.length,
        minAirTempC: Math.min(...vals("minAirTempC")),
        maxAirTempC: Math.max(...vals("maxAirTempC")),
        meanMinAirTempC: avg(vals("minAirTempC")),
        meanMaxAirTempC: avg(vals("maxAirTempC")),
        meanPressurePa: avg(vals("pressurePa")),
      },
      recentSols: rows,
    };
    log("conditions", `REMS: ${rows.length} sols, last sol ${rows[0]?.sol} (${rows[0]?.earthDate})`);
  } catch (e) {
    log("conditions", `REMS weather unavailable: ${(e as Error).message}`);
  }
  writeJson(out, {
    generatedAt: new Date().toISOString(),
    weather,
    radiation: {
      mSvPerDay: 0.67,
      source: "MSL RAD, Hassler et al. 2014, Science 343 (SwRI)",
      static: true,
      note: "Average surface dose-equivalent rate measured at Gale Crater (Aug 2012 - Jun 2013).",
    },
  });
}

if (isMain(import.meta.url)) await runConditions();
