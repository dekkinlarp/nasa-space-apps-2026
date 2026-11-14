/**
 * Generic 8-connected grid search. Knows nothing about Mars: it gets a step-cost function
 * (weighted cost, Infinity = impassable) and an optional cell mask used to stop diagonal
 * moves squeezing between two blocked cells.
 */

export interface GridGraph {
  width: number;
  height: number;
  cellSizeM: number;
  /** 1 = cell can never be entered. Also forbids diagonal corner-cutting past it. */
  blocked?: Uint8Array;
}

export type StepCostFn = (from: number, to: number, distanceM: number) => number;

const SQRT2 = Math.SQRT2;
const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];
const DIAG = [true, false, true, false, false, true, false, true];

/** Binary min-heap of (key: float64, value: int32) in typed arrays. Lazy deletion is up to the caller. */
export class MinHeap {
  keys: Float64Array;
  vals: Int32Array;
  size = 0;
  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }
  clear(): void {
    this.size = 0;
  }
  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    const keys = this.keys;
    const vals = this.vals;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = keys[p]!;
      if (pk <= key) break;
      keys[i] = pk;
      vals[i] = vals[p]!;
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  /** Key of the minimum element (undefined behaviour when empty). */
  peekKey(): number {
    return this.keys[0]!;
  }
  /** Removes the minimum and returns its value. */
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0]!;
    const n = --this.size;
    if (n > 0) {
      const key = keys[n]!;
      const val = vals[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        const r = c + 1;
        if (r < n && keys[r]! < keys[c]!) c = r;
        if (keys[c]! >= key) break;
        keys[i] = keys[c]!;
        vals[i] = vals[c]!;
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

/** Reusable per-size scratch arrays so repeated searches do not reallocate 2 M-cell buffers. */
class Workspace {
  g: Float64Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  gen = 0;
  heap = new MinHeap(1 << 14);
  constructor(readonly n: number) {
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }
  next(): number {
    this.gen++;
    if (this.gen === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    this.heap.clear();
    return this.gen;
  }
}
let workspace: Workspace | null = null;
function getWorkspace(n: number): Workspace {
  if (!workspace || workspace.n !== n) workspace = new Workspace(n);
  return workspace;
}

export interface AStarResult {
  /** Cell indices from start to goal inclusive, or null if unreachable. */
  path: Int32Array | null;
  cost: number;
  expanded: number;
}

/**
 * A* from `start` to `goal`. `heuristicRatePerM` must be a lower bound on cost per metre
 * (0 turns this into Dijkstra); the heuristic is octile distance x rate, which is admissible
 * and consistent for 8-connected moves.
 */
export function astar(
  graph: GridGraph,
  stepCost: StepCostFn,
  start: number,
  goal: number,
  heuristicRatePerM = 0,
): AStarResult {
  const { width: W, height: H, cellSizeM: cs } = graph;
  const n = W * H;
  if (start < 0 || start >= n || goal < 0 || goal >= n) return { path: null, cost: Infinity, expanded: 0 };
  if (start === goal) return { path: Int32Array.of(start), cost: 0, expanded: 0 };
  const blocked = graph.blocked;
  const ws = getWorkspace(n);
  const gen = ws.next();
  const { g, parent, seen, closed, heap } = ws;
  const goalR = (goal / W) | 0;
  const goalC = goal - goalR * W;
  const hRate = heuristicRatePerM * cs;
  const diagStep = cs * SQRT2;

  g[start] = 0;
  parent[start] = -1;
  seen[start] = gen;
  heap.push(0, start);
  let expanded = 0;

  while (heap.size > 0) {
    const u = heap.pop();
    if (closed[u] === gen) continue;
    closed[u] = gen;
    if (u === goal) break;
    expanded++;
    const gu = g[u]!;
    const ur = (u / W) | 0;
    const uc = u - ur * W;
    for (let k = 0; k < 8; k++) {
      const vr = ur + DR[k]!;
      const vc = uc + DC[k]!;
      if (vr < 0 || vr >= H || vc < 0 || vc >= W) continue;
      const v = vr * W + vc;
      if (closed[v] === gen) continue;
      const diag = DIAG[k]!;
      if (blocked) {
        if (blocked[v] === 1) continue;
        if (diag && (blocked[ur * W + vc] === 1 || blocked[vr * W + uc] === 1)) continue;
      }
      const c = stepCost(u, v, diag ? diagStep : cs);
      if (c === Infinity || c !== c) continue;
      const gv = gu + c;
      if (seen[v] === gen && gv >= g[v]!) continue;
      seen[v] = gen;
      g[v] = gv;
      parent[v] = u;
      let dx = vc - goalC;
      let dy = vr - goalR;
      if (dx < 0) dx = -dx;
      if (dy < 0) dy = -dy;
      const h = dx > dy ? dx - dy + SQRT2 * dy : dy - dx + SQRT2 * dx;
      heap.push(gv + h * hRate, v);
    }
  }

  if (closed[goal] !== gen) return { path: null, cost: Infinity, expanded };
  let len = 1;
  for (let c = goal; c !== start; c = parent[c]!) len++;
  const path = new Int32Array(len);
  let c = goal;
  for (let i = len - 1; i >= 0; i--) {
    path[i] = c;
    c = parent[c]!;
  }
  return { path, cost: g[goal]!, expanded };
}

export interface FloodOptions {
  /**
   * Reverse the step direction: cost[v] becomes the cost of walking from v TO the source
   * (stepCost is called as stepCost(v, u, d)). Needed because uphill != downhill.
   */
  reverse?: boolean;
  /** Stop expanding once the cheapest open cell exceeds this cost. Cells beyond stay Infinity. */
  maxCost?: number;
}

export interface FloodResult {
  /** Cheapest cost to/from the source per cell; Infinity where unreachable. */
  cost: Float64Array;
  /** Next cell towards the source on the cheapest path (-1 at the source / unreached). */
  parent: Int32Array;
  /** Cells in the order they were settled (parents always precede children). */
  order: Int32Array;
  count: number;
}

/** Dijkstra flood from a source cell over the whole grid (or up to maxCost). */
export function flood(graph: GridGraph, stepCost: StepCostFn, source: number, options: FloodOptions = {}): FloodResult {
  const { width: W, height: H, cellSizeM: cs } = graph;
  const n = W * H;
  const cost = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  if (source < 0 || source >= n) return { cost, parent, order, count: 0 };
  const reverse = options.reverse === true;
  const maxCost = options.maxCost ?? Infinity;
  const blocked = graph.blocked;
  const closed = new Uint8Array(n);
  const heap = new MinHeap(1 << 16);
  const diagStep = cs * SQRT2;
  let count = 0;

  cost[source] = 0;
  heap.push(0, source);
  while (heap.size > 0) {
    if (heap.peekKey() > maxCost) break;
    const u = heap.pop();
    if (closed[u] === 1) continue;
    closed[u] = 1;
    order[count++] = u;
    const cu = cost[u]!;
    const ur = (u / W) | 0;
    const uc = u - ur * W;
    for (let k = 0; k < 8; k++) {
      const vr = ur + DR[k]!;
      const vc = uc + DC[k]!;
      if (vr < 0 || vr >= H || vc < 0 || vc >= W) continue;
      const v = vr * W + vc;
      if (closed[v] === 1) continue;
      const diag = DIAG[k]!;
      if (blocked) {
        // Reverse floods walk *from* v, so v must still be a legal cell to stand on.
        if (blocked[v] === 1) continue;
        if (diag && (blocked[ur * W + vc] === 1 || blocked[vr * W + uc] === 1)) continue;
      }
      const d = diag ? diagStep : cs;
      const c = reverse ? stepCost(v, u, d) : stepCost(u, v, d);
      if (c === Infinity || c !== c) continue;
      const cv = cu + c;
      if (cv >= cost[v]!) continue;
      cost[v] = cv;
      parent[v] = u;
      heap.push(cv, v);
    }
  }
  // Cells pushed but never settled because of the cutoff are not reachable within budget.
  if (maxCost !== Infinity) {
    for (let i = 0; i < n; i++) {
      if (closed[i] === 0 && cost[i] !== Infinity) {
        cost[i] = Infinity;
        parent[i] = -1;
      }
    }
  }
  return { cost, parent, order, count };
}
