/** On-map safety overlay: compact time / energy meter and the point-of-no-return marker. */
import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { selectedResult, usableTimeS, useStore } from "../store";
import { fmtEnergy, fmtO2 } from "../format";
import { fmtMin as fmtDur } from "./SafetyBudget";
import { getMap, RELAYOUT_LABELS } from "../map/MapView";
import { PNR_METHOD_NOTE, usePnr } from "../usePnr";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/** Status colours for a used fraction: caution from 85 %, over at 100 %. */
const level = (f: number) => (f > 1 ? "bad" : f > 0.85 ? "warn" : "ok");
const TEXT = { ok: "", warn: "text-warn", bad: "text-bad" } as const;
const FILL = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" } as const;

function MiniBar({ label, f, text }: { label: string; f: number; text: string }) {
  const st = level(f);
  return (
    <div className="mt-[3px] grid cursor-help grid-cols-[62px_1fr_34px] items-center gap-1.5" title={text}>
      <span className="text-muted-foreground">{label}</span>
      <span className="h-[5px] overflow-hidden rounded-[3px] bg-well shadow-[inset_0_0_0_1px_var(--seam)]">
        <i className={cn("block h-full rounded-[3px]", FILL[st])} style={{ width: `${Math.min(100, f * 100)}%` }} />
      </span>
      <span className={cn("text-right font-semibold", TEXT[st])}>{Math.round(f * 100)}%</span>
    </div>
  );
}

export function MapSafety() {
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
    // A chip on a stem with a diamond at the spot; at a stop the stop's own marker is the spot.
    el.innerHTML =
      `<div class="flex items-center gap-[5px] rounded-sm border bg-[rgba(15,12,11,0.9)] pr-[7px] pl-[5px] whitespace-nowrap shadow-[0_2px_8px_rgba(0,0,0,0.6)] ${isPnr ? "border-warn" : "border-[rgba(111,212,138,0.7)]"}">` +
      `<span class="text-[12px]/4 font-bold ${isPnr ? "text-warn" : "text-ok"}">⟲</span><b class="text-[11px]/4 font-semibold ${isPnr ? "text-[#ffe7a8]" : "text-[#c9f0d3]"}"></b></div>` +
      `<div class="h-2 w-0.5 ${isPnr ? "bg-warn" : "bg-ok"}"></div>` +
      (pnr.atStop ? "" : `<div class="-mb-[5px] size-2.5 rotate-45 border-2 border-[#120c0a] ${isPnr ? "bg-warn shadow-[0_0_0_1.5px_var(--warn),0_2px_6px_rgba(0,0,0,0.7)]" : "bg-ok shadow-[0_0_0_1.5px_var(--ok),0_2px_6px_rgba(0,0,0,0.7)]"}"></div>`);
    el.querySelector("b")!.textContent = label;
    el.title = `${detail}\n\n${PNR_METHOD_NOTE}`;
    const m = new maplibregl.Marker({ element: el, anchor: "bottom", offset: pnr.atStop ? [0, -12] : [0, 0] }).setLngLat(pnr.point).addTo(map);
    map.fire(RELAYOUT_LABELS);
    return () => {
      m.remove();
    };
  }, [pnr, area]);

  if (!r || !params || !r.reachable || goMode !== "off") return null;
  const t = r.totals;
  const usableT = usableTimeS(params);
  const usableE = params.energyBudgetKJ * (1 - params.reserveFraction);
  const ft = t.timeUsedFraction ?? t.totalTimeS / usableT;
  const fe = t.energyUsedFraction ?? t.energyKJ / usableE;
  const ok = t.withinLimits;
  const fo = t.o2UsedFraction;
  const over = t.limitingFactor === "oxygen" ? "Over O₂" : t.limitingFactor === "energy" ? "Over energy" : "Over time";
  return (
    <Panel className={cn("w-[190px] flex-none px-2.5 pt-1.5 pb-[7px] text-[11.5px] sheet:hidden", !ok && "border-bad/55")}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] font-bold">Suit</span>
        <span
          className={cn("cursor-help text-xs font-semibold", ok ? "text-ok" : "text-bad")}
          title={ok ? "Time, energy and oxygen all inside the usable budget" : `Over the usable ${t.limitingFactor ?? ""} budget`}
        >
          {ok ? "Within limits" : over}
        </span>
      </div>
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
}
