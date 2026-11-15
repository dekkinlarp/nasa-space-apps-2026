import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { LonLat, RouteResult } from "@marsmap/core";
import { selectedResult, useStore } from "../store";
import { measure, pointAt } from "../geo";
import { fmtDist, fmtNum } from "../format";
import { nearestPhoto, pointNames, surfaceById } from "../lib";
import { cssGradient, SLOPE_STOPS } from "../map/rasters";
import { PhotoThumb } from "./Cards";
import { profileColor, resizeMapDuring } from "../map/MapView";
import { BottomPaneIcon } from "./icons";
import { PANEL_MS } from "../App";

interface Flat {
  d: Float64Array;
  e: Float32Array;
  s: Float32Array;
  surf: Uint8Array;
  segOffsets: number[];
  total: number;
  min: number;
  max: number;
}

function flatten(r: RouteResult): Flat {
  let n = 0;
  for (const s of r.segments) n += s.profile.length;
  const d = new Float64Array(n), e = new Float32Array(n), sl = new Float32Array(n), surf = new Uint8Array(n);
  const segOffsets: number[] = [];
  let off = 0, k = 0, min = Infinity, max = -Infinity;
  for (const s of r.segments) {
    segOffsets.push(off);
    for (const p of s.profile) {
      d[k] = off + p.distanceM;
      e[k] = p.elevationM;
      sl[k] = p.slopeDeg;
      surf[k] = p.surfaceId;
      if (Number.isFinite(p.elevationM)) {
        min = Math.min(min, p.elevationM);
        max = Math.max(max, p.elevationM);
      }
      k++;
    }
    off += s.distanceM;
  }
  return { d, e, s: sl, surf, segOffsets, total: off, min, max };
}

function slopeColor(v: number) {
  for (let i = SLOPE_STOPS.length - 1; i >= 0; i--) if (v >= SLOPE_STOPS[i]![0]) return SLOPE_STOPS[i]![1];
  return SLOPE_STOPS[0]![1];
}

/** Map distance along the route profile to a map position, per segment. */
export function routePointAt(r: RouteResult, segOffsets: number[], dist: number): LonLat | null {
  let si = 0;
  while (si + 1 < segOffsets.length && dist >= segOffsets[si + 1]!) si++;
  const seg = r.segments[si];
  if (!seg) return null;
  const m = measure(seg.path);
  const f = seg.distanceM > 0 ? (dist - segOffsets[si]!) / seg.distanceM : 0;
  return pointAt(m, f * m.total).p;
}

