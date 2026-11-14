/** On-map safety overlay: compact time / energy meter and the point-of-no-return marker. */
import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { selectedResult, usableTimeS, useStore } from "../store";
import { fmtEnergy } from "../format";
import { fmtMin as fmtDur } from "./SafetyBudget";
import { getMap, RELAYOUT_LABELS } from "../map/MapView";
import { PNR_METHOD_NOTE, usePnr } from "../usePnr";
import "./safety.css";

function MiniBar({ label, f, text }: { label: string; f: number; text: string }) {
  const st = f > 1 ? "bad" : f > 0.85 ? "warn" : "ok";
  return (
    <div className={`mini is-${st}`} title={text}>
      <span className="mini-k">{label}</span>
      <span className="mini-bar">
        <i style={{ width: `${Math.min(100, f * 100)}%` }} />
      </span>
      <span className="mini-v">{Math.round(f * 100)}%</span>
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
    el.className = `pnr-marker ${pnr.kind}`;
    const label = pnr.kind === "pnr" ? (pnr.atStop ? "Leave stop to turn back" : "Turn back here") : "Tightest point";
    const detail =
      pnr.kind === "pnr"
        ? `Point of no return: turn back by ${fmtDur(pnr.elapsedS)} elapsed${pnr.atStop ? " (leave this stop by then)" : ""}.`
        : `Tightest point of the walk: turning back here still leaves ${fmtDur(pnr.marginS)} spare.`;
    if (pnr.atStop) el.classList.add("at-stop");
    el.innerHTML = `<div class="pnr-chip"><span class="pnr-ico">⟲</span><b></b></div><div class="pnr-stem"></div><div class="pnr-pin"></div>`;
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
  const over = t.limitingFactor === "energy" ? "Over O₂" : "Over time";
  return (
    <div className={`map-safety ${ok ? "is-ok" : "is-bad"}`}>
      <div className="ms-head">
        <span className="ms-title">Suit</span>
        <span className={`ms-state ${ok ? "is-ok" : "is-bad"}`} title={ok ? "Time and O₂ / energy both inside the usable budget" : `Over the usable ${t.limitingFactor ?? ""} budget`}>
          {ok ? "Within limits" : over}
        </span>
      </div>
      <MiniBar label="Time" f={ft} text={`${fmtDur(t.totalTimeS)} of ${fmtDur(usableT)} usable (limit ${fmtDur(params.evaLimitS)} minus ${Math.round(params.reserveFraction * 100)}% reserve)`} />
      <MiniBar label="O₂" f={fe} text={`${fmtEnergy(t.energyKJ)} of ${fmtEnergy(usableE)} usable metabolic energy (oxygen proxy)`} />
      {pnr && (
        <div
          className={`ms-pnr ${pnr.kind}`}
          title={`${pnr.kind === "pnr" ? "Point of no return (marked on the map): turn back by this elapsed time." : "Spare time if you turn back at the tightest point (marked on the map)."}\n\n${PNR_METHOD_NOTE}`}
        >
          <span className="mini-k">{pnr.kind === "pnr" ? "Turn back" : "Margin"}</span>
          <b>{pnr.kind === "pnr" ? `by ${fmtDur(pnr.elapsedS)}` : fmtDur(pnr.marginS)}</b>
        </div>
      )}
    </div>
  );
}
