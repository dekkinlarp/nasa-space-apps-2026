import { Fragment, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CheckIcon, GripVerticalIcon, XIcon } from "lucide-react";
import type { RouteResult, RouteSegment, SurfaceClass } from "@marsmap/core";
import { selectedResult, usableTimeS, useStore } from "../store";
import { fmtDist, fmtDur, fmtEnergy, fmtLonLat, fmtO2 } from "../format";
import { limitMessage, pointNames } from "../lib";
import { profileColor } from "../map/MapView";
import { flyTo } from "./ExploreTab";
import { deltaParts, hazardChip, hazardHighlight, nearlyIdentical, routeDelta, type DeltaPart } from "./routeCompare";
import type { Poi, Stop } from "../types";
import { fmtMin, SafetyBudget } from "./SafetyBudget";
import { usePnr } from "../usePnr";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Disclosure } from "@/components/ui/disclosure";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { SectionHeading, SectionHeadingAside } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SliderField } from "@/components/ui/slider-field";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const TONE: Record<DeltaPart["tone"], string> = { good: "whitespace-nowrap text-ok", cost: "whitespace-nowrap text-warn", neutral: "font-medium text-muted-foreground" };

export function SurfaceMixBar({ mix, classes }: { mix: Record<number, number>; classes: SurfaceClass[] }) {
  const entries = Object.entries(mix)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([, v]) => v > 0.001)
    .sort((a, b) => a[0] - b[0]);
  return (
    <div className="flex h-[3px] overflow-hidden bg-track" title={entries.map(([k, v]) => `${classes.find((c) => c.id === k)?.name ?? k}: ${Math.round(v * 100)}%`).join("\n")}>
      {entries.map(([k, v]) => (
        <i key={k} className="block h-full" style={{ width: `${v * 100}%`, background: classes.find((c) => c.id === k)?.color ?? "#888" }} />
      ))}
    </div>
  );
}

function Segment({ s, i, names, over, classes }: { s: RouteSegment; i: number; names: string[]; over: boolean; classes: SurfaceClass[] }) {
  return (
    <li className="border-b">
      <button type="button" className="group/seg block w-full cursor-pointer py-2.5 text-left" onClick={() => flyTo(s.to[0], s.to[1], 16)} aria-label={`Show ${names[i] ?? "?"} to ${names[i + 1] ?? "?"} on the map`}>
      <span className={cn("flex justify-between gap-2 text-sm font-medium", over && "text-bad")}>
        <span className="truncate group-hover/seg:underline group-hover/seg:underline-offset-2">
          {names[i] ?? "?"} → {names[i + 1] ?? "?"}
        </span>
        <span className="whitespace-nowrap">{fmtDur(s.timeS)}</span>
      </span>
      <span className="mt-0.5 mb-1 flex flex-wrap gap-x-[9px] gap-y-0.5 text-xs text-muted-foreground">
        <span className="text-foreground">{fmtDist(s.distanceM)}</span>
        <span>
          ↑{Math.round(s.ascentM)} ↓{Math.round(s.descentM)} m
        </span>
        <span>≤{Math.round(s.maxSlopeDeg)}°</span>
        <span className={s.hazardM > 0 ? "text-warn" : undefined}>{Math.round(s.hazardM)} m hazard</span>
        <span>{fmtEnergy(s.energyKJ)}</span>
      </span>
      <SurfaceMixBar mix={s.surfaceMix} classes={classes} />
      </button>
    </li>
  );
}

