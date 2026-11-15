import { useState } from "react";
import { ArrowRightIcon, PlayIcon } from "lucide-react";
import { useStore } from "../store";
import { getMap } from "../map/MapView";
import { POI_DOT, POI_TYPE_LABEL, PriorityTag } from "./Cards";
import { SiteFacts } from "./SiteHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/utils";
import type { Poi, PoiType } from "../types";

const ORDER: PoiType[] = ["drill-site", "science-target", "viewpoint", "start"];
/** Within a group, the walk's primary objectives come first. */
const PRIORITY_RANK: Record<string, number> = { primary: 0, secondary: 1, optional: 2 };
const rank = (p: Poi) => PRIORITY_RANK[p.priority ?? ""] ?? 3;

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
  // The demo replaces the plan. With stops of your own in it, the button asks first.
  const planned = useStore((s) => s.stops);
  const ownPlan = planned.length > 0 && planned.map((s) => s.poiId).join() !== DEMO.stops.join();
  const [confirming, setConfirming] = useState(false);
  const demoReady = DEMO.stops.every((id) => area.config.pois.some((p) => p.id === id)) && area.config.pois.some((p) => p.id === DEMO.start);
  const runDemo = () => runDemoWalk(area.config.pois);
  const pick = (p: Poi) => {
    set({ selectedPoi: p, selectedWaypoint: null, mapClick: null });
    flyTo(p.lon, p.lat);
  };
  return (
    <>
      {/* Site facts open the tab: where this is, how big, and the conditions a walk plans around. */}
      <SiteFacts className="mb-4" />
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
        <Button variant="link" size="inline" className="mb-3 flex text-xs" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? "Less" : "More"}
        </Button>
        {/* The demo walk is the one coloured action in the panel. */}
        <Button
          className="h-auto w-full justify-start gap-2.5 rounded-xl bg-mars-deep px-3 py-2.5 text-left text-white hover:bg-[#d4521a]"
          onClick={demoReady ? () => (ownPlan ? setConfirming(true) : runDemo()) : undefined}
          disabled={!demoReady}
        >
          <PlayIcon className="size-4 flex-none fill-current" aria-hidden />
          <span className="min-w-0">
            <b className="block text-base">Try the boxwork walk</b>
            <span className="block truncate text-xs font-medium text-white">Camp → hollow → ridge junction → sand dig</span>
          </span>
        </Button>
        {confirming && ownPlan && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Replace your plan?">
            <span className="mr-auto text-ink-2">
              This replaces your {planned.length} {planned.length === 1 ? "stop" : "stops"}.
            </span>
            <Button
              size="sm"
              onClick={() => {
                setConfirming(false);
                runDemo();
              }}
            >
              Replace plan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep mine
            </Button>
          </div>
        )}
        <Button variant="secondary" className="mt-2 h-9 w-full bg-transparent" onClick={() => set({ tab: "plan" })}>
          Plan an EVA <ArrowRightIcon aria-hidden />
        </Button>
      </section>

      {ORDER.map((type) => {
        const list = area.config.pois.filter((p) => p.type === type).sort((a, b) => rank(a) - rank(b));
        if (!list.length) return null;
        return (
          <section key={type}>
            <SectionHeading className="mt-[22px]">{POI_TYPE_LABEL[type]}s</SectionHeading>
            <ul className="-mx-2 list-none p-0">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={selected?.id === p.id}
                    className={cn(
                      "flex w-full cursor-pointer gap-2.5 rounded-lg p-2 text-left transition-colors coarse:py-[11px] hover:bg-white/5",
                      selected?.id === p.id && "bg-white/11 hover:bg-white/11",
                    )}
                    onClick={() => pick(p)}
                  >
                    <i className={cn("mt-1.5 size-2 flex-none rounded-full", POI_DOT[p.type], p.type === "start" && "rounded-[1px]")} />
                    <span className="block min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-medium">
                        {p.name}
                        <PriorityTag poi={p} tiny />
                        {p.positionSource === "illustrative" && (
                          <Badge variant="estimate" title="Position is illustrative, not a surveyed target">
                            illustrative
                          </Badge>
                        )}
                      </span>
                      <span className="line-clamp-1 text-sm text-muted-foreground">{p.summary}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section>
        <SectionHeading>Curiosity in this area</SectionHeading>
        <p className="mt-0 mb-3 text-sm text-ink-2">
          {rover.waypoints.length} waypoints and {rover.photos.length} photos
          {sols.length > 0 && ` from sols ${Math.min(...sols)}–${Math.max(...sols)}`}
          {rover.drillSites.length > 0 && `, with drill holes at ${rover.drillSites.map((d) => d.name).join(", ")}`}. Click a waypoint dot on the map for its sol and photos.
        </p>
      </section>
    </>
  );
}
