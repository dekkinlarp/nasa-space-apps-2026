/**
 * The shapes that are drawn both on the map and in the panels, kept in one place so they stay alike.
 * Map markers are built by hand for MapLibre, so these are utility strings rather than components.
 */

/** Text of anything named on the map: 11px medium in the mono face. */
export const MAP_LABEL = "font-mono text-[11px]/4 font-medium whitespace-nowrap";

/**
 * Every label on the map is one physical thing: a small black plate with engraved mono text. The walk-limit
 * ring, the turn-back point, the walker's countdown and place names all use it.
 * The plate is lit from above like the raised controls (`shadow-plate` in index.css): no border, the edge is
 * in the shadow. The text is cut in: a dark line above the letters. The text stays neutral; a label that
 * reports a status carries it once, on a mark (MAP_LABEL_MARK), never on the plate or the text.
 * In 2D a plate lies beside its point. In 3D (the map container has `map-3d`) it stands on a post above it:
 * MAP_LABEL_POST and MAP_LABEL_BASE are the post and the mark where it meets the ground.
 */
export const MAP_LABEL_BOX = `${MAP_LABEL} inline-flex h-[18px] items-center rounded-sm bg-well px-1.5 shadow-plate text-shadow-[0_-1px_0_rgba(0,0,0,0.9)]`;

/** Text of a plate: quiet for a plain measure (a ring's time), full ink for one that names a place, an event or a limit. */
export const MAP_LABEL_TONE = { neutral: "text-ink-2", strong: "text-foreground" } as const;

/** The status colour of a label's mark: its icon, or the lamp from mapLabelDot(). */
export const MAP_LABEL_MARK = { warn: "text-warn", ok: "text-ok", sim: "text-sim" } as const;

/** A status lamp: a 6px light in its status colour, with a highlight on top, a dark rim and a faint ring of its own colour. */
const MAP_LABEL_LAMP = "shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_0_1px_rgba(0,0,0,0.75),0_0_4px_0_currentColor]";
export const mapLabelDot = (mark: keyof typeof MAP_LABEL_MARK) =>
  `<i class="mr-[5px] inline-block size-1.5 flex-none rounded-full bg-current ${MAP_LABEL_LAMP} ${MAP_LABEL_MARK[mark]}" aria-hidden="true"></i>`;

/** The post a plate stands on in 3D, and the mark at its foot. Both are absent in 2D. */
export const MAP_LABEL_POST = "map-post hidden [.map-3d_&]:block";
export const MAP_LABEL_BASE = "hidden size-1.5 flex-none -mb-[3px] rounded-full bg-ink-2 shadow-[0_0_0_1px_rgba(0,0,0,0.75)] [.map-3d_&]:block";

/** A stop's number, in the Plan tab's list and on the map: the same corner and border, at the size each place needs. */
export const STOP_BADGE = "grid flex-none place-items-center rounded-md border-[1.5px] font-semibold";
export const STOP_BADGE_NUMBER = "border-foreground bg-well text-foreground";
/** The start is the same shape inverted. */
export const STOP_BADGE_START = "border-well bg-foreground text-well";
