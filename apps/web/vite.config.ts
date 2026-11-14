import { createReadStream, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const ROOT = resolve(import.meta.dirname, "../..");
const DATA_DIR = join(ROOT, "data");

const MIME: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

/**
 * Map data lives in the gitignored data/ folder at the repo root.
 * Dev: serve it at /data/* straight from disk (every area, including the fixture).
 * Build: copy the area named in config/area.json next to the client bundle, so the
 * Worker serves it as static assets.
 */
function mapData(): Plugin {
  return {
    name: "marsmap-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        const full = normalize(join(DATA_DIR, rel));
        if (!full.startsWith(DATA_DIR + sep) || !existsSync(full) || !statSync(full).isFile()) return next();
        res.setHeader("Content-Type", MIME[extname(full).toLowerCase()] ?? "application/octet-stream");
        res.setHeader("Content-Length", statSync(full).size);
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(full).pipe(res);
      });
    },
    closeBundle() {
      if (this.environment.name !== "client" || this.environment.config.command !== "build") return;
      const area = JSON.parse(readFileSync(join(ROOT, "config/area.json"), "utf8")).id as string;
      const src = join(DATA_DIR, area);
      if (!existsSync(join(src, "layers.json"))) {
        this.error(`data/${area} is missing; run "pnpm data:fetch" or "pnpm data" first`);
      }
      const out = join(resolve(this.environment.config.root, this.environment.config.build.outDir), "data");
      rmSync(out, { recursive: true, force: true });
      // Quick-look previews and the full-planet rover files are not used by the app.
      const skip = [join(src, "preview"), join(src, ".release")];
      cpSync(src, join(out, area), {
        recursive: true,
        filter: (p) => !skip.includes(p) && !/[\\/]rover[\\/]MSL_[^\\/]*\.json$/.test(p),
      });
      // The Cloudflare plugin points Wrangler at the built Worker from apps/web. Mirror that
      // pointer at the repo root so `wrangler deploy` / `wrangler preview` work from there too
      // (that is where Cloudflare's Git builds run them).
      const local = join(this.environment.config.root, ".wrangler/deploy/config.json");
      if (existsSync(local)) {
        const built = resolve(join(this.environment.config.root, ".wrangler/deploy"), JSON.parse(readFileSync(local, "utf8")).configPath);
        mkdirSync(join(ROOT, ".wrangler/deploy"), { recursive: true });
        writeFileSync(
          join(ROOT, ".wrangler/deploy/config.json"),
          JSON.stringify({ configPath: relative(join(ROOT, ".wrangler/deploy"), built) }),
        );
      }
    },
  };
}

export default defineConfig({
  // One dev server and one build for the React app and the Worker (which runs in workerd).
  plugins: [mapData(), react(), cloudflare({ configPath: "../../wrangler.jsonc" })],
  server: { port: 5173, host: true },
  preview: { port: 5173 },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
