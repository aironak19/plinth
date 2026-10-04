/**
 * Solid geometry builder.
 *
 * Converts the building model into planar faces (with holes). This is the one
 * geometric representation shared by the real-time 3D viewport, elevations,
 * sections and exports (glTF/OBJ/IFC). There is no second geometry system.
 */
import type { BuildingModel, Door, ElementRef, Id, Level, ProjectDoc, Wall, Window } from '../model/types';
import { type Vec2, type Vec3, add, norm, perp, polygonNormal3, rotate, scale, sub } from '../geometry/vec';
import { type Polygon, bbox, difference, ensureCCW, signedArea } from '../geometry/polygon';
import { levelAbove, levelsSorted, openingsOf, isDoor } from '../model/query';
import { deriveLevel, type DerivedLevel } from './level';
import { computeRoof } from './roof';
import { computeStair } from './stairs';
import { wallSides } from './finishes';
import type { RuleSet } from '../rules/rulesets';

export interface Face3 { outer: Vec3[]; holes?: Vec3[][]; normal: Vec3 }

export type SolidLayer =
  | 'wall' | 'slab' | 'floor' | 'roof' | 'stair' | 'door' | 'frame' | 'glass' | 'column' | 'beam'
  | 'site' | 'ground' | 'road' | 'water' | 'parapet' | 'gable';

export interface Solid {
  id: string;
  ref?: ElementRef;
  levelId?: Id;
  materialId: string;
  layer: SolidLayer;
  faces: Face3[];
}

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const lift = (p: Vec2, z: number): Vec3 => ({ x: p.x, y: p.y, z });

export function face(outer: Vec3[], holes?: Vec3[][]): Face3 {
  return { outer, holes: holes && holes.length ? holes : undefined, normal: polygonNormal3(outer) };
}

/** Vertical prism faces for a plan polygon. */
export function prismFaces(poly: Polygon, z0: number, z1: number, opts: { top?: boolean; bottom?: boolean; holes?: Polygon[] } = {}): Face3[] {
  const p = ensureCCW(poly);
  const faces: Face3[] = [];
  if (opts.top !== false) faces.push(face(p.map((q) => lift(q, z1)), opts.holes?.map((h) => [...ensureCCW(h)].reverse().map((q) => lift(q, z1)))));
  if (opts.bottom) faces.push(face([...p].reverse().map((q) => lift(q, z0)), opts.holes?.map((h) => ensureCCW(h).map((q) => lift(q, z0)))));
  const rings = [p, ...(opts.holes ?? []).map((h) => [...ensureCCW(h)].reverse())];
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    faces.push(face([lift(a, z0), lift(b, z0), lift(b, z1), lift(a, z1)]));
  }
  return faces;
}

/** Oriented box: corner `o`, unit axis `u` in plan, lengths along u / perp(u) / z. */
export function boxFaces(o: Vec2, u: Vec2, lu: number, lv: number, z0: number, z1: number): Face3[] {
  const v = perp(u);
  const p0 = o, p1 = add(o, scale(u, lu)), p2 = add(p1, scale(v, lv)), p3 = add(o, scale(v, lv));
  return prismFaces([p0, p1, p2, p3], z0, z1, { bottom: true });
}

export interface SolidOptions { hiddenLevels?: Set<Id>; includeSite?: boolean; includeOpenings?: boolean }

