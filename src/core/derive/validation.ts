/**
 * Continuous design validation → Design Health.
 *
 * Every issue points at concrete elements (so the UI can navigate to them) and,
 * where a safe structured fix exists, carries it as OpCalls to *preview* — fixes
 * are never applied silently.
 */
import type { BuildingModel, ElementRef, FurnitureItem, Id, ProjectDoc, SiteFeature, Wall } from '../model/types';
import type { OpCall } from '../ops/registry';
import type { RuleSet } from '../rules/rulesets';
import { levelAbove, levelBelow, levelsSorted, openingsOf, isDoor, wallLength } from '../model/query';
import { deriveLevel } from './level';
import { analyzeSite } from './site';
import { computeStair } from './stairs';
import { circulation, daylightAnalysis, HABITABLE } from './analysis';
import { MATERIAL_BY_ID } from '../catalog/materials';
import { ASSET_BY_ID, isOutdoorAsset } from '../catalog/assets';
import { formatArea, formatLength, type UnitSystem } from '../units';
import { freeEnds } from './walls';
import { type Vec2, add, dist, lineParam, mid, norm, projectToSegment, scale, sub } from '../geometry/vec';
import { type Polygon, areaWithHoles, centroid, difference, distToPolygonEdge, pointInPolygon, union } from '../geometry/polygon';
import type { Plant } from '../catalog/plants';
import {
  type LandscapeAnalysis, climateOf, groundFootprint, groundItems, hedgeSpecies, isAreaFeature, isClosedPath, isLinear, isPlayItem, suitsClimate,
} from './landscape';
import { linearSpec } from './solids';

export type Severity = 'error' | 'warning' | 'info';
export type IssueCategory = 'Geometry' | 'Rooms' | 'Openings' | 'Stairs' | 'Site & zoning' | 'Daylight' | 'Accessibility' | 'Circulation' | 'Structure' | 'Documentation' | 'Materials' | 'Landscape';

export const CATEGORIES: IssueCategory[] = ['Geometry', 'Rooms', 'Openings', 'Stairs', 'Site & zoning', 'Daylight', 'Accessibility', 'Circulation', 'Structure', 'Landscape', 'Documentation', 'Materials'];

export interface Issue {
  id: string;
  severity: Severity;
  category: IssueCategory;
  title: string;
  detail: string;
  refs: ElementRef[];
  levelId?: Id;
  point?: Vec2;
  fix?: { label: string; ops: OpCall[] };
}

export interface HealthReport {
  score: number;
  issues: Issue[];
  errors: number;
  warnings: number;
  infos: number;
  categories: { category: IssueCategory; status: 'ok' | Severity; count: number }[];
}

