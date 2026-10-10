/**
 * Block placement engine: lays a ready-made block out in world space (with
 * rotation), snaps it magnetically to existing walls, detects overlaps, finds
 * the room it should connect to — and is shared by the drag ghost in the UI and
 * the `block.place` operation, so what you see while dragging is what you get.
 */
import type { BuildingModel, Id, RoomFunction, Wall } from '../model/types';
import { BLOCK_BY_ID, blockSize, type BlockDef, type BlockPart, type BlockSize, type ItemSpec, type Side } from '../catalog/blocks';
import { ASSET_BY_ID, isOutdoorAsset } from '../catalog/assets';
import { ft } from '../units';
import { deriveLevel } from '../derive/level';
import { intersection, rectPolygon, areaWithHoles, bbox } from '../geometry/polygon';
import type { Vec2 } from '../geometry/vec';
import { generateSchemes, siteFromProgram, DEFAULT_PROGRAM, type Strategy } from './layout';
import { levelsSorted } from '../model/query';
import { validate } from '../derive/validation';
import { resolveRules } from '../rules/rulesets';
import { defaultMeta, newProjectDoc } from '../model/factory';

export interface Rect { x: number; y: number; w: number; h: number }
export interface PlacedItem { asset: string; p: Vec2; rot: number; variant?: string }
export interface PlacedPart { key: string; name: string; fn: RoomFunction; rect: Rect; open: Side[]; stair?: BlockPart['stair']; items: PlacedItem[] | null; furnish: boolean }
export interface Placement {
  def: BlockDef;
  size: BlockSize;
  rot: number;
  x: number;
  y: number;
  w: number;
  d: number;
  parts: PlacedPart[];
  site: { kind: NonNullable<BlockSize['site']>[number]['kind']; name: string; rect: Rect; material: string; cars?: number }[];
  props: PlacedItem[];
  doors: { a: string; b: string | Side; kind?: NonNullable<BlockSize['doors']>[number]['kind']; width?: number }[];
}

const SIDES: Side[] = ['s', 'e', 'n', 'w'];
export const rotSide = (s: Side, rot: number): Side => SIDES[(SIDES.indexOf(s) + Math.round(rot / 90)) % 4];
const norm90 = (r: number) => (((Math.round(r / 90) * 90) % 360) + 360) % 360;

/** Block-local mm → world mm for a given rotation (CCW, 90° steps) and origin. */
export function blockTransform(W: number, D: number, rot: number, x: number, y: number) {
  const r = norm90(rot);
  const R = (p: Vec2): Vec2 => (r === 90 ? { x: -p.y, y: p.x } : r === 180 ? { x: -p.x, y: -p.y } : r === 270 ? { x: p.y, y: -p.x } : p);
  const shift = r === 90 ? { x: D, y: 0 } : r === 180 ? { x: W, y: D } : r === 270 ? { x: 0, y: W } : { x: 0, y: 0 };
  const point = (p: Vec2): Vec2 => { const q = R(p); return { x: q.x + shift.x + x, y: q.y + shift.y + y }; };
  const rect = (rc: Rect): Rect => {
    const a = point({ x: rc.x, y: rc.y }), b = point({ x: rc.x + rc.w, y: rc.y + rc.h });
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  };
  return { point, rect, rot: r, size: r % 180 === 0 ? { w: W, d: D } : { w: D, d: W } };
}

// ------------------------------------------------------------------ kits

interface KitData { w: number; d: number; b: BuildingModel; levelId: Id; parts: { name: string; fn: RoomFunction; rect: Rect }[] }
const kitCache = new Map<string, KitData>();

