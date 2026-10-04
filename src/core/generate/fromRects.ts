/**
 * Build a complete BIM model from a zoning diagram (room rectangles on each
 * level + which rooms connect). Used by the layout generator, Architect AI and
 * templates. It produces *real* elements — walls classified exterior/interior,
 * doors in shared walls, windows sized for daylight, stairs, roof, columns and
 * furniture — never a picture.
 */
import type { BuildingModel, Door, Id, RoomFunction, Stair, StyleId, Wall, Window, Roof } from '../model/types';
import { emptyBuilding } from '../model/query';
import { makeColumn, makeDoor, makeFurniture, makeLevel, makeRoof, makeRoomTag, makeStair, makeWall, makeWindow, EXT_WALL, INT_WALL } from '../model/factory';
import { STYLE_BY_ID } from '../catalog/styles';
import { ASSET_BY_ID } from '../catalog/assets';
import type { Vec2 } from '../geometry/vec';
import { HABITABLE } from '../derive/analysis';

export interface RoomSpec { key: string; name: string; fn: RoomFunction; x: number; y: number; w: number; h: number }
export type Side = 'n' | 's' | 'e' | 'w';
export interface DoorSpec { a: string; b: string | Side; kind?: Door['kind']; width?: number; at?: number }
export interface StairSpec { room: string; kind?: Stair['kind']; tread?: number; width?: number; rotation?: number; mirrored?: boolean }
export interface LevelSpec { name: string; height?: number; slab?: number; rooms: RoomSpec[]; doors: DoorSpec[]; stair?: StairSpec; windows?: boolean; furnish?: boolean }
export interface BuildingSpec { levels: LevelSpec[]; style: StyleId; groundElevation?: number; roof?: Partial<Roof>; columns?: boolean }

const TOL = 5;
const WINDOW_HEIGHT = 1500;

interface Seg { a: Vec2; b: Vec2; ext: boolean }