export function buildSolids(doc: ProjectDoc, b: BuildingModel, rules: RuleSet, opts: SolidOptions = {}): Solid[] {
  const out: Solid[] = [];
  const levels = levelsSorted(b);
  for (const level of levels) {
    if (opts.hiddenLevels?.has(level.id)) continue;
    const dl = deriveLevel(b, level.id);
    const above = levelAbove(b, level.id);
    const topGap = above ? above.slabThickness : 0;
    buildWalls(out, b, level, dl, topGap, opts.includeOpenings !== false);
    buildSlab(out, b, level, dl, levels);
    buildFloors(out, b, level, dl);
    buildStairs(out, b, level, rules, above);
    buildColumns(out, b, level, topGap);
  }
  for (const roof of Object.values(b.roofs)) {
    const level = b.levels[roof.levelId];
    if (!level || opts.hiddenLevels?.has(level.id)) continue;
    const info = computeRoof(roof, level, deriveLevel(b, level.id), rules.values.downpipeSpacing);
    const ref: ElementRef = { kind: 'roof', id: roof.id };
    if (roof.kind === 'flat') {
      const slab = info.planes.filter((p) => p.kind !== 'parapet');
      out.push({ id: `roof-${roof.id}`, ref, levelId: level.id, materialId: roof.materialId, layer: 'roof', faces: slab.map((p) => face(p.pts)) });
      const par = info.planes.filter((p) => p.kind === 'parapet');
      if (par.length) {
        // Give parapets real thickness (115 mm) so they read correctly in 3D and sections.
        const faces: Face3[] = [];
        for (const p of par) {
          const a = p.pts[0], bb = p.pts[1];
          const u = norm(sub(bb, a));
          const len = Math.hypot(bb.x - a.x, bb.y - a.y);
          faces.push(...boxFaces(add(a, scale(perp(u), 0)), u, len, 115, p.pts[0].z, p.pts[2].z));
        }
        out.push({ id: `parapet-${roof.id}`, ref, levelId: level.id, materialId: wallExteriorMaterial(b, level.id), layer: 'parapet', faces });
      }
    } else {
      out.push({ id: `roof-${roof.id}`, ref, levelId: level.id, materialId: roof.materialId, layer: 'roof', faces: info.planes.filter((p) => p.kind === 'slope').map((p) => face(p.pts)) });
      const gables = info.planes.filter((p) => p.kind === 'gable');
      if (gables.length) out.push({ id: `gable-${roof.id}`, ref, levelId: level.id, materialId: wallExteriorMaterial(b, level.id), layer: 'gable', faces: gables.map((p) => face(p.pts)) });
    }
  }
  for (const beam of Object.values(b.beams)) {
    const level = b.levels[beam.levelId];
    if (!level || opts.hiddenLevels?.has(level.id)) continue;
    const u = norm(sub(beam.b, beam.a));
    const len = Math.hypot(beam.b.x - beam.a.x, beam.b.y - beam.a.y);
    const top = level.elevation + level.height;
    const o = add(beam.a, scale(perp(u), -beam.width / 2));
    out.push({ id: `beam-${beam.id}`, ref: { kind: 'beam', id: beam.id }, levelId: level.id, materialId: beam.materialId, layer: 'beam', faces: boxFaces(o, u, len, beam.width, top - beam.depth, top) });
  }
  if (opts.includeSite !== false) buildSite(out, doc);
  return out;
}

function wallExteriorMaterial(b: BuildingModel, levelId: Id): string {
  const ext = Object.values(b.walls).find((w) => w.levelId === levelId && w.kind === 'exterior');
  return ext?.finishExteriorId ?? 'ext-texture';
}