export function validate(doc: ProjectDoc, b: BuildingModel, rules: RuleSet): HealthReport {
  const issues: Issue[] = [];
  const units: UnitSystem = doc.meta.units;
  const L = (mm: number) => formatLength(mm, units);
  const A = (mm2: number) => formatArea(mm2, units);
  const push = (i: Omit<Issue, 'id'>) => issues.push({ ...i, id: `${i.category}:${i.title}:${i.refs.map((r) => r.id).join(',')}` });
  const levels = levelsSorted(b);

  for (const level of levels) {
    const dl = deriveLevel(b, level.id);
    const walls = dl.walls;

    // ---- Geometry
    for (const w of walls) if (wallLength(w) < 100) push({ severity: 'error', category: 'Geometry', title: 'Zero-length wall', detail: `A wall on ${level.name} is shorter than 100 mm.`, refs: [{ kind: 'wall', id: w.id }], levelId: level.id, point: w.a, fix: { label: 'Delete wall', ops: [{ type: 'element.delete', params: { refs: [{ kind: 'wall', id: w.id }] } }] } });
    for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
      const overlap = collinearOverlap(walls[i], walls[j]);
      if (overlap > 200) push({ severity: 'warning', category: 'Geometry', title: 'Overlapping walls', detail: `Two walls on ${level.name} overlap for ${L(overlap)}.`, refs: [{ kind: 'wall', id: walls[j].id }], levelId: level.id, point: walls[j].a, fix: wallLength(walls[j]) <= wallLength(walls[i]) + 1 ? { label: 'Remove duplicate', ops: [{ type: 'element.delete', params: { refs: [{ kind: 'wall', id: walls[j].id }] } }] } : undefined });
    }
    for (const fe of freeEnds(walls)) {
      const w = b.walls[fe.wallId];
      if (w.kind === 'parapet' || w.kind === 'retaining' || w.kind === 'partition') continue;
      push({ severity: w.kind === 'exterior' ? 'warning' : 'info', category: 'Geometry', title: 'Disconnected wall end', detail: `A ${w.kind} wall on ${level.name} doesn’t connect to another wall.`, refs: [{ kind: 'wall', id: w.id }], levelId: level.id, point: fe.p });
    }

    // ---- Openings
    for (const w of walls) {
      const ops = openingsOf(b, w.id);
      const len = wallLength(w);
      const above = levelAbove(b, level.id);
      const wallH = w.height ?? level.height - (above?.slabThickness ?? 0);
      for (let i = 0; i < ops.length; i++) {
        const o = ops[i];
        const ref: ElementRef = { kind: isDoor(o) ? 'door' : 'window', id: o.id };
        if (o.offset - o.width / 2 < -1 || o.offset + o.width / 2 > len + 1) push({ severity: 'error', category: 'Openings', title: `${o.tag} extends beyond its wall`, detail: `${isDoor(o) ? 'Door' : 'Window'} ${o.tag} is ${L(o.width)} wide but its wall is ${L(len)}.`, refs: [ref], levelId: level.id, point: w.a });
        const top = (isDoor(o) ? 0 : o.sill) + o.height;
        if (top > wallH) push({ severity: 'error', category: 'Openings', title: `${o.tag} is taller than its wall`, detail: `Head height ${L(top)} exceeds the wall height ${L(wallH)}.`, refs: [ref], levelId: level.id, point: w.a });
        const n = ops[i + 1];
        if (n && o.offset + o.width / 2 > n.offset - n.width / 2 + 1) {
          const shift = o.offset + o.width / 2 - (n.offset - n.width / 2) + 150;
          push({ severity: 'error', category: 'Openings', title: `${o.tag} overlaps ${n.tag}`, detail: `Two openings in the same wall overlap by ${L(shift - 150)}.`, refs: [ref, { kind: isDoor(n) ? 'door' : 'window', id: n.id }], levelId: level.id, point: w.a,
            fix: { label: `Slide ${n.tag} along the wall`, ops: [{ type: isDoor(n) ? 'door.update' : 'window.update', params: { id: n.id, patch: { offset: n.offset + shift } } }] } });
        }
        if (isDoor(o) && o.kind !== 'opening' && o.width < rules.values.minDoorWidth - 1) push({ severity: 'warning', category: 'Accessibility', title: `${o.tag} is narrow`, detail: `${L(o.width)} clear width is below the ${L(rules.values.minDoorWidth)} minimum.`, refs: [ref], levelId: level.id, point: w.a, fix: { label: `Widen to ${L(rules.values.minDoorWidth)}`, ops: [{ type: 'door.update', params: { id: o.id, patch: { width: rules.values.minDoorWidth } } }] } });
      }
    }

    // ---- Rooms
    for (const r of dl.rooms) {
      if (!r.tagId) push({ severity: 'info', category: 'Rooms', title: 'Unnamed space', detail: `An enclosed ${A(r.area)} space on ${level.name} has no room tag.`, refs: [], levelId: level.id, point: r.labelPoint,
        fix: { label: 'Name it “Room”', ops: [{ type: 'room.tag', params: { levelId: level.id, point: r.labelPoint, name: 'Room', fn: 'other' } }] } });
      if (r.extraTagIds.length) push({ severity: 'warning', category: 'Rooms', title: `Multiple rooms in one space`, detail: `${[r.name, ...r.extraTagIds.map((id) => b.rooms[id]?.name)].join(' and ')} share one enclosed space — a separating wall may be missing.`, refs: [{ kind: 'room', id: r.tagId! }, ...r.extraTagIds.map((id) => ({ kind: 'room' as const, id }))], levelId: level.id, point: r.labelPoint });
      const std = rules.rooms[r.fn];
      if (std && r.tagId) {
        if (r.area < std.minArea - 1) push({ severity: 'warning', category: 'Rooms', title: `${r.name} is below minimum area`, detail: `${A(r.area)} — the rule set requires at least ${A(std.minArea)}.`, refs: [{ kind: 'room', id: r.tagId }], levelId: level.id, point: r.labelPoint,
          fix: r.isRect ? { label: `Enlarge to ${A(std.minArea)}`, ops: [{ type: 'room.resize', params: { id: r.tagId, axis: r.width < r.depth ? 'x' : 'y', size: Math.ceil(std.minArea / (r.width < r.depth ? r.depth : r.width) / 25) * 25 } }] } : undefined });
        const minDim = Math.min(r.width, r.depth);
        if (r.isRect && minDim < std.minWidth - 1) push({ severity: 'warning', category: 'Rooms', title: `${r.name} is narrow`, detail: `${L(minDim)} wide — at least ${L(std.minWidth)} is required.`, refs: [{ kind: 'room', id: r.tagId }], levelId: level.id, point: r.labelPoint,
          fix: { label: `Widen to ${L(std.minWidth)}`, ops: [{ type: 'room.resize', params: { id: r.tagId, axis: r.width < r.depth ? 'x' : 'y', size: std.minWidth } }] } });
      }
      if (r.ceilingHeight < rules.values.minCeilingHeight - 1 && HABITABLE.includes(r.fn)) push({ severity: 'warning', category: 'Rooms', title: `${r.name} ceiling is low`, detail: `${L(r.ceilingHeight)} clear — minimum ${L(rules.values.minCeilingHeight)} for habitable rooms.`, refs: r.tagId ? [{ kind: 'room', id: r.tagId }] : [], levelId: level.id, point: r.labelPoint });
    }
    for (const t of dl.orphanTags) push({ severity: 'warning', category: 'Rooms', title: `${t.name} isn’t enclosed`, detail: 'The room tag isn’t inside a closed loop of walls, so its area can’t be calculated.', refs: [{ kind: 'room', id: t.id }], levelId: level.id, point: t.point });

    // ---- Stairs
    for (const s of Object.values(b.stairs).filter((x) => x.levelId === level.id)) {
      const up = levelAbove(b, level.id);
      if (!up) push({ severity: 'warning', category: 'Stairs', title: 'Stair leads nowhere', detail: `The stair on ${level.name} has no level above it.`, refs: [{ kind: 'stair', id: s.id }], levelId: level.id, point: s.origin });
      const info = computeStair(s, level, rules, up ? up.elevation - level.elevation : level.height);
      for (const w of info.warnings) push({ severity: w.code === 'comfort' ? 'info' : 'warning', category: 'Stairs', title: `Stair ${w.code === 'comfort' ? 'comfort' : w.code}`, detail: w.message, refs: [{ kind: 'stair', id: s.id }], levelId: level.id, point: s.origin,
        fix: w.code === 'riser' ? { label: `Use ${info.risers + 1} risers`, ops: [{ type: 'stair.update', params: { id: s.id, patch: { targetRiser: Math.floor(info.totalRise / (info.risers + 1)) } } }] }
          : w.code === 'tread' ? { label: `Set tread to ${L(rules.values.stairMinTread)}`, ops: [{ type: 'stair.update', params: { id: s.id, patch: { tread: rules.values.stairMinTread } } }] }
          : w.code === 'width' ? { label: `Widen to ${L(rules.values.stairMinWidth)}`, ops: [{ type: 'stair.update', params: { id: s.id, patch: { width: rules.values.stairMinWidth } } }] } : undefined });
    }

    // ---- Structure (conceptual coordination)
    const below = levelBelow(b, level.id);
    if (below && dl.footprint.length) {
      const dlb = deriveLevel(b, below.id);
      if (dlb.footprint.length) {
        const over = difference(dl.footprint, [...union(dlb.footprint).map((p) => p.outer)]);
        const overArea = areaWithHoles(over);
        if (overArea > 1.5e6) push({ severity: 'warning', category: 'Structure', title: `${level.name} overhangs ${below.name}`, detail: `${A(overArea)} of ${level.name} is unsupported by walls below — a cantilever or transfer beam needs structural review (conceptual check, not an engineering analysis).`, refs: [], levelId: level.id, point: over[0]?.outer[0] });
      }
    }
    for (const roof of Object.values(b.roofs).filter((r) => r.levelId === level.id)) {
      if (roof.footprint === 'auto' && !dl.footprint.length) push({ severity: 'error', category: 'Structure', title: 'Roof has nothing to sit on', detail: `The roof on ${level.name} follows the level outline, but the level has no closed exterior walls.`, refs: [{ kind: 'roof', id: roof.id }], levelId: level.id });
    }

    // ---- Furniture placement
    for (const f of Object.values(b.furniture).filter((x) => x.levelId === level.id)) {
      const asset = ASSET_BY_ID[f.assetId];
      if (!asset) { push({ severity: 'warning', category: 'Materials', title: 'Missing library item', detail: 'A placed item refers to an asset that is not in the library.', refs: [{ kind: 'furniture', id: f.id }], levelId: level.id, point: f.position }); continue; }
      if (isOutdoorAsset(asset)) continue;
      if (!dl.rooms.some((r) => pointInPolygon(f.position, r.polygon))) push({ severity: 'info', category: 'Geometry', title: `${asset.name} is outside every room`, detail: 'The item sits on or outside a wall.', refs: [{ kind: 'furniture', id: f.id }], levelId: level.id, point: f.position });
    }
  }

  // ---- Daylight
  for (const d of daylightAnalysis(doc, b)) {
    const std = rules.rooms[d.fn];
    if (!std?.minGlazingRatio || !HABITABLE.includes(d.fn)) continue;
    if (d.ratio + 1e-6 < std.minGlazingRatio) {
      const dl = deriveLevel(b, d.levelId);
      const room = dl.rooms.find((r) => r.id === d.roomId);
      const ext = room?.wallIds.map((id) => b.walls[id]).filter((w) => w && dl.exteriorWallIds.has(w.id)).sort((x, y) => wallLength(y) - wallLength(x))[0];
      const needed = Math.ceil(((std.minGlazingRatio * d.area - d.glazingArea) / 1350) / 50) * 50;
      push({ severity: 'warning', category: 'Daylight', title: `${d.name} is under-lit`, detail: `Glazing is ${(d.ratio * 100).toFixed(1)}% of floor area; the rule set asks for ${(std.minGlazingRatio * 100).toFixed(0)}%.`, refs: room?.tagId ? [{ kind: 'room', id: room.tagId }] : [], levelId: d.levelId, point: room?.labelPoint,
        fix: ext && needed > 0 ? { label: `Add a ${L(Math.min(needed, wallLength(ext) - 600))} window`, ops: [{ type: 'window.create', params: { wallId: ext.id, width: Math.max(600, Math.min(needed, wallLength(ext) - 600)), height: 1350 } }] } : undefined });
    }
  }

  // ---- Circulation
  const circ = circulation(b);
  const groundRooms = circ.rooms;
  if (groundRooms.length && !circ.entranceRooms.length) push({ severity: 'error', category: 'Circulation', title: 'No entrance', detail: 'No exterior door was found on the entrance level.', refs: [] });
  else for (const r of groundRooms) {
    if (!circ.reachable.has(r.id) && r.tagId && r.fn !== 'balcony' && r.fn !== 'parking') push({ severity: 'error', category: 'Circulation', title: `No access to ${r.name}`, detail: `${r.name} can’t be reached from the entrance — add a door.`, refs: [{ kind: 'room', id: r.tagId }], levelId: r.levelId, point: r.labelPoint });
  }
  const kitchens = groundRooms.filter((r) => r.fn === 'kitchen');
  const dinings = groundRooms.filter((r) => r.fn === 'dining');
  for (const k of kitchens) {
    const best = dinings.map((d) => ({ d, dist: circ.distance(k.id, d.id) })).sort((x, y) => x.dist - y.dist)[0];
    if (best && Number.isFinite(best.dist) && best.dist > rules.values.maxKitchenDiningDistance) push({ severity: 'warning', category: 'Circulation', title: 'Kitchen is far from dining', detail: `Walking distance kitchen → ${best.d.name} is ${L(best.dist)} (target ≤ ${L(rules.values.maxKitchenDiningDistance)}).`, refs: k.tagId ? [{ kind: 'room', id: k.tagId }] : [], levelId: k.levelId, point: k.labelPoint });
  }
  const totalArea = groundRooms.reduce((s, r) => s + r.area, 0);
  const corridor = groundRooms.filter((r) => r.fn === 'corridor').reduce((s, r) => s + r.area, 0);
  if (totalArea && corridor / totalArea > 0.15) push({ severity: 'warning', category: 'Circulation', title: 'Excessive corridor area', detail: `Corridors take ${((corridor / totalArea) * 100).toFixed(0)}% of floor area (target under 15%).`, refs: [] });

  // ---- Site & zoning
  const site = analyzeSite(doc, b, rules);
  const v = rules.values;
  for (const s of site.setbacks) {
    if (s.ok) continue;
    const move = s.required - s.actual + 25;
    push({ severity: 'error', category: 'Site & zoning', title: `${s.kind[0].toUpperCase() + s.kind.slice(1)} setback violation`, detail: `Required ${L(s.required)} · current ${L(s.actual)}.`, refs: [], point: s.from,
      fix: { label: `Move building ${L(move)} inward`, ops: [{ type: 'building.translate', params: { delta: { x: Math.round(s.inward.x * move), y: Math.round(s.inward.y * move) } } }] } });
  }
  if (site.coverage > v.maxCoverage + 1e-3) push({ severity: 'error', category: 'Site & zoning', title: 'Ground coverage exceeded', detail: `${(site.coverage * 100).toFixed(1)}% of the plot is covered; maximum ${(v.maxCoverage * 100).toFixed(0)}%.`, refs: [] });
  if (site.far > v.maxFar + 1e-3) push({ severity: 'error', category: 'Site & zoning', title: 'FAR / FSI exceeded', detail: `FAR is ${site.far.toFixed(2)}; the maximum is ${v.maxFar.toFixed(2)}.`, refs: [] });
  if (site.buildingHeight > v.maxHeight + 1) push({ severity: 'error', category: 'Site & zoning', title: 'Building too tall', detail: `${L(site.buildingHeight)} to the top of the roof; maximum ${L(v.maxHeight)}.`, refs: [] });
  if (site.floors > v.maxFloors) push({ severity: 'error', category: 'Site & zoning', title: 'Too many floors', detail: `${site.floors} floors; maximum ${v.maxFloors}.`, refs: [] });
  const cars = Object.values(b.furniture).filter((f) => f.assetId.startsWith('car-')).length;
  const parking = Math.max(site.parkingProvided, cars);
  if (parking < v.parkingPerUnit) push({ severity: 'warning', category: 'Site & zoning', title: 'Parking shortfall', detail: `${parking} of ${v.parkingPerUnit} required car spaces provided.`, refs: [] });

  // ---- Landscape
  landscapeRules(doc, b, site.landscape, push, L);

  // ---- Documentation & materials
  const tagCount = new Map<string, ElementRef[]>();
  for (const d of Object.values(b.doors)) (tagCount.get(d.tag) ?? tagCount.set(d.tag, []).get(d.tag)!).push({ kind: 'door', id: d.id });
  for (const w of Object.values(b.windows)) (tagCount.get(w.tag) ?? tagCount.set(w.tag, []).get(w.tag)!).push({ kind: 'window', id: w.id });
  for (const [tag, refs] of tagCount) if (refs.length > 1) push({ severity: 'warning', category: 'Documentation', title: `Duplicate tag ${tag}`, detail: `${refs.length} openings share the tag ${tag}; schedules will be ambiguous.`, refs });
  const matIds = new Set<string>();
  for (const w of Object.values(b.walls)) matIds.add(w.materialId).add(w.finishExteriorId).add(w.finishInteriorId);
  for (const r of Object.values(b.rooms)) matIds.add(r.floorFinishId).add(r.wallFinishId).add(r.ceilingFinishId);
  for (const id of matIds) if (id && !MATERIAL_BY_ID[id]) push({ severity: 'warning', category: 'Materials', title: `Unknown material “${id}”`, detail: 'This material isn’t in the library, so it can’t be rendered or costed.', refs: [] });

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;
  const score = Math.max(0, Math.round(100 - errors * 7 - warnings * 2.5 - infos * 0.5));
  const categories = CATEGORIES.map((category) => {
    const list = issues.filter((i) => i.category === category);
    const status: 'ok' | Severity = list.some((i) => i.severity === 'error') ? 'error' : list.some((i) => i.severity === 'warning') ? 'warning' : list.length ? 'info' : 'ok';
    return { category, status, count: list.length };
  });
  return { score, issues, errors, warnings, infos, categories };
}

