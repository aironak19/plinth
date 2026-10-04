/// <reference lib="webworker" />
/**
 * Generative design runs off the main thread: many schemes are generated,
 * built into full models and scored without ever blocking the editor.
 */
import { generateSchemes, type Program, type Strategy } from '../core/generate/layout';
import { scoreBuilding, type MetricId } from '../core/generate/score';
import { resolveRules } from '../core/rules/rulesets';
import type { ProjectDoc } from '../core/model/types';

interface Req { id: number; doc: ProjectDoc; program: Program; weights: Partial<Record<MetricId, number>>; count: number }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, doc, program, weights, count } = e.data;
  const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides);
  const strategies: Strategy[] = ['courtyard', 'linear', 'compact'];
  const results = [];
  for (let i = 0; i < count; i++) {
    const strat = strategies[i % 3];
    const variant = { ...program, bedrooms: program.bedrooms };
    const [scheme] = generateSchemes(doc.site, variant, [strat], i * 13 + 1);
    const scratch: ProjectDoc = { ...doc, site: { ...doc.site, features: Object.fromEntries(scheme.features.map((f) => [f.id, f])) }, options: [{ ...doc.options[0], building: scheme.building }], activeOptionId: doc.options[0].id };
    const score = scoreBuilding(scratch, scheme.building, rules, weights);
    results.push({ scheme: { ...scheme, name: `${scheme.name} ${String.fromCharCode(65 + Math.floor(i / 3))}${(i % 3) + 1}` }, score });
    (self as unknown as Worker).postMessage({ id, progress: (i + 1) / count });
  }
  results.sort((a, b) => b.score.total - a.score.total);
  (self as unknown as Worker).postMessage({ id, done: true, results });
};
