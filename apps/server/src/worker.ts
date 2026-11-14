/**
 * The API, as a Cloudflare Worker. Vite runs it in dev (via @cloudflare/vite-plugin) and
 * builds it for deploy. The web app and the map data are static assets; this code only
 * answers /api/* (see wrangler.jsonc `run_worker_first`). Config is bundled at build time.
 */
import { Hono } from "hono";
import area from "../../../config/area.json";
import surface from "../../../config/surface-classes.json";
import walk from "../../../config/walk-params.json";
import pois from "../../../config/pois.json";

type Env = { ASSETS: { fetch: (req: Request | string) => Promise<Response> } };

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/areas", async (c) => {
  // A Worker cannot list folders, so probe the known areas. Deployed builds ship only
  // the area in config/area.json; the synthetic fixture exists in local dev.
  const areas = [];
  for (const id of [area.id, "fixture"]) {
    const res = await c.env.ASSETS.fetch(new URL(`/data/${id}/layers.json`, c.req.url).toString());
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) continue;
    const manifest = (await res.json()) as { generatedAt?: string };
    areas.push({ id, generatedAt: manifest.generatedAt ?? null, synthetic: id === "fixture" });
  }
  return c.json({ areas, defaultArea: areas[0]?.id ?? null });
});

app.get("/api/config", (c) => {
  const p = pois as unknown as { pois?: unknown[] } | unknown[];
  return c.json({
    area,
    surfaceClasses: surface.classes,
    walkParams: walk,
    walkParamsSource: "config/walk-params.json",
    pois: Array.isArray(p) ? p : (p.pois ?? []),
  });
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default app;
