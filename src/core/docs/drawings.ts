/**
 * Drawing generators — plans, site plan, roof plan, elevations and sections as
 * pure SVG strings in paper millimetres.
 *
 * Plans reuse the editor's symbol primitives (symbols.ts) so a printed plan is
 * the editor plan. Elevations and sections are projections of `buildSolids` —
 * the one 3D geometry — so drawings can never disagree with the model. Output
 * uses explicit presentation attributes only, so svg2pdf.js turns it into true
 * vector PDF with selectable text.
 */
import type { BuildingModel, FurnitureItem, Id, ProjectDoc, SiteFeature, Wall } from '../model/types';
import { byLevel, levelAbove, levelBelow, levelsSorted, openingsOf, isDoor } from '../model/query';
import { deriveLevel, type DerivedLevel } from '../derive/level';
import { buildSolids, type Solid, type SolidLayer } from '../derive/solids';
import { computeStair } from '../derive/stairs';
import { computeRoof } from '../derive/roof';
import { buildableZone } from '../derive/site';
import {
  type LandscapeAnalysis, analyzeLandscape, copingOf, groundFootprint, groundItems, hedgeSpecies, isAreaFeature, isClosedPath, isLinear, isTreeLike,
  landscapeKeys, surfaceMaterialId,
} from '../derive/landscape';
import { linearSpec } from '../derive/solids';
import type { Plant } from '../catalog/plants';
import { resolveRules, type RuleSet } from '../rules/rulesets';
import { getMaterial } from '../catalog/materials';
import { ASSET_BY_ID, isOutdoorAsset } from '../catalog/assets';
import {
  type BBox, type Polygon, type PolygonWithHoles, area, bbox, bboxUnion, centroid, difference, ensureCCW,
  lineClipPolygon, offsetPolygonEdges, pointInPolygon, union,
} from '../geometry/polygon';
import { type Vec2, type Vec3, add, dot, mid, norm, perp, rotate, scale, sub, dist } from '../geometry/vec';
import { formatArea, formatLength, type UnitSystem } from '../units';
import { type Prim, type Weight, columnSymbol, doorSymbol, furnitureSymbol, primPath, stairSymbol, windowSymbol } from './symbols';
import {
  GLASS, GREY, INK, LW, POCHE, circle, formatLevel, line, mix, northArrow, num, path, ringsD, text, textWidth,
} from './svg';

// ------------------------------------------------------------------ types

export interface DrawingResult {
  /** A `<g>` fragment whose content spans (0,0)–(width,height) in paper mm. */
  svg: string;
  width: number;
  height: number;
  /** Model extents (mm) and fixed paper padding — width = model.w / scale + pad.x. Lets callers fit any scale without redrawing. */
  model: { w: number; h: number };
  pad: { x: number; y: number };
}

export interface PlanResult extends DrawingResult {
  /** Plan coordinate (mm) that sits at paper (0,0), the drawing's top-left corner. */
  origin: Vec2;
}

export interface SectionCut { axis: 'x' | 'y'; at: number; label: string }

export interface PlanOptions {
  scale: number;
  furniture?: boolean;
  dimensions?: boolean;
  roomLabels?: boolean;
  /** Draw the plot, setbacks and site features around the building. */
  site?: boolean;
  /** Section cut markers to show on the plan. */
  cuts?: SectionCut[];
}

export type ElevationDir = 'north' | 'south' | 'east' | 'west';

export interface ViewOptions { scale: number; datums?: boolean }

// ---------------------------------------------------------- paper framing

/** Maps model (x right, y up) to paper (x right, y down) at a scale, with the paper origin at (x0, y0) in model. */
class Frame {
  constructor(public s: number, public x0: number, public y0: number) {}
  p(v: Vec2): Vec2 { return { x: (v.x - this.x0) / this.s, y: (this.y0 - v.y) / this.s }; }
  /** Transform for content authored in model mm with y negated (symbols' primPath convention). */
  get modelTransform(): string {
    return `translate(${num(-this.x0 / this.s)} ${num(this.y0 / this.s)}) scale(${+(1 / this.s).toPrecision(8)})`;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rulesOf = (doc: ProjectDoc): RuleSet => resolveRules(doc.meta.ruleSetId, doc.ruleOverrides ?? {});

/** Rings (model, y-up) → path data in model units with y negated, for use inside `Frame.modelTransform`. */
function modelD(rings: Polygon[]): string {
  return ringsD(rings.map((r) => r.map((p) => ({ x: p.x, y: -p.y }))));
}

/** Render symbol primitives: strokes inside the model-space group, text in paper space at a legible size. */
function primsSvg(prims: Prim[], f: Frame, color = INK): { model: string; paper: string } {
  const buckets = new Map<string, { d: string; w: Weight; dash?: boolean; fill?: string }>();
  let paper = '';
  for (const p of prims) {
    if (p.t === 'text') {
      const q = f.p(p.p);
      const size = clamp(p.size / f.s, 1.8, 2.5);
      paper += text(q.x, q.y + size * 0.35, p.text, { size, anchor: p.anchor ?? 'middle', bold: p.bold, fill: color });
      continue;
    }
    const fill = p.t === 'poly' || p.t === 'circle' ? p.fill : undefined;
    const key = `${p.w}|${p.dash ? 1 : 0}|${fill ?? ''}`;
    const bk = buckets.get(key);
    if (bk) bk.d += primPath(p);
    else buckets.set(key, { d: primPath(p), w: p.w, dash: p.dash, fill });
  }
  let model = '';
  for (const bk of buckets.values()) {
    const cut = bk.fill === 'cut';
    model += path(bk.d, {
      stroke: cut ? POCHE : color,
      width: LW[bk.w] * f.s,
      dash: bk.dash ? `${num(1.2 * f.s)} ${num(0.8 * f.s)}` : undefined,
      fill: bk.fill ? (cut ? POCHE : bk.fill) : 'none',
      fillOpacity: bk.fill && !cut ? 0.16 : undefined,
    });
  }
  return { model, paper };
}

function allFootprints(b: BuildingModel): Polygon[] {
  return levelsSorted(b).flatMap((l) => deriveLevel(b, l.id).footprint);
}

function modelBBox(b: BuildingModel, doc?: ProjectDoc): BBox {
  const fps = allFootprints(b);
  if (fps.length) return bbox(fps.flat());
  const pts = Object.values(b.walls).flatMap((w) => [w.a, w.b]);
  if (pts.length) return bbox(pts);
  if (doc?.site.boundary.length) return bbox(doc.site.boundary);
  return { minX: 0, minY: 0, maxX: 10000, maxY: 10000 };
}

// ------------------------------------------------------------ dimensions

/**
 * A dimension string: dimension line, extension lines from `from`, 45° ticks and
 * values written above the line. `axis` is the measured direction.
 */
function dimString(f: Frame, axis: 'x' | 'y', pts: number[], at: number, from: number, units: UnitSystem, size = 2.5): string {
  if (pts.length < 2) return '';
  let s = '';
  const tick = 0.9;
  if (axis === 'x') {
    const yl = f.p({ x: 0, y: at }).y;
    const yf = f.p({ x: 0, y: from }).y;
    const dir = Math.sign(yl - yf) || 1;
    const xs = pts.map((x) => f.p({ x, y: 0 }).x);
    s += line({ x: xs[0] - 1.5, y: yl }, { x: xs[xs.length - 1] + 1.5, y: yl }, LW.light);
    for (const x of xs) {
      s += line({ x, y: yf + dir * 1.5 }, { x, y: yl + dir * 1.5 }, LW.hairline, { stroke: GREY.dark });
      s += line({ x: x - tick, y: yl + tick }, { x: x + tick, y: yl - tick }, LW.heavy);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const lbl = formatLength(pts[i + 1] - pts[i], units);
      const L = xs[i + 1] - xs[i];
      const sz = textWidth(lbl, size) + 0.8 <= L ? size : textWidth(lbl, 1.8) + 0.6 <= L ? 1.8 : 0;
      if (sz) s += text((xs[i] + xs[i + 1]) / 2, yl - 0.9, lbl, { size: sz, anchor: 'middle' });
    }
  } else {
    const xl = f.p({ x: at, y: 0 }).x;
    const xf = f.p({ x: from, y: 0 }).x;
    const dir = Math.sign(xl - xf) || 1;
    const ys = pts.map((y) => f.p({ x: 0, y }).y);
    s += line({ x: xl, y: ys[0] + 1.5 }, { x: xl, y: ys[ys.length - 1] - 1.5 }, LW.light);
    for (const y of ys) {
      s += line({ x: xf + dir * 1.5, y }, { x: xl + dir * 1.5, y }, LW.hairline, { stroke: GREY.dark });
      s += line({ x: xl - tick, y: y + tick }, { x: xl + tick, y: y - tick }, LW.heavy);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const lbl = formatLength(pts[i + 1] - pts[i], units);
      const L = Math.abs(ys[i + 1] - ys[i]);
      const sz = textWidth(lbl, size) + 0.8 <= L ? size : textWidth(lbl, 1.8) + 0.6 <= L ? 1.8 : 0;
      if (sz) s += text(xl - 0.9, (ys[i] + ys[i + 1]) / 2, lbl, { size: sz, anchor: 'middle', rotate: -90 });
    }
  }
  return s;
}

const uniqSorted = (vals: number[], tol = 25): number[] => {
  const v = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of v) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
  return out;
};

/** Outward unit normal of a wall (towards the outside of the footprint). */
function wallOutward(w: Wall, footprint: Polygon[]): Vec2 {
  const d = norm(sub(w.b, w.a));
  const n = perp(d);
  const probe = add(mid(w.a, w.b), scale(n, w.thickness / 2 + 120));
  return footprint.some((p) => pointInPolygon(probe, p)) ? scale(n, -1) : n;
}

/** Overall + chain dimensions on all four sides of a level. */
function exteriorDimensions(b: BuildingModel, dl: DerivedLevel, f: Frame, units: UnitSystem): string {
  if (!dl.footprint.length) return '';
  const bb = bbox(dl.footprint.flat());
  const sides = [
    { axis: 'x' as const, out: { x: 0, y: -1 }, edge: bb.minY, sign: -1 },
    { axis: 'x' as const, out: { x: 0, y: 1 }, edge: bb.maxY, sign: 1 },
    { axis: 'y' as const, out: { x: -1, y: 0 }, edge: bb.minX, sign: -1 },
    { axis: 'y' as const, out: { x: 1, y: 0 }, edge: bb.maxX, sign: 1 },
  ];
  const s = f.s;
  let svg = '';
  const exterior = dl.walls.filter((w) => dl.exteriorWallIds.has(w.id));
  for (const side of sides) {
    const coord = (p: Vec2) => (side.axis === 'x' ? p.x : p.y);
    const pts: number[] = [];
    for (const fp of dl.footprint) {
      const ring = ensureCCW(fp);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const d = norm(sub(c, a));
        const outN = { x: d.y, y: -d.x };
        if (dot(outN, side.out) > 0.7) pts.push(coord(a), coord(c));
      }
    }
    for (const w of exterior) {
      if (dot(wallOutward(w, dl.footprint), side.out) < 0.7) continue;
      const d = norm(sub(w.b, w.a));
      for (const o of openingsOf(b, w.id)) {
        pts.push(coord(add(w.a, scale(d, o.offset - o.width / 2))), coord(add(w.a, scale(d, o.offset + o.width / 2))));
      }
    }
    const lo = side.axis === 'x' ? bb.minX : bb.minY, hi = side.axis === 'x' ? bb.maxX : bb.maxY;
    const chain = uniqSorted([lo, hi, ...pts.filter((v) => v >= lo - 1 && v <= hi + 1)]);
    const at1 = side.edge + side.sign * 9 * s, at2 = side.edge + side.sign * 16 * s;
    if (chain.length > 2) svg += dimString(f, side.axis, chain, at1, side.edge, units);
    svg += dimString(f, side.axis, [lo, hi], chain.length > 2 ? at2 : at1, side.edge, units);
  }
  return svg;
}

