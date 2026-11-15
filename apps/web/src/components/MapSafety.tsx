/** On-map safety overlay: compact time / energy meter and the point-of-no-return marker. */
import { fmtMin } from "./SafetyBudget";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { selectedResult, usableTimeS, useStore } from "../store";
import { fmtEnergy, fmtO2 } from "../format";
import { fmtMin as fmtDur } from "./SafetyBudget";
import { getMap, RELAYOUT_LABELS } from "../map/MapView";
import { PNR_METHOD_NOTE, usePnr } from "../usePnr";
import { MAP_LABEL_BOX, MAP_LABEL_MARK, MAP_LABEL_TONE } from "../map/mapLabel";
import { MeterHeadline, MiniBar } from "@/components/ui/mini-bar";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

export function MapSafety({ planVisible }: { planVisible: boolean }) {
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
    // A map label on a stem with a diamond at the spot; at a stop the stop's own marker is the spot.
    el.innerHTML =
      `<div class="pnr-chip flex items-center gap-[5px] ${MAP_LABEL_BOX} ${MAP_LABEL_TONE.strong}">` +
      `<svg class="size-3 flex-none ${isPnr ? MAP_LABEL_MARK.warn : MAP_LABEL_MARK.ok}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg><b class="font-semibold"></b></div>` +
      `<div class="h-2 w-0.5 ${isPnr ? "bg-warn" : "bg-ok"}"></div>` +
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

  // The Plan tab already carries the verdict and the budgets; this is their stand-in when it is out of sight.
  if (!r || !params || !r.reachable || goMode !== "off") return null;
  const t = r.totals;
  const usableT = usableTimeS(params);
  const usableE = params.energyBudgetKJ * (1 - params.reserveFraction);
  const ft = t.timeUsedFraction ?? t.totalTimeS / usableT;
  const fe = t.energyUsedFraction ?? t.energyKJ / usableE;
  const ok = t.withinLimits;
  const fo = t.o2UsedFraction;
  const over = t.limitingFactor === "oxygen" ? "Over O₂" : t.limitingFactor === "energy" ? "Over energy" : "Over time";
  // The full meter: the Plan tab's stand-in on wide screens when that tab is out of sight.
  const full = (
    <Panel className={cn("map-safety w-[200px] flex-none px-2.5 pt-1.5 pb-2 text-xs sheet:hidden", !ok && "border-bad/55")}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">Suit</span>
        <span
          className={cn("cursor-help text-xs font-semibold", ok ? "text-ok" : "text-bad")}
          title={ok ? "Time, energy and oxygen all inside the usable budget" : `Over the usable ${t.limitingFactor ?? ""} budget`}
        >
          {ok ? "Fits the limits" : over}
        </span>
      </div>
      {/* The tightest budget as the one number to glance at, then a meter for each. */}
      <MeterHeadline className="mt-1.5 mb-1.5" budgets={[{ name: "Time", f: ft }, { name: "Energy", f: fe }, ...(fo != null ? [{ name: "Oxygen", f: fo }] : [])]} />
      <MiniBar label="Time" f={ft} text={`${fmtDur(t.totalTimeS)} of ${fmtDur(usableT)} usable (limit ${fmtDur(params.evaLimitS)} minus ${Math.round(params.reserveFraction * 100)}% reserve)`} />
      <MiniBar label="Energy" f={fe} text={`${fmtEnergy(t.energyKJ)} of ${fmtEnergy(usableE)} usable metabolic energy`} />
      {fo != null && t.o2Kg != null && (
        <MiniBar label="O₂" f={fo} text={`${fmtO2(t.o2Kg)} of ${fmtO2((params.o2BudgetKg ?? 0) * (1 - params.reserveFraction))} usable oxygen (breathing + leakage, modelled)`} />
      )}
      {pnr && (
        <div
          className="mt-[5px] flex cursor-help items-baseline justify-between border-t pt-[5px]"
          title={`${pnr.kind === "pnr" ? "Point of no return (marked on the map): turn back by this elapsed time." : "Spare time if you turn back at the tightest point (marked on the map)."}\n\n${PNR_METHOD_NOTE}`}
        >
          <span className="text-muted-foreground">{pnr.kind === "pnr" ? "Turn back" : "Margin"}</span>
          <b className={cn("font-semibold", pnr.kind === "pnr" ? "text-warn" : "text-ok")}>{pnr.kind === "pnr" ? `by ${fmtDur(pnr.elapsedS)}` : fmtDur(pnr.marginS)}</b>
        </div>
      )}
    </Panel>
  );
  return (
    <>
      {/* Phones and tablets: one line of the verdict rides on the map while the Plan tab, its home, is folded or on another tab. */}
      {!planVisible && <Panel className={cn("map-safety mt-2 hidden h-9 min-w-0 flex-none items-center gap-1.5 px-3 text-sm sheet:flex", !ok && "border-bad/55")} role="status">
        {ok ? <CheckIcon className="size-4 flex-none text-ok" aria-hidden /> : <TriangleAlertIcon className="size-4 flex-none text-bad" aria-hidden />}
        <b className="font-semibold whitespace-nowrap">{ok ? "Fits the limits" : over}</b>
        <span className="truncate text-muted-foreground">
          {fmtMin(t.totalTimeS)} of {fmtMin(usableT)}
        </span>
      </Panel>}
      {!planVisible && full}
    </>
  );
}
