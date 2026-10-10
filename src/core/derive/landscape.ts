/**
 * Landscape analysis — the one place garden numbers are worked out.
 *
 * Quantities, cost, site analysis, design health and the L-series sheets all
 * read from `analyzeLandscape`, so a planting schedule can never disagree with
 * the estimate. Areas are m², lengths are running metres, water is litres.
 * Pure and unmemoised: it is cheap (one polygon difference for the lawn) and
 * its callers already memoise on the model.
 */
import { LINEAR_FEATURES, type BuildingModel, type FurnitureItem, type Id, type Level, type ProjectDoc, type SiteFeature, type SiteFeatureKind } from '../model/types';
import { ASSET_BY_ID, isGroundAsset, isOutdoorAsset, type Asset } from '../catalog/assets';
import { PLANT_BY_ID, weeklyWater, type Climate, type Plant } from '../catalog/plants';
import { getMaterial } from '../catalog/materials';
import { levelsSorted } from '../model/query';
import { type Polygon, area, areaWithHoles, difference, ensureCCW, offsetPolygonEdges, perimeter } from '../geometry/polygon';
import type { Vec2 } from '../geometry/vec';
import { deriveLevel } from './level';
import { linearSpec } from './solids';

const M2 = 1e6;

/** Irrigation planning rates, litres per m² per week. */
export const LAWN_WATER = 25;
export const BED_WATER = 15;
/** Depth of improved topsoil in a planting bed, mm. */
export const TOPSOIL_DEPTH = 300;
/** Width of the paved band around water, mm — the same band the 3D model builds. */
export const COPING_WIDTH: Record<'pool' | 'pond', number> = { pool: 350, pond: 220 };
const COPING_MATERIAL: Record<'pool' | 'pond', string> = { pool: 'travertine', pond: 'crazy-paving' };
/** Hedge species used when a hedge doesn't name one. */
export const DEFAULT_HEDGE_SPECIES = 'murraya';

export const FEATURE_LABEL: Record<SiteFeatureKind, string> = {
  pool: 'Swimming pool', pond: 'Pond', lawn: 'Lawn', bed: 'Planting bed', planter: 'Planter', gravel: 'Gravel',
  driveway: 'Driveway', parking: 'Parking', pathway: 'Pathway', patio: 'Patio', deck: 'Deck', tree: 'Tree',
  hedge: 'Hedge', fence: 'Fence', wall: 'Garden wall',
};

/** How a ground surface counts in the area statement. `lawn` is natural turf; synthetic turf counts as paving. */
export type SurfaceClass = 'lawn' | 'bed' | 'paving' | 'gravel' | 'deck' | 'pool' | 'pond';

export interface LandscapeSurface {
  kind: SiteFeatureKind;
  cls: SurfaceClass;
  materialId: string;
  material: string;
  /** m² */
  area: number;
  /** Share of rain that soaks in, 0–1. */
  permeability: number;
  featureIds: Id[];
}

export interface LandscapeCoping {
  kind: 'pool' | 'pond';
  materialId: string;
  material: string;
  /** Band width, mm. */
  width: number;
  /** Running metres along the water's edge. */
  length: number;
  /** m² */
  area: number;
  featureIds: Id[];
}

export interface LandscapePlantLine {
  plant: Plant;
  quantity: number;
  /** INR each, supplied and planted. */
  unitPrice: number;
  total: number;
  /** Litres per week for all of them at maturity. */
  weeklyWater: number;
  itemIds: Id[];
}

export interface LandscapeLinear {
  id: Id;
  kind: 'hedge' | 'fence' | 'wall';
  name: string;
  /** Running metres along the centre-line. */
  length: number;
  /** mm */
  height: number;
  /** mm */
  width: number;
  materialId: string;
  material: string;
  closed: boolean;
  /** One face, m² (length × height). */
  faceArea: number;
  /** Hedges only. */
  species?: Plant;
  /** Hedges only: ceil(length / planting distance). */
  plantCount?: number;
}

export interface LandscapeStructure { assetId: string; name: string; quantity: number; unitPrice: number; total: number; itemIds: Id[] }

