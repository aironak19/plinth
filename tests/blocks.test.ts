import { describe, it, expect } from 'vitest';
import { applyOps } from '@/core/ops';
import { findAttachPosition } from '@/core/ops/blocks';
import { analyzeBlock, layoutBlock, siteSnapRings, snapBlock } from '@/core/generate/blocks';
import { bbox } from '@/core/geometry/polygon';
import { analyzeSite } from '@/core/derive/site';
import { BLOCKS } from '@/core/catalog/blocks';
import { defaultMeta, newProjectDoc, makeLevel, rectSite } from '@/core/model/factory';
import { activeBuilding, emptyBuilding } from '@/core/model/query';
import { deriveLevel } from '@/core/derive/level';
import { validate } from '@/core/derive/validation';
import { resolveRules } from '@/core/rules/rulesets';
import { ft } from '@/core/units';
import type { ProjectDoc } from '@/core/model/types';

function blank(): { doc: ProjectDoc; levelId: string } {
  const b = emptyBuilding();
  const g = makeLevel({ name: 'Ground Floor', elevation: 450, slabThickness: 450, order: 0 });
  const f = makeLevel({ name: 'First Floor', elevation: 3650, order: 1 });
  b.levels[g.id] = g; b.levels[f.id] = f;
  const doc = newProjectDoc(defaultMeta({ name: 'Blocks' }), rectSite(ft(100), ft(120), { front: 3000, side: 1500, rear: 1500 }), b);
  return { doc, levelId: g.id };
}
const run = (doc: ProjectDoc, type: string, params: Record<string, unknown>) => applyOps(doc, [{ type, params }], { actor: 'u-ronak', role: 'owner' }).doc;

describe('ready-made blocks', () => {
  for (const def of BLOCKS) for (const size of def.sizes) for (const rotation of def.kit ? [0] : [0, 90, 180, 270]) {
    it(`${def.id} ${size.id} @${rotation}° places cleanly`, () => {
      const { doc, levelId } = blank();
      const next = run(doc, 'block.place', { blockId: def.id, size: size.id, levelId, x: ft(20), y: ft(20), rotation });
      const b = activeBuilding(next);
      if (def.siteOnly) { expect(Object.keys(next.site.features).length).toBeGreaterThan(0); return; }
      const dl = deriveLevel(b, levelId);
      const expected = def.kit ? 3 : size.parts.length;
      expect(dl.rooms.filter((r) => r.tagId).length).toBeGreaterThanOrEqual(expected);
      expect(dl.orphanTags).toHaveLength(0);
      const h = validate(next, b, resolveRules('in-generic'));
      const bad = h.issues.filter((i) => i.severity === 'error' && !/entrance|No access|leads nowhere/i.test(i.title + i.detail));
      expect(bad.map((i) => `${i.title}: ${i.detail}`)).toEqual([]);
      const warn = h.issues.filter((i) => i.severity === 'warning' && /narrow|below minimum|Overlapping|overlaps|extends beyond|taller/i.test(i.title));
      expect(warn.map((i) => `${i.title}: ${i.detail}`)).toEqual([]);
    });
  }

  it('attaches a bedroom suite to a living room: shared wall, connecting door, no duplicates', () => {
    const { doc, levelId } = blank();
    let d = run(doc, 'block.place', { blockId: 'living', size: 'M', levelId, x: ft(30), y: ft(30) });
    const living = Object.values(activeBuilding(d).rooms)[0];
    const pos = findAttachPosition(activeBuilding(d), levelId, living.id, 'bedroom-bath', 'M', d.site.boundary)!;
    expect(pos).not.toBeNull();
    d = applyOps(d, [{ type: 'block.place', params: { blockId: 'bedroom-bath', size: 'M', levelId, ...pos } }], { actor: 'u-ronak', role: 'owner' }).doc;
    const b = activeBuilding(d);
    const dl = deriveLevel(b, levelId);
    const bed = dl.rooms.find((r) => r.name === 'Bedroom')!;
    const liv = dl.rooms.find((r) => r.name === 'Living Room')!;
    expect(bed.doorIds.some((id) => liv.doorIds.includes(id))).toBe(true);
    const h = validate(d, b, resolveRules('in-generic'));
    expect(h.issues.filter((i) => /Overlapping walls|overlaps/.test(i.title))).toEqual([]);
    expect(d.activity[0].summary).toMatch(/connected to Living Room/);
  });

  it('refuses to drop a block on top of a room', () => {
    const { doc, levelId } = blank();
    const d = run(doc, 'block.place', { blockId: 'living', size: 'M', levelId, x: ft(30), y: ft(30) });
    expect(() => run(d, 'block.place', { blockId: 'bedroom', size: 'M', levelId, x: ft(32), y: ft(32) })).toThrow();
  });

  it('snaps a car bay flush against the outer wall face, counts the cars', () => {
    const { doc, levelId } = blank();
    const d = run(doc, 'block.place', { blockId: 'living', size: 'M', levelId, x: ft(30), y: ft(30) });
    const b = activeBuilding(d);
    const fp = bbox(deriveLevel(b, levelId).footprint[0]);
    const lay = layoutBlock('car-parking', 'M', 0, 0, 0);
    // Cursor just left of the house, slightly overlapping the wall.
    const sn = snapBlock(b, levelId, lay.w, lay.d, { x: fp.minX - lay.w / 2 + 200, y: fp.minY + lay.d / 2 }, 600, siteSnapRings(b, d.site.boundary));
    expect(sn.x + lay.w).toBeCloseTo(fp.minX, 0);
    const pl = layoutBlock('car-parking', 'M', sn.x, sn.y, 0);
    expect(analyzeBlock(b, levelId, pl).ok).toBe(true);
    const done = run(d, 'block.place', { blockId: 'car-parking', size: 'M', levelId, x: sn.x, y: sn.y });
    expect(analyzeSite(done, activeBuilding(done), resolveRules('in-generic')).parkingProvided).toBe(2);
    const bikes = run(done, 'block.place', { blockId: 'two-wheeler', size: 'M', levelId, x: ft(80), y: ft(5) });
    expect(analyzeSite(bikes, activeBuilding(bikes), resolveRules('in-generic')).parkingProvided).toBe(2);
  });
});

