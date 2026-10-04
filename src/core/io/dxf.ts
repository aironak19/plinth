/**
 * DXF interoperability (ASCII, AutoCAD R12 flavour).
 *
 * Export writes one level as a layered 2D drawing — cut walls (poché outlines),
 * doors, glazing, stairs, furniture, room text, overall dimensions and the plot
 * boundary — using the same plan symbols as the editor and printed sheets.
 *
 * Import is deliberately tolerant: it reads LINE / LWPOLYLINE / POLYLINE / ARC /
 * CIRCLE from the ENTITIES section, honours $INSUNITS, and then recognises
 * walls as pairs of parallel face lines. Everything it cannot interpret as a
 * wall is kept as an underlay to trace over, so nothing in the file is lost.
 */
import type { BuildingModel, Id, ProjectDoc } from '../model/types';
import { byLevel, levelAbove, levelBelow } from '../model/query';
import { deriveLevel } from '../derive/level';
import { computeStair } from '../derive/stairs';
import { resolveRules } from '../rules/rulesets';
import { columnSymbol, doorSymbol, furnitureSymbol, stairSymbol, windowSymbol, type Prim } from '../docs/symbols';
import { bbox } from '../geometry/polygon';
import { type Vec2, add, cross, dist, dot, lineIntersection, norm, perp, scale, sub } from '../geometry/vec';
import { formatArea, formatLength } from '../units';

// ------------------------------------------------------------------ export

const LAYERS: { name: string; color: number; ltype?: string }[] = [
  { name: '0', color: 7 },
  { name: 'A-WALL', color: 7 },
  { name: 'A-DOOR', color: 2 },
  { name: 'A-GLAZ', color: 4 },
  { name: 'A-STRS', color: 3 },
  { name: 'A-FURN', color: 8 },
  { name: 'S-COLS', color: 1 },
  { name: 'A-AREA-IDEN', color: 7 },
  { name: 'A-ANNO-DIMS', color: 6 },
  { name: 'C-PROP', color: 5, ltype: 'PHANTOM' },
];

/** DXF R12 text is single-byte: map the few typographic characters we use to ASCII / DXF control codes. */
function dxfText(s: string): string {
  return s
    .replace(/×/g, 'x').replace(/²/g, '2').replace(/³/g, '3').replace(/½/g, '-1/2').replace(/±/g, '%%p').replace(/°/g, '%%d')
    .replace(/[—–]/g, '-').replace(/·/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7e]/g, '?');
}

const f = (v: number) => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
};

