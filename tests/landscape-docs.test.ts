import { describe, it, expect } from 'vitest';
import { applyOps } from '@/core/ops';
import { defaultMeta, newProjectDoc, makeLevel, rectSite } from '@/core/model/factory';
import { activeBuilding, emptyBuilding } from '@/core/model/query';
import { resolveRules } from '@/core/rules/rulesets';
import { analyzeLandscape, climateOf, landscapeKeys, speciesKeys, suitsClimate } from '@/core/derive/landscape';
import { analyzeSite } from '@/core/derive/site';
import { estimateCost } from '@/core/derive/cost';
import { LANDSCAPE_RATES } from '@/core/derive/quantities';
import { validate, type Issue } from '@/core/derive/validation';
import { buildSheetSet, renderSheet } from '@/core/docs/sheets';
import { drawLandscapePlan, drawSitePlan } from '@/core/docs/drawings';
import { hardscapeSchedule, plantingSchedule } from '@/core/docs/schedules';
import { PLANT_BY_ID, weeklyWater } from '@/core/catalog/plants';
import type { ProjectDoc, SiteFeature } from '@/core/model/types';

const rules = resolveRules('in-generic');
const run = (doc: ProjectDoc, type: string, params: Record<string, unknown>) => applyOps(doc, [{ type, params }], { actor: 'u-ronak', role: 'owner' }).doc;
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const feature = (doc: ProjectDoc, f: Partial<SiteFeature> & { kind: string; name: string }) => run(doc, 'site.feature.create', f);
const byName = (doc: ProjectDoc, name: string) => Object.values(doc.site.features).find((f) => f.name === name)!;
const ground = (doc: ProjectDoc) => Object.values(activeBuilding(doc).levels).find((l) => l.order === 0)!.id;
const place = (doc: ProjectDoc, assetId: string, x: number, y: number) => run(doc, 'furniture.create', { levelId: ground(doc), assetId, position: { x, y } });
const landscapeIssues = (doc: ProjectDoc): Issue[] => validate(doc, activeBuilding(doc), rules).issues.filter((i) => i.category === 'Landscape');
const titles = (doc: ProjectDoc) => landscapeIssues(doc).map((i) => i.title);

/** 30 m × 40 m plot in Mumbai with one 10 m × 8 m room (walls on the centre-lines, 230 thick). */
function house(): ProjectDoc {
  const b = emptyBuilding();
  const g = makeLevel({ name: 'Ground Floor', elevation: 450, order: 0 });
  b.levels[g.id] = g;
  const doc = newProjectDoc(defaultMeta({ name: 'Garden House', units: 'metric' }), rectSite(30000, 40000, { front: 3000, side: 1500, rear: 1500 }), b);
  return run(doc, 'room.create', { levelId: g.id, x: 10000, y: 15000, w: 10000, h: 8000, name: 'Living Room', fn: 'living' });
}

/** The house with a full, well-behaved garden: every number below can be checked by hand. */
function garden(): ProjectDoc {
  let d = house();
  d = feature(d, { kind: 'patio', name: 'Patio', polygon: rect(11000, 9000, 5000, 4000) }); // 20 m², sandstone by default
  d = feature(d, { kind: 'driveway', name: 'Drive', polygon: rect(24000, 1000, 3000, 10000), materialId: 'grass-paver' }); // 30 m²
  d = feature(d, { kind: 'gravel', name: 'Gravel strip', polygon: rect(1000, 1000, 2000, 5000) }); // 10 m²
  d = feature(d, { kind: 'deck', name: 'Deck', polygon: rect(11000, 24000, 4000, 3000) }); // 12 m²
  d = feature(d, { kind: 'bed', name: 'Shrub border', polygon: rect(2000, 30000, 6000, 2000) }); // 12 m²
  d = feature(d, { kind: 'pond', name: 'Pond', polygon: rect(2000, 20000, 2000, 2000) }); // 4 m²
  d = feature(d, { kind: 'pool', name: 'Pool', polygon: rect(20000, 28000, 8000, 4000) }); // 32 m²
  d = feature(d, { kind: 'hedge', name: 'Rear hedge', path: [{ x: 1000, y: 38000 }, { x: 11000, y: 38000 }] }); // 10 m
  d = feature(d, { kind: 'fence', name: 'Pool fence', path: [{ x: 19000, y: 27000 }, { x: 29000, y: 27000 }, { x: 29000, y: 33000 }, { x: 19000, y: 33000 }, { x: 19000, y: 27000 }] }); // 32 m
  d = feature(d, { kind: 'wall', name: 'Side wall', path: [{ x: 500, y: 500 }, { x: 500, y: 12500 }] }); // 12 m
  d = place(d, 'plant-neem', 5000, 10000);
  d = place(d, 'plant-neem', 25000, 20000);
  for (const x of [3000, 4000, 5000]) d = place(d, 'plant-ixora', x, 31000);
  d = place(d, 'lounger', 13000, 25500);
  d = place(d, 'pergola', 13500, 11000);
  d = place(d, 'path-light', 20000, 10000);
  return d;
}

