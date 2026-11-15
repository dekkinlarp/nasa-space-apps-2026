/**
 * The shapes that are drawn both on the map and in the panels, kept in one place so they stay alike.
 * Map markers are built by hand for MapLibre, so these are utility strings rather than components.
 */

/** Text of anything named on the map: 11px semibold in the app font. */
export const MAP_LABEL = "text-[11px]/4 font-semibold whitespace-nowrap";

/**
 * A boxed label on the map (walk-limit ring, turn-back point, the walker's countdown, a hovered place):
 * 4px corner, hairline border, one dark fill. Status shows through the border and text colour only.
 * The hovered place label in MapView repeats these classes behind a group variant; keep the two in step.
 */
export const MAP_LABEL_BOX = `${MAP_LABEL} rounded-sm border bg-glass-thick px-1.5`;

export const MAP_LABEL_TONE = {
  neutral: "border-input text-ink-2",
  warn: "border-warn/55 text-warn",
  ok: "border-ok/55 text-ok",
  sim: "border-sim/55 text-sim",
} as const;

/** A stop's number, in the Plan tab's list and on the map: the same corner and border, at the size each place needs. */
export const STOP_BADGE = "grid flex-none place-items-center rounded-md border-[1.5px] font-semibold";
export const STOP_BADGE_NUMBER = "border-foreground bg-well text-foreground";
/** The start is the same shape inverted. */
export const STOP_BADGE_START = "border-well bg-foreground text-well";
