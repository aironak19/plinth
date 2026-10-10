/**
 * Quantity takeoff — measured directly from the model, net of openings.
 * Every line records where it came from (level, room, element) so cost and
 * schedules can be broken down any way.
 */
import type { BuildingModel, ProjectDoc } from '../model/types';
import type { RuleSet } from '../rules/rulesets';
import { getMaterial, type CostUnit } from '../catalog/materials';
import { ASSET_BY_ID } from '../catalog/assets';
import { levelAbove, levelsSorted, openingsOf, isDoor, wallLength } from '../model/query';
import { deriveLevel } from './level';
import { wallSides } from './finishes';
import { computeRoof } from './roof';
import { computeStair } from './stairs';
import { area, ensureCCW } from '../geometry/polygon';
import { COPING_WIDTH, FEATURE_LABEL, TOPSOIL_DEPTH, analyzeLandscape } from './landscape';

export type QtyCategory =
  | 'Masonry' | 'Concrete' | 'Floor finishes' | 'Wall finishes' | 'Exterior finishes' | 'Ceilings' | 'Roofing'
  | 'Doors' | 'Windows' | 'Stairs' | 'Furniture' | 'Landscape' | 'Services';

export interface QtyLine {
  key: string;
  category: QtyCategory;
  item: string;
  materialId?: string;
  quantity: number;
  unit: CostUnit;
  levelId?: string;
  roomId?: string;
  /** Optional direct cost (INR) for items not priced by material rate (furniture, doors, services). */
  directCost?: number;
  /**
   * Quantity the material rate applies to, when that isn't the measured quantity —
   * a fence is measured in running metres but its boarding is priced per m².
   */
  priceQuantity?: number;
}

export interface Takeoff {
  lines: QtyLine[];
  summary: {
    floorArea: number; wallArea: number; paintArea: number; roofArea: number; concreteVolume: number;
    masonryVolume: number; doors: number; windows: number; glazingArea: number; tileArea: number;
    ceilingArea: number; builtUpArea: number; carpetArea: number; exteriorWallArea: number;
  };
}

const M2 = 1e6, M3 = 1e9;

/** Typical installed rates for doors / windows by type (INR), used when no catalogue rate applies. */
export const OPENING_RATES: Record<string, number> = {
  'door:single': 28000, 'door:double': 52000, 'door:sliding': 68000, 'door:folding': 85000, 'door:pocket': 42000,
  'door:pivot': 145000, 'door:french': 78000, 'door:garage': 160000, 'door:opening': 6000,
  'window:m2': 9500,
};

/** Services allowances per m² of built-up area (INR). Shown as allowances, not measured quantities. */
export const SERVICE_ALLOWANCES = [
  { key: 'svc-electrical', item: 'Electrical & lighting (allowance)', rate: 1450 },
  { key: 'svc-plumbing', item: 'Plumbing & sanitary (allowance)', rate: 1150 },
  { key: 'svc-hvac', item: 'Air-conditioning provision (allowance)', rate: 900 },
];

/**
 * Landscape allowances (INR). Irrigation is per m² served — pipework, emitters or
 * pop-up heads and a timer, not the water source. Topsoil is per m³ spread.
 */
export const LANDSCAPE_RATES = { drip: 140, sprinkler: 110, topsoil: 1100 };

/** Quantity a material's own rate applies to for a run of `length` m, `height` × `width` mm in section. */
function linearPriceQty(materialId: string, length: number, height: number, width: number): number {
  const unit = getMaterial(materialId).costUnit;
  return unit === 'm3' ? (length * height * width) / 1e6 : unit === 'm2' ? (length * height) / 1000 : length;
}

