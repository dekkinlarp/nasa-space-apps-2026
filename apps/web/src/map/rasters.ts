/** Computed overlays: typed arrays -> RGBA canvas -> blob URL for a MapLibre image source. */
import type { GridSpec, SurfaceClass } from "@marsmap/core";

type RGB = [number, number, number];

function hex(c: string): RGB {
  const h = c.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function ramp(stops: [number, string][]) {
  const s = stops.map(([t, c]) => [t, hex(c)] as const);
  return (t: number): RGB => {
    if (t <= s[0]![0]) return s[0]![1];
    for (let i = 1; i < s.length; i++) {
      const [t1, c1] = s[i]!;
      const [t0, c0] = s[i - 1]!;
      if (t <= t1) {
        const k = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return s[s.length - 1]![1];
  };
}

export const ELEV_RAMP: [number, string][] = [
  [0, "#1d2b53"], [0.2, "#2f6b8f"], [0.4, "#4fa38b"], [0.6, "#d8c46a"], [0.8, "#d9822b"], [1, "#f4efe6"],
];
export const SLOPE_STOPS: [number, string][] = [
  [0, "#1f7a4d"], [5, "#7fbf4d"], [10, "#f0d14a"], [15, "#f08a24"], [25, "#d6262b"], [35, "#5c0a2e"],
];
/** Fraction of usable EVA time; stops are packed at the low end where most of the map sits. */
export const COST_RAMP: [number, string][] = [
  [0, "#36d1c4"], [0.1, "#4f9be8"], [0.25, "#8a6cf0"], [0.5, "#e05fb0"], [1, "#ff4d4d"],
];

export async function toUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
}

export function paint(g: Pick<GridSpec, "width" | "height">, fn: (i: number, px: Uint8ClampedArray, o: number) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = g.width;
  c.height = g.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(g.width, g.height);
  const n = g.width * g.height;
  for (let i = 0; i < n; i++) fn(i, img.data, i * 4);
  ctx.putImageData(img, 0, 0);
  return c;
}

export function elevationUrl(g: GridSpec, elev: Float32Array, min: number, max: number) {
  const r = ramp(ELEV_RAMP);
  const span = Math.max(1e-6, max - min);
  return toUrl(
    paint(g, (i, px, o) => {
      const v = elev[i]!;
      if (!Number.isFinite(v)) return;
      const [R, G, B] = r((v - min) / span);
      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 255;
    }),
  );
}

export function slopeUrl(g: GridSpec, slope: Float32Array) {
  const r = ramp(SLOPE_STOPS);
  return toUrl(
    paint(g, (i, px, o) => {
      const v = slope[i]!;
      if (!Number.isFinite(v)) return;
      const [R, G, B] = r(v);
      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = v < 2 ? 90 : 255;
    }),
  );
}

export function surfaceUrl(g: GridSpec, surface: Uint8Array, classes: SurfaceClass[]) {
  const lut = new Map(classes.map((c) => [c.id, hex(c.color)]));
  return toUrl(
    paint(g, (i, px, o) => {
      const c = lut.get(surface[i]!);
      if (!c) return;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }),
  );
}

/** Where the surface estimate is weakest: low confidence is drawn, high confidence is left clear. */
export function confidenceUrl(g: GridSpec, conf: Uint8Array) {
  return toUrl(
    paint(g, (i, px, o) => {
      const k = Math.max(0, Math.min(1, (CONFIDENCE_CLEAR - conf[i]!) / (CONFIDENCE_CLEAR - CONFIDENCE_LOW)));
      if (k <= 0) return;
      px[o] = 232; px[o + 1] = 62; px[o + 2] = 140; px[o + 3] = 40 + k * 190;
    }),
  );
}
/** Confidence scores run 40-200 (see the pipeline); at or below LOW is drawn solid, at or above CLEAR not at all. */
export const CONFIDENCE_LOW = 60;
export const CONFIDENCE_CLEAR = 150;

/** One hue per science layer, dark to bright. */
export const SCIENCE_RAMPS: [number, string][][] = [
  [[0, "#0d4a3a"], [0.5, "#22b089"], [1, "#b6ffd9"]],
  [[0, "#5a3d00"], [0.5, "#e0a100"], [1, "#fff2a8"]],
  [[0, "#10306b"], [0.5, "#3f8cff"], [1, "#c9e4ff"]],
  [[0, "#4a1259"], [0.5, "#c04ee0"], [1, "#f6d0ff"]],
];

/** A float layer coloured between min and max; values at or below min (and NaN) stay clear. */
export function scienceUrl(g: GridSpec, data: Float32Array, min: number, max: number, stops: [number, string][]) {
  const r = ramp(stops);
  const span = Math.max(1e-12, max - min);
  return toUrl(
    paint(g, (i, px, o) => {
      const v = data[i]!;
      if (!(v > min)) return;
      const t = Math.min(1, (v - min) / span);
      const [R, G, B] = r(t);
      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 110 + t * 145;
    }),
  );
}

/** Round-trip walking time from the start, coloured as a fraction of the usable budget. */
export function costUrl(g: GridSpec, out: Float32Array, back: Float32Array, usableS: number) {
  const r = ramp(COST_RAMP);
  return toUrl(
    paint(g, (i, px, o) => {
      const t = out[i]! + back[i]!;
      if (!Number.isFinite(t)) return;
      const f = t / usableS;
      if (f > 1) {
        px[o] = 40; px[o + 1] = 10; px[o + 2] = 20; px[o + 3] = 150;
        return;
      }
      const [R, G, B] = r(f);
      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 220;
    }),
  );
}

export function cssGradient(stops: [number, string][], max = stops[stops.length - 1]![0]) {
  return `linear-gradient(90deg, ${stops.map(([t, c]) => `${c} ${(t / max) * 100}%`).join(", ")})`;
}
