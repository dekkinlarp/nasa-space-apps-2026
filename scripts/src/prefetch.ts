/**
 * Downloads (into data/cache/) every remote raster the region needs, without processing it:
 * the DEM strips over the region's rows and the Mars Trek tiles of each imagery layer.
 * The other steps fetch what they need too; this just gets the long downloads out of the way.
 */
import { cacheDir, isMain, loadArea, log } from "./lib/area";
import { DEM_URL, lonLatToPixel, projectionFromMeta } from "./lib/demgrid";
import { RemoteStripTiff } from "./lib/striptiff";
import { pixelWindow, prefetchTiles, trekMaxZoom } from "./lib/trek";
import { LAYERS } from "./imagery";
import { downloadedBytes } from "./lib/net";

export async function runPrefetch(): Promise<void> {
  const a = loadArea();
  const tiff = new RemoteStripTiff(DEM_URL, cacheDir("dem-gale-1m-v3"));
  await tiff.open();
  const proj = projectionFromMeta(tiff.meta);
  const r0 = Math.max(0, Math.floor(lonLatToPixel(proj, a.west, a.north)[1]) - 16);
  const r1 = Math.min(tiff.meta.height, Math.ceil(lonLatToPixel(proj, a.west, a.south)[1]) + 16);
  const dem = tiff.prefetchRows(r0, r1);
  const imagery = (async () => {
    for (const spec of LAYERS) {
      try {
        const { zoom, ext } = await trekMaxZoom(spec.layer);
        const z = Math.min(zoom, spec.preferZoom);
        const res = await prefetchTiles(spec.layer, z, ext, pixelWindow(a, z));
        log("prefetch", `${spec.id}: ${res.total} tiles, ${res.missing} missing`);
      } catch (e) {
        if (!spec.optional) throw e;
        log("prefetch", `${spec.id}: skipped (${(e as Error).message})`);
      }
    }
  })();
  await Promise.all([dem, imagery]);
  log("prefetch", `done; downloaded ${(downloadedBytes() / 1e6).toFixed(0)} MB`);
}

if (isMain(import.meta.url)) await runPrefetch();
