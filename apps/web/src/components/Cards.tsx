import type { ReactNode } from "react";
import { useStore } from "../store";
import { fmtDist, fmtLonLat, fmtNum } from "../format";
import { nearestPhoto, sampleBest, surfaceById } from "../lib";
import { marsDistanceM } from "../geo";
import type { Poi, RoverPhoto } from "../types";
import type { LonLat } from "@marsmap/core";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Detail, Stat, StatGrid } from "@/components/ui/stat";
import { Swatch } from "@/components/ui/swatch";
import { cn } from "@/lib/utils";

export const POI_TYPE_LABEL: Record<string, string> = {
  "drill-site": "Drill site",
  "science-target": "Science target",
  start: "Start spot",
  viewpoint: "Viewpoint",
};

/** The dot colour of each point-of-interest type (the map pins use the same tokens, see MapView). */
export const POI_DOT: Record<string, string> = {
  "drill-site": "bg-poi-drill-site",
  "science-target": "bg-poi-science-target",
  start: "bg-poi-start",
  viewpoint: "bg-poi-viewpoint",
  rover: "bg-poi-rover",
};

const PRIORITY_LABEL: Record<string, string> = { primary: "Primary objective", secondary: "Secondary objective", optional: "If time allows" };
const BASIS_LABEL: Record<string, string> = { rover: "Rover", orbital: "Orbit", inferred: "Our reading" };

export function PriorityTag({ poi, tiny }: { poi: Poi; tiny?: boolean }) {
  if (!poi.priority) return null;
  // In a list the rows are already in priority order, so the word is enough.
  if (tiny) return <span className="text-xs font-normal text-muted-foreground">{poi.priority}</span>;
  const variant = poi.priority === "primary" ? "strong" : poi.priority === "optional" ? "quiet" : "default";
  return <Badge variant={variant}>{PRIORITY_LABEL[poi.priority]}</Badge>;
}

