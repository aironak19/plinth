/**
 * Planar graph & face detection.
 *
 * Wall centre-lines form a planar graph. Rooms are its bounded faces — so rooms
 * are never drawn separately; they are *discovered* from the walls, and any
 * change to a wall automatically re-derives every room it touches.
 */
import { type Vec2, angleOf, dist, lineParam, projectToSegment, segmentIntersection, sub } from './vec';
import { signedArea } from './polygon';

export interface PlanarEdgeInput { id: string; a: Vec2; b: Vec2 }

export interface Face {
  /** CCW loop of node positions. */
  loop: Vec2[];
  /** For each loop segment i (loop[i] → loop[i+1]) the id of the source edge. */
  edgeIds: string[];
  area: number;
}

export interface PlanarGraph {
  nodes: Vec2[];
  /** Undirected sub-edges after splitting at junctions. */
  edges: { u: number; v: number; id: string }[];
}

/** Spatial hash that merges points closer than `tol`. */
class NodeIndex {
  nodes: Vec2[] = [];
  private cells = new Map<string, number[]>();
  constructor(private tol: number) {}
  private key(x: number, y: number) { return `${Math.floor(x / (this.tol * 4))},${Math.floor(y / (this.tol * 4))}`; }
  get(p: Vec2): number {
    const cx = Math.floor(p.x / (this.tol * 4)), cy = Math.floor(p.y / (this.tol * 4));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const bucket = this.cells.get(`${cx + dx},${cy + dy}`);
      if (!bucket) continue;
      for (const i of bucket) if (dist(this.nodes[i], p) <= this.tol) return i;
    }
    const id = this.nodes.length;
    this.nodes.push({ x: p.x, y: p.y });
    const k = this.key(p.x, p.y);
    const b = this.cells.get(k);
    if (b) b.push(id); else this.cells.set(k, [id]);
    return id;
  }
}