describe('Architect AI with blocks', () => {
  it('understands parking by car count and finds a free spot on the plot', async () => {
    const { interpret } = await import('@/core/ai/intent');
    const { doc, levelId } = blank();
    const d = run(doc, 'block.place', { blockId: 'kit-2bhk', size: 'M', levelId, x: ft(30), y: ft(40) });
    for (const [q, blockId, size, cars] of [['add 2 car parking', 'car-parking', 'M', 2], ['Add parking for 3 cars', 'car-parking', 'L', 3], ['add a 1 car parking', 'car-parking', 'S', 1], ['add tandem parking', 'tandem-parking', undefined, 2]] as const) {
      const p = interpret(q, d, [], levelId);
      expect(p.kind, `${q}: ${p.message}`).toBe('change');
      const op = p.ops![0];
      expect(op.params.blockId).toBe(blockId);
      if (size) expect(op.params.size).toBe(size);
      const next = applyOps(d, p.ops!, { actor: 'u-ronak', role: 'owner' }).doc;
      expect(analyzeSite(next, activeBuilding(next), resolveRules('in-generic')).parkingProvided).toBe(cars);
    }
  });

  it('adds a master suite next to the landing as a previewable change', async () => {
    const { auraVilla } = await import('@/core/generate/auraVilla');
    const { interpret } = await import('@/core/ai/intent');
    const { computeImpact } = await import('@/core/ai/impact');
    const doc = auraVilla();
    const first = Object.values(activeBuilding(doc).levels).sort((a, b) => a.order - b.order)[1];
    const p = interpret('Add a balcony next to bedroom 2', doc, [], first.id);
    expect(p.ops?.[0].type).toBe('block.place');
    const imp = computeImpact(doc, p.ops!);
    expect(imp.ok).toBe(true);
    expect(imp.lines.join(' ')).toMatch(/Balcony added/);
  });
  it('places a whole-home kit on an empty site', async () => {
    const { interpret } = await import('@/core/ai/intent');
    const { doc, levelId } = blank();
    const p = interpret('Add a 3bhk home', doc, [], levelId);
    expect(p.ops?.[0].params).toMatchObject({ blockId: 'kit-3bhk' });
  });
});
