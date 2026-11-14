#!/usr/bin/env node
/** Copies the map data next to the built web app so one Worker serves both as static assets. */
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const area = JSON.parse(readFileSync(join(ROOT, "config/area.json"), "utf8")).id;
const src = join(ROOT, "data", area);
const dist = join(ROOT, "apps/web/dist");
if (!existsSync(join(src, "layers.json"))) throw new Error(`data/${area} is missing; run "pnpm data:fetch" or "pnpm data"`);
if (!existsSync(join(dist, "index.html"))) throw new Error("apps/web/dist is missing; build the web app first");
const dest = join(dist, "data", area);
rmSync(join(dist, "data"), { recursive: true, force: true });
const skip = [join(src, "preview"), join(src, ".release")];
cpSync(src, dest, {
  recursive: true,
  filter: (p) => !skip.includes(p) && !/[\\/]rover[\\/]MSL_[^\\/]*\.json$/.test(p),
});
console.log(`assets assembled in apps/web/dist (data/${area} included)`);