function buildWalls(out: Solid[], b: BuildingModel, level: Level, dl: DerivedLevel, topGap: number, withOpenings: boolean) {
  for (const w of dl.walls) {
    const ol = dl.outlines.get(w.id);
    if (!ol) continue;
    const [aL, bL, bR, aR] = ol.quad;
    const z0 = level.elevation + w.baseOffset;
    const z1 = level.elevation + (w.height ?? level.height - topGap);
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const sides = wallSides(b, dl, w);
    const half = w.thickness / 2;
    const ops = openingsOf(b, w.id);
    const holeFor = (o: Door | Window, across: number): Vec3[] => {
      const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
      const zb = z0 + (isDoor(o) ? 0 : (o as Window).sill);
      const zt = Math.min(z1 - 20, zb + o.height);
      const P = (s: number) => add(add(w.a, scale(d, s)), scale(n, across));
      return [lift(P(s0), zb), lift(P(s1), zb), lift(P(s1), zt), lift(P(s0), zt)];
    };
    const leftHoles = ops.map((o) => holeFor(o, half));
    const rightHoles = ops.map((o) => [...holeFor(o, -half)].reverse());
    const leftFace = face([lift(aL, z1), lift(bL, z1), lift(bL, z0), lift(aL, z0)], leftHoles.map((h) => [...h].reverse()));
    const rightFace = face([lift(bR, z1), lift(aR, z1), lift(aR, z0), lift(bR, z0)], rightHoles.map((h) => [...h].reverse()));
    const ref: ElementRef = { kind: 'wall', id: w.id };
    const core: Face3[] = [face([lift(aR, z1), lift(bR, z1), lift(bL, z1), lift(aL, z1)])];
    if (ol.capA) core.push(face([lift(aR, z1), lift(aL, z1), lift(aL, z0), lift(aR, z0)]));
    if (ol.capB) core.push(face([lift(bL, z1), lift(bR, z1), lift(bR, z0), lift(bL, z0)]));
    // Reveals (jambs, head, sill) give openings real depth.
    for (const o of ops) {
      const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
      const zb = z0 + (isDoor(o) ? 0 : (o as Window).sill);
      const zt = Math.min(z1 - 20, zb + o.height);
      const P = (s: number, t: number) => add(add(w.a, scale(d, s)), scale(n, t));
      core.push(face([lift(P(s0, -half), zb), lift(P(s0, half), zb), lift(P(s0, half), zt), lift(P(s0, -half), zt)]));
      core.push(face([lift(P(s1, half), zb), lift(P(s1, -half), zb), lift(P(s1, -half), zt), lift(P(s1, half), zt)]));
      core.push(face([lift(P(s0, -half), zt), lift(P(s0, half), zt), lift(P(s1, half), zt), lift(P(s1, -half), zt)]));
      if (zb > z0 + 1) core.push(face([lift(P(s0, half), zb), lift(P(s0, -half), zb), lift(P(s1, -half), zb), lift(P(s1, half), zb)]));
    }
    out.push({ id: `wall-${w.id}-L`, ref, levelId: level.id, materialId: sides.left.finishId, layer: 'wall', faces: [leftFace] });
    out.push({ id: `wall-${w.id}-R`, ref, levelId: level.id, materialId: sides.right.finishId, layer: 'wall', faces: [rightFace] });
    out.push({ id: `wall-${w.id}-C`, ref, levelId: level.id, materialId: sides.left.exterior || sides.right.exterior ? w.finishExteriorId : w.finishInteriorId, layer: 'wall', faces: core });
    if (withOpenings) for (const o of ops) buildOpening(out, w, o, level, z0, z1);
  }
}

function buildOpening(out: Solid[], w: Wall, o: Door | Window, level: Level, z0: number, z1: number) {
  const d = norm(sub(w.b, w.a));
  const n = perp(d);
  const s0 = o.offset - o.width / 2;
  const door = isDoor(o);
  const zb = z0 + (door ? 0 : (o as Window).sill);
  const zt = Math.min(z1 - 20, zb + o.height);
  const frame = 60;
  const P = (s: number, t: number) => add(add(w.a, scale(d, s)), scale(n, t));
  const ref: ElementRef = { kind: door ? 'door' : 'window', id: o.id };
  const frameMat = door ? (o as Door).materialId : (o as Window).frameMaterialId;
  const frameFaces: Face3[] = [
    ...boxFaces(P(s0, -50), d, frame, 100, zb, zt),
    ...boxFaces(P(s0 + o.width - frame, -50), d, frame, 100, zb, zt),
    ...boxFaces(P(s0, -50), d, o.width, 100, zt - frame, zt),
  ];
  if (!door) frameFaces.push(...boxFaces(P(s0, -50), d, o.width, 100, zb, zb + frame));
  const kind = door ? (o as Door).kind : (o as Window).kind;
  if (kind !== 'opening') out.push({ id: `${ref.kind}-${o.id}-frame`, ref, levelId: level.id, materialId: frameMat, layer: 'frame', faces: frameFaces });
  if (door) {
    const dd = o as Door;
    if (dd.kind === 'opening') return;
    const glassDoor = dd.kind === 'sliding' || dd.kind === 'french' || dd.kind === 'folding';
    const leafFaces = boxFaces(P(s0 + frame, -20), d, o.width - 2 * frame, 40, zb, zt - frame);
    out.push({ id: `door-${o.id}-leaf`, ref, levelId: level.id, materialId: glassDoor ? 'glass' : dd.materialId, layer: glassDoor ? 'glass' : 'door', faces: leafFaces });
    if (glassDoor) {
      const mullion = boxFaces(P(o.offset - 25, -30), d, 50, 60, zb, zt - frame);
      out.push({ id: `door-${o.id}-mullion`, ref, levelId: level.id, materialId: frameMat, layer: 'frame', faces: mullion });
    }
  } else {
    const win = o as Window;
    const glass = boxFaces(P(s0 + frame, -6), d, o.width - 2 * frame, 12, zb + frame, zt - frame);
    out.push({ id: `window-${o.id}-glass`, ref, levelId: level.id, materialId: 'glass', layer: 'glass', faces: glass });
    if (win.kind === 'sliding' || win.kind === 'casement' || win.kind === 'double' || win.kind === 'louvre') {
      const parts = win.kind === 'louvre' ? Math.max(3, Math.round(win.height / 150)) : 0;
      const mull: Face3[] = [...boxFaces(P(o.offset - 25, -40), d, 50, 80, zb + frame, zt - frame)];
      for (let i = 1; i < parts; i++) {
        const z = zb + frame + ((zt - zb - 2 * frame) * i) / parts;
        mull.push(...boxFaces(P(s0 + frame, -40), d, o.width - 2 * frame, 80, z - 12, z + 12));
      }
      out.push({ id: `window-${o.id}-mullion`, ref, levelId: level.id, materialId: win.frameMaterialId, layer: 'frame', faces: mull });
    }
  }
}