/** Section cut markers: heavy dash-dot ends outside the building, bubbles and view arrows. */
function cutMarkers(cuts: SectionCut[], bb: BBox, f: Frame): string {
  let s = '';
  const ext = 13 * f.s, stub = 9 * f.s;
  for (const c of cuts) {
    const ends: { p: Vec2; q: Vec2 }[] = c.axis === 'x'
      ? [{ p: { x: bb.minX - ext - stub, y: c.at }, q: { x: bb.minX - ext + stub * 0.3, y: c.at } }, { p: { x: bb.maxX + ext + stub, y: c.at }, q: { x: bb.maxX + ext - stub * 0.3, y: c.at } }]
      : [{ p: { x: c.at, y: bb.minY - ext - stub }, q: { x: c.at, y: bb.minY - ext + stub * 0.3 } }, { p: { x: c.at, y: bb.maxY + ext + stub }, q: { x: c.at, y: bb.maxY + ext - stub * 0.3 } }];
    // view direction: sections look towards +y (axis x) or +x (axis y)
    const look = c.axis === 'x' ? { x: 0, y: -1 } : { x: 1, y: 0 }; // paper space
    for (const e of ends) {
      const P = f.p(e.p), Q = f.p(e.q);
      s += line(P, Q, LW.cut, { dash: '4 1 0.8 1' });
      s += circle(P, 3, { fill: '#ffffff', stroke: INK, width: LW.medium });
      s += text(P.x, P.y + 1.1, c.label, { size: 3, anchor: 'middle', bold: true });
      const tip = add(P, scale(look, 6.2)), base = add(P, scale(look, 3));
      const side = perp(look);
      s += path(`M${num(tip.x)} ${num(tip.y)}L${num(base.x + side.x * 2)} ${num(base.y + side.y * 2)}L${num(base.x - side.x * 2)} ${num(base.y - side.y * 2)}Z`, { fill: INK });
    }
  }
  return s;
}

// ------------------------------------------------------------------- plan

export function drawPlan(doc: ProjectDoc, b: BuildingModel, levelId: Id, opts: PlanOptions): PlanResult {
  const s = opts.scale;
  const units = doc.meta.units;
  const level = b.levels[levelId];
  const dl = deriveLevel(b, levelId);
  const rules = rulesOf(doc);
  const dims = opts.dimensions !== false;
  let bb = modelBBox(b, doc);
  if (opts.site && doc.site.boundary.length) bb = bboxUnion(bb, bbox(doc.site.boundary));
  const pad = opts.cuts?.length ? 29 : dims ? 26 : 8;
  const f = new Frame(s, bb.minX - pad * s, bb.maxY + pad * s);
  const width = (bb.maxX - bb.minX) / s + 2 * pad, height = (bb.maxY - bb.minY) / s + 2 * pad;

  let model = '', paper = '';
  if (opts.site) model += siteUnderlay(doc, f);

  const prims: Prim[] = [];
  const furnPrims: Prim[] = [];
  if (opts.furniture !== false) {
    for (const it of byLevel(b.furniture, levelId)) {
      if (!opts.site && !dl.footprint.some((p) => pointInPolygon(it.position, p))) continue;
      furnPrims.push(...furnitureSymbol(it));
    }
  }
  const above = levelAbove(b, levelId), below = levelBelow(b, levelId);
  for (const st of byLevel(b.stairs, levelId)) {
    prims.push(...stairSymbol(computeStair(st, level, rules, above ? above.elevation - level.elevation : level.height)));
  }
  if (below) for (const st of byLevel(b.stairs, below.id)) {
    prims.push(...stairSymbol(computeStair(st, below, rules, level.elevation - below.elevation), { upper: true }));
  }
  const wallById = new Map(dl.walls.map((w) => [w.id, w]));
  for (const d of Object.values(b.doors)) { const w = wallById.get(d.wallId); if (w) prims.push(...doorSymbol(w, d)); }
  for (const n of Object.values(b.windows)) { const w = wallById.get(n.wallId); if (w) prims.push(...windowSymbol(w, n)); }
  for (const c of byLevel(b.columns, levelId)) prims.push(...columnSymbol(c));

  const fp = primsSvg(furnPrims, f, GREY.mid);
  const sp = primsSvg(prims, f, INK);
  model += fp.model;
  model += path(modelD(dl.poche.flatMap((p) => [p.outer, ...p.holes])), { fill: POCHE, evenodd: true, stroke: POCHE, width: LW.hairline * s });
  model += sp.model;
  paper += fp.paper + sp.paper;

  if (opts.roomLabels !== false) paper += roomLabels(dl, f, units);
  if (dims) paper += exteriorDimensions(b, dl, f, units);
  if (opts.cuts?.length && dl.footprint.length) paper += cutMarkers(opts.cuts, bbox(allFootprints(b).flat()), f);

  const svg = `<g><g transform="${f.modelTransform}">${model}</g>${paper}</g>`;
  return {
    svg, width, height, origin: { x: f.x0, y: f.y0 },
    model: { w: bb.maxX - bb.minX, h: bb.maxY - bb.minY }, pad: { x: 2 * pad, y: 2 * pad },
  };
}

function roomLabels(dl: DerivedLevel, f: Frame, units: UnitSystem): string {
  let s = '';
  for (const r of dl.rooms) {
    const name = r.name.toUpperCase();
    const wPaper = r.width / f.s, hPaper = r.depth / f.s;
    const fsName = clamp(Math.min(3, (wPaper * 0.88) / Math.max(1e-3, textWidth(name, 1, true))), 1.6, 3);
    const fsSub = clamp(fsName * 0.84, 1.6, 2.5);
    const lines: { t: string; size: number; bold?: boolean }[] = [{ t: name, size: fsName, bold: true }];
    const dimsTxt = r.isRect ? `${formatLength(r.width, units)} × ${formatLength(r.depth, units)}` : '';
    const areaTxt = formatArea(r.area, units);
    if (dimsTxt && textWidth(dimsTxt, fsSub) < wPaper * 0.95) lines.push({ t: dimsTxt, size: fsSub });
    if (textWidth(areaTxt, fsSub) < wPaper * 0.95) lines.push({ t: areaTxt, size: fsSub });
    let total = lines.reduce((a, l) => a + l.size * 1.3, 0);
    while (lines.length > 1 && total > hPaper * 0.9) { lines.pop(); total = lines.reduce((a, l) => a + l.size * 1.3, 0); }
    const c = f.p(r.labelPoint);
    let y = c.y - total / 2;
    for (const l of lines) {
      y += l.size * 1.3;
      s += text(c.x, y - l.size * 0.3, l.t, { size: l.size, anchor: 'middle', bold: l.bold, fill: l.bold ? INK : GREY.dark });
    }
  }
  return s;
}

// ------------------------------------------------------------------- site

