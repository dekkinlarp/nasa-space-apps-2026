import { useEffect, useRef, useState } from "react";
import { useStore, type Tab } from "./store";
import { loadArea, pickArea } from "./data";
import { startEngine } from "./engine";
import { getMap, MapView, setMapInsets } from "./map/MapView";
import { pictureGroup } from "./map/imageryTiles";
import { CircleHelpIcon, SlidersHorizontalIcon } from "lucide-react";
import { SidebarIcon } from "./components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel, panelVariants } from "@/components/ui/panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { SlidingThumb } from "@/components/ui/sliding-thumb";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Starfield } from "./map/Starfield";
import { cn } from "@/lib/utils";
import { SiteHeader } from "./components/SiteHeader";
import { ExploreTab } from "./components/ExploreTab";
import { PlanFooter, PlanTab } from "./components/PlanTab";
import { LayersTab } from "./components/LayersTab";
import { HoverReadout } from "./components/HoverReadout";
import { PoiCard, WaypointCard } from "./components/Cards";
import { ProfileStrip } from "./components/ProfileStrip";
import { GoPanel } from "./components/GoPanel";
import { GoWalker } from "./components/GoWalker";
import { MapSafety } from "./components/MapSafety";
import { StatusBar } from "./components/StatusBar";

let loadStarted = false;

const TABS: { id: Tab; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "plan", label: "Plan" },
  { id: "layers", label: "Layers" },
];

/** Keep in step with --panel-ms in index.css. */
export const PANEL_MS = 380;

/**
 * The shell is a full-window map with floating chrome. Three custom properties carry the panel state to
 * everything that has to clear it (the stage, the map controls, the image credit):
 * --stage-left is where the stage starts, --sheet-h the height of the bottom sheet, and --dock the height
 * of the elevation profile while it is open, which the root reads off its own descendants with has-[…].
 */
const SHELL =
  "app relative h-full overflow-hidden [--dock:0px] has-[.profile:not(.collapsed)]:[--dock:calc(150px+var(--gap))] sheet:[--stage-left:max(var(--gap),env(safe-area-inset-left))]";
/** Phones and short landscape screens give the profile's room to the open sheet. */
const SHELL_OPEN =
  "sheet-open [--sheet-h:0px] [--stage-left:calc(var(--side-w)+var(--gap)*2)] sheet:[--sheet-h:46dvh] phone:[--dock:0px]! phone:[--sheet-h:50dvh] squat:[--dock:0px]! squat:[--sheet-h:56dvh]";
/** Folded, the sheet is its grabber, tab bar and status bar. */
const SHELL_CLOSED = "sheet-closed [--sheet-h:0px] [--stage-left:var(--gap)] sheet:[--sheet-h:calc(var(--sheet-peek)+var(--foot))]";
/** Pulled all the way up, the sheet leaves a strip of map at the top; the floating controls step aside. */
const SHELL_FULL = "sheet-full sheet:[--sheet-h:calc(100dvh-64px)]!";
/** Height of the status bar. On the bottom-sheet layout it is the sheet's last row, so the folded sheet is this much taller. Keep in step with --status-h in index.css. */
const STATUS_H = 28;
/** Height of the folded sheet. Touch screens get taller tabs, so a taller fold. Keep in step with --sheet-peek in index.css. */
const sheetPeek = () => (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 84 : 76);

/** The side panel leaves and returns by the left edge; under 860 px it is a bottom sheet that folds to its tab bar.
    It does not clip its overflow: in Chrome a rounded overflow clip stops the masks on the edge blur's layers
    from applying, and each strip then renders as one solid frosted block. Nothing in it needs the clip.
    The sheet keeps the same gap from the left and right edges as the other panels and sits flush on the bottom edge; the status bar is its last row. */
const SIDE =
  panelVariants({ size: "thick" }) +
  " glass-host absolute! top-[max(var(--gap),env(safe-area-inset-top))] bottom-(--gap) left-[max(var(--gap),env(safe-area-inset-left))] z-3 min-h-0 w-(--side-w) gap-0 [transition:translate_var(--panel-ms)_var(--spring),visibility_0s] sheet:top-auto sheet:right-[max(var(--gap),env(safe-area-inset-right))] sheet:bottom-0 sheet:h-(--sheet-h) sheet:w-auto sheet:rounded-t-3xl sheet:rounded-b-none sheet:border-b-0 sheet:[transition:height_var(--panel-ms)_var(--spring)]";
const SIDE_CLOSED = "wide:invisible wide:-translate-x-[calc(100%+var(--gap)*2)] wide:[transition:translate_var(--panel-ms)_var(--spring),visibility_0s_linear_var(--panel-ms)]";