/** What the orbital mineral layers read at the POI, next to how that compares with the rest of the area. */
function MineralEvidence({ poi }: { poi: Poi }) {
  const area = useStore((s) => s.area)!;
  const m = area.minerals;
  const samples = m?.poiSamples[poi.id];
  if (!m || !samples) return null;
  return (
    <Detail label={`From orbit at this spot · CRISM ${m.observation}, ${m.pixelM} m pixels`}>
      <table className="mt-0.5 mb-1 w-full border-collapse text-sm">
        <tbody>
          {m.layers.map((l) => {
            const s = samples[l.id];
            if (!s || s.value == null) return null;
            return (
              <tr key={l.id} className="*:py-0.5 *:pr-2 *:align-top">
                <td className="font-medium whitespace-nowrap">{l.name.replace(/\s*\(.*$/, "")}</td>
                <td className={s.value > 0 ? undefined : "text-muted-foreground"}>{s.value > 0 ? "present" : "not seen"}</td>
                <td className="text-muted-foreground">{s.percentile != null ? `stronger than ${s.percentile}% of the area` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-sm text-muted-foreground">One pixel covers an {m.pixelM} m patch, and sand or dust hides minerals from orbit, so "not seen" does not mean absent.</div>
    </Detail>
  );
}

export function PhotoThumb({ photo, distM, className }: { photo: RoverPhoto; distM?: number; className?: string }) {
  return (
    <a
      className={cn("block overflow-hidden rounded-sm border border-input bg-black text-foreground no-underline hover:border-seam-strong", className)}
      href={photo.sourceUrl ?? photo.url}
      target="_blank"
      rel="noreferrer"
      title="Open source image"
    >
      <img className="block max-h-[180px] w-full object-cover" src={photo.url} alt={`Rover image, sol ${photo.sol}`} loading="lazy" />
      <div className="flex justify-between gap-2 bg-card px-1.5 py-1 text-xs">
        <span className="min-w-0 truncate" title={photo.instrument ? `Camera: ${photo.instrument}` : undefined}>
          Sol {photo.sol}
          {photo.instrument ? ` · ${photo.instrument}` : ""}
        </span>
        {distM != null && <span className="flex-none text-muted-foreground">{fmtDist(distM)} away</span>}
      </div>
      {photo.credit && <div className="bg-card px-1.5 pb-1 text-xs text-muted-foreground">{photo.credit}</div>}
    </a>
  );
}

function PointStats({ lonLat }: { lonLat: LonLat }) {
  const area = useStore((s) => s.area)!;
  const start = useStore((s) => s.start);
  const detail = useStore((s) => s.detail);
  const smp = sampleBest(area, detail, lonLat);
  const surf = surfaceById(area.config.surfaceClasses, smp?.surfaceId);
  return (
    <StatGrid className="border-y py-2">
      <Stat label="Elevation">{fmtNum(smp?.elevationM, 0, " m")}</Stat>
      <Stat label="Slope">{fmtNum(smp?.slopeDeg, 1, "°")}</Stat>
      <Stat label="Surface">
        {surf ? (
          <>
            <Swatch color={surf.color} />
            {surf.name}
          </>
        ) : (
          "—"
        )}
      </Stat>
      {start && (
        <Stat label="From start" title="Straight-line distance from the start">
          {fmtDist(marsDistanceM(start.lonLat, lonLat))}
        </Stat>
      )}
    </StatGrid>
  );
}

/** A floating card at the right of the map: a point of interest or a rover waypoint. */
function FloatCard({ onClose, footer, children }: { onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  return (
    <Panel size="lg" className="relative flex min-h-0 origin-top-right animate-pop-in flex-col overflow-hidden">
      <Button variant="ghost" size="icon-xs" className="absolute top-3 right-3 z-1 text-muted-foreground" onClick={onClose} aria-label="Close">
        <XIcon />
      </Button>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {/* The actions stay put while the text scrolls, so a short card on a phone still offers them. */}
      {footer && <div className="flex flex-none gap-2 border-t p-3">{footer}</div>}
    </Panel>
  );
}

/** The card's type line: a coloured dot and the kind of place. */
function TypeTag({ type, label }: { type: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-ink-2">
      <i className={cn("size-2 rounded-full shadow-dome-sm", POI_DOT[type], type === "start" && "rounded-[1px]")} />
      {label}
    </span>
  );
}

const cardTitle = "mt-2 mb-1.5 pr-6 text-xl font-medium tracking-[-0.02em]";

/** The small print at the foot of a card: source links and the position. */
function CardFoot({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs [&_a]:text-ink-2">{children}</div>;
}

function CardLonLat({ lonLat, title }: { lonLat: LonLat; title?: string }) {
  return (
    <span className="ml-auto cursor-help font-mono text-xs text-muted-foreground" title={title}>
      {fmtLonLat(lonLat)}
    </span>
  );
}

export function PoiCard({ poi }: { poi: Poi }) {
  const area = useStore((s) => s.area)!;
  const set = useStore((s) => s.set);
  const addStop = useStore((s) => s.addStop);
  const setStart = useStore((s) => s.setStart);
  const stops = useStore((s) => s.stops);
  const ll: LonLat = [poi.lon, poi.lat];
  const np = nearestPhoto(area.rover.photos, ll);
  const already = stops.some((s) => s.poiId === poi.id);
  return (
    <FloatCard
      onClose={() => set({ selectedPoi: null })}
      footer={
        <>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            setStart({ lonLat: ll, name: poi.name, poiId: poi.id });
            set({ tab: "plan" });
          }}
        >
          Set as start
        </Button>
        <Button
          className="flex-1"
          disabled={already}
          onClick={() => {
            addStop({ lonLat: ll, name: poi.name, poiId: poi.id });
            set({ tab: "plan" });
          }}
        >
          {already ? "In plan" : "Add as stop"}
        </Button>
        </>
      }
    >
      <div className="flex items-baseline gap-2 pr-[22px]">
        <TypeTag type={poi.type} label={POI_TYPE_LABEL[poi.type] ?? poi.type} />
        {poi.positionSource === "illustrative" && (
          <span className="cursor-help text-xs text-[#e6b98a] before:text-muted-foreground before:content-['·_']" title="A plausible spot picked from the HiRISE image for the demo, not a surveyed target">
            Illustrative position
          </span>
        )}
      </div>
      <h3 className={cardTitle}>{poi.name}</h3>
      {poi.priority && (
        <div className="mt-1 mb-0.5 flex flex-wrap gap-1.5">
          <PriorityTag poi={poi} />
        </div>
      )}
      <p className="my-2 text-ink-2">{poi.summary}</p>
      {poi.objective && <Detail label="Question this stop answers">{poi.objective}</Detail>}
      {poi.evidence && poi.evidence.length > 0 && (
        <Detail label="Evidence">
          <ul className="mt-0.5 grid list-none gap-1.5 p-0">
            {poi.evidence.map((e, i) => (
              <li key={i}>
                <Badge
                  variant={e.basis === "rover" ? "strong" : e.basis === "orbital" ? "default" : "estimate"}
                  className={cn("mr-1.5", e.basis === "rover" && "border-ink-2 text-foreground")}
                >
                  {BASIS_LABEL[e.basis] ?? e.basis}
                </Badge>
                {e.claim}
              </li>
            ))}
          </ul>
        </Detail>
      )}
      <MineralEvidence poi={poi} />
      {poi.roverDid && <Detail label="Curiosity did">{poi.roverDid}</Detail>}
      {poi.roverCouldNot && <Detail label="Curiosity couldn't">{poi.roverCouldNot}</Detail>}
      {poi.humanCan && <Detail label="A crew can">{poi.humanCan}</Detail>}
      {poi.activity && !poi.humanCan && <Detail label="At the stop">{poi.activity}</Detail>}
      {poi.confidence && (
        <Detail label={`Confidence · ${poi.confidence}`}>
          <div className="text-sm">{poi.confidenceNote}</div>
        </Detail>
      )}
      <PointStats lonLat={ll} />
      {np && np.distM < 600 && (
        <Detail label="Nearest rover photo">
          <PhotoThumb photo={np.photo} distM={np.distM} />
        </Detail>
      )}
      <CardFoot>
        {poi.sources.map((u) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" title={u}>
            {new URL(u).hostname.replace(/^www\./, "")}
          </a>
        ))}
        <CardLonLat lonLat={ll} title={`Position source: ${poi.positionSource}`} />
      </CardFoot>
    </FloatCard>
  );
}

export function WaypointCard() {
  const area = useStore((s) => s.area)!;
  const w = useStore((s) => s.selectedWaypoint);
  const set = useStore((s) => s.set);
  if (!w) return null;
  const p = w.props;
  const tilt = (p.tiltDeg ?? p.tilt ?? p.tilt_deg ?? null) as number | null;
  const roll = (p.roll ?? p.rollDeg ?? null) as number | null;
  const pitch = (p.pitch ?? p.pitchDeg ?? null) as number | null;
  const solPhotos = area.rover.photos.filter((ph) => w.sol != null && ph.sol === w.sol);
  const photos = solPhotos.length
    ? solPhotos.slice(0, 4)
    : area.rover.photos
        .map((ph) => ({ ph, d: marsDistanceM(w.lonLat, [ph.lon, ph.lat]) }))
        .filter((x) => x.d < 150)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map((x) => x.ph);
  const extra = Object.entries(p).filter(([k, v]) => ["site", "drive", "name"].includes(k) && v != null);
  return (
    <FloatCard onClose={() => set({ selectedWaypoint: null })}>
      <TypeTag type="rover" label="Curiosity waypoint" />
      <h3 className={cardTitle}>Sol {w.sol ?? "?"}</h3>
      {(extra.length > 0 || tilt != null || pitch != null) && (
        <StatGrid>
          {extra.map(([k, v]) => (
            <Stat key={k} label={k}>
              {String(v)}
            </Stat>
          ))}
          {tilt != null && <Stat label="Rover tilt">{Number(tilt).toFixed(1)}°</Stat>}
          {pitch != null && (
            <Stat label="Pitch / roll">
              {Number(pitch).toFixed(1)}° / {roll != null ? Number(roll).toFixed(1) : "—"}°
            </Stat>
          )}
        </StatGrid>
      )}
      <PointStats lonLat={w.lonLat} />
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5 phone:grid-cols-1">
          {photos.map((ph) => (
            <PhotoThumb key={ph.url} photo={ph} distM={marsDistanceM(w.lonLat, [ph.lon, ph.lat])} />
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No rover photos stored for this sol.</div>
      )}
      <CardFoot>
        <CardLonLat lonLat={w.lonLat} />
      </CardFoot>
    </FloatCard>
  );
}
