/** grid.json + layers.json (LayerManifest). Always rewritten (cheap); preserves imported layers. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageryEntry, LayerEntry, LayerManifest } from "../../packages/core/src/types";
import { areaDir, cacheDir, gridFromArea, isMain, loadArea, log } from "./lib/area";
import { DEM_LABEL_URL, DEM_NAME, DEM_URL } from "./lib/demgrid";
import { writeJson } from "./lib/net";
import { SURFACE_METHOD } from "./derive";

const VERSION = "1";

export function builtInLayers(): LayerEntry[] {
  const dem = `${DEM_NAME}, ${DEM_URL} (label: ${DEM_LABEL_URL})`;
  return [
    {
      id: "elevation",
      file: "elevation.f32",
      dtype: "float32",
      units: "m (relative to the Mars areoid, 3396190 m sphere)",
      source: dem,
      method:
        "HTTP range-read of only the TIFF strips covering the area (LZW-decoded in Node). Projection read from the GeoTIFF GeoKeys: equirectangular, centre lon 0, standard parallel 0, R = 3396190 m, PixelIsPoint tiepoint. Area-weighted box average of the 1 m pixels onto each 2 m cell; nodata (-32767) excluded, residual holes filled by neighbour averaging.",
      version: VERSION,
      estimated: false,
    },
    {
      id: "slope",
      file: "slope.f32",
      dtype: "float32",
      units: "degrees",
      source: "Derived from elevation.f32",
      method: "Horn (1981) 3x3 finite differences on the 2 m elevation grid; edge cells use clamped neighbours.",
      version: VERSION,
      estimated: false,
    },
    {
      id: "surface",
      file: "surface.u8",
      dtype: "uint8",
      units: "class id (config/surface-classes.json; 0 = unknown)",
      source: `Derived from the 1 m DEM (${DEM_URL}) and the HiRISE mosaic tiles (NASA Mars Trek curiosity_hirise_mosaic)`,
      method: SURFACE_METHOD,
      version: VERSION,
      estimated: true,
    },
    {
      id: "surface_confidence",
      file: "surface_confidence.u8",
      dtype: "uint8",
      units: "0-255 (heuristic agreement score, not a probability)",
      source: "Derived alongside surface.u8",
      method: "40 + 160 * min(1, (best score - second-best score) / 0.25); cells changed by the majority filter capped at 60. Max 200.",
      version: VERSION,
      estimated: true,
    },
  ];
}

export function runManifest(): LayerManifest {
  const a = loadArea();
  const g = gridFromArea(a);
  const dir = areaDir(a);
  const layersFile = join(dir, "layers.json");
  // Layers added with `import-layer` live in imported-layers.json and override built-ins of the same id.
  const importedFile = join(dir, "imported-layers.json");
  const imported = (existsSync(importedFile) ? (JSON.parse(readFileSync(importedFile, "utf8")) as LayerEntry[]) : []).filter((l) =>
    existsSync(join(dir, l.file)),
  );
  const overridden = new Set(imported.map((l) => l.id));
  const layers = [...builtInLayers().filter((l) => !overridden.has(l.id) && existsSync(join(dir, l.file))), ...imported];
  const imgIndex = join(cacheDir(a.id), "imagery-entries.json");
  const imagery: ImageryEntry[] = existsSync(imgIndex)
    ? (JSON.parse(readFileSync(imgIndex, "utf8")) as ImageryEntry[]).filter((e) => existsSync(join(dir, e.file)))
    : [];
  const manifest: LayerManifest = { grid: g, layers, imagery, generatedAt: new Date().toISOString() };
  writeJson(join(dir, "grid.json"), g);
  writeJson(layersFile, manifest);
  log("manifest", `layers.json: ${layers.map((l) => l.id).join(", ")}; imagery: ${imagery.map((i) => i.id).join(", ")}`);
  return manifest;
}

if (isMain(import.meta.url)) runManifest();