const FOOTPRINT = 10.23 * 8.23; // outside faces of the 230 walls
const COPING = (8.7 * 4.7 - 32) + (2.44 * 2.44 - 4); // 350 mm round the pool, 220 mm round the pond
const LAWN = 1200 - FOOTPRINT - (20 + 30 + 10 + 12 + 12 + 4 + 32) - COPING;

/** Regex sanity check that SVG markup is well-formed (same rule as docs.test.ts). */
function assertWellFormed(svg: string) {
  expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) expect(stack.pop()).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
  expect((svg.match(/</g) ?? []).length).toBe((svg.match(re) ?? []).length);
}

describe('landscape analysis', () => {
  const doc = garden();
  const la = analyzeLandscape(doc, activeBuilding(doc));

  it('measures every surface and leaves the rest as lawn', () => {
    expect(la.plotArea).toBeCloseTo(1200, 6);
    expect(la.footprintArea).toBeCloseTo(FOOTPRINT, 3);
    expect(la.openArea).toBeCloseTo(1200 - FOOTPRINT, 3);
    expect(la.areas.paving).toBeCloseTo(50, 6); // patio + grass-paver drive
    expect(la.areas.gravel).toBeCloseTo(10, 6);
    expect(la.areas.decking).toBeCloseTo(12, 6);
    expect(la.areas.beds).toBeCloseTo(12, 6);
    expect(la.areas.pool).toBeCloseTo(32, 6);
    expect(la.areas.pond).toBeCloseTo(4, 6);
    expect(la.areas.water).toBeCloseTo(36, 6);
    expect(la.areas.coping).toBeCloseTo(COPING, 4);
    expect(la.areas.lawn).toBeCloseTo(LAWN, 3);
    expect(la.pavingByMaterial.map((p) => [p.materialId, Math.round(p.area)]).sort()).toEqual([['grass-paver', 30], ['sandstone-paving', 20]]);
    expect(la.coping.find((c) => c.kind === 'pool')).toMatchObject({ materialId: 'travertine', width: 350 });
    expect(la.coping.find((c) => c.kind === 'pool')!.length).toBeCloseTo(24, 6);
  });

  it('splits the open area into softscape, hardscape and pool water', () => {
    expect(la.softscape).toBeCloseTo(LAWN + 12 + 4, 3);
    expect(la.hardscape).toBeCloseTo(50 + 10 + 12 + COPING, 3);
    expect(la.softscape + la.hardscape + la.areas.pool).toBeCloseTo(la.openArea, 3);
    expect(la.softscapePct).toBeCloseTo(la.softscape / la.openArea, 9);
    expect(la.softscapePct + la.hardscapePct).toBeLessThan(1);
  });

  it('weights permeable ground by surface', () => {
    // lawn, bed and pond fully; gravel 0.7; grass pavers 0.5; timber deck 0.3; stone paving and coping 0.
    const expected = LAWN + 12 + 4 + 10 * 0.7 + 30 * 0.5 + 12 * 0.3;
    expect(la.permeableArea).toBeCloseTo(expected, 3);
    expect(la.permeablePct).toBeCloseTo(expected / 1200, 5);
  });

  it('counts plants by species, trees and canopy', () => {
    expect(la.plantCount).toBe(5);
    expect(la.treeCount).toBe(2);
    const neem = la.plants.find((p) => p.plant.id === 'neem')!;
    expect(neem).toMatchObject({ quantity: 2, unitPrice: PLANT_BY_ID.neem.price, total: 2 * PLANT_BY_ID.neem.price });
    expect(la.plants.find((p) => p.plant.id === 'ixora')!.quantity).toBe(3);
    const canopy = 2 * Math.PI * (PLANT_BY_ID.neem.spread / 2000) ** 2;
    expect(la.canopyArea).toBeCloseTo(canopy, 6);
    expect(la.canopyPct).toBeCloseTo(canopy / 1200, 6);
    expect(la.lights).toBe(1);
    expect(la.structures.map((s) => s.assetId).sort()).toEqual(['path-light', 'pergola']);
  });

  it('caps canopy cover at the plot area', () => {
    let d = house();
    for (let i = 0; i < 8; i++) d = place(d, 'plant-rain-tree', 25000, 5000 + i * 100); // 18 m spread each
    const crowded = analyzeLandscape(d, activeBuilding(d));
    expect(crowded.canopyArea).toBeCloseTo(1200, 6);
    expect(crowded.canopyPct).toBe(1);
  });

  it('measures hedges, fences and walls and counts hedge plants from the spacing', () => {
    const hedge = la.linear.find((l) => l.kind === 'hedge')!;
    expect(hedge.length).toBeCloseTo(10, 6);
    expect(hedge.species!.id).toBe('murraya');
    expect(hedge.plantCount).toBe(Math.ceil(10000 / PLANT_BY_ID.murraya.spacing)); // 20 at 500 mm
    expect(hedge.plantCount).toBe(20);
    const fence = la.linear.find((l) => l.kind === 'fence')!;
    expect(fence).toMatchObject({ closed: true, height: 1500 });
    expect(fence.length).toBeCloseTo(32, 6);
    const wall = la.linear.find((l) => l.kind === 'wall')!;
    expect(wall.length).toBeCloseTo(12, 6);
    expect(wall.faceArea).toBeCloseTo(12 * 1.8, 6);

    // A different species and an awkward length: 10.2 m of golden duranta at 300 mm → 34 plants.
    let d = run(doc, 'site.feature.update', { id: byName(doc, 'Rear hedge').id, patch: { props: { species: 'duranta' }, path: [{ x: 1000, y: 38000 }, { x: 11200, y: 38000 }] } });
    let h = analyzeLandscape(d, activeBuilding(d)).linear.find((l) => l.kind === 'hedge')!;
    expect(h.species!.id).toBe('duranta');
    expect(h.plantCount).toBe(34);
    // An unknown species falls back to the default rather than breaking the takeoff.
    d = run(doc, 'site.feature.update', { id: byName(doc, 'Rear hedge').id, patch: { props: { species: 'no-such-plant' } } });
    h = analyzeLandscape(d, activeBuilding(d)).linear.find((l) => l.kind === 'hedge')!;
    expect(h.species!.id).toBe('murraya');
  });

  it('adds up weekly and monthly irrigation', () => {
    const plants = 2 * weeklyWater(PLANT_BY_ID.neem) + 3 * weeklyWater(PLANT_BY_ID.ixora);
    expect(la.irrigation.plants).toBe(plants);
    expect(la.irrigation.lawn).toBeCloseTo(LAWN * 25, 1);
    expect(la.irrigation.beds).toBeCloseTo(12 * 15, 6);
    expect(la.irrigation.hedges).toBeCloseTo(10 * 0.6 * 15, 6); // 600 mm wide strip at the bed rate
    const weekly = Math.round(plants + LAWN * 25 + 180 + 90);
    expect(la.irrigation.weekly).toBe(weekly);
    expect(la.irrigation.monthly).toBe(Math.round((weekly * 52) / 12));
  });

  it('is exposed on the site analysis and survives an empty site', () => {
    const sa = analyzeSite(doc, activeBuilding(doc), rules);
    expect(sa.landscape.areas.lawn).toBeCloseTo(LAWN, 3);
    expect(sa.openArea).toBeGreaterThan(0); // existing fields untouched

    const bare = house();
    const e = analyzeLandscape(bare, activeBuilding(bare));
    expect(e.hasLandscape).toBe(false);
    expect(e.areas.lawn).toBeCloseTo(1200 - FOOTPRINT, 3);
    expect(e.softscapePct).toBeCloseTo(1, 6);
    expect(e.plants).toEqual([]);

    const noPlot = { ...bare, site: { ...bare.site, boundary: [], edges: [] } };
    const z = analyzeLandscape(noPlot, emptyBuilding());
    expect(z).toMatchObject({ plotArea: 0, openArea: 0, softscapePct: 0, permeablePct: 0, canopyPct: 0, plantCount: 0 });
    expect(() => validate(noPlot, emptyBuilding(), rules)).not.toThrow();
  });

  it('gives each species a unique key', () => {
    const keys = landscapeKeys(la);
    expect(keys.get('neem')).toBe('AZIN');
    expect(keys.get('ixora')).toBe('IXCO');
    expect(keys.get('murraya')).toBe('MUPA'); // the hedge species is keyed too
    // Murraya paniculata and Musa × paradisiaca would both be MUPA.
    const clash = speciesKeys([PLANT_BY_ID.banana, PLANT_BY_ID.murraya, PLANT_BY_ID.lemon]);
    expect(clash.get('lemon')).toBe('CILI');
    expect(new Set(clash.values()).size).toBe(3);
    expect([...clash.values()]).toContain('MUPA');
  });
});

