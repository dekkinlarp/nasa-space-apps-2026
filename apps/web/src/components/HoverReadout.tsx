import { useStore } from "../store";
import { fmtDist, fmtNum } from "../format";
import { sampleBest, surfaceById } from "../lib";
import { cellIndex, marsDistanceM } from "../geo";
import { scienceLayers, scienceRamp } from "../map/MapView";
import { Panel } from "@/components/ui/panel";
import { Swatch } from "@/components/ui/swatch";
import { FluidWidth } from "@/components/ui/fluid-width";

const value = "font-medium text-foreground";

/** The hairline between two pieces of information in the status bar. */
export function StatusRule() {
  return <span className="h-3.5 w-px flex-none bg-seam-strong" aria-hidden />;
}
/** One reading with the rule that separates it from what comes before, so the two hide together. */
const item = "flex flex-none items-center gap-2.5";

/**
 * What is under the pointer: elevation, slope, surface, distance from the start, and the value of any science
 * layer that is on. It is one group in the status bar, after the position, so the map keeps its top-left corner.
 * Each reading brings the rule that separates it from the one before.
 * Figures are tabular and each has a fixed width, so the group does not shift as the pointer moves. The surface
 * name is as wide as its text, and eases between widths (FluidWidth) so what follows it slides instead of jumping.
 */
export function PointerReadings() {
  const hover = useStore((s) => s.hover);
  const area = useStore((s) => s.area)!;
  const start = useStore((s) => s.start);
  const sci = useStore((s) => s.sci);
  const sciData = useStore((s) => s.sciData);
  const confOn = useStore((s) => s.overlays.confidence.on);
  const detail = useStore((s) => s.detail);
  if (!hover) return null;
  const surf = surfaceById(area.config.surfaceClasses, hover.surfaceId);
  const sciOn = scienceLayers(area).filter((l) => sci[l.id]?.on && sciData[l.id]);
  const conf = confOn ? (sampleBest(area, detail, hover.lonLat)?.confidence ?? undefined) : undefined;
  return (
    <span className="flex flex-none items-center gap-2.5 whitespace-nowrap tabular-nums">
      <span className={item} title="Elevation under the pointer">
        <StatusRule />
        <span className={`${value} min-w-[46px] text-right`}>{fmtNum(hover.elevationM, 0, " m").replace("-", "−")}</span>
      </span>
      <span className={item} title="Slope under the pointer">
        <StatusRule />
        <span className="min-w-[58px]">
          <span className={value}>{fmtNum(hover.slopeDeg, 1, "°")}</span> slope
        </span>
      </span>
      {surf && (
        <span className={item} title="Surface (mapped class)">
          <StatusRule />
          <FluidWidth className={value}>
            <Swatch color={surf.color} className="transition-[background] duration-200" />
            {surf.name}
          </FluidWidth>
        </span>
      )}
      {sciOn.map((l) => {
        const gd = sciData[l.id]!;
        const cell = cellIndex(gd.grid, hover.lonLat);
        const v = cell != null ? gd.data[cell] : undefined;
        return (
          <span key={l.id} className={`${item} compact:hidden`}>
            <StatusRule />
            <span className="flex items-center">
              <Swatch color={scienceRamp(area, l.id)[1]![1]} />
              {(l.name ?? l.id).replace(/\s*\(.*$/, "")}&nbsp;<span className={`${value} min-w-[6ch]`}>{v != null && Number.isFinite(v) ? (v > 0 ? v.toFixed(4) : "none") : "—"}</span>
            </span>
          </span>
        );
      })}
      {conf != null && (
        <span className={`${item} compact:hidden`}>
          <StatusRule />
          <span>
            Surface confidence <span className={`${value} inline-block min-w-[7ch]`}>{conf}/200</span>
          </span>
        </span>
      )}
      {start && (
        <span className={`${item} compact:hidden`} title="Straight-line distance from the start">
          <StatusRule />
          <span>
            <span className={`${value} inline-block min-w-[7ch] text-right`}>{fmtDist(marsDistanceM(start.lonLat, hover.lonLat))}</span> from start
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * The prompt shown at the top left of the map while the planner is placing the start. The readings that used to
 * sit here are in the status bar (PointerReadings).
 */
export function HoverReadout() {
  const picking = useStore((s) => s.pickingStart);
  if (!picking) return null;
  return (
    <Panel className="readout pointer-events-none flex min-h-9 min-w-0 items-center px-3.5 py-2 text-sm font-medium whitespace-nowrap coarse:min-h-11" role="status">
      Click the map to place the start
    </Panel>
  );
}
