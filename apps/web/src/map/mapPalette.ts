/**
 * The colours the map's lines are painted in. MapLibre paint cannot read CSS variables, so the token
 * values are read from the document once, here, and nowhere else: change a token in index.css and the
 * lines follow. The fallbacks are the token values at the time of writing, for code that runs without a
 * document (the unit tests).
 */
const TOKENS = {
  ink: ["--ink", "#e8eaed"],
  ink2: ["--ink-2", "#a8adb5"],
  ok: ["--ok", "#4cc38a"],
  warn: ["--warn", "#e5a93c"],
  bad: ["--bad", "#f2594b"],
  sim: ["--sim", "#36d1c4"],
  rover: ["--poi-rover", "#f2f0ea"],
} as const;

export type MapPalette = Record<keyof typeof TOKENS, string> & { casing: string };
let cached: MapPalette | null = null;

export function mapPalette(): MapPalette {
  if (cached) return cached;
  const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const out = { casing: "#000000" } as MapPalette;
  for (const [k, [name, fallback]] of Object.entries(TOKENS) as [keyof typeof TOKENS, readonly [string, string]][]) out[k] = css?.getPropertyValue(name).trim() || fallback;
  // Only a document can settle the values; without one the next call tries again.
  if (css) cached = out;
  return out;
}
