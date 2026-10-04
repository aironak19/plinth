/**
 * Per-level derivation: rooms (from wall faces), outline, footprint, poché.
 *
 * Results are memoised on the identity of the level's inputs. Because the model
 * is immutable with structural sharing, editing one level never recomputes
 * another — this is the "no full-model recomputation" rule in practice.
 */
import type { BuildingModel, Door, Id, Level, RoomFunction, RoomTag, Wall, Window } from '../model/types';
import { buildPlanarGraph, findFaces, findOuterBoundaries } from '../geometry/planar';
import {
  type BBox, type Polygon, type PolygonWithHoles, area, bbox, centroid, difference, ensureCCW, isAxisRect,
  offsetPolygonEdges, perimeter, pointInPolygon, simplify, union,
} from '../geometry/polygon';
import { type Vec2, add, dist, norm, perp, scale, sub } from '../geometry/vec';
import { computeWallOutlines, type WallOutline } from './walls';

export interface DerivedRoom {
  id: Id;
  tagId: Id | null;
  levelId: Id;
  name: string;
  number: string;
  fn: RoomFunction;
  /** Net (finished) boundary. */
  polygon: Polygon;
  /** Wall centre-line loop. */
  centerLoop: Polygon;
  area: number;
  perimeter: number;
  bbox: BBox;
  width: number;
  depth: number;
  isRect: boolean;
  labelPoint: Vec2;
  wallIds: Id[];
  doorIds: Id[];
  windowIds: Id[];
  glazingArea: number;
  ceilingHeight: number;
  extraTagIds: Id[];
}

export interface DerivedLevel {
  level: Level;
  walls: Wall[];
  outlines: Map<Id, WallOutline>;
  rooms: DerivedRoom[];
  /** Tags not inside any enclosed space. */
  orphanTags: RoomTag[];
  /** Exterior outline(s), offset to the outside face of walls. */
  footprint: Polygon[];
  /** Centre-line outer loops. */
  outerLoops: { loop: Polygon; edgeIds: Id[] }[];
  grossArea: number;
  netArea: number;
  poche: PolygonWithHoles[];
  exteriorWallIds: Set<Id>;
}

const ROOM_TINT_FALLBACK = 'other';

const cache = new Map<string, { deps: unknown[]; value: DerivedLevel }>();

