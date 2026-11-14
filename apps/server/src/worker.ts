/**
 * Cloudflare Worker entry. The web app and the map data are static assets; this Worker
 * only answers /api/* (see wrangler.jsonc `run_worker_first`). Config is bundled at build time.
 * The Node server in index.ts stays for local development.
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
  // The deployed build ships exactly the area named in config/area.json.
  const res = await c.env.ASSETS.fetch(new URL(`/data/${area.id}/layers.json`, c.req.url).toString());
  const manifest = res.ok ? ((await res.json()) as { generatedAt?: string }) : null;
  const areas = manifest ? [{ id: area.id, generatedAt: manifest.generatedAt ?? null, synthetic: false }] : [];
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
