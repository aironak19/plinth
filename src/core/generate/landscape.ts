/**
 * "Landscape my plot". Reads the plot, the house and the road and lays out a
 * complete garden in one of six styles: compound wall and gate, a path to the
 * front door, an outdoor room off the living space, style gardens where they
 * fit, perimeter trees sized to the setback, foundation planting and lighting.
 *
 * It returns ordinary operations — the same ones the mouse and Architect AI
 * use — so the result is a previewable, undoable, fully editable change.
 * Species are filtered to the project's climate before any are specified.
 */
import type { BuildingModel, ProjectDoc } from '../model/types';
import { applyOps, type OpCall } from '../ops';
import { findSitePosition } from '../ops/blocks';
import { activeBuilding, levelsSorted, openingsOf, isDoor } from '../model/query';
import { deriveLevel } from '../derive/level';
import { type Vec2, add, dist, dot, norm, perp, projectToSegment, scale, sub } from '../geometry/vec';
import { type Polygon, areaWithHoles, bbox, distToPolygonEdge, ensureCCW, intersection, offsetPolygonEdges, pointInPolygon } from '../geometry/polygon';
import { PLANT_BY_ID, plantAssetId, type Climate, type LandscapeStyle, type Plant } from '../catalog/plants';
import { BLOCK_BY_ID } from '../catalog/blocks';

interface Palette {
  /** Large trees for corners with room to grow. */
  canopy: string[];
  /** Slender or small trees for narrow side setbacks. */
  slim: string[];
  shrubs: string[];
  ground: string[];
  wall: string;
  path: string;
  /** Outdoor room, in order of preference. */
  room: [string, string][];
  /** Style gardens placed wherever a clear patch remains. */
  gardens: [string, string][];
}

const PALETTES: Record<LandscapeStyle, Palette> = {
  tropical: { canopy: ['coconut', 'tabebuia', 'frangipani', 'foxtail'], slim: ['areca', 'foxtail', 'ashoka', 'pygmy-date'], shrubs: ['heliconia', 'hibiscus', 'bird-of-paradise', 'ixora'], ground: ['spider-lily', 'fern', 'wedelia'], wall: 'ext-texture', path: 'sandstone-paving', room: [['sit-out', 'M'], ['sit-out', 'S'], ['patio', 'S']], gardens: [['tropical-corner', 'M'], ['flower-border', 'S']] },
  modern: { canopy: ['frangipani', 'ficus', 'bismarck', 'olive'], slim: ['ashoka', 'areca', 'cypress', 'pygmy-date'], shrubs: ['boxwood', 'fountain-grass', 'agave', 'bird-of-paradise'], ground: ['duranta', 'mondo', 'rhoeo'], wall: 'ext-texture', path: 'granite-paving', room: [['sit-out', 'L'], ['sit-out', 'M'], ['patio', 'S']], gardens: [['succulent-garden', 'M'], ['fire-pit-court', 'S']] },
  indian: { canopy: ['neem', 'mango', 'champaca', 'amaltas'], slim: ['ashoka', 'curry-leaf', 'lemon', 'banana'], shrubs: ['hibiscus', 'jasmine', 'murraya', 'ixora'], ground: ['marigold', 'vinca', 'tulsi'], wall: 'ext-texture', path: 'brick-paver', room: [['sit-out', 'S'], ['patio', 'M'], ['patio', 'S']], gardens: [['tulsi-court', 'M'], ['kitchen-garden', 'S'], ['shade-tree-seat', 'S']] },
  mediterranean: { canopy: ['olive', 'jacaranda', 'crepe-myrtle', 'frangipani'], slim: ['cypress', 'lemon', 'pygmy-date', 'ashoka'], shrubs: ['bougainvillea', 'rosemary', 'plumbago', 'lavender'], ground: ['lavender', 'duranta', 'aloe'], wall: 'ext-terracotta', path: 'terracotta-paver', room: [['patio', 'M'], ['sit-out', 'S'], ['patio', 'S']], gardens: [['fountain-court', 'M'], ['succulent-garden', 'M']] },
  zen: { canopy: ['maple', 'frangipani', 'ficus', 'crepe-myrtle'], slim: ['bamboo', 'cycas', 'ashoka', 'areca'], shrubs: ['azalea', 'boxwood', 'philodendron', 'cycas'], ground: ['mondo', 'fern', 'rhoeo'], wall: 'ext-texture', path: 'crazy-paving', room: [['yoga-deck', 'M'], ['sit-out', 'S'], ['patio', 'S']], gardens: [['zen-garden', 'M'], ['water-garden', 'S'], ['bamboo-screen', 'S']] },
  cottage: { canopy: ['jacaranda', 'tabebuia', 'kachnar', 'crepe-myrtle'], slim: ['bottlebrush', 'lemon', 'crepe-myrtle', 'ashoka'], shrubs: ['rose', 'hydrangea', 'plumbago', 'hibiscus'], ground: ['vinca', 'petunia', 'lavender'], wall: 'exposed-brick', path: 'brick-paver', room: [['patio', 'M'], ['sit-out', 'S'], ['patio', 'S']], gardens: [['rose-garden', 'M'], ['flower-border', 'M']] },
};

