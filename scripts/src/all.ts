/**
 * Full pipeline: `pnpm --filter @marsmap/scripts run all [-- --force] [--area path.json]`.
 * Every step is cached; re-running only fills in what is missing.
 */
import { loadArea, log } from "./lib/area";
import { downloadedBytes } from "./lib/net";
import { runElevation } from "./elevation";
import { runImagery } from "./imagery";
import { runDerive } from "./derive";
import { runMinerals } from "./minerals";
import { runRover } from "./rover";
import { runPhotos } from "./photos";
import { runConditions } from "./conditions";
import { runManifest } from "./manifest";
import { runPreview } from "./preview";
import { runVerify } from "./verify";

const t0 = Date.now();
// Order matters: derive needs elevation (elev2m/rough2m) and the HiRISE grid copy from imagery;
// minerals needs the HiRISE overview copy; manifest needs derive (and minerals, imagery).
const a = loadArea();
log("all", `area ${a.id}: ${a.width}x${a.height} cells @ ${a.cellSizeM} m, lon ${a.west}..${a.east}, lat ${a.south}..${a.north}`);
const step = async (name: string, fn: () => unknown, optional = false) => {
  try {
    await fn();
  } catch (e) {
    if (!optional) throw e;
    log("all", `step ${name} failed (optional, continuing): ${(e as Error).message}`);
  }
};
await step("elevation", runElevation);
await step("imagery", runImagery);
await step("derive", runDerive);
await step("minerals", runMinerals, true);
await step("rover", runRover);
await step("photos", runPhotos, true);
await step("conditions", runConditions, true);
await step("manifest", runManifest);
await step("preview", runPreview, true);
const ok = await runVerify();
log("all", `done in ${((Date.now() - t0) / 1000).toFixed(1)} s; downloaded this run: ${(downloadedBytes() / 1e6).toFixed(1)} MB`);
process.exitCode = ok ? 0 : 1;