export function buildFromSpec(spec: BuildingSpec): BuildingModel {
  const b = emptyBuilding();
  const st = STYLE_BY_ID[spec.style];
  let elevation = spec.groundElevation ?? 450;
  spec.levels.forEach((ls, li) => {
    const level = makeLevel({ name: ls.name, elevation, height: ls.height ?? 3200, slabThickness: li === 0 ? elevation : ls.slab ?? 150, order: li });
    b.levels[level.id] = level;
    elevation += level.height;
    const rooms = ls.rooms;
    // --- walls: split each grid line at every room corner, classify, merge
    const segs = wallSegments(rooms);
    const walls: Wall[] = segs.map((s) => makeWall({ levelId: level.id, a: s.a, b: s.b, kind: s.ext ? 'exterior' : 'interior', thickness: s.ext ? EXT_WALL : INT_WALL }, spec.style));
    for (const w of walls) b.walls[w.id] = w;

    // --- room tags
    const tagFor = new Map<string, Id>();
    rooms.forEach((r, i) => {
      const t = makeRoomTag({ levelId: level.id, point: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, name: r.name, fn: r.fn, number: `${li}${String(i + 1).padStart(2, '0')}` }, spec.style);
      b.rooms[t.id] = t;
      tagFor.set(r.key, t.id);
    });

    // --- doors
    const byKey = new Map(rooms.map((r) => [r.key, r]));
    const doorSides = new Map<string, { side: Side; at: number; width: number }[]>();
    let doorN = 1;
    const tagDoor = () => `D-${(li + 1) * 100 + doorN++}`;
    for (const d of ls.doors) {
      const A = byKey.get(d.a);
      if (!A) continue;
      let line: { axis: 'x' | 'y'; c: number; lo: number; hi: number; sideA: Side } | null = null;
      if (d.b === 'n' || d.b === 's' || d.b === 'e' || d.b === 'w') {
        const side = d.b;
        line = side === 's' ? { axis: 'y', c: A.y, lo: A.x, hi: A.x + A.w, sideA: 's' } : side === 'n' ? { axis: 'y', c: A.y + A.h, lo: A.x, hi: A.x + A.w, sideA: 'n' }
          : side === 'w' ? { axis: 'x', c: A.x, lo: A.y, hi: A.y + A.h, sideA: 'w' } : { axis: 'x', c: A.x + A.w, lo: A.y, hi: A.y + A.h, sideA: 'e' };
      } else {
        const B = byKey.get(d.b);
        if (!B) continue;
        line = sharedEdge(A, B);
      }
      if (!line) continue;
      const wet = A.fn === 'bathroom' || A.fn === 'powder' || (typeof d.b === 'string' && (byKey.get(d.b)?.fn === 'bathroom' || byKey.get(d.b)?.fn === 'powder'));
      const width = d.width ?? (d.kind === 'opening' ? Math.min(1800, line.hi - line.lo - 400) : d.kind === 'sliding' ? 2400 : d.kind === 'pivot' ? 1200 : d.kind === 'double' || d.kind === 'french' ? 1500 : wet ? 750 : 900);
      const span = line.hi - line.lo;
      if (span < width + 200) continue;
      const centre = d.at !== undefined ? line.lo + Math.max(width / 2 + 150, Math.min(span - width / 2 - 150, d.at)) : line.lo + span / 2;
      const p: Vec2 = line.axis === 'y' ? { x: centre, y: line.c } : { x: line.c, y: centre };
      const wall = walls.find((w) => onSegment(p, w) && along(w, line!.axis));
      if (!wall) continue;
      const offset = Math.hypot(p.x - wall.a.x, p.y - wall.a.y);
      // Swing into room A (or into the building for exterior doors).
      const wd = { x: wall.b.x - wall.a.x, y: wall.b.y - wall.a.y };
      const toA = { x: A.x + A.w / 2 - p.x, y: A.y + A.h / 2 - p.y };
      const side: Door['side'] = -wd.y * toA.x + wd.x * toA.y >= 0 ? 'left' : 'right';
      const kind = d.kind ?? 'single';
      const door = makeDoor({ wallId: wall.id, offset, width, kind, side, hinge: 'start', height: kind === 'sliding' || kind === 'pivot' ? 2400 : 2100, tag: tagDoor(), materialId: st.doorMaterial }, spec.style);
      b.doors[door.id] = door;
      const list = doorSides.get(d.a) ?? [];
      list.push({ side: line.sideA, at: centre, width });
      doorSides.set(d.a, list);
      if (typeof d.b === 'string' && byKey.has(d.b)) {
        const opp: Side = line.sideA === 's' ? 'n' : line.sideA === 'n' ? 's' : line.sideA === 'e' ? 'w' : 'e';
        const l2 = doorSides.get(d.b) ?? [];
        l2.push({ side: opp, at: centre, width });
        doorSides.set(d.b, l2);
      }
    }

    // --- windows on exterior edges
    if (ls.windows !== false) {
      let winN = 1;
      for (const r of rooms) {
        const habitable = HABITABLE.includes(r.fn) || r.fn === 'family' || r.fn === 'foyer';
        const wet = r.fn === 'bathroom' || r.fn === 'powder' || r.fn === 'utility' || r.fn === 'walkin' || r.fn === 'pooja';
        if (!habitable && !wet && r.fn !== 'stair') continue;
        const edges = roomEdges(r)
          .map((e) => ({ ...e, wall: walls.find((w) => w.kind === 'exterior' && onSegment(e.mid, w) && along(w, e.axis)) }))
          .filter((e) => e.wall)
          .sort((x, y) => y.len - x.len);
        if (!edges.length) continue;
        const area = (r.w - 115) * (r.h - 115);
        let needed = habitable ? Math.max(1200, (area * 0.14 * st.glazingFactor) / WINDOW_HEIGHT) : 600;
        for (const e of edges) {
          if (needed < 300) break;
          const doorsHere = (doorSides.get(r.key) ?? []).filter((d) => d.side === e.side);
          const free = freeIntervals(e.lo + 450, e.hi - 450, doorsHere.map((d) => [d.at - d.width / 2 - 300, d.at + d.width / 2 + 300] as [number, number]));
          const best = free.sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
          if (!best || best[1] - best[0] < 600) continue;
          const width = Math.round(Math.min(needed, best[1] - best[0], habitable ? 3600 : 900) / 50) * 50;
          if (width < 600) continue;
          const centre = (best[0] + best[1]) / 2;
          const p: Vec2 = e.axis === 'y' ? { x: centre, y: e.c } : { x: e.c, y: centre };
          const w = e.wall!;
          const win = makeWindow({
            wallId: w.id, offset: Math.hypot(p.x - w.a.x, p.y - w.a.y), width,
            height: wet ? 600 : r.fn === 'stair' ? 1200 : WINDOW_HEIGHT, sill: wet ? 1500 : r.fn === 'stair' ? 1200 : 750,
            kind: wet ? 'louvre' : st.windowKind, tag: `W-${(li + 1) * 100 + winN++}`,
          }, spec.style);
          b.windows[win.id] = win;
          needed -= width;
          if (!habitable) break;
        }
      }
    }

    // --- stair
    if (ls.stair) {
      const r = byKey.get(ls.stair.room);
      if (r) {
        const kind = ls.stair.kind ?? 'U';
        const width = ls.stair.width ?? (kind === 'U' ? 1000 : 1050);
        const span = kind === 'U' ? 2 * width + 150 : width;
        const inX = r.x + INT_WALL / 2 + 20;
        const net = r.w - INT_WALL - 40;
        const s = makeStair({ levelId: level.id, kind, width, tread: ls.stair.tread ?? 270, origin: { x: inX + Math.max(0, (net - span) / 2), y: r.y + INT_WALL / 2 + 20 }, rotation: ls.stair.rotation ?? 0, mirrored: ls.stair.mirrored ?? false });
        b.stairs[s.id] = s;
      }
    }

    // --- furniture
    if (ls.furnish !== false) for (const r of rooms) furnish(b, level.id, r, doorSides.get(r.key) ?? [], spec.style);

    // --- conceptual RCC frame at exterior corners
    if (spec.columns) {
      const pts = new Map<string, Vec2>();
      for (const w of walls) if (w.kind === 'exterior') for (const p of [w.a, w.b]) pts.set(`${Math.round(p.x)}:${Math.round(p.y)}`, p);
      for (const p of pts.values()) { const c = makeColumn({ levelId: level.id, position: p, width: 300, depth: 300 }); b.columns[c.id] = c; }
    }
  });
  const levels = Object.values(b.levels).sort((x, y) => x.order - y.order);
  const top = levels[levels.length - 1];
  if (top) { const roof = makeRoof({ levelId: top.id, ...spec.roof }, spec.style); b.roofs[roof.id] = roof; }
  return b;
}