/** Coarse climate band from latitude — enough to keep lavender out of the tropics. */
export function climateOf(doc: ProjectDoc): Climate {
  const lat = Math.abs(doc.meta.location.lat);
  return lat < 23.5 ? 'tropical' : lat < 35 ? 'subtropical' : 'temperate';
}

function suited(ids: string[], climate: Climate): Plant[] {
  const all = ids.map((id) => PLANT_BY_ID[id]).filter(Boolean);
  const ok = all.filter((p) => p.climates.includes(climate));
  return ok.length ? ok : all;
}

const SYS = { actor: 'u-system', role: 'owner' as const, record: false };

export interface LandscapePlan { ops: OpCall[]; notes: string[] }

export function planLandscape(doc0: ProjectDoc, style: LandscapeStyle): LandscapePlan {
  const pal = PALETTES[style];
  const climate = climateOf(doc0);
  let doc = doc0;
  const ops: OpCall[] = [];
  const notes: string[] = [];
  const push = (op: OpCall): boolean => {
    try { doc = applyOps(doc, [op], SYS).doc; ops.push(op); return true; } catch { return false; }
  };
  push({ type: 'landscape.clear', params: {} });

  const b = (): BuildingModel => activeBuilding(doc);
  const ground = levelsSorted(b())[0];
  if (!ground) return { ops: [], notes: ['Add a floor before landscaping the plot.'] };
  const plot = ensureCCW(doc.site.boundary);
  const n = plot.length;
  const dl = deriveLevel(b(), ground.id);
  const footprint: Polygon[] = dl.footprint;
  const edges = plot.map((p, i) => { const q = plot[(i + 1) % n]; const d = norm(sub(q, p)); return { i, p, q, d, inward: perp(d), len: dist(p, q), site: doc.site.edges[i] }; });
  const roadEdge = edges.find((e) => e.site?.road) ?? edges.find((e) => e.site?.kind === 'front') ?? edges[0];
  const plants: { p: Vec2; r: number }[] = [];
  let plantCount = 0;
  const featurePolys = () => Object.values(doc.site.features).filter((f) => f.polygon && f.polygon.length > 2);
  const clearOfBuilding = (p: Vec2, d: number) => footprint.every((f) => !pointInPolygon(p, f) && distToPolygonEdge(p, f) >= d);
  const canPlant = (p: Vec2, radius: number, fromHouse: number): boolean => {
    if (!pointInPolygon(p, plot) || distToPolygonEdge(p, plot) < 500) return false;
    if (!clearOfBuilding(p, fromHouse)) return false;
    if (featurePolys().some((f) => f.kind !== 'lawn' && f.kind !== 'bed' && pointInPolygon(p, f.polygon!))) return false;
    return plants.every((o) => dist(o.p, p) > (o.r + radius) * 0.62);
  };
  const plant = (sp: Plant, p: Vec2, scaleBy = 1): boolean => {
    const ok = push({ type: 'furniture.create', params: { levelId: ground.id, assetId: plantAssetId(sp.id), position: p, rotation: 0, props: { auto: true }, ...(scaleBy !== 1 ? { size: { w: sp.spread * scaleBy, d: sp.spread * scaleBy, h: sp.height * scaleBy } } : {}) } });
    if (ok) { plants.push({ p, r: (sp.spread * scaleBy) / 2 }); plantCount++; }
    return ok;
  };
  const item = (assetId: string, p: Vec2, rotation = 0) => push({ type: 'furniture.create', params: { levelId: ground.id, assetId, position: p, rotation, props: { auto: true } } });

  // ---- 1. front door: the widest door on an outside wall that faces the road
  let door: { p: Vec2; out: Vec2 } | null = null;
  let best = -1;
  for (const w of dl.walls) {
    if (!dl.exteriorWallIds.has(w.id)) continue;
    const d = norm(sub(w.b, w.a));
    for (const o of openingsOf(b(), w.id)) {
      if (!isDoor(o)) continue;
      const at = add(w.a, scale(d, o.offset));
      const nrm = perp(d);
      const out = footprint.some((f) => pointInPolygon(add(at, scale(nrm, w.thickness / 2 + 300)), f)) ? scale(nrm, -1) : nrm;
      const facing = dot(out, scale(roadEdge.inward, -1));
      const score = o.width + (facing > 0.7 ? 5000 : 0) + (o.kind === 'pivot' || o.kind === 'double' ? 800 : 0);
      if (score > best) { best = score; door = { p: add(at, scale(out, w.thickness / 2)), out }; }
    }
  }
  const frontDoor = door && dot(door.out, scale(roadEdge.inward, -1)) > 0.7 ? door : null;

  // ---- 2. compound wall with a gate on the road, unless the plot is already enclosed
  const enclosed = Object.values(doc.site.features).some((f) => f.path && f.path.length > 1) || Object.values(b().walls).some((w) => w.kind === 'compound');
  const inset = offsetPolygonEdges(plot, plot.map(() => 130));
  const gateT = Math.max(2900, Math.min(roadEdge.len - 2900, frontDoor ? dot(sub(frontDoor.p, roadEdge.p), roadEdge.d) : roadEdge.len / 2));
  const gateC = add(add(roadEdge.p, scale(roadEdge.d, gateT)), scale(roadEdge.inward, 130));
  if (!enclosed && inset.length === n && roadEdge.len > 6500) {
    const g0 = add(gateC, scale(roadEdge.d, -2450)), g1 = add(gateC, scale(roadEdge.d, 2450));
    const path: Vec2[] = [g1];
    for (let k = 1; k <= n; k++) path.push(inset[(roadEdge.i + k) % n]);
    path.push(g0);
    push({ type: 'site.feature.create', params: { kind: 'wall', name: 'Compound wall', path, materialId: pal.wall, props: { height: 1650, width: 200, auto: true } } });
    item('gate-main', gateC, (Math.atan2(roadEdge.d.y, roadEdge.d.x) * 180) / Math.PI);
    notes.push('Compound wall with a main gate on the road');
  }

  // ---- 3. path from the gate to the front door
  let pathPoly: Polygon | null = null;
  if (frontDoor) {
    const a = add(gateC, scale(roadEdge.inward, 220)), c = frontDoor.p;
    const along = norm(sub(c, a)), side = perp(along), len = dist(a, c);
    if (len > 900) {
      pathPoly = [add(a, scale(side, -750)), add(c, scale(side, -750)), add(c, scale(side, 750)), add(a, scale(side, 750))];
      if (push({ type: 'site.feature.create', params: { kind: 'pathway', name: 'Entry path', polygon: ensureCCW(pathPoly), materialId: pal.path, props: { auto: true } } })) {
        for (let t = 1200; t < len - 600; t += 2600) for (const sgn of [-1, 1]) item('path-light', add(add(a, scale(along, t)), scale(side, sgn * 1000)));
        notes.push('Entry path with path lights');
      }
    }
  }

  // ---- 4. the outdoor room: off the living space, away from the road
  const living = dl.rooms.find((r) => r.fn === 'living') ?? dl.rooms.find((r) => r.fn === 'family' || r.fn === 'dining') ?? dl.rooms[0];
  const near = living ? living.labelPoint : undefined;
  for (const [id, size] of pal.room) {
    if (!BLOCK_BY_ID[id]) continue;
    const pos = findSitePosition(doc, b(), id, size, near, { roadWeight: -0.5, step: 915, nearWeight: 1.6 });
    if (pos && push({ type: 'block.place', params: { blockId: id, size, levelId: ground.id, ...pos, auto: true } })) { notes.push(`${BLOCK_BY_ID[id].name} off the ${living ? living.name.toLowerCase() : 'house'}`); break; }
  }

  // ---- 5. style gardens wherever a clear patch remains
  for (const [id, size] of pal.gardens) {
    if (!BLOCK_BY_ID[id]) continue;
    // A ready-made garden is only specified where most of its plants will actually grow.
    const species = (BLOCK_BY_ID[id].sizes.find((z) => z.id === size)?.props ?? []).map((pr) => PLANT_BY_ID[pr.asset.replace(/^plant-/, '')]).filter(Boolean);
    if (species.length && species.filter((sp) => sp.climates.includes(climate)).length / species.length < 0.7) { notes.push(`${BLOCK_BY_ID[id].name} left out — its plants don’t suit a ${climate} climate`); continue; }
    const pos = findSitePosition(doc, b(), id, size, undefined, { roadWeight: -0.25, step: 915 });
    if (pos && push({ type: 'block.place', params: { blockId: id, size, levelId: ground.id, ...pos, auto: true } })) notes.push(BLOCK_BY_ID[id].name);
  }
  // Plants that came with those blocks keep their distance from what follows.
  for (const f of Object.values(b().furniture)) if (f.props.auto && !plants.some((q) => dist(q.p, f.position) < 1)) { const sp = PLANT_BY_ID[f.assetId.replace(/^plant-/, '')]; if (sp) plants.push({ p: f.position, r: sp.spread / 2 }); }

  // ---- 6. perimeter trees: big ones where the setback allows, slender ones along tight sides
  const canopy = suited(pal.canopy, climate), slim = suited(pal.slim, climate);
  const lit: Vec2[] = [];
  let ci = 0, si = 0;
  inset.forEach((_, k) => {
    const prev = edges[(k - 1 + n) % n], cur = edges[k];
    const bis = norm(add(cur.inward, prev.inward));
    for (const sp of [canopy[ci % canopy.length], slim[si % slim.length]]) {
      const big = sp.spread > 3500;
      const p = add(plot[k], scale(bis, Math.max(1700, Math.min(3600, sp.spread * 0.42)) * Math.SQRT2));
      if (canPlant(p, sp.spread / 2, big ? 3200 : 1600) && plant(sp, p, 0.92 + ((k * 37) % 17) / 100)) { if (big) { ci++; lit.push(p); } else si++; break; }
    }
  });
  for (const e of edges) {
    if (e === roadEdge) continue;
    const count = Math.floor(e.len / 5200);
    for (let k = 1; k <= count; k++) {
      const t = (e.len / (count + 1)) * k;
      const sp = slim[si % slim.length];
      const p = add(add(e.p, scale(e.d, t)), scale(e.inward, Math.max(1300, sp.spread * 0.5 + 500)));
      if (canPlant(p, sp.spread / 2, 1500) && plant(sp, p, 0.9 + ((k * 53) % 19) / 100)) si++;
    }
  }
  lit.slice(0, 4).forEach((p) => item('uplight', add(p, { x: 700, y: -700 })));

  // ---- 7. foundation planting along the walls that face the road
  const shrubs = suited(pal.shrubs, climate), cover = suited(pal.ground, climate);
  let beds = 0;
  for (const w of dl.walls) {
    if (!dl.exteriorWallIds.has(w.id)) continue;
    const d = norm(sub(w.b, w.a)), nrm = perp(d), len = dist(w.a, w.b);
    const out = footprint.some((f) => pointInPolygon(add(add(w.a, scale(d, len / 2)), scale(nrm, w.thickness / 2 + 300)), f)) ? scale(nrm, -1) : nrm;
    if (dot(out, scale(roadEdge.inward, -1)) < 0.7 || len < 2400) continue;
    // Keep doorways clear.
    const gaps = openingsOf(b(), w.id).filter(isDoor).map((o) => [o.offset - o.width / 2 - 700, o.offset + o.width / 2 + 700] as [number, number]).sort((x, y) => x[0] - y[0]);
    const runs: [number, number][] = [];
    let s0 = 350;
    for (const [g0, g1] of gaps) { if (g0 - s0 > 1500) runs.push([s0, g0]); s0 = Math.max(s0, g1); }
    if (len - 350 - s0 > 1500) runs.push([s0, len - 350]);
    for (const [r0, r1] of runs) {
      const base = add(w.a, scale(out, w.thickness / 2 + 60));
      const poly = ensureCCW([add(base, scale(d, r0)), add(base, scale(d, r1)), add(add(base, scale(d, r1)), scale(out, 950)), add(add(base, scale(d, r0)), scale(out, 950))]);
      if (!poly.every((q) => pointInPolygon(q, plot))) continue;
      if (featurePolys().some((f) => areaWithHoles(intersection([poly], [f.polygon!])) > 0.15e6)) continue;
      if (!push({ type: 'site.feature.create', params: { kind: 'bed', name: 'Planting bed', polygon: poly, materialId: 'mulch', props: { auto: true } } })) continue;
      beds++;
      const m = Math.max(1, Math.round((r1 - r0) / 1250));
      for (let k = 0; k < m; k++) {
        const t = r0 + ((r1 - r0) / m) * (k + 0.5), sp = shrubs[(k + beds) % shrubs.length], gc = cover[(k + beds) % cover.length];
        const sc = Math.min(1, 1100 / sp.spread);
        const q = add(add(base, scale(d, t)), scale(out, 520));
        if (plants.every((o) => dist(o.p, q) > 500)) plant(sp, q, sc);
        const g = add(add(base, scale(d, t + (r1 - r0) / m / 2)), scale(out, 780));
        if (k < m - 1 && plants.every((o) => dist(o.p, g) > 350)) plant(gc, g, Math.min(1, 600 / gc.spread));
      }
    }
  }
  if (beds) notes.push(`${beds} planting bed${beds > 1 ? 's' : ''} along the front of the house`);
  if (plantCount) notes.push(`${plantCount} plants chosen for a ${climate} climate`);
  void bbox; void projectToSegment;
  return { ops, notes };
}
