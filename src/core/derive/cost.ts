/**
 * Configurable cost engine. Rates come from the material catalogue, overridable
 * per project; every estimate carries its source label and assumptions.
 */
import type { BuildingModel, CostSettings, ProjectDoc } from '../model/types';
import type { RuleSet } from '../rules/rulesets';
import { getMaterial, materialAlternatives, type Material } from '../catalog/materials';
import { computeTakeoff, type QtyCategory, type QtyLine, type Takeoff } from './quantities';

export interface CostLine extends QtyLine { rate: number; material: number; labour: number; total: number }

export interface CostEstimate {
  currency: CostSettings['currency'];
  lines: CostLine[];
  byCategory: { category: QtyCategory; total: number }[];
  byLevel: { levelId: string; total: number }[];
  byRoom: { roomId: string; total: number }[];
  materialTotal: number;
  labourTotal: number;
  directTotal: number;
  margin: number;
  contingency: number;
  tax: number;
  grandTotal: number;
  /** Loose furniture, listed separately unless includeFFE is on. */
  ffeTotal: number;
  perSqft: number;
  perM2: number;
  builtUpM2: number;
  takeoff: Takeoff;
  assumptions: string[];
}

export function rateFor(m: Material, settings: CostSettings): { material: number; labour: number } {
  const override = settings.rateOverrides[m.id];
  const material = override ?? m.rate;
  return { material, labour: m.labour * settings.labourFactor };
}

export function estimateCost(doc: ProjectDoc, b: BuildingModel, rules: RuleSet): CostEstimate {
  const settings = doc.cost;
  const takeoff = computeTakeoff(doc, b, rules);
  const fx = settings.fxPerInr;
  const lines: CostLine[] = takeoff.lines.map((l) => {
    let material = 0, labour = 0;
    if (l.directCost !== undefined) {
      material = l.directCost;
    } else if (l.materialId) {
      const r = rateFor(getMaterial(l.materialId), settings);
      // Linear landscape items are measured in running metres but priced on their face area or volume.
      const q = l.priceQuantity ?? l.quantity;
      material = r.material * q;
      labour = r.labour * q;
    }
    const total = (material + labour) * fx;
    return { ...l, rate: l.quantity ? total / l.quantity : 0, material: material * fx, labour: labour * fx, total };
  });
  // FF&E is the 'Furniture' category only. The takeoff files plants, hedges and garden structures
  // (pergolas, gates, lights) under 'Landscape', so they are always in the construction total and never in FF&E.
  const counted = (l: CostLine) => settings.includeFFE || l.category !== 'Furniture';
  const ffeTotal = lines.filter((l) => l.category === 'Furniture').reduce((s, l) => s + l.total, 0);
  const sum = (f: (l: CostLine) => number) => lines.filter(counted).reduce((s, l) => s + f(l), 0);
  const materialTotal = sum((l) => l.material);
  const labourTotal = sum((l) => l.labour);
  const directTotal = materialTotal + labourTotal;
  const margin = directTotal * settings.contractorMargin;
  const contingency = (directTotal + margin) * settings.contingency;
  const tax = (directTotal + margin + contingency) * settings.taxRate;
  const grandTotal = directTotal + margin + contingency + tax;
  const group = <K extends string>(key: (l: CostLine) => K | undefined) => {
    const m = new Map<K, number>();
    for (const l of lines) { if (!counted(l)) continue; const k = key(l); if (k) m.set(k, (m.get(k) ?? 0) + l.total); }
    return m;
  };
  const builtUpM2 = takeoff.summary.builtUpArea;
  const uplift = directTotal ? grandTotal / directTotal : 1;
  return {
    currency: settings.currency,
    lines,
    byCategory: [...group((l) => l.category)].map(([category, total]) => ({ category, total: total * uplift })).sort((a, b) => b.total - a.total),
    byLevel: [...group((l) => l.levelId)].map(([levelId, total]) => ({ levelId, total: total * uplift })),
    byRoom: [...group((l) => l.roomId)].map(([roomId, total]) => ({ roomId, total: total * uplift })).sort((a, b) => b.total - a.total),
    materialTotal, labourTotal, directTotal, margin, contingency, tax, grandTotal, ffeTotal,
    perM2: builtUpM2 ? grandTotal / builtUpM2 : 0,
    perSqft: builtUpM2 ? grandTotal / (builtUpM2 * 10.7639) : 0,
    builtUpM2,
    takeoff,
    assumptions: [
      settings.source,
      `Labour factor ×${settings.labourFactor.toFixed(2)}, contractor margin ${(settings.contractorMargin * 100).toFixed(0)}%, contingency ${(settings.contingency * 100).toFixed(0)}%, tax ${(settings.taxRate * 100).toFixed(0)}%.`,
      settings.includeFFE ? 'Loose furniture (FF&E) is included in the total.' : 'Loose furniture (FF&E) is listed separately and excluded from the construction total.',
      'Services (electrical, plumbing, HVAC) are per-m² allowances, not measured quantities.',
      ...(lines.some((l) => l.category === 'Landscape')
        ? ['Landscape covers paving, lawn, planting at nursery size, hedges, fences, garden walls above ground and garden structures, and is always in the total; outdoor furniture stays with FF&E. Irrigation is a per-m² allowance.']
        : []),
      'Structure is conceptual — quantities exclude reinforcement steel and foundations until an engineered design is linked.',
    ],
  };
}

export interface MaterialAlternative {
  current: Material;
  alternative: Material;
  quantity: number;
  saving: number;
  visualImpact: 'Low' | 'Medium' | 'High';
  durability: 'Better' | 'Comparable' | 'Lower';
}

/** "Italian marble → Premium Indian marble: saves ₹4.2 lakh" — computed from real quantities and configurable rates. */
export function materialAlternativesFor(estimate: CostEstimate, settings: CostSettings): MaterialAlternative[] {
  const byMat = new Map<string, number>();
  for (const l of estimate.takeoff.lines) {
    if (!l.materialId || l.directCost !== undefined) continue;
    if (l.category !== 'Floor finishes' && l.category !== 'Wall finishes' && l.category !== 'Exterior finishes' && l.category !== 'Roofing') continue;
    byMat.set(l.materialId, (byMat.get(l.materialId) ?? 0) + l.quantity);
  }
  const out: MaterialAlternative[] = [];
  for (const [id, qty] of byMat) {
    const cur = getMaterial(id);
    const slot = cur.slots.includes('floor') ? 'floor' : cur.slots.includes('roof') ? 'roof' : cur.slots.includes('exterior') ? 'exterior' : 'wall';
    const cr = rateFor(cur, settings);
    for (const alt of materialAlternatives(id, slot).slice(0, 6)) {
      const ar = rateFor(alt, settings);
      const saving = ((cr.material + cr.labour) - (ar.material + ar.labour)) * qty * settings.fxPerInr;
      if (saving <= 0) continue;
      const sameFamily = alt.category === cur.category;
      const colorDelta = colorDistance(cur.color, alt.color);
      out.push({
        current: cur, alternative: alt, quantity: qty, saving,
        visualImpact: sameFamily && colorDelta < 40 ? 'Low' : colorDelta < 90 ? 'Medium' : 'High',
        durability: alt.durability > cur.durability ? 'Better' : alt.durability === cur.durability ? 'Comparable' : 'Lower',
      });
    }
  }
  return out.sort((a, b) => b.saving - a.saving);
}

function colorDistance(a: string, b: string) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
