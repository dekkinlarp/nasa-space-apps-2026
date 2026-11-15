import { useState } from "react";
import { useStore } from "../store";
import { getMap } from "../map/MapView";
import { POI_DOT, POI_TYPE_LABEL, PriorityTag } from "./Cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { Stat, StatGrid } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
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
    <>
      <section>
        <h2 className="m-0 mb-2 text-xl font-normal tracking-[-0.02em]">Ridge to hollow in one walk</h2>
        <p className="m-0 mb-1.5 text-ink-2">Curiosity drilled here but couldn't dig under the sand or climb the ridges. A crew could do it all in one six-hour EVA.</p>
        {more && (
          <>
            <p className="m-0 mb-3 text-ink-2">
              The boxwork is a web of low ridges left where ancient groundwater flowed through fractures and hardened the rock. Curiosity spent most of a
              year here and drilled three ~6 cm holes: clay in a ridge, carbonate in a hollow. Its wheels slipped in the sand-filled hollows, and the big
              questions stayed open.
            </p>
            <p className="m-0 mb-3 text-ink-2">
              A crew can cross from ridge to hollow, sample ridge walls, dig under the sand and trace the network in a single six-hour EVA. Pick a start,
              add stops, and the planner checks the walk against time, energy, oxygen and slope limits.
            </p>
          </>
        )}
        <Button variant="link" size="inline" className="mb-3 flex text-2xs" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? "Less" : "More"}
        </Button>
        {/* The demo walk is the one coloured action in the panel. */}
        <Button
          className="h-auto w-full justify-start gap-2.5 rounded-xl bg-linear-135 from-[#d4521a] to-mars-deep px-3 py-2.5 text-left text-white shadow-[0_4px_18px_rgba(255,122,47,0.25)] hover:from-[#e5602a] hover:to-[#d4521a] hover:bg-transparent"
          onClick={demoReady ? runDemo : undefined}
          disabled={!demoReady}
        >
          <span className="grid size-[30px] flex-none place-items-center rounded-full bg-white/16 pl-0.5 text-sm">▶</span>
          <span className="min-w-0">
            <b className="block text-[14px] tracking-[0.01em]">Try the boxwork walk</b>
            <span className="block truncate text-2xs font-medium text-white/78">Camp → hollow → ridge junction → sand dig</span>
          </span>
        </Button>
        <Button variant="secondary" className="mt-2 h-9 w-full bg-transparent" onClick={() => set({ tab: "plan" })}>
          Plan an EVA →
        </Button>
      </section>

      {ORDER.map((type) => {
        const list = area.config.pois.filter((p) => p.type === type);
        if (!list.length) return null;
        return (
          <section key={type}>
            <SectionHeading className="mt-[22px]">{POI_TYPE_LABEL[type]}s</SectionHeading>
            <ul className="-mx-2 list-none p-0">
              {list.map((p) => (
                <li
                  key={p.id}
                  className={cn(
                    "flex cursor-pointer gap-2.5 rounded-lg p-2 transition-colors coarse:py-[11px] hover:bg-white/5",
                    selected?.id === p.id && "bg-white/11 hover:bg-white/11",
                  )}
                  onClick={() => pick(p)}
                  title={p.summary}
                >
                  <i className={cn("mt-1.5 size-2 flex-none rounded-full", POI_DOT[p.type], p.type === "start" && "rounded-[1px]")} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium">
                      {p.name}
                      <PriorityTag poi={p} tiny />
                      {p.positionSource === "illustrative" && (
                        <Badge variant="estimate" title="Position is illustrative, not a surveyed target">
                          illustrative
                        </Badge>
                      )}
                    </div>
                    <div className="line-clamp-1 text-sm text-muted-foreground">{p.summary}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section>
        <SectionHeading>Curiosity in this area</SectionHeading>
        <StatGrid className="gap-y-1.5">
          <Stat label="Waypoints">{rover.waypoints.length}</Stat>
          {sols.length > 0 && (
            <Stat label="Sols">
              {Math.min(...sols)}–{Math.max(...sols)}
            </Stat>
          )}
          <Stat label="Rover photos">{rover.photos.length}</Stat>
          <Stat label="Drill sites" labelTitle="Drill sites from the rover data">
            {rover.drillSites.map((d) => d.name).join(", ") || "—"}
          </Stat>
        </StatGrid>
        <p className="my-3 text-sm text-muted-foreground">Click a waypoint dot for its sol and photos.</p>
      </section>
    </>
  );
}
