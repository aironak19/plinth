/** 2D / 3D vector maths. Plan space: x → east, y → north, millimetres. */

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export const EPS = 1e-6;

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left-hand normal (CCW rotation by 90°). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function rotate(p: Vec2, angleRad: number, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  const dx = p.x - origin.x, dy = p.y - origin.y;
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
}

export const near = (a: Vec2, b: Vec2, tol = 1) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && dist(a, b) <= tol;

export const angleOf = (a: Vec2) => Math.atan2(a.y, a.x);

/** Closest point on segment ab to p. `t` is the 0..1 parameter along ab. */
export function projectToSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = add(a, scale(ab, t));
  return { t, point, dist: dist(p, point) };
}

/** Parameter of p's projection onto the infinite line through ab (unclamped). */
export function lineParam(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  return l2 < EPS ? 0 : dot(sub(p, a), ab) / l2;
}

/** Signed perpendicular distance from p to the line ab (positive on the left). */
export function signedDistToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d = norm(sub(b, a));
  return cross(d, sub(p, a));
}

/** Intersection of two segments. Returns params t (on ab) and u (on cd). */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2, eps = 1e-9): { t: number; u: number; point: Vec2 } | null {
  const r = sub(b, a), s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) < eps * len(r) * len(s)) return null;
  const ca = sub(c, a);
  const t = cross(ca, s) / denom;
  const u = cross(ca, r) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, point: add(a, scale(r, t)) };
}

/** Intersection of two infinite lines given as point + direction. */
export function lineIntersection(p: Vec2, dp: Vec2, q: Vec2, dq: Vec2): Vec2 | null {
  const denom = cross(dp, dq);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(q, p), dq) / denom;
  return add(p, scale(dp, t));
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  return l < EPS ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** Newell's method — robust normal for any planar polygon. */
export function polygonNormal3(pts: Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return norm3({ x: nx, y: ny, z: nz });
}

export const round = (v: number, step = 1) => Math.round(v / step) * step;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
