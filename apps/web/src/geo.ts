import type { GridSpec, LonLat } from "@marsmap/core";

export const MARS_RADIUS_M = 3396190;
/** Metres per degree of latitude on Mars (2*pi*R/360 = 59.27 km). */
export const M_PER_DEG_LAT = (2 * Math.PI * MARS_RADIUS_M) / 360;

export function cellIndex(g: GridSpec, [lon, lat]: LonLat): number | null {
  const col = Math.floor(((lon - g.west) / (g.east - g.west)) * g.width);
  const row = Math.floor(((g.north - lat) / (g.north - g.south)) * g.height);
  if (col < 0 || row < 0 || col >= g.width || row >= g.height) return null;
  return row * g.width + col;
}

export function inGrid(g: GridSpec, p: LonLat): boolean {
  return cellIndex(g, p) !== null;
}

/** Bilinear sample of a float raster at fractional cell coords (cell centres at +0.5). */
export function sampleBilinear(g: GridSpec, arr: Float32Array, lon: number, lat: number): number {
  const fx = ((lon - g.west) / (g.east - g.west)) * g.width - 0.5;
  const fy = ((g.north - lat) / (g.north - g.south)) * g.height - 0.5;
  const x0 = Math.max(0, Math.min(g.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(g.height - 1, Math.floor(fy)));
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const a = arr[y0 * g.width + x0]!, b = arr[y0 * g.width + x1]!;
  const c = arr[y1 * g.width + x0]!, d = arr[y1 * g.width + x1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function marsDistanceM(a: LonLat, b: LonLat, R = MARS_RADIUS_M): number {
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR;
  const dLon = (b[0] - a[0]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LonLat, b: LonLat): number {
  const toR = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
  const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Offset a Mars lon/lat by metres east/north. */
export function offsetLonLat([lon, lat]: LonLat, eastM: number, northM: number): LonLat {
  return [lon + eastM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)), lat + northM / M_PER_DEG_LAT];
}

/** A polyline with cumulative distances, for interpolation along routes. */
export interface Measured {
  pts: LonLat[];
  cum: number[];
  total: number;
}

export function measure(pts: LonLat[]): Measured {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + marsDistanceM(pts[i - 1]!, pts[i]!));
  return { pts, cum, total: cum[cum.length - 1] ?? 0 };
}

export function pointAt(m: Measured, d: number): { p: LonLat; i: number } {
  if (m.pts.length === 0) return { p: [0, 0], i: 0 };
  if (d <= 0) return { p: m.pts[0]!, i: 0 };
  if (d >= m.total) return { p: m.pts[m.pts.length - 1]!, i: m.pts.length - 1 };
  let lo = 0, hi = m.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (m.cum[mid]! <= d) lo = mid; else hi = mid;
  }
  const seg = m.cum[hi]! - m.cum[lo]!;
  const t = seg > 0 ? (d - m.cum[lo]!) / seg : 0;
  const a = m.pts[lo]!, b = m.pts[hi]!;
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], i: lo };
}

/** Nearest vertex distance-along and offset from the line (metres, approximate). */
export function nearestOnLine(m: Measured, p: LonLat): { along: number; offM: number } {
  let best = Infinity, along = 0;
  for (let i = 0; i < m.pts.length - 1; i++) {
    const a = m.pts[i]!, b = m.pts[i + 1]!;
    const kx = M_PER_DEG_LAT * Math.cos((a[1] * Math.PI) / 180), ky = M_PER_DEG_LAT;
    const ax = 0, ay = 0, bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky;
    const px = (p[0] - a[0]) * kx, py = (p[1] - a[1]) * ky;
    const L2 = bx * bx + by * by;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / L2)) : 0;
    const d = Math.hypot(px - bx * t, py - by * t);
    if (d < best) { best = d; along = m.cum[i]! + Math.sqrt(L2) * t; }
  }
  return { along, offM: best };
}
