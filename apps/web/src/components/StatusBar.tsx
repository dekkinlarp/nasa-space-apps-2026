/**
 * The strip along the bottom of the map: the map key, the elevation profile's toggle, the scale bar, the position (under the
 * pointer, or the centre of the view when the pointer is elsewhere), the readings under the pointer, and where the imagery comes from.
 */
import { useEffect, useMemo, useState } from "react";
import type { LonLat } from "@marsmap/core";
import { selectedResult, useStore } from "../store";
import { fmtDist, fmtLonLat } from "../format";
import { getMap, mountScaleBar, resizeMapDuring } from "../map/MapView";
import { pictureGroup } from "../map/imageryTiles";
import { MapLegend, MapLegendPanel } from "./MapLegend";
import { PointerReadings, StatusRule } from "./HoverReadout";
import { BottomPaneIcon } from "./icons";
import { routeReliefM, useProfileUi } from "./ProfileStrip";
import { PANEL_MS } from "../App";
import { Ticker } from "@/components/ui/ticker";
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
 * Opens and folds the elevation profile, and says in one line what it holds: the route's length and relief.
 * The profile itself opens above the status bar. Nothing to toggle until a route exists.
 */
function ElevationToggle() {
  const results = useStore((s) => s.results);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const open = useProfileUi((u) => u.open);
  const setOpen = useProfileUi((u) => u.setOpen);
  const r = selectedResult({ results, selectedProfile });
  const reliefM = useMemo(() => (r ? routeReliefM(r) : 0), [r]);
  if (!r || !r.reachable) return null;
  return (
    // Phones and short screens give the profile's room to the open sheet, so there is nothing to toggle there.
    <span className="flex flex-none items-center gap-2.5 phone:in-[.sheet-open]:hidden squat:in-[.sheet-open]:hidden">
      <StatusRule />
      <button
        type="button"
        className="-mx-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-1 text-xs whitespace-nowrap coarse:px-2"
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} elevation profile. ${fmtDist(r.totals.distanceM)}, ${Math.round(reliefM)} m relief.`}
        onClick={() => {
          setOpen(!open);
          useStore.getState().set({ profileHoverM: null, profileCursor: null });
          resizeMapDuring(PANEL_MS);
        }}
      >
        <BottomPaneIcon on={open} />
        <span className="font-medium text-foreground">Elevation</span>
        {/* The summary needs the width of a wide window; under that it is on the open profile instead. */}
        <span className="compact:hidden">
          · {fmtDist(r.totals.distanceM)} · {Math.round(reliefM)} m relief
        </span>
      </button>
    </span>
  );
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
  const row = "status-bar flex min-w-0 flex-none items-center gap-2.5 text-xs text-ink-2";
  // Left to right: the two controls, then the map's own measures (scale, position), then what is under the pointer,
  // and the credit at the far end. Everything of a fixed width comes first, so only the credit gives way as the
  // readings change with the pointer. A rule separates each piece.
  const content = (
    <>
      <MapLegend detached={!inSheet} />
      <ElevationToggle />
      <StatusRule />
      {/* MapLibre draws the scale bar; it is moved in here (see mountScaleBar). */}
      <span ref={mountScaleBar} className="flex-none" />
      {at && (
        <span className="flex flex-none items-center gap-2.5 phone:hidden">
          <StatusRule />
          <span className="font-mono whitespace-pre" title={hover ? "Position under the pointer" : "Centre of the view"}>
            {fmtLonLat(at)}
          </span>
        </span>
      )}
      <PointerReadings />
      <StatusRule />
      {/* The credit is said once, as text, and takes the room that is left. When it does not fit, its cut edge fades
          and blurs out and the line slides to its end and back (Ticker), so all of it can still be read. */}
      <Ticker className="flex-1">{credit ? `Imagery: ${credit}` : "No base imagery"}</Ticker>
    </>
  );
  // In the sheet it is a row of the sheet, not a surface of its own.
  if (inSheet)
    return (
      <div className={cn(row, "pointer-events-auto h-(--foot) border-t pr-[max(var(--gutter),env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(var(--gutter),env(safe-area-inset-left))]")}>
        {content}
      </div>
    );
  // The key floats above the bar as a panel of its own, so it is the same glass as the bar.
  return (
    <div className="relative min-w-0 flex-none">
      <MapLegendPanel className="absolute bottom-full left-0 z-4 mb-2" />
      {/* glass-host: the credit blurs at its cut edge, so the glass is a layer behind the content (see index.css). */}
      <Panel className={cn(row, "glass-host h-(--status-h) px-2.5")}>
        <i className="glass-layer" aria-hidden />
        {content}
      </Panel>
    </div>
  );
}
