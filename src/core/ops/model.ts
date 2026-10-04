/**
 * Building-model operations. These are the only functions that mutate geometry.
 * Each keeps dependent data consistent (joins, openings, tags, levels above) so
 * the rest of the system can simply re-derive.
 */
import type { Draft } from 'immer';
import type {
  BuildingModel, Door, ElementRef, FurnitureItem, Id, Level, Roof, RoomFunction, RoomTag, Stair, StyleId, Wall, Window,
} from '../model/types';
import { COLLECTION } from '../model/types';
import { defineOp, OpError, type OpContext } from './registry';
import { makeColumn, makeDoor, makeFurniture, makeLevel, makeRoof, makeRoomTag, makeStair, makeWall, makeWindow, nextTag, EXT_WALL, INT_WALL } from '../model/factory';
import { uid } from '../model/ids';
import { type Vec2, add, dist, dot, lineParam, near, norm, perp, projectToSegment, scale, sub } from '../geometry/vec';
import { levelsSorted, openingCenter, wallLength } from '../model/query';
import { deriveLevel } from '../derive/level';
import { formatLength } from '../units';
import { STYLE_BY_ID, floorFor, wallFinishFor } from '../catalog/styles';
import { ASSET_BY_ID } from '../catalog/assets';
import { getMaterial } from '../catalog/materials';
import { pointInPolygon } from '../geometry/polygon';

type B = Draft<BuildingModel>;
const TOL = 15;

const vec2 = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };
const refSchema = { type: 'object', properties: { kind: { type: 'string' }, id: { type: 'string' } }, required: ['kind', 'id'] };
const fmt = (ctx: OpContext, mm: number) => formatLength(mm, ctx.doc.meta.units);
const style = (ctx: OpContext): StyleId => (ctx.doc.options.find((o) => o.id === ctx.doc.activeOptionId)?.style ?? 'modern') as StyleId;

function requireLevel(ctx: OpContext, id: Id): Draft<Level> {
  const l = ctx.b.levels[id];
  if (!l) throw new OpError(`No level ${id}`, 'That level no longer exists.');
  if (l.locked) throw new OpError(`Level ${id} locked`, `${l.name} is locked. Unlock it to make changes.`);
  return l;
}

function requireWall(ctx: OpContext, id: Id): Draft<Wall> {
  const w = ctx.b.walls[id];
  if (!w) throw new OpError(`No wall ${id}`, 'That wall no longer exists.');
  requireLevel(ctx, w.levelId);
  return w;
}

// ------------------------------------------------------------------ helpers

/** Move every wall endpoint on `levelId` that sits at `from` to `to` (keeps joins intact). */
export function moveJoinedEndpoints(b: B, levelId: Id, from: Vec2, to: Vec2, exceptWall?: Id) {
  for (const w of Object.values(b.walls)) {
    if (w.levelId !== levelId || w.id === exceptWall) continue;
    if (near(w.a, from, TOL)) w.a = { ...to };
    if (near(w.b, from, TOL)) w.b = { ...to };
  }
}

/** Keep openings anchored at the same world position when a wall's `a` end moves. */
function reanchorOpenings(b: B, wallId: Id, oldA: Vec2, oldB: Vec2) {
  const w = b.walls[wallId];
  const L = wallLength(w);
  for (const o of [...Object.values(b.doors), ...Object.values(b.windows)]) {
    if (o.wallId !== wallId) continue;
    const d = norm(sub(oldB, oldA));
    const world = add(oldA, scale(d, o.offset));
    const t = lineParam(world, w.a, w.b) * L;
    o.offset = Math.max(o.width / 2, Math.min(L - o.width / 2, t));
  }
}

function deleteWallCascade(b: B, id: Id) {
  delete b.walls[id];
  for (const d of Object.values(b.doors)) if (d.wallId === id) delete b.doors[d.id];
  for (const w of Object.values(b.windows)) if (w.wallId === id) delete b.windows[w.id];
}

/**
 * STRETCH — the engine behind "make the bedroom 2 ft wider".
 * Everything at or beyond `plane` on `axis` (in direction `dir`) moves by
 * `delta`; walls crossing the plane lengthen; openings, tags, furniture,
 * stairs and columns beyond the plane travel with their walls.
 */
export function stretch(b: B, levelIds: Id[], axis: 'x' | 'y', plane: number, dir: 1 | -1, delta: number) {
  const beyond = (p: Vec2) => dir * (p[axis] - plane) >= -TOL;
  const shift = (p: Vec2): Vec2 => (beyond(p) ? { ...p, [axis]: p[axis] + dir * delta } : p);
  const lv = new Set(levelIds);
  // Record opening world centres before moving walls.
  const openingWorld = new Map<Id, Vec2>();
  for (const o of [...Object.values(b.doors), ...Object.values(b.windows)]) {
    const w = b.walls[o.wallId];
    if (w && lv.has(w.levelId)) openingWorld.set(o.id, openingCenter(w, o.offset));
  }
  for (const w of Object.values(b.walls)) if (lv.has(w.levelId)) { w.a = shift(w.a); w.b = shift(w.b); }
  for (const o of [...Object.values(b.doors), ...Object.values(b.windows)]) {
    const before = openingWorld.get(o.id);
    if (!before) continue;
    const w = b.walls[o.wallId];
    const L = wallLength(w);
    const after = shift(before);
    o.offset = Math.max(o.width / 2, Math.min(L - o.width / 2, lineParam(after, w.a, w.b) * L));
  }
  for (const t of Object.values(b.rooms)) if (lv.has(t.levelId)) t.point = shift(t.point);
  for (const f of Object.values(b.furniture)) if (lv.has(f.levelId)) f.position = shift(f.position);
  for (const c of Object.values(b.columns)) if (lv.has(c.levelId)) c.position = shift(c.position);
  for (const bm of Object.values(b.beams)) if (lv.has(bm.levelId)) { bm.a = shift(bm.a); bm.b = shift(bm.b); }
  for (const s of Object.values(b.stairs)) if (lv.has(s.levelId)) s.origin = shift(s.origin);
  for (const r of Object.values(b.roofs)) {
    if (!lv.has(r.levelId) || r.footprint === 'auto') continue;
    const fp = r.footprint;
    const lo = axis === 'x' ? fp.x : fp.y, size = axis === 'x' ? fp.w : fp.h;
    const p0 = { x: fp.x, y: fp.y }, p1 = { x: fp.x + fp.w, y: fp.y + fp.h };
    const n0 = shift(p0), n1 = shift(p1);
    void lo; void size;
    r.footprint = { x: n0.x, y: n0.y, w: n1.x - n0.x, h: n1.y - n0.y };
  }
}