const FEATURE_FILL: Record<string, string> = {
  pool: '#d3e6ec', pond: '#cfe2dc', driveway: '#eeece7', parking: '#f1efea', pathway: '#ebe8e1', patio: '#f0eadd', deck: '#efe5d8',
  gravel: '#efede6', lawn: '#eef2e6', bed: '#e2ead3', planter: '#e6eedc', tree: '#e6eedc',
};
/** Landscape ink: planting is drawn in a muted green so it reads apart from building linework. */
const PLANT_INK = '#3f5f3a';
const HEDGE = { edge: '#3f6f3a', body: '#8fb07a' };

/** Plot boundary + features drawn lightly behind a floor plan (in model space). */
function siteUnderlay(doc: ProjectDoc, f: Frame): string {
  let m = '';
  const s = f.s;
  for (const ft of Object.values(doc.site.features)) {
    if (ft.polygon) m += path(modelD([ft.polygon]), { fill: FEATURE_FILL[ft.kind] ?? 'none', stroke: GREY.soft, width: LW.hairline * s });
  }
  if (doc.site.boundary.length) m += path(modelD([doc.site.boundary]), { stroke: INK, width: LW.heavy * s, dash: `${num(6 * s)} ${num(1.2 * s)} ${num(1 * s)} ${num(1.2 * s)}` });
  return m;
}

export interface SiteOptions { scale: number; northArrow?: boolean }

export function drawSitePlan(doc: ProjectDoc, b: BuildingModel, opts: SiteOptions): DrawingResult {
  const s = opts.scale;
  const units = doc.meta.units;
  const site = doc.site;
  const plot = site.boundary.length >= 3 ? ensureCCW(site.boundary) : [];
  const ccwFlipped = site.boundary.length >= 3 && plot[0] !== site.boundary[0];
  const edgeOf = (i: number) => site.edges[ccwFlipped ? site.boundary.length - 2 - i < 0 ? site.boundary.length - 1 : site.boundary.length - 2 - i : i];

  // Road bands along road-facing edges (drawn to a capped depth so the plot stays the subject).
  const roads: { poly: Polygon; label: string; a: Vec2; b: Vec2; out: Vec2; depth: number }[] = [];
  plot.forEach((p, i) => {
    const e = edgeOf(i);
    if (!e?.road) return;
    const q = plot[(i + 1) % plot.length];
    const u = norm(sub(q, p));
    const out = { x: u.y, y: -u.x };
    const depth = Math.min(e.road.width, 7500);
    const a0 = add(p, scale(u, -3000)), b0 = add(q, scale(u, 3000));
    roads.push({ poly: [a0, b0, add(b0, scale(out, depth)), add(a0, scale(out, depth))], label: e.road.name, a: a0, b: b0, out, depth });
  });

  let bb = plot.length ? bbox(plot) : modelBBox(b, doc);
  for (const r of roads) bb = bboxUnion(bb, bbox(r.poly));
  bb = bboxUnion(bb, modelBBox(b, doc));
  const padL = 16, padR = opts.northArrow === false ? 16 : 28, padT = 16, padB = 16;
  const f = new Frame(s, bb.minX - padL * s, bb.maxY + padT * s);
  const width = (bb.maxX - bb.minX) / s + padL + padR, height = (bb.maxY - bb.minY) / s + padT + padB;
  const P = (v: Vec2) => f.p(v);
  const pd = (rings: Polygon[]) => ringsD(rings.map((r) => r.map(P)));
  // At key-plan scales (1:400 and smaller) small annotation is dropped so the plan stays legible.
  const detail = s < 400;
  let svg = '';

  for (const r of roads) {
    svg += path(pd([r.poly]), { fill: GREY.wash, stroke: GREY.soft, width: LW.light });
    const c0 = add(r.a, scale(r.out, r.depth / 2)), c1 = add(r.b, scale(r.out, r.depth / 2));
    svg += line(P(c0), P(c1), LW.hairline, { stroke: GREY.soft, dash: '6 3' });
    const c = P(mid(c0, c1));
    const ang = edgeAngle(P(r.a), P(r.b));
    svg += text(c.x, c.y - 1.2, r.label.toUpperCase(), { size: 2.5, anchor: 'middle', fill: GREY.dark, rotate: ang, bold: true });
  }

  // Lawn wash inside the plot, then hard features, pool, trees.
  if (plot.length) svg += path(pd([plot]), { fill: '#f3f5ee' });
  const features = Object.values(site.features);
  svg += siteSurfaces(features, f, detail, detail && 'all');
  // Buildable zone (setbacks) — dashed.
  if (plot.length) {
    const zone = buildableZone(site);
    svg += path(pd(zone.flatMap((z) => [z.outer, ...z.holes])), { stroke: GREY.mid, width: LW.light, dash: '2.4 1.2' });
  }

  // Building: union of all floors (filled), ground floor heavy, roof overhang dashed.
  const fps = allFootprints(b);
  const bldg = fps.length ? union(fps) : [];
  svg += path(pd(bldg.flatMap((p) => [p.outer, ...p.holes])), { fill: '#dcdad4', evenodd: true, stroke: INK, width: LW.cut });
  svg += hatchClip(bldg, f);
  const rules = rulesOf(doc);
  for (const roof of Object.values(b.roofs)) {
    const lv = b.levels[roof.levelId];
    if (!lv) continue;
    const info = computeRoof(roof, lv, deriveLevel(b, lv.id), rules.values.downpipeSpacing);
    svg += path(pd(info.outline), { stroke: GREY.dark, width: LW.light, dash: '1.6 1' });
  }
  if (bldg.length) {
    const big = bldg.reduce((m, p) => (area(p.outer) > area(m.outer) ? p : m));
    let c = centroid(big.outer);
    if (!pointInPolygon(c, big.outer)) c = big.outer[0];
    const levels = levelsSorted(b).filter((l) => l.elevation >= 0);
    const q = P(c);
    const tag = levels.length > 1 ? `G+${levels.length - 1}` : 'SINGLE STOREY';
    const lbl = doc.meta.name.toUpperCase();
    if (detail) {
      svg += rect2(q.x - textWidth(lbl, 3, true) / 2 - 2, q.y - 5.2, textWidth(lbl, 3, true) + 4, 9.6);
      svg += text(q.x, q.y - 1.2, lbl, { size: 3, anchor: 'middle', bold: true });
      svg += text(q.x, q.y + 2.8, `${tag} · FFL ${formatLevel(levels[0]?.elevation ?? 0, units)}`, { size: 2, anchor: 'middle', fill: GREY.dark });
    }
  }

  // Hedges, fences and garden walls, then planting and exterior furniture (cars, loungers) standing on the ground.
  svg += siteLinears(features, f);
  const outdoorPrims: Prim[] = [], plantPrims: Prim[] = [];
  for (const { item: it, asset } of groundItems(b)) {
    const indoors = fps.some((p) => pointInPolygon(it.position, p));
    // A tree in a courtyard still belongs on the site plan; a pot plant in the living room doesn't.
    if (asset.plant) { if (!indoors || !asset.plant.potted) plantPrims.push(...furnitureSymbol(it)); }
    else if (isOutdoorAsset(asset) && !indoors) outdoorPrims.push(...furnitureSymbol(it));
  }
  for (const ft of features) if (ft.kind === 'tree' && ft.position) svg += treeSymbol(P(ft.position), (ft.radius ?? 2000) / s);
  const op = primsSvg(outdoorPrims, f, GREY.mid), pp = primsSvg(plantPrims, f, PLANT_INK);
  svg += `<g transform="${f.modelTransform}">${op.model}${pp.model}</g>${op.paper}${pp.paper}`;

  // Plot boundary: thick dash-dot, edge lengths outside, setbacks inside.
  if (plot.length) {
    svg += path(pd([plot]), { stroke: INK, width: LW.cut, dash: '7 1.2 1 1.2' });
    plot.forEach((p, i) => {
      const q = plot[(i + 1) % plot.length];
      const u = norm(sub(q, p));
      const out = { x: u.y, y: -u.x };
      const m = mid(p, q);
      const ang = edgeAngle(P(p), P(q));
      const lo = P(add(m, scale(out, 3.2 * s)));
      svg += text(lo.x, lo.y + 0.9, formatLength(dist(p, q), units), { size: 2.5, anchor: 'middle', rotate: ang, bold: true });
      const sb = edgeOf(i)?.setback ?? 0;
      if (detail && sb > 0 && dist(p, q) / s > 30) {
        const li = P(add(add(m, scale(u, Math.min(dist(p, q) * 0.25, 4000))), scale(out, -sb / 2)));
        svg += text(li.x, li.y + 0.7, `${formatLength(sb, units)} SETBACK`, { size: 1.8, anchor: 'middle', rotate: ang, fill: GREY.mid });
      }
    });
  }

  if (opts.northArrow !== false) svg += northArrow(width - 13, 14, 12, site.northAngle);
  return { svg: `<g>${svg}</g>`, width, height, model: { w: bb.maxX - bb.minX, h: bb.maxY - bb.minY }, pad: { x: padL + padR, y: padT + padB } };
}

// ------------------------------------------------- landscape (site + L-101)

