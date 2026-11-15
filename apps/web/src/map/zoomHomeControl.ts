/**
 * The map's button strip: zoom in, zoom out and home, in one group above the compass. Home brings
 * the camera back to the opening view of the points of interest.
 *
 * It replaces MapLibre's NavigationControl so the three buttons share one look: each icon is an
 * inline SVG drawn in the foreground colour (MapLibre's own zoom icons are dark images lightened
 * with a filter, which never quite matched). The group's surface is styled in styles/maplibre.css.
 */
import type { IControl, Map as MLMap } from "maplibre-gl";

const svg = (body: string) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${body}</svg>`;
const STROKE = 'fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"';
const PLUS = svg(`<path d="M12 5.5v13M5.5 12h13" ${STROKE}/>`);
const MINUS = svg(`<path d="M5.5 12h13" ${STROKE}/>`);
/** A solid house with a chimney. */
const HOME = svg(
  `<path fill="currentColor" d="M11.35 3.24a1 1 0 0 1 1.3 0L15.5 5.8V5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v3.5l3 2.7a.8.8 0 0 1-.53 1.4H19V20a1 1 0 0 1-1 1h-4v-5.5h-4V21H6a1 1 0 0 1-1-1v-7.4H3.03a.8.8 0 0 1-.53-1.4z"/>`,
);

export class ZoomHomeControl implements IControl {
  private el: HTMLElement | null = null;
  private off: (() => void) | null = null;

  constructor(private goHome: (map: MLMap) => void) {}

  onAdd(map: MLMap): HTMLElement {
    const group = document.createElement("div");
    group.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = (label: string, icon: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = icon;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.addEventListener("click", onClick);
      group.appendChild(btn);
      return btn;
    };
    const zoomIn = button("Zoom in", PLUS, () => map.zoomIn());
    const zoomOut = button("Zoom out", MINUS, () => map.zoomOut());
    button("Back to the points of interest", HOME, () => this.goHome(map));

    const sync = () => {
      zoomIn.disabled = map.getZoom() >= map.getMaxZoom();
      zoomOut.disabled = map.getZoom() <= map.getMinZoom();
    };
    map.on("zoom", sync);
    sync();

    this.el = group;
    this.off = () => map.off("zoom", sync);
    return group;
  }

  onRemove(): void {
    this.off?.();
    this.el?.remove();
    this.el = null;
  }
}
