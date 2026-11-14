/**
 * Client-side DEM tiles for MapLibre terrain. MapLibre thinks the map is Earth, so a Mars
 * degree is drawn as an Earth degree (1.88x larger in Earth metres). To keep true vertical
 * proportions, heights are multiplied by R_earth / R_mars before encoding; the
 * exaggeration slider then means real vertical exaggeration. Heights are relative to the
 * area's median elevation so the map centre sits near 0 m (negatives are fine in Terrarium). Encoding: Terrarium
 * (h = R*256 + G + B/256 - 32768).
 */
import maplibregl from "maplibre-gl";
import type { GridSpec } from "@marsmap/core";
import { sampleBilinear } from "../geo";

export const EARTH_RADIUS_M = 6378137;
export const DEM_TILE_SIZE = 256;

let current: { grid: GridSpec; elev: Float32Array; min: number; vscale: number } | null = null;
let registered = false;

export function setDemSource(grid: GridSpec, elev: Float32Array, ref: number) {
  current = { grid, elev, min: ref, vscale: EARTH_RADIUS_M / grid.marsRadiusM };
}

function tileLon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
function tileLat(y: number, z: number) {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

async function renderTile(z: number, x: number, y: number): Promise<ArrayBuffer> {
  const S = DEM_TILE_SIZE;
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const cur = current;
  for (let py = 0; py < S; py++) {
    const lat = tileLat(y + (py + 0.5) / S, z);
    for (let px = 0; px < S; px++) {
      const lon = tileLon(x + (px + 0.5) / S, z);
      let h = 0;
      if (cur) {
        const e = sampleBilinear(cur.grid, cur.elev, lon, lat);
        h = Number.isFinite(e) ? (e - cur.min) * cur.vscale : 0;
      }
      const v = h + 32768;
      const o = (py * S + px) * 4;
      d[o] = Math.floor(v / 256);
      d[o + 1] = Math.floor(v) % 256;
      d[o + 2] = Math.floor((v - Math.floor(v)) * 256);
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

export function registerDemProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol("marsdem", async (params) => {
    const m = /marsdem:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`bad DEM url ${params.url}`);
    const data = await renderTile(Number(m[1]), Number(m[2]), Number(m[3]));
    return { data };
  });
}

/** Zoom at which one DEM tile pixel is about one grid cell. */
export function demMaxZoom(grid: GridSpec) {
  const cellDeg = (grid.east - grid.west) / grid.width;
  const tileDeg = cellDeg * DEM_TILE_SIZE;
  return Math.max(10, Math.min(18, Math.round(Math.log2(360 / tileDeg))));
}