class DxfWriter {
  private out: string[] = [];
  private min = { x: Infinity, y: Infinity };
  private max = { x: -Infinity, y: -Infinity };
  g(code: number, value: string | number) { this.out.push(String(code), typeof value === 'number' ? f(value) : value); }
  private track(p: Vec2) {
    if (p.x < this.min.x) this.min.x = p.x; if (p.y < this.min.y) this.min.y = p.y;
    if (p.x > this.max.x) this.max.x = p.x; if (p.y > this.max.y) this.max.y = p.y;
  }
  private head(type: string, layer: string, ltype?: string) { this.g(0, type); this.g(8, layer); if (ltype) this.g(6, ltype); }
  line(layer: string, a: Vec2, b: Vec2, ltype?: string) {
    this.head('LINE', layer, ltype);
    this.g(10, a.x); this.g(20, a.y); this.g(30, 0); this.g(11, b.x); this.g(21, b.y); this.g(31, 0);
    this.track(a); this.track(b);
  }
  poly(layer: string, pts: Vec2[], closed: boolean, ltype?: string) {
    if (pts.length < 2) return;
    this.head('POLYLINE', layer, ltype);
    this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, 0); this.g(70, closed ? 1 : 0);
    for (const p of pts) { this.g(0, 'VERTEX'); this.g(8, layer); this.g(10, p.x); this.g(20, p.y); this.g(30, 0); this.track(p); }
    this.g(0, 'SEQEND'); this.g(8, layer);
  }
  arc(layer: string, c: Vec2, r: number, a0: number, a1: number, ltype?: string) {
    this.head('ARC', layer, ltype);
    this.g(10, c.x); this.g(20, c.y); this.g(30, 0); this.g(40, r);
    const deg = (a: number) => ((((a * 180) / Math.PI) % 360) + 360) % 360;
    this.g(50, deg(a0)); this.g(51, deg(a1));
    this.track({ x: c.x - r, y: c.y - r }); this.track({ x: c.x + r, y: c.y + r });
  }
  circle(layer: string, c: Vec2, r: number, ltype?: string) {
    this.head('CIRCLE', layer, ltype);
    this.g(10, c.x); this.g(20, c.y); this.g(30, 0); this.g(40, r);
    this.track({ x: c.x - r, y: c.y - r }); this.track({ x: c.x + r, y: c.y + r });
  }
  text(layer: string, p: Vec2, h: number, s: string, align: 'left' | 'center' = 'center', rotation = 0) {
    this.head('TEXT', layer);
    this.g(10, p.x); this.g(20, p.y); this.g(30, 0); this.g(40, h); this.g(1, dxfText(s));
    if (rotation) this.g(50, rotation);
    if (align === 'center') { this.g(72, 1); this.g(11, p.x); this.g(21, p.y); this.g(31, 0); }
    this.track(p);
  }
  prims(layer: string, prims: Prim[]) {
    for (const p of prims) {
      const lt = 'dash' in p && p.dash ? 'DASHED' : undefined;
      switch (p.t) {
        case 'line': this.line(layer, p.a, p.b, lt); break;
        case 'poly': this.poly(layer, p.pts, p.closed, lt); break;
        case 'arc': this.arc(layer, p.c, p.r, p.a0, p.a1, lt); break;
        case 'circle': this.circle(layer, p.c, p.r, lt); break;
        case 'text': this.text(layer, p.p, p.size, p.text); break;
      }
    }
  }
  document(): string {
    const ents = this.out;
    this.out = [];
    const mn = Number.isFinite(this.min.x) ? this.min : { x: 0, y: 0 }, mx = Number.isFinite(this.max.x) ? this.max : { x: 0, y: 0 };
    this.g(0, 'SECTION'); this.g(2, 'HEADER');
    this.g(9, '$ACADVER'); this.g(1, 'AC1009');
    this.g(9, '$INSUNITS'); this.g(70, 4);
    this.g(9, '$MEASUREMENT'); this.g(70, 1);
    this.g(9, '$EXTMIN'); this.g(10, mn.x); this.g(20, mn.y); this.g(30, 0);
    this.g(9, '$EXTMAX'); this.g(10, mx.x); this.g(20, mx.y); this.g(30, 0);
    this.g(9, '$LTSCALE'); this.g(40, 1);
    this.g(0, 'ENDSEC');
    this.g(0, 'SECTION'); this.g(2, 'TABLES');
    const ltypes: [string, string, number[]][] = [['CONTINUOUS', 'Solid line', []], ['DASHED', '__ __ __', [150, -75]], ['PHANTOM', '____ _ _ ____', [1200, -150, 150, -150, 150, -150]]];
    this.g(0, 'TABLE'); this.g(2, 'LTYPE'); this.g(70, ltypes.length);
    for (const [name, desc, pat] of ltypes) {
      this.g(0, 'LTYPE'); this.g(2, name); this.g(70, 0); this.g(3, desc); this.g(72, 65); this.g(73, pat.length);
      this.g(40, pat.reduce((a, v) => a + Math.abs(v), 0));
      for (const v of pat) this.g(49, v);
    }
    this.g(0, 'ENDTAB');
    this.g(0, 'TABLE'); this.g(2, 'LAYER'); this.g(70, LAYERS.length);
    for (const l of LAYERS) { this.g(0, 'LAYER'); this.g(2, l.name); this.g(70, 0); this.g(62, l.color); this.g(6, l.ltype ?? 'CONTINUOUS'); }
    this.g(0, 'ENDTAB');
    this.g(0, 'ENDSEC');
    this.g(0, 'SECTION'); this.g(2, 'BLOCKS'); this.g(0, 'ENDSEC');
    this.g(0, 'SECTION'); this.g(2, 'ENTITIES');
    const head = this.out;
    const tail = ['0', 'ENDSEC', '0', 'EOF'];
    return [...head, ...ents, ...tail].join('\n') + '\n';
  }
}