export interface LandscapeAnalysis {
  /** m² */
  plotArea: number;
  /** Ground-level building footprint, m². */
  footprintArea: number;
  /** Plot minus ground footprint, m². */
  openArea: number;
  /** m² */
  areas: { lawn: number; beds: number; paving: number; gravel: number; decking: number; coping: number; pool: number; pond: number; water: number };
  /** Every non-lawn surface, grouped by kind and material. */
  surfaces: LandscapeSurface[];
  /** Hard paving (not gravel or decking) by material. */
  pavingByMaterial: { materialId: string; material: string; area: number }[];
  coping: LandscapeCoping[];
  /** Lawn + beds + ponds, m². */
  softscape: number;
  /** Paving + gravel + decking + coping, m². */
  hardscape: number;
  /** Fractions (0–1) of the open area. Pool water is neither. */
  softscapePct: number;
  hardscapePct: number;
  /** Ground that lets rain soak in, weighted by surface, m² and fraction of the plot. */
  permeableArea: number;
  permeablePct: number;
  /** Placed plants by species (hedge plants are counted on the hedge). */
  plants: LandscapePlantLine[];
  plantCount: number;
  /** Trees and palms. */
  treeCount: number;
  /** Mature canopy of trees and palms, capped at the plot area, m² and fraction of the plot. */
  canopyArea: number;
  canopyPct: number;
  linear: LandscapeLinear[];
  /** Litres. `weekly` is the total; `monthly` is weekly × 52 / 12. */
  irrigation: { plants: number; lawn: number; beds: number; hedges: number; weekly: number; monthly: number };
  /** Outdoor light fittings. */
  lights: number;
  /** Pergolas, gates, fountains, fire pits … (asset category `garden`). */
  structures: LandscapeStructure[];
  /** True once the project has any plant or site feature — gates the L-series sheets. */
  hasLandscape: boolean;
}

// ---------------------------------------------------------------- helpers

/** The level whose floor sits nearest site zero: the one the garden belongs to (a basement below it doesn't count). */
export function groundLevel(b: BuildingModel): Level | undefined {
  return levelsSorted(b).reduce<Level | undefined>((g, l) => (!g || Math.abs(l.elevation) < Math.abs(g.elevation) ? l : g), undefined);
}

/** Ground-level outline(s) of the building, to the outside face of the walls. */
export function groundFootprint(b: BuildingModel): Polygon[] {
  const g = groundLevel(b);
  return g ? deriveLevel(b, g.id).footprint : [];
}

/** Items that stand in the garden: everything on the ground level plus ground-only assets wherever they were filed. */
export function groundItems(b: BuildingModel): { item: FurnitureItem; asset: Asset }[] {
  const g = groundLevel(b);
  const out: { item: FurnitureItem; asset: Asset }[] = [];
  for (const item of Object.values(b.furniture)) {
    const asset = ASSET_BY_ID[item.assetId];
    if (asset && (item.levelId === g?.id || isGroundAsset(asset))) out.push({ item, asset });
  }
  return out;
}

export const isLinear = (f: SiteFeature): boolean => LINEAR_FEATURES.includes(f.kind) && !!f.path && f.path.length > 1;
export const isAreaFeature = (f: SiteFeature): boolean => !LINEAR_FEATURES.includes(f.kind) && !!f.polygon && f.polygon.length > 2;

/** A path that returns to its first point (within 5 mm, as the 3D builder treats it). */
export function isClosedPath(path: Vec2[]): boolean {
  return path.length > 2 && Math.hypot(path[0].x - path[path.length - 1].x, path[0].y - path[path.length - 1].y) < 5;
}

export function pathLength(path: Vec2[]): number {
  let L = 0;
  for (let i = 0; i + 1 < path.length; i++) L += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  return L;
}

/** Material a surface is finished in — the same fallbacks the 3D model uses, so drawings, model and estimate agree. */
export function surfaceMaterialId(f: SiteFeature): string {
  if (f.materialId) return f.materialId;
  switch (f.kind) {
    case 'pool': return 'pool-water';
    case 'pond': return 'pond-water';
    case 'lawn': return 'lawn';
    case 'bed': case 'planter': return 'mulch';
    case 'gravel': return 'gravel';
    case 'deck': return 'deck-wood';
    case 'patio': return 'sandstone-paving';
    default: return 'paver';
  }
}

