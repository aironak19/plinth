/** Plan-editor geometry helpers: hit testing, snapping, automatic dimension chains. */
import type { BuildingModel, ElementRef, Id, ProjectDoc, Wall } from '../../core/model/types';
import type { DerivedLevel } from '../../core/derive/level';
import { ASSET_BY_ID } from '../../core/catalog/assets';
import { computeStair } from '../../core/derive/stairs';
import { type Vec2, add, dist, mid, norm, perp, projectToSegment, rotate, scale, sub, dot, lineParam } from '../../core/geometry/vec';
import { pointInPolygon } from '../../core/geometry/polygon';
import type { RuleSet } from '../../core/rules/rulesets';
import { openingsOf, isDoor } from '../../core/model/query';

export const ringD = (pts: Vec2[]) => (pts.length ? `M${pts.map((p) => `${r1(p.x)} ${r1(-p.y)}`).join('L')}Z` : '');
export const lineD = (pts: Vec2[]) => (pts.length ? `M${pts.map((p) => `${r1(p.x)} ${r1(-p.y)}`).join('L')}` : '');
const r1 = (v: number) => Math.round(v * 10) / 10;

export function furnitureBox(b: BuildingModel, id: Id): Vec2[] | null {
  const f = b.furniture[id];
  const a = f && ASSET_BY_ID[f.assetId];
  if (!a) return null;
  const w = f.size?.w ?? a.size.w, d = f.size?.d ?? a.size.d;
  const rot = (f.rotation * Math.PI) / 180;
  return [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }].map((p) => add(rotate(p, rot), f.position));
}

export function hitTest(doc: ProjectDoc, b: BuildingModel, dl: DerivedLevel, p: Vec2, tol: number, rules: RuleSet, opts: { site: boolean; furniture: boolean }): ElementRef | null {
  const levelId = dl.level.id;
  // openings first (they sit inside walls)
  for (const w of dl.walls) {
    for (const o of openingsOf(b, w.id)) {
      const d = norm(sub(w.b, w.a));
      const s = lineParam(p, w.a, w.b) * dist(w.a, w.b);
      const across = Math.abs(dot(sub(p, w.a), perp(d)));
      if (Math.abs(s - o.offset) <= o.width / 2 && across <= w.thickness / 2 + tol) return { kind: isDoor(o) ? 'door' : 'window', id: o.id };
    }
  }
  if (opts.furniture) {
    const items = Object.values(b.furniture).filter((f) => f.levelId === levelId)
      .map((f) => ({ f, box: furnitureBox(b, f.id), area: (ASSET_BY_ID[f.assetId]?.size.w ?? 0) * (ASSET_BY_ID[f.assetId]?.size.d ?? 0) }))
      .filter((x) => x.box && pointInPolygon(p, x.box)).sort((x, y) => x.area - y.area);
    if (items[0]) return { kind: 'furniture', id: items[0].f.id };
  }
  for (const c of Object.values(b.columns)) if (c.levelId === levelId && dist(c.position, p) <= Math.max(c.width, c.depth) / 2 + tol) return { kind: 'column', id: c.id };
  for (const s of Object.values(b.stairs)) {
    if (s.levelId !== levelId) continue;
    const info = computeStair(s, b.levels[levelId], rules);
    if (pointInPolygon(p, info.footprint)) return { kind: 'stair', id: s.id };
  }
  let best: { id: Id; d: number } | null = null;
  for (const w of dl.walls) {
    const pr = projectToSegment(p, w.a, w.b);
    if (pr.dist <= w.thickness / 2 + tol && (!best || pr.dist < best.d)) best = { id: w.id, d: pr.dist };
  }
  if (best) return { kind: 'wall', id: best.id };
  for (const r of dl.rooms) if (r.tagId && pointInPolygon(p, r.polygon)) return { kind: 'room', id: r.tagId };
  if (opts.site) {
    // Hedges, fences and garden walls first — they are thin and sit on top of the surfaces.
    for (const f of Object.values(doc.site.features)) {
      if (!f.path || f.path.length < 2) continue;
      const half = Number(f.props.width ?? (f.kind === 'hedge' ? 600 : 200)) / 2 + tol;
      for (let i = 0; i + 1 < f.path.length; i++) if (projectToSegment(p, f.path[i], f.path[i + 1]).dist <= half) return { kind: 'siteFeature', id: f.id };
    }
    // Smallest surface under the cursor wins, so a bed inside a lawn can be picked.
    let hit: { id: Id; a: number } | null = null;
    for (const f of Object.values(doc.site.features)) if (f.polygon && pointInPolygon(p, f.polygon)) { const a = Math.abs(f.polygon.reduce((acc, q, i) => { const n = f.polygon![(i + 1) % f.polygon!.length]; return acc + q.x * n.y - n.x * q.y; }, 0)); if (!hit || a < hit.a) hit = { id: f.id, a }; }
    if (hit) return { kind: 'siteFeature', id: hit.id };
  }
  return null;
}

