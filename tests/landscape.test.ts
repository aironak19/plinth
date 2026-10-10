import { describe, it, expect } from 'vitest';
import { applyOps } from '@/core/ops';
import { defaultMeta, newProjectDoc, makeLevel, rectSite } from '@/core/model/factory';
import { activeBuilding, emptyBuilding } from '@/core/model/query';
import { deriveLevel } from '@/core/derive/level';
import { planLandscape, climateOf } from '@/core/generate/landscape';
import { pointInPolygon } from '@/core/geometry/polygon';
import { ASSET_BY_ID } from '@/core/catalog/assets';
import { PLANTS, LANDSCAPE_STYLES } from '@/core/catalog/plants';
import { BLOCKS } from '@/core/catalog/blocks';
import { buildSolids } from '@/core/derive/solids';
import { resolveRules } from '@/core/rules/rulesets';
import { ft } from '@/core/units';
import type { ProjectDoc } from '@/core/model/types';

const OWNER = { actor: 'u-ronak', role: 'owner' as const };

function villa(): { doc: ProjectDoc; levelId: string } {
  const b = emptyBuilding();
  const g = makeLevel({ name: 'Ground Floor', elevation: 450, slabThickness: 450, order: 0 });
  b.levels[g.id] = g;
  let doc = newProjectDoc(defaultMeta({ name: 'Garden' }), rectSite(ft(70), ft(100), { front: 3000, side: 1500, rear: 1500 }), b);
  doc = applyOps(doc, [{ type: 'block.place', params: { blockId: 'kit-2bhk', size: 'M', levelId: g.id, x: ft(17), y: ft(30) } }], OWNER).doc;
  return { doc, levelId: g.id };
}

describe('plant and outdoor catalogue', () => {
  it('every plant is a placeable asset with a sane horticultural record', () => {
    expect(PLANTS.length).toBeGreaterThan(60);
    for (const p of PLANTS) {
      const a = ASSET_BY_ID[`plant-${p.id}`];
      expect(a?.plant, p.id).toBe(p);
      expect(p.botanical).toMatch(/^[A-Z][a-z]+ /);
      expect(p.height).toBeGreaterThan(100);
      expect(p.spread).toBeGreaterThan(100);
      expect(p.spacing).toBeGreaterThan(0);
      expect(p.climates.length).toBeGreaterThan(0);
    }
    expect(new Set(PLANTS.map((p) => p.id)).size).toBe(PLANTS.length);
  });

  it('every asset a landscape block refers to exists', () => {
    for (const def of BLOCKS) for (const size of def.sizes) for (const pr of size.props ?? []) expect(ASSET_BY_ID[pr.asset], `${def.id} → ${pr.asset}`).toBeTruthy();
  });
});

describe('landscape features', () => {
  it('hedges, fences, walls and surfaces become solid geometry and move as one', () => {
    const { doc } = villa();
    let d = applyOps(doc, [
      { type: 'site.feature.create', params: { kind: 'hedge', name: 'Hedge', path: [{ x: 1000, y: 1000 }, { x: 9000, y: 1000 }, { x: 9000, y: 6000 }], props: { height: 1200 } } },
      { type: 'site.feature.create', params: { kind: 'wall', name: 'Garden wall', path: [{ x: 1000, y: 8000 }, { x: 6000, y: 8000 }], props: {} } },
      { type: 'site.feature.create', params: { kind: 'pond', name: 'Pond', polygon: [{ x: 2000, y: 2000 }, { x: 5000, y: 2000 }, { x: 5000, y: 4000 }, { x: 2000, y: 4000 }], props: {} } },
      { type: 'site.feature.create', params: { kind: 'bed', name: 'Bed', polygon: [{ x: 12000, y: 2000 }, { x: 15000, y: 2000 }, { x: 15000, y: 3000 }, { x: 12000, y: 3000 }], materialId: 'mulch', props: {} } },
    ], OWNER).doc;
    const solids = buildSolids(d, activeBuilding(d), resolveRules('in-generic'));
    const hedge = Object.values(d.site.features).find((f) => f.kind === 'hedge')!;
    expect(solids.filter((s) => s.ref?.id === hedge.id && s.layer === 'landscape').length).toBe(2);
    expect(solids.some((s) => s.materialId === 'pond-water')).toBe(true);
    expect(solids.some((s) => s.id.startsWith('coping-'))).toBe(true);
    expect(solids.some((s) => s.id.startsWith('edge-'))).toBe(true);
    d = applyOps(d, [{ type: 'element.move', params: { refs: [{ kind: 'siteFeature', id: hedge.id }], delta: { x: 500, y: 0 } } }], OWNER).doc;
    expect(d.site.features[hedge.id].path![0]).toEqual({ x: 1500, y: 1000 });
  });
});