export function surfaceClass(f: SiteFeature): SurfaceClass {
  switch (f.kind) {
    case 'pool': return 'pool';
    case 'pond': return 'pond';
    case 'bed': case 'planter': return 'bed';
    case 'gravel': return 'gravel';
    case 'deck': return 'deck';
    // A lawn feature in real grass is just part of the lawn; in anything else (artificial turf) it is a laid surface.
    case 'lawn': return surfaceMaterialId(f) === 'lawn' ? 'lawn' : 'paving';
    default: return 'paving';
  }
}

const LOOSE_FILL = new Set(['gravel', 'white-pebble', 'sand', 'mulch']);
const DECKING = new Set(['deck-wood', 'composite-deck']);

/** Planning figure for how much rain a surface lets through. */
export function permeability(cls: SurfaceClass, materialId: string): number {
  if (cls === 'lawn' || cls === 'bed' || cls === 'pond') return 1;
  if (cls === 'pool') return 0;
  if (materialId === 'grass-paver') return 0.5;
  if (LOOSE_FILL.has(materialId)) return 0.7;
  if (DECKING.has(materialId)) return 0.3;
  if (cls === 'gravel') return 0.7;
  if (cls === 'deck') return 0.3;
  return 0;
}

export function hedgeSpecies(f: SiteFeature): Plant {
  return PLANT_BY_ID[String(f.props.species ?? DEFAULT_HEDGE_SPECIES)] ?? PLANT_BY_ID[DEFAULT_HEDGE_SPECIES];
}

/** Paved band around a pool or pond: outer ring, width and material. Null when the outline can't be offset cleanly. */
export function copingOf(f: SiteFeature): { outer: Polygon; inner: Polygon; width: number; materialId: string } | null {
  if ((f.kind !== 'pool' && f.kind !== 'pond') || !f.polygon || f.polygon.length < 3) return null;
  const inner = ensureCCW(f.polygon);
  const width = COPING_WIDTH[f.kind];
  const outer = offsetPolygonEdges(inner, inner.map(() => -width));
  if (outer.length !== inner.length) return null;
  return { outer, inner, width, materialId: String(f.props.coping ?? COPING_MATERIAL[f.kind]) };
}

/** Coarse climate from latitude alone — enough to catch a lavender border in Mumbai, no more. */
export function climateOf(lat: number): Climate {
  const a = Math.abs(lat);
  return a < 23.5 ? 'tropical' : a < 35 ? 'subtropical' : 'temperate';
}

/**
 * Latitude can't tell a dry climate from a humid one, so the warm-temperate bands
 * also accept plants listed for arid and Mediterranean gardens — otherwise an
 * olive in Rome or an agave in Jaipur would be flagged for no reason.
 */
const CLIMATE_MATCH: Record<'tropical' | 'subtropical' | 'temperate', Climate[]> = {
  tropical: ['tropical'], subtropical: ['subtropical', 'arid', 'mediterranean'], temperate: ['temperate', 'mediterranean'],
};

export function suitsClimate(p: Plant, lat: number): boolean {
  const band = climateOf(lat) as keyof typeof CLIMATE_MATCH;
  return p.climates.some((c) => CLIMATE_MATCH[band].includes(c));
}

export const isTreeLike = (p: Plant): boolean => p.type === 'tree' || p.type === 'palm';

/** An outdoor light fitting (lamp post, bollard, path light, uplight). */
export const isOutdoorLight = (a: Asset): boolean => a.tags.includes('light') && (isOutdoorAsset(a) || a.tags.includes('outdoor'));

/** Play equipment small children use unsupervised (play set, sand pit, trampoline). */
export const isPlayItem = (a: Asset): boolean => a.tags.includes('kids');

// --------------------------------------------------------------- analysis

