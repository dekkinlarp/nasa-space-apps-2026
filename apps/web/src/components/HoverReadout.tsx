import { useStore } from "../store";
import { fmtDist, fmtLonLat, fmtNum } from "../format";
import { sampleBest, surfaceById } from "../lib";
import { cellIndex, marsDistanceM } from "../geo";
import { scienceLayers, scienceRamp } from "../map/MapView";
import { Panel } from "@/components/ui/panel";
import { Swatch } from "@/components/ui/swatch";
import { cn } from "@/lib/utils";

const row = "mt-0.5 flex gap-x-3.5 gap-y-0.5 text-sm font-semibold whitespace-nowrap";
const unit = "text-xs font-normal text-muted-foreground";
const tag = "mr-[3px] text-[10px] font-medium tracking-[0.045em] text-muted-foreground uppercase";

export function HoverReadout() {
  const hover = useStore((s) => s.hover);
  const area = useStore((s) => s.area)!;
  const start = useStore((s) => s.start);
  const picking = useStore((s) => s.pickingStart);
  const surf = surfaceById(area.config.surfaceClasses, hover?.surfaceId);
  const sci = useStore((s) => s.sci);
  const sciData = useStore((s) => s.sciData);
  const confOn = useStore((s) => s.overlays.confidence.on);
  const detail = useStore((s) => s.detail);
  const sciOn = scienceLayers(area).filter((l) => sci[l.id]?.on && sciData[l.id]);
  const conf = confOn && hover ? (sampleBest(area, detail, hover.lonLat)?.confidence ?? undefined) : undefined;
  return (
    <Panel
      className={cn(
        "readout pointer-events-none max-w-full min-w-0 px-3 py-2 text-sm",
        !hover && "text-[11.5px] text-muted-foreground",
        // No hover on touch screens: drop the "hover the map" prompt, keep the values of the last tap.
        !hover && !picking && "[@media(hover:none)]:hidden",
      )}
    >
      {picking && <div className="mb-[3px] font-medium text-foreground">Click the map to place the start</div>}
      {hover ? (
        <>
          <div className={row}>
            <span title="Elevation">{fmtNum(hover.elevationM, 0, " m")}</span>
            <span title="Slope">
              {fmtNum(hover.slopeDeg, 1, "°")} <small className={unit}>slope</small>
            </span>
            <span title="Surface (mapped class)">
              {surf ? (
                <>
                  <Swatch color={surf.color} />
                  {surf.name}
                </>
              ) : (
                "—"
              )}
            </span>
            {start && (
              <span title="Straight-line distance from the start">
                {fmtDist(marsDistanceM(start.lonLat, hover.lonLat))} <small className={unit}>from start</small>
              </span>
            )}
          </div>
          {(sciOn.length > 0 || conf != null) && (
            <div className={cn(row, "flex-wrap")}>
              {sciOn.map((l) => {
                const gd = sciData[l.id]!;
                const cell = hover ? cellIndex(gd.grid, hover.lonLat) : null;
                const v = cell != null ? gd.data[cell] : undefined;
                return (
                  <span key={l.id}>
                    <Swatch color={scienceRamp(area, l.id)[1]![1]} />
                    <b className={tag}>{(l.name ?? l.id).replace(/\s*\(.*$/, "")}</b> {v != null && Number.isFinite(v) ? (v > 0 ? v.toFixed(4) : "none") : "—"}
                  </span>
                );
              })}
              {conf != null && (
                <span>
                  <b className={tag}>Surface confidence</b> {conf}/200
                </span>
              )}
            </div>
          )}
          <div className="mt-0.5 font-mono text-2xs text-muted-foreground">{fmtLonLat(hover.lonLat)}</div>
        </>
      ) : (
        <div>Hover the map for slope and surface</div>
      )}
    </Panel>
  );
}
