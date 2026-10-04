/**
 * Wall join resolution. Produces a clean outline quad for every wall with mitred
 * L-corners, trimmed T-junctions and continuations — so plans show clean poché
 * and 3D walls never overlap or z-fight at corners.
 */
import type { Id, Wall } from '../model/types';
import { type Vec2, add, cross, dist, dot, lineIntersection, norm, perp, projectToSegment, scale, sub } from '../geometry/vec';

export interface WallOutline {
  wallId: Id;
  /** [aLeft, bLeft, bRight, aRight] — left is relative to the a→b direction. */
  quad: [Vec2, Vec2, Vec2, Vec2];
  capA: boolean;
  capB: boolean;
}

interface EndInfo { wall: Wall; end: 'a' | 'b'; p: Vec2; away: Vec2 }

const TOL = 15;

export function computeWallOutlines(walls: Wall[]): Map<Id, WallOutline> {
  const ends: EndInfo[] = [];
  for (const w of walls) {
    const d = norm(sub(w.b, w.a));
    ends.push({ wall: w, end: 'a', p: w.a, away: d });
    ends.push({ wall: w, end: 'b', p: w.b, away: scale(d, -1) });
  }
  // bucket endpoints for quick lookup
  const cell = 500;
  const bucket = new Map<string, EndInfo[]>();
  for (const e of ends) {
    const k = `${Math.round(e.p.x / cell)},${Math.round(e.p.y / cell)}`;
    (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(e);
  }
  const endsNear = (p: Vec2, self: Wall) => {
    const res: EndInfo[] = [];
    const cx = Math.round(p.x / cell), cy = Math.round(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const e of bucket.get(`${cx + dx},${cy + dy}`) ?? []) if (e.wall.id !== self.id && dist(e.p, p) <= TOL) res.push(e);
    return res;
  };
  const throughWalls = (p: Vec2, self: Wall) =>
    walls.filter((o) => {
      if (o.id === self.id) return false;
      const pr = projectToSegment(p, o.a, o.b);
      if (pr.dist > TOL) return false;
      const l = dist(o.a, o.b);
      return pr.t * l > TOL && (1 - pr.t) * l > TOL;
    });

  const out = new Map<Id, WallOutline>();
  for (const w of walls) {
    const res = { a: endPoints(w, 'a'), b: endPoints(w, 'b') };
    out.set(w.id, { wallId: w.id, quad: [res.a.left, res.b.left, res.b.right, res.a.right], capA: res.a.cap, capB: res.b.cap });
  }
  return out;

  function endPoints(w: Wall, end: 'a' | 'b'): { left: Vec2; right: Vec2; cap: boolean } {
    const P = end === 'a' ? w.a : w.b;
    const Q = end === 'a' ? w.b : w.a;
    const natural = norm(sub(w.b, w.a));
    const N = perp(natural);
    const u = norm(sub(P, Q)); // direction travelling towards P
    const nu = perp(u);
    const half = w.thickness / 2;
    const square = () => ({ l: add(P, scale(nu, half)), r: add(P, scale(nu, -half)) });
    const assign = (p1: Vec2, p2: Vec2, cap: boolean) => {
      const s1 = dot(sub(p1, P), N);
      return s1 >= 0 ? { left: p1, right: p2, cap } : { left: p2, right: p1, cap };
    };
    const limit = Math.max(w.thickness, 100) * 4;
    const safe = (x: Vec2 | null, fallback: Vec2) => (x && dist(x, P) < limit ? x : fallback);

    // T-junction: P lies on another wall's interior.
    const through = throughWalls(P, w);
    if (through.length) {
      const T = through[0];
      const dT = norm(sub(T.b, T.a));
      const nT = perp(dT);
      const side = Math.sign(cross(dT, sub(Q, T.a))) || 1;
      const faceP = add(T.a, scale(nT, (side * T.thickness) / 2));
      const sq = square();
      const l = safe(lineIntersection(sq.l, u, faceP, dT), sq.l);
      const r = safe(lineIntersection(sq.r, u, faceP, dT), sq.r);
      return assign(l, r, false);
    }

    const others = endsNear(P, w);
    if (!others.length) {
      const sq = square();
      return assign(sq.l, sq.r, true);
    }
    // Continuation of a collinear wall → square end, no cap.
    const collinear = others.find((o) => Math.abs(cross(u, o.away)) < 0.02 && dot(u, o.away) > 0);
    if (collinear && others.length <= 2) {
      if (others.length === 1) { const sq = square(); return assign(sq.l, sq.r, false); }
    }
    if (others.length === 1) {
      const O = others[0];
      const v = O.away;
      const nv = perp(v);
      const hO = O.wall.thickness / 2;
      const sq = square();
      const l = safe(lineIntersection(sq.l, u, add(P, scale(nv, hO)), v), sq.l);
      const r = safe(lineIntersection(sq.r, u, add(P, scale(nv, -hO)), v), sq.r);
      return assign(l, r, false);
    }
    // Three or more walls meet at P.
    if (collinear) { const sq = square(); return assign(sq.l, sq.r, false); }
    for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) {
      const A = others[i], B = others[j];
      if (Math.abs(cross(A.away, B.away)) < 0.02 && dot(A.away, B.away) < 0) {
        // A and B form a through wall; this wall tees into it.
        const dT = A.away;
        const nT = perp(dT);
        const side = Math.sign(cross(dT, sub(Q, P))) || 1;
        const tT = Math.max(A.wall.thickness, B.wall.thickness);
        const faceP = add(P, scale(nT, (side * tT) / 2));
        const sq = square();
        return assign(safe(lineIntersection(sq.l, u, faceP, dT), sq.l), safe(lineIntersection(sq.r, u, faceP, dT), sq.r), false);
      }
    }
    const sq = square();
    return assign(sq.l, sq.r, false);
  }
}

/** Point on a wall face at distance `s` along the wall from `a`, offset across by `across` (positive = left). */
export function wallPoint(w: Wall, s: number, across: number): Vec2 {
  const d = norm(sub(w.b, w.a));
  return add(add(w.a, scale(d, s)), scale(perp(d), across));
}

/** Endpoints connectivity: wall ends that touch nothing (used by validation). */
export function freeEnds(walls: Wall[]): { wallId: Id; end: 'a' | 'b'; p: Vec2 }[] {
  const res: { wallId: Id; end: 'a' | 'b'; p: Vec2 }[] = [];
  for (const w of walls) for (const end of ['a', 'b'] as const) {
    const p = w[end];
    const touches = walls.some((o) => o.id !== w.id && projectToSegment(p, o.a, o.b).dist <= TOL);
    if (!touches) res.push({ wallId: w.id, end, p });
  }
  return res;
}