export function analyzeLandscape(doc: ProjectDoc, building: BuildingModel): LandscapeAnalysis {
  const site = doc.site;
  const plot = site.boundary.length >= 3 ? ensureCCW(site.boundary) : [];
  const plotArea = area(plot) / M2;
  const footprint = groundFootprint(building);
  const features = Object.values(site.features);

  // ---- surfaces, grouped by kind and material
  const surfaceMap = new Map<string, LandscapeSurface>();
  const copingMap = new Map<string, LandscapeCoping>();
  const notLawn: Polygon[] = [];
  for (const f of features) {
    if (!isAreaFeature(f)) continue;
    const cls = surfaceClass(f);
    if (cls === 'lawn') continue; // real turf is already part of the lawn remainder
    notLawn.push(f.polygon!);
    const materialId = surfaceMaterialId(f);
    const key = `${f.kind}|${materialId}`;
    const a = area(f.polygon!) / M2;
    const ex = surfaceMap.get(key);
    if (ex) { ex.area += a; ex.featureIds.push(f.id); }
    else surfaceMap.set(key, { kind: f.kind, cls, materialId, material: getMaterial(materialId).name, area: a, permeability: permeability(cls, materialId), featureIds: [f.id] });
    const cp = copingOf(f);
    if (cp) {
      notLawn.push(cp.outer);
      const ck = `${f.kind}|${cp.materialId}`;
      const band = Math.max(0, area(cp.outer) - area(cp.inner)) / M2;
      const ce = copingMap.get(ck);
      if (ce) { ce.area += band; ce.length += perimeter(cp.inner) / 1000; ce.featureIds.push(f.id); }
      else copingMap.set(ck, { kind: f.kind as 'pool' | 'pond', materialId: cp.materialId, material: getMaterial(cp.materialId).name, width: cp.width, length: perimeter(cp.inner) / 1000, area: band, featureIds: [f.id] });
    }
  }
  const surfaces = [...surfaceMap.values()];
  const coping = [...copingMap.values()];
  const sumCls = (c: SurfaceClass) => surfaces.filter((s) => s.cls === c).reduce((t, s) => t + s.area, 0);
  const copingArea = coping.reduce((t, c) => t + c.area, 0);

  const footprintArea = footprint.reduce((t, p) => t + area(p), 0) / M2;
  const openArea = Math.max(0, plotArea - footprintArea);

  // ---- lawn: whatever is left of the plot once the house, surfaces and water are taken out
  let lawn = 0;
  if (plot.length) {
    try {
      lawn = areaWithHoles(difference([plot], [...footprint, ...notLawn])) / M2;
    } catch {
      // Degenerate outlines can upset the clipper; fall back to plain arithmetic rather than fail the whole analysis.
      lawn = Math.max(0, openArea - surfaces.reduce((t, s) => t + s.area, 0) - copingArea);
    }
  }

  const areas = {
    lawn, beds: sumCls('bed'), paving: sumCls('paving'), gravel: sumCls('gravel'), decking: sumCls('deck'), coping: copingArea,
    pool: sumCls('pool'), pond: sumCls('pond'), water: sumCls('pool') + sumCls('pond'),
  };
  const pavingMap = new Map<string, { materialId: string; material: string; area: number }>();
  for (const s of surfaces) {
    if (s.cls !== 'paving') continue;
    const e = pavingMap.get(s.materialId);
    if (e) e.area += s.area; else pavingMap.set(s.materialId, { materialId: s.materialId, material: s.material, area: s.area });
  }

  const softscape = areas.lawn + areas.beds + areas.pond;
  const hardscape = areas.paving + areas.gravel + areas.decking + areas.coping;
  const permeableArea = areas.lawn + surfaces.reduce((t, s) => t + s.area * s.permeability, 0)
    + coping.reduce((t, c) => t + c.area * permeability('paving', c.materialId), 0);

  // ---- plants, structures and lights from the placed items
  const plantMap = new Map<string, LandscapePlantLine>();
  const structMap = new Map<string, LandscapeStructure>();
  let lights = 0, treeCount = 0, canopy = 0, plantCount = 0, plantWater = 0;
  for (const item of Object.values(building.furniture)) {
    const asset = ASSET_BY_ID[item.assetId];
    if (!asset) continue;
    if (isOutdoorLight(asset)) lights++;
    const p = asset.plant;
    if (p) {
      const w = weeklyWater(p);
      const e = plantMap.get(p.id);
      if (e) { e.quantity++; e.total += p.price; e.weeklyWater += w; e.itemIds.push(item.id); }
      else plantMap.set(p.id, { plant: p, quantity: 1, unitPrice: p.price, total: p.price, weeklyWater: w, itemIds: [item.id] });
      plantCount++;
      plantWater += w;
      if (isTreeLike(p)) { treeCount++; canopy += Math.PI * (p.spread / 2000) ** 2; }
    } else if (asset.category === 'garden') {
      const e = structMap.get(asset.id);
      if (e) { e.quantity++; e.total += asset.price; e.itemIds.push(item.id); }
      else structMap.set(asset.id, { assetId: asset.id, name: asset.name, quantity: 1, unitPrice: asset.price, total: asset.price, itemIds: [item.id] });
    }
  }
  // Trees drawn as plain site features (older projects) have a canopy but no species.
  for (const f of features) if (f.kind === 'tree' && f.position) { treeCount++; canopy += Math.PI * ((f.radius ?? 2000) / 1000) ** 2; }
  const canopyArea = Math.min(canopy, plotArea);

  // ---- hedges, fences and garden walls
  const linear: LandscapeLinear[] = [];
  let hedgeWater = 0;
  for (const f of features) {
    if (!isLinear(f)) continue;
    const spec = linearSpec(f);
    const length = pathLength(f.path!) / 1000;
    const line: LandscapeLinear = {
      id: f.id, kind: f.kind as LandscapeLinear['kind'], name: f.name, length, height: spec.height, width: spec.width,
      materialId: spec.material, material: getMaterial(spec.material).name, closed: isClosedPath(f.path!), faceArea: (length * spec.height) / 1000,
    };
    if (f.kind === 'hedge') {
      const sp = hedgeSpecies(f);
      line.species = sp;
      line.plantCount = Math.ceil((length * 1000) / Math.max(1, sp.spacing));
      // A hedge is watered as a planted strip, not plant by plant — mature-canopy figures would triple-count a clipped row.
      hedgeWater += length * (spec.width / 1000) * BED_WATER;
    }
    linear.push(line);
  }

  const lawnWater = areas.lawn * LAWN_WATER, bedWater = areas.beds * BED_WATER;
  const weekly = Math.round(plantWater + lawnWater + bedWater + hedgeWater);

  return {
    plotArea, footprintArea, openArea, areas, surfaces, pavingByMaterial: [...pavingMap.values()], coping,
    softscape, hardscape,
    softscapePct: openArea ? softscape / openArea : 0, hardscapePct: openArea ? hardscape / openArea : 0,
    permeableArea, permeablePct: plotArea ? permeableArea / plotArea : 0,
    plants: [...plantMap.values()].sort((a, c) => a.plant.botanical.localeCompare(c.plant.botanical)),
    plantCount, treeCount, canopyArea, canopyPct: plotArea ? canopyArea / plotArea : 0,
    linear,
    irrigation: { plants: plantWater, lawn: lawnWater, beds: bedWater, hedges: hedgeWater, weekly, monthly: Math.round((weekly * 52) / 12) },
    lights,
    structures: [...structMap.values()],
    hasLandscape: plantCount > 0 || features.length > 0,
  };
}

