/**
 * Roof engine. Generates roof planes, ridges, hips, valleys, fascia, gutters and
 * downpipes from the level outline (or an explicit rectangle) and a handful of
 * parameters (type, pitch, overhang, ridge axis).
 *
 * L- and T-shaped outlines are decomposed into overlapping rectangles; their
 * intersecting roof volumes produce the valleys.
 */
import type { Level, Roof } from '../model/types';
import type { Vec3 } from '../geometry/vec';
import { type Polygon, area, bbox, isAxisRect, offsetPolygonEdges, pointInPolygon, ensureCCW } from '../geometry/polygon';
import type { DerivedLevel } from './level';

export interface RoofPlane { pts: Vec3[]; kind: 'slope' | 'gable' | 'flat' | 'parapet' | 'fascia' | 'soffit' }
export interface Rect { x: number; y: number; w: number; h: number }

export interface RoofInfo {
  planes: RoofPlane[];
  /** Plan outline including overhang (for plans and site coverage). */
  outline: Polygon[];
  rects: Rect[];
  planArea: number;
  slopedArea: number;
  ridgeLength: number;
  hipLength: number;
  valleyLength: number;
  eaveLength: number;
  rakeLength: number;
  gutterLength: number;
  downpipes: number;
  baseZ: number;
  topZ: number;
  ridgeLines: [Vec3, Vec3][];
  notes: string[];
}

