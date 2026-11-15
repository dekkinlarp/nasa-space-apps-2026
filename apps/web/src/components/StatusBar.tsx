/**
 * The strip along the bottom of the map: the map key, where the imagery comes from, the scale bar, and the position
 * under the pointer (the centre of the view when the pointer is elsewhere).
 */
import { useEffect, useState } from "react";
import type { LonLat } from "@marsmap/core";
import { useStore } from "../store";
import { fmtLonLat, fmtNum } from "../format";
import { getMap, mountScaleBar } from "../map/MapView";
import { pictureGroup } from "../map/imageryTiles";
import { MapLegend } from "./MapLegend";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/** The centre of the map view, kept current as the map moves. Null until the map exists. */
function useMapCentre(): LonLat | null {
  const [centre, setCentre] = useState<LonLat | null>(null);
  useEffect(() => {
    let raf = 0;
    let off = () => {};
    const attach = () => {
      const map = getMap();
      if (!map) return false;
      const read = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const c = map.getCenter();
          setCentre([c.lng, c.lat]);
        });
      };
      map.on("move", read);
      read();
      off = () => map.off("move", read);
      return true;
    };
    // The map is created by MapView after this mounts, so look for it until it is there.
    const wait = attach() ? 0 : window.setInterval(() => attach() && window.clearInterval(wait), 250);
    return () => {
      window.clearInterval(wait);
      cancelAnimationFrame(raf);
      off();
    };
  }, []);
  return centre;
}

/**
 * On wide screens it is its own floating panel at the foot of the map. On the bottom-sheet layout it is the
 * sheet's last row (`inSheet`): no panel of its own, a rule above it, and the sheet's side gutter.
 */
export function StatusBar({ inSheet = false }: { inSheet?: boolean }) {
  const area = useStore((s) => s.area);
  const baseImagery = useStore((s) => s.baseImagery);
  const hover = useStore((s) => s.hover);
  const centre = useMapCentre();
  const credit = area?.manifest.imagery.find((i) => pictureGroup(i) === baseImagery)?.source ?? "";
  const at = hover?.lonLat ?? centre;
  return (
    <Panel
      className={cn(
        "status-bar flex min-w-0 flex-none items-center gap-3 text-xs text-ink-2",
        inSheet
          ? "h-(--foot) rounded-none border-0 border-t border-border bg-transparent pr-[max(var(--gutter),env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(var(--gutter),env(safe-area-inset-left))] shadow-none [backdrop-filter:none]"
          : "h-(--status-h) rounded-lg px-2.5",
      )}
    >
      <MapLegend />
      <span className="h-3.5 w-px flex-none bg-input" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={credit ? `Imagery: ${credit}` : undefined}>
        {credit ? `Imagery: ${credit}` : "No base imagery"}
      </span>
      {/* MapLibre draws the scale bar; it is moved in here (see mountScaleBar). */}
      <span ref={mountScaleBar} className="flex-none" />
      {at && (
        <span className="flex-none font-mono whitespace-pre phone:hidden" title={hover ? "Position under the pointer" : "Centre of the view"}>
          {fmtLonLat(at)}
        </span>
      )}
      {hover?.elevationM != null && (
        <span className="flex-none font-mono phone:hidden" title="Elevation under the pointer">
          {fmtNum(hover.elevationM, 0, " m").replace("-", "−")}
        </span>
      )}
    </Panel>
  );
}
