/** On-map safety overlay: the point-of-no-return marker, and on small screens a one-line verdict. */
import { fmtMin } from "./SafetyBudget";
import { CheckIcon, ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { selectedResult, usableTimeS, useStore } from "../store";
import { fmtMin as fmtDur } from "./SafetyBudget";
import { getMap, RELAYOUT_LABELS } from "../map/MapView";
import { PNR_METHOD_NOTE, usePnr } from "../usePnr";
import { MAP_LABEL_BOX, MAP_LABEL_MARK, MAP_LABEL_TONE } from "../map/mapLabel";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

export function MapSafety({ planVisible, onOpenPlan }: { planVisible: boolean; onOpenPlan: () => void }) {
  const results = useStore((s) => s.results);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const params = useStore((s) => s.params);
  const goMode = useStore((s) => s.go.mode);
  const area = useStore((s) => s.area);
  const r = selectedResult({ results, selectedProfile });
  const pnr = usePnr();

  // ---------- PNR marker ----------
  // The chip only says *where*; the time itself is in the suit meter (and in the chip's tooltip).
  useEffect(() => {
    const map = getMap();
    if (!map || !pnr) return;
    const el = document.createElement("div");
    const isPnr = pnr.kind === "pnr";
    el.className = "pnr-marker pointer-events-auto flex cursor-help flex-col items-center";
    const label = pnr.kind === "pnr" ? (pnr.atStop ? "Leave stop to turn back" : "Turn back here") : "Tightest point";
    const detail =
      pnr.kind === "pnr"
        ? `Point of no return: turn back by ${fmtDur(pnr.elapsedS)} elapsed${pnr.atStop ? " (leave this stop by then)" : ""}.`
        : `Tightest point of the walk: turning back here still leaves ${fmtDur(pnr.marginS)} spare.`;
    // A plate on a post with a diamond at the spot (the post is taller in 3D); at a stop the stop's own marker is the spot.
    el.innerHTML =
      `<div class="pnr-chip flex items-center gap-[5px] ${MAP_LABEL_BOX} ${MAP_LABEL_TONE.strong}">` +
      `<svg class="size-3 flex-none ${isPnr ? MAP_LABEL_MARK.warn : MAP_LABEL_MARK.ok}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg><b class="font-semibold"></b></div>` +
      `<div class="h-2 w-0.5 shadow-[0_0_0_1px_rgba(0,0,0,0.75)] [.map-3d_&]:h-3.5 ${isPnr ? "bg-warn" : "bg-ok"}"></div>` +
      (pnr.atStop ? "" : `<div class="-mb-[5px] size-2.5 rotate-45 border-2 border-well ${isPnr ? "bg-warn shadow-[0_0_0_1.5px_var(--warn)]" : "bg-ok shadow-[0_0_0_1.5px_var(--ok)]"}"></div>`);
    el.querySelector("b")!.textContent = label;
    // A note on the map, not a control: named for screen readers, kept out of the tab order.
    el.setAttribute("aria-label", `${label}. ${detail}`);
    el.title = `${detail}\n\n${PNR_METHOD_NOTE}`;
    const m = new maplibregl.Marker({ element: el, anchor: "bottom", offset: pnr.atStop ? [0, -12] : [0, 0] }).setLngLat(pnr.point).addTo(map);
    el.tabIndex = -1;
    map.fire(RELAYOUT_LABELS);
    return () => {
      m.remove();
    };
  }, [pnr, area]);

  // The Plan tab carries the verdict and the budgets. Only small screens, where the sheet hides it, get a stand-in.
  if (!r || !params || !r.reachable || goMode !== "off") return null;
  const t = r.totals;
  const usableT = usableTimeS(params);
  const ok = t.withinLimits;
  const over = t.limitingFactor === "oxygen" ? "Over O₂" : t.limitingFactor === "energy" ? "Over energy" : "Over time";
  return (
    <>
      {/* Phones and tablets: one line of the verdict rides on the map while the Plan tab, its home, is folded or on another tab. */}
      {!planVisible && <Panel className={cn("map-safety mt-2 hidden h-9 min-w-0 flex-none sheet:flex", !ok && "border-bad/55")} role="status">
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm" onClick={onOpenPlan} title="Open plan">
        {ok ? <CheckIcon className="size-4 flex-none text-ok" aria-hidden /> : <TriangleAlertIcon className="size-4 flex-none text-bad" aria-hidden />}
        <b className="font-semibold whitespace-nowrap">{ok ? "Fits the limits" : over}</b>
        <span className="truncate text-muted-foreground">
          {fmtMin(t.totalTimeS)} of {fmtMin(usableT)}
        </span>
        <ChevronRightIcon className="size-4 flex-none text-muted-foreground" aria-hidden />
        </button>
      </Panel>}
    </>
  );
}