function buildSlab(out: Solid[], b: BuildingModel, level: Level, dl: DerivedLevel, levels: Level[]) {
  if (!dl.footprint.length) return;
  // Stair voids: stairs on the level below cut through this slab.
  const idx = levels.findIndex((l) => l.id === level.id);
  const below = idx > 0 ? levels[idx - 1] : undefined;
  const voids: Polygon[] = [];
  if (below) for (const s of Object.values(b.stairs).filter((s) => s.levelId === below.id)) {
    const info = computeStair(s, below, { values: { stairMaxRiser: 1e9 } } as RuleSet);
    voids.push(info.footprint);
  }
  const z1 = level.elevation, z0 = level.elevation - level.slabThickness;
  const slabs = voids.length ? difference(dl.footprint, voids) : dl.footprint.map((p) => ({ outer: p, holes: [] as Polygon[] }));
  const faces: Face3[] = [];
  for (const s of slabs) faces.push(...prismFaces(s.outer, z0, z1, { bottom: true, holes: s.holes }));
  out.push({ id: `slab-${level.id}`, levelId: level.id, materialId: 'rcc', layer: 'slab', faces });
}

function buildFloors(out: Solid[], b: BuildingModel, level: Level, dl: DerivedLevel) {
  for (const r of dl.rooms) {
    const tag = r.tagId ? b.rooms[r.tagId] : undefined;
    const mat = tag?.floorFinishId ?? 'vitrified';
    out.push({
      id: `floor-${r.id}`, ref: tag ? { kind: 'room', id: tag.id } : undefined, levelId: level.id, materialId: mat, layer: 'floor',
      faces: [face(ensureCCW(r.polygon).map((p) => lift(p, level.elevation + 4)))],
    });
  }
}

function buildStairs(out: Solid[], b: BuildingModel, level: Level, rules: RuleSet, above: Level | undefined) {
  for (const s of Object.values(b.stairs).filter((x) => x.levelId === level.id)) {
    const info = computeStair(s, level, rules, above ? above.elevation - level.elevation : level.height);
    const faces: Face3[] = [];
    for (const st of info.steps) {
      const zTop = level.elevation + st.z;
      const zBot = s.kind === 'spiral' ? zTop - 60 : st.landing ? zTop - 200 : Math.max(level.elevation, zTop - info.riser - 180);
      faces.push(...prismFaces(st.poly, zBot, zTop, { bottom: true }));
    }
    out.push({ id: `stair-${s.id}`, ref: { kind: 'stair', id: s.id }, levelId: level.id, materialId: s.materialId, layer: 'stair', faces });
  }
}