/** One route option. The key colour (--c) is the colour of that route's line on the map. */
function AltCard({
  r,
  i,
  selected,
  onPick,
  ref0,
  highlight,
  chip,
  compact,
}: {
  r: RouteResult;
  i: number;
  selected: boolean;
  onPick: () => void;
  ref0: RouteResult | null;
  highlight?: string | null;
  chip?: string | null;
  /** Three across: smaller type so the numbers still fit. */
  compact?: boolean;
}) {
  const t = r.totals;
  const isRef = !ref0 || ref0.profile.id === r.profile.id;
  const all = !isRef && ref0 ? deltaParts(routeDelta(r, ref0)) : [];
  // One line: time delta + either the hazard chip or the next most important difference. The rest is in the tooltip.
  const parts = chip ? all.slice(0, 1) : all.slice(0, 2);
  const status = !r.reachable ? "Unreachable" : t.withinLimits ? "Fits the limits" : `Over ${t.limitingFactor ?? "limit"}`;
  const ok = r.reachable && t.withinLimits;
  const tip = [
    `${r.profile.name}: ${fmtDur(t.totalTimeS)} total (walk + stops)`,
    `${fmtDist(t.distanceM)} · ${fmtEnergy(t.energyKJ)} · ${Math.round(t.hazardM)} m on hazard ground`,
    isRef ? "Reference route for the comparison" : `vs Fastest: ${all.map((p) => p.text).join(" · ")}`,
    highlight ?? "",
    status,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col justify-start gap-px rounded-lg border border-input px-[9px] pt-2 pb-[7px] text-left transition-colors hover:border-seam-strong",
        compact && "px-[7px] pt-[7px] pb-1.5",
        selected && "border-ink-2 bg-white/11 hover:border-ink-2",
      )}
      onClick={onPick}
      style={{ ["--c" as string]: profileColor(r.profile.id, i) }}
      title={tip}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className={cn("truncate text-sm font-medium text-ink-2", compact && "text-xs")}>{r.profile.name}</span>
      </div>
      <div className={cn("mt-px mb-0.5 text-lg leading-[1.2] tracking-[-0.015em]", compact && "text-[16px]")}>{fmtDur(t.totalTimeS)}</div>
      <div className="truncate text-xs text-muted-foreground">
        {fmtDist(t.distanceM)} · {fmtEnergy(t.energyKJ)}
      </div>
      <div className="truncate text-xs text-muted-foreground">{Math.round(t.hazardM)} m hazard</div>
      <div className={cn("mt-[5px] flex min-h-[18px] items-center gap-x-[5px] overflow-hidden text-xs leading-[1.35] font-semibold whitespace-nowrap", compact && "flex-wrap gap-y-[3px]")}>
        {/* Fastest is what the others are measured against, so it carries no comparison of its own. */}
        {!isRef && <span className="font-normal text-muted-foreground">vs Fastest</span>}
        {!isRef &&
          parts.map((p, k) => (
            <Fragment key={k}>
              {k > 0 && <span className="-mx-[3px] font-normal text-muted-foreground"> · </span>}
              <span className={TONE[p.tone]}>{p.text}</span>
            </Fragment>
          ))}
        {chip && <span className="flex-none rounded-[9px] bg-(--c) px-[7px] py-px text-xs leading-[1.4] font-bold text-[#0f0c0b]">{chip}</span>}
      </div>
      {!ok && <div className="mt-[3px] text-xs font-medium text-bad">{status}</div>}
    </button>
  );
}

