import { describe, it, expect } from 'vitest';
import { auraVilla } from '@/core/generate/auraVilla';
import { activeBuilding, levelsSorted } from '@/core/model/query';
import { deriveLevel } from '@/core/derive/level';
import { validate } from '@/core/derive/validation';
import { estimateCost } from '@/core/derive/cost';
import { resolveRules } from '@/core/rules/rulesets';
import { analyzeSite } from '@/core/derive/site';
import { buildSolids } from '@/core/derive/solids';
import { formatArea, formatLength, formatMoneyCompact } from '@/core/units';

describe('smoke', () => {
  it('aura villa derives', () => {
    const doc = auraVilla();
    const b = activeBuilding(doc);
    const rules = resolveRules(doc.meta.ruleSetId);
    for (const l of levelsSorted(b)) {
      const dl = deriveLevel(b, l.id);
      console.log(l.name, 'walls', dl.walls.length, 'rooms', dl.rooms.length, 'orphans', dl.orphanTags.map(t=>t.name), 'gross', formatArea(dl.grossArea,'imperial'));
      for (const r of dl.rooms) console.log('  ', r.name, formatLength(r.width,'imperial'), '×', formatLength(r.depth,'imperial'), formatArea(r.area,'imperial'), 'doors', r.doorIds.length, 'win', r.windowIds.length);
    }
    const site = analyzeSite(doc, b, rules);
    console.log('plot', formatArea(site.plotArea,'imperial'), 'coverage', site.coverage.toFixed(3), 'far', site.far.toFixed(2), site.setbacks.map(s=>`${s.kind}:${formatLength(s.actual,'imperial')}/${formatLength(s.required,'imperial')}`).join(' '));
    const h = validate(doc, b, rules);
    console.log('health', h.score, h.issues.map(i=>`${i.severity}|${i.category}|${i.title}|${i.detail}`).join('\n'));
    const c = estimateCost(doc, b, rules);
    console.log('cost', formatMoneyCompact(c.grandTotal,'INR'), 'per sqft', Math.round(c.perSqft), c.byCategory.map(x=>`${x.category}:${formatMoneyCompact(x.total,'INR')}`).join(', '));
    const solids = buildSolids(doc, b, rules);
    console.log('solids', solids.length, 'faces', solids.reduce((s,x)=>s+x.faces.length,0));
    expect(h.score).toBeGreaterThan(50);
  });
});