/** The Plan tab is a scrolling body over a footer that stays put: the tab itself does not scroll. */
const TAB_SPLIT = "flex min-h-0 flex-col sheet:in-[.sheet-closed]:hidden";

const TAB_BODY =
  "tab-body scrollbar-thin overflow-y-auto px-4 pt-4 pb-10 text-base sheet:touch-pan-y sheet:overscroll-contain sheet:pt-3 sheet:pr-[max(var(--gutter),env(safe-area-inset-right))] sheet:pb-7 sheet:pl-[max(var(--gutter),env(safe-area-inset-left))] sheet:in-[.sheet-closed]:hidden";

/** Whether a media query matches, kept current as the window changes. */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

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
      <PopoverTrigger render={<Button variant="glass" size="icon-xl" className="text-foreground" aria-label="Map gestures" title="Map gestures" />}>
        <CircleHelpIcon className="size-[18px]" aria-hidden />
      </PopoverTrigger>
      <PopoverContent surface="glass" side="top" align="end" sideOffset={8} className="w-max max-w-[min(380px,calc(100vw-24px))] px-4 py-3">
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

/**
 * The bottom sheet's handle, as on a phone's maps app: drag it up or down to move between the sheet's
 * three heights, or tap it to step up (and back down from full). The sheet follows the finger while dragging.
 */
function SheetGrabber({ open, full, onGrow, onShrink, sheet }: { open: boolean; full: boolean; onGrow: () => void; onShrink: () => void; sheet: React.RefObject<HTMLElement | null> }) {
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const release = () => {
    const el = sheet.current;
    if (!el) return;
    el.style.height = "";
    el.style.transition = "";
  };
  return (
    <button
      type="button"
      className="hidden h-5 w-full flex-none cursor-grab touch-none items-end justify-center outline-offset-[-2px] sheet:flex active:cursor-grabbing"
      aria-label={!open ? "Open the panel" : full ? "Shrink the panel" : "Expand the panel"}
      aria-expanded={open}
      onPointerDown={(e) => {
        const el = sheet.current;
        if (!el) return;
        drag.current = { y: e.clientY, h: el.getBoundingClientRect().height, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current, el = sheet.current;
        if (!d || !el) return;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dy) < 6) return;
        d.moved = true;
        el.style.transition = "none";
        el.style.height = `${Math.max(sheetPeek() + STATUS_H, Math.min(window.innerHeight - 64, d.h - dy))}px`;
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        release();
        const dy = e.clientY - d.y;
        // A drag of a few dozen pixels moves one height in its direction; a tap is handled by onClick.
        if (d.moved && Math.abs(dy) > 32) (dy < 0 ? onGrow : onShrink)();
        if (d.moved) e.currentTarget.dataset.dragged = "1";
      }}
      onPointerCancel={() => {
        drag.current = null;
        release();
      }}
      onClick={(e) => {
        if (e.currentTarget.dataset.dragged) return void delete e.currentTarget.dataset.dragged;
        (full ? onShrink : onGrow)();
      }}
    >
      <span className="h-[5px] w-9 rounded-full bg-white/28" aria-hidden />
    </button>
  );
}

/** 3D draw distance choices: side of the square of ground drawn around where the camera looks when close to the ground, km (it grows as the camera pulls back). */
const RENDER_DISTANCES = [2, 4, 8, 16].map((km) => ({ value: String(km), label: `${km} × ${km} km` }));

/**
 * The 3D settings: vertical exaggeration and how much ground is drawn. They are set rarely, so they wait
 * behind a button beside the 2D/3D switch instead of holding a bar of their own.
 */
function View3dSettings() {
  const ex = useStore((s) => s.exaggeration);
  const renderKm = useStore((s) => s.renderDistanceKm);
  const set = useStore((s) => s.set);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="glass" size="icon-xl" className="text-foreground" aria-label="3D settings" title="3D settings" />}>
        <SlidersHorizontalIcon className="size-[18px]" aria-hidden />
      </PopoverTrigger>
      <PopoverContent surface="glass" side="top" align="end" sideOffset={8} className="w-[264px] max-w-[calc(100vw-24px)] gap-3 px-4 py-3 text-sm">
        <label className="grid gap-2">
          <span className="flex justify-between">
            Vertical exaggeration <span className="text-muted-foreground">×{ex}</span>
          </span>
          <Slider aria-label="Vertical exaggeration" min={1} max={10} step={0.5} value={[ex]} onValueChange={(v) => set({ exaggeration: Array.isArray(v) ? v[0]! : v })} />
        </label>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span>Draw distance</span>
            <Select items={RENDER_DISTANCES} value={String(renderKm)} onValueChange={(v) => v && set({ renderDistanceKm: Number(v) })}>
              <SelectTrigger aria-label="3D draw distance" size="sm" className="w-[104px]">
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
          </div>
          <p className="m-0 text-xs text-muted-foreground">How much ground is drawn in 3D, centred on where you are looking. Smaller is faster on slow devices.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Bottom-right of the map: how the map is viewed. In 3D a settings button joins the switch. */