describe('landscape cost', () => {
  const doc = garden();
  const cost = estimateCost(doc, activeBuilding(doc), rules);
  const line = (key: string) => cost.lines.find((l) => l.key === key);

  it('costs plants and garden structures under Landscape, never under FF&E', () => {
    expect(line('plant-neem')).toMatchObject({ category: 'Landscape', quantity: 2, unit: 'nos', total: 2 * PLANT_BY_ID.neem.price });
    expect(line('plant-ixora')).toMatchObject({ category: 'Landscape', quantity: 3, total: 3 * PLANT_BY_ID.ixora.price });
    expect(line('garden-pergola')).toMatchObject({ category: 'Landscape', quantity: 1, total: 165000 });
    expect(line('garden-path-light')!.category).toBe('Landscape');
    const ffe = cost.lines.filter((l) => l.category === 'Furniture');
    expect(ffe.map((l) => l.item)).toEqual(['Sun lounger']); // outdoor furniture stays in FF&E
    expect(cost.ffeTotal).toBe(26000);
    expect(cost.lines.filter((l) => /Neem|Ixora|Pergola|Path spike/.test(l.item)).every((l) => l.category === 'Landscape')).toBe(true);
  });

  it('keeps landscape in the total whether or not FF&E is included', () => {
    const b = activeBuilding(doc);
    const withFFE = estimateCost({ ...doc, cost: { ...doc.cost, includeFFE: true } }, b, rules);
    expect(withFFE.directTotal - cost.directTotal).toBeCloseTo(26000, 4); // only the lounger moves
    // Take the planting out and the construction total drops by exactly its price.
    const planted = Object.values(b.furniture).filter((f) => f.assetId.startsWith('plant-')).map((f) => ({ kind: 'furniture', id: f.id }));
    const bareDoc = run(doc, 'element.delete', { refs: planted });
    const bare = estimateCost(bareDoc, activeBuilding(bareDoc), rules);
    expect(cost.directTotal - bare.directTotal).toBeCloseTo(2 * PLANT_BY_ID.neem.price + 3 * PLANT_BY_ID.ixora.price, 4);
    expect(cost.byCategory.find((c) => c.category === 'Landscape')!.total).toBeGreaterThan(0);
  });

  it('takes off surfaces, coping, linear features, topsoil and irrigation', () => {
    expect(line('site-patio-sandstone-paving')).toMatchObject({ unit: 'm2', materialId: 'sandstone-paving' });
    expect(line('site-patio-sandstone-paving')!.quantity).toBeCloseTo(20, 6);
    expect(line('site-driveway-grass-paver')!.quantity).toBeCloseTo(30, 6);
    expect(line('site-lawn')!.quantity).toBeCloseTo(LAWN, 3);
    expect(line('site-lawn')!.item).toBe('Lawn turfing');
    expect(line('coping-pool-travertine')!.quantity).toBeCloseTo(8.7 * 4.7 - 32, 4);
    expect(line('coping-pool-travertine')!.item).toContain('24.0 rm');
    expect(line('site-topsoil')).toMatchObject({ unit: 'm3', total: 0 }); // already in the planting-bed rate
    expect(line('site-topsoil')!.quantity).toBeCloseTo(12 * 0.3, 6);

    const hedge = cost.lines.find((l) => l.key.startsWith('hedge-'))!;
    expect(hedge).toMatchObject({ category: 'Landscape', unit: 'rm', total: 20 * PLANT_BY_ID.murraya.price });
    expect(hedge.quantity).toBeCloseTo(10, 6);
    expect(hedge.item).toContain('20 plants');

    const fence = cost.lines.find((l) => l.key.startsWith('fence-'))!;
    expect(fence.unit).toBe('rm');
    expect(fence.quantity).toBeCloseTo(32, 6);
    expect(fence.total).toBeCloseTo(32 * 1.5 * (3800 + 700), 2); // priced on the boarded face, m²
    const wall = cost.lines.find((l) => l.key.startsWith('gwall-brick'))!;
    expect(wall.quantity).toBeCloseTo(12, 6);
    expect(wall.total).toBeCloseTo(12 * 1.8 * 0.2 * (5600 + 1900), 2); // brick by volume
    expect(line('gwall-fin-ext-texture')!.quantity).toBeCloseTo(2 * 12 * 1.8, 6); // both faces

    const drip = line('irrigation-drip')!, spr = line('irrigation-sprinkler')!;
    expect(drip.item).toContain(`₹${LANDSCAPE_RATES.drip}/m²`);
    expect(drip.quantity).toBeCloseTo(12 + 10 * 0.6, 6);
    expect(drip.total).toBeCloseTo((12 + 6) * LANDSCAPE_RATES.drip, 4);
    expect(spr.item).toContain(`₹${LANDSCAPE_RATES.sprinkler}/m²`);
    expect(spr.total).toBeCloseTo(LAWN * LANDSCAPE_RATES.sprinkler, 0);
  });
});