/** Ground surfaces in paper space: tint per kind plus the hatch or stipple that tells paving, gravel and planting apart. */
function siteSurfaces(features: SiteFeature[], f: Frame, detail: boolean, labels: 'all' | 'fit' | false): string {
  const s = f.s;
  const P = (v: Vec2) => f.p(v);
  const pd = (rings: Polygon[]) => ringsD(rings.map((r) => r.map(P)));
  let svg = '';
  for (const ft of features) {
    if (!isAreaFeature(ft)) continue;
    const poly = ft.polygon!;
    const water = ft.kind === 'pool' || ft.kind === 'pond';
    svg += path(pd([poly]), { fill: FEATURE_FILL[ft.kind] ?? 'none', stroke: water ? GREY.dark : GREY.soft, width: water ? LW.medium : LW.light });
    if (ft.kind === 'pool') svg += path(pd([offsetPolygonEdges(ensureCCW(poly), poly.map(() => 300))]), { stroke: GREY.mid, width: LW.hairline });
    if (water) {
      // Coping band around the water's edge, as built in 3D.
      const cp = copingOf(ft);
      if (cp && detail) svg += path(pd([cp.outer]), { stroke: GREY.mid, width: LW.hairline });
      if (ft.kind === 'pond' && detail) svg += path(pd([offsetPolygonEdges(ensureCCW(poly), poly.map(() => Math.min(400, 1.2 * s)))]), { stroke: GREY.soft, width: LW.hairline, dash: '1.2 0.8' });
    }
    if (detail) {
      if (ft.kind === 'deck') svg += hatchLines(poly, f, Math.max(600, 1.2 * s), 0, GREY.rule);
      // Paving joints: a square grid for slabs, a diagonal weave for brick and cobble.
      if (ft.kind === 'patio') {
        const weave = /brick|cobble|crazy/.test(surfaceMaterialId(ft));
        const gap = Math.max(600, 2.4 * s);
        svg += hatchLines(poly, f, gap, weave ? 45 : 0, GREY.rule) + hatchLines(poly, f, gap, weave ? 135 : 90, GREY.rule);
      }
      if (ft.kind === 'gravel') svg += stipple(poly, f, 1.5, GREY.soft, ft.id);
      if (ft.kind === 'bed' || ft.kind === 'planter') svg += stipple(poly, f, 2.1, '#7f9a66', ft.id);
    }
    if (ft.kind === 'parking') {
      const n = Math.max(1, Number(ft.props.spaces ?? 1));
      const fb = bbox(poly);
      for (let i = 1; i < n; i++) {
        const x = fb.minX + ((fb.maxX - fb.minX) * i) / n;
        svg += line(P({ x, y: fb.minY }), P({ x, y: fb.maxY }), LW.hairline, { stroke: GREY.soft });
      }
    }
    if (labels) {
      const c = P(centroid(poly));
      const lbl = ft.name.toUpperCase();
      const fb = bbox(poly);
      const tw = textWidth(lbl, 2), wP = (fb.maxX - fb.minX) / s, hP = (fb.maxY - fb.minY) / s;
      // A name that won't fit across a narrow strip (side path, border) is turned to run along it.
      const across = tw <= wP - 1, along = !across && tw <= hP - 1 && wP >= 3;
      // On the landscape plan a bed is named by its planting tags, and a label that can't fit is left off.
      if (labels === 'fit' && ((!across && !along) || ft.kind === 'bed' || ft.kind === 'planter')) continue;
      // Hatched and stippled surfaces get a knock-out behind the name so it stays readable.
      const patterned = ft.kind === 'patio' || ft.kind === 'gravel' || ft.kind === 'bed' || ft.kind === 'planter' || ft.kind === 'deck';
      const body = (patterned && (across || along) ? rect2(c.x - tw / 2 - 0.8, c.y - 1.5, tw + 1.6, 3.2) : '')
        + text(c.x, c.y + 0.9, lbl, { size: 2, anchor: 'middle', fill: GREY.dark });
      svg += along ? `<g transform="rotate(-90 ${num(c.x)} ${num(c.y)})">${body}</g>` : body;
    }
  }
  return svg;
}

/** Scattered dots inside a polygon (spacing in paper mm) — deterministic, and capped so a big lawn-sized bed stays light. */
function stipple(poly: Polygon, f: Frame, spacing: number, color: string, seedKey: string): string {
  const bb = bbox(poly);
  const step = Math.max(spacing * f.s, Math.sqrt(area(poly) / 450));
  let h = 2166136261;
  for (let i = 0; i < seedKey.length; i++) { h ^= seedKey.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) | 0; return (h >>> 0) / 4294967296; };
  let d = '';
  let row = 0;
  for (let y = bb.minY + step / 2; y < bb.maxY; y += step, row++) {
    for (let x = bb.minX + (row % 2 ? step : step / 2); x < bb.maxX; x += step) {
      const p = { x: x + (rnd() - 0.5) * step * 0.6, y: y + (rnd() - 0.5) * step * 0.6 };
      if (!pointInPolygon(p, poly)) continue;
      const q = f.p(p);
      d += `M${num(q.x)} ${num(q.y)}h0.05`;
    }
  }
  // Very short round-capped strokes: one path element draws every dot, in the browser and in the PDF.
  return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.24" stroke-linecap="round"/>` : '';
}

/** Hedges as a thick green band, fences as a thin line with post ticks, garden walls as a double line. */
function siteLinears(features: SiteFeature[], f: Frame): string {
  const s = f.s;
  let svg = '';
  for (const ft of features) {
    if (!isLinear(ft)) continue;
    const closed = isClosedPath(ft.path!);
    const pts = (closed ? ft.path!.slice(0, -1) : ft.path!).map((p) => f.p(p));
    const d = ringsD([pts], closed);
    const { width } = linearSpec(ft);
    if (ft.kind === 'hedge') {
      const w = Math.max(1.1, width / s);
      svg += path(d, { stroke: HEDGE.edge, width: w + 0.3, join: 'round' }) + path(d, { stroke: HEDGE.body, width: w, join: 'round' });
    } else if (ft.kind === 'wall') {
      // Two strokes make the double line and keep the corners mitred.
      const w = Math.max(0.9, width / s);
      svg += path(d, { stroke: INK, width: w, join: 'miter' }) + path(d, { stroke: '#ffffff', width: Math.max(0.3, w - 2 * LW.light), join: 'miter' });
    } else {
      svg += path(d, { stroke: GREY.dark, width: LW.medium, join: 'miter' });
      const gap = Math.max(2400, 3 * s);
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = ft.path![i], b = ft.path![i + 1] ?? ft.path![0];
        const len = dist(a, b);
        if (len < 1) continue;
        const u = norm(sub(b, a)), v = perp(u);
        const k = Math.max(1, Math.round(len / gap));
        for (let j = 0; j <= k; j++) {
          const c = add(a, scale(u, (len / k) * j));
          svg += line(f.p(add(c, scale(v, 0.7 * s))), f.p(add(c, scale(v, -0.7 * s))), LW.light, { stroke: GREY.dark });
        }
      }
    }
  }
  return svg;
}

export interface LandscapePlanOptions {
  scale: number;
  /** Species key tags beside the planting (default on). */
  tags?: boolean;
  /** North arrow in the drawing's top-right corner (default on). */
  northArrow?: boolean;
}

/**
 * Landscape plan (sheet L-101): plot, ground-floor outline, every surface,
 * hedge, fence and wall, and each plant drawn with its symbol and keyed to the
 * planting schedule by a short species tag.
 */
export function drawLandscapePlan(doc: ProjectDoc, b: BuildingModel, opts: LandscapePlanOptions, la: LandscapeAnalysis = analyzeLandscape(doc, b)): DrawingResult {
  const s = opts.scale;
  const site = doc.site;
  const plot = site.boundary.length >= 3 ? ensureCCW(site.boundary) : [];
  const features = Object.values(site.features);
  const footprint = groundFootprint(b);
  const items = groundItems(b);

  let bb = plot.length ? bbox(plot) : modelBBox(b, doc);
  const extra = [...footprint.flat(), ...features.flatMap((ft) => ft.polygon ?? ft.path ?? []), ...items.filter((x) => x.asset.plant).map((x) => x.item.position)];
  if (extra.length) bb = bboxUnion(bb, bbox(extra));
  const pad = 12, padR = opts.northArrow === false ? pad : 26;
  const f = new Frame(s, bb.minX - pad * s, bb.maxY + pad * s);
  const width = (bb.maxX - bb.minX) / s + pad + padR, height = (bb.maxY - bb.minY) / s + 2 * pad;
  const P = (v: Vec2) => f.p(v);
  const pd = (rings: Polygon[]) => ringsD(rings.map((r) => r.map(P)));
  const detail = s < 400;
  let svg = '';

  if (plot.length) svg += path(pd([plot]), { fill: '#f3f5ee' });
  svg += siteSurfaces(features, f, detail, detail && 'fit');

  // The house: outline and a light tone only — this sheet is about what surrounds it.
  if (footprint.length) {
    const bldg = union(footprint);
    svg += path(pd(bldg.flatMap((p) => [p.outer, ...p.holes])), { fill: '#e4e2dc', evenodd: true, stroke: INK, width: LW.heavy });
    const big = bldg.reduce((m, p) => (area(p.outer) > area(m.outer) ? p : m));
    let c = centroid(big.outer);
    if (!pointInPolygon(c, big.outer)) c = big.outer[0];
    if (detail) svg += text(P(c).x, P(c).y + 1, 'HOUSE', { size: 2.6, anchor: 'middle', bold: true, fill: GREY.dark });
  }

  svg += siteLinears(features, f);

  const outdoorPrims: Prim[] = [], plantPrims: Prim[] = [];
  const drawn: { item: FurnitureItem; plant: Plant }[] = [];
  for (const { item, asset } of items) {
    const indoors = footprint.some((p) => pointInPolygon(item.position, p));
    if (asset.plant) {
      if (indoors && asset.plant.potted) continue;
      plantPrims.push(...furnitureSymbol(item));
      drawn.push({ item, plant: asset.plant });
    } else if (isOutdoorAsset(asset) && !indoors) outdoorPrims.push(...furnitureSymbol(item));
  }
  for (const ft of features) if (ft.kind === 'tree' && ft.position) svg += treeSymbol(P(ft.position), (ft.radius ?? 2000) / s);
  const op = primsSvg(outdoorPrims, f, GREY.mid), pp = primsSvg(plantPrims, f, PLANT_INK);
  svg += `<g transform="${f.modelTransform}">${op.model}${pp.model}</g>${op.paper}${pp.paper}`;

  if (plot.length) svg += path(pd([plot]), { stroke: INK, width: LW.cut, dash: '7 1.2 1 1.2' });

  if (opts.tags !== false) svg += plantTags(drawn, features, landscapeKeys(la), f);
  if (opts.northArrow !== false) svg += northArrow(width - 12, 14, 12, site.northAngle);

  return { svg: `<g>${svg}</g>`, width, height, model: { w: bb.maxX - bb.minX, h: bb.maxY - bb.minY }, pad: { x: pad + padR, y: 2 * pad } };
}

