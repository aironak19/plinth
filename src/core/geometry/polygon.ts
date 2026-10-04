import polygonClipping, { type MultiPolygon, type Polygon as PCPolygon } from 'polygon-clipping';
import { type Vec2, add, cross, dist, lineIntersection, norm, perp, scale, sub, projectToSegment, EPS } from './vec';

export type Polygon = Vec2[];

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

/** Signed area (positive when counter-clockwise). */
export function signedArea(pts: Polygon): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const area = (pts: Polygon) => Math.abs(signedArea(pts));

export function perimeter(pts: Polygon): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) p += dist(pts[i], pts[(i + 1) % pts.length]);
  return p;
}

export function centroid(pts: Polygon): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return scale(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function bbox(pts: Vec2[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export const bboxWidth = (b: BBox) => b.maxX - b.minX;
export const bboxHeight = (b: BBox) => b.maxY - b.minY;

export function bboxUnion(a: BBox, b: BBox): BBox {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export function rectPolygon(x: number, y: number, w: number, h: number): Polygon {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

export function pointInPolygon(p: Vec2, pts: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function ensureCCW(pts: Polygon): Polygon {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}

/** Remove duplicate and collinear vertices. */
export function simplify(pts: Polygon, tol = 1): Polygon {
  let out = pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > tol);
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      if (Math.abs(cross(sub(b, a), sub(c, b))) / Math.max(dist(a, c), EPS) < tol * 0.5 && projectToSegment(b, a, c).dist < tol) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** True when the polygon is an axis-aligned rectangle. */
export function isAxisRect(pts: Polygon, tol = 2): boolean {
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > tol && Math.abs(a.y - b.y) > tol) return false;
  }
  return true;
}

/**
 * Offset each edge of a CCW polygon inwards (to its left) by its own distance,
 * joining consecutive edges with mitres. Used to turn wall centre-line loops
 * into net room boundaries.
 */
export function offsetPolygonEdges(pts: Polygon, distances: number[]): Polygon {
  const n = pts.length;
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const d = norm(sub(q, p));
    const off = scale(perp(d), distances[i]);
    return { p: add(p, off), d, q: add(q, off) };
  });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n], cur = lines[i];
    const x = lineIntersection(prev.p, prev.d, cur.p, cur.d);
    if (x && dist(x, pts[i]) < 4 * Math.max(Math.abs(distances[i]), Math.abs(distances[(i - 1 + n) % n]), 1)) {
      out.push(x);
    } else {
      out.push(prev.q, cur.p); // parallel edges with a step, or degenerate mitre
    }
  }
  return simplify(out, 0.5);
}

// ---- Boolean operations (thin wrapper over polygon-clipping) -------------

const toRing = (pts: Polygon): [number, number][] => {
  const ring = pts.map((p) => [p.x, p.y] as [number, number]);
  if (ring.length) ring.push([ring[0][0], ring[0][1]]);
  return ring;
};

export interface PolygonWithHoles { outer: Polygon; holes: Polygon[] }

const fromMulti = (mp: MultiPolygon): PolygonWithHoles[] =>
  mp.map((poly) => {
    const rings = poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y })));
    return { outer: rings[0], holes: rings.slice(1) };
  });

const toPC = (polys: (Polygon | PolygonWithHoles)[]): PCPolygon[] =>
  polys
    .map((p) => (Array.isArray(p) ? [toRing(p)] : [toRing(p.outer), ...p.holes.map(toRing)]))
    .filter((p) => p[0].length >= 4);

export function union(polys: (Polygon | PolygonWithHoles)[]): PolygonWithHoles[] {
  const pcs = toPC(polys);
  if (!pcs.length) return [];
  try {
    return fromMulti(polygonClipping.union(pcs[0], ...pcs.slice(1)));
  } catch {
    return pcs.map((p) => ({ outer: p[0].slice(0, -1).map(([x, y]) => ({ x, y })), holes: [] }));
  }
}

export function difference(subject: (Polygon | PolygonWithHoles)[], clips: (Polygon | PolygonWithHoles)[]): PolygonWithHoles[] {
  const s = toPC(subject), c = toPC(clips);
  if (!s.length) return [];
  if (!c.length) return fromMulti(s.length > 1 ? polygonClipping.union(s[0], ...s.slice(1)) : [s[0]]);
  try {
    return fromMulti(polygonClipping.difference(s as unknown as MultiPolygon, ...c));
  } catch {
    return fromMulti(s);
  }
}

export function intersection(a: (Polygon | PolygonWithHoles)[], b: (Polygon | PolygonWithHoles)[]): PolygonWithHoles[] {
  const s = toPC(a), c = toPC(b);
  if (!s.length || !c.length) return [];
  try {
    return fromMulti(polygonClipping.intersection(s as unknown as MultiPolygon, c as unknown as MultiPolygon));
  } catch {
    return [];
  }
}

export function areaWithHoles(polys: PolygonWithHoles[]): number {
  return polys.reduce((s, p) => s + area(p.outer) - p.holes.reduce((h, r) => h + area(r), 0), 0);
}

/** Approximate a segment buffer ("capsule") as a polygon — used for setback strips. */
export function segmentBuffer(a: Vec2, b: Vec2, r: number, capSegments = 6): Polygon {
  const d = norm(sub(b, a));
  const base = Math.atan2(d.y, d.x);
  const pts: Vec2[] = [];
  for (let i = 0; i <= capSegments; i++) {
    const ang = base - Math.PI / 2 + (Math.PI * i) / capSegments;
    pts.push({ x: b.x + Math.cos(ang) * r, y: b.y + Math.sin(ang) * r });
  }
  for (let i = 0; i <= capSegments; i++) {
    const ang = base + Math.PI / 2 + (Math.PI * i) / capSegments;
    pts.push({ x: a.x + Math.cos(ang) * r, y: a.y + Math.sin(ang) * r });
  }
  return pts;
}

/** Minimum distance from a point to a polygon's boundary. */
export function distToPolygonEdge(p: Vec2, pts: Polygon): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) best = Math.min(best, projectToSegment(p, pts[i], pts[(i + 1) % pts.length]).dist);
  return best;
}

/** Intersect an infinite line (point + direction) with a polygon; returns sorted parameter intervals inside. */
export function lineClipPolygon(p: Vec2, d: Vec2, pts: Polygon): [number, number][] {
  const ts: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const e = sub(b, a);
    const denom = cross(d, e);
    if (Math.abs(denom) < 1e-9) continue;
    const t = cross(sub(a, p), e) / denom;
    const u = cross(sub(a, p), d) / denom;
    if (u >= -1e-9 && u < 1 - 1e-9) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 1e-6) out.push([ts[i], ts[i + 1]]);
  return out;
}
