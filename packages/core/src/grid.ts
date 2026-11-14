import type { GridSpec, Layers, LonLat } from "./types";

const DEG = Math.PI / 180;

export interface CellRef {
  row: number;
  col: number;
  index: number;
}

/** Cell containing a lon/lat, or null if it falls outside the grid bounds. */
export function lonLatToCell(grid: GridSpec, lonLat: LonLat): CellRef | null {
  const [lon, lat] = lonLat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < grid.west || lon > grid.east || lat < grid.south || lat > grid.north) return null;
  let col = Math.floor(((lon - grid.west) / (grid.east - grid.west)) * grid.width);
  let row = Math.floor(((grid.north - lat) / (grid.north - grid.south)) * grid.height);
  // Points exactly on the east / south edge belong to the last cell.
  if (col >= grid.width) col = grid.width - 1;
  if (row >= grid.height) row = grid.height - 1;
  return { row, col, index: row * grid.width + col };
}

/** Lon/lat of a cell centre. */
export function cellToLonLat(grid: GridSpec, index: number): LonLat {
  const row = Math.floor(index / grid.width);
  const col = index - row * grid.width;
  return rowColToLonLat(grid, row, col);
}

/** Lon/lat of fractional (row, col) cell coordinates, where (0, 0) is the centre of the NW cell. */
export function rowColToLonLat(grid: GridSpec, row: number, col: number): LonLat {
  const lon = grid.west + ((col + 0.5) / grid.width) * (grid.east - grid.west);
  const lat = grid.north - ((row + 0.5) / grid.height) * (grid.north - grid.south);
  return [lon, lat];
}

/** Ground distance in metres between two lon/lats (local equirectangular, fine at km scale). */
export function distanceM(grid: GridSpec, a: LonLat, b: LonLat): number {
  const R = grid.marsRadiusM;
  const meanLat = ((a[1] + b[1]) / 2) * DEG;
  const dx = (b[0] - a[0]) * DEG * R * Math.cos(meanLat);
  const dy = (b[1] - a[1]) * DEG * R;
  return Math.hypot(dx, dy);
}

/** Raster values at a lon/lat (nearest cell). Null outside the grid. Fields can be NaN where there is no data. */
export function samplePoint(
  layers: Layers,
  lonLat: LonLat,
): { elevationM: number; slopeDeg: number; surfaceId: number } | null {
  const cell = lonLatToCell(layers.grid, lonLat);
  if (!cell) return null;
  return {
    elevationM: layers.elevation[cell.index] ?? NaN,
    slopeDeg: layers.slope[cell.index] ?? NaN,
    surfaceId: layers.surface[cell.index] ?? 0,
  };
}
