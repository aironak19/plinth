import type { BuildingModel, Door, DesignOption, ElementRef, Id, Level, ProjectDoc, Wall, Window } from './types';
import { COLLECTION } from './types';
import { add, dist, norm, perp, scale, sub, type Vec2 } from '../geometry/vec';

export function activeOption(doc: ProjectDoc): DesignOption {
  return doc.options.find((o) => o.id === doc.activeOptionId) ?? doc.options[0];
}

export function activeBuilding(doc: ProjectDoc): BuildingModel {
  return activeOption(doc).building;
}

export function levelsSorted(b: BuildingModel): Level[] {
  return Object.values(b.levels).sort((x, y) => x.order - y.order || x.elevation - y.elevation);
}

export function levelBelow(b: BuildingModel, levelId: Id): Level | undefined {
  const ls = levelsSorted(b);
  const i = ls.findIndex((l) => l.id === levelId);
  return i > 0 ? ls[i - 1] : undefined;
}

export function levelAbove(b: BuildingModel, levelId: Id): Level | undefined {
  const ls = levelsSorted(b);
  const i = ls.findIndex((l) => l.id === levelId);
  return i >= 0 && i < ls.length - 1 ? ls[i + 1] : undefined;
}

export function wallsOn(b: BuildingModel, levelId: Id): Wall[] {
  return Object.values(b.walls).filter((w) => w.levelId === levelId);
}

export function byLevel<T extends { levelId: Id }>(rec: Record<Id, T>, levelId: Id): T[] {
  return Object.values(rec).filter((x) => x.levelId === levelId);
}

export const wallLength = (w: Wall) => dist(w.a, w.b);
export const wallDir = (w: Wall) => norm(sub(w.b, w.a));
export const wallNormal = (w: Wall) => perp(wallDir(w));

export function wallHeight(w: Wall, level: Level): number {
  return w.height ?? level.height;
}

export function openingsOf(b: BuildingModel, wallId: Id): (Door | Window)[] {
  const out: (Door | Window)[] = [];
  for (const d of Object.values(b.doors)) if (d.wallId === wallId) out.push(d);
  for (const w of Object.values(b.windows)) if (w.wallId === wallId) out.push(w);
  return out.sort((x, y) => x.offset - y.offset);
}

export function isDoor(o: Door | Window): o is Door {
  return (o as Door).swingAngle !== undefined;
}

export function openingCenter(w: Wall, offset: number): Vec2 {
  return add(w.a, scale(wallDir(w), offset));
}

export function sillOf(o: Door | Window): number {
  return isDoor(o) ? 0 : (o as Window).sill;
}

export function getElement(b: BuildingModel, ref: ElementRef): unknown {
  if (ref.kind === 'siteFeature') return undefined;
  const col = b[COLLECTION[ref.kind]] as Record<Id, unknown>;
  return col[ref.id];
}

export function elementLevelId(b: BuildingModel, ref: ElementRef): Id | undefined {
  const el = getElement(b, ref) as { levelId?: Id; wallId?: Id } | undefined;
  if (!el) return undefined;
  if (el.levelId) return el.levelId;
  if (el.wallId) return b.walls[el.wallId]?.levelId;
  if (ref.kind === 'level') return ref.id;
  return undefined;
}

export function emptyBuilding(): BuildingModel {
  return { levels: {}, walls: {}, doors: {}, windows: {}, rooms: {}, stairs: {}, roofs: {}, columns: {}, beams: {}, furniture: {} };
}

export function countElements(b: BuildingModel): number {
  return Object.keys(b.walls).length + Object.keys(b.doors).length + Object.keys(b.windows).length + Object.keys(b.rooms).length +
    Object.keys(b.stairs).length + Object.keys(b.roofs).length + Object.keys(b.columns).length + Object.keys(b.beams).length + Object.keys(b.furniture).length;
}