// ---------------------------------------------------------------- landscape

/** Clearances the garden rules check, mm. Horticultural rules of thumb, not regulations. */
export const LANDSCAPE_RULES = { treeToBuilding: 3000, bigTree: 8000, tallPalm: 9000, palmToParking: 2000, toxicToPlay: 4000 };

/** Plants that are a real risk where small children play, and why. */
const TOXIC_PLANTS: Record<string, string> = {
  oleander: 'Every part of oleander is poisonous if chewed or swallowed.',
  cycas: 'Sago palm seeds and leaves are poisonous if eaten — to children and to pets.',
};

const distToArea = (p: Vec2, poly: Polygon) => (pointInPolygon(p, poly) ? 0 : distToPolygonEdge(p, poly));

function distToPath(p: Vec2, path: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) best = Math.min(best, projectToSegment(p, path[i], path[i + 1]).dist);
  return best;
}

const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function landscapeRules(doc: ProjectDoc, b: BuildingModel, la: LandscapeAnalysis, push: (i: Omit<Issue, 'id'>) => void, L: (mm: number) => string) {
  const features = Object.values(doc.site.features);
  const items = groundItems(b);
  const plants = items.flatMap((x) => (x.asset.plant ? [{ item: x.item, plant: x.asset.plant }] : []));
  if (!plants.length && !features.length && !la.plants.length) return;
  const cat = 'Landscape' as const;
  const R = LANDSCAPE_RULES;
  const iref = (it: FurnitureItem): ElementRef => ({ kind: 'furniture', id: it.id });
  const fref = (f: SiteFeature): ElementRef => ({ kind: 'siteFeature', id: f.id });
  const areas = features.filter(isAreaFeature);
  const lines = features.filter(isLinear);
  const play = items.filter((x) => isPlayItem(x.asset));
  const plot = doc.site.boundary.length >= 3 ? doc.site.boundary : null;
  const footprint = groundFootprint(b);

  for (const { item, plant } of plants) {
    const at = item.position;

    // Large trees hard against the house.
    if (plant.type === 'tree' && plant.height >= R.bigTree && plant.form !== 'columnar' && footprint.length) {
      const d = Math.min(...footprint.map((fp) => distToArea(at, fp)));
      if (d < R.treeToBuilding) push({
        severity: 'warning', category: cat, title: `${plant.common} is too close to the house`,
        detail: `It grows to about ${L(plant.height)} tall and ${L(plant.spread)} across, and is planted ${d < 1 ? 'inside the building outline' : `${L(d)} from the wall`}. Keep large trees at least ${L(R.treeToBuilding)} away so roots, branches and falling leaves don’t damage foundations, walls and gutters.`,
        refs: [iref(item)], levelId: item.levelId, point: at,
      });
    }

    // Tall palms over cars and swimmers.
    if (plant.type === 'palm' && plant.height >= R.tallPalm) {
      const coconut = plant.id === 'coconut';
      const drops = coconut ? 'heavy nuts and fronds' : 'large, heavy fronds';
      const parking = areas.find((f) => f.kind === 'parking' && distToArea(at, f.polygon!) < R.palmToParking);
      if (parking) push({
        severity: coconut ? 'warning' : 'info', category: cat, title: `${plant.common} stands over the parking`,
        detail: `${plant.common}s drop ${drops} from up to ${L(plant.height)}. This one is ${L(distToArea(at, parking.polygon!))} from ${parking.name} — move it at least ${L(R.palmToParking)} clear, or plan for regular trimming, so nothing lands on a car or a person.`,
        refs: [iref(item), fref(parking)], levelId: item.levelId, point: at,
      });
      const pool = areas.find((f) => f.kind === 'pool' && distToArea(at, f.polygon!) < plant.spread / 2);
      if (pool) push({
        severity: coconut ? 'warning' : 'info', category: cat, title: `${plant.common} hangs over the pool`,
        detail: `Its crown spreads about ${L(plant.spread)} and reaches over ${pool.name}, so ${drops} will fall into the water and onto swimmers. Move it back by at least ${L(plant.spread / 2)}, or choose a smaller palm here.`,
        refs: [iref(item), fref(pool)], levelId: item.levelId, point: at,
      });
    }

    // Poisonous plants beside play equipment.
    const toxic = TOXIC_PLANTS[plant.id];
    if (toxic && play.length) {
      const near = play.map((x) => ({ x, d: dist(at, x.item.position) })).sort((p, q) => p.d - q.d)[0];
      if (near.d < R.toxicToPlay) push({
        severity: 'warning', category: cat, title: `${plant.common} is poisonous and close to the play area`,
        detail: `${toxic} This one is ${L(near.d)} from the ${near.x.asset.name.toLowerCase()}. Plant it at least ${L(R.toxicToPlay)} from where children play, or choose a harmless shrub.`,
        refs: [iref(item), iref(near.x.item)], levelId: item.levelId, point: at,
      });
    }

    // Planted on someone else's land.
    if (plot && !pointInPolygon(at, plot) && distToPolygonEdge(at, plot) > 100) push({
      severity: 'warning', category: cat, title: `${plant.common} is outside the plot`,
      detail: `It is planted ${L(distToPolygonEdge(at, plot))} beyond the plot boundary. Move it inside the boundary — this project can only plant on its own land.`,
      refs: [iref(item)], levelId: item.levelId, point: at,
    });
  }

  for (const f of lines) {
    const path = f.path!;
    const what = f.kind === 'wall' ? 'garden wall' : f.kind;
    // A boundary wall sits *on* the plot line, so allow half its thickness plus a little drawing tolerance.
    const tol = linearSpec(f).width / 2 + 150;
    if (plot) {
      const probes = [...path, ...path.slice(1).map((p, i) => mid(path[i], p))];
      const out = probes.map((p) => (pointInPolygon(p, plot) ? 0 : distToPolygonEdge(p, plot))).filter((d) => d > tol);
      if (out.length) push({
        severity: 'warning', category: cat, title: `${f.name} runs outside the plot`,
        detail: `Part of this ${what} is up to ${L(Math.max(...out))} beyond the plot boundary. Pull it back to the boundary line — this project can only build and plant on its own land.`,
        refs: [fref(f)], point: probes.find((p) => !pointInPolygon(p, plot) && distToPolygonEdge(p, plot) > tol),
      });
    }
    if (f.kind === 'hedge' && play.length) {
      const sp = hedgeSpecies(f);
      const near = play.map((x) => ({ x, d: distToPath(x.item.position, path) })).sort((p, q) => p.d - q.d)[0];
      if (TOXIC_PLANTS[sp.id] && near.d < R.toxicToPlay) push({
        severity: 'warning', category: cat, title: `${f.name} is poisonous and close to the play area`,
        detail: `This hedge is ${sp.common.toLowerCase()}. ${TOXIC_PLANTS[sp.id]} It runs ${L(near.d)} from the ${near.x.asset.name.toLowerCase()} — use a harmless hedging plant here.`,
        refs: [fref(f), iref(near.x.item)], point: near.x.item.position,
      });
    }
  }

  // Species that don't suit the climate — one note per species, not per plant.
  const { lat, city } = doc.meta.location;
  if (Number.isFinite(lat)) {
    const climate = climateOf(lat);
    const where = `${city || 'This site'} is treated as a ${climate} climate (judged from its latitude alone)`;
    const note = (p: Plant, count: string, refs: ElementRef[], point?: Vec2, levelId?: Id) => push({
      severity: 'info', category: cat, title: `${p.common} may not suit this climate`,
      detail: `${where}. ${p.common} (${p.botanical}) does best in ${listOf(p.climates.filter((c, i, a) => a.indexOf(c) === i))} conditions, so ${count} may struggle — check with a local nursery before buying.`,
      refs, point, levelId,
    });
    const flagged = new Set<string>();
    for (const ln of la.plants) {
      if (suitsClimate(ln.plant, lat)) continue;
      flagged.add(ln.plant.id);
      const first = b.furniture[ln.itemIds[0]];
      note(ln.plant, ln.quantity === 1 ? 'the one placed here' : `the ${ln.quantity} placed here`, ln.itemIds.map((id) => ({ kind: 'furniture' as const, id })), first?.position, first?.levelId);
    }
    for (const f of lines) {
      if (f.kind !== 'hedge') continue;
      const sp = hedgeSpecies(f);
      if (suitsClimate(sp, lat) || flagged.has(sp.id)) continue;
      flagged.add(sp.id);
      note(sp, `the hedge “${f.name}”`, [fref(f)], f.path![0]);
    }
  }

  // A pool that children at play can walk straight to.
  if (play.length) {
    const loops = lines.filter((f) => isClosedPath(f.path!)).map((f) => f.path!.slice(0, -1));
    for (const pool of areas.filter((f) => f.kind === 'pool')) {
      // Only a barrier with the pool inside and the play equipment outside separates the two.
      const guarded = loops.some((loop) => pool.polygon!.every((v) => pointInPolygon(v, loop)) && !play.some((x) => pointInPolygon(x.item.position, loop)));
      if (!guarded) push({
        severity: 'info', category: cat, title: `${pool.name} is open to the play area`,
        detail: `There is play equipment on the site (${play[0].asset.name.toLowerCase()}) and no fence, wall or hedge runs all the way round the pool. A closed barrier with a gate keeps small children from reaching the water on their own.`,
        refs: [fref(pool)], point: centroid(pool.polygon!),
      });
    }
  }

  // Beds drawn but never planted.
  for (const bed of areas.filter((f) => f.kind === 'bed' || f.kind === 'planter')) {
    if (plants.some((x) => pointInPolygon(x.item.position, bed.polygon!))) continue;
    push({
      severity: 'info', category: cat, title: `${bed.name} has no plants`,
      detail: 'This planting bed is empty. Add shrubs, groundcover or flowers to it, or change it to lawn or gravel so the drawings and the estimate match what will be built.',
      refs: [fref(bed)], point: centroid(bed.polygon!),
    });
  }
}

function collinearOverlap(a: Wall, b: Wall): number {
  const da = norm(sub(a.b, a.a));
  const off = (p: Vec2) => Math.abs(da.x * (p.y - a.a.y) - da.y * (p.x - a.a.x));
  if (off(b.a) > 10 || off(b.b) > 10) return 0;
  const La = dist(a.a, a.b);
  const t0 = lineParam(b.a, a.a, a.b) * La, t1 = lineParam(b.b, a.a, a.b) * La;
  const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(La, Math.max(t0, t1));
  return Math.max(0, hi - lo);
}

export { add, scale };