describe('landscape design health', () => {
  it('stays silent on a well-planned garden and on an empty site', () => {
    expect(landscapeIssues(garden())).toEqual([]);
    expect(landscapeIssues(house())).toEqual([]);
    expect(validate(garden(), activeBuilding(garden()), rules).categories.find((c) => c.category === 'Landscape')).toMatchObject({ status: 'ok', count: 0 });
  });

  it('warns about a large tree close to the house', () => {
    const d = place(garden(), 'plant-neem', 22000, 19000); // 1.9 m from the east wall
    const hit = landscapeIssues(d).filter((i) => /too close to the house/.test(i.title));
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'warning', title: 'Neem is too close to the house', point: { x: 22000, y: 19000 } });
    expect(hit[0].refs[0].kind).toBe('furniture');
    expect(hit[0].detail).toMatch(/roots, branches/);
    // A columnar tree of the same height, and a small tree, are fine in the same spot.
    expect(titles(place(garden(), 'plant-ashoka', 22000, 19000))).toEqual([]);
    expect(titles(place(garden(), 'plant-frangipani', 22000, 19000))).toEqual([]);
  });

  it('flags tall palms over parking and over the pool', () => {
    const withParking = feature(garden(), { kind: 'parking', name: 'Car bay', polygon: rect(21500, 12000, 6000, 2500), props: { spaces: 2 } });
    const coconut = landscapeIssues(place(withParking, 'plant-coconut', 20800, 13000));
    expect(coconut).toHaveLength(1);
    expect(coconut[0]).toMatchObject({ severity: 'warning', title: 'Coconut palm stands over the parking' });
    expect(coconut[0].refs.map((r) => r.kind)).toEqual(['furniture', 'siteFeature']);
    const foxtail = landscapeIssues(place(withParking, 'plant-foxtail', 20800, 13000));
    expect(foxtail).toHaveLength(1);
    expect(foxtail[0].severity).toBe('info'); // fronds, not nuts

    const overPool = landscapeIssues(place(garden(), 'plant-coconut', 18500, 30000)); // crown radius 3 m, trunk 1.5 m from the water
    expect(overPool.map((i) => [i.severity, i.title])).toEqual([['warning', 'Coconut palm hangs over the pool']]);
    // Clear of both, a coconut raises nothing; a short palm by the parking is fine too.
    expect(titles(place(withParking, 'plant-coconut', 5000, 26000))).toEqual([]);
    expect(titles(place(withParking, 'plant-pygmy-date', 20800, 13000))).toEqual([]);
  });

  it('warns about poisonous plants beside play equipment', () => {
    const play = place(garden(), 'play-set', 15000, 35000);
    expect(titles(play)).toEqual([]); // the pool is fenced, nothing poisonous yet
    const near = landscapeIssues(place(play, 'plant-oleander', 17000, 35000));
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ severity: 'warning', title: 'Kaner (oleander) is poisonous and close to the play area' });
    expect(near[0].refs).toHaveLength(2);
    expect(titles(place(play, 'plant-oleander', 4000, 5000))).toEqual([]); // far side of the garden
    const sandpit = place(garden(), 'sandpit', 15000, 35000);
    expect(titles(place(sandpit, 'plant-cycas', 16500, 35000))).toEqual(['Sago palm is poisonous and close to the play area']);
    // An oleander hedge running past the trampoline counts as well.
    const hedged = feature(place(garden(), 'trampoline', 15000, 35000), { kind: 'hedge', name: 'Screen hedge', path: [{ x: 12000, y: 36500 }, { x: 18000, y: 36500 }], props: { species: 'oleander' } });
    expect(titles(hedged)).toEqual(['Screen hedge is poisonous and close to the play area']);
  });

  it('notes species that do not suit the climate, once per species', () => {
    expect(climateOf(19.08)).toBe('tropical');
    expect(climateOf(-28)).toBe('subtropical');
    expect(climateOf(48.8)).toBe('temperate');
    let d = garden();
    for (const x of [22000, 23000, 24000]) d = place(d, 'plant-lavender', x, 36000);
    const notes = landscapeIssues(d);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ severity: 'info', title: 'Lavender may not suit this climate' });
    expect(notes[0].refs).toHaveLength(3);
    expect(notes[0].detail).toMatch(/Mumbai is treated as a tropical climate/);
    // The same garden near Paris: lavender is at home, the tropical planting is not.
    const paris = { ...d, meta: { ...d.meta, location: { city: 'Paris', country: 'France', lat: 48.86, lon: 2.35 } } };
    const t = titles(paris);
    expect(t).not.toContain('Lavender may not suit this climate');
    expect(t).toContain('Neem may not suit this climate');
    expect(t).toContain('Kamini (orange jasmine) may not suit this climate'); // the hedge species
    expect(t.filter((x) => /Neem/.test(x))).toHaveLength(1);
    expect(suitsClimate(PLANT_BY_ID.olive, 41.9)).toBe(true); // Mediterranean planting at a Mediterranean latitude
  });

  it('warns when planting or a boundary feature strays outside the plot', () => {
    const out = landscapeIssues(place(garden(), 'plant-ixora', -2000, 5000));
    expect(out.map((i) => [i.severity, i.title])).toEqual([['warning', 'Ixora is outside the plot']]);
    const long = feature(garden(), { kind: 'fence', name: 'Front fence', path: [{ x: 5000, y: 300 }, { x: 34000, y: 300 }] });
    const hit = landscapeIssues(long);
    expect(hit.map((i) => i.title)).toEqual(['Front fence runs outside the plot']);
    expect(hit[0].refs).toEqual([{ kind: 'siteFeature', id: byName(long, 'Front fence').id }]);
    const hedgeOut = feature(garden(), { kind: 'hedge', name: 'Lane hedge', path: [{ x: 28000, y: 36000 }, { x: 28000, y: 43000 }] });
    expect(titles(hedgeOut)).toEqual(['Lane hedge runs outside the plot']);
    // A compound wall drawn on the plot line itself is where it should be.
    const onLine = feature(garden(), { kind: 'wall', name: 'Compound wall', path: [{ x: 0, y: 0 }, { x: 30000, y: 0 }, { x: 30000, y: 40000 }] });
    expect(titles(onLine)).toEqual([]);
  });

  it('notes an unfenced pool when there is play equipment', () => {
    const fenced = place(garden(), 'play-set', 15000, 35000);
    expect(titles(fenced)).toEqual([]);
    const open = run(fenced, 'element.delete', { refs: [{ kind: 'siteFeature', id: byName(fenced, 'Pool fence').id }] });
    const hit = landscapeIssues(open);
    expect(hit.map((i) => [i.severity, i.title])).toEqual([['info', 'Pool is open to the play area']]);
    expect(hit[0].refs).toEqual([{ kind: 'siteFeature', id: byName(open, 'Pool').id }]);
    // No play equipment, no note — and a wall round the whole plot doesn't separate the two.
    expect(titles(run(garden(), 'element.delete', { refs: [{ kind: 'siteFeature', id: byName(garden(), 'Pool fence').id }] }))).toEqual([]);
    const perimeter = feature(open, { kind: 'wall', name: 'Compound wall', path: [{ x: 200, y: 200 }, { x: 29800, y: 200 }, { x: 29800, y: 39800 }, { x: 200, y: 39800 }, { x: 200, y: 200 }] });
    expect(titles(perimeter)).toEqual(['Pool is open to the play area']);
  });

  it('notes a planting bed with nothing in it', () => {
    const d = feature(garden(), { kind: 'bed', name: 'Herb bed', polygon: rect(22000, 14000, 3000, 1500) });
    const hit = landscapeIssues(d);
    expect(hit.map((i) => [i.severity, i.title])).toEqual([['info', 'Herb bed has no plants']]);
    expect(hit[0].point).toEqual({ x: 23500, y: 14750 });
    expect(titles(place(d, 'plant-tulsi', 23000, 14700))).toEqual([]);
  });
});