/** Kits are generated once by the layout engine (best of three strategies) and cached. */
export function kitData(def: BlockDef, size: BlockSize): KitData | null {
  if (!def.kit) return null;
  const key = `${def.id}:${size.id}`;
  const hit = kitCache.get(key);
  if (hit) return hit;
  const site = siteFromProgram(ft(size.w), ft(size.d), 0, 0, 0);
  const program = { ...DEFAULT_PROGRAM, bedrooms: def.kit.bedrooms, floors: 1, pooja: !!def.kit.pooja, study: !!def.kit.study, powder: def.kit.powder !== false, family: false, parking: 0, garden: false, pool: false };
  const rules = resolveRules('in-generic');
  let best: { b: BuildingModel; score: number } | null = null;
  for (const strat of ['compact', 'courtyard', 'linear'] as Strategy[]) {
    const scheme = generateSchemes(site, program, [strat], 3)[0];
    const doc = newProjectDoc(defaultMeta({ name: 'kit' }), site, scheme.building);
    const h = validate(doc, scheme.building, rules);
    const score = h.score - h.errors * 20;
    if (!best || score > best.score) best = { b: scheme.building, score };
  }
  const b = best!.b;
  // Exterior props (cars, trees) don't belong to a kit.
  for (const f of Object.values(b.furniture)) if (isOutdoorAsset(ASSET_BY_ID[f.assetId])) delete b.furniture[f.id];
  b.roofs = {};
  const level = levelsSorted(b)[0];
  const walls = Object.values(b.walls);
  const bb = bbox(walls.flatMap((w) => [w.a, w.b]));
  const dl = deriveLevel(b, level.id);
  const parts = dl.rooms.map((r) => { const cb = bbox(r.centerLoop); return { name: r.name, fn: r.fn, rect: { x: cb.minX - bb.minX, y: cb.minY - bb.minY, w: cb.maxX - cb.minX, h: cb.maxY - cb.minY } }; });
  const data: KitData = { w: bb.maxX - bb.minX, d: bb.maxY - bb.minY, b, levelId: level.id, parts };
  // Store the kit in local coordinates (origin at its lower-left wall corner).
  const shift = (p: Vec2) => ({ x: p.x - bb.minX, y: p.y - bb.minY });
  for (const w of walls) { w.a = shift(w.a); w.b = shift(w.b); }
  for (const t of Object.values(b.rooms)) t.point = shift(t.point);
  for (const f of Object.values(b.furniture)) f.position = shift(f.position);
  for (const s of Object.values(b.stairs)) s.origin = shift(s.origin);
  for (const c of Object.values(b.columns)) c.position = shift(c.position);
  kitCache.set(key, data);
  return data;
}

// ------------------------------------------------------------------ layout

export function blockFootprint(def: BlockDef, size: BlockSize): { w: number; d: number } {
  const kit = kitData(def, size);
  return kit ? { w: kit.w, d: kit.d } : { w: ft(size.w), d: ft(size.d) };
}

const INSET = 115 / 2 + 60;

/** Local pose (unrotated block space) of an explicit furniture item against a part wall. */
function itemPose(r: Rect, it: ItemSpec): PlacedItem | null {
  const a = ASSET_BY_ID[it.asset];
  if (!a) return null;
  const x0 = r.x + INSET, x1 = r.x + r.w - INSET, y0 = r.y + INSET, y1 = r.y + r.h - INSET;
  const W = x1 - x0, H = y1 - y0;
  const along = it.along ?? 0.5, gap = it.gap ?? 0, extra = it.rot ?? 0;
  if (it.side === 'center') {
    const fw = extra % 180 === 0 ? a.size.w : a.size.d, fd = extra % 180 === 0 ? a.size.d : a.size.w;
    if (fw > W + 1 || fd > H + 1) return null;
    return { asset: it.asset, p: { x: x0 + fw / 2 + (W - fw) * along, y: (y0 + y1) / 2 + gap }, rot: extra };
  }
  const horizontal = it.side === 'n' || it.side === 's';
  const width = a.size.w, depth = a.size.d;
  if ((horizontal ? width : depth) > (horizontal ? W : H) + 1 || (horizontal ? depth : width) > (horizontal ? H : W) + 1) return null;
  const ROTS: Record<Side, number> = { n: 0, s: 180, e: -90, w: 90 };
  let p: Vec2;
  if (it.side === 'n') p = { x: x0 + width / 2 + (W - width) * along, y: y1 - depth / 2 - gap };
  else if (it.side === 's') p = { x: x0 + width / 2 + (W - width) * along, y: y0 + depth / 2 + gap };
  else if (it.side === 'e') p = { x: x1 - depth / 2 - gap, y: y0 + width / 2 + (H - width) * along };
  else p = { x: x0 + depth / 2 + gap, y: y0 + width / 2 + (H - width) * along };
  return { asset: it.asset, p, rot: ROTS[it.side] + extra };
}

export function layoutBlock(blockId: string, sizeId: string | undefined, x: number, y: number, rot: number): Placement {
  const def = BLOCK_BY_ID[blockId];
  if (!def) throw new Error(`Unknown block ${blockId}`);
  const size = blockSize(def, sizeId);
  const fp = blockFootprint(def, size);
  const T = blockTransform(fp.w, fp.d, rot, x, y);
  const kit = kitData(def, size);
  const parts: PlacedPart[] = kit
    ? kit.parts.map((p, i) => ({ key: `k${i}`, name: p.name, fn: p.fn, rect: T.rect(p.rect), open: [], items: null, furnish: false }))
    : size.parts.map((p) => {
      const local: Rect = { x: ft(p.x), y: ft(p.y), w: ft(p.w), h: ft(p.h) };
      const items = p.items ? p.items.map((it) => itemPose(local, it)).filter((i): i is PlacedItem => !!i).map((i) => ({ ...i, p: T.point(i.p), rot: i.rot + T.rot })) : null;
      return { key: p.key, name: p.name, fn: p.fn, rect: T.rect(local), open: (p.open ?? []).map((s) => rotSide(s, T.rot)), stair: p.stair, items, furnish: p.furnish !== false };
    });
  return {
    def, size, rot: T.rot, x, y, w: T.size.w, d: T.size.d, parts,
    site: (size.site ?? []).map((s) => ({ kind: s.kind, name: s.name, material: s.material, cars: s.cars, rect: T.rect({ x: ft(s.x), y: ft(s.y), w: ft(s.w), h: ft(s.h) }) })),
    props: (size.props ?? []).map((pr) => ({ asset: pr.asset, p: T.point({ x: ft(pr.x), y: ft(pr.y) }), rot: (pr.rot ?? 0) + T.rot, variant: pr.variant })),
    doors: (size.doors ?? []).map((d) => ({ ...d, b: d.b === 'n' || d.b === 's' || d.b === 'e' || d.b === 'w' ? rotSide(d.b, T.rot) : d.b })),
  };
}

