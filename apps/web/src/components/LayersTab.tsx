import type { ComponentProps, ReactNode } from "react";
import { useStore, type OverlayId } from "../store";
import type { LayerEntry } from "@marsmap/core";
import { scienceLayers, scienceRamp } from "../map/MapView";
import { pictureGroup, tintable } from "../map/imageryTiles";
import { CONFIDENCE_CLEAR, CONFIDENCE_LOW, COST_RAMP, cssGradient, ELEV_RAMP, SLOPE_STOPS } from "../map/rasters";
import type { AreaData } from "../types";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionHeading } from "@/components/ui/section-heading";
import { Slider } from "@/components/ui/slider";
import { Swatch } from "@/components/ui/swatch";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** One layer: switch, name, tags, and an opacity slider. Its key and notes show below while it is on. */
function LayerRow({
  title,
  note,
  on,
  onOnChange,
  opacity,
  onOpacityChange,
  disabled,
  children,
}: {
  title: string;
  note?: ReactNode;
  on: boolean;
  onOnChange: (on: boolean) => void;
  opacity?: number;
  onOpacityChange?: (v: number) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="border-b py-2.5 coarse:py-3">
      <div className="flex items-center gap-2">
        <Switch checked={on && !disabled} disabled={disabled} onCheckedChange={onOnChange} aria-label={title} />
        <span className={cn("font-medium", disabled && "text-muted-foreground")}>{title}</span>
        {note}
        {opacity != null && onOpacityChange && (
          <Slider
            aria-label={`${title} opacity`}
            title="Opacity"
            className="ml-auto w-[72px] flex-none"
            min={0}
            max={1}
            step={0.05}
            value={[opacity]}
            disabled={!on || disabled}
            onValueChange={(v) => onOpacityChange(Array.isArray(v) ? v[0]! : v)}
          />
        )}
      </div>
      {children}
    </div>
  );
}