export function buildPlanarGraph(input: PlanarEdgeInput[], tol = 5): PlanarGraph {
  const segs = input.filter((e) => dist(e.a, e.b) > tol);
  // Split parameters per segment.
  const splits: number[][] = segs.map(() => [0, 1]);

  // Broad phase on a coarse grid to keep this near-linear for large models.
  const cell = 3000;
  const grid = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cell), x1 = Math.floor(Math.max(s.a.x, s.b.x) / cell);
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / cell), y1 = Math.floor(Math.max(s.a.y, s.b.y) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x},${y}`;
      const b = grid.get(k);
      if (b) b.push(i); else grid.set(k, [i]);
    }
  });
  const tested = new Set<string>();
  for (const bucket of grid.values()) {
    for (let bi = 0; bi < bucket.length; bi++) for (let bj = bi + 1; bj < bucket.length; bj++) {
      const i = Math.min(bucket[bi], bucket[bj]), j = Math.max(bucket[bi], bucket[bj]);
      const key = `${i}:${j}`;
      if (tested.has(key)) continue;
      tested.add(key);
      const A = segs[i], B = segs[j];
      const x = segmentIntersection(A.a, A.b, B.a, B.b);
      if (x) { splits[i].push(x.t); splits[j].push(x.u); }
      // T-junctions and collinear overlaps: endpoints that lie on the other segment.
      for (const p of [B.a, B.b]) {
        const pr = projectToSegment(p, A.a, A.b);
        if (pr.dist <= tol) splits[i].push(lineParam(p, A.a, A.b));
      }
      for (const p of [A.a, A.b]) {
        const pr = projectToSegment(p, B.a, B.b);
        if (pr.dist <= tol) splits[j].push(lineParam(p, B.a, B.b));
      }
    }
  }

  const index = new NodeIndex(tol);
  const edgeSet = new Map<string, { u: number; v: number; id: string }>();
  segs.forEach((s, i) => {
    const ts = [...new Set(splits[i].map((t) => Math.max(0, Math.min(1, t))))].sort((a, b) => a - b);
    let prev = -1;
    for (const t of ts) {
      const p = { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
      const n = index.get(p);
      if (prev >= 0 && prev !== n) {
        const key = prev < n ? `${prev}-${n}` : `${n}-${prev}`;
        if (!edgeSet.has(key)) edgeSet.set(key, { u: prev, v: n, id: s.id });
      }
      prev = n;
    }
  });
  return { nodes: index.nodes, edges: [...edgeSet.values()] };
}

/** Find all bounded faces (CCW loops) of the graph. */
export function findFaces(graph: PlanarGraph, minArea = 1e5): Face[] {
  const { nodes, edges } = graph;
  // Directed half-edges: 2k = u→v, 2k+1 = v→u
  const out: number[][] = nodes.map(() => []);
  const from = (h: number) => (h % 2 === 0 ? edges[h >> 1].u : edges[h >> 1].v);
  const to = (h: number) => (h % 2 === 0 ? edges[h >> 1].v : edges[h >> 1].u);
  edges.forEach((_, k) => { out[edges[k].u].push(2 * k); out[edges[k].v].push(2 * k + 1); });
  const ang = (h: number) => angleOf(sub(nodes[to(h)], nodes[from(h)]));
  for (const list of out) list.sort((a, b) => ang(a) - ang(b));

  const used = new Uint8Array(edges.length * 2);
  const faces: Face[] = [];
  for (let start = 0; start < edges.length * 2; start++) {
    if (used[start]) continue;
    const loopNodes: number[] = [];
    const loopEdges: string[] = [];
    let h = start;
    let guard = 0;
    while (!used[h] && guard++ < 100000) {
      used[h] = 1;
      loopNodes.push(from(h));
      loopEdges.push(edges[h >> 1].id);
      const v = to(h);
      const twin = h ^ 1;
      const list = out[v];
      const idx = list.indexOf(twin);
      h = list[(idx - 1 + list.length) % list.length];
    }
    if (loopNodes.length < 3) continue;
    // Strip dangling spurs (a → b → a).
    let changed = true;
    while (changed && loopNodes.length >= 3) {
      changed = false;
      for (let i = 0; i < loopNodes.length; i++) {
        const n = loopNodes.length;
        if (loopNodes[(i - 1 + n) % n] === loopNodes[(i + 1) % n]) {
          const rmNodes = [i, (i + 1) % n].sort((a, b) => b - a);
          const rmEdges = [(i - 1 + n) % n, i].sort((a, b) => b - a);
          for (const r of rmNodes) loopNodes.splice(r, 1);
          for (const r of rmEdges) loopEdges.splice(r, 1);
          changed = true;
          break;
        }
      }
    }
    if (loopNodes.length < 3) continue;
    const loop = loopNodes.map((i) => nodes[i]);
    const a = signedArea(loop);
    if (a > minArea) faces.push({ loop, edgeIds: loopEdges, area: a });
  }
  return faces;
}

/** Outer boundary loops of each connected component (the "outline" of a floor). */
export function findOuterBoundaries(graph: PlanarGraph): Face[] {
  const { nodes, edges } = graph;
  const out: number[][] = nodes.map(() => []);
  const from = (h: number) => (h % 2 === 0 ? edges[h >> 1].u : edges[h >> 1].v);
  const to = (h: number) => (h % 2 === 0 ? edges[h >> 1].v : edges[h >> 1].u);
  edges.forEach((_, k) => { out[edges[k].u].push(2 * k); out[edges[k].v].push(2 * k + 1); });
  const ang = (h: number) => angleOf(sub(nodes[to(h)], nodes[from(h)]));
  for (const list of out) list.sort((a, b) => ang(a) - ang(b));
  const used = new Uint8Array(edges.length * 2);
  const faces: Face[] = [];
  for (let start = 0; start < edges.length * 2; start++) {
    if (used[start]) continue;
    const loopNodes: number[] = [];
    const loopEdges: string[] = [];
    let h = start, guard = 0;
    while (!used[h] && guard++ < 100000) {
      used[h] = 1;
      loopNodes.push(from(h));
      loopEdges.push(edges[h >> 1].id);
      const list = out[to(h)];
      const idx = list.indexOf(h ^ 1);
      h = list[(idx - 1 + list.length) % list.length];
    }
    const loop = loopNodes.map((i) => nodes[i]);
    const a = signedArea(loop);
    const n = loop.length;
    if (a < -1e5) faces.push({ loop: [...loop].reverse(), edgeIds: loop.map((_, i) => loopEdges[(n - 2 - i + n) % n]), area: -a });
  }
  return faces;
}