// ---------------------------------------------------------------- analysis

export interface Neighbour { tagId: Id; name: string; fn: RoomFunction; partKey: string; seg: { axis: 'x' | 'y'; c: number; lo: number; hi: number } }
export interface BlockAnalysis { overlaps: string[]; neighbour: Neighbour | null; ok: boolean; reason?: string }

const CONNECT_PREF: RoomFunction[] = ['corridor', 'foyer', 'family', 'living', 'stair', 'dining', 'master_bedroom', 'bedroom', 'kitchen', 'study', 'other'];

function connectScore(from: RoomFunction, to: RoomFunction): number {
  if (from === 'bathroom' || from === 'walkin') return to === 'master_bedroom' || to === 'bedroom' ? 10 : to === 'corridor' || to === 'family' ? 5 : to === 'kitchen' || to === 'dining' || to === 'pooja' ? -1 : 1;
  if (from === 'powder') return to === 'foyer' || to === 'living' || to === 'corridor' || to === 'dining' ? 8 : to === 'kitchen' || to === 'pooja' ? -1 : 2;
  if (from === 'utility') return to === 'kitchen' ? 10 : to === 'dining' ? 4 : 1;
  if (from === 'kitchen') return to === 'dining' ? 10 : to === 'living' || to === 'family' ? 6 : to === 'utility' ? 4 : to === 'bathroom' || to === 'powder' ? -1 : 2;
  if (from === 'balcony') return to === 'living' || to === 'family' || to === 'master_bedroom' || to === 'bedroom' || to === 'dining' ? 10 : 2;
  if (from === 'parking') return to === 'foyer' || to === 'utility' || to === 'corridor' ? 8 : 1;
  if (to === 'bathroom' || to === 'powder' || to === 'walkin' || to === 'store' || to === 'pooja' || to === 'balcony') return -1;
  return 10 - Math.max(0, CONNECT_PREF.indexOf(to));
}

/** Axis-aligned segment overlap between a rect side and a room's centre-line loop. */
function sharedSegments(r: Rect, loop: Vec2[]): { side: Side; seg: { axis: 'x' | 'y'; c: number; lo: number; hi: number } }[] {
  const out: { side: Side; seg: { axis: 'x' | 'y'; c: number; lo: number; hi: number } }[] = [];
  const sides: { side: Side; axis: 'x' | 'y'; c: number; lo: number; hi: number }[] = [
    { side: 's', axis: 'y', c: r.y, lo: r.x, hi: r.x + r.w }, { side: 'n', axis: 'y', c: r.y + r.h, lo: r.x, hi: r.x + r.w },
    { side: 'w', axis: 'x', c: r.x, lo: r.y, hi: r.y + r.h }, { side: 'e', axis: 'x', c: r.x + r.w, lo: r.y, hi: r.y + r.h },
  ];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    for (const s of sides) {
      if (s.axis === 'y' && Math.abs(a.y - b.y) < 5 && Math.abs(a.y - s.c) < 30) {
        const lo = Math.max(s.lo, Math.min(a.x, b.x)), hi = Math.min(s.hi, Math.max(a.x, b.x));
        if (hi - lo > 900) out.push({ side: s.side, seg: { axis: 'y', c: s.c, lo, hi } });
      } else if (s.axis === 'x' && Math.abs(a.x - b.x) < 5 && Math.abs(a.x - s.c) < 30) {
        const lo = Math.max(s.lo, Math.min(a.y, b.y)), hi = Math.min(s.hi, Math.max(a.y, b.y));
        if (hi - lo > 900) out.push({ side: s.side, seg: { axis: 'x', c: s.c, lo, hi } });
      }
    }
  }
  return out;
}