/**
 * Species keys on the plan. Every tree and palm carries its own tag; small
 * plants are tagged once per group ("IXCO ×12") so a border of forty shrubs
 * doesn't bury the drawing in text. Hedges are tagged once along their run.
 */
function plantTags(drawn: { item: FurnitureItem; plant: Plant }[], features: SiteFeature[], keys: Map<string, string>, f: Frame): string {
  let svg = '';
  const size = 1.9;
  const tag = (x: number, y: number, t: string, anchor: 'start' | 'middle' = 'start') => {
    const w = textWidth(t, size, true);
    svg += rect2((anchor === 'middle' ? x - w / 2 : x) - 0.5, y - size * 0.82, w + 1, size * 1.16);
    svg += text(x, y, t, { size, bold: true, anchor, fill: PLANT_INK });
  };
  const radius = (it: FurnitureItem, p: Plant) => (it.size?.w ?? ASSET_BY_ID[it.assetId]?.size.w ?? p.spread) / 2;
  const bySpecies = new Map<string, { item: FurnitureItem; plant: Plant }[]>();
  for (const d of drawn) {
    const key = keys.get(d.plant.id);
    if (!key) continue;
    if (isTreeLike(d.plant)) {
      // Just below the trunk, inside the canopy.
      const c = f.p(d.item.position);
      tag(c.x, c.y + Math.min(3.4, Math.max(2.4, (radius(d.item, d.plant) / f.s) * 0.45)), key, 'middle');
    } else (bySpecies.get(d.plant.id) ?? bySpecies.set(d.plant.id, []).get(d.plant.id)!).push(d);
  }
  for (const [id, list] of bySpecies) {
    const plant = list[0].plant;
    const reach = Math.max(2000, plant.spread * 1.5, plant.spacing * 2.5);
    const groups: FurnitureItem[][] = [];
    for (const { item } of list) {
      const g = groups.find((grp) => grp.some((o) => dist(o.position, item.position) <= reach));
      if (g) g.push(item); else groups.push([item]);
    }
    for (const g of groups) {
      const cx = g.reduce((t, o) => t + o.position.x, 0) / g.length, cy = g.reduce((t, o) => t + o.position.y, 0) / g.length;
      const rep = g.reduce((m, o) => (dist(o.position, { x: cx, y: cy }) < dist(m.position, { x: cx, y: cy }) ? o : m));
      const c = f.p(rep.position);
      tag(c.x + radius(rep, plant) / f.s + 0.9, c.y + size * 0.35, g.length > 1 ? `${keys.get(id)} ×${g.length}` : keys.get(id)!);
    }
  }
  for (const ft of features) {
    if (ft.kind !== 'hedge' || !isLinear(ft)) continue;
    const key = keys.get(hedgeSpecies(ft).id);
    if (!key) continue;
    let best = { a: ft.path![0], b: ft.path![1], len: 0 };
    for (let i = 0; i + 1 < ft.path!.length; i++) { const len = dist(ft.path![i], ft.path![i + 1]); if (len > best.len) best = { a: ft.path![i], b: ft.path![i + 1], len }; }
    const c = f.p(mid(best.a, best.b));
    tag(c.x, c.y + size * 0.35, `${key} HEDGE`, 'middle');
  }
  return svg;
}

const rect2 = (x: number, y: number, w: number, h: number) =>
  `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="#ffffff" fill-opacity="0.85"/>`;

/** Text rotation (degrees) along a paper-space edge, kept upright. */
function edgeAngle(a: Vec2, b: Vec2): number {
  let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (ang > 89.9) ang -= 180;
  if (ang < -90.1) ang += 180;
  return ang;
}

function treeSymbol(c: Vec2, r: number): string {
  let s = circle(c, r, { fill: '#e3ebd8', stroke: GREY.mid, width: LW.hairline });
  s += circle(c, r * 0.62, { stroke: GREY.soft, width: LW.hairline, dash: '0.8 0.8' });
  s += line({ x: c.x - 0.8, y: c.y }, { x: c.x + 0.8, y: c.y }, LW.hairline, { stroke: GREY.mid });
  s += line({ x: c.x, y: c.y - 0.8 }, { x: c.x, y: c.y + 0.8 }, LW.hairline, { stroke: GREY.mid });
  return s;
}

/** Parallel hatch lines across a polygon (model spacing), clipped by scanline. */
function hatchLines(poly: Polygon, f: Frame, spacing: number, angleDeg: number, color: string): string {
  const a = (angleDeg * Math.PI) / 180;
  const d = { x: Math.cos(a), y: Math.sin(a) }, n = perp(d);
  const ts = poly.map((p) => dot(p, n));
  const lo = Math.min(...ts), hi = Math.max(...ts);
  let s = '';
  for (let t = lo + spacing / 2; t < hi; t += spacing) {
    const p0 = scale(n, t);
    for (const [u0, u1] of lineClipPolygon(p0, d, poly)) s += line(f.p(add(p0, scale(d, u0))), f.p(add(p0, scale(d, u1))), LW.hairline, { stroke: color });
  }
  return s;
}

/** 45° hatch over the building footprint (site plan convention for proposed work). */
function hatchClip(polys: PolygonWithHoles[], f: Frame): string {
  let s = '';
  const spacing = 2.2 * f.s;
  for (const p of polys) {
    const ring = p.outer;
    const n = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, d = perp(n);
    const ts = ring.map((q) => dot(q, n));
    const lo = Math.min(...ts), hi = Math.max(...ts);
    for (let t = lo + spacing / 2; t < hi; t += spacing) {
      const p0 = scale(n, t);
      let iv = lineClipPolygon(p0, d, ring);
      for (const h of p.holes) iv = subtractIntervals(iv, lineClipPolygon(p0, d, h));
      for (const [u0, u1] of iv) s += line(f.p(add(p0, scale(d, u0))), f.p(add(p0, scale(d, u1))), LW.hairline, { stroke: GREY.soft });
    }
  }
  return s;
}

function subtractIntervals(a: [number, number][], b: [number, number][]): [number, number][] {
  let out = a;
  for (const [h0, h1] of b) {
    const next: [number, number][] = [];
    for (const [s0, s1] of out) {
      if (h1 <= s0 || h0 >= s1) { next.push([s0, s1]); continue; }
      if (h0 > s0) next.push([s0, h0]);
      if (h1 < s1) next.push([h1, s1]);
    }
    out = next;
  }
  return out;
}

// -------------------------------------------------------------- roof plan

