import { useEffect, useId, useMemo, useRef, useState, type DependencyList, type ReactNode } from "react";
import { BanIcon, CheckIcon } from "lucide-react";
import { useStore, type OverlayId } from "../store";
import { useUrls } from "./usePreviewUrls";
import { loadFloatLayer } from "../data";
import type { LayerEntry, LonLat } from "@marsmap/core";
import { scienceLayers, scienceRamp } from "../map/MapView";
import { pictureGroup, tintable } from "../map/imageryTiles";
import { CONTOUR_FINE_M, CONTOUR_INDEX_M, CONTOUR_MID_M } from "../map/contours";
import { basePreview, costPreview, covers, MINERAL_PREVIEW_M, PREVIEW_M, previewFrame, sciencePreview, terrainPreviews, tintPreview, type Frame } from "../map/layerPreviews";
import { CONFIDENCE_CLEAR, CONFIDENCE_LOW, COST_RAMP, cssGradient, ELEV_RAMP, SLOPE_STOPS } from "../map/rasters";
import type { AreaData } from "../types";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { SectionHeading } from "@/components/ui/section-heading";
import { Slider } from "@/components/ui/slider";
import { Swatch } from "@/components/ui/swatch";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ---------- previews ----------

/** Key suffix marking a mineral preview that shows ground away from the start. */
const ELSEWHERE = "@elsewhere";

/** What each layer draws over one square of ground: around the start, or the middle of the area before one is set. */
function usePreviews(area: AreaData, groups: string[]) {
  const start = useStore((s) => s.start);
  const base = useStore((s) => s.baseImagery);
  const marsTint = useStore((s) => s.marsTint);
  const reach = useStore((s) => s.reach);
  const sciData = useStore((s) => s.sciData);
  const g = area.overview.grid;
  const [lon, lat]: LonLat = start?.lonLat ?? [(g.west + g.east) / 2, (g.south + g.north) / 2];
  const detail = useStore((s) => s.detail);
    const frame: Frame = useMemo(() => previewFrame([lon, lat], PREVIEW_M), [lon, lat]);
  const mineralFrame: Frame = useMemo(() => previewFrame([lon, lat], MINERAL_PREVIEW_M), [lon, lat]);
  // Full-resolution ground where the planning window covers the frame, else the overview.
  const layers = detail && covers(detail.grid, frame) ? detail : area.overview;
  const tintGroup = base && tintable(base) ? base : groups.find(tintable);

  const bases = useUrls(
    async (signal) => Object.fromEntries(await Promise.all(groups.map(async (id) => [id, await basePreview(id, marsTint, frame, signal).catch(() => null)] as const))),
    [area, frame, marsTint],
  );
  const tint = useUrls((signal) => (tintGroup ? tintPreview(tintGroup, frame, signal).then((url) => ({ url })) : null), [area, frame, tintGroup]);
  // The mineral previews sit on their own, closer picture of the ground.
  const mineralGround = useUrls((signal) => (base ? basePreview(base, marsTint, mineralFrame, signal).then((url) => ({ url })) : null), [area, mineralFrame, base, marsTint]);
  const terrain = useUrls(() => terrainPreviews(layers, area.config.surfaceClasses, frame), [area, frame, layers]);
  const cost = useUrls(() => (reach ? costPreview(reach, frame).then((url) => ({ url })) : null), [reach, frame]);
  // The mineral layers load here, not only when switched on, so their previews are real from the start.
  useEffect(() => {
    let dead = false;
    for (const l of scienceLayers(area)) {
      if (useStore.getState().sciData[l.id]) continue;
      void loadFloatLayer(area, l.id).then((gd) => {
        const st = useStore.getState();
        if (!dead && gd && st.area === area && !st.sciData[l.id]) st.set({ sciData: { ...st.sciData, [l.id]: gd } });
      });
    }
    return () => void (dead = true);
  }, [area]);
  const sci = useUrls(
    async () =>
      Object.fromEntries(
        (
          await Promise.all(
            scienceLayers(area).map(async (l) => {
              const gd = sciData[l.id];
              const p = gd ? await sciencePreview(gd, l.display?.min ?? 0, l.display?.max ?? 1, scienceRamp(area, l.id), mineralFrame) : null;
              // A picture taken away from the start is flagged, so it is not drawn over the start's ground.
              return [[l.id, p?.url], [`${l.id}${ELSEWHERE}`, p?.elsewhere ? "1" : null]] as const;
            }),
          )
        ).flat(),
      ),
    [area, mineralFrame, sciData],
  );
  return { bases, ground: base ? bases[base] : null, mineralGround: mineralGround.url, tint: tint.url, terrain, cost: cost.url, sci };
}