function translateLevelContents(b: B, levelIds: Set<Id>, d: Vec2) {
  const mv = (p: Vec2) => ({ x: p.x + d.x, y: p.y + d.y });
  for (const w of Object.values(b.walls)) if (levelIds.has(w.levelId)) { w.a = mv(w.a); w.b = mv(w.b); }
  for (const t of Object.values(b.rooms)) if (levelIds.has(t.levelId)) t.point = mv(t.point);
  for (const f of Object.values(b.furniture)) if (levelIds.has(f.levelId)) f.position = mv(f.position);
  for (const c of Object.values(b.columns)) if (levelIds.has(c.levelId)) c.position = mv(c.position);
  for (const bm of Object.values(b.beams)) if (levelIds.has(bm.levelId)) { bm.a = mv(bm.a); bm.b = mv(bm.b); }
  for (const s of Object.values(b.stairs)) if (levelIds.has(s.levelId)) s.origin = mv(s.origin);
  for (const r of Object.values(b.roofs)) if (levelIds.has(r.levelId) && r.footprint !== 'auto') r.footprint = { ...r.footprint, x: r.footprint.x + d.x, y: r.footprint.y + d.y };
}

/** Intervals of segment ab not already covered by collinear walls on the level. */
function uncoveredIntervals(b: B, levelId: Id, a: Vec2, bb: Vec2): [number, number][] {
  const L = dist(a, bb);
  const covered: [number, number][] = [];
  for (const w of Object.values(b.walls)) {
    if (w.levelId !== levelId) continue;
    if (projectToSegment(w.a, a, bb).dist > TOL && Math.abs(lineDist(w.a, a, bb)) > TOL) continue;
    if (Math.abs(lineDist(w.a, a, bb)) > TOL || Math.abs(lineDist(w.b, a, bb)) > TOL) continue;
    const t0 = lineParam(w.a, a, bb) * L, t1 = lineParam(w.b, a, bb) * L;
    covered.push([Math.min(t0, t1), Math.max(t0, t1)]);
  }
  covered.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let cur = 0;
  for (const [s, e] of covered) {
    if (s > cur + TOL) out.push([cur, Math.min(s, L)]);
    cur = Math.max(cur, e);
    if (cur >= L) break;
  }
  if (cur < L - TOL) out.push([cur, L]);
  return out.filter(([s, e]) => e - s > 100);
}

function lineDist(p: Vec2, a: Vec2, b: Vec2) {
  const d = norm(sub(b, a));
  return d.x * (p.y - a.y) - d.y * (p.x - a.x);
}

export function addRoomRect(ctx: OpContext, p: { levelId: Id; x: number; y: number; w: number; h: number; name: string; fn: RoomFunction; exterior?: boolean }): RoomTag {
  const b = ctx.b;
  const st = style(ctx);
  const corners = [{ x: p.x, y: p.y }, { x: p.x + p.w, y: p.y }, { x: p.x + p.w, y: p.y + p.h }, { x: p.x, y: p.y + p.h }];
  const dl = deriveLevel(b as BuildingModel, p.levelId);
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4];
    const d = norm(sub(c, a));
    for (const [s, e] of uncoveredIntervals(b, p.levelId, a, c)) {
      const wa = add(a, scale(d, s)), wb = add(a, scale(d, e));
      // An edge is exterior when nothing (no room, no footprint) lies beyond it.
      const mid = scale(add(wa, wb), 0.5);
      const outside = add(mid, scale(perp(d), -400));
      const exterior = p.exterior ?? !(dl.footprint.some((f) => pointInPolygon(outside, f)));
      const w = makeWall({ levelId: p.levelId, a: wa, b: wb, kind: exterior ? 'exterior' : 'interior', thickness: exterior ? EXT_WALL : INT_WALL }, st);
      b.walls[w.id] = w;
    }
  }
  const count = Object.values(b.rooms).filter((r) => r.levelId === p.levelId).length;
  const lvIdx = levelsSorted(b as BuildingModel).findIndex((l) => l.id === p.levelId);
  const tag = makeRoomTag({ levelId: p.levelId, point: { x: p.x + p.w / 2, y: p.y + p.h / 2 }, name: p.name, fn: p.fn, number: `${lvIdx + 1}${String(count + 1).padStart(2, '0')}` }, st);
  b.rooms[tag.id] = tag;
  ctx.created.push({ kind: 'room', id: tag.id });
  return tag;
}

// -------------------------------------------------------------------- walls

