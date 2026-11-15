/**
 * The strip along the bottom of the map: the map key, the elevation profile's toggle, where the imagery comes from,
 * the scale bar, and the position under the pointer (the centre of the view when the pointer is elsewhere).
 */
import { useEffect, useMemo, useState } from "react";
import type { LonLat } from "@marsmap/core";
import { selectedResult, useStore } from "../store";
import { fmtDist, fmtLonLat } from "../format";
import { getMap, mountScaleBar, resizeMapDuring } from "../map/MapView";
import { pictureGroup } from "../map/imageryTiles";
import { MapLegend } from "./MapLegend";
import { BottomPaneIcon } from "./icons";
import { routeReliefM, useProfileUi } from "./ProfileStrip";
import { PANEL_MS } from "../App";
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

const rule = <span className="h-3.5 w-px flex-none bg-input" aria-hidden />;

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
    <span className="flex flex-none items-center gap-3 phone:in-[.sheet-open]:hidden squat:in-[.sheet-open]:hidden">
      {rule}
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
  const row = "status-bar flex min-w-0 flex-none items-center gap-3 text-xs text-ink-2";
  const content = (
    <>
      <MapLegend />
      <ElevationToggle />
      {rule}
      <span className="min-w-0 flex-1 truncate" title={credit ? `Imagery: ${credit}` : undefined}>
        {credit ? `Imagery: ${credit}` : "No base imagery"}
      </span>
      {/* MapLibre draws the scale bar; it is moved in here (see mountScaleBar). */}
      <span ref={mountScaleBar} className="flex-none" />
      {/* The position only: the elevation under the pointer is in the hover readout. */}
      {at && (
        <span className="flex-none font-mono whitespace-pre phone:hidden" title={hover ? "Position under the pointer" : "Centre of the view"}>
          {fmtLonLat(at)}
        </span>
      )}
    </>
  );
  // In the sheet it is a row of the sheet, not a surface of its own.
  if (inSheet)
    return (
      <div className={cn(row, "pointer-events-auto h-(--foot) border-t pr-[max(var(--gutter),env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(var(--gutter),env(safe-area-inset-left))]")}>
        {content}
      </div>
    );
  return <Panel className={cn(row, "h-(--status-h) px-2.5")}>{content}</Panel>;
}
