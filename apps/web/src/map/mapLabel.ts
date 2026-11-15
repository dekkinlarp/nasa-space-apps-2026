/**
 * The shapes that are drawn both on the map and in the panels, kept in one place so they stay alike.
 * Map markers are built by hand for MapLibre, so these are utility strings rather than components.
 */

/** Text of anything named on the map: 11px semibold in the app font. */
export const MAP_LABEL = "text-[11px]/4 font-semibold whitespace-nowrap";

/**
 * A place name on the map: unboxed, with a crisp dark outline round the letters so it reads on any ground.
 * The outline is a stroke painted under the fill, so the letters keep their weight.
 */
export const MAP_LABEL_HALO = "text-white [-webkit-text-stroke:3px_var(--well)] [paint-order:stroke_fill]";

/**
 * A boxed label on the map (walk-limit ring, turn-back point, the walker's countdown, a hovered place):
 * 4px corner, hairline border, one dark fill, neutral text. A label that reports a status carries it once,
 * on a mark (MAP_LABEL_MARK), never on the border or the text.
 * The hovered place label in MapView repeats these classes behind a group variant; keep the two in step.
 */
export const MAP_LABEL_BOX = `${MAP_LABEL} rounded-sm border border-input bg-glass-thick px-1.5`;

/** Text of a boxed label: quiet for a plain measure (a ring's time), full ink for one that names an event or a limit. */
export const MAP_LABEL_TONE = { neutral: "text-ink-2", strong: "text-foreground" } as const;

/** The status colour of a label's mark: its icon, or the dot from mapLabelDot(). */
export const MAP_LABEL_MARK = { warn: "text-warn", ok: "text-ok", sim: "text-sim" } as const;

/** A 6px dot in a status colour, for a boxed label that has no icon of its own. */
export const mapLabelDot = (mark: keyof typeof MAP_LABEL_MARK) => `<i class="mr-[5px] inline-block size-1.5 rounded-full bg-current align-[1px] ${MAP_LABEL_MARK[mark]}" aria-hidden="true"></i>`;

/** A stop's number, in the Plan tab's list and on the map: the same corner and border, at the size each place needs. */
export const STOP_BADGE = "grid flex-none place-items-center rounded-md border-[1.5px] font-semibold";
export const STOP_BADGE_NUMBER = "border-foreground bg-well text-foreground";
/** The start is the same shape inverted. */
export const STOP_BADGE_START = "border-well bg-foreground text-well";