/** Export one level as an ASCII DXF (R12, millimetres). */
export function exportDxf(doc: ProjectDoc, b: BuildingModel, levelId: Id): string {
  const w = new DxfWriter();
  const level = b.levels[levelId];
  const dl = deriveLevel(b, levelId);
  const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides ?? {});
  const units = doc.meta.units;

  for (const p of dl.poche) for (const ring of [p.outer, ...p.holes]) w.poly('A-WALL', ring, true);
  const wallById = new Map(dl.walls.map((x) => [x.id, x]));
  for (const d of Object.values(b.doors)) { const wl = wallById.get(d.wallId); if (wl) w.prims('A-DOOR', doorSymbol(wl, d)); }
  for (const n of Object.values(b.windows)) { const wl = wallById.get(n.wallId); if (wl) w.prims('A-GLAZ', windowSymbol(wl, n)); }
  const above = levelAbove(b, levelId), below = levelBelow(b, levelId);
  for (const st of byLevel(b.stairs, levelId)) w.prims('A-STRS', stairSymbol(computeStair(st, level, rules, above ? above.elevation - level.elevation : level.height)));
  if (below) for (const st of byLevel(b.stairs, below.id)) w.prims('A-STRS', stairSymbol(computeStair(st, below, rules, level.elevation - below.elevation), { upper: true }));
  for (const c of byLevel(b.columns, levelId)) w.prims('S-COLS', columnSymbol(c));
  for (const it of byLevel(b.furniture, levelId)) w.prims('A-FURN', furnitureSymbol(it));
  for (const r of dl.rooms) {
    w.text('A-AREA-IDEN', add(r.labelPoint, { x: 0, y: 120 }), 250, r.name.toUpperCase());
    w.text('A-AREA-IDEN', add(r.labelPoint, { x: 0, y: -260 }), 160, formatArea(r.area, units));
  }
  // Overall dimensions (south and west), drawn as plain lines + text so every CAD package reads them.
  if (dl.footprint.length) {
    const bb = bbox(dl.footprint.flat());
    const y = bb.minY - 1200, x = bb.minX - 1200;
    w.line('A-ANNO-DIMS', { x: bb.minX, y }, { x: bb.maxX, y });
    for (const xx of [bb.minX, bb.maxX]) { w.line('A-ANNO-DIMS', { x: xx, y: bb.minY - 200 }, { x: xx, y: y - 200 }); w.line('A-ANNO-DIMS', { x: xx - 90, y: y - 90 }, { x: xx + 90, y: y + 90 }); }
    w.text('A-ANNO-DIMS', { x: (bb.minX + bb.maxX) / 2, y: y + 120 }, 200, formatLength(bb.maxX - bb.minX, units));
    w.line('A-ANNO-DIMS', { x, y: bb.minY }, { x, y: bb.maxY });
    for (const yy of [bb.minY, bb.maxY]) { w.line('A-ANNO-DIMS', { x: bb.minX - 200, y: yy }, { x: x - 200, y: yy }); w.line('A-ANNO-DIMS', { x: x - 90, y: yy - 90 }, { x: x + 90, y: yy + 90 }); }
    w.text('A-ANNO-DIMS', { x: x - 120, y: (bb.minY + bb.maxY) / 2 }, 200, formatLength(bb.maxY - bb.minY, units), 'center', 90);
  }
  if (doc.site.boundary.length >= 3) w.poly('C-PROP', doc.site.boundary, true, 'PHANTOM');
  return w.document();
}

