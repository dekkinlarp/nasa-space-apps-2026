import surfaceConfig from "../../../config/surface-classes.json";
import { computeSlope } from "../src/load";
import { cellToLonLat } from "../src/grid";
import type { GridSpec, Layers, LonLat, SurfaceClass } from "../src/types";

export const CLASSES: SurfaceClass[] = surfaceConfig.classes;
export const BEDROCK = 1;
export const SAND = 3;
export const R_MARS = 3396190;

/** A grid of square `cs`-metre cells centred on (0 E, 0 N). */
export function makeGrid(width: number, height: number, cs = 2): GridSpec {
  const dLat = (cs / R_MARS) * (180 / Math.PI);
  return {
    id: "test",
    west: 137 - (width / 2) * dLat,
    east: 137 + (width / 2) * dLat,
    south: -(height / 2) * dLat,
    north: (height / 2) * dLat,
    width,
    height,
    cellSizeM: cs,
    marsRadiusM: R_MARS,
  };
}

export function makeLayers(
  width: number,
  height: number,
  elev: (r: number, c: number) => number = () => 0,
  surf: (r: number, c: number) => number = () => BEDROCK,
  cs = 2,
): Layers {
  const grid = makeGrid(width, height, cs);
  const elevation = new Float32Array(width * height);
  const surface = new Uint8Array(width * height);
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      elevation[r * width + c] = elev(r, c);
      surface[r * width + c] = surf(r, c);
    }
  return { grid, elevation, slope: computeSlope(grid, elevation), surface, surfaceClasses: CLASSES };
}

export function at(layers: Layers, r: number, c: number): LonLat {
  return cellToLonLat(layers.grid, r * layers.grid.width + c);
}

/** Local metres east/north of a reference lon/lat. */
export function toMetres(grid: GridSpec, ref: LonLat, p: number[]): [number, number] {
  const k = (Math.PI / 180) * grid.marsRadiusM;
  return [(p[0]! - ref[0]) * k * Math.cos((ref[1] * Math.PI) / 180), (p[1]! - ref[1]) * k];
}