describe('landscape sheets', () => {
  it('leaves the sheet list alone until the project has landscape', () => {
    const bare = house();
    const numbers = buildSheetSet(bare, activeBuilding(bare), { size: 'A3', date: '10 Oct 2026' }).map((s) => s.number);
    expect(numbers.filter((n) => n.startsWith('L-'))).toEqual([]);
    expect(numbers).toContain('A-001');
    expect(numbers).toContain('A-101');
  });

  const doc = garden();
  const b = activeBuilding(doc);
  const set = buildSheetSet(doc, b, { size: 'A3', date: '10 Oct 2026' });
  const sheet = (n: string) => set.find((s) => s.number === n)!;

  it('adds L-101 and L-102 after the drawings and into the index', () => {
    const numbers = set.map((s) => s.number);
    expect(numbers).toContain('L-101');
    expect(numbers).toContain('L-102');
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.indexOf('L-101')).toBeGreaterThan(numbers.indexOf('A-301'));
    expect(numbers.indexOf('L-102')).toBe(numbers.indexOf('L-101') + 1);
    expect(numbers.indexOf('L-102')).toBeLessThan(numbers.indexOf('A-601'));
    expect(sheet('L-101')).toMatchObject({ title: 'Landscape plan' });
    expect(sheet('L-101').scale).toMatch(/^1:\d+$/);
    expect(sheet('L-102')).toMatchObject({ title: 'Planting & hardscape schedule', scale: 'NTS' });
    expect(set.every((s, i) => s.index === i + 1 && s.total === set.length)).toBe(true);
    const cover = renderSheet(doc, sheet('A-000'), b);
    expect(cover).toContain('L-101');
    expect(cover).toContain('Landscape plan');
  });

  it('draws the landscape plan with species keys', () => {
    const svg = renderSheet(doc, sheet('L-101'), b);
    assertWellFormed(svg);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297"')).toBe(true);
    expect(svg).not.toMatch(/var\(|class=|<style/);
    expect(svg).toContain('LANDSCAPE PLAN');
    expect(svg).toContain('L-101');
    expect((svg.match(/>AZIN</g) ?? []).length).toBe(3); // one tag per tree plus the key column
    expect(svg).toContain('>IXCO ×3<'); // three shrubs, tagged once as a group
    expect(svg).toContain('>MUPA HEDGE<');
    expect(svg).toContain('Neem · 2');
    expect(svg).toContain('>HOUSE<');
    expect(svg).toContain('>N<'); // north arrow
    expect(svg).toMatch(/SCALE 1:\d+/);
    expect(svg).toContain('PATIO');
    const d = drawLandscapePlan(doc, b, { scale: 100 });
    expect(d.model.w / 100 + d.pad.x).toBeCloseTo(d.width, 6);
    expect(drawLandscapePlan(doc, b, { scale: 100, tags: false }).svg).not.toContain('AZIN');
  });

  it('schedules planting and hardscape with botanical names', () => {
    const svg = renderSheet(doc, sheet('L-102'), b);
    assertWellFormed(svg);
    for (const t of ['PLANTING SCHEDULE', 'HARDSCAPE SCHEDULE', 'LANDSCAPE SUMMARY', 'Azadirachta indica', 'Ixora coccinea', 'Murraya paniculata', 'AZIN', 'IXCO', 'MUPA',
      'Sandstone paving', 'Grass pavers', 'Travertine pool paving', 'Softscape', 'Permeable ground', 'Canopy cover', 'L / week']) expect(svg).toContain(t);
    expect(svg).toMatch(/<text font-style="italic"[^>]*>Azadirachta indica</);
    const rows = plantingSchedule(doc, b);
    expect(rows.map((r) => r.key)).toEqual(['AZIN', 'IXCO', 'MUPA']);
    expect(rows.find((r) => r.key === 'AZIN')).toMatchObject({ botanical: 'Azadirachta indica', common: 'Neem', type: 'Tree', qty: '2', size: '12 m × 9 m', spacing: '8 m', sun: 'Full sun' });
    expect(rows.find((r) => r.key === 'MUPA')).toMatchObject({ qty: '20' }); // hedge plants only
    expect(rows.find((r) => r.key === 'MUPA')!.remarks).toMatch(/^20 in 10 m of hedge/);
    const hard = hardscapeSchedule(doc, b);
    expect(hard.find((r) => r.item === 'Patio')).toMatchObject({ material: 'Sandstone paving', qty: '20 m²' });
    expect(hard.find((r) => r.item.startsWith('Pool fence'))).toMatchObject({ qty: '32 m' });
    expect(hard.find((r) => r.item.startsWith('Rear hedge'))!.material).toContain('20 plants');
  });

  it('draws the new feature kinds on the site plan', () => {
    const site = drawSitePlan(doc, b, { scale: 200 });
    assertWellFormed(site.svg);
    for (const t of ['PATIO', 'POOL', 'POND', 'DECK']) expect(site.svg).toContain(t);
    expect(site.svg).toContain('#8fb07a'); // hedge band
    expect(site.svg).toContain('stroke-linecap="round"'); // gravel and bed stipple
    expect(site.svg).toContain('#cfe2dc'); // pond
  });

  it('adds landscape sheets to a plot with no building yet', () => {
    const b0 = emptyBuilding();
    const g = makeLevel({ name: 'Ground Floor', elevation: 0, order: 0 });
    b0.levels[g.id] = g;
    let d = newProjectDoc(defaultMeta({ name: 'Empty plot', units: 'metric' }), rectSite(20000, 30000, { front: 3000, side: 1500, rear: 1500 }), b0);
    expect(buildSheetSet(d, activeBuilding(d), { size: 'A3' }).map((s) => s.number)).toEqual(['A-000', 'A-001']);
    d = run(d, 'furniture.create', { levelId: g.id, assetId: 'plant-mango', position: { x: 10000, y: 15000 } });
    const s2 = buildSheetSet(d, activeBuilding(d), { size: 'A3' });
    expect(s2.map((s) => s.number)).toEqual(['A-000', 'A-001', 'L-101', 'L-102']);
    for (const sh of s2) assertWellFormed(renderSheet(d, sh, activeBuilding(d)));
    expect(renderSheet(d, s2[3], activeBuilding(d))).toContain('Mangifera indica');
  });
});