// ------------------------------------------------------------------ import

export interface DxfEntity { layer: string; type: 'line' | 'polyline'; pts: Vec2[]; closed?: boolean }

export interface ParsedDxf {
  /** Human-readable unit name, e.g. "millimetres" or "unitless (assumed metres)". */
  units: string;
  /** Multiply drawing coordinates by this to get millimetres. */
  unitScale: number;
  layers: string[];
  blocks: number;
  /** Geometry in drawing units (see `unitScale`). Arcs and circles arrive as polylines. */
  entities: DxfEntity[];
}

const INSUNITS: Record<number, [string, number]> = {
  1: ['inches', 25.4], 2: ['feet', 304.8], 3: ['miles', 1609344], 4: ['millimetres', 1], 5: ['centimetres', 10], 6: ['metres', 1000],
  7: ['kilometres', 1e6], 8: ['microinches', 25.4e-6], 9: ['mils', 0.0254], 10: ['yards', 914.4], 14: ['decimetres', 100],
};

export function parseDxf(text: string): ParsedDxf {
  const raw = text.split(/\r\n|\r|\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = parseInt(raw[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; } // resynchronise on stray blank lines
    pairs.push([code, raw[i + 1].trim()]);
  }
  let section = '';
  let insunits: number | undefined;
  const layers: string[] = [];
  const seen = new Set<string>();
  const addLayer = (n: string) => { if (n && !seen.has(n)) { seen.add(n); layers.push(n); } };
  let blocks = 0;
  const entities: DxfEntity[] = [];
  let i = 0;
  const num = (v: string) => parseFloat(v) || 0;

  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code === 0 && val === 'SECTION') { section = pairs[i + 1]?.[1] ?? ''; i += 2; continue; }
    if (code === 0 && val === 'ENDSEC') { section = ''; i++; continue; }
    if (section === 'HEADER') {
      if (code === 9 && val === '$INSUNITS') { const v = pairs[i + 1]; if (v && v[0] === 70) insunits = parseInt(v[1], 10); i += 2; continue; }
      i++; continue;
    }
    if (section === 'TABLES') {
      if (code === 0 && val === 'LAYER') {
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) { if (pairs[i][0] === 2) addLayer(pairs[i][1]); i++; }
        continue;
      }
      i++; continue;
    }
    if (section === 'BLOCKS') { if (code === 0 && val === 'BLOCK') blocks++; i++; continue; }
    if (section === 'ENTITIES' && code === 0) {
      const type = val;
      // collect this entity's group codes
      const rec: [number, string][] = [];
      i++;
      while (i < pairs.length && pairs[i][0] !== 0) rec.push(pairs[i++]);
      const layer = rec.find((p) => p[0] === 8)?.[1] ?? '0';
      if (type === 'LINE') {
        const g = (c: number) => num(rec.find((p) => p[0] === c)?.[1] ?? '0');
        entities.push({ layer, type: 'line', pts: [{ x: g(10), y: g(20) }, { x: g(11), y: g(21) }] });
        addLayer(layer);
      } else if (type === 'LWPOLYLINE') {
        const pts: Vec2[] = [];
        let flags = 0;
        for (const [c, v] of rec) {
          if (c === 70) flags = parseInt(v, 10) || 0;
          else if (c === 10) pts.push({ x: num(v), y: 0 });
          else if (c === 20 && pts.length) pts[pts.length - 1].y = num(v);
        }
        if (pts.length >= 2) { entities.push({ layer, type: 'polyline', pts, closed: (flags & 1) === 1 }); addLayer(layer); }
      } else if (type === 'POLYLINE') {
        const flags = parseInt(rec.find((p) => p[0] === 70)?.[1] ?? '0', 10) || 0;
        const pts: Vec2[] = [];
        while (i < pairs.length && pairs[i][0] === 0 && pairs[i][1] === 'VERTEX') {
          i++;
          const v: Vec2 = { x: 0, y: 0 };
          let vflags = 0;
          while (i < pairs.length && pairs[i][0] !== 0) {
            const [c, s] = pairs[i++];
            if (c === 10) v.x = num(s); else if (c === 20) v.y = num(s); else if (c === 70) vflags = parseInt(s, 10) || 0;
          }
          if (!(vflags & 128)) pts.push(v); // skip polyface index vertices
        }
        if (i < pairs.length && pairs[i][0] === 0 && pairs[i][1] === 'SEQEND') { i++; while (i < pairs.length && pairs[i][0] !== 0) i++; }
        if (!(flags & (16 | 64)) && pts.length >= 2) { entities.push({ layer, type: 'polyline', pts, closed: (flags & 1) === 1 }); addLayer(layer); }
      } else if (type === 'CIRCLE' || type === 'ARC') {
        const g = (c: number) => num(rec.find((p) => p[0] === c)?.[1] ?? '0');
        const c = { x: g(10), y: g(20) }, r = g(40);
        let a0 = 0, a1 = 360;
        if (type === 'ARC') { a0 = g(50); a1 = g(51); if (a1 <= a0) a1 += 360; }
        const n = Math.max(4, Math.ceil(((a1 - a0) / 360) * 32));
        const pts = Array.from({ length: type === 'CIRCLE' ? n : n + 1 }, (_, k) => {
          const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
          return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
        });
        if (r > 0) { entities.push({ layer, type: 'polyline', pts, closed: type === 'CIRCLE' }); addLayer(layer); }
      }
      continue;
    }
    i++;
  }

  let units: string, unitScale: number;
  if (insunits !== undefined && INSUNITS[insunits]) [units, unitScale] = INSUNITS[insunits];
  else {
    // Unitless drawings: guess from the extents of a building-sized drawing.
    const pts = entities.flatMap((e) => e.pts);
    const bb = pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const ext = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    [units, unitScale] = ext >= 5000 ? ['unitless (assumed millimetres)', 1] : ext >= 200 ? ['unitless (assumed centimetres)', 10] : ['unitless (assumed metres)', 1000];
  }
  return { units, unitScale, layers, blocks, entities };
}

