/**
 * Design analysis: daylight, orientation, circulation and reachability.
 * Everything here is a planning-level indicator with stated assumptions — not a
 * certified daylight or energy simulation.
 */
import type { BuildingModel, Id, ProjectDoc, RoomFunction } from '../model/types';
import { levelsSorted, openingCenter, wallDir } from '../model/query';
import { deriveLevel, type DerivedRoom } from './level';
import { type Vec2, add, dist, norm, perp, scale, sub } from '../geometry/vec';
import { pointInPolygon } from '../geometry/polygon';

export const HABITABLE: RoomFunction[] = ['living', 'dining', 'kitchen', 'master_bedroom', 'bedroom', 'study', 'family', 'media', 'gym'];

export type Orientation = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export function bearingToOrientation(bearing: number): Orientation {
  const dirs: Orientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

export interface RoomDaylight {
  roomId: Id;
  name: string;
  levelId: Id;
  fn: RoomFunction;
  area: number;
  glazingArea: number;
  ratio: number;
  orientations: Orientation[];
  westGlazing: number;
  score: number;
}

/** Glazing-to-floor ratio and window orientation per room. */
export function daylightAnalysis(doc: ProjectDoc, b: BuildingModel): RoomDaylight[] {
  const out: RoomDaylight[] = [];
  for (const level of levelsSorted(b)) {
    const dl = deriveLevel(b, level.id);
    for (const r of dl.rooms) {
      const orientations: Orientation[] = [];
      let west = 0;
      for (const wid of r.windowIds) {
        const win = b.windows[wid];
        const wall = b.walls[win?.wallId];
        if (!win || !wall) continue;
        // Outward normal: the side of the wall away from this room.
        const c = openingCenter(wall, win.offset);
        const n = perp(wallDir(wall));
        const probe = add(c, scale(n, wall.thickness / 2 + 150));
        const outward = pointInPolygon(probe, r.polygon) ? scale(n, -1) : n;
        const bearing = (Math.atan2(outward.x, outward.y) * 180) / Math.PI - doc.site.northAngle;
        const o = bearingToOrientation(bearing);
        if (!orientations.includes(o)) orientations.push(o);
        if (o === 'W' || o === 'SW' || o === 'NW') west += win.width * win.height;
      }
      const ratio = r.area ? r.glazingArea / r.area : 0;
      const score = Math.max(0, Math.min(100, Math.round((ratio / 0.15) * 100)));
      out.push({ roomId: r.id, name: r.name, levelId: level.id, fn: r.fn, area: r.area, glazingArea: r.glazingArea, ratio, orientations, westGlazing: west, score });
    }
  }
  return out;
}

export interface CirculationGraph {
  /** Walking distance (mm) between rooms through doors. */
  distance(a: Id, b: Id): number;
  reachable: Set<Id>;
  entranceRooms: Id[];
  rooms: DerivedRoom[];
}

/**
 * Builds a door graph across all levels (stairs connect consecutive levels) and
 * runs Dijkstra from the entrance. Distances are door-to-door walking paths.
 */
export function circulation(b: BuildingModel): CirculationGraph {
  const levels = levelsSorted(b);
  const rooms: DerivedRoom[] = [];
  const nodes = new Map<Id, Vec2>();
  const adj = new Map<Id, { to: Id; w: number }[]>();
  const link = (a: Id, b2: Id, w: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b2, w });
    (adj.get(b2) ?? adj.set(b2, []).get(b2)!).push({ to: a, w });
  };
  const entrance: Id[] = [];
  const stairRoomsByLevel = new Map<Id, Id[]>();
  for (const level of levels) {
    const dl = deriveLevel(b, level.id);
    rooms.push(...dl.rooms);
    for (const r of dl.rooms) nodes.set(r.id, r.labelPoint);
    for (const d of Object.values(b.doors)) {
      const wall = b.walls[d.wallId];
      if (!wall || wall.levelId !== level.id) continue;
      const c = openingCenter(wall, d.offset);
      const sides = dl.rooms.filter((r) => r.doorIds.includes(d.id));
      if (sides.length === 2) link(sides[0].id, sides[1].id, dist(sides[0].labelPoint, c) + dist(c, sides[1].labelPoint));
      else if (sides.length === 1 && dl.exteriorWallIds.has(wall.id) && level === levels.find((l) => l.elevation >= 0)) entrance.push(sides[0].id);
    }
    const stairs = Object.values(b.stairs).filter((s) => s.levelId === level.id);
    const sr: Id[] = [];
    for (const s of stairs) {
      const r = dl.rooms.find((x) => pointInPolygon(add(s.origin, { x: s.width / 2, y: 300 }), x.polygon));
      if (r) sr.push(r.id);
    }
    // Stairs arrive in the room above the stair footprint.
    stairRoomsByLevel.set(level.id, sr);
  }
  for (let i = 0; i + 1 < levels.length; i++) {
    const lower = levels[i], upper = levels[i + 1];
    const dlU = deriveLevel(b, upper.id);
    for (const s of Object.values(b.stairs).filter((x) => x.levelId === lower.id)) {
      const from = deriveLevel(b, lower.id).rooms.find((x) => pointInPolygon(add(s.origin, { x: s.width / 2, y: 300 }), x.polygon));
      const to = dlU.rooms.find((x) => pointInPolygon(add(s.origin, { x: s.width / 2, y: 300 }), x.polygon)) ??
        dlU.rooms.reduce<DerivedRoom | undefined>((best, r) => (!best || dist(r.labelPoint, s.origin) < dist(best.labelPoint, s.origin) ? r : best), undefined);
      if (from && to) link(from.id, to.id, 6000);
    }
  }
  const dijkstra = (src: Id) => {
    const d = new Map<Id, number>([[src, 0]]);
    const q: Id[] = [src];
    while (q.length) {
      q.sort((x, y) => (d.get(x) ?? Infinity) - (d.get(y) ?? Infinity));
      const u = q.shift()!;
      for (const e of adj.get(u) ?? []) {
        const nd = (d.get(u) ?? Infinity) + e.w;
        if (nd < (d.get(e.to) ?? Infinity)) { d.set(e.to, nd); q.push(e.to); }
      }
    }
    return d;
  };
  const reachable = new Set<Id>();
  for (const e of entrance) for (const k of dijkstra(e).keys()) reachable.add(k);
  const memo = new Map<Id, Map<Id, number>>();
  return {
    distance(a, b2) {
      if (!memo.has(a)) memo.set(a, dijkstra(a));
      return memo.get(a)!.get(b2) ?? Infinity;
    },
    reachable, entranceRooms: entrance, rooms,
  };
}

export function roomsByFn(rooms: DerivedRoom[], ...fns: RoomFunction[]) {
  return rooms.filter((r) => fns.includes(r.fn));
}

export function directDistance(a: DerivedRoom, b: DerivedRoom) {
  return dist(a.labelPoint, b.labelPoint);
}

export { norm, sub };