/** A note under a layer. */
function Hint({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />;
}

function LegendBar({ background }: { background: string }) {
  return <div className="mt-2 h-1.5 rounded-[1px]" style={{ background }} />;
}

function LegendTicks({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-[3px] flex justify-between text-2xs text-muted-foreground", className)}>{children}</div>;
}

function Row({ id, title, children, disabled, note }: { id: OverlayId; title: string; children?: ReactNode; disabled?: string; note?: ReactNode }) {
  const st = useStore((s) => s.overlays[id]);
  const setOverlay = useStore((s) => s.setOverlay);
  return (
    <LayerRow
      title={title}
      note={note}
      on={st.on}
      onOnChange={(on) => setOverlay(id, { on })}
      opacity={st.opacity}
      onOpacityChange={(opacity) => setOverlay(id, { opacity })}
      disabled={!!disabled}
    >
      {disabled ? <Hint>{disabled}</Hint> : st.on && children}
    </LayerRow>
  );
}

/** "THEMIS night-time IR (thermal inertia proxy, ~100 m)" → "THEMIS night-time IR"; the full name stays in the tooltip. */
const shortName = (name: string) => name.replace(/\s*\(?tile.*$/i, "").replace(/\s*\([^)]*\)\s*$/, "") || name;
/** Instrument credit from a source string, e.g. "… (MRO HiRISE, NASA/JPL/UArizona), z16" → "MRO HiRISE". */
const credit = (src: string) => /\(([^,)]+)/.exec(src)?.[1]?.trim() ?? src;
const fmtRes = (v: number) => (v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
/** One science layer from the manifest: switch, opacity, legend, what it means and where it comes from. */
function ScienceRow({ area, layer }: { area: AreaData; layer: LayerEntry }) {
  const st = useStore((s) => s.sci[layer.id]) ?? { on: false, opacity: 0.75 };
  const setSci = useStore((s) => s.setSci);
  const loaded = useStore((s) => !!s.sciData[layer.id]);
  const info = area.minerals?.layers.find((l) => l.id === layer.id);
  const max = layer.display?.max ?? 1;
  return (
    <LayerRow
      title={layer.name ?? layer.id}
      note={layer.estimated && <Badge variant="estimate">estimated</Badge>}
      on={st.on}
      onOnChange={(on) => setSci(layer.id, { on })}
      opacity={st.opacity}
      onOpacityChange={(opacity) => setSci(layer.id, { opacity })}
    >
      {st.on && (
        <>
          <LegendBar background={cssGradient(scienceRamp(area, layer.id))} />
          <LegendTicks>
            <span>just above 0</span>
            <span>{loaded ? "" : "loading…"}</span>
            <span>{max}+ (strongest 2%)</span>
          </LegendTicks>
          {info && (
            <div className="mt-1 text-sm">
              {info.indicates} <span className="text-muted-foreground">{info.caveat}</span>
            </div>
          )}
          {info?.stats && <Hint>Present (above 0) over {info.stats.positivePct}% of this area. Ground with no signal is left clear.</Hint>}
        </>
      )}
    </LayerRow>
  );
}

function DataChecks({ area }: { area: AreaData }) {
  const c = area.checks;
  const m = area.minerals;
  const scenes = m ? (m.scenes ?? [{ obs: m.observation, acquired: m.acquired, coregistration: m.coregistration }]) : [];
  const share = m?.layers[0]?.stats?.scenePct;
  if (!c?.georef && !c?.slopeVsTilt && !scenes.length) return null;
  return (
    <>
      <SectionHeading>Checks against the rover</SectionHeading>
      <ul className="grid list-disc gap-1.5 pl-4 text-sm text-muted-foreground *:[b]:font-medium *:[b]:text-foreground">
        {c?.georef && (
          <li>
            <b>Elevation.</b> At {c.georef.waypoints} Curiosity waypoints the map's elevation differs from the rover's own by a median of {c.georef.medianAbsDiffM.toFixed(2)} m (largest{" "}
            {c.georef.maxAbsDiffM.toFixed(2)} m). This confirms the map is in the right place; it does not prove the elevation data itself is that accurate.
          </li>
        )}
        {c?.slopeVsTilt && (
          <li>
            <b>Slope.</b> At {c.slopeVsTilt.waypoints} waypoints the map's median slope is {c.slopeVsTilt.medianSlopeDeg.toFixed(1)}° and the rover's median recorded tilt is{" "}
            {c.slopeVsTilt.medianTiltDeg.toFixed(1)}°; spot by spot they differ by a median of {c.slopeVsTilt.medianAbsDiffDeg.toFixed(1)}°.
          </li>
        )}
        {scenes.map(({ obs, coregistration: co }) =>
          co.corrBest == null ? null : (
            <li key={obs}>
              <b>Minerals, scene {obs}</b>
              {share?.[obs] != null ? ` (${share[obs]}% of the area)` : ""}.{" "}
              {co.applied
                ? `As delivered it sat ${Math.round(Math.hypot(co.shiftM[0], co.shiftM[1]))} m off the photo. Shifting it ${Math.abs(co.shiftPx[0])} px ${co.shiftPx[0] > 0 ? "west" : "east"} and ${Math.abs(co.shiftPx[1])} px ${co.shiftPx[1] > 0 ? "north" : "south"} raised its match with the HiRISE photo from r = ${co.corrUnshifted} to r = ${co.corrBest}.`
                : `It matches the HiRISE photo at r = ${co.corrUnshifted} without any shift (best nearby shift: r = ${co.corrBest}).`}
            </li>
          ),
        )}
        {scenes.length > 0 && (
          <li>
            Each scene is moved as a whole, so expect mineral pixels to be within one to two pixels ({m?.pixelM}–{(m?.pixelM ?? 0) * 2} m) of their true place.
            {scenes.length > 1 ? " Where two scenes meet there is a seam: they were taken in different years, so compare values across it with care." : ""}
          </li>
        )}
        {c?.problems && c.problems.length > 0 && <li className="text-bad">Pipeline problems: {c.problems.join("; ")}</li>}
      </ul>
    </>
  );
}

function Source({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="mt-1 cursor-help truncate text-xs text-muted-foreground" title={text}>
      {text}
    </div>
  );
}

export function LayersTab() {
  const area = useStore((s) => s.area)!;
  const base = useStore((s) => s.baseImagery);
  const baseOpacity = useStore((s) => s.baseOpacity);
  const marsTint = useStore((s) => s.marsTint);
  const set = useStore((s) => s.set);
  const reach = useStore((s) => s.reach);
  const start = useStore((s) => s.start);
  const m = area.manifest;
  const layer = (id: string) => m.layers.find((l) => l.id === id);
  const groups = new Map<string, (typeof m.imagery)[number][]>();
  for (const im of m.imagery) {
    const g = pictureGroup(im);
    groups.set(g, [...(groups.get(g) ?? []), im]);
  }
  const est = (id: string) => (layer(id)?.estimated ? <Badge variant="estimate">estimated</Badge> : null);
  const L = area.overview;
  const canTint = !!base && tintable(base);
  return (
    <>
      <SectionHeading>Base imagery</SectionHeading>
      <RadioGroup value={base ?? NONE} onValueChange={(v) => set({ baseImagery: v === NONE ? null : (v as string) })} className="gap-0">
        {[...groups.entries()].map(([g, ims]) => {
          const im = ims[0]!;
          return (
            <BaseOption
              key={g}
              value={g}
              active={base === g}
              title={`${im.name}\n${im.source}`}
              name={shortName(im.name)}
              meta={[credit(im.source), im.metersPerPixel ? `${fmtRes(im.metersPerPixel)} m/px` : "", ims.length > 1 ? `${ims.length} tiles` : ""].filter(Boolean).join(" · ")}
            />
          );
        })}
        <BaseOption value={NONE} active={base === null} name="None" />
      </RadioGroup>
      <div className="mt-2.5 flex items-center gap-2.5">
        <span className="text-sm whitespace-nowrap text-muted-foreground">Imagery opacity</span>
        <Slider aria-label="Imagery opacity" min={0} max={1} step={0.05} value={[baseOpacity]} onValueChange={(v) => set({ baseOpacity: Array.isArray(v) ? v[0]! : v })} />
      </div>
      <LayerRow title="Mars colour tint" note={<Badge variant="estimate">cosmetic</Badge>} on={marsTint} onOnChange={(on) => set({ marsTint: on })} disabled={!canTint}>
        <Hint>
          {base && !tintable(base)
            ? "Thermal imagery shows temperature, so it is left as captured."
            : "This imagery is one band of brightness, with no colour in it. The tint only makes it read as Mars; switch it off to see the image as captured."}
        </Hint>
      </LayerRow>

      {scienceLayers(area).length > 0 && (
        <>
          <SectionHeading>
            Minerals from orbit <Badge variant="sim">science</Badge>
          </SectionHeading>
          {scienceLayers(area).map((l) => (
            <ScienceRow key={l.id} area={area} layer={l} />
          ))}
          {area.minerals && (
            <div className="mt-1 text-xs wrap-anywhere text-muted-foreground">
              {area.minerals.mission}, observation {area.minerals.observation}, {area.minerals.acquired}, {area.minerals.pixelM} m per pixel. {area.minerals.note}
            </div>
          )}
        </>
      )}

      <SectionHeading>Overlays</SectionHeading>
      <Row id="surface" title="Surface conditions" note={est("surface")} disabled={L.surface ? undefined : "No surface layer in this dataset"}>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-2">
          {area.config.surfaceClasses.map((c) => (
            <span key={c.id}>
              <Swatch color={c.color} />
              {c.name}
              {c.hazard && <span className="ml-1.5 text-2xs text-warn">hazard</span>}
            </span>
          ))}
        </div>
        <Source text={layer("surface") && `${layer("surface")!.source} · ${layer("surface")!.method}`} />
      </Row>
      <Row id="confidence" title="Surface uncertainty" note={est("surface_confidence")} disabled={L.confidence ? undefined : "No confidence layer in this dataset"}>
        <LegendBar background="linear-gradient(90deg, rgba(232,62,140,.9), rgba(232,62,140,0))" />
        <LegendTicks>
          <span>least sure ({CONFIDENCE_LOW} or less)</span>
          <span>clear = {CONFIDENCE_CLEAR}+ of 200</span>
        </LegendTicks>
        <Hint>Pink marks ground where the surface estimate is a close call between two classes. Treat routes across it as less certain.</Hint>
        <Source text={layer("surface_confidence")?.method} />
      </Row>
      <Row id="slope" title="Slope" note={est("slope")} disabled={L.slope ? undefined : "No slope layer"}>
        <LegendBar background={cssGradient(SLOPE_STOPS)} />
        <LegendTicks>
          <span>0°</span>
          <span>10°</span>
          <span>15°</span>
          <span>25°</span>
          <span>35°+</span>
        </LegendTicks>
        <Source text={layer("slope") && `${layer("slope")!.source} · ${layer("slope")!.method}`} />
      </Row>
      <Row id="elevation" title="Elevation" note={est("elevation")} disabled={L.elevation ? undefined : "No elevation layer"}>
        <LegendBar background={cssGradient(ELEV_RAMP)} />
        <LegendTicks>
          <span>{Math.round(L.elevMin)} m</span>
          <span>{Math.round(L.elevMax)} m</span>
        </LegendTicks>
        <Source text={layer("elevation")?.source} />
      </Row>
      <Row id="hillshade" title="Hillshade (from DEM)" disabled={L.elevation ? undefined : "No elevation layer"}>
        <Hint>Opacity slider sets shading strength.</Hint>
      </Row>
      <Row id="cost" title="Walk cost from start" disabled={!start ? "Set a start to see walk cost" : undefined} note={<Badge variant="sim">model</Badge>}>
        {reach ? (
          <>
            <LegendBar background={cssGradient(COST_RAMP)} />
            <LegendTicks className="relative block h-3.5">
              {COST_RAMP.map(([t]) => (
                <span key={t} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: `${t * 100}%` }}>
                  {Math.round(t * 100)}%
                </span>
              ))}
            </LegendTicks>
            <Hint>Round trip as % of usable EVA time · dark = beyond budget</Hint>
          </>
        ) : (
          <Hint>Calculating…</Hint>
        )}
      </Row>
      <Row id="rings" title="Walk-limit rings" disabled={!start ? "Set a start to see walk-limit rings" : undefined}>
        <Hint title="Dashed rings: 15 min, 30 min and 1 h of round-trip walking from the start. Solid ring: the walk limit, the farthest you can go, work one stop and still get home with the reserve intact on time, energy and oxygen. Its label names the one that runs out first.">
          Round trip: 15 min · 30 min · 1h · walk limit
        </Hint>
      </Row>
      <Row id="track" title="Curiosity traverse + waypoints" disabled={area.rover.traverse ? undefined : "No rover traverse in this dataset"}>
        <div className="mt-1 text-xs text-muted-foreground">NASA/JPL-Caltech MSL localized traverse</div>
      </Row>
      <Row id="pois" title="Points of interest" />

      <DataChecks area={area} />

      <SectionHeading>Data</SectionHeading>
      <div
        className="cursor-help text-sm text-muted-foreground"
        title={`Manifest generated ${new Date(m.generatedAt).toLocaleString()}.\nMap uses Mars lon/lat on a Web Mercator canvas (≈0.35% scale distortion at 4.8°S). All distances and times come from the routing core.`}
      >
        Area <span className="font-mono">{area.areaId}</span> · generated {new Date(m.generatedAt).toLocaleDateString()} <span className="opacity-70">ⓘ</span>
      </div>
    </>
  );
}

const NONE = "__none";

/** One base-imagery choice: a radio with its name and source. */
function BaseOption({ value, active, title, name, meta }: { value: string; active: boolean; title?: string; name: string; meta?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 border-b py-2 coarse:py-3" title={title}>
      <RadioGroupItem value={value} className="mt-[3px]" />
      <div className="min-w-0">
        <div className={cn("font-medium", !active && "text-ink-2")}>{name}</div>
        {meta && <div className="mt-px truncate text-xs text-muted-foreground">{meta}</div>}
      </div>
    </label>
  );
}
