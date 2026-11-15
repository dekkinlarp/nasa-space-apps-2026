import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GridSpec, SurfaceClass } from "../../../packages/core/src/types";

export type { GridSpec, SurfaceClass };

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");
export const CONFIG_DIR = join(REPO_ROOT, "config");
export const DATA_ROOT = join(REPO_ROOT, "data");
export const CACHE_DIR = join(DATA_ROOT, "cache");

export interface AreaConfig {
  id: string;
  name: string;
  note?: string;
  centerLat: number;
  centerLon: number;
  south: number;
  north: number;
  west: number;
  east: number;
  cellSizeM: number;
  width: number;
  height: number;
  /** Side of one tile, cells. width and height are whole multiples of it. */
  tileSize?: number;
  /** Overview cells are this many grid cells across. */
  overviewFactor?: number;
  marsRadiusM: number;
}

/** `--area path/to/area.json` overrides config/area.json. */
export function loadArea(): AreaConfig {
  const i = process.argv.indexOf("--area");
  const p = i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]!) : join(CONFIG_DIR, "area.json");
  return JSON.parse(readFileSync(p, "utf8")) as AreaConfig;
}

export function loadSurfaceClasses(): SurfaceClass[] {
  return (JSON.parse(readFileSync(join(CONFIG_DIR, "surface-classes.json"), "utf8")) as { classes: SurfaceClass[] }).classes;
}

export function gridFromArea(a: AreaConfig): GridSpec {
  return {
    id: a.id,
    south: a.south,
    north: a.north,
    west: a.west,
    east: a.east,
    width: a.width,
    height: a.height,
    cellSizeM: a.cellSizeM,
    marsRadiusM: a.marsRadiusM,
  };
}

export const FORCE = process.argv.includes("--force");
/** Re-download cached API/JSON responses (waypoints, raw-image lists, weather, capabilities). */
export const REFRESH = process.argv.includes("--refresh");

export function areaDir(a: AreaConfig, ...sub: string[]): string {
  const d = join(DATA_ROOT, a.id, ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}

export function cacheDir(...sub: string[]): string {
  const d = join(CACHE_DIR, ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}

/**
 * True when the area's existing outputs were built for different bounds/grid than the
 * current config (compares data/<id>/grid.json, written at the end of each run).
 */
export function areaChanged(): boolean {
  const a = loadArea();
  const f = join(DATA_ROOT, a.id, "grid.json");
  if (!existsSync(f)) return false;
  return JSON.stringify(JSON.parse(readFileSync(f, "utf8"))) !== JSON.stringify(gridFromArea(a));
}

/** True when `file` should be (re)built: missing, --force, or the area config changed. */
export function needs(file: string): boolean {
  return FORCE || !existsSync(file) || areaChanged();
}

/** Cell-centre lon/lat of grid cell (row, col). Row 0 = north, col 0 = west. */
export function cellCenter(g: GridSpec, row: number, col: number): [number, number] {
  const lon = g.west + ((col + 0.5) / g.width) * (g.east - g.west);
  const lat = g.north - ((row + 0.5) / g.height) * (g.north - g.south);
  return [lon, lat];
}

/** Fractional grid coords (col, row) of a lon/lat; integer part = cell index. */
export function lonLatToGrid(g: GridSpec, lon: number, lat: number): [number, number] {
  return [((lon - g.west) / (g.east - g.west)) * g.width, ((g.north - lat) / (g.north - g.south)) * g.height];
}

export function inBounds(
  b: { south: number; north: number; west: number; east: number },
  lon: number,
  lat: number,
  marginDeg = 0,
): boolean {
  return lat >= b.south - marginDeg && lat <= b.north + marginDeg && lon >= b.west - marginDeg && lon <= b.east + marginDeg;
}

export function log(step: string, ...msg: unknown[]): void {
  console.log(`[${step}]`, ...msg);
}

/** True when the module at `metaUrl` is the script being run directly. */
export function isMain(metaUrl: string): boolean {
  return !!process.argv[1] && resolve(fileURLToPath(metaUrl)) === resolve(process.argv[1]);
}