export function drawRoofPlan(doc: ProjectDoc, b: BuildingModel, opts: { scale: number; dimensions?: boolean }): DrawingResult {
  const s = opts.scale;
  const units = doc.meta.units;
  const rules = rulesOf(doc);
  const infos = Object.values(b.roofs).flatMap((roof) => {
    const lv = b.levels[roof.levelId];
    if (!lv) return [];
    const dl = deriveLevel(b, lv.id);
    return [{ roof, lv, dl, info: computeRoof(roof, lv, dl, rules.values.downpipeSpacing) }];
  });
  let bb = modelBBox(b, doc);
  for (const r of infos) if (r.info.outline.length) bb = bboxUnion(bb, bbox(r.info.outline.flat()));
  const dims = opts.dimensions !== false;
  const pad = dims ? 22 : 10;
  const f = new Frame(s, bb.minX - pad * s, bb.maxY + pad * s);
  const width = (bb.maxX - bb.minX) / s + 2 * pad, height = (bb.maxY - bb.minY) / s + 2 * pad;
  const P = (v: Vec2) => f.p(v);
  const pd = (rings: Polygon[]) => ringsD(rings.map((r) => r.map(P)));
  let svg = '';

  // Lower floors that extend beyond the roof read as light outlines (terraces / lower roofs).
  const fps = allFootprints(b);
  if (fps.length) svg += path(pd(union(fps).flatMap((p) => [p.outer, ...p.holes])), { stroke: GREY.soft, width: LW.light });

  for (const { roof, dl, info } of infos) {
    if (roof.kind === 'flat' || roof.pitch < 0.6) {
      svg += path(pd(info.outline), { fill: '#f1efeb', stroke: INK, width: LW.medium });
      if (roof.parapetHeight > 0) for (const fp of dl.footprint) {
        const outer = ensureCCW(fp);
        const inner = offsetPolygonEdges(outer, outer.map(() => 115));
        svg += path(pd([outer, [...inner].reverse()]), { fill: '#d5d2cb', evenodd: true, stroke: INK, width: LW.heavy });
      }
      // Falls towards the long edges, rainwater outlets spaced along them.
      for (const fp of dl.footprint) {
        const fb = bbox(fp);
        const c = centroid(fp);
        const alongX = fb.maxX - fb.minX >= fb.maxY - fb.minY;
        const dirs: Vec2[] = alongX ? [{ x: 0, y: 1 }, { x: 0, y: -1 }] : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
        const reach = (alongX ? fb.maxY - fb.minY : fb.maxX - fb.minX) * 0.3;
        for (const d of dirs) svg += slopeArrow(P(add(c, scale(d, reach * 0.15))), P(add(c, scale(d, reach))), 'FALL 1:100');
        const nOut = Math.max(1, Math.round(info.downpipes / 2));
        for (const d of dirs) for (let i = 0; i < nOut; i++) {
          const t = (i + 0.5) / nOut;
          const p = alongX
            ? { x: fb.minX + (fb.maxX - fb.minX) * t, y: d.y > 0 ? fb.maxY - 300 : fb.minY + 300 }
            : { x: d.x > 0 ? fb.maxX - 300 : fb.minX + 300, y: fb.minY + (fb.maxY - fb.minY) * t };
          if (!pointInPolygon(p, fp)) continue;
          svg += circle(P(p), 1.1, { fill: '#ffffff', stroke: INK, width: LW.light });
          const lp = P(sub(p, scale(d, 5.6 * s)));
          svg += text(lp.x, lp.y + 0.7, 'RWO', { size: 1.8, anchor: 'middle', fill: GREY.dark });
        }
      }
    } else {
      const slopes = info.planes.filter((p) => p.kind === 'slope');
      for (const pl of slopes) svg += path(pd([pl.pts]), { fill: '#efece6', stroke: INK, width: LW.medium, join: 'round' });
      for (const [a, c] of info.ridgeLines) svg += line(P(a), P(c), LW.heavy);
      svg += path(pd(info.outline), { stroke: INK, width: LW.heavy });
      for (const pl of slopes) {
        const n = polyNormal(pl.pts);
        const h = norm({ x: n.x, y: n.y });
        if (Math.hypot(h.x, h.y) < 0.5) continue;
        const c = centroid(pl.pts);
        const span = Math.sqrt(area(pl.pts)) * 0.28;
        svg += slopeArrow(P(add(c, scale(h, -span / 2))), P(add(c, scale(h, span / 2))), `${num(roof.pitch)}°`);
      }
    }
  }
  if (dims && infos.length) {
    const ob = bbox(infos.flatMap((r) => r.info.outline.flat()));
    svg += dimString(f, 'x', [ob.minX, ob.maxX], ob.minY - 9 * s, ob.minY, units);
    svg += dimString(f, 'y', [ob.minY, ob.maxY], ob.minX - 9 * s, ob.minX, units);
  }
  return { svg: `<g>${svg}</g>`, width, height, model: { w: bb.maxX - bb.minX, h: bb.maxY - bb.minY }, pad: { x: 2 * pad, y: 2 * pad } };
}

function polyNormal(pts: Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    nx += (a.y - c.y) * (a.z + c.z); ny += (a.z - c.z) * (a.x + c.x); nz += (a.x - c.x) * (a.y + c.y);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  // planes are wound counter-clockwise from above; flip so the normal points up
  const sgn = nz < 0 ? -1 : 1;
  return { x: (sgn * nx) / l, y: (sgn * ny) / l, z: (sgn * nz) / l };
}

/** Arrow from a to b (paper) with a label beside it — falls and slopes point downhill. */
function slopeArrow(a: Vec2, b: Vec2, label: string): string {
  const d = norm(sub(b, a)), n = perp(d);
  const h = 1.6;
  let s = line(a, b, LW.light);
  s += path(`M${num(b.x)} ${num(b.y)}L${num(b.x - d.x * h * 1.6 + n.x * h * 0.6)} ${num(b.y - d.y * h * 1.6 + n.y * h * 0.6)}L${num(b.x - d.x * h * 1.6 - n.x * h * 0.6)} ${num(b.y - d.y * h * 1.6 - n.y * h * 0.6)}Z`, { fill: INK });
  const m = mid(a, b);
  const ang = edgeAngle(a, b);
  const off = add(m, scale(perp({ x: Math.cos((ang * Math.PI) / 180), y: Math.sin((ang * Math.PI) / 180) }), -1.2));
  s += text(off.x, off.y, label, { size: 2, anchor: 'middle', rotate: ang, fill: GREY.dark });
  return s;
}

// ------------------------------------------------- elevations and sections

interface Basis { v: Vec3; sx: (p: Vec3) => number; depth: (p: Vec3) => number }

const BASIS: Record<ElevationDir, Basis> = {
  // "South elevation" looks north at the south face: the viewer stands at −y.
  south: { v: { x: 0, y: 1, z: 0 }, sx: (p) => p.x, depth: (p) => p.y },
  north: { v: { x: 0, y: -1, z: 0 }, sx: (p) => -p.x, depth: (p) => -p.y },
  east: { v: { x: -1, y: 0, z: 0 }, sx: (p) => p.y, depth: (p) => -p.x },
  west: { v: { x: 1, y: 0, z: 0 }, sx: (p) => -p.y, depth: (p) => p.x },
};

/** Layers built from closed, outward-wound prisms — safe to back-face cull. */
const CLOSED: Set<SolidLayer> = new Set(['slab', 'column', 'frame', 'glass', 'door', 'parapet', 'beam', 'stair']);

interface ProjFace { rings: Vec2[][]; depth: number; layer: SolidLayer; color: string; facing: number }

function clipRing(ring: Vec3[], depth: (p: Vec3) => number, at: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i], prev = ring[(i + ring.length - 1) % ring.length];
    const dc = depth(cur) - at, dp = depth(prev) - at;
    const cross = () => {
      const t = dp / (dp - dc);
      return { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t, z: prev.z + (cur.z - prev.z) * t };
    };
    if (dc >= 0) { if (dp < 0) out.push(cross()); out.push(cur); } else if (dp >= 0) out.push(cross());
  }
  return out;
}

function projectSolids(solids: Solid[], basis: Basis, clipAt?: number): ProjFace[] {
  const out: ProjFace[] = [];
  for (const sol of solids) {
    const closed = CLOSED.has(sol.layer);
    const color = sol.layer === 'glass' ? GLASS : getMaterial(sol.materialId).color;
    for (const fc of sol.faces) {
      const nd = dot3(fc.normal, basis.v);
      if (Math.abs(nd) < 0.02) continue; // edge-on
      if (closed && nd > 0) continue; // back face
      let rings: Vec3[][] = [fc.outer, ...(fc.holes ?? [])];
      if (clipAt !== undefined && fc.outer.some((p) => basis.depth(p) < clipAt)) {
        const outer = clipRing(fc.outer, basis.depth, clipAt);
        if (outer.length < 3) continue;
        rings = [outer, ...(fc.holes ?? []).map((r) => clipRing(r, basis.depth, clipAt)).filter((r) => r.length >= 3)];
      }
      const outer = rings[0];
      let dsum = 0;
      for (const p of outer) dsum += basis.depth(p);
      const proj = rings.map((r) => r.map((p) => ({ x: basis.sx(p), y: p.z })));
      if (area(proj[0]) < 50) continue;
      out.push({ rings: proj, depth: dsum / outer.length, layer: sol.layer, color, facing: Math.abs(nd) });
    }
  }
  const order: Partial<Record<SolidLayer, number>> = { wall: 0, slab: 1, column: 2, roof: 3, parapet: 3, glass: 4, door: 5, frame: 6 };
  out.sort((a, b) => b.depth - a.depth || (order[a.layer] ?? 0) - (order[b.layer] ?? 0));
  return out;
}

const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

function facesSvg(faces: ProjFace[], f: Frame, lighten: number, lineColor: string): string {
  if (!faces.length) return '';
  let dmin = Infinity, dmax = -Infinity;
  for (const fc of faces) { dmin = Math.min(dmin, fc.depth); dmax = Math.max(dmax, fc.depth); }
  const range = Math.max(1, dmax - dmin);
  let s = '';
  for (const fc of faces) {
    const d = ringsD(fc.rings.map((r) => r.map((p) => f.p(p))));
    if (fc.layer === 'glass') {
      s += path(d, { fill: GLASS, fillOpacity: 0.5, evenodd: true, stroke: GREY.mid, width: LW.hairline });
      continue;
    }
    const k = (fc.depth - dmin) / range;
    const t = clamp(lighten - 0.3 * k - 0.1 * (1 - fc.facing), 0.2, 0.92);
    const thin = fc.layer === 'frame' || fc.layer === 'door';
    s += path(d, { fill: mix(fc.color, t), evenodd: true, stroke: lineColor, width: thin ? LW.hairline : LW.light, join: 'round' });
  }
  return s;
}

interface Datum { z: number; label: string }

function levelDatums(b: BuildingModel, rules: RuleSet): Datum[] {
  const out: Datum[] = [{ z: 0, label: 'GROUND' }];
  for (const l of levelsSorted(b)) out.push({ z: l.elevation, label: l.name.toUpperCase() });
  for (const roof of Object.values(b.roofs)) {
    const lv = b.levels[roof.levelId];
    if (!lv) continue;
    const info = computeRoof(roof, lv, deriveLevel(b, lv.id), rules.values.downpipeSpacing);
    if (roof.kind === 'flat') {
      out.push({ z: info.baseZ, label: 'TERRACE' });
      if (roof.parapetHeight > 0) out.push({ z: info.topZ, label: 'TOP OF PARAPET' });
    } else out.push({ z: info.topZ, label: 'RIDGE' });
  }
  return out.sort((a, b) => a.z - b.z).filter((d, i, arr) => i === 0 || Math.abs(d.z - arr[i - 1].z) > 1);
}