export function ProfileStrip() {
  const st = useStore(
    useShallow((s) => {
      const { hover: _h, ...rest } = s;
      return rest;
    }),
  );
  const area = st.area!;
  const r = useMemo(() => selectedResult({ results: st.results, selectedProfile: st.selectedProfile }), [st.results, st.selectedProfile]);
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hoverD, setHoverD] = useState<number | null>(null);
  const [open, setOpen] = useState(true);
  const flat = useMemo(() => (r ? flatten(r) : null), [r]);
  const names = pointNames(st.start, st.stops, st.returnToStart);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [r != null]);

  const H = 150, PL = 52, PR = 14, PT = 14, PB = 34;
  const iw = Math.max(10, w - PL - PR), ih = H - PT - PB;

  const geom = useMemo(() => {
    if (!flat || flat.d.length < 2) return null;
    const pad = Math.max(1, (flat.max - flat.min) * 0.12);
    const y0 = flat.min - pad, y1 = flat.max + pad;
    const X = (d: number) => PL + (d / (flat.total || 1)) * iw;
    const Y = (e: number) => PT + ih - ((e - y0) / (y1 - y0)) * ih;
    let line = "";
    for (let i = 0; i < flat.d.length; i++) {
      if (!Number.isFinite(flat.e[i]!)) continue;
      line += `${line ? "L" : "M"}${X(flat.d[i]!).toFixed(1)},${Y(flat.e[i]!).toFixed(1)}`;
    }
    const area = `${line}L${X(flat.total).toFixed(1)},${PT + ih}L${PL},${PT + ih}Z`;
    // Slope + surface bands, binned to ~2 px.
    const bins = Math.max(1, Math.floor(iw / 2));
    const bands: { x: number; w: number; slope: string; surf: number }[] = [];
    let j = 0;
    for (let b = 0; b < bins; b++) {
      const dEnd = ((b + 1) / bins) * flat.total;
      let maxS = 0, sid = flat.surf[j] ?? 0;
      while (j < flat.d.length && flat.d[j]! <= dEnd) {
        maxS = Math.max(maxS, flat.s[j]!);
        sid = flat.surf[j]!;
        j++;
      }
      bands.push({ x: PL + (b / bins) * iw, w: iw / bins + 0.5, slope: slopeColor(maxS), surf: sid });
    }
    const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
    return { X, Y, line, area, bands, ticks };
  }, [flat, iw, ih]);

  if (!r || !flat || !geom) return null;
  const { X, Y } = geom;
  const color = profileColor(r.profile.id);
  const over = r.totals.firstSegmentOverLimit;

  let hi: number | null = null;
  if (hoverD != null) {
    let lo = 0, h = flat.d.length - 1;
    while (h - lo > 1) {
      const mid = (lo + h) >> 1;
      if (flat.d[mid]! <= hoverD) lo = mid; else h = mid;
    }
    hi = Math.abs(flat.d[lo]! - hoverD) < Math.abs(flat.d[h]! - hoverD) ? lo : h;
  }
  const surf = hi != null ? surfaceById(area.config.surfaceClasses, flat.surf[hi]) : null;
  const cursor = st.profileCursor;
  const photo = cursor ? nearestPhoto(area.rover.photos, cursor) : null;
  const goD = st.go.mode !== "off" ? st.go.alongM : null;

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const d = Math.max(0, Math.min(flat.total, ((x - PL) / iw) * flat.total));
    setHoverD(d);
    st.set({ profileHoverM: d, profileCursor: routePointAt(r, flat.segOffsets, d) });
  };
  const onLeave = () => {
    setHoverD(null);
    st.set({ profileHoverM: null, profileCursor: null });
  };

  return (
    <div className={`profile glass ${open ? "" : "collapsed"}`}>
      <div className="profile-title">
        <span>Elevation</span>
        <span className="dim">
          {r.profile.name} route · {fmtDist(flat.total)} · {Math.round(flat.max - flat.min)} m relief
        </span>
        <button
          className="icon-btn"
          aria-label={open ? "Hide elevation profile" : "Show elevation profile"}
          title={open ? "Hide elevation profile" : "Show elevation profile"}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            onLeave();
            resizeMapDuring(PANEL_MS);
          }}
        >
          <BottomPaneIcon on={open} />
        </button>
      </div>
      <div className="profile-body">
        <div className="profile-chart" ref={ref}>
          <svg width={w} height={H} onMouseMove={onMove} onMouseLeave={onLeave}>
            {geom.ticks.map((t) => (
              <g key={t}>
                <line x1={PL} x2={PL + iw} y1={Y(t)} y2={Y(t)} className="grid-line" />
                <text x={PL - 6} y={Y(t) + 4} className="axis" textAnchor="end">
                  {String(Math.round(t)).replace("-", "−")}
                </text>
              </g>
            ))}
            {over != null && flat.segOffsets[over] != null && <rect x={X(flat.segOffsets[over]!)} y={PT} width={PL + iw - X(flat.segOffsets[over]!)} height={ih} className="over-zone" />}
            <path d={geom.area} fill={color} fillOpacity={0.14} />
            <path d={geom.line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
            {flat.segOffsets.map((o, i) =>
              i === 0 ? null : (
                <g key={i}>
                  <line x1={X(o)} x2={X(o)} y1={PT} y2={PT + ih} className="seg-line" />
                  <text x={X(o) + 3} y={PT + 10} className="axis">
                    {names[i]?.split(" · ")[0] ?? i}
                  </text>
                </g>
              ),
            )}
            <text x={PL - 6} y={PT + ih + 10} className="axis band-lbl" textAnchor="end">
              <title>Slope underfoot along the route (green gentle, red steep)</title>
              slope
            </text>
            <text x={PL - 6} y={PT + ih + 19} className="axis band-lbl" textAnchor="end">
              <title>Mapped surface class along the route</title>
              surface
            </text>
            {geom.bands.map((b, i) => (
              <rect key={`s${i}`} x={b.x} y={PT + ih + 4} width={b.w} height={6} fill={b.slope} />
            ))}
            {geom.bands.map((b, i) => (
              <rect key={`u${i}`} x={b.x} y={PT + ih + 13} width={b.w} height={6} fill={surfaceById(area.config.surfaceClasses, b.surf)?.color ?? "#555"} />
            ))}
            <text x={PL} y={H - 4} className="axis">
              0 m
            </text>
            <text x={PL + iw} y={H - 4} className="axis" textAnchor="end">
              {fmtDist(flat.total)}
            </text>
            {goD != null && <line x1={X(Math.min(goD, flat.total))} x2={X(Math.min(goD, flat.total))} y1={PT} y2={PT + ih} stroke="#36d1c4" strokeWidth={2} />}
            {hi != null && (
              <g>
                <line x1={X(flat.d[hi]!)} x2={X(flat.d[hi]!)} y1={PT} y2={PT + ih + 19} stroke="#fff" strokeOpacity={0.6} />
                <circle cx={X(flat.d[hi]!)} cy={Y(flat.e[hi]!)} r={4} fill="#fff" />
              </g>
            )}
          </svg>
          {hi != null && (
            <div className="profile-tip" style={{ left: X(flat.d[hi]!) + 150 > w ? X(flat.d[hi]!) - 142 : X(flat.d[hi]!) + 10 }}>
              <div>
                <b>{fmtNum(flat.e[hi], 0, " m")}</b> · {fmtNum(flat.s[hi], 1, "°")} <span className="dim">slope</span>
              </div>
              {surf && (
                <div>
                  <i className="swatch" style={{ background: surf.color }} />
                  {surf.name}
                </div>
              )}
              <div className="dim">{fmtDist(flat.d[hi]!)} along</div>
            </div>
          )}
        </div>
        <div className="profile-photo">
          {photo && photo.distM < 400 ? (
            <PhotoThumb photo={photo.photo} distM={photo.distM} />
          ) : (
            <div className="small dim">{cursor ? "No rover photo within 400 m" : "Hover the profile to find the spot on the map and the nearest rover photo"}</div>
          )}
        </div>
      </div>
    </div>
  );
}
