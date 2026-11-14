#!/usr/bin/env node
/**
 * Downloads the prepared map data from the GitHub release named in config/data-release.json
 * and unpacks it into data/. Used by the Cloudflare build so it never calls NASA.
 * No dependencies. Skips when the data on disk already matches the release.
 * Private repo: set GITHUB_TOKEN (read access to the repo's contents).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = JSON.parse(readFileSync(join(ROOT, "config/data-release.json"), "utf8"));
const dataDir = join(ROOT, "data");
const stamp = join(dataDir, rel.area, ".release");
const force = process.argv.includes("--force");

if (!force && existsSync(join(dataDir, rel.area, "layers.json"))) {
  const have = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "local";
  if (have === rel.sha256 || have === "local") {
    console.log(`data/${rel.area} already present (${have === "local" ? "built locally" : rel.tag}); skipping download`);
    process.exit(0);
  }
}

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const auth = token ? { Authorization: `Bearer ${token}` } : {};
const ua = { "User-Agent": "marsmap-build" };

async function download() {
  if (token) {
    // Works for private repos: look the asset up through the API, then fetch its bytes.
    const r = await fetch(`https://api.github.com/repos/${rel.repo}/releases/tags/${rel.tag}`, {
      headers: { ...auth, ...ua, Accept: "application/vnd.github+json" },
    });
    if (!r.ok) throw new Error(`release ${rel.tag}: HTTP ${r.status}`);
    const a = (await r.json()).assets.find((x) => x.name === rel.asset);
    if (!a) throw new Error(`asset ${rel.asset} not found in release ${rel.tag}`);
    return fetch(a.url, { headers: { ...auth, ...ua, Accept: "application/octet-stream" } });
  }
  return fetch(`https://github.com/${rel.repo}/releases/download/${rel.tag}/${rel.asset}`, { headers: ua });
}

const res = await download();
if (!res.ok) {
  throw new Error(
    `download failed: HTTP ${res.status}` + (token ? "" : " (if the repo is private, set GITHUB_TOKEN in the build environment)"),
  );
}
const buf = Buffer.from(await res.arrayBuffer());
const sha = createHash("sha256").update(buf).digest("hex");
if (sha !== rel.sha256) throw new Error(`checksum mismatch: got ${sha}, expected ${rel.sha256}`);

mkdirSync(dataDir, { recursive: true });
const tmp = join(dataDir, rel.asset);
writeFileSync(tmp, buf);
rmSync(join(dataDir, rel.area), { recursive: true, force: true });
execFileSync("tar", ["-xzf", tmp, "-C", dataDir], { stdio: "inherit" });
rmSync(tmp);
writeFileSync(stamp, rel.sha256 + "\n");
console.log(`data/${rel.area} unpacked from ${rel.repo}@${rel.tag} (${(buf.length / 1e6).toFixed(1)} MB)`);