export function analyzeBlock(b: BuildingModel, levelId: Id, pl: Placement): BlockAnalysis {
  const level = b.levels[levelId];
  if (!level) return { overlaps: [], neighbour: null, ok: false, reason: 'No level' };
  const dl = deriveLevel(b, levelId);
  const overlaps: string[] = [];
  if (pl.def.siteOnly) {
    const ground = levelsSorted(b)[0];
    const gl = ground ? deriveLevel(b, ground.id) : null;
    for (const s of pl.site) {
      const poly = rectPolygon(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
      if (gl && areaWithHoles(intersection([poly], gl.footprint)) > 0.3e6) overlaps.push('the building');
    }
    return { overlaps: [...new Set(overlaps)], neighbour: null, ok: !overlaps.length, reason: overlaps.length ? 'Overlaps the building' : undefined };
  }
  for (const part of pl.parts) {
    const r = part.rect;
    const inner = rectPolygon(r.x + 150, r.y + 150, Math.max(10, r.w - 300), Math.max(10, r.h - 300));
    for (const room of dl.rooms) if (areaWithHoles(intersection([inner], [room.polygon])) > 0.15e6) overlaps.push(room.name);
  }
  // Best neighbouring room for the entry part.
  const entryKey = pl.def.entry ?? pl.parts[0]?.key;
  const entry = pl.parts.find((p) => p.key === entryKey) ?? pl.parts[0];
  let neighbour: Neighbour | null = null;
  let bestScore = -Infinity;
  if (entry) {
    for (const room of dl.rooms) {
      if (!room.tagId) continue;
      for (const s of sharedSegments(entry.rect, room.centerLoop)) {
        const score = connectScore(entry.fn, room.fn) + (s.seg.hi - s.seg.lo) / 10000;
        if (score > bestScore && connectScore(entry.fn, room.fn) >= 0) { bestScore = score; neighbour = { tagId: room.tagId, name: room.name, fn: room.fn, partKey: entry.key, seg: s.seg }; }
      }
    }
  }
  const uniq = [...new Set(overlaps)];
  return { overlaps: uniq, neighbour, ok: !uniq.length, reason: uniq.length ? `Overlaps ${uniq.slice(0, 2).join(' and ')}` : undefined };
}

/**
 * Magnetic snapping: align the block's edges to nearby wall centre-lines so it
 * shares walls with what is already drawn; otherwise snap to a 6-inch grid.
 */
export function snapBlock(b: BuildingModel, levelId: Id, w: number, d: number, center: Vec2, tol: number, rings?: Vec2[][]): { x: number; y: number; snappedX: boolean; snappedY: boolean } {
  let x = center.x - w / 2, y = center.y - d / 2;
  // Site items (parking, lawns) snap to outlines — the building's outer face and the plot edge —
  // rather than wall centre-lines, so they sit flush against the wall instead of under it.
  const walls: Wall[] = rings ? [] : Object.values(b.walls).filter((wl) => wl.levelId === levelId);
  const vx: number[] = [], hy: number[] = [];
  for (const ring of rings ?? []) {
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      if (Math.abs(p.x - q.x) < 5 && Math.max(p.y, q.y) > y - tol && Math.min(p.y, q.y) < y + d + tol) vx.push(p.x);
      if (Math.abs(p.y - q.y) < 5 && Math.max(p.x, q.x) > x - tol && Math.min(p.x, q.x) < x + w + tol) hy.push(p.y);
      vx.push(p.x); hy.push(p.y);
    });
  }
  for (const wl of walls) {
    if (Math.abs(wl.a.x - wl.b.x) < 5 && Math.max(wl.a.y, wl.b.y) > y - tol && Math.min(wl.a.y, wl.b.y) < y + d + tol) vx.push(wl.a.x);
    if (Math.abs(wl.a.y - wl.b.y) < 5 && Math.max(wl.a.x, wl.b.x) > x - tol && Math.min(wl.a.x, wl.b.x) < x + w + tol) hy.push(wl.a.y);
    for (const p of [wl.a, wl.b]) { vx.push(p.x); hy.push(p.y); }
  }
  const best = (val: number, span: number, cands: number[]) => {
    let bd = tol, out: number | null = null;
    for (const c of cands) {
      for (const off of [0, span]) { const dd = Math.abs(val + off - c); if (dd < bd) { bd = dd; out = c - off; } }
    }
    return out;
  };
  const sx = best(x, w, vx), sy = best(y, d, hy);
  const g = ft(0.5);
  x = sx ?? Math.round(x / g) * g;
  y = sy ?? Math.round(y / g) * g;
  return { x, y, snappedX: sx !== null, snappedY: sy !== null };
}

/** Snap outlines for site-only blocks: ground-floor footprint plus the plot boundary. */
export function siteSnapRings(b: BuildingModel, boundary: Vec2[]): Vec2[][] {
  const ground = levelsSorted(b)[0];
  const fp = ground ? deriveLevel(b, ground.id).footprint : [];
  return [...fp, boundary];
}

export { BLOCK_BY_ID };
