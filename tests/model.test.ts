import { describe, it, expect } from 'vitest';
import { auraVilla } from '@/core/generate/auraVilla';
import { applyOps } from '@/core/ops';
import { activeBuilding, levelsSorted } from '@/core/model/query';
import { deriveLevel } from '@/core/derive/level';
import { computeTakeoff } from '@/core/derive/quantities';
import { resolveRules } from '@/core/rules/rulesets';
import { ft } from '@/core/units';
import { interpret } from '@/core/ai/intent';
import { computeImpact } from '@/core/ai/impact';

const rules = resolveRules('in-generic');
const roomByName = (doc: ReturnType<typeof auraVilla>, name: string) => {
  const b = activeBuilding(doc);
  return levelsSorted(b).flatMap((l) => deriveLevel(b, l.id).rooms).find((r) => r.name === name)!;
};

describe('parametric propagation', () => {
  it('widening a bedroom moves walls, neighbours, openings and quantities together', () => {
    const doc = auraVilla();
    const before = roomByName(doc, 'Bedroom 2');
    const neighbour = roomByName(doc, 'Bath 2');
    const qBefore = computeTakeoff(doc, activeBuilding(doc), rules).summary;
    const res = applyOps(doc, [{ type: 'room.resize', params: { id: before.tagId, axis: 'x', size: before.width + ft(2), anchor: 'min' } }], { actor: 'u-ronak', role: 'owner' });
    const after = roomByName(res.doc, 'Bedroom 2');
    const nAfter = roomByName(res.doc, 'Bath 2');
    expect(after.width - before.width).toBeCloseTo(ft(2), 0);
    expect(after.area).toBeGreaterThan(before.area);
    // the bath beyond the moved wall keeps its size but shifts east
    expect(nAfter.area).toBeCloseTo(neighbour.area, -3);
    expect(nAfter.bbox.minX - neighbour.bbox.minX).toBeCloseTo(ft(2), 0);
    // doors stay inside their walls; activity + version summary recorded
    const b = activeBuilding(res.doc);
    for (const d of Object.values(b.doors)) {
      const w = b.walls[d.wallId];
      expect(d.offset + d.width / 2).toBeLessThanOrEqual(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) + 1);
    }
    expect(res.doc.activity[0].summary).toMatch(/Bedroom 2 width/);
    expect(res.doc.pendingChanges.at(-1)).toMatch(/Bedroom 2 width/);
    const qAfter = computeTakeoff(res.doc, b, rules).summary;
    expect(qAfter.floorArea).toBeGreaterThan(qBefore.floorArea);
    // undo via inverse patches restores the original
    expect(res.inverse.length).toBeGreaterThan(0);
  });

  it('changing level height lifts the levels above', () => {
    const doc = auraVilla();
    const [g, f] = levelsSorted(activeBuilding(doc));
    const res = applyOps(doc, [{ type: 'level.update', params: { id: g.id, patch: { height: g.height + 300 } } }], { actor: 'u-ronak', role: 'owner' });
    expect(activeBuilding(res.doc).levels[f.id].elevation).toBe(f.elevation + 300);
  });

  it('enforces permissions', () => {
    const doc = auraVilla();
    const r = roomByName(doc, 'Kitchen');
    expect(() => applyOps(doc, [{ type: 'room.update', params: { id: r.tagId, patch: { name: 'X' } } }], { actor: 'u-client', role: 'client' })).toThrow();
    expect(() => applyOps(doc, [{ type: 'comment.add', params: { body: 'Love it' } }], { actor: 'u-client', role: 'client' })).not.toThrow();
  });
});

describe('Architect AI', () => {
  it('turns “make the master bedroom larger” into a previewable resize', () => {
    const doc = auraVilla();
    const p = interpret('Make the master bedroom larger', doc);
    expect(p.kind).toBe('change');
    expect(p.ops?.[0].type).toBe('room.resize');
    const impact = computeImpact(doc, p.ops!);
    expect(impact.ok).toBe(true);
    expect(impact.lines.join(' ')).toMatch(/Master Bedroom increases/);
    // nothing was applied to the real doc
    expect(roomByName(doc, 'Master Bedroom').area).toBeLessThan(roomByName(impact.preview!, 'Master Bedroom').area);
  });
  it('adds a powder room near the living room', () => {
    const doc = auraVilla();
    const p = interpret('Add a powder room near the living room', doc);
    expect(p.ops?.[0].type).toBe('room.carve');
    const impact = computeImpact(doc, p.ops!);
    expect(impact.ok).toBe(true);
    expect(impact.lines.join(' ')).toMatch(/Powder Room added/);
  });
  it('answers questions from the model', () => {
    const doc = auraVilla();
    expect(interpret('How much floor area is currently used?', doc).message).toMatch(/Built-up area/);
    expect(interpret('Show rooms smaller than 100 sq ft', doc).highlight!.length).toBeGreaterThan(3);
    expect(interpret('Find conflicts in this design', doc).title).toMatch(/Design health/);
  });
  it('applies styles as controlled transformations', () => {
    const doc = auraVilla();
    const p = interpret('Give me a more mediterranean facade', doc);
    const res = applyOps(doc, p.ops!, { actor: 'u-ronak', role: 'owner' });
    const roof = Object.values(activeBuilding(res.doc).roofs)[0];
    expect(roof.kind).toBe('hip');
    expect(Object.keys(activeBuilding(res.doc).walls).length).toBe(Object.keys(activeBuilding(doc).walls).length);
  });
  it('generates concept schemes from a brief', () => {
    const doc = auraVilla();
    const p = interpret('Create a 4 bedroom villa on a 40 × 60 ft plot. Ground + 1, pooja room, 2-car parking, garden, swimming pool, south-facing entrance', doc);
    expect(p.kind).toBe('options');
    expect(p.schemes).toHaveLength(3);
    expect(p.siteOps?.[0].type).toBe('site.update');
  });
});