defineOp<{ levelId: Id; a: Vec2; b: Vec2; thickness?: number; kind?: Wall['kind']; height?: number | null; materialId?: string }>({
  type: 'wall.create', title: 'Create wall', cap: 'model.edit', model: true,
  description: 'Add a straight wall between two plan points (mm) on a level.',
  schema: { type: 'object', properties: { levelId: { type: 'string' }, a: vec2, b: vec2, thickness: { type: 'number' }, kind: { type: 'string', enum: ['exterior', 'interior', 'partition', 'compound', 'retaining'] } }, required: ['levelId', 'a', 'b'] },
  run(ctx, p) {
    requireLevel(ctx, p.levelId);
    if (dist(p.a, p.b) < 50) throw new OpError('Wall too short', 'That wall is too short to create.');
    const w = makeWall({ levelId: p.levelId, a: p.a, b: p.b, kind: p.kind ?? 'interior', ...(p.thickness ? { thickness: p.thickness } : {}), ...(p.height !== undefined ? { height: p.height } : {}), ...(p.materialId ? { materialId: p.materialId } : {}) }, style(ctx));
    ctx.b.walls[w.id] = w;
    ctx.created.push({ kind: 'wall', id: w.id });
    ctx.notes.push(`Wall added (${fmt(ctx, dist(p.a, p.b))})`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<Wall, 'id' | 'levelId'>> }>({
  type: 'wall.update', title: 'Edit wall', cap: 'model.edit', model: true,
  description: 'Change wall properties: thickness, height, kind, structural, materials, fire/acoustic rating.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const w = requireWall(ctx, p.id);
    const before = { thickness: w.thickness, height: w.height };
    Object.assign(w, p.patch);
    if (p.patch.thickness !== undefined && p.patch.thickness !== before.thickness) ctx.notes.push(`Wall thickness ${fmt(ctx, before.thickness)} → ${fmt(ctx, w.thickness)}`);
    else if (p.patch.finishExteriorId || p.patch.finishInteriorId || p.patch.materialId) ctx.notes.push(`Wall material → ${getMaterial(p.patch.finishExteriorId ?? p.patch.finishInteriorId ?? p.patch.materialId).name}`);
    else ctx.notes.push('Wall properties updated');
  },
});

defineOp<{ id: Id; length: number; anchor?: 'a' | 'b' }>({
  type: 'wall.setLength', title: 'Set wall length', cap: 'model.edit', model: true,
  description: 'Resize a wall; the moving end drags joined walls with it.',
  schema: { type: 'object', properties: { id: { type: 'string' }, length: { type: 'number' }, anchor: { type: 'string', enum: ['a', 'b'] } }, required: ['id', 'length'] },
  run(ctx, p) {
    const w = requireWall(ctx, p.id);
    const old = wallLength(w);
    if (p.length < 100) throw new OpError('Too short', 'A wall must be at least 100 mm long.');
    const anchor = p.anchor ?? 'a';
    const d = norm(sub(w.b, w.a));
    if (anchor === 'a') {
      const nb = add(w.a, scale(d, p.length));
      moveJoinedEndpoints(ctx.b, w.levelId, w.b, nb, w.id);
      w.b = nb;
    } else {
      const na = sub(w.b, scale(d, p.length));
      const oa = { ...w.a }, ob = { ...w.b };
      moveJoinedEndpoints(ctx.b, w.levelId, w.a, na, w.id);
      w.a = na;
      reanchorOpenings(ctx.b, w.id, oa, ob);
    }
    ctx.notes.push(`Wall length ${fmt(ctx, old)} → ${fmt(ctx, p.length)}`);
  },
});

defineOp<{ id: Id; delta: Vec2 }>({
  type: 'wall.move', title: 'Move wall', cap: 'model.edit', model: true,
  description: 'Move a wall; joined walls stretch to stay connected and openings move with it.',
  schema: { type: 'object', properties: { id: { type: 'string' }, delta: vec2 }, required: ['id', 'delta'] },
  run(ctx, p) {
    requireWall(ctx, p.id);
    moveWall(ctx, p.id, p.delta);
    ctx.notes.push(`Wall moved ${fmt(ctx, Math.hypot(p.delta.x, p.delta.y))}`);
  },
});

defineOp<{ id: Id; end: 'a' | 'b'; to: Vec2 }>({
  type: 'wall.moveEnd', title: 'Move wall end', cap: 'model.edit', model: true,
  description: 'Drag one end of a wall to a new point; walls joined at that end follow.',
  schema: { type: 'object', properties: { id: { type: 'string' }, end: { type: 'string', enum: ['a', 'b'] }, to: vec2 }, required: ['id', 'end', 'to'] },
  run(ctx, p) {
    const w = requireWall(ctx, p.id);
    const from = { ...w[p.end] };
    const oa = { ...w.a }, ob = { ...w.b };
    moveJoinedEndpoints(ctx.b, w.levelId, from, p.to, w.id);
    w[p.end] = { ...p.to };
    if (dist(w.a, w.b) < 100) throw new OpError('Too short', 'A wall must be at least 100 mm long.');
    if (p.end === 'a') reanchorOpenings(ctx.b, w.id, oa, ob);
    ctx.notes.push(`Wall resized to ${fmt(ctx, dist(w.a, w.b))}`);
  },
});

defineOp<{ id: Id; at: number }>({
  type: 'wall.split', title: 'Split wall', cap: 'model.edit', model: true,
  description: 'Split a wall into two at a distance from its start.',
  schema: { type: 'object', properties: { id: { type: 'string' }, at: { type: 'number' } }, required: ['id', 'at'] },
  run(ctx, p) {
    const w = requireWall(ctx, p.id);
    const L = wallLength(w);
    if (p.at < 100 || p.at > L - 100) throw new OpError('Bad split', 'Split point must be inside the wall.');
    const d = norm(sub(w.b, w.a));
    const m = add(w.a, scale(d, p.at));
    const w2 = { ...JSON.parse(JSON.stringify(w)), id: uid('w'), a: m } as Wall;
    const oldB = { ...w.b };
    w.b = m;
    w2.b = oldB;
    ctx.b.walls[w2.id] = w2;
    for (const o of [...Object.values(ctx.b.doors), ...Object.values(ctx.b.windows)]) {
      if (o.wallId === w.id && o.offset > p.at) { o.wallId = w2.id; o.offset -= p.at; }
    }
    ctx.created.push({ kind: 'wall', id: w2.id });
    ctx.notes.push('Wall split');
  },
});

// -------------------------------------------------------------------- rooms

defineOp<{ levelId: Id; x: number; y: number; w: number; h: number; name: string; fn: RoomFunction }>({
  type: 'room.create', title: 'Create room', cap: 'model.edit', model: true,
  description: 'Create a rectangular room (x, y = lower-left corner, w × h in mm). Walls are added only where none exist.',
  schema: { type: 'object', properties: { levelId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, name: { type: 'string' }, fn: { type: 'string' } }, required: ['levelId', 'x', 'y', 'w', 'h', 'name', 'fn'] },
  run(ctx, p) {
    requireLevel(ctx, p.levelId);
    if (p.w < 600 || p.h < 600) throw new OpError('Room too small', 'Rooms must be at least 600 mm in each direction.');
    addRoomRect(ctx, p);
    ctx.notes.push(`${p.name} added (${fmt(ctx, p.w)} × ${fmt(ctx, p.h)})`);
  },
});

defineOp<{ levelId: Id; point: Vec2; name: string; fn: RoomFunction }>({
  type: 'room.tag', title: 'Name a space', cap: 'model.edit', model: true,
  description: 'Place a room tag inside an enclosed space so it becomes a named room.',
  schema: { type: 'object', properties: { levelId: { type: 'string' }, point: vec2, name: { type: 'string' }, fn: { type: 'string' } }, required: ['levelId', 'point', 'name', 'fn'] },
  run(ctx, p) {
    requireLevel(ctx, p.levelId);
    const tag = makeRoomTag({ levelId: p.levelId, point: p.point, name: p.name, fn: p.fn }, style(ctx));
    ctx.b.rooms[tag.id] = tag;
    ctx.created.push({ kind: 'room', id: tag.id });
    ctx.notes.push(`${p.name} tagged`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<RoomTag, 'id' | 'levelId'>> }>({
  type: 'room.update', title: 'Edit room', cap: 'model.edit', model: true,
  description: 'Rename a room or change its function, floor / wall / ceiling finish or ceiling height.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const t = ctx.b.rooms[p.id];
    if (!t) throw new OpError('No room', 'That room no longer exists.');
    requireLevel(ctx, t.levelId);
    const oldName = t.name;
    if (p.patch.fn && p.patch.fn !== t.fn && !p.patch.floorFinishId) {
      const st = STYLE_BY_ID[style(ctx)];
      t.floorFinishId = floorFor(st, p.patch.fn);
      t.wallFinishId = wallFinishFor(st, p.patch.fn);
    }
    Object.assign(t, p.patch);
    if (p.patch.name && p.patch.name !== oldName) ctx.notes.push(`${oldName} renamed to ${p.patch.name}`);
    else if (p.patch.floorFinishId) ctx.notes.push(`${t.name} floor → ${getMaterial(p.patch.floorFinishId).name}`);
    else if (p.patch.wallFinishId) ctx.notes.push(`${t.name} walls → ${getMaterial(p.patch.wallFinishId).name}`);
    else ctx.notes.push(`${t.name} updated`);
  },
});

defineOp<{ id: Id; axis: 'x' | 'y'; size: number; anchor?: 'min' | 'max' | 'center'; scope?: 'level' | 'building' }>({
  type: 'room.resize', title: 'Resize room', cap: 'model.edit', model: true,
  description: 'Set a room’s net width (axis x) or depth (axis y). Walls, neighbouring rooms, openings and furniture beyond the moving wall shift automatically. anchor=min keeps the left/bottom wall fixed.',
  schema: { type: 'object', properties: { id: { type: 'string' }, axis: { type: 'string', enum: ['x', 'y'] }, size: { type: 'number', description: 'New net dimension in mm' }, anchor: { type: 'string', enum: ['min', 'max', 'center'] }, scope: { type: 'string', enum: ['level', 'building'] } }, required: ['id', 'axis', 'size'] },
  run(ctx, p) {
    const tag = ctx.b.rooms[p.id];
    if (!tag) throw new OpError('No room', 'That room no longer exists.');
    requireLevel(ctx, tag.levelId);
    const dl = deriveLevel(ctx.b as BuildingModel, tag.levelId);
    const room = dl.rooms.find((r) => r.tagId === tag.id);
    if (!room) throw new OpError('Room not enclosed', `${tag.name} isn't fully enclosed by walls, so it can't be resized.`, 'Close the room boundary first.');
    const current = p.axis === 'x' ? room.width : room.depth;
    const delta = p.size - current;
    if (Math.abs(delta) < 1) return;
    if (p.size < 600) throw new OpError('Too small', 'Rooms must be at least 600 mm wide.');
    const xs = room.centerLoop.map((q) => q[p.axis]);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const levelIds = p.scope === 'building' ? Object.keys(ctx.b.levels) : [tag.levelId];
    const anchor = p.anchor ?? 'min';
    if (anchor === 'min') stretch(ctx.b, levelIds, p.axis, hi, 1, delta);
    else if (anchor === 'max') stretch(ctx.b, levelIds, p.axis, lo, -1, delta);
    else { stretch(ctx.b, levelIds, p.axis, hi, 1, delta / 2); stretch(ctx.b, levelIds, p.axis, lo, -1, delta / 2); }
    ctx.notes.push(`${tag.name} ${p.axis === 'x' ? 'width' : 'depth'} ${fmt(ctx, current)} → ${fmt(ctx, p.size)}`);
  },
});

defineOp<{ id: Id; side: 'left' | 'right' | 'top' | 'bottom'; name: string; fn: RoomFunction; size: number }>({
  type: 'room.split', title: 'Carve out a room', cap: 'model.edit', model: true,
  description: 'Divide a rectangular room with a new wall, creating a new room of `size` mm on one side (e.g. a powder room).',
  schema: { type: 'object', properties: { id: { type: 'string' }, side: { type: 'string', enum: ['left', 'right', 'top', 'bottom'] }, name: { type: 'string' }, fn: { type: 'string' }, size: { type: 'number' } }, required: ['id', 'side', 'name', 'fn', 'size'] },
  run(ctx, p) {
    const tag = ctx.b.rooms[p.id];
    if (!tag) throw new OpError('No room', 'That room no longer exists.');
    const dl = deriveLevel(ctx.b as BuildingModel, tag.levelId);
    const room = dl.rooms.find((r) => r.tagId === tag.id);
    if (!room) throw new OpError('Not enclosed', `${tag.name} must be enclosed to split it.`);
    const bb = room.bbox;
    const cl = room.centerLoop;
    const cx0 = Math.min(...cl.map((q) => q.x)), cx1 = Math.max(...cl.map((q) => q.x));
    const cy0 = Math.min(...cl.map((q) => q.y)), cy1 = Math.max(...cl.map((q) => q.y));
    const t = INT_WALL;
    let a: Vec2, b2: Vec2, newPt: Vec2, keepPt: Vec2;
    if (p.side === 'left' || p.side === 'right') {
      const x = p.side === 'left' ? bb.minX + p.size + t / 2 : bb.maxX - p.size - t / 2;
      a = { x, y: cy0 }; b2 = { x, y: cy1 };
      newPt = { x: p.side === 'left' ? (bb.minX + x) / 2 : (x + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
      keepPt = { x: p.side === 'left' ? (x + bb.maxX) / 2 : (bb.minX + x) / 2, y: (bb.minY + bb.maxY) / 2 };
    } else {
      const y = p.side === 'bottom' ? bb.minY + p.size + t / 2 : bb.maxY - p.size - t / 2;
      a = { x: cx0, y }; b2 = { x: cx1, y };
      newPt = { x: (bb.minX + bb.maxX) / 2, y: p.side === 'bottom' ? (bb.minY + y) / 2 : (y + bb.maxY) / 2 };
      keepPt = { x: (bb.minX + bb.maxX) / 2, y: p.side === 'bottom' ? (y + bb.maxY) / 2 : (bb.minY + y) / 2 };
    }
    const w = makeWall({ levelId: tag.levelId, a, b: b2, kind: 'interior', thickness: t }, style(ctx));
    ctx.b.walls[w.id] = w;
    tag.point = keepPt;
    const nt = makeRoomTag({ levelId: tag.levelId, point: newPt, name: p.name, fn: p.fn }, style(ctx));
    ctx.b.rooms[nt.id] = nt;
    const L = dist(a, b2);
    const door = makeDoor({ wallId: w.id, offset: Math.min(L - 500, 600), width: 750, tag: nextTag(ctx.b as BuildingModel, 'D', tag.levelId), side: 'right' }, style(ctx));
    ctx.b.doors[door.id] = door;
    ctx.created.push({ kind: 'room', id: nt.id }, { kind: 'wall', id: w.id }, { kind: 'door', id: door.id });
    ctx.notes.push(`${p.name} carved out of ${tag.name}`);
  },
});

defineOp<{ id: Id; corner: 'ne' | 'nw' | 'se' | 'sw'; w: number; h: number; name: string; fn: RoomFunction }>({
  type: 'room.carve', title: 'Carve a corner room', cap: 'model.edit', model: true,
  description: 'Create a small room (w × h mm, e.g. a powder room or store) in a corner of an existing rectangular room, with two new walls and a door into the host room.',
  schema: { type: 'object', properties: { id: { type: 'string' }, corner: { type: 'string', enum: ['ne', 'nw', 'se', 'sw'] }, w: { type: 'number' }, h: { type: 'number' }, name: { type: 'string' }, fn: { type: 'string' } }, required: ['id', 'corner', 'w', 'h', 'name', 'fn'] },
  run(ctx, p) {
    const tag = ctx.b.rooms[p.id];
    if (!tag) throw new OpError('No room', 'That room no longer exists.');
    const dl = deriveLevel(ctx.b as BuildingModel, tag.levelId);
    const room = dl.rooms.find((r) => r.tagId === tag.id);
    if (!room || !room.isRect) throw new OpError('Not rectangular', `${tag.name} must be an enclosed rectangle to carve a room from it.`);
    const bb = room.bbox;
    const t = INT_WALL;
    if (p.w + 900 > bb.maxX - bb.minX || p.h + 900 > bb.maxY - bb.minY) throw new OpError('Too big', `${tag.name} is too small to fit a ${fmt(ctx, p.w)} × ${fmt(ctx, p.h)} ${p.name}.`);
    const east = p.corner.includes('e'), north = p.corner.startsWith('n');
    const xw = east ? bb.maxX - p.w - t / 2 : bb.minX + p.w + t / 2;
    const yw = north ? bb.maxY - p.h - t / 2 : bb.minY + p.h + t / 2;
    const xEdge = east ? bb.maxX + t / 2 : bb.minX - t / 2;
    const yEdge = north ? bb.maxY + t / 2 : bb.minY - t / 2;
    // wall parallel to x (at yw) from the side wall to xw; wall parallel to y (at xw) from the end wall to yw
    const wx = makeWall({ levelId: tag.levelId, a: { x: xEdge, y: yw }, b: { x: xw, y: yw }, kind: 'interior', thickness: t }, style(ctx));
    const wy = makeWall({ levelId: tag.levelId, a: { x: xw, y: yEdge }, b: { x: xw, y: yw }, kind: 'interior', thickness: t }, style(ctx));
    // snap the free ends exactly onto the host walls' centre-lines
    const cl = room.centerLoop;
    const clx = east ? Math.max(...cl.map((q) => q.x)) : Math.min(...cl.map((q) => q.x));
    const cly = north ? Math.max(...cl.map((q) => q.y)) : Math.min(...cl.map((q) => q.y));
    wx.a = { x: clx, y: yw }; wy.a = { x: xw, y: cly };
    ctx.b.walls[wx.id] = wx; ctx.b.walls[wy.id] = wy;
    const nt = makeRoomTag({ levelId: tag.levelId, point: { x: (xw + (east ? bb.maxX : bb.minX)) / 2, y: (yw + (north ? bb.maxY : bb.minY)) / 2 }, name: p.name, fn: p.fn }, style(ctx));
    ctx.b.rooms[nt.id] = nt;
    if (Math.abs(nt.point.x - tag.point.x) < p.w && Math.abs(nt.point.y - tag.point.y) < p.h) tag.point = { x: (east ? bb.minX + xw : xw + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
    const L = dist(wy.a, wy.b);
    const door = makeDoor({ wallId: wy.id, offset: L / 2, width: Math.min(750, L - 300), tag: nextTag(ctx.b as BuildingModel, 'D', tag.levelId) }, style(ctx));
    ctx.b.doors[door.id] = door;
    ctx.created.push({ kind: 'room', id: nt.id }, { kind: 'door', id: door.id });
    ctx.notes.push(`${p.name} (${fmt(ctx, p.w)} × ${fmt(ctx, p.h)}) carved from ${tag.name}`);
  },
});

// ----------------------------------------------------------------- openings

defineOp<{ wallId: Id; offset?: number; width?: number; height?: number; kind?: Door['kind']; side?: Door['side']; hinge?: Door['hinge'] }>({
  type: 'door.create', title: 'Add door', cap: 'model.edit', model: true,
  description: 'Place a parametric door in a wall; the wall opening is cut automatically.',
  schema: { type: 'object', properties: { wallId: { type: 'string' }, offset: { type: 'number', description: 'Centre distance from wall start (mm)' }, width: { type: 'number' }, kind: { type: 'string', enum: ['single', 'double', 'sliding', 'folding', 'pocket', 'pivot', 'french', 'garage', 'opening'] } }, required: ['wallId'] },
  run(ctx, p) {
    const w = requireWall(ctx, p.wallId);
    const L = wallLength(w);
    const width = p.width ?? (p.kind === 'double' || p.kind === 'french' ? 1500 : p.kind === 'sliding' ? 1800 : p.kind === 'garage' ? 2700 : 900);
    if (width > L - 100) throw new OpError('Door too wide', `A ${fmt(ctx, width)} door doesn't fit in a ${fmt(ctx, L)} wall.`);
    const offset = Math.max(width / 2 + 50, Math.min(L - width / 2 - 50, p.offset ?? L / 2));
    const d = makeDoor({ wallId: w.id, offset, width, kind: p.kind ?? 'single', height: p.height ?? (p.kind === 'garage' ? 2400 : 2100), side: p.side ?? 'left', hinge: p.hinge ?? 'start', tag: nextTag(ctx.b as BuildingModel, 'D', w.levelId) }, style(ctx));
    ctx.b.doors[d.id] = d;
    ctx.created.push({ kind: 'door', id: d.id });
    ctx.notes.push(`Door ${d.tag} added`);
  },
});

defineOp<{ wallId: Id; offset?: number; width?: number; height?: number; sill?: number; kind?: Window['kind'] }>({
  type: 'window.create', title: 'Add window', cap: 'model.edit', model: true,
  description: 'Place a parametric window in a wall.',
  schema: { type: 'object', properties: { wallId: { type: 'string' }, offset: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, sill: { type: 'number' }, kind: { type: 'string' } }, required: ['wallId'] },
  run(ctx, p) {
    const w = requireWall(ctx, p.wallId);
    const L = wallLength(w);
    const width = Math.min(p.width ?? 1500, L - 300);
    if (width < 300) throw new OpError('Wall too short', 'This wall is too short for a window.');
    const offset = Math.max(width / 2 + 100, Math.min(L - width / 2 - 100, p.offset ?? L / 2));
    const win = makeWindow({ wallId: w.id, offset, width, ...(p.height ? { height: p.height } : {}), ...(p.sill !== undefined ? { sill: p.sill } : {}), ...(p.kind ? { kind: p.kind } : {}), tag: nextTag(ctx.b as BuildingModel, 'W', w.levelId) }, style(ctx));
    ctx.b.windows[win.id] = win;
    ctx.created.push({ kind: 'window', id: win.id });
    ctx.notes.push(`Window ${win.tag} added`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<Door, 'id'>> }>({
  type: 'door.update', title: 'Edit door', cap: 'model.edit', model: true,
  description: 'Change door width, height, type, swing, hinge or material.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const d = ctx.b.doors[p.id];
    if (!d) throw new OpError('No door', 'That door no longer exists.');
    const w = requireWall(ctx, p.patch.wallId ?? d.wallId);
    Object.assign(d, p.patch);
    const L = wallLength(w);
    if (d.width > L - 100) throw new OpError('Door too wide', `A ${fmt(ctx, d.width)} door doesn't fit this wall.`);
    d.offset = Math.max(d.width / 2 + 50, Math.min(L - d.width / 2 - 50, d.offset));
    ctx.notes.push(`Door ${d.tag} updated`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<Window, 'id'>> }>({
  type: 'window.update', title: 'Edit window', cap: 'model.edit', model: true,
  description: 'Change window width, height, sill, type, glazing or frame.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const win = ctx.b.windows[p.id];
    if (!win) throw new OpError('No window', 'That window no longer exists.');
    const w = requireWall(ctx, p.patch.wallId ?? win.wallId);
    Object.assign(win, p.patch);
    const L = wallLength(w);
    win.width = Math.min(win.width, L - 200);
    win.offset = Math.max(win.width / 2 + 50, Math.min(L - win.width / 2 - 50, win.offset));
    ctx.notes.push(`Window ${win.tag} updated`);
  },
});

// ------------------------------------------------------- stairs, roofs, etc.

defineOp<Partial<Stair> & { levelId: Id; origin: Vec2 }>({
  type: 'stair.create', title: 'Add stair', cap: 'model.edit', model: true,
  description: 'Add a stair (straight, L, U or spiral). Risers and treads are calculated from the floor-to-floor height.',
  schema: { type: 'object', properties: { levelId: { type: 'string' }, origin: vec2, kind: { type: 'string', enum: ['straight', 'L', 'U', 'spiral'] }, rotation: { type: 'number' }, width: { type: 'number' } }, required: ['levelId', 'origin'] },
  run(ctx, p) {
    requireLevel(ctx, p.levelId);
    const s = makeStair(p);
    ctx.b.stairs[s.id] = s;
    ctx.created.push({ kind: 'stair', id: s.id });
    ctx.notes.push(`${s.kind === 'U' ? 'U-shaped' : s.kind === 'L' ? 'L-shaped' : s.kind} stair added`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<Stair, 'id'>> }>({
  type: 'stair.update', title: 'Edit stair', cap: 'model.edit', model: true,
  description: 'Change stair type, width, riser target, tread, rotation, position or finish.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const s = ctx.b.stairs[p.id];
    if (!s) throw new OpError('No stair', 'That stair no longer exists.');
    Object.assign(s, p.patch);
    ctx.notes.push('Stair redesigned');
  },
});

defineOp<Partial<Roof> & { levelId: Id }>({
  type: 'roof.create', title: 'Add roof', cap: 'model.edit', model: true,
  description: 'Generate a roof on top of a level (flat, gable, hip, shed, butterfly, mansard).',
  schema: { type: 'object', properties: { levelId: { type: 'string' }, kind: { type: 'string', enum: ['flat', 'gable', 'hip', 'shed', 'butterfly', 'mansard'] }, pitch: { type: 'number' }, overhang: { type: 'number' } }, required: ['levelId'] },
  run(ctx, p) {
    requireLevel(ctx, p.levelId);
    const r = makeRoof(p, style(ctx));
    Object.assign(r, p);
    ctx.b.roofs[r.id] = r;
    ctx.created.push({ kind: 'roof', id: r.id });
    ctx.notes.push(`${r.kind[0].toUpperCase() + r.kind.slice(1)} roof added`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<Roof, 'id'>> }>({
  type: 'roof.update', title: 'Edit roof', cap: 'model.edit', model: true,
  description: 'Change roof type, pitch, overhang, ridge direction, parapet or material.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const r = ctx.b.roofs[p.id];
    if (!r) throw new OpError('No roof', 'That roof no longer exists.');
    const before = r.kind;
    Object.assign(r, p.patch);
    if (r.kind === 'flat' && before !== 'flat' && !p.patch.parapetHeight) r.parapetHeight = 1050;
    ctx.notes.push(p.patch.kind && p.patch.kind !== before ? `Roof changed to ${r.kind}` : 'Roof updated');
  },
});

defineOp<{ levelId: Id; position: Vec2; width?: number; depth?: number; shape?: 'rect' | 'round' }>({
  type: 'column.create', title: 'Add column', cap: 'model.edit', model: true,
  description: 'Add a conceptual structural column.',
  schema: { type: 'object', properties: { levelId: { type: 'string' }, position: vec2, width: { type: 'number' }, depth: { type: 'number' }, shape: { type: 'string' } }, required: ['levelId', 'position'] },
  run(ctx, p) {
    requireLevel(ctx, p.levelId);
    const c = makeColumn(p);
    ctx.b.columns[c.id] = c;
    ctx.created.push({ kind: 'column', id: c.id });
    ctx.notes.push('Column added');
  },
});

defineOp<{ id: Id; patch: Partial<Omit<import('../model/types').Column, 'id'>> }>({
  type: 'column.update', title: 'Edit column', cap: 'model.edit', model: true,
  description: 'Change a column\u2019s size, shape, rotation or material.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const c = ctx.b.columns[p.id];
    if (!c) throw new OpError('No column', 'That column no longer exists.');
    Object.assign(c, p.patch);
    ctx.notes.push('Column updated');
  },
});

defineOp<{ levelId: Id; assetId: string; position: Vec2; rotation?: number; variant?: string }>({
  type: 'furniture.create', title: 'Place furniture', cap: 'model.edit', model: true,
  description: 'Place an asset from the library (e.g. bed-king, sofa-3, dining-6, wc, tree, car-suv).',
  schema: { type: 'object', properties: { levelId: { type: 'string' }, assetId: { type: 'string' }, position: vec2, rotation: { type: 'number' } }, required: ['levelId', 'assetId', 'position'] },
  run(ctx, p) {
    requireLevel(ctx, p.levelId);
    const asset = ASSET_BY_ID[p.assetId];
    if (!asset) throw new OpError('No asset', 'That item isn’t in the library.');
    const f = makeFurniture(p);
    ctx.b.furniture[f.id] = f;
    ctx.created.push({ kind: 'furniture', id: f.id });
    ctx.notes.push(`${asset.name} placed`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<FurnitureItem, 'id'>> }>({
  type: 'furniture.update', title: 'Edit furniture', cap: 'model.edit', model: true,
  description: 'Rotate, resize, swap variant/material or replace the asset of a placed item.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const f = ctx.b.furniture[p.id];
    if (!f) throw new OpError('No item', 'That item no longer exists.');
    Object.assign(f, p.patch);
    ctx.notes.push(`${ASSET_BY_ID[f.assetId]?.name ?? 'Item'} updated`);
  },
});

// ------------------------------------------------------------------ generic

defineOp<{ refs: ElementRef[]; delta: Vec2 }>({
  type: 'element.move', title: 'Move', cap: 'model.edit', model: true,
  description: 'Move elements by a plan offset in mm. Walls keep their joins; doors and windows slide along their wall.',
  schema: { type: 'object', properties: { refs: { type: 'array', items: refSchema }, delta: vec2 }, required: ['refs', 'delta'] },
  run(ctx, p) {
    const b = ctx.b;
    for (const r of p.refs) {
      switch (r.kind) {
        case 'wall': requireWall(ctx, r.id); moveWall(ctx, r.id, p.delta); break;
        case 'door': case 'window': {
          const o = r.kind === 'door' ? b.doors[r.id] : b.windows[r.id];
          if (!o) break;
          const w = b.walls[o.wallId];
          const L = wallLength(w);
          o.offset = Math.max(o.width / 2 + 50, Math.min(L - o.width / 2 - 50, o.offset + dot(p.delta, norm(sub(w.b, w.a)))));
          break;
        }
        case 'room': if (b.rooms[r.id]) b.rooms[r.id].point = add(b.rooms[r.id].point, p.delta); break;
        case 'furniture': if (b.furniture[r.id]) b.furniture[r.id].position = add(b.furniture[r.id].position, p.delta); break;
        case 'column': if (b.columns[r.id]) b.columns[r.id].position = add(b.columns[r.id].position, p.delta); break;
        case 'stair': if (b.stairs[r.id]) b.stairs[r.id].origin = add(b.stairs[r.id].origin, p.delta); break;
        case 'beam': if (b.beams[r.id]) { b.beams[r.id].a = add(b.beams[r.id].a, p.delta); b.beams[r.id].b = add(b.beams[r.id].b, p.delta); } break;
        case 'siteFeature': {
          const f = ctx.doc.site.features[r.id];
          if (!f) break;
          if (f.polygon) f.polygon = f.polygon.map((q) => add(q, p.delta));
          if (f.position) f.position = add(f.position, p.delta);
          break;
        }
        default: break;
      }
    }
    ctx.notes.push(p.refs.length === 1 ? `${label(p.refs[0].kind)} moved ${fmt(ctx, Math.hypot(p.delta.x, p.delta.y))}` : `${p.refs.length} elements moved`);
  },
});

function moveWall(ctx: OpContext, id: Id, delta: Vec2) {
  const w = ctx.b.walls[id];
  if (!w) return;
  const n = perp(norm(sub(w.b, w.a)));
  const across = dot(delta, n);
  for (const o of Object.values(ctx.b.walls)) {
    if (o.levelId !== w.levelId || o.id === w.id) continue;
    for (const end of ['a', 'b'] as const) {
      const pr = projectToSegment(o[end], w.a, w.b);
      if (pr.dist <= TOL && pr.t > 0.001 && pr.t < 0.999) o[end] = add(o[end], scale(n, across));
    }
  }
  const na = add(w.a, delta), nb = add(w.b, delta);
  moveJoinedEndpoints(ctx.b, w.levelId, w.a, na, w.id);
  moveJoinedEndpoints(ctx.b, w.levelId, w.b, nb, w.id);
  w.a = na; w.b = nb;
}

function label(k: ElementRef['kind']) {
  return ({ wall: 'Wall', door: 'Door', window: 'Window', room: 'Room', stair: 'Stair', roof: 'Roof', column: 'Column', beam: 'Beam', furniture: 'Item', level: 'Level', siteFeature: 'Site feature' } as const)[k];
}

defineOp<{ refs: ElementRef[]; angle: number }>({
  type: 'element.rotate', title: 'Rotate', cap: 'model.edit', model: true,
  description: 'Rotate furniture, columns or stairs by an angle in degrees.',
  schema: { type: 'object', properties: { refs: { type: 'array', items: refSchema }, angle: { type: 'number' } }, required: ['refs', 'angle'] },
  run(ctx, p) {
    for (const r of p.refs) {
      if (r.kind === 'furniture' && ctx.b.furniture[r.id]) ctx.b.furniture[r.id].rotation = (ctx.b.furniture[r.id].rotation + p.angle) % 360;
      if (r.kind === 'column' && ctx.b.columns[r.id]) ctx.b.columns[r.id].rotation = (ctx.b.columns[r.id].rotation + p.angle) % 360;
      if (r.kind === 'stair' && ctx.b.stairs[r.id]) ctx.b.stairs[r.id].rotation = (ctx.b.stairs[r.id].rotation + p.angle) % 360;
    }
    ctx.notes.push(`Rotated ${p.angle}°`);
  },
});

defineOp<{ refs: ElementRef[] }>({
  type: 'element.delete', title: 'Delete', cap: 'model.edit', model: true,
  description: 'Delete elements. Deleting a wall also removes its doors and windows.',
  schema: { type: 'object', properties: { refs: { type: 'array', items: refSchema } }, required: ['refs'] },
  run(ctx, p) {
    const b = ctx.b;
    for (const r of p.refs) {
      if (r.kind === 'wall') deleteWallCascade(b, r.id);
      else if (r.kind === 'level') {
        if (Object.keys(b.levels).length <= 1) throw new OpError('Last level', 'A project needs at least one level.');
        for (const k of ['walls', 'rooms', 'stairs', 'roofs', 'columns', 'beams', 'furniture'] as const) {
          const col = b[k] as Record<Id, { levelId: Id }>;
          for (const [id, el] of Object.entries(col)) if (el.levelId === r.id) { if (k === 'walls') deleteWallCascade(b, id); else delete col[id]; }
        }
        delete b.levels[r.id];
      } else if (r.kind === 'siteFeature') delete ctx.doc.site.features[r.id];
      else delete (b[COLLECTION[r.kind]] as Record<Id, unknown>)[r.id];
    }
    ctx.notes.push(p.refs.length === 1 ? `${label(p.refs[0].kind)} deleted` : `${p.refs.length} elements deleted`);
  },
});

defineOp<{ refs: ElementRef[]; delta: Vec2 }>({
  type: 'element.duplicate', title: 'Duplicate', cap: 'model.edit', model: true,
  description: 'Copy elements with an offset.',
  schema: { type: 'object', properties: { refs: { type: 'array', items: refSchema }, delta: vec2 }, required: ['refs', 'delta'] },
  run(ctx, p) {
    const b = ctx.b;
    for (const r of p.refs) {
      if (r.kind === 'level' || r.kind === 'siteFeature' || r.kind === 'door' || r.kind === 'window') continue;
      const col = b[COLLECTION[r.kind]] as Record<Id, Record<string, unknown>>;
      const src = col[r.id];
      if (!src) continue;
      const copy = JSON.parse(JSON.stringify(src)) as Record<string, unknown> & { id: string };
      copy.id = uid(r.kind.slice(0, 2));
      for (const k of ['a', 'b', 'position', 'point', 'origin']) if (copy[k]) copy[k] = add(copy[k] as Vec2, p.delta);
      col[copy.id] = copy;
      ctx.created.push({ kind: r.kind, id: copy.id });
    }
    ctx.notes.push(p.refs.length === 1 ? `${label(p.refs[0].kind)} duplicated` : `${p.refs.length} elements duplicated`);
  },
});

defineOp<{ delta: Vec2; levelIds?: Id[] }>({
  type: 'building.translate', title: 'Move building', cap: 'model.edit', model: true,
  description: 'Move the whole building (or given levels) on the site — used to resolve setback violations.',
  schema: { type: 'object', properties: { delta: vec2, levelIds: { type: 'array', items: { type: 'string' } } }, required: ['delta'] },
  run(ctx, p) {
    translateLevelContents(ctx.b, new Set(p.levelIds ?? Object.keys(ctx.b.levels)), p.delta);
    ctx.notes.push(`Building moved ${fmt(ctx, Math.hypot(p.delta.x, p.delta.y))}`);
  },
});

defineOp<{ axis: 'x' | 'y'; plane: number; dir: 1 | -1; delta: number; levelIds?: Id[] }>({
  type: 'model.stretch', title: 'Stretch', cap: 'model.edit', model: true,
  description: 'Stretch the model: everything beyond a plane moves by delta; elements crossing it lengthen.',
  schema: { type: 'object', properties: { axis: { type: 'string', enum: ['x', 'y'] }, plane: { type: 'number' }, dir: { type: 'number', enum: [1, -1] }, delta: { type: 'number' } }, required: ['axis', 'plane', 'dir', 'delta'] },
  run(ctx, p) {
    stretch(ctx.b, p.levelIds ?? Object.keys(ctx.b.levels), p.axis, p.plane, p.dir, p.delta);
    ctx.notes.push(`Model stretched ${fmt(ctx, p.delta)}`);
  },
});

// ------------------------------------------------------------------- levels

defineOp<{ name: string; height?: number; copyExteriorFrom?: Id }>({
  type: 'level.create', title: 'Add level', cap: 'model.edit', model: true,
  description: 'Add a level on top of the building; optionally copy the exterior walls of another level.',
  schema: { type: 'object', properties: { name: { type: 'string' }, height: { type: 'number' }, copyExteriorFrom: { type: 'string' } }, required: ['name'] },
  run(ctx, p) {
    const ls = levelsSorted(ctx.b as BuildingModel);
    const top = ls[ls.length - 1];
    const l = makeLevel({ name: p.name, elevation: top ? top.elevation + top.height : 0, height: p.height ?? 3200, order: (top?.order ?? -1) + 1 });
    ctx.b.levels[l.id] = l;
    if (p.copyExteriorFrom) {
      for (const w of Object.values(ctx.b.walls)) {
        if (w.levelId !== p.copyExteriorFrom || w.kind !== 'exterior') continue;
        const copy = { ...JSON.parse(JSON.stringify(w)), id: uid('w'), levelId: l.id };
        ctx.b.walls[copy.id] = copy;
      }
    }
    // Roofs on the old top level move up.
    if (top) for (const r of Object.values(ctx.b.roofs)) if (r.levelId === top.id) r.levelId = l.id;
    ctx.created.push({ kind: 'level', id: l.id });
    ctx.notes.push(`${p.name} added`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<Level, 'id'>> }>({
  type: 'level.update', title: 'Edit level', cap: 'model.edit', model: true,
  description: 'Rename a level, change its floor-to-floor height (levels above move automatically), visibility or lock.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const l = ctx.b.levels[p.id];
    if (!l) throw new OpError('No level', 'That level no longer exists.');
    const oldH = l.height, oldE = l.elevation;
    Object.assign(l, p.patch);
    // Dependent update: everything above follows height / elevation changes.
    const dh = (l.height - oldH) + (l.elevation - oldE);
    if (dh) for (const o of Object.values(ctx.b.levels)) if (o.id !== l.id && o.order > l.order) o.elevation += dh;
    if (p.patch.height !== undefined && p.patch.height !== oldH) ctx.notes.push(`${l.name} height ${fmt(ctx, oldH)} → ${fmt(ctx, l.height)}`);
    else if (p.patch.name) ctx.notes.push(`Level renamed to ${l.name}`);
  },
});

// ---------------------------------------------------------------- materials

export type MaterialSlot = 'floor' | 'wallInterior' | 'exterior' | 'core' | 'roof' | 'frame' | 'door' | 'ceiling' | 'stair' | 'furniture';

defineOp<{ refs: ElementRef[]; slot: MaterialSlot; materialId: string }>({
  type: 'material.apply', title: 'Apply material', cap: 'model.edit', model: true,
  description: 'Apply a material to selected elements in a slot (floor, wallInterior, exterior, core, roof, frame, door, ceiling, stair, furniture).',
  schema: { type: 'object', properties: { refs: { type: 'array', items: refSchema }, slot: { type: 'string' }, materialId: { type: 'string' } }, required: ['refs', 'slot', 'materialId'] },
  run(ctx, p) {
    const b = ctx.b;
    for (const r of p.refs) {
      if (r.kind === 'room' && b.rooms[r.id]) {
        const t = b.rooms[r.id];
        if (p.slot === 'floor') t.floorFinishId = p.materialId;
        if (p.slot === 'wallInterior') t.wallFinishId = p.materialId;
        if (p.slot === 'ceiling') t.ceilingFinishId = p.materialId;
      } else if (r.kind === 'wall' && b.walls[r.id]) {
        const w = b.walls[r.id];
        if (p.slot === 'exterior') w.finishExteriorId = p.materialId;
        else if (p.slot === 'core') w.materialId = p.materialId;
        else w.finishInteriorId = p.materialId;
      } else if (r.kind === 'roof' && b.roofs[r.id]) b.roofs[r.id].materialId = p.materialId;
      else if (r.kind === 'window' && b.windows[r.id]) b.windows[r.id].frameMaterialId = p.materialId;
      else if (r.kind === 'door' && b.doors[r.id]) b.doors[r.id].materialId = p.materialId;
      else if (r.kind === 'stair' && b.stairs[r.id]) b.stairs[r.id].materialId = p.materialId;
      else if (r.kind === 'furniture' && b.furniture[r.id]) b.furniture[r.id].materialId = p.materialId;
      else if (r.kind === 'column' && b.columns[r.id]) b.columns[r.id].materialId = p.materialId;
    }
    ctx.notes.push(`${getMaterial(p.materialId).name} applied to ${p.refs.length} element${p.refs.length === 1 ? '' : 's'}`);
  },
});

defineOp<{ from: string; to: string }>({
  type: 'material.replaceGlobal', title: 'Replace material everywhere', cap: 'model.edit', model: true,
  description: 'Replace every use of one material with another across the active design option.',
  schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
  run(ctx, p) {
    let n = 0;
    const swap = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o[k] === p.from) { o[k] = p.to; n++; } };
    const b = ctx.b;
    for (const w of Object.values(b.walls)) swap(w as unknown as Record<string, unknown>, ['materialId', 'finishInteriorId', 'finishExteriorId']);
    for (const r of Object.values(b.rooms)) swap(r as unknown as Record<string, unknown>, ['floorFinishId', 'wallFinishId', 'ceilingFinishId']);
    for (const x of [...Object.values(b.roofs), ...Object.values(b.stairs), ...Object.values(b.doors), ...Object.values(b.columns), ...Object.values(b.beams)]) swap(x as unknown as Record<string, unknown>, ['materialId']);
    for (const x of Object.values(b.windows)) swap(x as unknown as Record<string, unknown>, ['frameMaterialId']);
    for (const f of Object.values(ctx.doc.site.features)) swap(f as unknown as Record<string, unknown>, ['materialId']);
    if (!n) throw new OpError('Not used', `${getMaterial(p.from).name} isn’t used in this design.`);
    ctx.notes.push(`${getMaterial(p.from).name} → ${getMaterial(p.to).name} (${n} places)`);
  },
});

defineOp<{ styleId: StyleId }>({
  type: 'style.apply', title: 'Apply design style', cap: 'model.edit', model: true,
  description: 'Transform the design to a style (modern, contemporary, minimal, traditional, mediterranean, tropical, industrial, luxury): materials, façade, roof, windows, doors and furniture variants change; geometry is preserved.',
  schema: { type: 'object', properties: { styleId: { type: 'string', enum: ['modern', 'contemporary', 'minimal', 'traditional', 'mediterranean', 'tropical', 'industrial', 'luxury'] } }, required: ['styleId'] },
  run(ctx, p) {
    const st = STYLE_BY_ID[p.styleId];
    if (!st) throw new OpError('Unknown style', 'That style isn’t available.');
    const opt = ctx.doc.options.find((o) => o.id === ctx.doc.activeOptionId)!;
    const from = STYLE_BY_ID[opt.style as StyleId];
    opt.style = p.styleId;
    const b = ctx.b;
    for (const w of Object.values(b.walls)) {
      if (w.kind === 'exterior') w.finishExteriorId = w.finishExteriorId === from?.exteriorAccent ? st.exteriorAccent : st.exterior;
      w.finishInteriorId = st.interiorWall;
    }
    for (const r of Object.values(b.rooms)) { r.floorFinishId = floorFor(st, r.fn); r.wallFinishId = wallFinishFor(st, r.fn); }
    for (const roof of Object.values(b.roofs)) {
      roof.kind = st.roof.kind; roof.materialId = st.roof.material; roof.overhang = st.roof.overhang;
      roof.pitch = st.roof.pitch || roof.pitch; roof.parapetHeight = st.roof.kind === 'flat' ? 1050 : 0;
    }
    for (const win of Object.values(b.windows)) { win.kind = st.windowKind; win.frameMaterialId = st.windowFrame; }
    for (const d of Object.values(b.doors)) d.materialId = st.doorMaterial;
    for (const f of Object.values(b.furniture)) {
      const a = ASSET_BY_ID[f.assetId];
      if (a?.variants.some((v) => v.id === st.furnitureVariant)) f.variant = st.furnitureVariant;
    }
    ctx.notes.push(`Style changed${from ? ` from ${from.name}` : ''} to ${st.name}`);
  },
});

export { translateLevelContents };
