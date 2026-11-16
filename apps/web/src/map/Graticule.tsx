/**
 * Coordinate ticks along the edges of the visible map, like the frame of a chart: longitude along the top
 * and latitude down the left, labelled at round values with plain ticks between. They follow the map as it moves, and when
 * the map is turned each edge shows whichever coordinate changes more along it. Hidden in 3D, where an
 * edge of the screen is not a line on the ground.
 */
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { getMap } from "./MapView";

interface Tick {
  /** Pixels along the edge. */
  pos: number;
  label: string | null;
}

interface Frame {
  /** Where the left-hand ticks sit: just clear of the side panel. */
  x: number;
  top: Tick[];
  left: Tick[];
}

/** Labelled ticks no closer than this, in pixels. The ticks between them divide that step in four or five. */
const LABEL_GAP = 150;
const GAP = 12;

/** The step of 1, 2 or 5 times a power of ten at or above `x`. */
function niceStep(x: number) {
  const pow = 10 ** Math.floor(Math.log10(x));
  const m = x / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}

/** Ticks along one straight edge of the screen, from `at(0)` to `at(len)`. */
function edgeTicks(map: NonNullable<ReturnType<typeof getMap>>, at: (t: number) => [number, number], len: number): Tick[] {
  if (len < LABEL_GAP) return [];
  const n = Math.ceil(len / 16);
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * len;
    const ll = map.unproject(at(t));
    return { t, lon: ll.lng, lat: ll.lat };
  });
  const dLon = Math.abs(pts[n]!.lon - pts[0]!.lon);
  const dLat = Math.abs(pts[n]!.lat - pts[0]!.lat);
  const key = dLon >= dLat ? "lon" : "lat";
  const range = Math.max(dLon, dLat);
  if (!(range > 0) || !Number.isFinite(range)) return [];
  // Labels fall on round values (1, 2 or 5 times a power of ten); the plain ticks between them divide that step evenly.
  const labelStep = niceStep((range / len) * LABEL_GAP);
  const pow = 10 ** Math.floor(Math.log10(labelStep) + 1e-9);
  const every = Math.round(labelStep / pow) === 2 ? 4 : 5;
  const step = labelStep / every;
  const decimals = Math.max(0, -Math.floor(Math.log10(labelStep) + 1e-9));
  const out: Tick[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]![key], b = pts[i + 1]![key];
    if (a === b) continue;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let k = Math.ceil(lo / step); k * step < hi; k++) {
      const v = k * step;
      const pos = pts[i]!.t + ((v - a) / (b - a)) * (len / n);
      const hemi = key === "lon" ? (v >= 0 ? "E" : "W") : v >= 0 ? "N" : "S";
      out.push({ pos, label: ((k % every) + every) % every === 0 ? `${Math.abs(v).toFixed(decimals)}°${hemi}` : null });
    }
  }
  return out;
}

export function Graticule() {
  const view3d = useStore((s) => s.view3d);
  const [frame, setFrame] = useState<Frame | null>(null);

  useEffect(() => {
    if (view3d) return setFrame(null);
    let raf = 0;
    let off = () => {};
    const attach = () => {
      const map = getMap();
      if (!map) return false;
      const read = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          // A tilted view has a horizon along its top edge, not a line of ground.
          if (map.getPitch() > 1) return setFrame(null);
          const el = map.getContainer();
          const w = el.clientWidth, h = el.clientHeight;
          const pad = map.getPadding();
          const padLeft = pad.left ?? 0;
          const x = padLeft > 0 ? padLeft + GAP : 0;
          setFrame({
            x,
            top: edgeTicks(map, (t) => [x + t, 0], w - x),
            left: edgeTicks(map, (t) => [x, t], h - (pad.bottom ?? 0)),
          });
        });
      };
      map.on("move", read);
      map.on("resize", read);
      read();
      off = () => {
        map.off("move", read);
        map.off("resize", read);
      };
      return true;
    };
    // The map is created by MapView after this mounts, so look for it until it is there.
    const wait = attach() ? 0 : window.setInterval(() => attach() && window.clearInterval(wait), 250);
    return () => {
      window.clearInterval(wait);
      cancelAnimationFrame(raf);
      off();
    };
  }, [view3d]);

  if (!frame) return null;
  const mark = "absolute bg-foreground/75 shadow-[0_0_0_0.5px_rgba(0,0,0,0.6)]";
  const text = "absolute font-mono text-[11px]/none tracking-[0.04em] whitespace-nowrap text-foreground [text-shadow:0_0_3px_#000,0_0_2px_#000]";
  return (
    <div className="pointer-events-none absolute inset-0 z-1 overflow-hidden" aria-hidden>
      {frame.top.map((t) => (
        <i key={`t${t.pos.toFixed(1)}`} className={`${mark} top-0 h-[7px] w-px`} style={{ left: frame.x + t.pos }} />
      ))}
      {frame.top.map((t) => t.label && <span key={`tl${t.label}`} className={text} style={{ left: frame.x + t.pos + 5, top: 9 }}>{t.label}</span>)}
      {frame.left.map((t) => (
        <i key={`l${t.pos.toFixed(1)}`} className={`${mark} h-px w-[7px]`} style={{ left: frame.x, top: t.pos }} />
      ))}
      {/* A label too near the top would sit on the top edge's own labels. */}
      {frame.left.map((t) => t.label && t.pos > 28 && <span key={`ll${t.label}`} className={text} style={{ left: frame.x + 12, top: t.pos - 5 }}>{t.label}</span>)}
    </div>
  );
}