/** A layer's preview: the ground, with what the layer adds drawn over it. */
function Thumb({ ground, layer, opacity = 1, className, children }: { ground?: string | null; layer?: string | null; opacity?: number; className?: string; children?: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn("relative block size-8 flex-none overflow-hidden rounded-[7px] bg-well after:absolute after:inset-0 after:rounded-[inherit] after:inset-ring after:inset-ring-white/18", className)}
    >
      {ground && <img src={ground} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />}
      {layer && <img src={layer} alt="" draggable={false} className="absolute inset-0 size-full object-cover" style={{ opacity: Math.max(0.35, opacity) }} />}
      {children}
    </span>
  );
}

const GLYPH = "absolute inset-0 size-full";

/** Walk-limit rings as the map draws them: dotted ink time rings inside a solid limit in the warning colour. */
const RingsGlyph = () => (
  <svg viewBox="0 0 40 40" className={GLYPH} fill="none">
    <circle cx="20" cy="20" r="6" stroke="var(--ink)" strokeWidth="1.25" strokeDasharray="1.6 3" />
    <circle cx="20" cy="20" r="11.5" stroke="var(--ink)" strokeWidth="1.25" strokeDasharray="1.6 3" />
    <circle cx="20" cy="20" r="17" stroke="var(--warn)" strokeWidth="1.6" />
    <circle cx="20" cy="20" r="1.8" fill="#fff" />
  </svg>
);

/** Curiosity's route as the map draws it: a thin solid line in the rover colour with a dot at each waypoint. */
const TrackGlyph = () => {
  const d = "M5 31 L14 24 L19 27 L27 15 L35 9";
  return (
    <svg viewBox="0 0 40 40" className={GLYPH} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke="#000" strokeOpacity="0.5" strokeWidth="3.5" />
      <path d={d} stroke="var(--poi-rover)" strokeWidth="1.25" />
      {[[14, 24], [27, 15]].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="2.2" fill="var(--poi-rover)" stroke="#000" strokeWidth="1.5" />
      ))}
    </svg>
  );
};

/** Pins in the place-type colours. */
const PoisGlyph = () => (
  <svg viewBox="0 0 40 40" className={GLYPH}>
    {[
      [12, 14, "var(--poi-drill-site)"],
      [27, 12, "var(--poi-science-target)"],
      [22, 28, "var(--poi-viewpoint)"],
    ].map(([x, y, c]) => (
      <g key={c}>
        <circle cx={x} cy={y} r="5" fill="#fff" fillOpacity="0.8" />
        <circle cx={x} cy={y} r="4" fill="var(--well)" />
        <circle cx={x} cy={y} r="2.8" fill={c as string} />
      </g>
    ))}
  </svg>
);

// ---------- rows ----------

/** A line of smaller text under a layer's controls. */
const NOTE = "text-sm text-ink-2";

/**
 * One layer: its preview, name and switch. The opacity slider and the key show only while it is on;
 * what the layer means and where it comes from are behind the info button.
 */
