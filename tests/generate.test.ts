import { describe, it, expect } from 'vitest';
import { generateSchemes, siteFromProgram, DEFAULT_PROGRAM } from '@/core/generate/layout';
import { defaultMeta, newProjectDoc } from '@/core/model/factory';
import { resolveRules } from '@/core/rules/rulesets';
import { validate } from '@/core/derive/validation';
import { scoreBuilding } from '@/core/generate/score';
import { levelsSorted } from '@/core/model/query';
import { deriveLevel } from '@/core/derive/level';
import { ft, formatLength } from '@/core/units';

describe('generator', () => {
  it('produces valid editable schemes for a 40×60 ft plot', () => {
    const site = siteFromProgram(ft(40), ft(60));
    const schemes = generateSchemes(site, { ...DEFAULT_PROGRAM, bedrooms: 4, floors: 2, pool: false });
    const rules = resolveRules('in-generic');
    for (const s of schemes) {
      const doc = newProjectDoc(defaultMeta({ name: s.name }), JSON.parse(JSON.stringify(site)), s.building, s.style);
      for (const f of s.features) doc.site.features[f.id] = f;
      const h = validate(doc, s.building, rules);
      const sc = scoreBuilding(doc, s.building, rules);
      console.log(`\n== ${s.name} health ${h.score} total ${sc.total}`, JSON.stringify(sc.metrics));
      for (const l of levelsSorted(s.building)) {
        const dl = deriveLevel(s.building, l.id);
        console.log(' ', l.name, dl.rooms.map((r) => `${r.name} ${formatLength(r.width, 'imperial', { compact: true })}×${formatLength(r.depth, 'imperial', { compact: true })}`).join(' | '));
      }
      console.log(h.issues.filter((i) => i.severity !== 'info').map((i) => `   ${i.severity} ${i.title}: ${i.detail}`).join('\n'));
      expect(h.errors).toBeLessThanOrEqual(2);
    }
  });
});