/** Datum lines with markers and labels on the right of a projected view. */
function datumsSvg(datums: Datum[], f: Frame, xRightModel: number, units: UnitSystem): string {
  let s = '';
  const x0 = f.p({ x: xRightModel, y: 0 }).x + 2;
  let prevY = Infinity, col = 0;
  for (const d of datums) {
    const y = f.p({ x: 0, y: d.z }).y;
    col = prevY - y < 3.4 ? col + 1 : 0;
    prevY = y;
    const xm = x0 + 6 + col * 22;
    s += line({ x: x0, y }, { x: xm + 18, y }, LW.hairline, { stroke: GREY.mid, dash: '1.6 0.8' });
    s += path(`M${num(xm - 1.1)} ${num(y - 1.9)}L${num(xm + 1.1)} ${num(y - 1.9)}L${num(xm)} ${num(y)}Z`, { fill: INK });
    s += text(xm + 1.8, y - 0.7, `${d.label} ${formatLevel(d.z, units)}`, { size: 1.9, fill: INK, bold: false });
  }
  return s;
}

const DATUM_PAD = 58;

const ELEV_EXCLUDE: Set<SolidLayer> = new Set(['floor', 'site', 'ground', 'road', 'water', 'stair']);

export function drawElevation(doc: ProjectDoc, b: BuildingModel, dir: ElevationDir, opts: ViewOptions): DrawingResult {
  const s = opts.scale;
  const units = doc.meta.units;
  const rules = rulesOf(doc);
  const basis = BASIS[dir];
  const solids = buildSolids(doc, b, rules, { includeSite: false });

  // Only exterior walls whose outside faces the viewer can be seen; interior
  // walls would only show through glazing, which presentation elevations omit.
  const visibleWalls = new Set<Id>();
  const wallOf = new Map<Id, Id>();
  const fpAll: Polygon[] = [];
  for (const l of levelsSorted(b)) {
    const dl = deriveLevel(b, l.id);
    fpAll.push(...dl.footprint);
    for (const w of dl.walls) {
      if (!dl.exteriorWallIds.has(w.id) && w.kind !== 'exterior' && w.kind !== 'parapet' && w.kind !== 'compound') continue;
      const out = wallOutward(w, dl.footprint);
      if (out.x * basis.v.x + out.y * basis.v.y < -0.2) visibleWalls.add(w.id);
    }
  }
  for (const d of Object.values(b.doors)) wallOf.set(d.id, d.wallId);
  for (const n of Object.values(b.windows)) wallOf.set(n.id, n.wallId);
  const keep = solids.filter((sol) => {
    if (ELEV_EXCLUDE.has(sol.layer)) return false;
    const ref = sol.ref;
    if (sol.layer === 'wall' && ref?.kind === 'wall') return visibleWalls.has(ref.id);
    if (ref && (ref.kind === 'door' || ref.kind === 'window')) return visibleWalls.has(wallOf.get(ref.id) ?? '');
    if (sol.layer === 'column' && ref?.kind === 'column') {
      const c = b.columns[ref.id];
      return !!c && fpAll.some((fp) => nearEdge(c.position, fp, Math.max(c.width, c.depth)));
    }
    return true;
  });
  const faces = projectSolids(keep, basis);
  return projectedView(b, faces, s, units, rules, opts.datums !== false, 0.6, GREY.dark);
}

function nearEdge(p: Vec2, poly: Polygon, tol: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const ab = sub(c, a);
    const t = clamp(dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab)), 0, 1);
    if (dist(p, add(a, scale(ab, t))) <= tol) return true;
  }
  return false;
}

/** Shared framing for elevations and sections: faces + optional poché + ground line + datums. */
function projectedView(
  b: BuildingModel, faces: ProjFace[], s: number, units: UnitSystem, rules: RuleSet,
  datums: boolean, lighten: number, lineColor: string, poche: PolygonWithHoles[] = [], overlay?: (f: Frame) => string,
): DrawingResult {
  let bb: BBox = { minX: Infinity, minY: 0, maxX: -Infinity, maxY: -Infinity };
  for (const fc of faces) for (const p of fc.rings[0]) {
    if (p.x < bb.minX) bb.minX = p.x; if (p.x > bb.maxX) bb.maxX = p.x;
    if (p.y > bb.maxY) bb.maxY = p.y; if (p.y < bb.minY) bb.minY = p.y;
  }
  for (const pc of poche) for (const p of pc.outer) {
    if (p.x < bb.minX) bb.minX = p.x; if (p.x > bb.maxX) bb.maxX = p.x;
    if (p.y > bb.maxY) bb.maxY = p.y; if (p.y < bb.minY) bb.minY = p.y;
  }
  if (!Number.isFinite(bb.minX)) bb = { minX: 0, minY: 0, maxX: 10000, maxY: 6000 };
  const buildingRight = bb.maxX;
  const groundExt = 1500;
  bb.minX -= groundExt; bb.maxX += groundExt;
  bb.minY = Math.min(bb.minY, -300);
  const padL = 6, padT = 6, padB = 6, padR = datums ? DATUM_PAD : 6;
  const f = new Frame(s, bb.minX - padL * s, bb.maxY + padT * s);
  const width = (bb.maxX - bb.minX) / s + padL + padR, height = (bb.maxY - bb.minY) / s + padT + padB;
  let svg = facesSvg(faces, f, lighten, lineColor);
  if (poche.length) svg += path(ringsD(poche.flatMap((p) => [p.outer, ...p.holes]).map((r) => r.map((q) => f.p(q)))), { fill: POCHE, evenodd: true, stroke: POCHE, width: LW.hairline });
  if (overlay) svg += overlay(f);
  // Ground line: heavy, with a light earth band below.
  const g0 = f.p({ x: bb.minX, y: 0 }), g1 = f.p({ x: bb.maxX, y: 0 });
  svg += `<rect x="${num(g0.x)}" y="${num(g0.y)}" width="${num(g1.x - g0.x)}" height="${num(Math.min(2.2, 300 / s))}" fill="${GREY.faint}"/>`;
  svg += line(g0, g1, LW.cut);
  if (datums) svg += datumsSvg(levelDatums(b, rules), f, buildingRight + groundExt, units);
  return { svg: `<g>${svg}</g>`, width, height, model: { w: bb.maxX - bb.minX, h: bb.maxY - bb.minY }, pad: { x: padL + padR, y: padT + padB } };
}

const SECTION_EXCLUDE: Set<SolidLayer> = new Set(['floor', 'site', 'ground', 'road', 'water']);

/**
 * Building section. `axis: 'x'` cuts along the x axis at y = `at` and looks
 * north (+y); `axis: 'y'` cuts along the y axis at x = `at` and looks east (+x).
 */
export function drawSection(doc: ProjectDoc, b: BuildingModel, axis: 'x' | 'y', at: number, opts: ViewOptions): DrawingResult {
  const s = opts.scale;
  const units = doc.meta.units;
  const rules = rulesOf(doc);
  const basis = axis === 'x' ? BASIS.south : BASIS.west;
  const solids = buildSolids(doc, b, rules, { includeSite: false }).filter((sol) => !SECTION_EXCLUDE.has(sol.layer));
  // Faces that lie entirely before the cut are dropped; the rest are clipped to the far half-space.
  const beyond = solids.filter((sol) => sol.faces.some((fc) => fc.outer.some((p) => basis.depth(p) > at + 1)));
  const faces = projectSolids(beyond, basis, at);
  const cut = sectionCut(b, rules, axis, at);
  const labels = (f: Frame) => cut.glyphs.map((g) => g(f)).join('') + sectionRoomLabels(b, axis, at, f);
  return projectedView(b, faces, s, units, rules, opts.datums !== false, 0.8, GREY.mid, cut.poche, labels);
}

/** The cut line in plan: p(t) = P0 + t·D, with t equal to the view's screen x. */
function cutLine(axis: 'x' | 'y', at: number): { P0: Vec2; D: Vec2 } {
  return axis === 'x' ? { P0: { x: 0, y: at }, D: { x: 1, y: 0 } } : { P0: { x: at, y: 0 }, D: { x: 0, y: -1 } };
}

function intervalsWithHoles(P0: Vec2, D: Vec2, p: PolygonWithHoles | Polygon): [number, number][] {
  if (Array.isArray(p)) return lineClipPolygon(P0, D, p);
  let iv = lineClipPolygon(P0, D, p.outer);
  for (const h of p.holes) iv = subtractIntervals(iv, lineClipPolygon(P0, D, h));
  return iv;
}

const R = (t0: number, t1: number, z0: number, z1: number): Polygon => [{ x: t0, y: z0 }, { x: t1, y: z0 }, { x: t1, y: z1 }, { x: t0, y: z1 }];

