import { rowColToLonLat } from "./grid";
import { oxygenModelOn, oxygenUsedKg } from "./params";
import type { GridSpec, ReachField, ReachRing, WalkParams } from "./types";

type Pt = [x: number, y: number]; // x = col, y = row (cell-centre coordinates)

/** Signed area in (col, row) coordinates. */
function signedArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]);
  return a / 2;
}

function pointInRing(p: Pt, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** One Chaikin corner-cutting pass on a closed ring. */
function chaikin(r: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
    out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  return out;
}

/** Douglas-Peucker on an open polyline. */
function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [0, pts.length - 1];
  const t2 = tol * tol;
  while (stack.length) {
    const b = stack.pop()!, a = stack.pop()!;
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d2 = l2 === 0 ? (px - ax) ** 2 + (py - ay) ** 2 : ((px - ax) * dy - (py - ay) * dx) ** 2 / l2;
      if (d2 > md) {
        md = d2;
        mi = i;
      }
    }
    if (md > t2 && mi > 0) {
      keep[mi] = 1;
      stack.push(a, mi, mi, b);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring by splitting it at its farthest-apart vertices and running DP on both halves. */
function simplifyRing(r: Pt[], tol: number): Pt[] {
  if (r.length < 8) return r;
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) {
    const d = (r[i]![0] - r[0]![0]) ** 2 + (r[i]![1] - r[0]![1]) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = dp(r.slice(0, far + 1), tol);
  const b = dp([...r.slice(far), r[0]!], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/**
 * Marching squares over cell centres for the region value <= level. The grid is padded with
 * an "outside" border so every ring closes. Returns rings in (col, row) coordinates; with the
 * clockwise edge walk used here, every ring has the inside on the same side, so outer rings and
 * holes have opposite signed area.
 */
export function isolines(
  width: number,
  height: number,
  value: (index: number) => number,
  level: number,
): Pt[][] {
  // Bounding box of inside cells, to skip empty space.
  let r0 = height, r1 = -1, c0 = width, c1 = -1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (value(r * width + c) <= level) {
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
      }
    }
  }
  if (r1 < 0) return [];
  const PW = width + 2;
  const val = (r: number, c: number) =>
    r < 0 || r >= height || c < 0 || c >= width ? Infinity : value(r * width + c);
  // Edge ids: corner (r, c) shifted by +1 into the padded grid. Horizontal edge (r,c)-(r,c+1) = 2k,
  // vertical edge (r,c)-(r+1,c) = 2k+1, where k = (r+1)*PW + (c+1).
  const hEdge = (r: number, c: number) => ((r + 1) * PW + (c + 1)) * 2;
  const vEdge = (r: number, c: number) => ((r + 1) * PW + (c + 1)) * 2 + 1;
  const next = new Map<number, number>();
  const pos = new Map<number, Pt>();

  const crossing = (ra: number, ca: number, va: number, rb: number, cb: number, vb: number): Pt => {
    let t = 0.5;
    if (Number.isFinite(va) && Number.isFinite(vb) && va !== vb) t = (level - va) / (vb - va);
    if (t < 0.02) t = 0.02;
    if (t > 0.98) t = 0.98;
    return [ca + (cb - ca) * t, ra + (rb - ra) * t];
  };

  const cr = new Array<number>(4);
  const cc = new Array<number>(4);
  const cv = new Array<number>(4);
  const ins = new Array<boolean>(4);
  const edgeId = new Array<number>(4);
  for (let r = r0 - 1; r <= r1; r++) {
    for (let c = c0 - 1; c <= c1; c++) {
      // Corners clockwise on screen (row down): TL, TR, BR, BL. Edge k joins corner k and k+1.
      cr[0] = r; cc[0] = c;
      cr[1] = r; cc[1] = c + 1;
      cr[2] = r + 1; cc[2] = c + 1;
      cr[3] = r + 1; cc[3] = c;
      let mask = 0;
      for (let k = 0; k < 4; k++) {
        cv[k] = val(cr[k]!, cc[k]!);
        ins[k] = cv[k]! <= level;
        if (ins[k]) mask |= 1 << k;
      }
      if (mask === 0 || mask === 15) continue;
      edgeId[0] = hEdge(r, c);
      edgeId[1] = vEdge(r, c + 1);
      edgeId[2] = hEdge(r + 1, c);
      edgeId[3] = vEdge(r, c);
      const starts: number[] = []; // in -> out (walking clockwise)
      const ends: number[] = []; // out -> in
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) & 3;
        if (ins[k] === ins[k2]) continue;
        const id = edgeId[k]!;
        if (!pos.has(id)) pos.set(id, crossing(cr[k]!, cc[k]!, cv[k]!, cr[k2]!, cc[k2]!, cv[k2]!));
        if (ins[k]) starts.push(k);
        else ends.push(k);
      }
      if (starts.length === 1) {
        next.set(edgeId[starts[0]!]!, edgeId[ends[0]!]!);
      } else {
        // Saddle: starts are edges {0, 2} or {1, 3}. Decide connectivity from the centre value.
        const finite = cv.every((x) => Number.isFinite(x));
        const centre = finite ? (cv[0]! + cv[1]! + cv[2]! + cv[3]!) / 4 : Infinity;
        const connected = centre <= level;
        for (const s of starts) {
          // Connected: the inside passes through the centre, so each start pairs with the next edge
          // clockwise; separated: each inside corner is cut off, pairing with the previous edge.
          const e = connected ? (s + 1) & 3 : (s + 3) & 3;
          next.set(edgeId[s]!, edgeId[e]!);
        }
      }
    }
  }

  const rings: Pt[][] = [];
  for (const first of next.keys()) {
    if (!next.has(first)) continue;
    const ring: Pt[] = [];
    let id = first;
    for (;;) {
      const nx = next.get(id);
      if (nx === undefined) break;
      next.delete(id);
      ring.push(pos.get(id)!);
      id = nx;
      if (id === first) break;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function formatBudget(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s - h * 3600) / 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/**
 * Walk-limit rings: for each budget, the area where outTimeS + backTimeS <= budget, as GeoJSON
 * MultiPolygon coordinates ([lon, lat], outer rings counter-clockwise, holes clockwise, closed).
 */
export interface ReachRingOptions {
  /** Drop rings (islands and holes) smaller than this, m^2. Default 16 m^2 (4 cells on the 2 m grid). */
  minRingAreaM2?: number;
  /** Douglas-Peucker tolerance in cells after one Chaikin smoothing pass. Default 0.35. */
  simplifyCells?: number;
}

/** The area where value(i) <= threshold, as GeoJSON MultiPolygon coordinates. */
function ringCoordinates(
  grid: GridSpec,
  value: (i: number) => number,
  threshold: number,
  options: ReachRingOptions,
): number[][][][] {
  const minArea = (options.minRingAreaM2 ?? 16) / (grid.cellSizeM * grid.cellSizeM);
  const tol = options.simplifyCells ?? 0.35;
  const raw = isolines(grid.width, grid.height, value, threshold);
  const rings = raw
    .filter((r) => Math.abs(signedArea(r)) >= minArea)
    .map((r) => simplifyRing(chaikin(r), tol))
    .filter((r) => r.length >= 3);
  // The largest ring is always an outer ring; its sign tells outer from hole.
  let outerSign = 1, maxA = 0;
  for (const r of rings) {
    const a = signedArea(r);
    if (Math.abs(a) > maxA) {
      maxA = Math.abs(a);
      outerSign = Math.sign(a);
    }
  }
  const outers: { ring: Pt[]; area: number; holes: Pt[][] }[] = [];
  const holes: Pt[][] = [];
  for (const r of rings) {
    const a = signedArea(r);
    if (Math.sign(a) === outerSign) outers.push({ ring: r, area: Math.abs(a), holes: [] });
    else holes.push(r);
  }
  outers.sort((a, b) => a.area - b.area);
  for (const h of holes) {
    const owner = outers.find((o) => pointInRing(h[0]!, o.ring));
    if (owner) owner.holes.push(h);
  }
  const toLonLat = (r: Pt[], ccw: boolean): number[][] => {
    const ll = r.map(([x, y]) => rowColToLonLat(grid, y, x) as number[]);
    // Orientation in lon/lat (x east, y north): shoelace sign.
    let a = 0;
    for (let i = 0, j = ll.length - 1; i < ll.length; j = i++) a += (ll[j]![0]! - ll[i]![0]!) * (ll[j]![1]! + ll[i]![1]!);
    const isCcw = a > 0; // sum (xj - xi)(yj + yi) is positive for counter-clockwise
    if (isCcw !== ccw) ll.reverse();
    ll.push([ll[0]![0]!, ll[0]![1]!]);
    return ll;
  };
  const coordinates = outers.map((o) => [toLonLat(o.ring, true), ...o.holes.map((h) => toLonLat(h, false))]);
  return coordinates;
}

export function reachRings(
  grid: GridSpec,
  reach: ReachField,
  budgetsS: number[],
  options: ReachRingOptions = {},
): ReachRing[] {
  const { outTimeS, backTimeS } = reach;
  const value = (i: number) => outTimeS[i]! + backTimeS[i]!;
  return budgetsS.map((budgetS) => ({
    id: `reach-${Math.round(budgetS)}`,
    label: `${formatBudget(budgetS)} round trip`,
    budgetS,
    coordinates: ringCoordinates(grid, value, budgetS, options),
  }));
}

/**
 * The walk limit: everywhere a crew can walk to, work for `dwellS` and walk home from without
 * any budget (time, energy, oxygen) going past its usable share (budget x (1 - reserveFraction)).
 * `limitedBy` is the budget that runs out first along most of the ring. `budgetS` is the
 * round-trip walking time left by the time limit alone, for labelling.
 */
export function walkLimitRing(
  grid: GridSpec,
  reach: ReachField,
  params: WalkParams,
  dwellS: number = params.stopDwellS,
  options: ReachRingOptions = {},
): ReachRing {
  const keep = 1 - params.reserveFraction;
  const tLim = params.evaLimitS * keep;
  const eLim = params.energyBudgetKJ * keep;
  const o2On = oxygenModelOn(params);
  const oLim = o2On ? params.o2BudgetKg! * keep : Infinity;
  const dwellE = (dwellS * (params.dwellMetabolicW ?? 0)) / 1000;
  const { outTimeS, backTimeS, outEnergyKJ, backEnergyKJ } = reach;
  const fractions = (i: number): [number, number, number] => {
    const t = outTimeS[i]! + backTimeS[i]! + dwellS;
    const e = outEnergyKJ[i]! + backEnergyKJ[i]! + dwellE;
    return [t / tLim, e / eLim, o2On ? oxygenUsedKg(params, t, e) / oLim : 0];
  };
  const value = (i: number) => {
    const f = fractions(i);
    const m = Math.max(f[0], f[1], f[2]);
    return Number.isNaN(m) ? Infinity : m;
  };
  // Tally the largest fraction over the cells just inside the limit.
  const votes = [0, 0, 0];
  const n = grid.width * grid.height;
  for (let i = 0; i < n; i++) {
    const f = fractions(i);
    const m = Math.max(f[0], f[1], f[2]);
    if (m > 0.9 && m <= 1) votes[f[0] >= m ? 0 : f[1] >= m ? 1 : 2]!++;
  }
  const names = ["time", "energy", "oxygen"] as const;
  const limitedBy = names[votes.indexOf(Math.max(...votes))]!;
  const budgetS = Math.max(0, tLim - dwellS);
  return {
    id: "reach-limit",
    label: `walk limit (${limitedBy})`,
    budgetS,
    coordinates: ringCoordinates(grid, value, 1, options),
    kind: "limit",
    limitedBy,
  };
}