/** Cover an orthogonal polygon with a small set of maximal rectangles (overlaps allowed). */
export function coverRectangles(poly: Polygon): Rect[] {
  const p = ensureCCW(poly);
  if (isAxisRect(p)) { const b = bbox(p); return [{ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }]; }
  const xs = [...new Set(p.map((v) => Math.round(v.x)))].sort((a, b) => a - b);
  const ys = [...new Set(p.map((v) => Math.round(v.y)))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1 || nx * ny > 900) { const b = bbox(p); return [{ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }]; }
  const inside: boolean[][] = [];
  for (let i = 0; i < nx; i++) {
    inside[i] = [];
    for (let j = 0; j < ny; j++) inside[i][j] = pointInPolygon({ x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 }, p);
  }
  const covered = inside.map((col) => col.map(() => false));
  const rects: Rect[] = [];
  const cellArea = (i: number, j: number) => (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  for (let guard = 0; guard < 12; guard++) {
    let best: { i0: number; i1: number; j0: number; j1: number; gain: number; area: number } | null = null;
    for (let i0 = 0; i0 < nx; i0++) for (let j0 = 0; j0 < ny; j0++) {
      if (!inside[i0][j0]) continue;
      for (let i1 = i0; i1 < nx && inside[i1][j0]; i1++) {
        for (let j1 = j0; j1 < ny; j1++) {
          let ok = true;
          for (let i = i0; i <= i1 && ok; i++) if (!inside[i][j1]) ok = false;
          if (!ok) break;
          let gain = 0, ar = 0;
          for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = cellArea(i, j); ar += a; if (!covered[i][j]) gain += a; }
          if (gain > 0 && (!best || ar > best.area || (ar === best.area && gain > best.gain))) best = { i0, i1, j0, j1, gain, area: ar };
        }
      }
    }
    if (!best) break;
    for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) covered[i][j] = true;
    rects.push({ x: xs[best.i0], y: ys[best.j0], w: xs[best.i1 + 1] - xs[best.i0], h: ys[best.j1 + 1] - ys[best.j0] });
    if (covered.every((col, i) => col.every((c, j) => c || !inside[i][j]))) break;
  }
  return rects;
}

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export function computeRoof(roof: Roof, level: Level, dl: DerivedLevel, downpipeSpacing = 9000): RoofInfo {
  const baseZ = level.elevation + level.height;
  const notes: string[] = [];
  const footprint: Polygon[] = roof.footprint === 'auto'
    ? dl.footprint
    : [[V(roof.footprint.x, roof.footprint.y, 0), V(roof.footprint.x + roof.footprint.w, roof.footprint.y, 0), V(roof.footprint.x + roof.footprint.w, roof.footprint.y + roof.footprint.h, 0), V(roof.footprint.x, roof.footprint.y + roof.footprint.h, 0)]];
  const info: RoofInfo = {
    planes: [], outline: [], rects: [], planArea: 0, slopedArea: 0, ridgeLength: 0, hipLength: 0, valleyLength: 0,
    eaveLength: 0, rakeLength: 0, gutterLength: 0, downpipes: 0, baseZ, topZ: baseZ, ridgeLines: [], notes,
  };
  if (!footprint.length) return info;
  const o = roof.overhang;
  const pitch = (Math.max(0, Math.min(roof.pitch, 75)) * Math.PI) / 180;
  const tanP = Math.tan(pitch);

  if (roof.kind === 'flat' || pitch < 0.01) {
    for (const fp of footprint) {
      const slab = o > 0 ? offsetPolygonEdges(ensureCCW(fp), fp.map(() => -o)) : fp;
      info.outline.push(slab);
      const top = baseZ, bot = baseZ - roof.thickness;
      info.planes.push({ kind: 'flat', pts: slab.map((p) => V(p.x, p.y, top)) });
      info.planes.push({ kind: 'soffit', pts: [...slab].reverse().map((p) => V(p.x, p.y, bot)) });
      for (let i = 0; i < slab.length; i++) {
        const a = slab[i], b = slab[(i + 1) % slab.length];
        info.planes.push({ kind: 'fascia', pts: [V(a.x, a.y, bot), V(b.x, b.y, bot), V(b.x, b.y, top), V(a.x, a.y, top)] });
      }
      if (roof.parapetHeight > 0) {
        const ph = roof.parapetHeight;
        for (let i = 0; i < fp.length; i++) {
          const a = fp[i], b = fp[(i + 1) % fp.length];
          info.planes.push({ kind: 'parapet', pts: [V(a.x, a.y, top), V(b.x, b.y, top), V(b.x, b.y, top + ph), V(a.x, a.y, top + ph)] });
        }
        info.topZ = top + ph;
      } else info.topZ = top;
      const ar = area(slab);
      info.planArea += ar;
      info.slopedArea += ar;
      const per = slab.reduce((s, p, i) => s + Math.hypot(slab[(i + 1) % slab.length].x - p.x, slab[(i + 1) % slab.length].y - p.y), 0);
      info.eaveLength += per;
    }
    // Flat roofs drain to rainwater outlets: one per ~40 m² as a planning allowance.
    info.downpipes = Math.max(2, Math.ceil(info.planArea / 40e6));
    info.gutterLength = 0;
    return info;
  }

  const rects: Rect[] = [];
  for (const fp of footprint) {
    const r = coverRectangles(fp);
    if (r.length > 1) notes.push(`Outline split into ${r.length} roof volumes; intersections form valleys.`);
    rects.push(...r);
  }
  info.rects = rects;

  for (const r0 of rects) {
    const r = { x: r0.x - o, y: r0.y - o, w: r0.w + 2 * o, h: r0.h + 2 * o };
    const alongX = roof.kind === 'hip' || roof.kind === 'mansard' ? r.w >= r.h : roof.ridgeAxis === 'x' ? true : roof.ridgeAxis === 'y' ? false : r.w >= r.h;
    const L = alongX ? r.w : r.h; // length along ridge
    const S = alongX ? r.h : r.w; // span
    // Local → world: u along ridge, v across span.
    const P = (u: number, v: number, z: number): Vec3 => (alongX ? V(r.x + u, r.y + v, z) : V(r.x + v, r.y + u, z));
    const z0 = baseZ;
    info.outline.push([P(0, 0, 0), P(L, 0, 0), P(L, S, 0), P(0, S, 0)].map((p) => ({ x: p.x, y: p.y })));
    const planA = L * S;
    info.planArea += planA;

    if (roof.kind === 'gable') {
      const h = (S / 2) * tanP;
      const zr = z0 + h;
      info.planes.push({ kind: 'slope', pts: [P(0, 0, z0), P(L, 0, z0), P(L, S / 2, zr), P(0, S / 2, zr)] });
      info.planes.push({ kind: 'slope', pts: [P(L, S, z0), P(0, S, z0), P(0, S / 2, zr), P(L, S / 2, zr)] });
      // Gable infill sits on the wall line (no overhang).
      const gi = (u: number) => [P(u, o, z0 + (o * tanP)), P(u, S - o, z0 + (o * tanP)), P(u, S / 2, zr)];
      info.planes.push({ kind: 'gable', pts: gi(o) }, { kind: 'gable', pts: gi(L - o).reverse() });
      info.ridgeLength += L;
      info.rakeLength += 4 * Math.hypot(S / 2, h);
      info.eaveLength += 2 * L;
      info.slopedArea += planA / Math.cos(pitch);
      info.ridgeLines.push([P(0, S / 2, zr), P(L, S / 2, zr)]);
      info.topZ = Math.max(info.topZ, zr);
    } else if (roof.kind === 'shed') {
      const h = S * tanP;
      info.planes.push({ kind: 'slope', pts: [P(0, 0, z0), P(L, 0, z0), P(L, S, z0 + h), P(0, S, z0 + h)] });
      info.planes.push({ kind: 'gable', pts: [P(o, o, z0 + o * tanP), P(o, S - o, z0 + (S - o) * tanP), P(o, S - o, z0)] });
      info.planes.push({ kind: 'gable', pts: [P(L - o, S - o, z0), P(L - o, S - o, z0 + (S - o) * tanP), P(L - o, o, z0 + o * tanP)] });
      info.planes.push({ kind: 'gable', pts: [P(o, S - o, z0), P(o, S - o, z0 + (S - o) * tanP), P(L - o, S - o, z0 + (S - o) * tanP), P(L - o, S - o, z0)].reverse() });
      info.eaveLength += L;
      info.rakeLength += 2 * Math.hypot(S, h);
      info.ridgeLength += L; // high edge flashing
      info.slopedArea += planA / Math.cos(pitch);
      info.topZ = Math.max(info.topZ, z0 + h);
    } else if (roof.kind === 'butterfly') {
      const h = (S / 2) * tanP;
      info.planes.push({ kind: 'slope', pts: [P(0, 0, z0 + h), P(L, 0, z0 + h), P(L, S / 2, z0), P(0, S / 2, z0)] });
      info.planes.push({ kind: 'slope', pts: [P(L, S, z0 + h), P(0, S, z0 + h), P(0, S / 2, z0), P(L, S / 2, z0)] });
      for (const u of [o, L - o]) {
        const pts = [P(u, o, z0), P(u, S - o, z0), P(u, S - o, z0 + h - o * tanP), P(u, S / 2, z0), P(u, o, z0 + h - o * tanP)];
        info.planes.push({ kind: 'gable', pts: u === o ? pts : pts.reverse() });
      }
      info.valleyLength += L;
      info.rakeLength += 4 * Math.hypot(S / 2, h);
      info.eaveLength += 2 * L;
      info.slopedArea += planA / Math.cos(pitch);
      info.topZ = Math.max(info.topZ, z0 + h);
    } else {
      // hip (and mansard as a steep-lower hip)
      const mansard = roof.kind === 'mansard';
      let zBase = z0;
      let rr = { L, S, u0: 0, v0: 0 };
      if (mansard) {
        const steep = (70 * Math.PI) / 180;
        const hm = Math.min(1800, S * 0.3);
        const d = hm / Math.tan(steep);
        const pts0 = [P(0, 0, z0), P(L, 0, z0), P(L, S, z0), P(0, S, z0)];
        const pts1 = [P(d, d, z0 + hm), P(L - d, d, z0 + hm), P(L - d, S - d, z0 + hm), P(d, S - d, z0 + hm)];
        for (let i = 0; i < 4; i++) info.planes.push({ kind: 'slope', pts: [pts0[i], pts0[(i + 1) % 4], pts1[(i + 1) % 4], pts1[i]] });
        info.slopedArea += (planA - (L - 2 * d) * (S - 2 * d)) / Math.cos(steep);
        info.hipLength += 4 * Math.hypot(d * Math.SQRT2, hm);
        zBase = z0 + hm;
        rr = { L: L - 2 * d, S: S - 2 * d, u0: d, v0: d };
      }
      const h = (rr.S / 2) * tanP;
      const ridge = Math.max(0, rr.L - rr.S);
      const zr = zBase + h;
      const a = rr.u0, b = rr.v0;
      const c0 = P(a, b, zBase), c1 = P(a + rr.L, b, zBase), c2 = P(a + rr.L, b + rr.S, zBase), c3 = P(a, b + rr.S, zBase);
      const r0p = P(a + rr.S / 2, b + rr.S / 2, zr), r1p = P(a + rr.L - rr.S / 2, b + rr.S / 2, zr);
      info.planes.push({ kind: 'slope', pts: ridge > 1 ? [c0, c1, r1p, r0p] : [c0, c1, r0p] });
      info.planes.push({ kind: 'slope', pts: [c1, c2, r1p] });
      info.planes.push({ kind: 'slope', pts: ridge > 1 ? [c2, c3, r0p, r1p] : [c2, c3, r0p] });
      info.planes.push({ kind: 'slope', pts: [c3, c0, r0p] });
      info.ridgeLength += ridge;
      info.hipLength += 4 * Math.hypot((rr.S / 2) * Math.SQRT2, h);
      info.eaveLength += 2 * (L + S);
      info.slopedArea += (rr.L * rr.S) / Math.cos(pitch);
      if (ridge > 1) info.ridgeLines.push([r0p, r1p]);
      info.topZ = Math.max(info.topZ, zr);
    }
  }

  // Valleys at re-entrant corners of decomposed outlines.
  if (rects.length > 1) {
    const reflex = footprint.reduce((n, fp) => n + Math.max(0, fp.length - 4) / 2, 0);
    const halfSpan = Math.min(...rects.map((r) => Math.min(r.w, r.h))) / 2 + o;
    info.valleyLength += reflex * halfSpan * Math.sqrt(2 + tanP * tanP);
  }
  info.gutterLength = info.eaveLength;
  info.downpipes = Math.max(2, Math.ceil(info.gutterLength / downpipeSpacing));
  return info;
}
