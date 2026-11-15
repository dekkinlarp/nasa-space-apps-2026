import { Fragment, useMemo, useState } from "react";
import { ArrowRightIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import { useStore } from "../store";
import { getMap, showOnMap } from "../map/MapView";
import { tintable } from "../map/imageryTiles";
import { basePreview, previewFrame } from "../map/layerPreviews";
import { STOP_BADGE, STOP_BADGE_NUMBER, STOP_BADGE_START } from "../map/mapLabel";
import { useUrls } from "./usePreviewUrls";
import { POI_DOT, POI_TYPE_LABEL, PriorityTag } from "./Cards";
import { FACT_TILE, SiteFacts } from "./SiteHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeading, SectionHeadingAside } from "@/components/ui/section-heading";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import type { AreaData, Poi, PoiType } from "../types";

const ORDER: PoiType[] = ["drill-site", "science-target", "viewpoint", "start"];
/** Within a group, the walk's primary objectives come first. */
const PRIORITY_RANK: Record<string, number> = { primary: 0, secondary: 1, optional: 2 };
const rank = (p: Poi) => PRIORITY_RANK[p.priority ?? ""] ?? 3;

export function flyTo(lon: number, lat: number, zoom = 17) {
  showOnMap({ center: [lon, lat], zoom: Math.max(zoom, getMap()?.getZoom() ?? 0) });
}

/** The one-click demo walk: camp → Valle de la Luna → ridge junction → sand dig → back to camp. */
const DEMO = { start: "start-central", stops: ["valle-de-la-luna", "ridge-intersection", "sand-hollow-dig"] };
/** The demo walk's points in a word or two each, for the stepper on the Explore tab. */
const DEMO_STEPS = ["Camp", "Hollow", "Ridge junction", "Sand dig"];

export function runDemoWalk(pois: Poi[]) {
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
    showOnMap({
      bounds: [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      padding: 70,
      maxZoom: 18,
    });
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

/** True when this dataset has every place the demo walk visits. */
export const demoAvailable = (pois: Poi[]) => [DEMO.start, ...DEMO.stops].every((id) => pois.some((p) => p.id === id));
/** True when the plan holds stops that are not the demo's, so loading the demo would throw work away. */
export const hasOwnPlan = (stops: { poiId?: string }[]) => stops.length > 0 && stops.map((s) => s.poiId).join() !== DEMO.stops.join();

/** Side of the ground a place's thumbnail shows, m. */
const PLACE_PREVIEW_M = 400;

/** A picture of the ground at each place, in the imagery the map is showing. */
function usePlaceThumbs(area: AreaData) {
  const base = useStore((s) => s.baseImagery);
  const marsTint = useStore((s) => s.marsTint);
  // With the imagery switched off the list still shows the ground, in the dataset's first picture set.
  const group = base ?? area.manifest.imagery[0]?.group ?? null;
  return useUrls(
    async (signal) =>
      group
        ? Object.fromEntries(
            await Promise.all(area.config.pois.map(async (p) => [p.id, await basePreview(group, marsTint && tintable(group), previewFrame([p.lon, p.lat], PLACE_PREVIEW_M), signal)?.catch(() => null)] as const)),
          )
        : {},
    [area, group, marsTint],
  );
}

/** A place's name for a list that already says what kind it is: "Start: boxwork camp" → "Boxwork camp". */
export const placeName = (p: { name: string }) => p.name.replace(/^Start:\s*(.)/, (_, c: string) => c.toUpperCase());

type Filter = "all" | PoiType;
/** Short names for the filter, which has to fit five options across the panel. */
const FILTER_LABEL: Record<PoiType, string> = { "drill-site": "Drill", "science-target": "Science", viewpoint: "Views", start: "Starts" };

/** The demo walk as the map numbers it: the start, then each stop in order. */
function DemoSteps() {
  return (
    <ol className="m-0 flex list-none items-start p-0" aria-label="The walk's stops">
      {DEMO_STEPS.map((label, i) => (
        <Fragment key={label}>
          {i > 0 && <li aria-hidden className="mt-[9px] h-px min-w-2 flex-1 bg-seam-strong" />}
          <li className="flex w-[52px] flex-none flex-col items-center gap-1 text-center">
            <span className={cn(STOP_BADGE, "size-[18px] text-xs", i === 0 ? STOP_BADGE_START : STOP_BADGE_NUMBER)}>{i === 0 ? "S" : i}</span>
            <span className="text-xs leading-tight text-ink-2">{label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

export function ExploreTab() {
  const area = useStore((s) => s.area)!;
  const set = useStore((s) => s.set);
  const selected = useStore((s) => s.selectedPoi);
  const rover = area.rover;
  const sols = rover.waypoints.map((w) => w.sol).filter((x): x is number => x != null);
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // The demo replaces the plan. With stops of your own in it, the button asks first.
  const planned = useStore((s) => s.stops);
  const ownPlan = hasOwnPlan(planned);
  const [confirming, setConfirming] = useState(false);
  const demoReady = demoAvailable(area.config.pois);
  const runDemo = () => runDemoWalk(area.config.pois);
  const thumbs = usePlaceThumbs(area);
  const pick = (p: Poi) => {
    set({ selectedPoi: p, selectedWaypoint: null, mapClick: null });
    flyTo(p.lon, p.lat);
  };
  const types = ORDER.filter((t) => area.config.pois.some((p) => p.type === t));
  // One list, in the order of the types and with each type's primary objectives first.
  const places = useMemo(() => [...area.config.pois].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || rank(a) - rank(b)), [area]);
  const shown = places.filter((p) => filter === "all" || p.type === filter);
  return (
    <>
      {/* Site facts open the tab: where this is, how big, and the conditions a walk plans around. */}
      <SiteFacts className="mb-4" />

      {/* The walk this site is here for, and the one coloured action in the panel. */}
      <section className="rounded-xl bg-white/5 p-3 inset-ring inset-ring-white/10">
        <h2 className="m-0 text-lg leading-snug font-medium tracking-[-0.01em]">Ridge to hollow in one walk</h2>
        <p className="m-0 mt-1 text-sm text-ink-2">Curiosity drilled here but couldn't dig under the sand or climb the ridges. A crew could, in one six-hour EVA.</p>
        {more && (
          <div className="mt-2 grid gap-2 text-sm text-ink-2">
            <p className="m-0">
              The boxwork is a web of low ridges left where ancient groundwater flowed through fractures and hardened the rock. Curiosity spent most of a year here and drilled three ~6 cm holes: clay in a ridge, carbonate
              in a hollow. Its wheels slipped in the sand-filled hollows, and the big questions stayed open.
            </p>
            <p className="m-0">A crew can cross from ridge to hollow, sample ridge walls, dig under the sand and trace the network.</p>
          </div>
        )}
        <Button variant="link" size="inline" className="mt-1 flex text-xs text-ink-2" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? "Show less" : "Why the boxwork?"}
        </Button>
        <div className="mt-3 mb-3">
          <DemoSteps />
        </div>
        <Button className="h-9 w-full gap-2 rounded-lg bg-mars-deep text-white hover:bg-[#d4521a]" onClick={demoReady ? () => (ownPlan ? setConfirming(true) : runDemo()) : undefined} disabled={!demoReady}>
          <PlayIcon className="size-3.5 flex-none fill-current" aria-hidden />
          Try the boxwork walk
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
        <Button variant="secondary" className="mt-2 h-9 w-full" onClick={() => set({ tab: "plan" })}>
          Plan your own <ArrowRightIcon aria-hidden />
        </Button>
      </section>

      <section>
        <SectionHeading className="text-ink-2">
          Places
          <SectionHeadingAside>{shown.length}</SectionHeadingAside>
        </SectionHeading>
        {types.length > 1 && (
          <Segmented<Filter>
            aria-label="Kind of place"
            className="mb-1.5 flex w-full"
            itemClassName="flex-1 px-1"
            value={filter}
            onValueChange={setFilter}
            options={[{ value: "all", label: "All" }, ...types.map((t) => ({ value: t, label: FILTER_LABEL[t] }))]}
          />
        )}
        <ul className="-mx-2 m-0 list-none p-0">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={selected?.id === p.id}
                className={cn(
                  "group/place flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors coarse:py-2.5 hover:bg-white/5",
                  selected?.id === p.id && "bg-white/11 hover:bg-white/11",
                )}
                onClick={() => pick(p)}
              >
                {/* The ground at the place, with its kind marked the way the map's pin marks it. */}
                <span aria-hidden className="relative block size-8 flex-none">
                  <span className="absolute inset-0 overflow-hidden rounded-[7px] bg-well after:absolute after:inset-0 after:rounded-[inherit] after:inset-ring after:inset-ring-white/18">
                    {thumbs[p.id] && <img src={thumbs[p.id]!} alt="" draggable={false} className="size-full object-cover" />}
                  </span>
                  <i className={cn("absolute -right-1 -bottom-1 size-2.5 rounded-full border-[1.5px] border-well", POI_DOT[p.type], p.type === "start" && "rounded-[2px]")} />
                </span>
                <span className="block min-w-0 flex-1">
                  <span className="block truncate font-medium">{placeName(p)}</span>
                  <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-2">
                    {POI_TYPE_LABEL[p.type]}
                    {p.priority && <span>· {p.priority}</span>}
                    {p.positionSource === "illustrative" && <Badge variant="estimate">illustrative</Badge>}
                  </span>
                </span>
                <ChevronRightIcon aria-hidden className="size-3.5 flex-none text-ink-4 transition-colors group-hover/place:text-ink-2" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading className="text-ink-2">Curiosity in this area</SectionHeading>
        <dl className="m-0 grid grid-cols-3 gap-2">
          {[
            ["Waypoints", rover.waypoints.length.toLocaleString()],
            ["Photos", rover.photos.length.toLocaleString()],
            ["Sols", sols.length ? `${Math.min(...sols)}–${Math.max(...sols)}` : "—"],
          ].map(([label, value]) => (
            <div key={label} className={FACT_TILE}>
              <dt className="text-xs text-ink-2">{label}</dt>
              <dd className="m-0 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 mb-0 text-sm text-ink-2">Select a waypoint dot on the map for its sol and photos.</p>
      </section>
    </>
  );
}
