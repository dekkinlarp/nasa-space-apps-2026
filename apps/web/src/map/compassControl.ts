/**
 * The map's compass: the last cell of the zoom stack, with a round dial set into it. The dial's ring turns
 * with the map; a marker shows north (in the signal colour while the map is turned) and, in the middle, the
 * direction the top of the screen faces. Click it to turn north up again (and level the
 * view); drag it sideways, or use the left and right arrow keys, to rotate the map.
 *
 * Built by hand for MapLibre's control stack, so its styles are utility strings, like the map markers.
 */
import type { IControl, Map as MLMap } from "maplibre-gl";

const FACING = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const FACING_NAME: Record<(typeof FACING)[number], string> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };

/** Twenty-four ticks round the rim; east, south and west are longer, and north is the marker instead. */
const ticks = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return "";
  const cardinal = i % 6 === 0;
  return `<line x1="22" y1="${cardinal ? 4.5 : 5.5}" x2="22" y2="${cardinal ? 9.5 : 8.5}" transform="rotate(${i * 15} 22 22)" stroke="currentColor" stroke-width="${cardinal ? 1.6 : 1.1}" opacity="${cardinal ? 0.9 : 0.5}"/>`;
}).join("");

const DIAL = `<svg viewBox="0 0 44 44" class="size-[30px] coarse:size-9" aria-hidden="true">
  <circle cx="22" cy="22" r="21" class="fill-well stroke-black"/>
  <g data-ring class="origin-center transition-transform duration-150 ease-out">${ticks}<path data-north d="M22 3v8" stroke="currentColor" stroke-width="3"/></g>
  <text data-facing x="22" y="22.5" text-anchor="middle" dominant-baseline="central" class="fill-current font-mono text-[13px] font-semibold">N</text>
</svg>`;

/* The cell is as wide as the zoom group above it (its keys plus its 1px edges) and carries the stack's bottom corners. */
const BUTTON =
  "grid h-[37px] w-[38px] cursor-grab touch-none place-items-center rounded-b-md border border-black border-t-input bg-hull-2 p-0 text-foreground shadow-float-sm select-none coarse:h-[45px] coarse:w-[46px] active:cursor-grabbing";

export class CompassControl implements IControl {
  private map: MLMap | null = null;
  private el: HTMLElement | null = null;
  private off: (() => void) | null = null;

  onAdd(map: MLMap): HTMLElement {
    this.map = map;
    // A plain control, not a group: it is styled as the last cell of the zoom stack above it.
    const wrap = document.createElement("div");
    wrap.className = "maplibregl-ctrl flex justify-center";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BUTTON;
    btn.innerHTML = DIAL;
    wrap.appendChild(btn);
    const ring = btn.querySelector("[data-ring]") as SVGGElement;
    const facing = btn.querySelector("[data-facing]") as SVGTextElement;
    const north = btn.querySelector("[data-north]") as SVGPathElement;

    const sync = () => {
      const bearing = map.getBearing();
      ring.style.transform = `rotate(${-bearing}deg)`;
      // North up is the resting state and carries no colour; a turned map shows where north went in the signal colour.
      north.style.color = Math.abs(bearing) > 0.5 ? "var(--signal)" : "var(--ink)";
      const dir = FACING[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!;
      facing.textContent = dir;
      const label = `Compass: facing ${FACING_NAME[dir]}. Click to turn north up, or drag to rotate.`;
      btn.title = label;
      btn.setAttribute("aria-label", label);
    };
    map.on("rotate", sync);
    sync();

    // A press that moves is a rotate; one that does not is a click.
    let start: { x: number; bearing: number } | null = null;
    let dragged = false;
    const down = (e: PointerEvent) => {
      start = { x: e.clientX, bearing: map.getBearing() };
      dragged = false;
      btn.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (!dragged && Math.abs(dx) < 4) return;
      dragged = true;
      map.setBearing(start.bearing + dx * 0.8);
    };
    const up = () => (start = null);
    const click = () => {
      if (dragged) return;
      map.resetNorthPitch({ duration: 600 });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      map.easeTo({ bearing: map.getBearing() + (e.key === "ArrowLeft" ? -15 : 15), duration: 200 });
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointermove", move);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("click", click);
    btn.addEventListener("keydown", key);

    this.el = wrap;
    this.off = () => map.off("rotate", sync);
    return wrap;
  }

  onRemove(): void {
    this.off?.();
    this.el?.remove();
    this.map = null;
    this.el = null;
  }
}