function RouteAlternatives({ results, selectedId, onPick }: { results: RouteResult[]; selectedId: string | undefined; onPick: (id: string) => void }) {
  const [showSimilar, setShowSimilar] = useState(false);
  const ref0 = results.find((r) => r.profile.id === "fastest" && r.reachable) ?? null;
  const similar = new Set<string>();
  if (ref0) {
    for (const r of results) {
      if (r.profile.id === "least-effort" && r.reachable && nearlyIdentical(routeDelta(r, ref0), ref0)) similar.add(r.profile.id);
    }
  }
  const visible = results.filter((r) => !similar.has(r.profile.id) || showSimilar || r.profile.id === selectedId);
  const hidden = results.filter((r) => !visible.includes(r));
  return (
    <>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
        {visible.map((r) => {
          const i = results.indexOf(r);
          const hl = ref0 && r.profile.id === "safest" && r.reachable ? hazardHighlight(r, ref0) : null;
          const chip = ref0 && r.profile.id === "safest" && r.reachable ? hazardChip(r, ref0) : null;
          return (
            <AltCard key={r.profile.id} r={r} i={i} selected={selectedId === r.profile.id} onPick={() => onPick(r.profile.id)} ref0={ref0} highlight={hl} chip={chip} compact={visible.length === 3} />
          );
        })}
      </div>
      {similar.size > 0 && (
        <div className="mt-1.5 cursor-help text-sm text-muted-foreground" title="Routes whose line, time and hazard are within a few percent of Fastest are folded together.">
          {hidden.length > 0 ? (
            <>
              {hidden.map((r) => r.profile.name).join(", ")} ≈ Fastest ·{" "}
              <Button variant="link" size="inline" className="text-xs" onClick={() => setShowSimilar(true)}>
                show
              </Button>
            </>
          ) : (
            <>
              {[...similar].map((id) => results.find((r) => r.profile.id === id)?.profile.name).join(", ")} ≈ Fastest{showSimilar ? " · " : ""}
              {showSimilar && (
                <Button variant="link" size="inline" className="text-xs" onClick={() => setShowSimilar(false)}>
                  hide
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** One line under a stop: what the crew does there (from the POI's "what a crew can do") and the dwell. */
function StopTask({ stop, poi }: { stop: Stop; poi?: Poi }) {
  const dwell = stop.dwellS > 0 ? fmtDur(stop.dwellS) : "pass through";
  const task = poi?.humanCan?.trim().replace(/\.$/, "") || (poi ? poi.summary.replace(/\.$/, "") : "Custom stop: observe and sample");
  return (
    <span className="flex min-w-0 flex-[1_0_100%] pr-1 pl-[46px] text-xs leading-[1.35] text-muted-foreground" title={`${task} · ${dwell}`}>
      <span className="truncate">{task}</span>
      {stop.dwellS <= 0 && <span className="flex-none whitespace-pre text-[#c9b9ad]"> · {dwell}</span>}
    </span>
  );
}

export function PlanTab() {
  const area = useStore((s) => s.area)!;
  const st = useStore(
    useShallow((s) => {
      const { hover: _h, profileHoverM: _p, profileCursor: _c, go: _g, ...rest } = s;
      return rest;
    }),
  );
  const { start, stops, returnToStart, params, defaultParams, engine, planStatus, planError, results, reachStatus } = st;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const pnr = usePnr();
  const starts = area.config.pois.filter((p) => p.type === "start");
  const stopPois = area.config.pois.filter((p) => p.type !== "start");
  const poiById = new Map(area.config.pois.map((p) => [p.id, p] as const));
  const sel = selectedResult(st);
  const names = pointNames(start, stops, returnToStart);
  const classes = area.config.surfaceClasses;
  if (!params) return null;
  const usableT = usableTimeS(params);
  const src = ((area.config.walkParams as unknown as { _sources?: Record<string, string> })._sources ?? {}) as Record<string, string | undefined>;
  const usableE = params.energyBudgetKJ * (1 - params.reserveFraction);
  const o2On = (params.o2BudgetKg ?? 0) > 0 && (params.o2KgPerKJ ?? 0) > 0;
  const usableO = (params.o2BudgetKg ?? 0) * (1 - params.reserveFraction);
  const msg = sel ? limitMessage(sel, names, params) : null;
  const calculating = planStatus === "calculating" || reachStatus === "calculating";

  const startItems = [
    ...starts.map((p) => ({ value: p.id, label: p.name.replace(/^Start:\s*/, "") })),
    ...(start && !start.poiId ? [{ value: "__custom", label: "Custom point" }] : []),
  ];
  const stopItems = stopPois.map((p) => ({ value: p.id, label: p.name }));

  return (
    <>
      {!engine.ready && (
        <Alert variant={engine.error ? "destructive" : "default"}>
          {engine.error ?? "Loading routing layers…"}
          {engine.missing.length > 0 && <div className="text-sm">Routes, rings and walk cost need @marsmap/core. The map, layers and POIs still work.</div>}
        </Alert>
      )}

      <SectionHeading>Start</SectionHeading>
      <div className="mb-1.5 flex gap-2" title={start ? `${fmtLonLat(start.lonLat)} · drag the S marker on the map to move it` : undefined}>
        <Select
          items={startItems}
          value={start?.poiId ?? (start ? "__custom" : null)}
          onValueChange={(id) => {
            const p = starts.find((x) => x.id === id) ?? area.config.pois.find((x) => x.id === id);
            if (p) {
              st.setStart({ lonLat: [p.lon, p.lat], name: p.name, poiId: p.id });
              flyTo(p.lon, p.lat, 15.5);
            }
          }}
        >
          <SelectTrigger className="min-w-0 flex-1">
            <SelectValue placeholder="Choose a start spot…" />
          </SelectTrigger>
          <SelectContent>
            {startItems.map((it) => (
              <SelectItem key={it.value} value={it.value} disabled={it.value === "__custom"}>
                {it.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={st.pickingStart ? "default" : "secondary"} onClick={() => st.set({ pickingStart: !st.pickingStart })}>
          {st.pickingStart ? "Click map…" : "Pick on map"}
        </Button>
      </div>

      <SectionHeading>
        Stops <span className="font-semibold tracking-[0.04em] opacity-80">{stops.length}</span>
        <SectionHeadingAside render={<label />} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground" title="Plan a loop that ends back at the start">
          <Checkbox checked={returnToStart} onCheckedChange={(v) => st.set({ returnToStart: v })} />
          Return to start
        </SectionHeadingAside>
      </SectionHeading>
      {stops.length === 0 && <div className="pt-1 pb-2 text-sm text-muted-foreground">Add a stop below, from a POI card, or by clicking the map.</div>}
      <ol className="list-none p-0">
        {stops.map((s, i) => {
          const over = sel && sel.totals.firstSegmentOverLimit != null && i >= sel.totals.firstSegmentOverLimit;
          return (
            <li
              key={s.id}
              draggable
              className={cn(
                "flex flex-wrap items-center gap-x-2 gap-y-px border-b py-1.5 coarse:py-2",
                dragIdx === i && "opacity-40",
                overIdx === i && dragIdx !== i && "shadow-[inset_0_2px_0_var(--ink)]",
              )}
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIdx(i);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx != null && dragIdx !== i) st.moveStop(dragIdx, i);
                setDragIdx(null);
                setOverIdx(null);
              }}
            >
              {/* Drag with a pointer; with the keyboard, focus the grip and press the up or down arrow. */}
              <button
                type="button"
                className="-mx-1 flex-none cursor-grab rounded-sm p-1 text-ink-4 coarse:-my-1 coarse:grid coarse:size-9 coarse:place-items-center hover:text-ink-2 focus-visible:text-foreground"
                aria-label={`Reorder stop ${i + 1}, ${s.name}. Use the up and down arrow keys.`}
                title="Drag to reorder, or use the arrow keys"
                onKeyDown={(e) => {
                  const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                  if (to < 0 || to >= stops.length) return;
                  e.preventDefault();
                  st.moveStop(i, to);
                }}
              >
                <GripVerticalIcon className="size-3.5" aria-hidden />
              </button>
              <span className={cn("grid size-[18px] flex-none place-items-center rounded-sm border border-seam-strong text-xs", over && "border-bad text-bad")}>{i + 1}</span>
              <button type="button" className="flex min-w-0 flex-1 cursor-pointer text-left coarse:py-2" onClick={() => flyTo(s.lonLat[0], s.lonLat[1])} title="Show on the map">
                <span className="truncate hover:underline hover:underline-offset-2">{s.name}</span>
              </button>
              <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Time working at this stop">
                <Input
                  type="number"
                  className="h-[22px] w-11 rounded-sm bg-well px-1 text-right coarse:h-9 coarse:w-[54px]"
                  min={0}
                  max={240}
                  step={5}
                  value={Math.round(s.dwellS / 60)}
                  onChange={(e) => st.setDwell(s.id, Math.max(0, Number(e.target.value)) * 60)}
                />
                min
              </label>
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={() => st.removeStop(s.id)} title="Remove stop" aria-label="Remove stop">
                <XIcon />
              </Button>
              <StopTask stop={s} poi={s.poiId ? poiById.get(s.poiId) : undefined} />
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex items-center gap-3">
        <Select
          items={stopItems}
          value={null}
          onValueChange={(id) => {
            const p = stopPois.find((x) => x.id === id);
            if (p) st.addStop({ lonLat: [p.lon, p.lat], name: p.name, poiId: p.id });
          }}
        >
          <SelectTrigger className="min-w-0 flex-1">
            <SelectValue placeholder="+ Add a stop…" />
          </SelectTrigger>
          <SelectContent>
            {stopItems.map((it) => (
              <SelectItem key={it.value} value={it.value} disabled={stops.some((s) => s.poiId === it.value)}>
                {it.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {planError && <Alert variant="destructive">Routing failed: {planError}</Alert>}

      {((results && results.length > 0) || calculating) && (
        <SectionHeading>
          Routes {calculating && <Spinner className="size-3" aria-label="Calculating" />}
        </SectionHeading>
      )}
      {results && results.length > 0 && <RouteAlternatives results={results} selectedId={sel?.profile.id} onPick={(id) => st.set({ selectedProfile: id })} />}

      {sel && (
        <>
          {/* The one place that says whether the selected route fits. */}
          {msg ? (
            <Alert variant="destructive">{msg}</Alert>
          ) : (
            <p className="mt-3 mb-0 flex flex-wrap items-center gap-x-1.5" role="status">
              <CheckIcon className="size-4 flex-none text-ok" aria-hidden />
              <b className="font-semibold">Fits the limits</b>
              <span className="text-muted-foreground">
                {fmtMin(sel.totals.totalTimeS)} of {fmtMin(usableT)} usable, {Math.round(params.reserveFraction * 100)}% in reserve
              </span>
            </p>
          )}
          <SectionHeading>Safety budget</SectionHeading>
          <div className="pt-1 pb-2">
            <SafetyBudget r={sel} params={params} pnr={pnr} names={names} />
          </div>
          <div className="mt-2.5 flex gap-2">
            <Button className="flex-1" onClick={() => st.setGo({ mode: "sim", playing: true, elapsedS: 0, alongM: 0, position: start?.lonLat ?? null, gpsError: null })}>
              Simulate walk
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => st.setGo({ mode: "gps", playing: true, elapsedS: 0, alongM: 0, position: start?.lonLat ?? null, gpsError: null })}>
              Use my location
            </Button>
          </div>
          <Disclosure title="Segment details" note={`${sel.segments.length} legs`}>
            <ol className="m-0 list-none border-t p-0">
              {sel.segments.map((s, i) => (
                <Segment key={i} s={s} i={i} names={names} classes={classes} over={sel.totals.firstSegmentOverLimit != null && i >= sel.totals.firstSegmentOverLimit} />
              ))}
            </ol>
          </Disclosure>
        </>
      )}

      <Disclosure title="Walk settings" note={`${fmtMin(params.evaLimitS)} · ${params.baseSpeedMps.toFixed(2)} m/s · ${Math.round(params.reserveFraction * 100)}% reserve`}>
        <div className="mb-2 grid gap-3">
          <SliderField hint={src.evaLimitS} label="EVA time limit" value={params.evaLimitS / 3600} min={1} max={9} step={0.25} format={(v) => fmtMin(v * 3600)} onValueChange={(v) => st.setParams({ evaLimitS: v * 3600 })} />
          <SliderField hint={src.baseSpeedMps} label="Walking speed" value={params.baseSpeedMps} min={0.3} max={1.8} step={0.05} format={(v) => `${v.toFixed(2)} m/s`} onValueChange={(v) => st.setParams({ baseSpeedMps: v })} />
          <SliderField
            label="Dwell per stop"
            hint={`Sets the work time at every stop. ${src.stopDwellS ?? ""}`.trim()}
            value={params.stopDwellS / 60}
            min={0}
            max={90}
            step={5}
            format={(v) => fmtMin(v * 60)}
            onValueChange={(v) => {
              st.setParams({ stopDwellS: v * 60 });
              st.set({ stops: useStore.getState().stops.map((s) => ({ ...s, dwellS: v * 60 })) });
            }}
          />
          {o2On && (
            <SliderField hint={src.o2BudgetKg} label="Oxygen carried" value={params.o2BudgetKg!} min={0.2} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)} kg`} onValueChange={(v) => st.setParams({ o2BudgetKg: v })} />
          )}
          <SliderField hint={src.reserveFraction} label="Safety reserve" value={params.reserveFraction * 100} min={0} max={50} step={1} format={(v) => `${Math.round(v)}%`} onValueChange={(v) => st.setParams({ reserveFraction: v / 100 })} />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="flex items-center gap-0.5 text-sm text-muted-foreground">
            Usable {fmtMin(usableT)}, {fmtEnergy(usableE)}
            {o2On ? `, ${fmtO2(usableO)} O₂` : ""}; slope up to {params.maxSlopeDeg}°
            <InfoTip label="About the usable budget">{`Usable = limit minus the safety reserve. Max slope is the no-go steepness for routing.\nSource: ${area.config.walkParamsSource}`}</InfoTip>
          </span>
          {defaultParams && JSON.stringify(defaultParams) !== JSON.stringify(params) && (
            <Button variant="link" size="inline" className="ml-auto text-xs" onClick={() => st.set({ params: defaultParams })}>
              reset
            </Button>
          )}
        </div>
      </Disclosure>
    </>
  );
}
