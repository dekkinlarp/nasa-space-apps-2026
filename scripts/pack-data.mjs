#!/usr/bin/env node
/**
 * Packs the deployable part of data/<area>/ into a tarball for a GitHub release and
 * records it in config/data-release.json. Usage: node scripts/pack-data.mjs <tag>
 * Then: gh release create <tag> <tarball> (see README "Deploy").
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/pack-data.mjs <tag>   e.g. data-v1");
  process.exit(1);
}
const area = JSON.parse(readFileSync(join(ROOT, "config/area.json"), "utf8")).id;
const releaseFile = join(ROOT, "config/data-release.json");
const prev = JSON.parse(readFileSync(releaseFile, "utf8"));
const asset = `marsmap-${area}-${tag}.tar.gz`;
const out = join(ROOT, "data", asset);

// Quick-look previews and the full-planet rover files are not used by the app. Layers published
// in parts (over Cloudflare's 25 MiB per asset) ship as their parts only, not the whole file.
const manifest = JSON.parse(readFileSync(join(ROOT, "data", area, "layers.json"), "utf8"));
const whole = manifest.layers.filter((l) => l.parts).flatMap((l) => ["--exclude", `^${area}/${l.file}$`]);
execFileSync(
  "tar",
  ["-czf", out, "-C", join(ROOT, "data"), "--exclude", `${area}/preview`, "--exclude", `${area}/rover/MSL_*.json`, "--exclude", `${area}/.release`, ...whole, area],
  { stdio: "inherit" },
);
const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
writeFileSync(releaseFile, JSON.stringify({ ...prev, tag, asset, area, sha256, bytes: statSync(out).size }, null, 2) + "\n");
console.log(`${out}\n${(statSync(out).size / 1e6).toFixed(1)} MB  sha256 ${sha256}`);