function buildColumns(out: Solid[], b: BuildingModel, level: Level, topGap: number) {
  for (const c of Object.values(b.columns).filter((x) => x.levelId === level.id)) {
    let poly: Polygon;
    if (c.shape === 'round') poly = Array.from({ length: 20 }, (_, i) => ({ x: c.position.x + Math.cos((i / 20) * Math.PI * 2) * c.width / 2, y: c.position.y + Math.sin((i / 20) * Math.PI * 2) * c.width / 2 }));
    else poly = [{ x: -c.width / 2, y: -c.depth / 2 }, { x: c.width / 2, y: -c.depth / 2 }, { x: c.width / 2, y: c.depth / 2 }, { x: -c.width / 2, y: c.depth / 2 }]
      .map((p) => add(rotate(p, (c.rotation * Math.PI) / 180), c.position));
    out.push({ id: `col-${c.id}`, ref: { kind: 'column', id: c.id }, levelId: level.id, materialId: c.materialId, layer: 'column', faces: prismFaces(poly, level.elevation, level.elevation + level.height - topGap, { bottom: true }) });
  }
}

function buildSite(out: Solid[], doc: ProjectDoc) {
  const site = doc.site;
  const plot = ensureCCW(site.boundary);
  const bb = bbox(plot);
  const pad = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) * 1.2;
  const ground: Polygon = [{ x: bb.minX - pad, y: bb.minY - pad }, { x: bb.maxX + pad, y: bb.minY - pad }, { x: bb.maxX + pad, y: bb.maxY + pad }, { x: bb.minX - pad, y: bb.maxY + pad }];
  out.push({ id: 'ground', materialId: 'ground', layer: 'ground', faces: [face(ground.map((p) => lift(p, -30)), [[...plot].reverse().map((p) => lift(p, -30))])] });
  const features = Object.values(site.features);
  const pools = features.filter((f) => f.kind === 'pool' && f.polygon);
  const hard = features.filter((f) => (f.kind === 'driveway' || f.kind === 'pathway' || f.kind === 'parking' || f.kind === 'deck') && f.polygon);
  const lawnHoles = [...pools, ...hard].map((f) => f.polygon!);
  const lawn = lawnHoles.length ? difference([plot], lawnHoles) : [{ outer: plot, holes: [] }];
  out.push({ id: 'plot', materialId: 'lawn', layer: 'site', faces: lawn.map((l) => face(ensureCCW(l.outer).map((p) => lift(p, 0)), l.holes.map((h) => [...ensureCCW(h)].reverse().map((p) => lift(p, 0))))) });
  for (const f of hard) {
    const z = f.kind === 'deck' ? 150 : 20;
    out.push({ id: `feat-${f.id}`, ref: { kind: 'siteFeature', id: f.id }, materialId: f.materialId ?? 'paver', layer: 'site', faces: prismFaces(f.polygon!, 0, z) });
  }
  for (const f of pools) {
    const poly = ensureCCW(f.polygon!);
    const coping: Face3[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], c = poly[(i + 1) % poly.length];
      coping.push(face([lift(c, -1200), lift(a, -1200), lift(a, 60), lift(c, 60)]));
    }
    out.push({ id: `pool-wall-${f.id}`, ref: { kind: 'siteFeature', id: f.id }, materialId: 'pool-tile', layer: 'site', faces: [...coping, face(poly.map((p) => lift(p, -1200)))] });
    out.push({ id: `pool-water-${f.id}`, ref: { kind: 'siteFeature', id: f.id }, materialId: 'pool-water', layer: 'water', faces: [face(poly.map((p) => lift(p, -150)))] });
  }
  // Roads along road-facing edges give the model its real context.
  plot.forEach((p, i) => {
    const n = site.boundary.length;
    const e = site.edges[signedArea(site.boundary) < 0 ? (n - 2 - i + n) % n : i];
    if (!e?.road) return;
    const q = plot[(i + 1) % plot.length];
    const u = norm(sub(q, p));
    const outN = scale(perp(u), -1);
    const ext = 6000;
    const a0 = add(p, scale(u, -ext)), b0 = add(q, scale(u, ext));
    const poly = [a0, b0, add(b0, scale(outN, e.road.width)), add(a0, scale(outN, e.road.width))];
    out.push({ id: `road-${i}`, materialId: 'asphalt', layer: 'road', faces: [face(ensureCCW(poly).map((v) => lift(v, -10)))] });
  });
  void V;
}
