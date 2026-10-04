import type {
  BuildingModel, Column, Door, FurnitureItem, Level, ProjectDoc, Roof, RoomFunction, RoomTag, Stair, Wall, Window,
  StyleId, ProjectMeta, Site, SiteEdge,
} from './types';
import { uid } from './ids';
import { STYLE_BY_ID, floorFor, wallFinishFor } from '../catalog/styles';
import { emptyBuilding, levelsSorted } from './query';
import type { Vec2 } from '../geometry/vec';
import { ME } from './org';

export const EXT_WALL = 230;
export const INT_WALL = 115;

export function makeLevel(p: Partial<Level> & { name: string; elevation: number }): Level {
  return { id: uid('lv'), height: 3200, slabThickness: 150, visible: true, locked: false, order: 0, ...p };
}

export function makeWall(p: Partial<Wall> & { levelId: string; a: Vec2; b: Vec2 }, style: StyleId = 'modern'): Wall {
  const st = STYLE_BY_ID[style];
  const exterior = (p.kind ?? 'interior') === 'exterior';
  return {
    id: uid('w'), thickness: exterior ? EXT_WALL : INT_WALL, height: null, baseOffset: 0, kind: 'interior',
    structural: exterior, materialId: 'brick', finishInteriorId: st.interiorWall, finishExteriorId: st.exterior,
    props: {}, ...p,
  };
}

export function makeDoor(p: Partial<Door> & { wallId: string; offset: number }, style: StyleId = 'modern'): Door {
  return {
    id: uid('d'), width: 900, height: 2100, kind: 'single', hinge: 'start', side: 'left', swingAngle: 90,
    materialId: STYLE_BY_ID[style].doorMaterial, tag: 'D', props: {}, ...p,
  };
}

export function makeWindow(p: Partial<Window> & { wallId: string; offset: number }, style: StyleId = 'modern'): Window {
  const st = STYLE_BY_ID[style];
  return {
    id: uid('n'), width: 1500, height: 1500, sill: 750, kind: st.windowKind, glazing: 'double',
    frameMaterialId: st.windowFrame, tag: 'W', props: {}, ...p,
  };
}

export function makeRoomTag(p: Partial<RoomTag> & { levelId: string; point: Vec2; name: string; fn: RoomFunction }, style: StyleId = 'modern'): RoomTag {
  const st = STYLE_BY_ID[style];
  return {
    id: uid('r'), number: '', floorFinishId: floorFor(st, p.fn), wallFinishId: wallFinishFor(st, p.fn),
    ceilingFinishId: 'plaster-white', ceilingHeight: null, props: {}, ...p,
  };
}

export function makeStair(p: Partial<Stair> & { levelId: string; origin: Vec2 }): Stair {
  return { id: uid('s'), kind: 'U', rotation: 0, width: 1050, targetRiser: 170, tread: 280, mirrored: false, materialId: 'granite', props: {}, ...p };
}

export function makeRoof(p: Partial<Roof> & { levelId: string }, style: StyleId = 'modern'): Roof {
  const st = STYLE_BY_ID[style];
  return {
    id: uid('rf'), kind: st.roof.kind, footprint: 'auto', pitch: st.roof.pitch || 25, overhang: st.roof.overhang,
    ridgeAxis: 'x', parapetHeight: st.roof.kind === 'flat' ? 1050 : 0, thickness: 150, materialId: st.roof.material, props: {}, ...p,
  };
}

export function makeColumn(p: Partial<Column> & { levelId: string; position: Vec2 }): Column {
  return { id: uid('c'), width: 300, depth: 300, shape: 'rect', rotation: 0, materialId: 'rcc', props: {}, ...p };
}

export function makeFurniture(p: Partial<FurnitureItem> & { levelId: string; assetId: string; position: Vec2 }): FurnitureItem {
  return { id: uid('f'), rotation: 0, props: {}, ...p };
}

/** Level-based tag numbering: D-101 on the ground floor, D-201 on the first, … */
export function nextTag(b: BuildingModel, prefix: 'D' | 'W', levelId: string): string {
  const levels = levelsSorted(b).filter((l) => l.elevation >= 0);
  const idx = Math.max(0, levels.findIndex((l) => l.id === levelId));
  const base = (idx + 1) * 100;
  const coll = prefix === 'D' ? b.doors : b.windows;
  const used = new Set(Object.values(coll).map((x) => x.tag));
  for (let n = base + 1; n < base + 99; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
  return `${prefix}-${base + 99}`;
}

export function defaultMeta(p: Partial<ProjectMeta> & { name: string }): ProjectMeta {
  return {
    type: 'villa', location: { city: 'Mumbai', country: 'India', lat: 19.076, lon: 72.8777 }, client: 'Private client', architect: 'Ronak Mehta',
    phase: 'Concept design', units: 'imperial', currency: 'INR', ruleSetId: 'in-generic', favorite: false, tags: [],
    createdAt: Date.now(), updatedAt: Date.now(), ownerId: ME,
    members: [{ userId: ME, role: 'owner' }, { userId: 'u-priya', role: 'designer' }, { userId: 'u-arjun', role: 'engineer' }, { userId: 'u-client', role: 'client' }],
    ...p,
  };
}

export function rectSite(width: number, depth: number, setbacks: { front: number; rear: number; side: number }, road = true): Site {
  const edges: SiteEdge[] = [
    { kind: 'front', setback: setbacks.front, road: road ? { name: 'Access road', width: 9000 } : undefined },
    { kind: 'side', setback: setbacks.side },
    { kind: 'rear', setback: setbacks.rear },
    { kind: 'side', setback: setbacks.side },
  ];
  return { boundary: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], edges, northAngle: 0, features: {} };
}

export function newProjectDoc(meta: ProjectMeta, site: Site, building: BuildingModel = emptyBuilding(), style: StyleId = 'modern'): ProjectDoc {
  const optId = uid('opt');
  return {
    schemaVersion: 1,
    id: uid('p'),
    meta,
    site,
    options: [{ id: optId, name: 'Option A', description: 'Primary scheme', style, building, createdAt: Date.now() }],
    activeOptionId: optId,
    scenes: [],
    comments: [],
    tasks: [],
    approvals: [],
    activity: [],
    stage: 'draft',
    cost: {
      currency: meta.currency, rateOverrides: {}, fxPerInr: fxFor(meta.currency), labourFactor: 1, contractorMargin: 0.12, contingency: 0.05, taxRate: 0.18, includeFFE: false,
      source: 'Indicative 2026 Indian metro rates (Plinth catalogue). Replace with your contractor’s BOQ rates for tendering.',
    },
    pendingChanges: [],
    ruleOverrides: {},
    underlays: [],
  };
}

export function fxFor(currency: ProjectMeta['currency']): number {
  return { INR: 1, USD: 1 / 84, EUR: 1 / 91, GBP: 1 / 107, AED: 1 / 22.9, SGD: 1 / 63 }[currency];
}