export interface Snap { p: Vec2; kind: 'endpoint' | 'midpoint' | 'intersection' | 'wall' | 'align' | 'grid' | 'none'; guides: [Vec2, Vec2][] }

export function snapPoint(raw: Vec2, walls: Wall[], tol: number, gridStep: number, opts: { endpoints: boolean; grid: boolean; from?: Vec2 | null; ortho: boolean; exclude?: Set<Id> }): Snap {
  let p = raw;
  const guides: [Vec2, Vec2][] = [];
  // Ortho constraint relative to the previous point.
  if (opts.from && opts.ortho) {
    const d = sub(raw, opts.from);
    const ang = Math.atan2(d.y, d.x);
    const step = Math.PI / 4;
    const snapped = Math.round(ang / step) * step;
    const L = Math.hypot(d.x, d.y);
    const onAxis = Math.abs(Math.round(ang / (Math.PI / 2)) * (Math.PI / 2) - ang) < 0.14;
    const use = onAxis ? Math.round(ang / (Math.PI / 2)) * (Math.PI / 2) : Math.abs(snapped - ang) < 0.08 ? snapped : ang;
    p = add(opts.from, { x: Math.cos(use) * L, y: Math.sin(use) * L });
  }
  const live = walls.filter((w) => !opts.exclude?.has(w.id));
  if (opts.endpoints) {
    let best: { p: Vec2; d: number; kind: Snap['kind'] } | null = null;
    for (const w of live) for (const q of [w.a, w.b]) { const d = dist(q, raw); if (d < tol && (!best || d < best.d)) best = { p: q, d, kind: 'endpoint' }; }
    if (!best) for (const w of live) {
      const m = mid(w.a, w.b);
      const dm = dist(m, raw);
      if (dm < tol * 0.8 && (!best || dm < best.d)) best = { p: m, d: dm, kind: 'midpoint' };
    }
    if (best) return { p: best.p, kind: best.kind, guides };
    // alignment with existing endpoints (both axes → intersection)
    let ax: Vec2 | null = null, ay: Vec2 | null = null;
    for (const w of live) for (const q of [w.a, w.b]) {
      if (Math.abs(q.x - p.x) < tol * 0.6 && (!ax || Math.abs(q.x - p.x) < Math.abs(ax.x - p.x))) ax = q;
      if (Math.abs(q.y - p.y) < tol * 0.6 && (!ay || Math.abs(q.y - p.y) < Math.abs(ay.y - p.y))) ay = q;
    }
    if (ax || ay) {
      const free = !opts.from || !opts.ortho;
      const np = { x: ax ? ax.x : p.x, y: ay ? ay.y : p.y };
      // keep the ortho direction when constrained
      if (!free && opts.from) {
        if (Math.abs(p.x - opts.from.x) < 1) np.x = opts.from.x;
        if (Math.abs(p.y - opts.from.y) < 1) np.y = opts.from.y;
      }
      if (ax) guides.push([ax, { x: ax.x, y: np.y }]);
      if (ay) guides.push([ay, { x: np.x, y: ay.y }]);
      return { p: np, kind: ax && ay ? 'intersection' : 'align', guides };
    }
    for (const w of live) {
      const pr = projectToSegment(p, w.a, w.b);
      if (pr.dist < tol * 0.7 && pr.t > 0.02 && pr.t < 0.98) return { p: pr.point, kind: 'wall', guides };
    }
  }
  if (opts.grid && gridStep > 0) {
    if (opts.from) {
      // snap the *length* to the grid increment, keeping direction
      const d = sub(p, opts.from);
      const L = Math.hypot(d.x, d.y);
      if (L > 1) { const Ls = Math.round(L / gridStep) * gridStep; return { p: add(opts.from, scale(norm(d), Ls)), kind: 'grid', guides }; }
    }
    return { p: { x: Math.round(p.x / gridStep) * gridStep, y: Math.round(p.y / gridStep) * gridStep }, kind: 'grid', guides };
  }
  return { p, kind: 'none', guides };
}

