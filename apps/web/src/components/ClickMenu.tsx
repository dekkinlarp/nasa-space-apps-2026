import type { LonLat } from "@marsmap/core";
import { useStore } from "../store";
import { fmtLonLat, fmtNum } from "../format";
import { sampleAt, surfaceById } from "../lib";
import { inGrid } from "../geo";
import { Button } from "@/components/ui/button";
import { Swatch } from "@/components/ui/swatch";

export function ClickMenu({ lonLat }: { lonLat: LonLat }) {
  const area = useStore((s) => s.area)!;
  const set = useStore((s) => s.set);
  const setStart = useStore((s) => s.setStart);
  const addStop = useStore((s) => s.addStop);
  const stops = useStore((s) => s.stops);
  const smp = sampleAt(area.layers, lonLat);
  const surf = surfaceById(area.config.surfaceClasses, smp?.surfaceId);
  const inside = inGrid(area.layers.grid, lonLat);
  return (
    <div>
      {smp && (
        <div className="mt-1 mb-2 flex gap-x-3 pr-3.5 text-sm font-semibold whitespace-nowrap">
          <span title="Elevation">{fmtNum(smp.elevationM, 0, " m")}</span>
          <span title="Slope">
            {fmtNum(smp.slopeDeg, 1, "°")} <small className="font-normal text-muted-foreground">slope</small>
          </span>
          {surf && (
            <span title="Surface">
              <Swatch color={surf.color} />
              {surf.name}
            </span>
          )}
        </div>
      )}
      <div className="mt-px mb-2 font-mono text-2xs text-muted-foreground">{fmtLonLat(lonLat)}</div>
      {inside ? (
        <div className="flex gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1 "
            onClick={() => {
              setStart({ lonLat, name: "Custom start" });
              set({ mapClick: null, tab: "plan" });
            }}
          >
            Start here
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => {
              addStop({ lonLat, name: `Map point ${stops.length + 1}` });
              set({ mapClick: null, tab: "plan" });
            }}
          >
            Add stop
          </Button>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Outside the mapped area.</div>
      )}
    </div>
  );
}