describe('landscape my plot', () => {
  for (const { id: style } of LANDSCAPE_STYLES) {
    it(`${style}: lays a complete, valid garden`, () => {
      const { doc, levelId } = villa();
      const plan = planLandscape(doc, style);
      expect(plan.ops.length).toBeGreaterThan(10);
      const out = applyOps(doc, plan.ops, OWNER).doc;
      const b = activeBuilding(out);
      const plot = out.site.boundary;
      const footprint = deriveLevel(b, levelId).footprint;
      const auto = Object.values(b.furniture).filter((f) => f.props.auto);
      const plants = auto.filter((f) => ASSET_BY_ID[f.assetId]?.plant);
      expect(plants.length).toBeGreaterThan(8);
      for (const f of auto) {
        expect(pointInPolygon(f.position, plot), `${f.assetId} outside the plot`).toBe(true);
        if (ASSET_BY_ID[f.assetId]?.plant) expect(footprint.some((fp) => pointInPolygon(f.position, fp)), `${f.assetId} inside the house`).toBe(false);
      }
      // Species suit the project's climate (Mumbai → tropical).
      const climate = climateOf(out);
      const wrong = plants.filter((f) => !ASSET_BY_ID[f.assetId].plant!.climates.includes(climate));
      expect(wrong.length / plants.length, wrong.map((f) => f.assetId).join(', ')).toBeLessThan(0.15);
      const feats = Object.values(out.site.features);
      expect(feats.some((f) => f.kind === 'wall' && f.path && f.path.length > 3)).toBe(true);
      expect(feats.some((f) => f.kind === 'pathway')).toBe(true);
      expect(auto.some((f) => f.assetId === 'gate-main')).toBe(true);
      // Running it again replaces the generated garden instead of stacking a second one.
      const again = applyOps(out, planLandscape(out, style).ops, OWNER).doc;
      expect(Object.values(activeBuilding(again).furniture).filter((f) => f.props.auto).length).toBe(auto.length);
      expect(Object.values(again.site.features).length).toBe(feats.length);
    });
  }

  it('leaves hand-placed landscape alone', () => {
    const { doc, levelId } = villa();
    const mine = applyOps(doc, [{ type: 'furniture.create', params: { levelId, assetId: 'plant-mango', position: { x: 2500, y: 2500 } } }], OWNER).doc;
    const out = applyOps(mine, planLandscape(mine, 'indian').ops, OWNER).doc;
    expect(Object.values(activeBuilding(out).furniture).some((f) => f.assetId === 'plant-mango' && !f.props.auto)).toBe(true);
  });
});

describe('Architect AI — landscape', () => {
  it('designs the whole plot, plants a row on a named side and encloses the boundary', async () => {
    const { interpret } = await import('@/core/ai/intent');
    const { doc, levelId } = villa();
    const whole = interpret('Landscape the plot in a zen style', doc, [], levelId);
    expect(whole.kind).toBe('change');
    expect(whole.title).toMatch(/Zen/);
    expect(whole.ops!.length).toBeGreaterThan(10);

    const row = interpret('plant 4 royal palms along the west boundary', doc, [], levelId);
    expect(row.kind, row.message).toBe('change');
    expect(row.ops).toHaveLength(4);
    expect(row.ops!.every((o) => o.params.assetId === 'plant-royal-palm')).toBe(true);
    const xs = row.ops!.map((o) => (o.params.position as { x: number }).x);
    expect(Math.max(...xs)).toBeLessThan(ft(70) / 3);

    const one = interpret('add a mango tree', doc, [], levelId);
    expect(one.ops?.[0].params.assetId).toBe('plant-mango');

    const hedge = interpret('add a hedge around the plot', doc, [], levelId);
    expect(hedge.ops?.[0].type).toBe('site.feature.create');
    expect(hedge.ops?.[0].params.kind).toBe('hedge');

    const patio = interpret('add a pergola sit-out', doc, [], levelId);
    expect(patio.kind, patio.message).toBe('change');
    expect(patio.ops?.[0].params.blockId).toBe('sit-out');

    // Rooms and parking still route to the right intents.
    expect(interpret('add 2 car parking', doc, [], levelId).ops?.[0].params.blockId).toBe('car-parking');
    expect(interpret('Make the living room 2 ft wider', doc, [], levelId).title).not.toMatch(/plant/i);
  });
});