/** Cross-sections of walls, slabs, roofs, stairs, columns and beams at the cut plane, in (screen x, z). */
function sectionCut(b: BuildingModel, rules: RuleSet, axis: 'x' | 'y', at: number): { poche: PolygonWithHoles[]; glyphs: ((f: Frame) => string)[] } {
  const { P0, D } = cutLine(axis, at);
  const parts: (Polygon | PolygonWithHoles)[] = [];
  const glyphs: ((f: Frame) => string)[] = [];
  const levels = levelsSorted(b);
  levels.forEach((level, idx) => {
    const dl = deriveLevel(b, level.id);
    const above = levelAbove(b, level.id);
    const topGap = above ? above.slabThickness : 0;
    const E = level.elevation;
    // walls (net of openings)
    for (const w of dl.walls) {
      const ol = dl.outlines.get(w.id);
      if (!ol) continue;
      const iv = lineClipPolygon(P0, D, ol.quad);
      if (!iv.length) continue;
      const z0 = E + w.baseOffset, z1 = E + (w.height ?? level.height - topGap);
      const d = norm(sub(w.b, w.a));
      const sp = dot(sub(P0, w.a), d), k = dot(D, d);
      for (const [t0, t1] of iv) {
        const holes: Polygon[] = [];
        for (const o of openingsOf(b, w.id)) {
          const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
          let u0: number, u1: number;
          if (Math.abs(k) < 1e-6) { if (sp <= s0 || sp >= s1) continue; u0 = t0; u1 = t1; }
          else {
            const ta = (s0 - sp) / k, tb = (s1 - sp) / k;
            u0 = Math.max(t0, Math.min(ta, tb)); u1 = Math.min(t1, Math.max(ta, tb));
            if (u1 - u0 < 1) continue;
          }
          const zb = z0 + (isDoor(o) ? 0 : o.sill);
          const zt = Math.min(z1 - 20, zb + o.height);
          holes.push(R(u0 - 1, u1 + 1, zb, zt));
          if (!isDoor(o) && Math.abs(k) < 0.5) {
            const tm = (t0 + t1) / 2;
            glyphs.push((f) => {
              const a = f.p({ x: tm - 40, y: zt }), c = f.p({ x: tm + 40, y: zb });
              return `<rect x="${num(a.x)}" y="${num(a.y)}" width="${num(c.x - a.x)}" height="${num(c.y - a.y)}" fill="#ffffff" stroke="${INK}" stroke-width="${LW.hairline}"/>` +
                line(f.p({ x: tm, y: zb }), f.p({ x: tm, y: zt }), LW.hairline, { stroke: GREY.mid });
            });
          }
        }
        const r = R(t0, t1, z0, z1);
        if (holes.length) parts.push(...difference([r], holes)); else parts.push(r);
      }
    }
    // slab (with stair voids from the level below)
    const below = idx > 0 ? levels[idx - 1] : undefined;
    const voids: Polygon[] = below ? byLevel(b.stairs, below.id).map((st) => computeStair(st, below, rules).footprint) : [];
    const slabs: PolygonWithHoles[] = voids.length ? difference(dl.footprint, voids) : dl.footprint.map((p) => ({ outer: p, holes: [] }));
    for (const sl of slabs) for (const [t0, t1] of intervalsWithHoles(P0, D, sl)) parts.push(R(t0, t1, E - level.slabThickness, E));
    // stairs
    for (const st of byLevel(b.stairs, level.id)) {
      const info = computeStair(st, level, rules, above ? above.elevation - E : level.height);
      for (const step of info.steps) {
        const zTop = E + step.z;
        const zBot = st.kind === 'spiral' ? zTop - 60 : step.landing ? zTop - 200 : Math.max(E, zTop - info.riser - 180);
        for (const [t0, t1] of lineClipPolygon(P0, D, step.poly)) parts.push(R(t0, t1, zBot, zTop));
      }
    }
    // columns
    for (const c of byLevel(b.columns, level.id)) {
      const poly: Polygon = c.shape === 'round'
        ? Array.from({ length: 20 }, (_, i) => ({ x: c.position.x + (Math.cos((i / 20) * Math.PI * 2) * c.width) / 2, y: c.position.y + (Math.sin((i / 20) * Math.PI * 2) * c.width) / 2 }))
        : [{ x: -c.width / 2, y: -c.depth / 2 }, { x: c.width / 2, y: -c.depth / 2 }, { x: c.width / 2, y: c.depth / 2 }, { x: -c.width / 2, y: c.depth / 2 }].map((p) => add(rotate(p, (c.rotation * Math.PI) / 180), c.position));
      for (const [t0, t1] of lineClipPolygon(P0, D, poly)) parts.push(R(t0, t1, E, E + level.height - topGap));
    }
    for (const bm of byLevel(b.beams, level.id)) {
      const u = norm(sub(bm.b, bm.a)), n = perp(u);
      const h = bm.width / 2;
      const poly = [add(bm.a, scale(n, -h)), add(bm.b, scale(n, -h)), add(bm.b, scale(n, h)), add(bm.a, scale(n, h))];
      const top = E + level.height;
      for (const [t0, t1] of lineClipPolygon(P0, D, poly)) parts.push(R(t0, t1, top - bm.depth, top));
    }
  });
  // roofs
  for (const roof of Object.values(b.roofs)) {
    const lv = b.levels[roof.levelId];
    if (!lv) continue;
    const dl = deriveLevel(b, lv.id);
    const info = computeRoof(roof, lv, dl, rules.values.downpipeSpacing);
    if (roof.kind === 'flat') {
      for (const o of info.outline) for (const [t0, t1] of lineClipPolygon(P0, D, o)) parts.push(R(t0, t1, info.baseZ - roof.thickness, info.baseZ));
      if (roof.parapetHeight > 0) for (const fp of dl.footprint) for (const [t0, t1] of lineClipPolygon(P0, D, fp)) {
        parts.push(R(t0, Math.min(t1, t0 + 115), info.baseZ, info.baseZ + roof.parapetHeight));
        parts.push(R(Math.max(t0, t1 - 115), t1, info.baseZ, info.baseZ + roof.parapetHeight));
      }
    } else {
      const basis = axis === 'x' ? BASIS.south : BASIS.west;
      const tv = roof.thickness / Math.max(0.2, Math.cos((roof.pitch * Math.PI) / 180));
      for (const pl of info.planes.filter((p) => p.kind === 'slope')) {
        const hits: Vec2[] = [];
        for (let i = 0; i < pl.pts.length; i++) {
          const a = pl.pts[i], c = pl.pts[(i + 1) % pl.pts.length];
          const da = basis.depth(a) - at, dc = basis.depth(c) - at;
          if ((da < 0) === (dc < 0) || da === dc) continue;
          const t = da / (da - dc);
          const p = { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, z: a.z + (c.z - a.z) * t };
          hits.push({ x: basis.sx(p), y: p.z });
        }
        if (hits.length < 2) continue;
        hits.sort((p, q) => p.x - q.x);
        const A = hits[0], B = hits[hits.length - 1];
        parts.push([A, B, { x: B.x, y: B.y - tv }, { x: A.x, y: A.y - tv }]);
      }
    }
  }
  let poche: PolygonWithHoles[] = [];
  try { poche = parts.length ? union(parts) : []; } catch { poche = parts.map((p) => (Array.isArray(p) ? { outer: p, holes: [] } : p)); }
  return { poche, glyphs };
}

function sectionRoomLabels(b: BuildingModel, axis: 'x' | 'y', at: number, f: Frame): string {
  const { P0, D } = cutLine(axis, at);
  let s = '';
  for (const l of levelsSorted(b)) {
    const dl = deriveLevel(b, l.id);
    for (const r of dl.rooms) for (const [t0, t1] of lineClipPolygon(P0, D, r.polygon)) {
      const name = r.name.toUpperCase();
      const size = 2;
      if (textWidth(name, size, true) + 2 > (t1 - t0) / f.s) continue;
      const p = f.p({ x: (t0 + t1) / 2, y: l.elevation + Math.min(1100, (l.height - l.slabThickness) * 0.4) });
      s += text(p.x, p.y, name, { size, anchor: 'middle', bold: true, fill: GREY.dark });
    }
  }
  return s;
}

/**
 * Pick a cut position near the middle of the building that passes through the
 * stair and as many openings as possible, and never runs inside a wall.
 */
export function suggestSectionCut(b: BuildingModel, axis: 'x' | 'y', rules?: RuleSet): number {
  const bb = modelBBox(b);
  const lo = axis === 'x' ? bb.minY : bb.minX, hi = axis === 'x' ? bb.maxY : bb.maxX;
  const span = hi - lo;
  if (span <= 0) return lo;
  let best = (lo + hi) / 2, bestScore = -Infinity;
  const levels = levelsSorted(b);
  const stairs = Object.values(b.stairs).flatMap((st) => {
    const lv = b.levels[st.levelId];
    return lv ? [computeStair(st, lv, rules ?? resolveRules('in-generic')).footprint] : [];
  });
  for (let t = lo + span * 0.3; t <= lo + span * 0.7; t += Math.max(50, span / 160)) {
    const { P0, D } = cutLine(axis, t);
    let score = -Math.abs(t - (lo + hi) / 2) / span; // prefer the middle
    for (const fp of stairs) if (lineClipPolygon(P0, D, fp).length) score += 3;
    for (const l of levels) {
      const dl = deriveLevel(b, l.id);
      for (const w of dl.walls) {
        const ol = dl.outlines.get(w.id);
        if (!ol) continue;
        const d = norm(sub(w.b, w.a));
        const k = Math.abs(dot(D, d));
        const iv = lineClipPolygon(P0, D, ol.quad);
        if (!iv.length) continue;
        if (k > 0.9) { score -= 10; continue; } // running inside a parallel wall
        const sp = dot(sub(P0, w.a), d);
        for (const o of openingsOf(b, w.id)) if (sp > o.offset - o.width / 2 + 100 && sp < o.offset + o.width / 2 - 100) score += isDoor(o) ? 0.6 : 1;
      }
    }
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return Math.round(best);
}

/** Building bounding box (all levels) — used by sheet layout and cut placement. */
export function buildingBounds(b: BuildingModel): BBox {
  return modelBBox(b);
}

