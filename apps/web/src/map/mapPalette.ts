/**
 * The colours the map's lines are painted in. MapLibre paint cannot read CSS variables, so the token
 * values are read from the document once, here, and nowhere else: change a token in index.css and the
 * lines follow. The fallbacks are the token values at the time of writing, for code that runs without a
 * document (the unit tests).
 */
const TOKENS = {
  ink: ["--ink", "#f2f2f3"],
  ink2: ["--ink-2", "#b4b6bb"],
  ok: ["--ok", "#f2f2f3"],
  warn: ["--warn", "#ff9f0a"],
  bad: ["--bad", "#ff453a"],
  sim: ["--sim", "#ffd60a"],
  rover: ["--poi-rover", "#c9cbcf"],
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
