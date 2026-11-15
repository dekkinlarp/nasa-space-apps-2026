import { useEffect, useRef, useState } from "react";
import { useStore, type Tab } from "./store";
import { loadArea, pickArea } from "./data";
import { startEngine } from "./engine";
import { MapView, imageryGroup, setMapInsets } from "./map/MapView";
import { Chevron, SidebarIcon } from "./components/icons";
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

/** Keep in step with --panel-ms in styles.css. */
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
    <div className="gesture-hint">
      <button className="hint-btn" aria-expanded={open} aria-label="Map gestures" title="Map gestures" onClick={() => setOpen(!open)}>
        ?
      </button>
      {open && (
        <dl className="hint-pop" onClick={() => setOpen(false)}>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Top-right of the map: how the map is viewed. The vertical-scale slider appears beside it in 3D. */
function ViewControls() {
  const view3d = useStore((s) => s.view3d);
  const ex = useStore((s) => s.exaggeration);
  const set = useStore((s) => s.set);
  const hasElev = useStore((s) => !!s.area?.layers.elevation);
  return (
    <div className="view-ctl">
      {view3d && (
        <label className="exag glass">
          <span className="label">Vertical ×{ex}</span>
          <input type="range" min={1} max={10} step={0.5} value={ex} onChange={(e) => set({ exaggeration: Number(e.target.value) })} />
        </label>
      )}
      <div className="seg-ctl glass" role="group" aria-label="Map view">
        <button className={!view3d ? "active" : ""} aria-pressed={!view3d} onClick={() => set({ view3d: false })}>
          2D
        </button>
        <button className={view3d ? "active" : ""} aria-pressed={view3d} disabled={!hasElev} onClick={() => set({ view3d: true })}>
          3D
        </button>
      </div>
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
        const groups = a.manifest.imagery.map((i) => imageryGroup(i.id));
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
      <div className="splash">
        <h2>Could not load map data</h2>
        <p className="mono">{loadError}</p>
        <p className="dim">Is the server running on :8787? Start everything with <span className="mono">pnpm dev</span>.</p>
      </div>
    );
  if (!area)
    return (
      <div className="splash">
        <div className="spinner big" />
        <p>Loading Gale Crater…</p>
      </div>
    );

  return (
    <div className={`app ${sheetOpen ? "sheet-open" : "sheet-closed"}`}>
      {/* The map is the whole window; everything else floats over it. */}
      <div className="map-layer">
        <Starfield />
        <MapView />
        <GoWalker />
        <div className="map-credit">{area.manifest.imagery.find((i) => imageryGroup(i.id) === baseImagery)?.source ?? ""}</div>
      </div>

      <aside className="side glass" ref={sideRef}>
        <SiteHeader onCollapse={() => setSheetOpen(false)} />
        <nav className="tabs" aria-label="Sections">
          <div className="tab-seg">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "active" : ""}
                aria-pressed={tab === t.id}
                onClick={() => {
                  // On the bottom sheet, tapping the open tab again folds it; any other tap opens it.
                  setSheetOpen(tab === t.id && narrowScreen() ? !sheetOpen : true);
                  set({ tab: t.id });
                }}
              >
                {t.label}
                {t.id === "plan" && planCount > 0 && <span className="count">{planCount}</span>}
              </button>
            ))}
          </div>
          <button className="sheet-toggle" aria-label={sheetOpen ? "Hide panel" : "Show panel"} title={sheetOpen ? "Hide panel" : "Show panel"} aria-expanded={sheetOpen} onClick={() => setSheetOpen(!sheetOpen)}>
            <Chevron />
          </button>
        </nav>
        {tab === "explore" && <ExploreTab />}
        {tab === "plan" && <PlanTab />}
        {tab === "layers" && <LayersTab />}
      </aside>

      {/* The stage is the part of the map the side panel leaves visible. Floating pieces are laid out in it. */}
      <div className="stage">
        <div className="stage-top">
          {!sheetOpen && (
            <button className="hint-btn glass panel-open" aria-label="Show sidebar" title="Show sidebar" aria-expanded={false} onClick={() => setSheetOpen(true)}>
              <SidebarIcon on={false} />
            </button>
          )}
          <ConditionsBar />
          <span className="grow" />
          <ViewControls />
        </div>
        <div className="stage-mid">
          <MapLegend />
          <span className="grow" />
          <div className="card-slot">{poi ? <PoiCard poi={poi} /> : wp ? <WaypointCard /> : null}</div>
        </div>
        <div className="stage-bottom">
          <div className="stage-row">
            <HoverReadout />
            <span className="grow" />
            <MapSafety />
            <GoPanel />
          </div>
          <div className="dock" ref={dockRef}>{hasRoute && <ProfileStrip />}</div>
        </div>
      </div>
    </div>
  );
}
