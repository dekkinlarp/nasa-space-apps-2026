import { useStore } from "../store";
import { fmtDist, fmtNum } from "../format";
import { sampleBest, surfaceById } from "../lib";
import { cellIndex, marsDistanceM } from "../geo";
import { scienceLayers, scienceRamp } from "../map/MapView";
import { Panel } from "@/components/ui/panel";
import { Swatch } from "@/components/ui/swatch";
import { Ticker } from "@/components/ui/ticker";
import { cn } from "@/lib/utils";

const row = "flex items-baseline gap-x-3.5 text-sm font-semibold whitespace-nowrap";
const unit = "text-xs font-normal text-muted-foreground";
const tag = "mr-1 text-xs font-normal text-muted-foreground";

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
  // Nothing to read until the pointer is over the map (or the user is placing the start).
  if (!hover && !picking) return null;
  const conf = confOn && hover ? (sampleBest(area, detail, hover.lonLat)?.confidence ?? undefined) : undefined;
  return (
    <Panel
      className={cn(
        // Top-left of the map. It gives way to the card beside it: a line that no longer fits slides (Ticker).
        // glass-host: the lines blur at their cut edges, so the glass is a layer behind them.
        "readout glass-host pointer-events-none flex min-h-9 max-w-full coarse:min-h-11 min-w-0 flex-col justify-center gap-1 px-3.5 py-2 text-sm",
        // On the bottom-sheet layout an open card or the Go panel takes this corner instead.
        "sheet:in-[.app:has(.go-panel)]:hidden sheet:in-[.app:has(.card-slot>*)]:hidden",
      )}
    >
      <i className="glass-layer" aria-hidden />
      {picking && <div className="font-medium whitespace-nowrap text-foreground">Click the map to place the start</div>}
      {hover ? (
        <>
          <Ticker>
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
          </Ticker>
          {(sciOn.length > 0 || conf != null) && (
            <Ticker>
            <div className={row}>
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
            </Ticker>
          )}
        </>
      ) : null}
    </Panel>
  );
}
