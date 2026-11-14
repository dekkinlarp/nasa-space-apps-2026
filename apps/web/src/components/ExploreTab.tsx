import { useStore } from "../store";
import { getMap } from "../map/MapView";
import { POI_TYPE_LABEL, PriorityTag } from "./Cards";
import type { Poi, PoiType } from "../types";

const ORDER: PoiType[] = ["drill-site", "science-target", "viewpoint", "start"];

export function flyTo(lon: number, lat: number, zoom = 17) {
  getMap()?.flyTo({ center: [lon, lat], zoom: Math.max(zoom, getMap()?.getZoom() ?? 0), duration: 900 });
}

export function ExploreTab() {
  const area = useStore((s) => s.area)!;
  const set = useStore((s) => s.set);
  const selected = useStore((s) => s.selectedPoi);
  const rover = area.rover;
  const sols = rover.waypoints.map((w) => w.sol).filter((x): x is number => x != null);
  const pick = (p: Poi) => {
    set({ selectedPoi: p, selectedWaypoint: null, mapClick: null });
    flyTo(p.lon, p.lat);
  };
  return (
    <div className="tab-body">
      <section className="story">
        <h2>Ridge to hollow in one walk</h2>
        <p>
          The boxwork is a web of low ridges left where ancient groundwater flowed through fractures and hardened the rock. Curiosity spent most of a year
          here and drilled three ~6 cm holes: clay in a ridge, carbonate in a hollow. Its wheels slipped in the sand-filled hollows, and the big questions
          stayed open.
        </p>
        <p>
          A crew can cross from ridge to hollow, sample ridge walls, dig under the sand and trace the network in a single six-hour EVA. Pick a start, add
          stops, and the planner checks the walk against time, energy, oxygen and slope limits.
        </p>
        <button className="btn primary" onClick={() => set({ tab: "plan" })}>
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
                <li key={p.id} className={selected?.id === p.id ? "active" : ""} onClick={() => pick(p)}>
                  <i className={`poi-dot-sm t-${p.type}`} />
                  <div>
                    <div className="poi-name">
                      {p.name}
                      <PriorityTag poi={p} tiny />
                      {p.positionSource === "illustrative" && <span className="badge est tiny">illustrative</span>}
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
            <dt>Drill sites (rover data)</dt>
            <dd>{rover.drillSites.map((d) => d.name).join(", ") || "—"}</dd>
          </div>
        </dl>
        <p className="small dim">Click a white waypoint dot on the rover track for its sol, tilt and photos.</p>
      </section>
    </div>
  );
}
