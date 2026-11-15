import { useState } from "react";
import { useStore } from "../store";
import { getMap } from "../map/MapView";
import { POI_TYPE_LABEL } from "./Cards";
import type { Poi, PoiType } from "../types";

const ORDER: PoiType[] = ["drill-site", "science-target", "viewpoint", "start"];

export function flyTo(lon: number, lat: number, zoom = 17) {
  getMap()?.flyTo({ center: [lon, lat], zoom: Math.max(zoom, getMap()?.getZoom() ?? 0), duration: 900 });
}

/** The one-click demo walk: camp → Valle de la Luna → ridge junction → sand dig → back to camp. */
const DEMO = { start: "start-central", stops: ["valle-de-la-luna", "ridge-intersection", "sand-hollow-dig"] };

function runDemoWalk(pois: Poi[]) {
  const st = useStore.getState();
  const start = pois.find((p) => p.id === DEMO.start);
  const stops = DEMO.stops.map((id) => pois.find((p) => p.id === id)).filter((p): p is Poi => !!p);
  if (!start || stops.length !== DEMO.stops.length) return;
  st.set({ stops: [], selectedPoi: null, selectedWaypoint: null, mapClick: null, pickingStart: false, selectedProfile: "fastest", returnToStart: true });
  st.setStart({ lonLat: [start.lon, start.lat], name: start.name, poiId: start.id });
  for (const p of stops) st.addStop({ lonLat: [p.lon, p.lat], name: p.name, poiId: p.id });
  st.set({ tab: "plan" });
  const pts = [start, ...stops];
  const lons = pts.map((p) => p.lon);
  const lats = pts.map((p) => p.lat);
  const fit = () =>
    getMap()?.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 70, maxZoom: 18, duration: 900 },
    );
  fit();
  // The elevation profile appears once routes arrive and shrinks the map: fit again then.
  let done = false;
  const unsub = useStore.subscribe((s) => {
    if (done || s.planStatus !== "ready" || !s.results) return;
    done = true;
    unsub();
    setTimeout(() => {
      getMap()?.resize();
      fit();
    }, 100);
  });
  setTimeout(() => {
    if (!done) {
      done = true;
      unsub();
    }
  }, 30000);
}

export function ExploreTab() {
  const area = useStore((s) => s.area)!;
  const set = useStore((s) => s.set);
  const selected = useStore((s) => s.selectedPoi);
  const rover = area.rover;
  const sols = rover.waypoints.map((w) => w.sol).filter((x): x is number => x != null);
  const [more, setMore] = useState(false);
  const demoReady = DEMO.stops.every((id) => area.config.pois.some((p) => p.id === id)) && area.config.pois.some((p) => p.id === DEMO.start);
  const runDemo = () => runDemoWalk(area.config.pois);
  const pick = (p: Poi) => {
    set({ selectedPoi: p, selectedWaypoint: null, mapClick: null });
    flyTo(p.lon, p.lat);
  };
  return (
    <div className="tab-body">
      <section className="story">
        <h2>Ridge to hollow in one walk</h2>
        <p className="story-lead">
          Curiosity drilled here but couldn't dig under the sand or climb the ridges. A crew could do it all in one six-hour EVA.
        </p>
        {more && (
          <>
            <p>
              The boxwork is a web of low ridges left where ancient groundwater flowed through fractures and hardened the rock. Curiosity spent most of a
              year here and drilled three ~6 cm holes: clay in a ridge, carbonate in a hollow. Its wheels slipped in the sand-filled hollows, and the big
              questions stayed open.
            </p>
            <p>
              A crew can cross from ridge to hollow, sample ridge walls, dig under the sand and trace the network in a single six-hour EVA. Pick a start,
              add stops, and the planner checks the walk against time, energy and slope limits.
            </p>
          </>
        )}
        <button className="link-btn inline more-btn" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? "Less" : "More"}
        </button>
        <button className="btn primary demo-btn" onClick={demoReady ? runDemo : undefined} disabled={!demoReady}>
          <span className="demo-play">▶</span>
          <span>
            <b>Try the boxwork walk</b>
            <span className="demo-sub">Camp → hollow → ridge junction → sand dig</span>
          </span>
        </button>
        <button className="btn ghost-btn" onClick={() => set({ tab: "plan" })}>
          Plan an EVA →
        </button>
      </section>

      {ORDER.map((type) => {
        const list = area.config.pois.filter((p) => p.type === type);
        if (!list.length) return null;
        return (
          <section key={type}>
            <h4 className="section-h">{POI_TYPE_LABEL[type]}s</h4>
            <ul className="poi-list">
              {list.map((p) => (
                <li key={p.id} className={selected?.id === p.id ? "active" : ""} onClick={() => pick(p)} title={p.summary}>
                  <i className={`poi-dot-sm t-${p.type}`} />
                  <div>
                    <div className="poi-name">
                      {p.name}
                      {p.positionSource === "illustrative" && (
                        <span className="badge est tiny" title="Position is illustrative, not a surveyed target">
                          illustrative
                        </span>
                      )}
                    </div>
                    <div className="poi-sum">{p.summary}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section>
        <h4 className="section-h">Curiosity in this area</h4>
        <dl className="stats compact">
          <div>
            <dt>Waypoints</dt>
            <dd>{rover.waypoints.length}</dd>
          </div>
          {sols.length > 0 && (
            <div>
              <dt>Sols</dt>
              <dd>
                {Math.min(...sols)}–{Math.max(...sols)}
              </dd>
            </div>
          )}
          <div>
            <dt>Rover photos</dt>
            <dd>{rover.photos.length}</dd>
          </div>
          <div>
            <dt title="Drill sites from the rover data">Drill sites</dt>
            <dd>{rover.drillSites.map((d) => d.name).join(", ") || "—"}</dd>
          </div>
        </dl>
        <p className="small dim">Click a waypoint dot for its sol and photos.</p>
      </section>
    </div>
  );
}