export interface DxfWall { a: Vec2; b: Vec2; thickness: number }

interface Seg { a: Vec2; b: Vec2; u: Vec2; n: Vec2; c: number; t0: number; t1: number; layer: string; covered: [number, number][] }

/**
 * Recognise walls as pairs of parallel face lines 75–450 mm apart that overlap
 * by at least 300 mm. Returns centre-line walls with their thickness (mm), and
 * every line that is not part of a wall as an underlay segment (mm).
 */
export function dxfToWalls(parsed: ParsedDxf): { walls: DxfWall[]; underlay: { a: Vec2; b: Vec2 }[] } {
  const k = parsed.unitScale;
  const raw: { a: Vec2; b: Vec2; layer: string }[] = [];
  for (const e of parsed.entities) {
    const pts = e.pts.map((p) => ({ x: p.x * k, y: p.y * k }));
    for (let i = 0; i + 1 < pts.length; i++) raw.push({ a: pts[i], b: pts[i + 1], layer: e.layer });
    if (e.closed && pts.length > 2) raw.push({ a: pts[pts.length - 1], b: pts[0], layer: e.layer });
  }
  // Prefer explicit wall layers when the drawing has them.
  const wallLayer = (l: string) => /wall|mur|wand|a-wall/i.test(l);
  const hasWallLayers = raw.some((s) => wallLayer(s.layer));
  const segs: Seg[] = [];
  const underlay: { a: Vec2; b: Vec2 }[] = [];
  for (const s of raw) {
    const len = dist(s.a, s.b);
    if (len < 1) continue;
    if (hasWallLayers && !wallLayer(s.layer)) { underlay.push({ a: s.a, b: s.b }); continue; }
    let u = norm(sub(s.b, s.a));
    // canonical direction so parallel lines share orientation
    if (u.x < -1e-9 || (Math.abs(u.x) <= 1e-9 && u.y < 0)) u = scale(u, -1);
    const n = perp(u);
    const ta = dot(s.a, u), tb = dot(s.b, u);
    segs.push({ a: s.a, b: s.b, u, n, c: dot(s.a, n), t0: Math.min(ta, tb), t1: Math.max(ta, tb), layer: s.layer, covered: [] });
  }

  // Candidate pairs: bucket by angle, sweep by offset.
  const buckets = new Map<number, number[]>();
  segs.forEach((s, i) => {
    const ang = Math.round((Math.atan2(s.u.y, s.u.x) * 180) / Math.PI + 180) % 180;
    (buckets.get(ang) ?? buckets.set(ang, []).get(ang)!).push(i);
  });
  const cands: { i: number; j: number; d: number; ov: number }[] = [];
  const cosTol = Math.cos((1.2 * Math.PI) / 180);
  const consider = (i: number, j: number) => {
    const si = segs[i], sj = segs[j];
    if (Math.abs(dot(si.u, sj.u)) < cosTol) return;
    const d = Math.abs(dot(sub(mid2(sj), si.a), si.n));
    if (d < 75 || d > 450) return;
    const ja = dot(sj.a, si.u), jb = dot(sj.b, si.u);
    const ov = Math.min(si.t1, Math.max(ja, jb)) - Math.max(si.t0, Math.min(ja, jb));
    if (ov >= 300) cands.push({ i, j, d, ov });
  };
  for (const [ang, ids] of buckets) {
    // same bucket: sweep in order of offset so only nearby parallels are compared
    const sorted = [...ids].sort((x, y) => segs[x].c - segs[y].c);
    for (let a = 0; a < sorted.length; a++) {
      for (let c = a + 1; c < sorted.length && segs[sorted[c]].c - segs[sorted[a]].c <= 470; c++) consider(sorted[a], sorted[c]);
    }
    // neighbouring bucket (lines a fraction of a degree apart)
    const next = buckets.get((ang + 1) % 180);
    if (next) for (const i of ids) for (const j of next) consider(i, j);
  }
  cands.sort((x, y) => x.d - y.d || y.ov - x.ov);

  const pieces: DxfWall[] = [];
  for (const cd of cands) {
    const si = segs[cd.i], sj = segs[cd.j];
    const ja = dot(sj.a, si.u), jb = dot(sj.b, si.u);
    let free: [number, number][] = [[Math.max(si.t0, Math.min(ja, jb)), Math.min(si.t1, Math.max(ja, jb))]];
    free = subtract(free, si.covered);
    // j's covered spans, mapped into i's parameter
    const off = dot(sj.a, si.u) - dot(sj.a, sj.u) * Math.sign(dot(si.u, sj.u));
    free = subtract(free, sj.covered.map(([p, q]) => {
      const x = p * Math.sign(dot(si.u, sj.u)) + off, y = q * Math.sign(dot(si.u, sj.u)) + off;
      return [Math.min(x, y), Math.max(x, y)] as [number, number];
    }));
    const sd = dot(sub(mid2(sj), si.a), si.n);
    for (const [p, q] of free) {
      if (q - p < 300) continue;
      const P = (t: number) => add(add(scale(si.u, t), scale(si.n, si.c)), scale(si.n, sd / 2));
      pieces.push({ a: P(p), b: P(q), thickness: Math.round(Math.abs(sd)) });
      si.covered.push([p, q]);
      const s = Math.sign(dot(si.u, sj.u));
      const x = (p - off) * s, y = (q - off) * s;
      sj.covered.push([Math.min(x, y), Math.max(x, y)]);
    }
  }
  for (const s of segs) {
    if (!s.covered.length) underlay.push({ a: s.a, b: s.b });
    // leftovers shorter than two wall thicknesses are corner returns of the same walls
    else for (const [p, q] of subtract([[s.t0, s.t1]], s.covered)) if (q - p > 460) underlay.push({ a: add(scale(s.u, p), scale(s.n, s.c)), b: add(scale(s.u, q), scale(s.n, s.c)) });
  }

  const walls = snapJunctions(mergeCollinear(pieces));
  const r = (p: Vec2) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  return {
    walls: walls.filter((w) => dist(w.a, w.b) >= 200).map((w) => ({ a: r(w.a), b: r(w.b), thickness: w.thickness })),
    underlay: underlay.map((s) => ({ a: r(s.a), b: r(s.b) })),
  };
}

