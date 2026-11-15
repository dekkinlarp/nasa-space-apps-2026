/**
 * The map's compass: a round dial whose ring turns with the map, a red marker at north and, in the
 * middle, the direction the top of the screen faces. Click it to turn north up again (and level the
 * view); drag it sideways, or use the left and right arrow keys, to rotate the map.
 *
 * Built by hand for MapLibre's control stack, so its styles are utility strings, like the map markers.
 */
import type { IControl, Map as MLMap } from "maplibre-gl";

const FACING = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const FACING_NAME: Record<(typeof FACING)[number], string> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };

/** Twelve ticks round the rim; east, south and west are longer, and north is the red marker instead. */
const ticks = Array.from({ length: 12 }, (_, i) => {
  if (i === 0) return "";
  const cardinal = i % 3 === 0;
  return `<line x1="22" y1="${cardinal ? 5 : 6}" x2="22" y2="${cardinal ? 10.5 : 9}" transform="rotate(${i * 30} 22 22)" stroke="currentColor" stroke-width="${cardinal ? 1.6 : 1.2}" stroke-linecap="round" opacity="${cardinal ? 0.85 : 0.5}"/>`;
}).join("");

const DIAL = `<svg viewBox="0 0 44 44" class="size-full" aria-hidden="true">
  <g data-ring class="origin-center transition-transform duration-150 ease-out">${ticks}<path d="M22 2.6 25.4 9.4 H18.6 Z" class="fill-bad"/></g>
  <text data-facing x="22" y="22" text-anchor="middle" dominant-baseline="central" class="fill-current text-[13px] font-semibold">N</text>
</svg>`;

const BUTTON =
  "glass grid size-9 cursor-grab touch-none place-items-center rounded-full p-0 text-foreground shadow-float-sm select-none coarse:size-11 active:cursor-grabbing";

export class CompassControl implements IControl {
  private map: MLMap | null = null;
  private el: HTMLElement | null = null;
  private off: (() => void) | null = null;

  onAdd(map: MLMap): HTMLElement {
    this.map = map;
    // A plain control, not a group: the dial is its own round surface under the zoom buttons.
    const wrap = document.createElement("div");
    wrap.className = "maplibregl-ctrl flex justify-center";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BUTTON;
    btn.innerHTML = DIAL;
    wrap.appendChild(btn);
    const ring = btn.querySelector("[data-ring]") as SVGGElement;
    const facing = btn.querySelector("[data-facing]") as SVGTextElement;

    const sync = () => {
      const bearing = map.getBearing();
      ring.style.transform = `rotate(${-bearing}deg)`;
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
