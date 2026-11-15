import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CheckIcon, GripVerticalIcon, PlayIcon, XIcon } from "lucide-react";
import type { RouteResult, RouteSegment, SurfaceClass, WalkParams } from "@marsmap/core";
import { selectedResult, usableTimeS, useStore } from "../store";
import { fmtDist, fmtDur, fmtEnergy, fmtLonLat, fmtO2 } from "../format";
import { limitMessage, pointNames } from "../lib";
import { routeSlopeColor, slopeBands } from "../map/routeSlope";
import { demoAvailable, flyTo, placeName, runDemoWalk } from "./ExploreTab";
import { nearlyIdentical, routeDelta } from "./routeCompare";
import { STOP_BADGE, STOP_BADGE_NUMBER, STOP_BADGE_START } from "../map/mapLabel";
import { fmtMin, SafetyBudget } from "./SafetyBudget";
import { usePnr } from "../usePnr";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Disclosure } from "@/components/ui/disclosure";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { SectionHeading, SectionHeadingAside } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SliderField } from "@/components/ui/slider-field";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

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

/** How many bars a leg's slope chart has. */
const SLOPE_BINS = 18;

/**
 * The slope along one leg as a row of small bars, start to end: each bar is the steepest ground in its
 * stretch, as tall as that is against the no-go slope and in the colour the route line has there on the map.
 */
function SlopeBars({ s, params }: { s: RouteSegment; params: WalkParams }) {
  if (s.profile.length < 2 || s.distanceM <= 0) return null;
  const bins = new Array<number>(SLOPE_BINS).fill(0);
  for (const p of s.profile) {
    const b = Math.min(SLOPE_BINS - 1, Math.floor((p.distanceM / s.distanceM) * SLOPE_BINS));
    bins[b] = Math.max(bins[b]!, Math.abs(p.slopeDeg));
  }
  // A stretch with no sample takes its neighbour's value, so short legs do not show gaps.
  for (let b = 1; b < SLOPE_BINS; b++) if (!bins[b]) bins[b] = bins[b - 1]!;
  const top = slopeBands(params).max;
  return (
    <span className="ml-auto flex h-3.5 w-[58px] flex-none items-end gap-px" role="img" aria-label={`Slope along the leg, up to ${Math.round(s.maxSlopeDeg)}°`}>
      {bins.map((v, b) => (
        <i key={b} className="block min-w-0 flex-1 rounded-[1px]" style={{ height: `${Math.max(14, Math.min(100, (v / top) * 100))}%`, background: routeSlopeColor(v, params) }} />
      ))}
    </span>
  );
}

function Segment({ s, i, names, over, classes, params }: { s: RouteSegment; i: number; names: string[]; over: boolean; classes: SurfaceClass[]; params: WalkParams }) {
  return (
    <li className="border-b">
      <button type="button" className="group/seg block w-full cursor-pointer py-2.5 text-left" onClick={() => flyTo(s.to[0], s.to[1], 16)} aria-label={`Show ${names[i] ?? "?"} to ${names[i + 1] ?? "?"} on the map`}>
      <span className={cn("flex justify-between gap-2 text-sm font-medium", over && "text-bad")}>
        <span className="truncate group-hover/seg:underline group-hover/seg:underline-offset-2">
          {names[i] ?? "?"} → {names[i + 1] ?? "?"}
        </span>
        <span className="whitespace-nowrap">{fmtDur(s.timeS)}</span>
      </span>
      <span className="mt-0.5 mb-1 flex flex-wrap items-end gap-x-[9px] gap-y-0.5 text-xs text-muted-foreground">
        <span className="text-foreground">{fmtDist(s.distanceM)}</span>
        <span>
          ↑{Math.round(s.ascentM)} ↓{Math.round(s.descentM)} m
        </span>
        <span>≤{Math.round(s.maxSlopeDeg)}°</span>
        <span className={s.hazardM > 0 ? "text-warn" : undefined}>{Math.round(s.hazardM)} m hazard</span>
        <span>{fmtEnergy(s.energyKJ)}</span>
        <SlopeBars s={s} params={params} />
      </span>
      <SurfaceMixBar mix={s.surfaceMix} classes={classes} />
      </button>
    </li>
  );
}

