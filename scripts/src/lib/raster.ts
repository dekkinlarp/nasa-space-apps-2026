/** Small raster helpers (no NaNs expected unless noted). */

/** Separable box mean with radius r (window 2r+1), edges clamped. */
export function boxMean(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(a.length);
  const out = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += a[o + Math.min(w - 1, Math.max(0, k))]!;
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / n;
      s += a[o + Math.min(w - 1, x + r + 1)]! - a[o + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/** Local standard deviation in a (2r+1)^2 window. */
export function localStd(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const m = boxMean(a, w, h, r);
  const sq = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) sq[i] = a[i]! * a[i]!;
  const m2 = boxMean(sq, w, h, r);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.sqrt(Math.max(0, m2[i]! - m[i]! * m[i]!));
  return out;
}

/** Percentile rank in [0,1] of every value (ties share a rank). */
export function percentileRank(a: Float32Array): Float32Array {
  const sorted = Float32Array.from(a).sort();
  const out = new Float32Array(a.length);
  const n = sorted.length;
  for (let i = 0; i < a.length; i++) {
    let lo = 0;
    let hi = n;
    const v = a[i]!;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    out[i] = lo / (n - 1);
  }
  return out;
}

export function percentiles(a: Float32Array, ps: number[]): number[] {
  const s = Float32Array.from(a.filter((v) => !Number.isNaN(v))).sort();
  return ps.map((p) => s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]!);
}

/**
 * Slope in degrees by Horn's method. dx, dy = cell size in metres (E-W, N-S).
 * Edge cells use clamped neighbours.
 */
export function hornSlope(z: Float32Array, w: number, h: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(z.length);
  const at = (r: number, c: number) => z[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))]!;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const a = at(r - 1, c - 1), b = at(r - 1, c), cc = at(r - 1, c + 1);
      const d = at(r, c - 1), f = at(r, c + 1);
      const g = at(r + 1, c - 1), hh = at(r + 1, c), i = at(r + 1, c + 1);
      const dzdx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * dx);
      const dzdy = (g + 2 * hh + i - (a + 2 * b + cc)) / (8 * dy);
      out[r * w + c] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  return out;
}

/** Hillshade 0-255 (sun azimuth/altitude in degrees, azimuth clockwise from north). */
export function hillshade(z: Float32Array, w: number, h: number, dx: number, dy: number, az = 315, alt = 45, zFactor = 1): Uint8Array {
  const out = new Uint8Array(z.length);
  const D = Math.PI / 180;
  // Sun direction (east, north, up); azimuth clockwise from north.
  const Lx = Math.sin(az * D) * Math.cos(alt * D);
  const Ly = Math.cos(az * D) * Math.cos(alt * D);
  const Lz = Math.sin(alt * D);
  const at = (r: number, c: number) => z[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))]!;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const a = at(r - 1, c - 1), b = at(r - 1, c), cc = at(r - 1, c + 1);
      const d = at(r, c - 1), f = at(r, c + 1);
      const g = at(r + 1, c - 1), hh = at(r + 1, c), i = at(r + 1, c + 1);
      const dzdx = (zFactor * (cc + 2 * f + i - (a + 2 * d + g))) / (8 * dx);
      // +y is north; rows go south, so north-minus-south:
      const dzdy = (zFactor * (a + 2 * b + cc - (g + 2 * hh + i))) / (8 * dy);
      // surface normal (-dz/dE, -dz/dN, 1)
      const v = (-dzdx * Lx - dzdy * Ly + Lz) / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      out[r * w + c] = Math.max(0, Math.min(255, Math.round(255 * v)));
    }
  return out;
}

/** 3x3 majority filter on class ids (keeps the centre on ties). */
export function majority3(a: Uint8Array, w: number, h: number, nClasses: number): Uint8Array {
  const out = new Uint8Array(a.length);
  const cnt = new Int32Array(nClasses);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      cnt.fill(0);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = Math.min(h - 1, Math.max(0, r + dr));
          const cc = Math.min(w - 1, Math.max(0, c + dc));
          cnt[a[rr * w + cc]!]!++;
        }
      const self = a[r * w + c]!;
      let best = self;
      for (let k = 0; k < nClasses; k++) if (cnt[k]! > cnt[best]!) best = k;
      out[r * w + c] = best;
    }
  return out;
}