// ---------------------------------------------------------------- helpers

export function along(w: Wall, axis: 'x' | 'y') {
  return axis === 'y' ? Math.abs(w.a.y - w.b.y) < TOL : Math.abs(w.a.x - w.b.x) < TOL;
}

export function onSegment(p: Vec2, w: Wall) {
  const minX = Math.min(w.a.x, w.b.x) - TOL, maxX = Math.max(w.a.x, w.b.x) + TOL;
  const minY = Math.min(w.a.y, w.b.y) - TOL, maxY = Math.max(w.a.y, w.b.y) + TOL;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function wallSegments(rooms: RoomSpec[]): Seg[] {
  const out: Seg[] = [];
  const inside = (p: Vec2) => rooms.some((r) => p.x > r.x + TOL && p.x < r.x + r.w - TOL && p.y > r.y + TOL && p.y < r.y + r.h - TOL);
  for (const axis of ['y', 'x'] as const) {
    // axis 'y' → horizontal lines (constant y)
    const lines = new Map<number, [number, number][]>();
    for (const r of rooms) {
      const edges: [number, number, number][] = axis === 'y' ? [[r.y, r.x, r.x + r.w], [r.y + r.h, r.x, r.x + r.w]] : [[r.x, r.y, r.y + r.h], [r.x + r.w, r.y, r.y + r.h]];
      for (const [c, lo, hi] of edges) {
        const key = [...lines.keys()].find((k) => Math.abs(k - c) < TOL) ?? c;
        const l = lines.get(key) ?? [];
        l.push([lo, hi]);
        lines.set(key, l);
      }
    }
    for (const [c, ivs] of lines) {
      const cuts = [...new Set(ivs.flat().concat(rooms.flatMap((r) => (axis === 'y' ? [r.x, r.x + r.w] : [r.y, r.y + r.h]))))].sort((a, b) => a - b);
      const covered = (t: number) => ivs.some(([lo, hi]) => t > lo + TOL && t < hi - TOL);
      let cur: { lo: number; hi: number; ext: boolean } | null = null;
      for (let i = 0; i + 1 < cuts.length; i++) {
        const lo = cuts[i], hi = cuts[i + 1];
        if (hi - lo < TOL) continue;
        const mid = (lo + hi) / 2;
        if (!covered(mid)) { if (cur) { out.push(seg(axis, c, cur)); cur = null; } continue; }
        const p1: Vec2 = axis === 'y' ? { x: mid, y: c + 200 } : { x: c + 200, y: mid };
        const p2: Vec2 = axis === 'y' ? { x: mid, y: c - 200 } : { x: c - 200, y: mid };
        const ext = !(inside(p1) && inside(p2));
        if (cur && cur.ext === ext && Math.abs(cur.hi - lo) < TOL) cur.hi = hi;
        else { if (cur) out.push(seg(axis, c, cur)); cur = { lo, hi, ext }; }
      }
      if (cur) out.push(seg(axis, c, cur));
    }
  }
  return out;
}

function seg(axis: 'x' | 'y', c: number, iv: { lo: number; hi: number; ext: boolean }): Seg {
  return axis === 'y' ? { a: { x: iv.lo, y: c }, b: { x: iv.hi, y: c }, ext: iv.ext } : { a: { x: c, y: iv.lo }, b: { x: c, y: iv.hi }, ext: iv.ext };
}

export function sharedEdge(A: RoomSpec, B: RoomSpec): { axis: 'x' | 'y'; c: number; lo: number; hi: number; sideA: Side } | null {
  const ox = [Math.max(A.x, B.x), Math.min(A.x + A.w, B.x + B.w)];
  const oy = [Math.max(A.y, B.y), Math.min(A.y + A.h, B.y + B.h)];
  if (Math.abs(A.y + A.h - B.y) < TOL && ox[1] - ox[0] > 600) return { axis: 'y', c: B.y, lo: ox[0], hi: ox[1], sideA: 'n' };
  if (Math.abs(B.y + B.h - A.y) < TOL && ox[1] - ox[0] > 600) return { axis: 'y', c: A.y, lo: ox[0], hi: ox[1], sideA: 's' };
  if (Math.abs(A.x + A.w - B.x) < TOL && oy[1] - oy[0] > 600) return { axis: 'x', c: B.x, lo: oy[0], hi: oy[1], sideA: 'e' };
  if (Math.abs(B.x + B.w - A.x) < TOL && oy[1] - oy[0] > 600) return { axis: 'x', c: A.x, lo: oy[0], hi: oy[1], sideA: 'w' };
  return null;
}

export function roomsAdjacent(A: RoomSpec, B: RoomSpec, min = 1000): boolean {
  const e = sharedEdge(A, B);
  return !!e && e.hi - e.lo >= min;
}

export function roomEdges(r: RoomSpec) {
  return [
    { side: 's' as Side, axis: 'y' as const, c: r.y, lo: r.x, hi: r.x + r.w, len: r.w, mid: { x: r.x + r.w / 2, y: r.y } },
    { side: 'n' as Side, axis: 'y' as const, c: r.y + r.h, lo: r.x, hi: r.x + r.w, len: r.w, mid: { x: r.x + r.w / 2, y: r.y + r.h } },
    { side: 'w' as Side, axis: 'x' as const, c: r.x, lo: r.y, hi: r.y + r.h, len: r.h, mid: { x: r.x, y: r.y + r.h / 2 } },
    { side: 'e' as Side, axis: 'x' as const, c: r.x + r.w, lo: r.y, hi: r.y + r.h, len: r.h, mid: { x: r.x + r.w, y: r.y + r.h / 2 } },
  ];
}

export function freeIntervals(lo: number, hi: number, blocked: [number, number][]): [number, number][] {
  let free: [number, number][] = [[lo, hi]];
  for (const [b0, b1] of blocked) {
    free = free.flatMap(([a0, a1]) => {
      if (b1 <= a0 || b0 >= a1) return [[a0, a1]];
      const r: [number, number][] = [];
      if (b0 > a0) r.push([a0, b0]);
      if (b1 < a1) r.push([b1, a1]);
      return r;
    });
  }
  return free.filter(([a, b]) => b - a > 0);
}

// ------------------------------------------------------------- furnishing

export const ROT: Record<Side, number> = { n: 0, s: 180, e: -90, w: 90 };

/** Place an asset against one wall of a rectangular room (inset from the wall centre-lines). */
export function placeAgainst(b: BuildingModel, levelId: Id, r: { x: number; y: number; w: number; h: number }, side: Side | 'center', assetId: string, along = 0.5, gap = 0, rotExtra = 0, style: StyleId = 'modern'): boolean {
  const a = ASSET_BY_ID[assetId];
  if (!a) return false;
  const st = STYLE_BY_ID[style];
  const inset = INT_WALL / 2 + 60;
  const x0 = r.x + inset, x1 = r.x + r.w - inset, y0 = r.y + inset, y1 = r.y + r.h - inset;
  const W = x1 - x0, H = y1 - y0;
  let x: number, y: number, rot: number;
  if (side === 'center') {
    const fw = rotExtra % 180 === 0 ? a.size.w : a.size.d, fd = rotExtra % 180 === 0 ? a.size.d : a.size.w;
    if (fw > W || fd > H) return false;
    x = x0 + fw / 2 + (W - fw) * along; y = (y0 + y1) / 2 + gap; rot = rotExtra;
  } else {
    const horizontal = side === 'n' || side === 's';
    const depth = a.size.d, width = a.size.w;
    if ((horizontal ? width : depth) > (horizontal ? W : H) + 1 || (horizontal ? depth : width) > (horizontal ? H : W) + 1) return false;
    if (side === 'n') { x = x0 + width / 2 + (W - width) * along; y = y1 - depth / 2 - gap; }
    else if (side === 's') { x = x0 + width / 2 + (W - width) * along; y = y0 + depth / 2 + gap; }
    else if (side === 'e') { y = y0 + width / 2 + (H - width) * along; x = x1 - depth / 2 - gap; }
    else { y = y0 + width / 2 + (H - width) * along; x = x0 + depth / 2 + gap; }
    rot = ROT[side] + rotExtra;
  }
  const f = makeFurniture({ levelId, assetId, position: { x, y }, rotation: rot, variant: a.variants.some((v) => v.id === st.furnitureVariant) ? st.furnitureVariant : undefined });
  b.furniture[f.id] = f;
  return true;
}

export function furnish(b: BuildingModel, levelId: Id, r: RoomSpec, doors: { side: Side; at: number; width: number }[], style: StyleId) {
  const st = STYLE_BY_ID[style];
  const inset = INT_WALL / 2 + 60;
  const x0 = r.x + inset, x1 = r.x + r.w - inset, y0 = r.y + inset, y1 = r.y + r.h - inset;
  const W = x1 - x0, H = y1 - y0;
  const doorSides = new Set(doors.map((d) => d.side));
  const opposite: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
  const pickWall = (prefer: Side[]): Side => prefer.find((s) => !doorSides.has(s)) ?? prefer[0];
  const place = (assetId: string, side: Side, along = 0.5, gap = 0, rotExtra = 0) => {
    const a = ASSET_BY_ID[assetId];
    if (!a) return;
    const horizontal = side === 'n' || side === 's';
    const depth = a.size.d, width = a.size.w;
    if ((horizontal ? width : depth) > (horizontal ? W : H) + 1 || (horizontal ? depth : width) > (horizontal ? H : W) + 1) return;
    let x: number, y: number;
    if (side === 'n') { x = x0 + width / 2 + (W - width) * along; y = y1 - depth / 2 - gap; }
    else if (side === 's') { x = x0 + width / 2 + (W - width) * along; y = y0 + depth / 2 + gap; }
    else if (side === 'e') { y = y0 + width / 2 + (H - width) * along; x = x1 - depth / 2 - gap; }
    else { y = y0 + width / 2 + (H - width) * along; x = x0 + depth / 2 + gap; }
    const f = makeFurniture({ levelId, assetId, position: { x, y }, rotation: ROT[side] + rotExtra, variant: a.variants.some((v) => v.id === st.furnitureVariant) ? st.furnitureVariant : undefined });
    b.furniture[f.id] = f;
  };
  const center = (assetId: string, rot = 0, dx = 0, dy = 0): boolean => {
    const a = ASSET_BY_ID[assetId];
    if (!a) return false;
    const fw = rot % 180 === 0 ? a.size.w : a.size.d, fd = rot % 180 === 0 ? a.size.d : a.size.w;
    if (fw > W - 600 || fd > H - 600) return false;
    const f = makeFurniture({ levelId, assetId, position: { x: (x0 + x1) / 2 + dx, y: (y0 + y1) / 2 + dy }, rotation: rot, variant: a.variants.some((v) => v.id === st.furnitureVariant) ? st.furnitureVariant : undefined });
    b.furniture[f.id] = f;
    return true;
  };
  const longSides: Side[] = W >= H ? ['n', 's', 'e', 'w'] : ['e', 'w', 'n', 's'];
  switch (r.fn) {
    case 'master_bedroom':
    case 'bedroom': {
      const headSide = pickWall(W >= H ? ['e', 'w', 'n', 's'] : ['n', 's', 'e', 'w']);
      const bed = r.fn === 'master_bedroom' || Math.min(W, H) > 3300 ? 'bed-king' : Math.min(W, H) > 2800 ? 'bed-queen' : 'bed-single';
      place(bed, headSide);
      const bedA = ASSET_BY_ID[bed];
      const off = (bedA.size.w / 2 + 300) / (headSide === 'n' || headSide === 's' ? W : H);
      place('side-table', headSide, Math.max(0, 0.5 - off - 0.02));
      place('side-table', headSide, Math.min(1, 0.5 + off + 0.02));
      const wardSide = pickWall([opposite[headSide], ...(['n', 's', 'e', 'w'] as Side[]).filter((s) => s !== headSide)]);
      if (wardSide !== headSide) place('wardrobe', wardSide, 0.95);
      break;
    }
    case 'living': {
      const tvSide = pickWall(longSides);
      place('tv-unit', tvSide);
      const sofaSide = opposite[tvSide];
      const horizontal = tvSide === 'n' || tvSide === 's';
      const span = horizontal ? H : W;
      const sofa = (horizontal ? W : H) > 3200 ? 'sofa-l' : 'sofa-3';
      place(sofa, sofaSide, 0.5, Math.max(0, span * 0.12));
      center('rug', horizontal ? 0 : 90);
      center('coffee-table', horizontal ? 0 : 90);
      place('plant-indoor', tvSide, 0.02, 0);
      if (W > 4000 && H > 4000) place('armchair', horizontal ? 'e' : 'n', 0.5, 300, horizontal ? -90 : 0);
      break;
    }
    case 'family':
    case 'media': {
      const tvSide = pickWall(longSides);
      place('tv-unit', tvSide);
      place('sofa-3', opposite[tvSide], 0.5, 200);
      break;
    }
    case 'dining': if (!center('dining-6', W >= H ? 0 : 90)) center('dining-4', W >= H ? 90 : 0); break;
    case 'kitchen': {
      const runSide = pickWall(longSides);
      place('kitchen-run', runSide, 0.5);
      const sinkSide = pickWall(([opposite[runSide], ...(['n', 's', 'e', 'w'] as Side[])] as Side[]).filter((s) => s !== runSide));
      place('kitchen-sink', sinkSide, 0.3);
      place('fridge', sinkSide, 0.97);
      if (W > 3600 && H > 3600) center('island', W >= H ? 0 : 90);
      break;
    }
    case 'bathroom': {
      const s1 = pickWall(longSides);
      place('vanity', s1, 0.15);
      place('wc', s1, 0.85);
      if (Math.max(W, H) > 2300) place('shower', opposite[s1], 0.9);
      break;
    }
    case 'powder': { const s1 = pickWall(longSides); place('vanity', s1, 0.2); place('wc', s1, 0.85); break; }
    case 'pooja': place('mandir', pickWall(['n', 'e', 'w', 's'])); break;
    case 'study': place('desk', pickWall(longSides)); place('bookshelf', pickWall((['n', 's', 'e', 'w'] as Side[]).reverse()), 0.5); break;
    case 'utility': place('washer', pickWall(longSides), 0.15); break;
    case 'walkin': place('wardrobe', pickWall(longSides)); break;
    case 'foyer': place('plant-indoor', pickWall(['n', 'e', 'w', 's']), 0.9); break;
    default: break;
  }
}

export type { Wall, Window };