/** The figures the routes are compared on, one column each. Lower is better in all of them. */
const ROUTE_COLS: { label: string; get: (r: RouteResult) => number; fmt: (v: number) => string }[] = [
  { label: "Time", get: (r) => r.totals.totalTimeS, fmt: fmtMin },
  { label: "Distance", get: (r) => r.totals.distanceM, fmt: fmtDist },
  { label: "Energy", get: (r) => r.totals.energyKJ, fmt: fmtEnergy },
  { label: "Hazard", get: (r) => r.totals.hazardM, fmt: (v) => `${Math.round(v)} m` },
];

/**
 * The route options as a table, one row per route: the planner compares down a column. The swatch is the
 * colour of that route's line on the map. The best figure in each column is in the primary ink and the rest
 * are muted; no colour is added for it.
 */
function RouteTable({ results, selectedId, onPick }: { results: RouteResult[]; selectedId: string | undefined; onPick: (id: string) => void }) {
  const [showSimilar, setShowSimilar] = useState(false);
  const setHover = (id: string | null) => useStore.getState().set({ hoverProfile: id });
  const ref0 = results.find((r) => r.profile.id === "fastest" && r.reachable) ?? null;
  const similar = new Set<string>();
  if (ref0) {
    for (const r of results) {
      if (r.profile.id === "least-effort" && r.reachable && nearlyIdentical(routeDelta(r, ref0), ref0)) similar.add(r.profile.id);
    }
  }
  const visible = results.filter((r) => !similar.has(r.profile.id) || showSimilar || r.profile.id === selectedId);
  const hidden = results.filter((r) => !visible.includes(r));
  const reachable = visible.filter((r) => r.reachable);
  // Compared as shown, so two routes that read the same are both the best.
  const best = ROUTE_COLS.map((c) => (reachable.length ? c.fmt(Math.min(...reachable.map(c.get))) : null));
  const row = "col-span-full grid grid-cols-subgrid items-center px-2";
  return (
    <>
      <div className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-x-3 gap-y-0.5" role="group" aria-label="Route options">
        {/* Each row names its own figures for a screen reader, so the column headings are for the eye. */}
        <div className={cn(row, "pb-0.5 text-xs text-muted-foreground")} aria-hidden>
          <span>Route</span>
          {ROUTE_COLS.map((c) => (
            <span key={c.label} className="text-right">
              {c.label}
            </span>
          ))}
        </div>
        {visible.map((r) => {
          const t = r.totals;
          const selected = selectedId === r.profile.id;
          const ok = r.reachable && t.withinLimits;
          const status = !r.reachable ? "Unreachable" : t.withinLimits ? "Fits the limits" : `Over ${t.limitingFactor ?? "limit"}`;
          return (
            <button
              key={r.profile.id}
              type="button"
              aria-pressed={selected}
              aria-label={
                r.reachable
                  ? `${r.profile.name}: ${fmtMin(t.totalTimeS)} total, ${fmtDist(t.distanceM)}, ${fmtEnergy(t.energyKJ)}, ${Math.round(t.hazardM)} m on hazard ground. ${status}.`
                  : `${r.profile.name}: unreachable.`
              }
              className={cn(row, "min-h-8 cursor-pointer rounded-lg py-1 text-left text-sm transition-colors coarse:min-h-10 hover:bg-white/5", selected && "bg-white/11 hover:bg-white/11")}
              onClick={() => onPick(r.profile.id)}
              // The routes not chosen are all one grey on the map: pointing at a row (or focusing it) lights its line.
              onPointerEnter={() => setHover(r.profile.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(r.profile.id)}
              onBlur={() => setHover(null)}
            >
              <span className="flex min-w-0 items-center">
                <span className="min-w-0">
                  <span className={cn("block truncate font-medium", !selected && "text-ink-2")}>{r.profile.name}</span>
                  {!ok && <span className="block text-xs font-medium text-bad">{status}</span>}
                </span>
              </span>
              {ROUTE_COLS.map((c, k) => {
                const text = r.reachable ? c.fmt(c.get(r)) : "—";
                // On the lighter selected row the muted figures step up a shade to keep their contrast.
                return (
                  <span key={c.label} className={cn("text-right whitespace-nowrap", r.reachable && text === best[k] ? "text-foreground" : selected ? "text-ink-2" : "text-muted-foreground")}>
                    {text}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
      {similar.size > 0 && (
        <div className="mt-1.5 text-sm text-muted-foreground">
          {hidden.length > 0 ? (
            <>
              {hidden.map((r) => r.profile.name).join(", ")} ≈ Fastest ·{" "}
              <Button variant="link" size="inline" className="text-xs coarse:py-2" onClick={() => setShowSimilar(true)}>
                show
              </Button>
              <InfoTip label="About folded routes">Routes whose line, time and hazard are within a few percent of Fastest are folded together.</InfoTip>
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

/** The walk list's first column: the grip on a stop row, and the same room left empty on the start and return rows. */
const GRIP_COL = "w-3.5 flex-none coarse:w-7";
const ROW_BADGE = cn(STOP_BADGE, "size-[18px] text-xs");

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
    ...starts.map((p) => ({ value: p.id, label: placeName(p) })),
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

      {sel && (
        <section aria-label="Verdict and budgets">
          {/* The one place that says whether the selected route fits. The figures are on the bars under it. */}
          {msg ? (
            <Alert variant="destructive" className="mt-0 mb-1">
              {msg}
            </Alert>
          ) : (
            <p className="m-0 flex flex-wrap items-center gap-x-1.5" role="status">
              <CheckIcon className="size-4 flex-none text-ok" aria-hidden />
              <b className="font-semibold">Fits the limits</b>
              <span className="text-muted-foreground">{Math.round(params.reserveFraction * 100)}% held in reserve</span>
            </p>
          )}
          <SafetyBudget r={sel} params={params} pnr={pnr} names={names} />
        </section>
      )}

      {/* Nothing planned yet: say what to do first, and offer the ready-made walk. */}
      {!start && stops.length === 0 && (
        <section className="mb-5 rounded-xl bg-white/5 p-3 inset-ring inset-ring-white/10">
          <h2 className="m-0 text-lg leading-snug font-medium tracking-[-0.01em]">Plan a walk</h2>
          <ol className="m-0 mt-2 grid list-none gap-1.5 p-0 text-sm text-ink-2">
            {["Choose where the crew starts.", "Add the places to stop and work.", "Compare the routes against the limits."].map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className={cn(ROW_BADGE, STOP_BADGE_NUMBER)} aria-hidden>
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          {demoAvailable(area.config.pois) && (
            <Button variant="secondary" className="mt-3 h-9 w-full gap-2" onClick={() => runDemoWalk(area.config.pois)}>
              <PlayIcon className="size-3.5 flex-none fill-current" aria-hidden />
              Or load the boxwork walk
            </Button>
          )}
        </section>
      )}

      <SectionHeading>
        Walk
        <SectionHeadingAside>
          {stops.length} {stops.length === 1 ? "stop" : "stops"}
        </SectionHeadingAside>
      </SectionHeading>
      <ol className="m-0 list-none p-0">
        <li className="flex items-center gap-x-2 border-b py-1.5 coarse:py-2" title={start ? `${fmtLonLat(start.lonLat)} · drag the S marker on the map to move it` : undefined}>
          <span className={GRIP_COL} aria-hidden />
          <span className={cn(ROW_BADGE, STOP_BADGE_START)} aria-hidden>
            S
          </span>
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
            <SelectTrigger aria-label="Start" className="min-w-0 flex-1">
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
          <Button variant={st.pickingStart ? "default" : "secondary"} aria-pressed={st.pickingStart} onClick={() => st.set({ pickingStart: !st.pickingStart })}>
            {st.pickingStart ? "Click map…" : "Pick on map"}
          </Button>
        </li>
        {stops.length === 0 && <li className="border-b py-2 text-sm text-ink-2">{start ? "Now add a stop: from the list below, a place's card, or a click on the map." : "No stops yet."}</li>}
        {stops.map((s, i) => {
          const over = sel && sel.totals.firstSegmentOverLimit != null && i >= sel.totals.firstSegmentOverLimit;
          return (
            <li
              key={s.id}
              draggable
              className={cn("flex items-center gap-x-2 border-b py-1.5 coarse:py-2", dragIdx === i && "opacity-40", overIdx === i && dragIdx !== i && "shadow-[inset_0_2px_0_var(--ink)]")}
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
              <span className={cn(ROW_BADGE, over ? "border-bad bg-well text-bad" : STOP_BADGE_NUMBER)}>{i + 1}</span>
              <button type="button" className="flex min-w-0 flex-1 cursor-pointer text-left coarse:py-2" onClick={() => flyTo(s.lonLat[0], s.lonLat[1])} title="Show on the map">
                <span className="truncate hover:underline hover:underline-offset-2">{s.name}</span>
              </button>
              <label className="flex flex-none items-center gap-1 text-xs text-muted-foreground" title="Time working at this stop">
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
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={() => st.removeStop(s.id)} title="Remove stop" aria-label={`Remove stop ${i + 1}, ${s.name}`}>
                <XIcon />
              </Button>
            </li>
          );
        })}
        {/* The walk's last row: whether it ends back where it began. */}
        <li className="flex items-center gap-x-2 py-1.5 coarse:py-0">
          <span className={GRIP_COL} aria-hidden />
          <span className={cn(ROW_BADGE, returnToStart ? STOP_BADGE_START : "border-input text-muted-foreground")} aria-hidden>
            S
          </span>
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 coarse:min-h-11">
            <span className={cn("min-w-0 flex-1 truncate", !returnToStart && "text-muted-foreground")}>Return to start</span>
            <Switch size="sm" className="mr-1 coarse:mr-3" aria-label="Return to start" checked={returnToStart} onCheckedChange={(v) => st.set({ returnToStart: v })} />
          </label>
        </li>
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
      {results && results.length > 0 && <RouteTable results={results} selectedId={sel?.profile.id} onPick={(id) => st.set({ selectedProfile: id })} />}

      {sel && (
        <Disclosure title="Segment details" note={`${sel.segments.length} legs`}>
          <ol className="m-0 list-none border-t p-0">
            {sel.segments.map((s, i) => (
              <Segment key={i} s={s} i={i} names={names} classes={classes} params={params} over={sel.totals.firstSegmentOverLimit != null && i >= sel.totals.firstSegmentOverLimit} />
            ))}
          </ol>
        </Disclosure>
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

/**
 * The Plan tab's actions. They sit in a footer under the scrolling body, so starting a walk is always in
 * reach however long the plan is. There is nothing to start until a route exists.
 */
export function PlanFooter() {
  const start = useStore((s) => s.start);
  const setGo = useStore((s) => s.setGo);
  const hasRoute = useStore((s) => !!selectedResult(s));
  if (!hasRoute) return null;
  const go = (mode: "sim" | "gps") => setGo({ mode, playing: true, elapsedS: 0, alongM: 0, position: start?.lonLat ?? null, gpsError: null });
  return (
    <div className="relative z-2 flex flex-none gap-2 border-t px-4 py-3 sheet:pr-[max(var(--gutter),env(safe-area-inset-right))] sheet:pl-[max(var(--gutter),env(safe-area-inset-left))]">
      <Button className="flex-1" onClick={() => go("sim")}>
        Simulate walk
      </Button>
      <Button variant="secondary" className="flex-1" onClick={() => go("gps")}>
        Use my location
      </Button>
    </div>
  );
}
