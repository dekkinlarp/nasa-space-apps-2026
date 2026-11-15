import { useStore } from "../store";
import { fmtDist, fmtLonLat, fmtNum } from "../format";
import { nearestPhoto, sampleAt, surfaceById } from "../lib";
import { marsDistanceM } from "../geo";
import type { Poi, RoverPhoto } from "../types";
import type { LonLat } from "@marsmap/core";

export const POI_TYPE_LABEL: Record<string, string> = {
  "drill-site": "Drill site",
  "science-target": "Science target",
  start: "Start spot",
  viewpoint: "Viewpoint",
};

export function PhotoThumb({ photo, distM }: { photo: RoverPhoto; distM?: number }) {
  return (
    <a className="photo" href={photo.sourceUrl ?? photo.url} target="_blank" rel="noreferrer" title="Open source image">
      <img src={photo.url} alt={`Rover image, sol ${photo.sol}`} loading="lazy" />
      <div className="photo-cap">
        <span className="photo-what" title={photo.instrument ? `Camera: ${photo.instrument}` : undefined}>
          Sol {photo.sol}
          {photo.instrument ? ` · ${photo.instrument}` : ""}
        </span>
        {distM != null && <span className="photo-dist">{fmtDist(distM)} away</span>}
      </div>
      {photo.credit && <div className="photo-credit">{photo.credit}</div>}
    </a>
  );
}

function PointStats({ lonLat }: { lonLat: LonLat }) {
  const area = useStore((s) => s.area)!;
  const start = useStore((s) => s.start);
  const smp = sampleAt(area.layers, lonLat);
  const surf = surfaceById(area.config.surfaceClasses, smp?.surfaceId);
  return (
    <dl className="stats">
      <div>
        <dt>Elevation</dt>
        <dd>{fmtNum(smp?.elevationM, 0, " m")}</dd>
      </div>
      <div>
        <dt>Slope</dt>
        <dd>{fmtNum(smp?.slopeDeg, 1, "°")}</dd>
      </div>
      <div>
        <dt>Surface</dt>
        <dd>
          {surf ? (
            <>
              <i className="swatch" style={{ background: surf.color }} />
              {surf.name}
            </>
          ) : (
            "—"
          )}
        </dd>
      </div>
      {start && (
        <div title="Straight-line distance from the start">
          <dt>From start</dt>
          <dd>{fmtDist(marsDistanceM(start.lonLat, lonLat))}</dd>
        </div>
      )}
    </dl>
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
    <div className="card float-card">
      <button className="card-close" onClick={() => set({ selectedPoi: null })} aria-label="Close">
        ×
      </button>
      <div className="card-tags">
        <span className={`type-tag t-${poi.type}`}>{POI_TYPE_LABEL[poi.type] ?? poi.type}</span>
        {poi.positionSource === "illustrative" && (
          <span className="est-tag" title="A plausible spot picked from the HiRISE image for the demo, not a surveyed target">
            Illustrative position
          </span>
        )}
      </div>
      <h3>{poi.name}</h3>
      <p className="lead">{poi.summary}</p>
      {poi.roverDid && (
        <div className="kv">
          <div className="k">Curiosity did</div>
          <div>{poi.roverDid}</div>
        </div>
      )}
      {poi.roverCouldNot && (
        <div className="kv">
          <div className="k">Curiosity couldn't</div>
          <div>{poi.roverCouldNot}</div>
        </div>
      )}
      {poi.humanCan && (
        <div className="kv">
          <div className="k">A crew can</div>
          <div>{poi.humanCan}</div>
        </div>
      )}
      <PointStats lonLat={ll} />
      {np && np.distM < 600 && (
        <div className="kv">
          <div className="k">Nearest rover photo</div>
          <PhotoThumb photo={np.photo} distM={np.distM} />
        </div>
      )}
      <div className="card-actions">
        <button
          className="btn"
          onClick={() => {
            setStart({ lonLat: ll, name: poi.name, poiId: poi.id });
            set({ tab: "plan" });
          }}
        >
          Set as start
        </button>
        <button
          className="btn primary"
          disabled={already}
          onClick={() => {
            addStop({ lonLat: ll, name: poi.name, poiId: poi.id });
            set({ tab: "plan" });
          }}
        >
          {already ? "In plan" : "Add as stop"}
        </button>
      </div>
      <div className="sources">
        {poi.sources.map((u) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" title={u}>
            {new URL(u).hostname.replace(/^www\./, "")}
          </a>
        ))}
        <span className="card-ll" title={`Position source: ${poi.positionSource}`}>
          {fmtLonLat(ll)}
        </span>
      </div>
    </div>
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
    <div className="card float-card">
      <button className="card-close" onClick={() => set({ selectedWaypoint: null })} aria-label="Close">
        ×
      </button>
      <div className="type-tag t-rover">Curiosity waypoint</div>
      <h3>Sol {w.sol ?? "?"}</h3>
      <dl className="stats">
        {extra.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
        {tilt != null && (
          <div>
            <dt>Rover tilt</dt>
            <dd>{Number(tilt).toFixed(1)}°</dd>
          </div>
        )}
        {pitch != null && (
          <div>
            <dt>Pitch / roll</dt>
            <dd>
              {Number(pitch).toFixed(1)}° / {roll != null ? Number(roll).toFixed(1) : "—"}°
            </dd>
          </div>
        )}
      </dl>
      <PointStats lonLat={w.lonLat} />
      {photos.length > 0 ? (
        <div className="photo-grid">
          {photos.map((ph) => (
            <PhotoThumb key={ph.url} photo={ph} distM={marsDistanceM(w.lonLat, [ph.lon, ph.lat])} />
          ))}
        </div>
      ) : (
        <div className="small dim">No rover photos stored for this sol.</div>
      )}
      <div className="sources">
        <span className="card-ll">{fmtLonLat(w.lonLat)}</span>
      </div>
    </div>
  );
}
