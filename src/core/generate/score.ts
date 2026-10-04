/**
 * Generative-design scoring. Each metric is computed from the derived model and
 * normalised to 0–100 so designers can weight what matters to them.
 */
import type { BuildingModel, ProjectDoc } from '../model/types';
import type { RuleSet } from '../rules/rulesets';
import { analyzeSite } from '../derive/site';
import { daylightAnalysis, HABITABLE } from '../derive/analysis';
import { levelsSorted } from '../model/query';
import { deriveLevel } from '../derive/level';
import { estimateCost } from '../derive/cost';
import { validate } from '../derive/validation';

export const METRICS = [
  { id: 'light', label: 'Natural light', goal: 'max' },
  { id: 'garden', label: 'Garden area', goal: 'max' },
  { id: 'privacy', label: 'Privacy', goal: 'max' },
  { id: 'efficiency', label: 'Usable floor area', goal: 'max' },
  { id: 'corridor', label: 'Low corridor area', goal: 'min' },
  { id: 'cost', label: 'Low construction cost', goal: 'min' },
  { id: 'heat', label: 'Low heat gain', goal: 'min' },
  { id: 'health', label: 'Design health', goal: 'max' },
] as const;

export type MetricId = (typeof METRICS)[number]['id'];

export interface SchemeScore { metrics: Record<MetricId, number>; raw: { costPerSqft: number; carpet: number; builtUp: number; openRatio: number; health: number; total: number } ; total: number }

export function scoreBuilding(doc: ProjectDoc, b: BuildingModel, rules: RuleSet, weights: Partial<Record<MetricId, number>> = {}): SchemeScore {
  const site = analyzeSite(doc, b, rules);
  const day = daylightAnalysis(doc, b).filter((d) => HABITABLE.includes(d.fn));
  const light = day.length ? day.reduce((s, d) => s + d.score, 0) / day.length : 0;
  const levels = levelsSorted(b);
  const rooms = levels.flatMap((l) => deriveLevel(b, l.id).rooms);
  const carpet = rooms.reduce((s, r) => s + r.area, 0);
  const corridor = rooms.filter((r) => r.fn === 'corridor' || r.fn === 'foyer').reduce((s, r) => s + r.area, 0);
  const beds = rooms.filter((r) => r.fn === 'bedroom' || r.fn === 'master_bedroom');
  const front = Math.min(...doc.site.boundary.map((p) => p.y));
  const depth = Math.max(...doc.site.boundary.map((p) => p.y)) - front || 1;
  const privacy = beds.length ? beds.reduce((s, r) => {
    const upper = levels.findIndex((l) => l.id === r.levelId) > 0 ? 0.6 : 0;
    return s + Math.min(1, upper + ((r.labelPoint.y - front) / depth) * 0.8);
  }, 0) / beds.length * 100 : 50;
  const west = day.reduce((s, d) => s + d.westGlazing, 0);
  const glaze = day.reduce((s, d) => s + d.glazingArea, 0) || 1;
  const cost = estimateCost(doc, b, rules);
  const health = validate(doc, b, rules).score;
  const metrics: Record<MetricId, number> = {
    light: Math.round(light),
    garden: Math.round(Math.min(100, (site.openArea / site.plotArea) * 130)),
    privacy: Math.round(privacy),
    efficiency: Math.round(Math.min(100, site.builtUpArea ? (carpet / site.builtUpArea) * 115 : 0)),
    corridor: Math.round(Math.max(0, 100 - (carpet ? (corridor / carpet) * 600 : 0))),
    cost: Math.round(Math.max(0, Math.min(100, 100 - (cost.perSqft - 2500) / 40))),
    heat: Math.round(Math.max(0, 100 - (west / glaze) * 160)),
    health,
  };
  const wsum = METRICS.reduce((s, m) => s + (weights[m.id] ?? 1), 0) || 1;
  const total = Math.round(METRICS.reduce((s, m) => s + metrics[m.id] * (weights[m.id] ?? 1), 0) / wsum);
  return { metrics, total, raw: { costPerSqft: cost.perSqft, carpet, builtUp: site.builtUpArea, openRatio: site.openArea / site.plotArea, health, total: cost.grandTotal } };
}
