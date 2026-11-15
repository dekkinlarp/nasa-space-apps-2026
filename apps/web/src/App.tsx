import { useEffect, useRef, useState } from "react";
import { useStore, type Tab } from "./store";
import { loadArea, pickArea } from "./data";
import { startEngine } from "./engine";
import { MapView, setMapInsets } from "./map/MapView";
import { pictureGroup } from "./map/imageryTiles";
import { ChevronLeftIcon } from "lucide-react";
import { SidebarIcon } from "./components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Starfield } from "./map/Starfield";
import { ConditionsBar, SiteHeader } from "./components/SiteHeader";
import { ExploreTab } from "./components/ExploreTab";
import { PlanTab } from "./components/PlanTab";
import { LayersTab } from "./components/LayersTab";
import { HoverReadout } from "./components/HoverReadout";
import { PoiCard, WaypointCard } from "./components/Cards";
import { ProfileStrip } from "./components/ProfileStrip";
import { GoPanel } from "./components/GoPanel";
import { GoWalker } from "./components/GoWalker";
import { MapLegend } from "./components/MapLegend";
import { MapSafety } from "./components/MapSafety";

let loadStarted = false;

const TABS: { id: Tab; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "plan", label: "Plan" },
  { id: "layers", label: "Layers" },
];

/** Keep in step with --panel-ms in index.css. */
export const PANEL_MS = 380;

const narrowScreen = () => typeof matchMedia === "function" && matchMedia("(max-width: 860px)").matches;

const coarsePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** A "?" next to the 2D/3D switch that lists the map gestures for the device in hand. */
function GestureHint({ view3d }: { view3d: boolean }) {
  const [open, setOpen] = useState(false);
  const touch = coarsePointer();
  const rows: [string, string][] = touch
    ? [
        ["Drag", "move the map"],
        ["Pinch", "zoom"],
        ["Twist two fingers", "rotate"],
        ["Drag two fingers up or down", view3d ? "tilt; level out for 2D" : "tilt into 3D"],
        ["Double-tap / two-finger tap", "zoom in / out"],
        ["Double-tap, then drag", "zoom with one finger"],
        ["Tap, or touch and hold", "set a start or add a stop"],
      ]
    : [
        ["Two-finger scroll or drag", "move the map"],
        ["Pinch or mouse wheel", "zoom"],
        ["Option/Alt + two-finger scroll", "sideways turns the map, up or down tilts it" + (view3d ? "" : " into 3D")],
        ["Twist two fingers", "rotate (Safari only; Chrome hides this gesture from web pages)"],
        ["Shift + scroll, or drag the compass", "rotate"],
        ["Right-drag or Ctrl + drag", "rotate and tilt"],
        ["Double-click", "zoom in"],
      ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="glass" size="icon-xl" aria-label="Map gestures" title="Map gestures" className="text-lg" />}>?</PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="glass bg-glass w-max max-w-[min(380px,calc(100vw-24px))] rounded-xl px-4 py-3 shadow-float-sm ring-0">
        <dl className="m-0 grid gap-1.5 text-sm" onClick={() => setOpen(false)}>
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="font-medium">{k}</dt>
              <dd className="m-0 text-right text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** 3D render distance choices: side of the square of ground drawn around where the camera looks, km. */
const RENDER_DISTANCES = [2, 4, 8, 16].map((km) => ({ value: String(km), label: `${km} × ${km} km` }));

/** Top-right of the map: how the map is viewed. The vertical-scale slider and render distance appear beside it in 3D. */
function ViewControls() {
  const view3d = useStore((s) => s.view3d);
  const ex = useStore((s) => s.exaggeration);
  const renderKm = useStore((s) => s.renderDistanceKm);
  const set = useStore((s) => s.set);
  const hasElev = useStore((s) => !!s.area?.overview.elevation);
  return (
    <div className="flex items-center gap-2">
      {view3d && (
        <Panel className="flex h-11 items-center gap-3 px-4 text-ink-2 phone:hidden">
          <span className="caps whitespace-nowrap">Vertical ×{ex}</span>
          <Slider aria-label="Vertical exaggeration" className="w-[110px] sheet:w-20" min={1} max={10} step={0.5} value={[ex]} onValueChange={(v) => set({ exaggeration: Array.isArray(v) ? v[0]! : v })} />
          <span className="caps ml-1 whitespace-nowrap" title="How much ground is drawn in 3D, centred on where you are looking. Smaller is faster on slow devices.">
            Draw
          </span>
          <Select items={RENDER_DISTANCES} value={String(renderKm)} onValueChange={(v) => v && set({ renderDistanceKm: Number(v) })}>
            <SelectTrigger aria-label="3D render distance" size="sm" className="w-[104px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RENDER_DISTANCES.map((it) => (
                <SelectItem key={it.value} value={it.value}>
                  {it.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Panel>
      )}
      <Segmented
        aria-label="Map view"
        value={view3d ? "3d" : "2d"}
        onValueChange={(v) => set({ view3d: v === "3d" })}
        options={[
          { value: "2d", label: "2D" },
          { value: "3d", label: "3D", disabled: !hasElev },
        ]}
        className="glass bg-glass border-glass-edge h-11 p-1 shadow-float-sm"
        itemClassName="h-full px-4 text-base coarse:h-full"
      />
      <GestureHint view3d={view3d} />
    </div>
  );
}

export function App() {
  const area = useStore((s) => s.area);
  const loadError = useStore((s) => s.loadError);
  const tab = useStore((s) => s.tab);
  const set = useStore((s) => s.set);
  const poi = useStore((s) => s.selectedPoi);
  const wp = useStore((s) => s.selectedWaypoint);
  const hasRoute = useStore((s) => !!s.results?.length);
  const planCount = useStore((s) => s.stops.length);
  const baseImagery = useStore((s) => s.baseImagery);
  // The side panel can be collapsed: on wide screens it leaves the map the whole window,
  // on narrow ones it is a bottom sheet that folds down to its tab bar.
  const [sheetOpen, setSheetOpen] = useState(true);
  const sideRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // The map runs under the floating chrome, so tell it which part is covered: its centre, and anything
  // it frames, then lands in the part the user can see. Re-measured whenever a panel opens, folds or
  // changes size (the profile dock appearing, the window resizing).
  useEffect(() => {
    if (!area) return;
    const apply = (ms: number) => {
      const side = sideRef.current, dock = dockRef.current;
      if (!side) return;
      const s = side.getBoundingClientRect();
      const dockH = dock ? dock.getBoundingClientRect().height + 12 : 0;
      if (narrowScreen()) setMapInsets({ top: 56, bottom: (sheetOpen ? s.height : 58) + dockH }, ms);
      else setMapInsets({ top: 56, left: sheetOpen ? s.right : 0, bottom: dockH }, ms);
    };
    apply(PANEL_MS);
    const ro = new ResizeObserver(() => apply(PANEL_MS));
    if (dockRef.current) ro.observe(dockRef.current);
    const onResize = () => apply(0);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [sheetOpen, area, hasRoute]);

  // Stop Safari from pinch-zooming the whole page when a pinch starts outside the map.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    return () => document.removeEventListener("gesturestart", stop);
  }, []);

  useEffect(() => {
    if (loadStarted) return;
    loadStarted = true;
    (async () => {
      try {
        const { id, synthetic } = await pickArea();
        const a = await loadArea(id, synthetic);
        const groups = a.manifest.imagery.map(pictureGroup);
        const base = groups.find((g) => /hirise/i.test(g)) ?? groups[0] ?? null;
        const start = a.config.pois.find((p) => p.type === "start");
        set({
          area: a,
          baseImagery: base,
          params: a.config.walkParams,
          defaultParams: a.config.walkParams,
          start: start ? { lonLat: [start.lon, start.lat], name: start.name, poiId: start.id } : null,
        });
        startEngine(a);
      } catch (e) {
        set({ loadError: String((e as Error)?.message ?? e) });
      }
    })();
  }, [set]);

  if (loadError)
    return (
      <div className="grid h-full place-content-center gap-2 p-4 text-center text-ink-2">
        <h2 className="m-0 text-lg text-foreground">Could not load map data</h2>
        <p className="m-0 font-mono">{loadError}</p>
        <p className="m-0 text-muted-foreground">
          Is the server running on :8787? Start everything with <span className="font-mono">pnpm dev</span>.
        </p>
      </div>
    );
  if (!area)
    return (
      <div className="grid h-full place-content-center gap-2 p-4 text-center text-ink-2">
        <Spinner className="mx-auto size-6" />
        <p className="m-0">Loading Gale Crater…</p>
      </div>
    );

  return (
    <div className={`app ${sheetOpen ? "sheet-open" : "sheet-closed"}`}>
      {/* The map is the whole window; everything else floats over it. */}
      <div className="map-layer">
        <Starfield />
        <MapView />
        <GoWalker />
        <div className="map-credit">{area.manifest.imagery.find((i) => pictureGroup(i) === baseImagery)?.source ?? ""}</div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => set({ tab: v as Tab })}
        render={<aside ref={sideRef} />}
        className="side glass-thick gap-0 rounded-2xl shadow-float sheet:rounded-b-none sheet:border-b-0"
      >
        <SiteHeader onCollapse={() => setSheetOpen(false)} />
        <nav
          className="tabs flex flex-none gap-2 border-b px-4 pb-3 sheet:p-3 sheet:pl-[max(12px,env(safe-area-inset-left))] sheet:in-[.sheet-closed]:border-b-0"
          aria-label="Sections"
        >
          <TabsList className="flex-1 gap-0.5 rounded-[9px] bg-white/6 p-0.5 group-data-horizontal/tabs:h-auto">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                // On the bottom sheet, tapping the open tab again folds it; any other tap opens it.
                onClick={() => setSheetOpen(tab === t.id && narrowScreen() ? !sheetOpen : true)}
                className="h-[30px] rounded-[7px] text-sm text-ink-2 coarse:h-[38px] data-active:bg-white/16 data-active:text-foreground data-active:shadow-thumb"
              >
                {t.label}
                {t.id === "plan" && planCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 rounded-lg bg-white/14 px-1.5 text-foreground">
                    {planCount}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            className="sheet-toggle hidden flex-[0_0_40px] text-ink-2 sheet:inline-flex"
            aria-label={sheetOpen ? "Hide panel" : "Show panel"}
            title={sheetOpen ? "Hide panel" : "Show panel"}
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(!sheetOpen)}
          >
            <ChevronLeftIcon className="size-4 transition-transform" />
          </Button>
        </nav>
        <TabsContent value="explore" className="tab-body text-base">
          <ExploreTab />
        </TabsContent>
        <TabsContent value="plan" className="tab-body text-base">
          <PlanTab />
        </TabsContent>
        <TabsContent value="layers" className="tab-body text-base">
          <LayersTab />
        </TabsContent>
      </Tabs>

      {/* The stage is the part of the map the side panel leaves visible. Floating pieces are laid out in it. */}
      <div className="stage">
        <div className="stage-top">
          {!sheetOpen && (
            <Button variant="glass" size="icon-xl" className="sheet:hidden" aria-label="Show sidebar" title="Show sidebar" aria-expanded={false} onClick={() => setSheetOpen(true)}>
              <SidebarIcon on={false} />
            </Button>
          )}
          <ConditionsBar />
          <span className="flex-1" />
          <ViewControls />
        </div>
        <div className="stage-mid">
          <MapLegend />
          <span className="flex-1" />
          <div className="card-slot">{poi ? <PoiCard poi={poi} /> : wp ? <WaypointCard /> : null}</div>
        </div>
        <div className="stage-bottom">
          <div className="stage-row">
            <HoverReadout />
            <span className="grow" />
            <MapSafety />
            <GoPanel />
          </div>
          <div className="dock" ref={dockRef}>
            {hasRoute && <ProfileStrip />}
          </div>
        </div>
      </div>
    </div>
  );
}