/** Exterior dimension chains along the bottom and left of a level's footprint. */
export function dimensionChains(dl: DerivedLevel): { a: Vec2; b: Vec2; offset: Vec2; overall?: boolean }[] {
  const out: { a: Vec2; b: Vec2; offset: Vec2; overall?: boolean }[] = [];
  const fp = dl.footprint;
  if (!fp.length) return out;
  const xs = fp.flatMap((f) => f.map((p) => p.x)), ys = fp.flatMap((f) => f.map((p) => p.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  out.push({ a: { x: minX, y: minY }, b: { x: maxX, y: minY }, offset: { x: 0, y: -1700 }, overall: true });
  out.push({ a: { x: minX, y: minY }, b: { x: minX, y: maxY }, offset: { x: -1700, y: 0 }, overall: true });
  // chain: wall centre-lines meeting the bottom/left exterior faces
  // Room-by-room chains on all four sides: wall centre-lines meeting each exterior face.
  const bottomXs = new Set<number>([minX, maxX]), topXs = new Set<number>([minX, maxX]);
  const leftYs = new Set<number>([minY, maxY]), rightYs = new Set<number>([minY, maxY]);
  for (const w of dl.walls) {
    if (w.kind === 'parapet') continue;
    const vertical = Math.abs(w.a.x - w.b.x) < 5, horizontal = Math.abs(w.a.y - w.b.y) < 5;
    if (vertical && Math.min(w.a.y, w.b.y) - minY < 400) bottomXs.add(Math.round(w.a.x));
    if (vertical && maxY - Math.max(w.a.y, w.b.y) < 400) topXs.add(Math.round(w.a.x));
    if (horizontal && Math.min(w.a.x, w.b.x) - minX < 400) leftYs.add(Math.round(w.a.y));
    if (horizontal && maxX - Math.max(w.a.x, w.b.x) < 400) rightYs.add(Math.round(w.a.y));
  }
  const chain = (vals: Set<number>, seg: (a: number, b: number) => { a: Vec2; b: Vec2; offset: Vec2 }) => {
    const v = [...vals].sort((a, b) => a - b);
    if (v.length < 3) return; // a single span repeats the overall dimension
    for (let i = 0; i + 1 < v.length; i++) if (v[i + 1] - v[i] > 300) out.push(seg(v[i], v[i + 1]));
  };
  chain(bottomXs, (a, b) => ({ a: { x: a, y: minY }, b: { x: b, y: minY }, offset: { x: 0, y: -900 } }));
  chain(topXs, (a, b) => ({ a: { x: a, y: maxY }, b: { x: b, y: maxY }, offset: { x: 0, y: 900 } }));
  chain(leftYs, (a, b) => ({ a: { x: minX, y: a }, b: { x: minX, y: b }, offset: { x: -900, y: 0 } }));
  chain(rightYs, (a, b) => ({ a: { x: maxX, y: a }, b: { x: maxX, y: b }, offset: { x: 900, y: 0 } }));
  return out;
}