function LayerRow({
  title,
  thumb,
  badge,
  info,
  on,
  onOnChange,
  opacity,
  onOpacityChange,
  opacityLabel = "Opacity",
  disabled,
  children,
}: {
  title: string;
  thumb: ReactNode;
  badge?: ReactNode;
  info?: ReactNode;
  on: boolean;
  onOnChange: (on: boolean) => void;
  opacity?: number;
  onOpacityChange?: (v: number) => void;
  opacityLabel?: string;
  /** Why the layer cannot be switched on. */
  disabled?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const active = on && !disabled;
  const slider = opacity != null && onOpacityChange;
  return (
    <div className="border-b py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className={cn("flex min-w-0 flex-1 items-center gap-3", !disabled && "cursor-pointer")}>
          {thumb}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="font-medium">{title}</span>
              {badge}
            </span>
            {disabled && <span className={cn("block", NOTE)}>{disabled}</span>}
          </span>
        </label>
        {info && (
          <InfoTip label={`About ${title.toLowerCase()}`} className="text-ink-2">
            {info}
          </InfoTip>
        )}
        <Switch id={id} checked={active} disabled={!!disabled} onCheckedChange={onOnChange} aria-label={title} />
      </div>
      {active && (slider || children) && (
        <div className="mt-2.5 grid gap-2.5 pb-0.5 pl-11">
          {slider && (
            <div className={cn("flex items-center gap-2.5", NOTE)}>
              <span id={`${id}-o`}>{opacityLabel}</span>
              <Slider
                aria-labelledby={`${id}-o`}
                aria-label={`${title}: ${opacityLabel.toLowerCase()}`}
                className="flex-1"
                min={0}
                max={1}
                step={0.05}
                value={[opacity]}
                onValueChange={(v) => onOpacityChange(Array.isArray(v) ? v[0]! : v)}
              />
              <span className="w-9 text-right">{Math.round(opacity * 100)}%</span>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Info notes are written here in plain words. The manifest's `method` and `source` strings are the
 * pipeline's full record (formulas, file URLs, scene lists) and are too long to read in a popover.
 */
/** A manifest source without its URLs: "USGS … DEM 1m v3 (file.tif), https://… (label: https://…)" → "USGS … DEM 1m v3 (file.tif)". */
const briefSource = (src: string) => src.replace(/\s*\(?(?:label:\s*)?https?:\/\/[^\s)]+\)?/g, "").replace(/[\s,;]+$/, "");
/** Who took a base picture: "NASA Mars Trek WMTS x (MRO HiRISE, NASA/JPL/UArizona), z16" → "MRO HiRISE, NASA/JPL/UArizona, via NASA Mars Trek". */
const imageryCredit = (src: string) => {
  const by = /\(([^)]+)\)/.exec(src)?.[1];
  return by ? `${by}${src.startsWith("NASA Mars Trek") ? ", via NASA Mars Trek" : ""}` : src;
};

/** A colour ramp with the values at its ends (or along it). */
function Legend({ background, ticks, caption }: { background: string; ticks: ReactNode; caption?: ReactNode }) {
  return (
    <div>
      <div className="h-2 rounded-full inset-ring inset-ring-white/12" style={{ background }} />
      <div className="mt-1 flex justify-between text-xs text-ink-2">{ticks}</div>
      {caption && <div className="mt-0.5 text-xs text-ink-2">{caption}</div>}
    </div>
  );
}

/** Where a layer's data comes from, as the last paragraph of its info note. */
const Source = ({ children }: { children: ReactNode }) => (children ? <p className="text-xs wrap-anywhere">Source: {children}</p> : null);

function Row({ id, children, disabled, ...props }: { id: OverlayId; title: string; thumb: ReactNode; badge?: ReactNode; info?: ReactNode; opacityLabel?: string; disabled?: string; children?: ReactNode }) {
  const st = useStore((s) => s.overlays[id]);
  const setOverlay = useStore((s) => s.setOverlay);
  return (
    <LayerRow {...props} on={st.on} onOnChange={(on) => setOverlay(id, { on })} opacity={st.opacity} onOpacityChange={(opacity) => setOverlay(id, { opacity })} disabled={disabled}>
      {children}
    </LayerRow>
  );
}

/** "THEMIS night-time IR (thermal inertia proxy, ~100 m)" → "THEMIS night-time IR"; the full name is in the section's info note. */
const shortName = (name: string) => name.replace(/\s*\(?tile.*$/i, "").replace(/\s*\([^)]*\)\s*$/, "") || name;
const fmtRes = (v: number) => (v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(1) : v.toFixed(2));

/** One science layer from the manifest. */
function ScienceRow({ area, layer, ground, preview }: { area: AreaData; layer: LayerEntry; ground?: string | null; preview?: string | null }) {
  const st = useStore((s) => s.sci[layer.id]) ?? { on: false, opacity: 0.75 };
  const setSci = useStore((s) => s.setSci);
  const loaded = useStore((s) => !!s.sciData[layer.id]);
  const info = area.minerals?.layers.find((l) => l.id === layer.id);
  const max = layer.display?.max ?? 1;
  const ramp = cssGradient(scienceRamp(area, layer.id));
  return (
    <LayerRow
      title={layer.name ?? layer.id}
      // Until the layer's data has loaded the preview is its colour ramp.
      thumb={preview ? <Thumb ground={ground} layer={preview} opacity={st.opacity} /> : <Thumb><span className="absolute inset-0" style={{ background: ramp.replace("90deg", "135deg") }} /></Thumb>}
      badge={layer.estimated && <Badge variant="estimate">estimated</Badge>}
      info={
        info && (
          <>
            <p>{info.indicates}</p>
            <p>{info.caveat}</p>
            {info.stats && <p>Present over {info.stats.positivePct}% of this area. Ground with no signal is left clear.</p>}
          </>
        )
      }
      on={st.on}
      onOnChange={(on) => setSci(layer.id, { on })}
      opacity={st.opacity}
      onOpacityChange={(opacity) => setSci(layer.id, { opacity })}
    >
      <Legend
        background={ramp}
        ticks={
          <>
            <span>Weak</span>
            <span>{loaded ? "" : "Loading…"}</span>
            <span>Strong ({max}+)</span>
          </>
        }
      />
    </LayerRow>
  );
}

const NONE = "__none";

/** One base-imagery choice: a picture of the ground in that imagery, with its name and resolution. */
function BaseCard({ value, name, meta, img }: { value: string; name: string; meta?: string; img?: string | null }) {
  return (
    <RadioCard value={value} className="flex flex-col gap-1.5">
      <span className="relative block aspect-square overflow-hidden rounded-lg bg-well outline-2 outline-offset-1 outline-transparent transition-[outline-color] duration-150 after:absolute after:inset-0 after:rounded-[inherit] after:inset-ring after:inset-ring-white/18 group-data-checked/radio-card:outline-foreground">
        {img ? <img src={img} alt="" draggable={false} className="absolute inset-0 size-full object-cover" /> : value === NONE && <BanIcon aria-hidden className="absolute inset-0 m-auto size-5 text-ink-2" />}
        <span className="absolute right-1 bottom-1 grid size-4 scale-50 place-items-center rounded-full bg-foreground text-well opacity-0 transition-[opacity,scale] duration-150 group-data-checked/radio-card:scale-100 group-data-checked/radio-card:opacity-100">
          <CheckIcon aria-hidden className="size-3" strokeWidth={3} />
        </span>
      </span>
      <span className="block px-0.5">
        <span className="block text-sm leading-tight font-medium text-ink-2 group-data-checked/radio-card:text-foreground">{name}</span>
        {meta && <span className="mt-0.5 block text-xs text-ink-2">{meta}</span>}
      </span>
    </RadioCard>
  );
}

export function LayersTab() {
  const area = useStore((s) => s.area)!;
  const base = useStore((s) => s.baseImagery);
  const baseOpacity = useStore((s) => s.baseOpacity);
  const marsTint = useStore((s) => s.marsTint);
  const overlays = useStore((s) => s.overlays);
  const set = useStore((s) => s.set);
  const reach = useStore((s) => s.reach);
  const start = useStore((s) => s.start);
  const m = area.manifest;
  const layer = (id: string) => m.layers.find((l) => l.id === id);
  const groups = useMemo(() => {
    const by = new Map<string, (typeof m.imagery)[number][]>();
    for (const im of m.imagery) by.set(pictureGroup(im), [...(by.get(pictureGroup(im)) ?? []), im]);
    return by;
  }, [m]);
  const groupIds = useMemo(() => [...groups.keys()], [groups]);
  const pv = usePreviews(area, groupIds);
  const est = (id: string) => (layer(id)?.estimated ? <Badge variant="estimate">estimated</Badge> : null);
  const L = area.overview;
  const canTint = !!base && tintable(base);
  const sci = scienceLayers(area);
  const sceneCount = area.minerals?.scenes?.length ?? 1;
  const years = (area.minerals?.acquired.match(/\d{4}/g) ?? []).map(Number);
  const sceneYears = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} to ${Math.max(...years)}`) : "";
  const baseId = useId();
  /** The preview of a terrain overlay: the ground with the layer over it at its current opacity. */
  const thumb = (id: OverlayId, layerUrl?: string | null, glyph?: ReactNode) => (
    <Thumb ground={pv.ground} layer={layerUrl} opacity={overlays[id].opacity}>
      {glyph}
    </Thumb>
  );
  return (
    <>
      <SectionHeading className="text-ink-2">
        Base imagery
        <InfoTip label="About the base imagery" className="-my-1 text-ink-2">
          {[...groups.values()].map(([im]) => (
            <p key={im!.id}>
              <b className="font-medium text-foreground">{shortName(im!.name)}.</b> {imageryCredit(im!.source)}.
            </p>
          ))}
          <p>
            The previews on this tab show {PREVIEW_M / 1000} km of ground around {start ? "the start" : "the middle of the area"}; the mineral previews show {MINERAL_PREVIEW_M / 1000} km.
          </p>
        </InfoTip>
      </SectionHeading>
      <RadioGroup aria-label="Base imagery" value={base ?? NONE} onValueChange={(v) => set({ baseImagery: v === NONE ? null : (v as string) })} className="grid-cols-4 gap-x-2 gap-y-3">
        {[...groups.entries()].map(([g, ims]) => (
          <BaseCard key={g} value={g} name={shortName(ims[0]!.name)} meta={ims[0]!.metersPerPixel ? `${fmtRes(Math.min(...ims.map((im) => im.metersPerPixel ?? Infinity)))} m/px` : undefined} img={pv.bases[g]} />
        ))}
        <BaseCard value={NONE} name="None" />
      </RadioGroup>
      <div className={cn("mt-4 flex items-center gap-2.5 border-b pb-3", NOTE)}>
        <span id={baseId}>Opacity</span>
        <Slider aria-labelledby={baseId} className="flex-1" min={0} max={1} step={0.05} value={[baseOpacity]} disabled={!base} onValueChange={(v) => set({ baseOpacity: Array.isArray(v) ? v[0]! : v })} />
        <span className="w-9 text-right">{Math.round(baseOpacity * 100)}%</span>
      </div>
      <LayerRow
        title="Mars colour tint"
        thumb={<Thumb ground={pv.tint} />}
        info={<p>This imagery is one band of brightness, with no colour in it. The tint only makes it read as Mars; switch it off to see the image as captured.</p>}
        on={marsTint}
        onOnChange={(on) => set({ marsTint: on })}
        disabled={canTint ? undefined : base ? "Thermal imagery is shown as captured" : "No imagery to tint"}
      />

      {sci.length > 0 && (
        <>
          <SectionHeading className="text-ink-2">
            Minerals from orbit
            {area.minerals && (
              <InfoTip label="About the mineral layers" className="-my-1 text-ink-2">
                <p>
                  {area.minerals.mission}: {sceneCount === 1 ? "one scene" : `${sceneCount} scenes`} from {sceneYears}, {area.minerals.pixelM} m per pixel.
                </p>
                <p>These show where a mineral's signature is, not how much of it there is. Dust or sand cover weakens them.</p>
                {sceneCount > 1 && <p>Scenes were taken at different times, so compare values across a seam with care.</p>}
              </InfoTip>
            )}
          </SectionHeading>
          {sci.map((l) => (
            <ScienceRow key={l.id} area={area} layer={l} ground={pv.sci[`${l.id}${ELSEWHERE}`] ? null : pv.mineralGround} preview={pv.sci[l.id]} />
          ))}
        </>
      )}

      <SectionHeading className="text-ink-2">Terrain</SectionHeading>
      <Row
        id="surface"
        title="Surface conditions"
        thumb={thumb("surface", pv.terrain.surface)}
        badge={est("surface")}
        info={
          layer("surface") && (
            <>
              <p>Our estimate of what kind of ground each spot is. Hazard classes slow a walk, and the safer routes avoid them.</p>
              {!area.synthetic && <p>Worked out from how rough the ground is, whether it sits high or low against its surroundings, and how bright and textured it looks in the HiRISE photo. Not checked against ground truth.</p>}
              <Source>{briefSource(layer("surface")!.source)}</Source>
            </>
          )
        }
        disabled={L.surface ? undefined : "Not in this dataset"}
      >
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-2">
          {area.config.surfaceClasses.map((c) => (
            <span key={c.id}>
              <Swatch color={c.color} />
              {c.name}
              {c.hazard && <span className="ml-1.5 text-xs text-warn">hazard</span>}
            </span>
          ))}
        </div>
      </Row>
      <Row
        id="confidence"
        title="Surface uncertainty"
        thumb={thumb("confidence", pv.terrain.confidence)}
        badge={est("surface_confidence")}
        info={
          <>
            <p>Pink marks ground where the surface estimate is a close call between two classes. Treat routes across it as less certain.</p>
            <p>
              The score is how clearly the best-fitting class beat the runner-up, out of 200. {CONFIDENCE_LOW} or less is drawn solid; {CONFIDENCE_CLEAR} or more is left clear.
            </p>
          </>
        }
        disabled={L.confidence ? undefined : "Not in this dataset"}
      >
        <Legend
          background="linear-gradient(90deg, rgba(232,62,140,.95), rgba(232,62,140,.08))"
          ticks={
            <>
              <span>Least sure</span>
              <span>Sure</span>
            </>
          }
        />
      </Row>
      <Row
        id="slope"
        title="Slope"
        thumb={thumb("slope", pv.terrain.slope)}
        badge={est("slope")}
        info={
          layer("slope") && (
            <>
              <p>How steep the ground is, in degrees, computed from the elevation data.</p>
              {area.tiles && <p>Zoomed out, each {L.grid.cellSizeM} m cell shows its average slope, so steep spots read gentler. The planning window shows full detail.</p>}
            </>
          )
        }
        disabled={L.slope ? undefined : "Not in this dataset"}
      >
        <Legend
          background={cssGradient(SLOPE_STOPS)}
          ticks={
            <>
              <span>0°</span>
              <span>10°</span>
              <span>15°</span>
              <span>25°</span>
              <span>35°+</span>
            </>
          }
        />
      </Row>
      <Row
        id="elevation"
        title="Elevation"
        thumb={thumb("elevation", pv.terrain.elevation)}
        badge={est("elevation")}
        info={
          layer("elevation") && (
            <>
              <p>Height of the ground, coloured from the lowest point of the area to the highest.</p>
              <Source>{briefSource(layer("elevation")!.source)}</Source>
            </>
          )
        }
        disabled={L.elevation ? undefined : "Not in this dataset"}
      >
        <Legend
          background={cssGradient(ELEV_RAMP)}
          ticks={
            <>
              <span>{Math.round(L.elevMin)} m</span>
              <span>{Math.round(L.elevMax)} m</span>
            </>
          }
        />
      </Row>
      <Row
        id="contours"
        title="Contour lines"
        thumb={thumb("contours", pv.terrain.contours)}
        info={
          <p>
            {area.tiles
              ? `A line every ${CONTOUR_MID_M} m of elevation, heavier every ${CONTOUR_INDEX_M} m. Zoom in on the planning window for ${CONTOUR_FINE_M} m lines.`
              : `A line every ${CONTOUR_FINE_M} m of elevation, heavier every ${CONTOUR_MID_M} m. Zoom in to see them all.`}
          </p>
        }
        disabled={L.elevation ? undefined : "Needs the elevation layer"}
      />
      <Row
        id="hillshade"
        title="Hillshade"
        thumb={thumb("hillshade", pv.terrain.hillshade)}
        opacityLabel="Strength"
        info={<p>Shading computed from the elevation data, lit from the north-west, so relief stands out.</p>}
        disabled={L.elevation ? undefined : "Needs the elevation layer"}
      />

      <SectionHeading className="text-ink-2">Walk model</SectionHeading>
      <Row
        id="cost"
        title="Walk cost from start"
        thumb={thumb(
          "cost",
          pv.cost,
          !pv.cost && <span className="absolute inset-0" style={{ background: `radial-gradient(circle, ${COST_RAMP.map(([t, c]) => `${c} ${t * 68}%`).join(", ")}, rgba(40,10,20,.7) 70%)`, opacity: 0.85 }} />,
        )}
        info={<p>The round trip to each point and back, as a share of the usable EVA time. Dark ground is beyond the budget.</p>}
        disabled={start ? undefined : "Set a start first"}
      >
        {reach ? (
          <Legend
            background={cssGradient(COST_RAMP)}
            ticks={
              <>
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </>
            }
            caption="Round trip, as a share of usable EVA time"
          />
        ) : (
          <div className={NOTE}>Calculating…</div>
        )}
      </Row>
      <Row
        id="rings"
        title="Walk-limit rings"
        thumb={thumb("rings", null, <RingsGlyph />)}
        info={
          <p>
            Dashed rings: 15 min, 30 min and 1 h of round-trip walking. Solid ring: the walk limit, the farthest you can go, work one stop and still get home with the reserve intact. Its label names what runs out
            first: time, energy or oxygen.
          </p>
        }
        disabled={start ? undefined : "Set a start first"}
      />

      <SectionHeading className="text-ink-2">Places</SectionHeading>
      <Row
        id="track"
        title="Curiosity's route"
        thumb={thumb("track", null, <TrackGlyph />)}
        info={
          <>
            <p>The rover's drive, with a dot at each waypoint. Select a waypoint to see what the rover recorded there.</p>
            <Source>NASA/JPL-Caltech MSL localized traverse</Source>
          </>
        }
        disabled={area.rover.traverse ? undefined : "Not in this dataset"}
      />
      <Row id="pois" title="Points of interest" thumb={thumb("pois", null, <PoisGlyph />)} />

      <div className={cn("mt-4 flex items-center gap-0.5", NOTE)}>
        <span>
          Area <span className="font-mono">{area.areaId}</span>, generated {new Date(m.generatedAt).toLocaleDateString()}
        </span>
        <InfoTip label="About this data" className="text-ink-2">{`Manifest generated ${new Date(m.generatedAt).toLocaleString()}.\nMap uses Mars lon/lat on a Web Mercator canvas (≈0.35% scale distortion at 4.8°S). All distances and times come from the routing core.`}</InfoTip>
      </div>
    </>
  );
}
