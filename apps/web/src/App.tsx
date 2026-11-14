import { useEffect } from "react";
import { useStore, type Tab } from "./store";
import { loadArea, pickArea } from "./data";
import { startEngine } from "./engine";
import { MapView, imageryGroup } from "./map/MapView";
import { TopBar } from "./components/TopBar";
import { ExploreTab } from "./components/ExploreTab";
import { PlanTab } from "./components/PlanTab";
import { LayersTab } from "./components/LayersTab";
import { HoverReadout } from "./components/HoverReadout";
import { PoiCard, WaypointCard } from "./components/Cards";
import { ProfileStrip } from "./components/ProfileStrip";
import { GoPanel } from "./components/GoPanel";

let loadStarted = false;

const TABS: { id: Tab; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "plan", label: "Plan" },
  { id: "layers", label: "Layers" },
];

function ViewControls() {
  const view3d = useStore((s) => s.view3d);
  const ex = useStore((s) => s.exaggeration);
  const set = useStore((s) => s.set);
  const hasElev = useStore((s) => !!s.area?.layers.elevation);
  return (
    <div className="view-ctl">
      <div className="seg-ctl">
        <button className={!view3d ? "active" : ""} onClick={() => set({ view3d: false })}>
          2D
        </button>
        <button className={view3d ? "active" : ""} disabled={!hasElev} onClick={() => set({ view3d: true })}>
          3D
        </button>
      </div>
      {view3d && (
        <label className="exag">
          <span>Vertical ×{ex}</span>
          <input type="range" min={1} max={10} step={0.5} value={ex} onChange={(e) => set({ exaggeration: Number(e.target.value) })} />
        </label>
      )}
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
    <div className="app">
      <TopBar />
      <div className="main">
        <aside className="side">
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => set({ tab: t.id })}>
                {t.label}
                {t.id === "plan" && planCount > 0 && <span className="count">{planCount}</span>}
              </button>
            ))}
          </nav>
          {tab === "explore" && <ExploreTab />}
          {tab === "plan" && <PlanTab />}
          {tab === "layers" && <LayersTab />}
        </aside>
        <section className="mapwrap">
          <div className="map-area">
            <MapView />
            <ViewControls />
            <HoverReadout />
            <div className="card-slot">{poi ? <PoiCard poi={poi} /> : wp ? <WaypointCard /> : null}</div>
            <GoPanel />
            <div className="map-credit">
              {area.manifest.imagery.find((i) => imageryGroup(i.id) === baseImagery)?.source ?? ""}
            </div>
          </div>
          {hasRoute && <ProfileStrip />}
        </section>
      </div>
    </div>
  );
}