const mid2 = (s: { a: Vec2; b: Vec2 }): Vec2 => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });

function subtract(a: [number, number][], b: [number, number][]): [number, number][] {
  let out = a;
  for (const [h0, h1] of b) {
    const next: [number, number][] = [];
    for (const [s0, s1] of out) {
      if (h1 <= s0 + 1 || h0 >= s1 - 1) { next.push([s0, s1]); continue; }
      if (h0 > s0) next.push([s0, h0]);
      if (h1 < s1) next.push([h1, s1]);
    }
    out = next;
  }
  return out;
}

/** Join collinear pieces of the same thickness across junctions and door / window openings (cut out of the poché). */
function mergeCollinear(walls: DxfWall[], maxGap = 4600): DxfWall[] {
  const ws = walls.map((w) => ({ ...w }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const A = ws[i], B = ws[j];
      if (Math.abs(A.thickness - B.thickness) > 15) continue;
      const u = norm(sub(A.b, A.a));
      if (Math.abs(cross(u, norm(sub(B.b, B.a)))) > 0.02) continue;
      const n = perp(u);
      if (Math.abs(dot(sub(B.a, A.a), n)) > 20 || Math.abs(dot(sub(B.b, A.a), n)) > 20) continue;
      const ta = [0, dot(sub(A.b, A.a), u)].sort((x, y) => x - y);
      const tb = [dot(sub(B.a, A.a), u), dot(sub(B.b, A.a), u)].sort((x, y) => x - y);
      const gap = Math.max(tb[0] - ta[1], ta[0] - tb[1]);
      if (gap > maxGap) continue;
      const lo = Math.min(ta[0], tb[0]), hi = Math.max(ta[1], tb[1]);
      ws[i] = { a: add(A.a, scale(u, lo)), b: add(A.a, scale(u, hi)), thickness: Math.max(A.thickness, B.thickness) };
      ws.splice(j, 1);
      merged = true;
      break outer;
    }
  }
  return ws;
}

/** Extend or trim wall ends onto the centre-lines of walls they meet (corners and tees). */
function snapJunctions(walls: DxfWall[]): DxfWall[] {
  const ws = walls.map((w) => ({ ...w }));
  for (let pass = 0; pass < 2; pass++) {
    for (const w of ws) {
      for (const end of ['a', 'b'] as const) {
        const E = w[end];
        const u = norm(sub(w.b, w.a));
        let best: Vec2 | null = null, bestD = Infinity;
        for (const o of ws) {
          if (o === w) continue;
          const v = norm(sub(o.b, o.a));
          if (Math.abs(cross(u, v)) < 0.5) continue;
          const X = lineIntersection(w.a, u, o.a, v);
          if (!X) continue;
          const d = dist(E, X);
          const tol = Math.max(w.thickness, o.thickness) * 0.75 + 25;
          if (d > tol) continue;
          const lo = dot(sub(X, o.a), v), L = dist(o.a, o.b), m = w.thickness / 2 + 25;
          if (lo < -m || lo > L + m) continue;
          if (d < bestD) { bestD = d; best = X; }
        }
        if (best) w[end] = best;
      }
    }
  }
  return ws;
}