function sameDeps(a: unknown[], b: unknown[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function deriveLevel(b: BuildingModel, levelId: Id): DerivedLevel {
  const level = b.levels[levelId];
  const walls = Object.values(b.walls).filter((w) => w.levelId === levelId);
  const wallIds = new Set(walls.map((w) => w.id));
  const tags = Object.values(b.rooms).filter((r) => r.levelId === levelId);
  const doors = Object.values(b.doors).filter((d) => wallIds.has(d.wallId));
  const windows = Object.values(b.windows).filter((w) => wallIds.has(w.wallId));
  const deps: unknown[] = [level, ...walls, '|', ...tags, '|', ...doors, '|', ...windows];
  const key = levelId;
  const hit = cache.get(key);
  if (hit && sameDeps(hit.deps, deps)) return hit.value;
  const value = computeLevel(level, walls, tags, doors, windows);
  cache.set(key, { deps, value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}

function computeLevel(level: Level, walls: Wall[], tags: RoomTag[], doors: Door[], windows: Window[]): DerivedLevel {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const graph = buildPlanarGraph(walls.map((w) => ({ id: w.id, a: w.a, b: w.b })), 8);
  const faces = findFaces(graph, 2e5);
  const outer = findOuterBoundaries(graph);
  const outlines = computeWallOutlines(walls);

  const exteriorWallIds = new Set<Id>();
  for (const o of outer) for (const id of o.edgeIds) exteriorWallIds.add(id);

  const usedTags = new Set<Id>();
  const rooms: DerivedRoom[] = [];
  for (const f of faces) {
    const loop = f.loop;
    const dists = f.edgeIds.map((id) => (wallById.get(id)?.thickness ?? 0) / 2);
    const net = ensureCCW(simplify(offsetPolygonEdges(loop, dists), 1));
    if (net.length < 3 || area(net) < 1e5) continue;
    const inside = tags.filter((t) => pointInPolygon(t.point, loop));
    const tag = inside[0];
    inside.forEach((t) => usedTags.add(t.id));
    const bb = bbox(net);
    const rect = isAxisRect(net);
    const c = centroid(net);
    const labelPoint = pointInPolygon(c, net) ? c : tag?.point ?? c;
    const edgeSet = [...new Set(f.edgeIds)];
    rooms.push({
      id: tag?.id ?? `space-${levelId(level)}-${Math.round(c.x)}-${Math.round(c.y)}`,
      tagId: tag?.id ?? null,
      levelId: level.id,
      name: tag?.name ?? 'Unnamed space',
      number: tag?.number ?? '',
      fn: tag?.fn ?? (ROOM_TINT_FALLBACK as RoomFunction),
      polygon: net,
      centerLoop: loop,
      area: area(net),
      perimeter: perimeter(net),
      bbox: bb,
      width: bb.maxX - bb.minX,
      depth: bb.maxY - bb.minY,
      isRect: rect,
      labelPoint,
      wallIds: edgeSet,
      doorIds: [],
      windowIds: [],
      glazingArea: 0,
      ceilingHeight: tag?.ceilingHeight ?? level.height - level.slabThickness,
      extraTagIds: inside.slice(1).map((t) => t.id),
    });
  }

  // Openings → rooms on each side.
  const roomAt = (p: Vec2) => rooms.find((r) => pointInPolygon(p, r.polygon));
  const probe = (wall: Wall, offset: number, side: number) => {
    const d = norm(sub(wall.b, wall.a));
    return add(add(wall.a, scale(d, offset)), scale(perp(d), side * (wall.thickness / 2 + 120)));
  };
  for (const d of doors) {
    const w = wallById.get(d.wallId);
    if (!w) continue;
    for (const s of [1, -1]) roomAt(probe(w, d.offset, s))?.doorIds.push(d.id);
  }
  for (const win of windows) {
    const w = wallById.get(win.wallId);
    if (!w) continue;
    for (const s of [1, -1]) {
      const r = roomAt(probe(w, win.offset, s));
      if (r) { r.windowIds.push(win.id); r.glazingArea += win.width * win.height; }
    }
  }

  const footprint: Polygon[] = outer.map((o) => {
    const dists = o.edgeIds.map((id) => -(wallById.get(id)?.thickness ?? 0) / 2);
    return ensureCCW(simplify(offsetPolygonEdges(o.loop, dists), 1));
  });
  const grossArea = footprint.reduce((s, p) => s + area(p), 0);
  const netArea = rooms.reduce((s, r) => s + r.area, 0);

  // Poché: union of wall outlines minus openings at the plan cut height.
  const quads = [...outlines.values()].map((o) => o.quad as Polygon);
  const cuts: Polygon[] = [];
  const CUT = 1500;
  for (const o of [...doors, ...windows]) {
    const w = wallById.get(o.wallId);
    if (!w) continue;
    const sill = 'sill' in o ? o.sill : 0;
    if (sill >= CUT || sill + o.height <= CUT) continue;
    const d = norm(sub(w.b, w.a)), n = perp(d);
    const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
    const h = w.thickness / 2 + 5;
    const p = (s: number, t: number) => add(add(w.a, scale(d, s)), scale(n, t));
    cuts.push([p(s0, -h), p(s1, -h), p(s1, h), p(s0, h)]);
  }
  let poche: PolygonWithHoles[] = [];
  try {
    poche = cuts.length ? difference(union(quads), cuts) : union(quads);
  } catch {
    poche = quads.map((q) => ({ outer: q, holes: [] }));
  }

  return {
    level, walls, outlines, rooms,
    orphanTags: tags.filter((t) => !usedTags.has(t.id)),
    footprint, outerLoops: outer.map((o) => ({ loop: o.loop, edgeIds: o.edgeIds })),
    grossArea, netArea, poche, exteriorWallIds,
  };
}

function levelId(l: Level) { return l.id; }

/** Find the derived room under a point. */
export function roomAtPoint(dl: DerivedLevel, p: Vec2): DerivedRoom | undefined {
  return dl.rooms.find((r) => pointInPolygon(p, r.polygon));
}

export function roomDistance(a: DerivedRoom, b: DerivedRoom): number {
  return dist(a.labelPoint, b.labelPoint);
}