// ------------------------------------------------------------ species keys

/**
 * Short drawing key per species — first two letters of genus + species, upper
 * case ("Azadirachta indica" → AZIN). A clash (Murraya paniculata / Musa ×
 * paradisiaca → MUPA) is resolved by taking a third letter, then a number, so
 * the plan and the schedule always agree on a unique key.
 */
export function speciesKeys(plants: Plant[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const sorted = [...new Map(plants.map((p) => [p.id, p])).values()].sort((a, b) => a.botanical.localeCompare(b.botanical) || a.id.localeCompare(b.id));
  for (const p of sorted) {
    const words = p.botanical.split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, '')).filter(Boolean);
    const genus = (words[0] ?? p.id).toUpperCase(), species = (words[1] ?? words[0]?.slice(2) ?? '').toUpperCase();
    const tries = [genus.slice(0, 2) + species.slice(0, 2), genus.slice(0, 2) + species.slice(0, 3), genus.slice(0, 3) + species.slice(0, 2)];
    let key = tries.find((k) => k.length >= 2 && !used.has(k));
    for (let n = 2; !key; n++) if (!used.has(`${tries[0]}${n}`)) key = `${tries[0]}${n}`;
    used.add(key);
    out.set(p.id, key);
  }
  return out;
}

/** Keys for every species in the project — placed plants and hedge species alike. */
export function landscapeKeys(la: LandscapeAnalysis): Map<string, string> {
  return speciesKeys([...la.plants.map((l) => l.plant), ...la.linear.flatMap((l) => (l.species ? [l.species] : []))]);
}