export function computeTakeoff(doc: ProjectDoc, b: BuildingModel, rules: RuleSet): Takeoff {
  const lines: QtyLine[] = [];
  const add = (l: QtyLine) => {
    if (l.quantity <= 0 && !l.directCost) return;
    const ex = lines.find((x) => x.key === l.key);
    if (ex) {
      ex.quantity += l.quantity;
      if (l.directCost) ex.directCost = (ex.directCost ?? 0) + l.directCost;
      if (l.priceQuantity !== undefined) ex.priceQuantity = (ex.priceQuantity ?? 0) + l.priceQuantity;
    }
    else lines.push({ ...l });
  };
  const s = { floorArea: 0, wallArea: 0, paintArea: 0, roofArea: 0, concreteVolume: 0, masonryVolume: 0, doors: 0, windows: 0, glazingArea: 0, tileArea: 0, ceilingArea: 0, builtUpArea: 0, carpetArea: 0, exteriorWallArea: 0 };
  const levels = levelsSorted(b);

  for (const level of levels) {
    const dl = deriveLevel(b, level.id);
    const above = levelAbove(b, level.id);
    const topGap = above ? above.slabThickness : 0;
    s.builtUpArea += dl.grossArea;
    s.carpetArea += dl.netArea;

    // Walls: core volume and both faces.
    for (const w of dl.walls) {
      const h = w.height ?? level.height - topGap;
      const L = wallLength(w);
      const ops = openingsOf(b, w.id);
      const openArea = ops.reduce((a, o) => a + o.width * Math.min(o.height, h), 0);
      const net = Math.max(0, L * h - openArea);
      const core = getMaterial(w.materialId);
      const vol = (net * w.thickness) / M3;
      add({ key: `core-${core.id}-${level.id}`, category: core.category === 'concrete' && core.id === 'rcc' ? 'Concrete' : 'Masonry', item: `${core.name} walls`, materialId: core.id, quantity: vol, unit: 'm3', levelId: level.id });
      if (core.category === 'brick' || core.id === 'aac-block') s.masonryVolume += vol; else s.concreteVolume += vol;
      const sides = wallSides(b, dl, w);
      for (const side of [sides.left, sides.right]) {
        const m = getMaterial(side.finishId);
        const a = net / M2;
        s.wallArea += a;
        if (side.exterior) {
          s.exteriorWallArea += a;
          add({ key: `ext-${m.id}`, category: 'Exterior finishes', item: m.name, materialId: m.id, quantity: a, unit: 'm2', levelId: level.id });
        } else {
          if (m.category === 'paint' || m.category === 'plaster') s.paintArea += a;
          if (m.category === 'tile' || m.category === 'marble') s.tileArea += a;
          add({ key: `wallfin-${m.id}-${level.id}`, category: 'Wall finishes', item: m.name, materialId: m.id, quantity: a, unit: 'm2', levelId: level.id, roomId: side.room?.tagId ?? undefined });
        }
      }
      for (const o of ops) {
        if (isDoor(o)) {
          s.doors++;
          add({ key: `door-${o.kind}-${Math.round(o.width / 50) * 50}`, category: 'Doors', item: `${cap(o.kind)} door ${Math.round(o.width)} × ${Math.round(o.height)}`, quantity: 1, unit: 'nos', levelId: level.id, directCost: OPENING_RATES[`door:${o.kind}`] ?? 30000 });
        } else {
          s.windows++;
          const ga = (o.width * o.height) / M2;
          s.glazingArea += ga;
          add({ key: `win-${o.kind}-${o.frameMaterialId}`, category: 'Windows', item: `${cap(o.kind)} window — ${getMaterial(o.frameMaterialId).name}`, materialId: o.frameMaterialId, quantity: ga, unit: 'm2', levelId: level.id, directCost: ga * OPENING_RATES['window:m2'] });
        }
      }
    }

    // Floors, skirting, ceilings per room.
    for (const r of dl.rooms) {
      const tag = r.tagId ? b.rooms[r.tagId] : undefined;
      const m = getMaterial(tag?.floorFinishId ?? 'vitrified');
      const a = r.area / M2;
      s.floorArea += a;
      if (m.category === 'tile' || m.category === 'marble' || m.category === 'stone') s.tileArea += a;
      add({ key: `floor-${m.id}-${level.id}`, category: 'Floor finishes', item: m.name, materialId: m.id, quantity: a, unit: 'm2', levelId: level.id, roomId: r.tagId ?? undefined });
      const c = getMaterial(tag?.ceilingFinishId ?? 'plaster-white');
      s.ceilingArea += a;
      if (c.category === 'paint') s.paintArea += a;
      add({ key: `ceil-${c.id}-${level.id}`, category: 'Ceilings', item: c.name, materialId: c.id, quantity: a, unit: 'm2', levelId: level.id });
    }

    // Slab
    if (dl.footprint.length) {
      const fpArea = dl.footprint.reduce((acc, p) => acc + area(p), 0);
      const vol = (fpArea * level.slabThickness) / M3;
      s.concreteVolume += vol;
      add({ key: `slab-${level.id}`, category: 'Concrete', item: `Floor slab — ${level.name}`, materialId: 'rcc', quantity: vol, unit: 'm3', levelId: level.id });
    }

    for (const st of Object.values(b.stairs).filter((x) => x.levelId === level.id)) {
      const info = computeStair(st, level, rules);
      const plan = area(ensureCCW(info.footprint));
      const vol = (plan * (info.riser / 2 + 150) * 1.15) / M3; // waist slab + steps
      s.concreteVolume += vol;
      add({ key: `stair-${st.id}`, category: 'Stairs', item: `${cap(st.kind)} stair — ${info.risers} risers`, materialId: 'rcc', quantity: vol, unit: 'm3', levelId: level.id });
      const fin = getMaterial(st.materialId);
      add({ key: `stairfin-${fin.id}`, category: 'Stairs', item: `Stair finish — ${fin.name}`, materialId: fin.id, quantity: (info.going * st.width + info.risers * info.riser * st.width) / M2, unit: 'm2', levelId: level.id });
    }
    for (const c of Object.values(b.columns).filter((x) => x.levelId === level.id)) {
      const ar = c.shape === 'round' ? Math.PI * (c.width / 2) ** 2 : c.width * c.depth;
      const vol = (ar * (level.height - topGap)) / M3;
      s.concreteVolume += vol;
      add({ key: `col-${level.id}`, category: 'Concrete', item: 'Columns (conceptual)', materialId: 'rcc', quantity: vol, unit: 'm3', levelId: level.id });
    }
    for (const bm of Object.values(b.beams).filter((x) => x.levelId === level.id)) {
      const vol = (Math.hypot(bm.b.x - bm.a.x, bm.b.y - bm.a.y) * bm.width * bm.depth) / M3;
      s.concreteVolume += vol;
      add({ key: `beam-${level.id}`, category: 'Concrete', item: 'Beams (conceptual)', materialId: 'rcc', quantity: vol, unit: 'm3', levelId: level.id });
    }
    for (const f of Object.values(b.furniture).filter((x) => x.levelId === level.id)) {
      const asset = ASSET_BY_ID[f.assetId];
      if (!asset || !asset.price) continue;
      // Plants and garden structures are landscape works, not loose furniture — they are taken off below.
      if (asset.plant || asset.category === 'garden') continue;
      add({ key: `furn-${asset.id}`, category: 'Furniture', item: asset.name, quantity: 1, unit: 'nos', levelId: level.id, directCost: asset.price });
    }
  }

  for (const roof of Object.values(b.roofs)) {
    const level = b.levels[roof.levelId];
    if (!level) continue;
    const info = computeRoof(roof, level, deriveLevel(b, level.id), rules.values.downpipeSpacing);
    const m = getMaterial(roof.materialId);
    s.roofArea += info.slopedArea / M2;
    add({ key: `roof-${roof.id}`, category: 'Roofing', item: `${m.name} (${roof.kind})`, materialId: m.id, quantity: info.slopedArea / M2, unit: 'm2', levelId: level.id });
    if (roof.kind === 'flat') {
      const vol = (info.planArea * roof.thickness) / M3;
      s.concreteVolume += vol;
      add({ key: `roofslab-${roof.id}`, category: 'Concrete', item: 'Roof slab', materialId: 'rcc', quantity: vol, unit: 'm3', levelId: level.id });
      if (roof.parapetHeight > 0) {
        const per = deriveLevel(b, level.id).footprint.reduce((acc, p) => acc + p.reduce((x, q, i) => x + Math.hypot(p[(i + 1) % p.length].x - q.x, p[(i + 1) % p.length].y - q.y), 0), 0);
        add({ key: `parapet-${roof.id}`, category: 'Masonry', item: 'Parapet masonry', materialId: 'brick', quantity: (per * roof.parapetHeight * 115) / M3, unit: 'm3', levelId: level.id });
      }
    } else {
      add({ key: `gutter-${roof.id}`, category: 'Roofing', item: 'Gutters', quantity: info.gutterLength / 1000, unit: 'rm', levelId: level.id, directCost: (info.gutterLength / 1000) * 950 });
      add({ key: `ridge-${roof.id}`, category: 'Roofing', item: 'Ridge & hip capping', quantity: (info.ridgeLength + info.hipLength) / 1000, unit: 'rm', levelId: level.id, directCost: ((info.ridgeLength + info.hipLength) / 1000) * 650 });
    }
    add({ key: `dp-${roof.id}`, category: 'Roofing', item: 'Downpipes / rainwater outlets', quantity: info.downpipes, unit: 'nos', levelId: level.id, directCost: info.downpipes * 6500 });
  }

  // Landscape — every line comes from the shared analysis, so the BOQ, the L-sheets and Site analysis agree.
  const la = analyzeLandscape(doc, b);
  const L: QtyCategory = 'Landscape';
  const mm = (v: number) => `${+(v / 1000).toFixed(2)} m`;
  for (const sf of la.surfaces) add({ key: `site-${sf.kind}-${sf.materialId}`, category: L, item: `${FEATURE_LABEL[sf.kind]} — ${sf.material}`, materialId: sf.materialId, quantity: sf.area, unit: 'm2' });
  add({ key: 'site-lawn', category: L, item: 'Lawn turfing', materialId: 'lawn', quantity: la.areas.lawn, unit: 'm2' });
  for (const c of la.coping) add({ key: `coping-${c.kind}-${c.materialId}`, category: L, item: `${c.kind === 'pool' ? 'Pool' : 'Pond'} coping — ${c.material}, ${COPING_WIDTH[c.kind]} mm band (${c.length.toFixed(1)} rm)`, materialId: c.materialId, quantity: c.area, unit: 'm2' });

  // Topsoil is part of the standard bed build-up (see the `mulch` material); beds finished in anything else need it bought in.
  const bedVol = (inRate: boolean) => la.surfaces.filter((x) => x.cls === 'bed' && (x.materialId === 'mulch') === inRate).reduce((t, x) => t + x.area, 0) * (TOPSOIL_DEPTH / 1000);
  add({ key: 'site-topsoil', category: L, item: `Topsoil to planting beds, ${TOPSOIL_DEPTH} mm deep (supply included in the planting-bed rate)`, quantity: bedVol(true), unit: 'm3' });
  add({ key: 'site-topsoil-extra', category: L, item: `Topsoil to planting beds, ${TOPSOIL_DEPTH} mm deep (allowance ₹${LANDSCAPE_RATES.topsoil.toLocaleString('en-IN')}/m³)`, quantity: bedVol(false), unit: 'm3', directCost: bedVol(false) * LANDSCAPE_RATES.topsoil });

  for (const p of la.plants) add({ key: `plant-${p.plant.id}`, category: L, item: `${p.plant.common} — ${p.plant.botanical}`, quantity: p.quantity, unit: 'nos', directCost: p.total });

  for (const ln of la.linear) {
    const h = mm(ln.height);
    if (ln.kind === 'hedge' && ln.species) {
      const n = ln.plantCount ?? 0;
      // One line per hedge: the plant count in the text has to match the length beside it.
      add({ key: `hedge-${ln.id}`, category: L, item: `Hedge — ${ln.species.common}, ${h} high · ${n} plants at ${ln.species.spacing} mm centres`, materialId: 'hedge', quantity: ln.length, unit: 'rm', directCost: n * ln.species.price });
    } else if (ln.kind === 'fence') {
      add({ key: `fence-${ln.materialId}-${ln.height}`, category: L, item: `Fence — ${ln.material}, ${h} high`, materialId: ln.materialId, quantity: ln.length, unit: 'rm', priceQuantity: linearPriceQty(ln.materialId, ln.length, ln.height, ln.width) });
    } else if (ln.kind === 'wall') {
      const finish = getMaterial(ln.materialId);
      // A wall "material" is normally its finish over brick; a core material (brick, block, concrete) is the wall itself.
      const core = finish.costUnit === 'm3' ? finish : getMaterial('brick');
      add({ key: `gwall-${core.id}-${ln.height}-${ln.width}`, category: L, item: `Garden wall — ${core.name}, ${h} high × ${Math.round(ln.width)} mm (above ground)`, materialId: core.id, quantity: ln.length, unit: 'rm', priceQuantity: (ln.length * ln.height * ln.width) / 1e6 });
      if (finish.costUnit === 'm2') add({ key: `gwall-fin-${finish.id}`, category: L, item: `Garden wall finish — ${finish.name} (both faces)`, materialId: finish.id, quantity: ln.faceArea * 2, unit: 'm2' });
      const cop = getMaterial(String(doc.site.features[ln.id]?.props.coping ?? 'granite-paving'));
      add({ key: `gwall-cop-${cop.id}`, category: L, item: `Garden wall coping — ${cop.name}`, materialId: cop.id, quantity: ln.length, unit: 'rm', priceQuantity: linearPriceQty(cop.id, ln.length, ln.width + 60, 60) });
    }
  }

  const dripArea = la.areas.beds + la.linear.filter((x) => x.kind === 'hedge').reduce((t, x) => t + (x.length * x.width) / 1000, 0);
  add({ key: 'irrigation-drip', category: L, item: `Drip irrigation to planting beds and hedges (allowance ₹${LANDSCAPE_RATES.drip}/m²)`, quantity: dripArea, unit: 'm2', directCost: dripArea * LANDSCAPE_RATES.drip });
  add({ key: 'irrigation-sprinkler', category: L, item: `Pop-up sprinkler irrigation to lawn (allowance ₹${LANDSCAPE_RATES.sprinkler}/m²)`, quantity: la.areas.lawn, unit: 'm2', directCost: la.areas.lawn * LANDSCAPE_RATES.sprinkler });

  for (const st of la.structures) add({ key: `garden-${st.assetId}`, category: L, item: st.name, quantity: st.quantity, unit: 'nos', directCost: st.total });

  for (const a of SERVICE_ALLOWANCES) add({ key: a.key, category: 'Services', item: a.item, quantity: s.builtUpArea / M2, unit: 'm2', directCost: (s.builtUpArea / M2) * a.rate });

  for (const k of ['builtUpArea', 'carpetArea'] as const) s[k] = s[k] / M2;
  return { lines, summary: s };
}

function cap(x: string) { return x.charAt(0).toUpperCase() + x.slice(1); }