function ViewControls() {
  const view3d = useStore((s) => s.view3d);
  const set = useStore((s) => s.set);
  const hasElev = useStore((s) => !!s.area?.overview.elevation);
  return (
    <div className="pointer-events-auto flex flex-none items-center gap-2 sheet:basis-full sheet:justify-end">
      {view3d && <View3dSettings />}
      {/* The switch floats on the map, so it sits in a panel: a 12px surface with 4px of padding around 8px segments. */}
      <Panel className="view-ctl flex h-11 flex-none p-1">
        <Segmented
          aria-label="Map view"
          value={view3d ? "3d" : "2d"}
          onValueChange={(v) => set({ view3d: v === "3d" })}
          options={[
            { value: "2d", label: "2D" },
            { value: "3d", label: "3D", disabled: !hasElev },
          ]}
          className="h-full border-0 bg-transparent p-0"
          itemClassName="h-full rounded-lg px-4 text-base coarse:h-full"
        />
      </Panel>
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
  // The bottom sheet rests at three heights: folded to its tab bar, half, and full.
  const [sheetFull, setSheetFull] = useState(false);
  const foldSheet = () => {
    setSheetFull(false);
    setSheetOpen(false);
  };
  const growSheet = () => (sheetOpen ? setSheetFull(true) : setSheetOpen(true));
  const shrinkSheet = () => (sheetFull ? setSheetFull(false) : foldSheet());
  // The bottom-sheet layout, as state: the status bar is rendered in a different place on it.
  const narrow = useMediaQuery("(max-width: 860px)");
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
      // The dock is the open elevation profile and, on wide screens, the status bar under it.
      const dockPx = dock?.getBoundingClientRect().height ?? 0;
      const dockH = dockPx > 0 ? dockPx + 12 : 0;
      if (narrowScreen()) setMapInsets({ top: 56, bottom: (sheetOpen ? s.height : sheetPeek() + STATUS_H) + dockH }, ms);
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

  // A card opens at the right of the map (the top, on phones). If the place it describes is underneath,
  // slide the map just far enough to bring it out, by whichever way is shorter.
  useEffect(() => {
    const ll = poi ? ([poi.lon, poi.lat] as [number, number]) : wp ? (wp.lonLat as [number, number]) : null;
    if (!ll) return;
    const raf = requestAnimationFrame(() => {
      const map = getMap();
      const card = document.querySelector(".card-slot > *");
      if (!map || !card || map.isMoving()) return;
      const c = card.getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
      const p = map.project(ll);
      const x = p.x + m.left, y = p.y + m.top, pad = 28;
      if (x < c.left - pad || x > c.right + pad || y < c.top - pad || y > c.bottom + pad) return;
      const dx = x - (c.left - pad), dy = c.bottom + pad - y;
      const stage = card.parentElement!.parentElement!.getBoundingClientRect();
      const roomBelow = stage.bottom - c.bottom > 60;
      map.panBy(roomBelow && dy < dx ? [0, -dy] : [dx, 0], { duration: 500 });
    });
    return () => cancelAnimationFrame(raf);
  }, [poi, wp]);

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
      <div className="grid h-full place-content-center justify-items-center gap-2 p-4 text-center text-ink-2">
        <h2 className="m-0 text-lg text-foreground">The map did not load</h2>
        <p className="m-0 max-w-[44ch]">The map data could not be fetched. Check your connection and try again.</p>
        <Button className="mt-2" onClick={() => location.reload()}>
          Reload
        </Button>
        {/* The cause, for whoever is running the project locally. */}
        {import.meta.env.DEV && <p className="m-0 mt-3 max-w-[60ch] font-mono text-xs text-muted-foreground">{loadError}</p>}
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
    <div className={cn(SHELL, sheetOpen ? SHELL_OPEN : SHELL_CLOSED, sheetOpen && sheetFull && SHELL_FULL)}>
      {/* The map is the whole window; everything else floats over it. */}
      {/* isolate: a raised marker (hovered, selected) stacks among the markers, never above the panels. */}
      <div className="absolute inset-0 isolate bg-background">
        <Starfield />
        <MapView />
        <GoWalker />
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => set({ tab: v as Tab })}
        render={<aside ref={sideRef} />}
        className={cn(SIDE, !sheetOpen && SIDE_CLOSED)}
      >
        {/* The glass, as a layer behind the content (see glass-host in index.css). */}
        <i className="glass-layer-thick sheet:bottom-0 sheet:border-b-0" aria-hidden />
        <SheetGrabber open={sheetOpen} full={sheetFull} onGrow={growSheet} onShrink={shrinkSheet} sheet={sideRef} />
        <SiteHeader onCollapse={() => setSheetOpen(false)} />
        <nav
          className="tabs flex flex-none gap-2 border-b px-4 pb-3 sheet:pt-2.5 sheet:pr-[max(var(--gutter),env(safe-area-inset-right))] sheet:pl-[max(var(--gutter),env(safe-area-inset-left))] sheet:in-[.sheet-closed]:border-b-0"
          aria-label="Sections"
        >
          <TabsList className="relative flex-1 gap-0.5 rounded-lg bg-white/6 p-0.5 group-data-horizontal/tabs:h-auto">
            <SlidingThumb className="bg-white/16" />
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                // On the bottom sheet, tapping the open tab again folds it; any other tap opens it.
                onClick={() => (tab === t.id && narrowScreen() && sheetOpen ? foldSheet() : setSheetOpen(true))}
                // The fill behind the open tab is the sliding thumb.
                className="h-[30px] rounded-md text-sm text-ink-2 transition-colors coarse:h-[38px] data-active:border-transparent data-active:bg-transparent data-active:text-foreground data-active:shadow-none"
              >
                {t.label}
                {t.id === "plan" && planCount > 0 && (
                  <Badge className="ml-1 text-foreground" aria-label={`${planCount} ${planCount === 1 ? "stop" : "stops"}`}>
                    {planCount}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
        <TabsContent value="explore" className={TAB_BODY}>
          <ExploreTab />
        </TabsContent>
        <TabsContent value="plan" className={TAB_SPLIT}>
          <div className={cn(TAB_BODY, "min-h-0 flex-1 pb-5 sheet:pb-4")}>
            <PlanTab />
          </div>
          <PlanFooter />
        </TabsContent>
        <TabsContent value="layers" className={TAB_BODY}>
          <LayersTab />
        </TabsContent>
        {narrow && <StatusBar inSheet />}
      </Tabs>

      {/* The stage is the part of the map the side panel leaves visible. Floating pieces are laid out in it. */}
      <div className="pointer-events-none absolute top-[max(var(--gap),env(safe-area-inset-top))] right-[max(var(--gap),env(safe-area-inset-right))] bottom-[calc(var(--sheet-h)+var(--gap))] left-(--stage-left) z-2 flex min-h-0 flex-col gap-(--gap) transition-[left] duration-(--panel-ms) ease-spring sheet:transition-[bottom] sheet:in-[.sheet-full]:hidden">
        {/* Top-left: the button that brings back a hidden side panel, and the prompt shown while placing the start.
            Cards sit at the right; on the bottom-sheet layout they move left, clear of the zoom buttons. */}
        <div className="flex min-h-0 flex-1 items-start justify-end gap-2 sheet:relative sheet:justify-start">
          {!sheetOpen && (
            <Button variant="glass" size="icon-lg" className="pointer-events-auto flex-none rounded-xl coarse:size-11 sheet:hidden" aria-label="Show sidebar" title="Show sidebar" aria-expanded={false} onClick={() => setSheetOpen(true)}>
              <SidebarIcon on={false} />
            </Button>
          )}
          <HoverReadout />
          <span className="flex-1 sheet:hidden" />
          <div className="card-slot relative z-5 flex max-h-[calc(100%-144px)] w-[340px] max-w-full flex-col mr-12 compact:w-[300px] coarse:mr-14 sheet:mr-0 sheet:max-h-full phone:mr-12 phone:max-h-[62%] phone:w-auto phone:flex-1 sheet:in-[.app:has(.go-panel)]:hidden">{poi ? <PoiCard poi={poi} /> : wp ? <WaypointCard /> : null}</div>
        </div>
        <div className="flex min-w-0 flex-none flex-col gap-(--gap)">
          {/* The verdict or suit meter and the Go panel, with the view controls at the right end. On the bottom-sheet layout the view controls take a line of their own, above. */}
          <div className="flex min-w-0 items-end gap-2 sheet:flex-wrap-reverse sheet:gap-y-0">
            <span className="grow" />
            <MapSafety planVisible={sheetOpen && tab === "plan"} />
            <GoPanel />
            <ViewControls />
          </div>
          {/* The foot of the map: the elevation profile when it is open, then the status bar, which carries its toggle.
              On the bottom-sheet layout the status bar is the sheet's last row instead, and this holds the profile alone. */}
          <div className="flex min-w-0 flex-col empty:hidden sheet:has-[.profile.collapsed]:hidden" ref={dockRef}>
            {hasRoute && <ProfileStrip />}
            {!narrow && <StatusBar />}
          </div>
        </div>
      </div>
    </div>
  );
}
