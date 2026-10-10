/**
 * Architectural plan symbols as renderer-agnostic primitives (plan mm, y-up).
 * The interactive plan editor and the documentation engine both draw from
 * these, so an editor plan and a printed sheet are always identical.
 */
import type { Door, FurnitureItem, Wall, Window, Column } from '../model/types';
import type { StairInfo } from '../derive/stairs';
import { ASSET_BY_ID, assetColors, type Asset } from '../catalog/assets';
import type { Plant } from '../catalog/plants';
import { type Vec2, add, norm, perp, rotate, scale, sub } from '../geometry/vec';

export type Weight = 'cut' | 'heavy' | 'medium' | 'light' | 'hairline';

export type Prim =
  | { t: 'line'; a: Vec2; b: Vec2; w: Weight; dash?: boolean }
  | { t: 'arc'; c: Vec2; r: number; a0: number; a1: number; w: Weight; dash?: boolean }
  | { t: 'poly'; pts: Vec2[]; closed: boolean; w: Weight; fill?: string; dash?: boolean }
  | { t: 'circle'; c: Vec2; r: number; w: Weight; fill?: string; dash?: boolean }
  | { t: 'text'; p: Vec2; text: string; size: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean };

const P = (w: Wall, s: number, across: number): Vec2 => {
  const d = norm(sub(w.b, w.a));
  return add(add(w.a, scale(d, s)), scale(perp(d), across));
};

export function doorSymbol(w: Wall, door: Door): Prim[] {
  const out: Prim[] = [];
  const t = w.thickness;
  const s0 = door.offset - door.width / 2, s1 = door.offset + door.width / 2;
  const sign = door.side === 'left' ? 1 : -1;
  const d = norm(sub(w.b, w.a));
  const n = scale(perp(d), sign);
  // jamb lines
  out.push({ t: 'line', a: P(w, s0, -t / 2), b: P(w, s0, t / 2), w: 'medium' }, { t: 'line', a: P(w, s1, -t / 2), b: P(w, s1, t / 2), w: 'medium' });
  if (door.kind === 'opening') return out;
  if (door.kind === 'sliding' || door.kind === 'pocket') {
    const mid = (s0 + s1) / 2;
    out.push({ t: 'line', a: P(w, s0, sign * t * 0.12), b: P(w, mid + 60, sign * t * 0.12), w: 'medium' });
    out.push({ t: 'line', a: P(w, mid - 60, -sign * t * 0.12), b: P(w, s1, -sign * t * 0.12), w: 'medium' });
    return out;
  }
  if (door.kind === 'garage') {
    out.push({ t: 'line', a: P(w, s0, 0), b: P(w, s1, 0), w: 'medium', dash: true });
    return out;
  }
  const leaf = (hingeS: number, endS: number, width: number) => {
    const H = add(P(w, hingeS, 0), scale(n, t / 2));
    const C = add(P(w, endS, 0), scale(n, t / 2));
    const ang = (door.swingAngle * Math.PI) / 180;
    const closedDir = norm(sub(C, H));
    // rotate the closed direction towards n by the swing angle
    const turn = Math.sign(closedDir.x * n.y - closedDir.y * n.x) || 1;
    const openDir = rotate(closedDir, turn * ang);
    const L = add(H, scale(openDir, width));
    out.push({ t: 'line', a: H, b: L, w: 'medium' });
    const a0 = Math.atan2(closedDir.y, closedDir.x), a1 = Math.atan2(openDir.y, openDir.x);
    out.push({ t: 'arc', c: H, r: width, a0: turn > 0 ? a0 : a1, a1: turn > 0 ? a1 : a0, w: 'light' });
  };
  if (door.kind === 'double' || door.kind === 'french') {
    const mid = (s0 + s1) / 2;
    leaf(s0, mid, door.width / 2);
    leaf(s1, mid, door.width / 2);
  } else if (door.kind === 'pivot') {
    const pivotS = s0 + door.width * 0.18;
    leaf(pivotS, s1, door.width * 0.82);
  } else if (door.hinge === 'start') leaf(s0, s1, door.width);
  else leaf(s1, s0, door.width);
  return out;
}

export function windowSymbol(w: Wall, win: Window): Prim[] {
  const t = w.thickness;
  const s0 = win.offset - win.width / 2, s1 = win.offset + win.width / 2;
  const high = win.sill >= 1500;
  const out: Prim[] = [
    { t: 'line', a: P(w, s0, -t / 2), b: P(w, s0, t / 2), w: 'medium' },
    { t: 'line', a: P(w, s1, -t / 2), b: P(w, s1, t / 2), w: 'medium' },
  ];
  if (high) {
    // high window / ventilator above the cut plane: dashed outline
    out.push({ t: 'poly', pts: [P(w, s0, -t / 2), P(w, s1, -t / 2), P(w, s1, t / 2), P(w, s0, t / 2)], closed: true, w: 'light', dash: true });
    return out;
  }
  out.push(
    { t: 'line', a: P(w, s0, t / 2), b: P(w, s1, t / 2), w: 'light' },
    { t: 'line', a: P(w, s0, -t / 2), b: P(w, s1, -t / 2), w: 'light' },
    { t: 'line', a: P(w, s0, t / 8), b: P(w, s1, t / 8), w: 'medium' },
    { t: 'line', a: P(w, s0, -t / 8), b: P(w, s1, -t / 8), w: 'medium' },
  );
  if (win.kind === 'sliding') out.push({ t: 'line', a: P(w, (s0 + s1) / 2, t / 8), b: P(w, (s0 + s1) / 2, -t / 8), w: 'light' });
  return out;
}

export function stairSymbol(info: StairInfo, opts: { upper?: boolean } = {}): Prim[] {
  const out: Prim[] = [];
  const cut = Math.floor(info.steps.length * 0.6);
  info.steps.forEach((st, i) => {
    const hidden = !opts.upper && i > cut;
    out.push({ t: 'poly', pts: st.poly, closed: true, w: st.landing ? 'medium' : 'light', dash: hidden });
  });
  out.push({ t: 'poly', pts: info.footprint, closed: true, w: 'medium' });
  if (info.path.length >= 2) {
    out.push({ t: 'poly', pts: info.path, closed: false, w: 'light' });
    const a = info.path[info.path.length - 2], b = info.path[info.path.length - 1];
    const d = norm(sub(b, a));
    const nrm = perp(d);
    out.push({ t: 'poly', pts: [add(b, add(scale(d, -220), scale(nrm, 110))), b, add(b, add(scale(d, -220), scale(nrm, -110)))], closed: false, w: 'light' });
    out.push({ t: 'circle', c: info.path[0], r: 55, w: 'light' });
    out.push({ t: 'text', p: add(info.path[0], { x: 0, y: -260 }), text: opts.upper ? 'DN' : 'UP', size: 180, anchor: 'middle' });
  }
  if (!opts.upper && info.steps[cut]) {
    const poly = info.steps[cut].poly;
    out.push({ t: 'line', a: poly[0], b: poly[2] ?? poly[1], w: 'medium' });
  }
  return out;
}

/** Top-down projection of an asset recipe — the plan symbol *is* the 3D object seen from above. */
export function furnitureSymbol(item: FurnitureItem): Prim[] {
  const asset: Asset | undefined = ASSET_BY_ID[item.assetId];
  if (!asset) return [];
  const sx = item.size ? item.size.w / asset.size.w : 1, sy = item.size ? item.size.d / asset.size.d : 1;
  const rot = (item.rotation * Math.PI) / 180;
  const xf = (p: Vec2) => add(rotate({ x: p.x * sx, y: p.y * sy }, rot), item.position);
  if (asset.plant) return plantSymbol(asset.plant, item.position, ((item.size?.w ?? asset.size.w) / 2), item.id);
  const colors = assetColors(asset, item.variant);
  const parts = [...asset.parts].sort((a, b) => a.z + a.h - (b.z + b.h));
  const out: Prim[] = [];
  for (const p of parts) {
    if (p.h <= 12 && asset.category !== 'living') continue;
    const fill = p.slot === 'leaf' ? colors.leaf : p.slot === 'water' ? '#5fb4c9' : undefined;
    if (p.shape === 'sphere' && Math.abs(p.w - p.d) > 40) {
      out.push({ t: 'poly', pts: Array.from({ length: 20 }, (_, i) => xf({ x: p.x + Math.cos((i / 20) * Math.PI * 2) * p.w / 2, y: p.y + Math.sin((i / 20) * Math.PI * 2) * p.d / 2 })), closed: true, w: 'hairline', dash: p.overhead && p.slot !== 'leaf', fill });
    } else if (p.shape === 'box' || p.shape === 'pyramid') {
      const hx = p.w / 2, hy = p.d / 2;
      out.push({ t: 'poly', pts: [{ x: p.x - hx, y: p.y - hy }, { x: p.x + hx, y: p.y - hy }, { x: p.x + hx, y: p.y + hy }, { x: p.x - hx, y: p.y + hy }].map(xf), closed: true, w: 'hairline', dash: p.overhead, fill: asset.id === 'rug' ? colors.accent : undefined });
    } else {
      out.push({ t: 'circle', c: xf({ x: p.x, y: p.y }), r: (p.w / 2) * Math.max(sx, sy), w: 'hairline', dash: p.overhead && p.slot !== 'leaf', fill });
    }
  }
  switch (asset.glyph) {
    case 'basin': out.push({ t: 'circle', c: xf({ x: 0, y: 30 }), r: 160, w: 'hairline' }); break;
    case 'sink': out.push({ t: 'poly', pts: [{ x: -300, y: -180 }, { x: 300, y: -180 }, { x: 300, y: 180 }, { x: -300, y: 180 }].map(xf), closed: true, w: 'hairline' }); break;
    case 'hob': for (const [x, y] of [[-1100, -120], [-800, -120], [-1100, 150], [-800, 150]]) out.push({ t: 'circle', c: xf({ x, y }), r: 90, w: 'hairline' }); break;
    case 'wc': out.push({ t: 'circle', c: xf({ x: 0, y: 60 }), r: 150, w: 'hairline' }); break;
    case 'shower': out.push({ t: 'line', a: xf({ x: -500, y: -500 }), b: xf({ x: 500, y: 500 }), w: 'hairline' }, { t: 'line', a: xf({ x: 500, y: -500 }), b: xf({ x: -500, y: 500 }), w: 'hairline' }); break;
    case 'bath': out.push({ t: 'poly', pts: rounded(1500, 600).map(xf), closed: true, w: 'hairline' }); break;
    default: break;
  }
  return out;
}

function rounded(w: number, h: number): Vec2[] {
  const pts: Vec2[] = [];
  const r = h / 2;
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 8; pts.push({ x: w / 2 - r + Math.cos(a) * r, y: Math.sin(a) * r }); }
  for (let i = 0; i <= 8; i++) { const a = Math.PI / 2 + (Math.PI * i) / 8; pts.push({ x: -w / 2 + r + Math.cos(a) * r, y: Math.sin(a) * r }); }
  return pts;
}

export function columnSymbol(c: Column): Prim[] {
  if (c.shape === 'round') return [{ t: 'circle', c: c.position, r: c.width / 2, w: 'cut', fill: 'cut' }];
  const pts = [{ x: -c.width / 2, y: -c.depth / 2 }, { x: c.width / 2, y: -c.depth / 2 }, { x: c.width / 2, y: c.depth / 2 }, { x: -c.width / 2, y: c.depth / 2 }]
    .map((p) => add(rotate(p, (c.rotation * Math.PI) / 180), c.position));
  return [{ t: 'poly', pts, closed: true, w: 'cut', fill: 'cut' }];
}

/** SVG path data for a primitive in a y-down coordinate system (y is negated). */
export function primPath(p: Prim): string {
  const f = (v: Vec2) => `${round(v.x)} ${round(-v.y)}`;
  switch (p.t) {
    case 'line': return `M${f(p.a)}L${f(p.b)}`;
    case 'poly': return `M${p.pts.map(f).join('L')}${p.closed ? 'Z' : ''}`;
    case 'arc': {
      const a = { x: p.c.x + Math.cos(p.a0) * p.r, y: p.c.y + Math.sin(p.a0) * p.r };
      const b = { x: p.c.x + Math.cos(p.a1) * p.r, y: p.c.y + Math.sin(p.a1) * p.r };
      let sweep = p.a1 - p.a0;
      while (sweep < 0) sweep += Math.PI * 2;
      return `M${f(a)}A${round(p.r)} ${round(p.r)} 0 ${sweep > Math.PI ? 1 : 0} 0 ${f(b)}`;
    }
    case 'circle': return `M${round(p.c.x - p.r)} ${round(-p.c.y)}a${round(p.r)} ${round(p.r)} 0 1 0 ${round(2 * p.r)} 0a${round(p.r)} ${round(p.r)} 0 1 0 ${round(-2 * p.r)} 0Z`;
    default: return '';
  }
}

const round = (v: number) => Math.round(v * 10) / 10;

function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  let t = (h >>> 0) || 1;
  return () => { t ^= t << 13; t >>>= 0; t ^= t >> 17; t ^= t << 5; t >>>= 0; return t / 4294967296; };
}

/**
 * Landscape-plan plant symbols, drawn the way a planting plan is read: a
 * scalloped canopy with its trunk for trees, a star of fronds for palms, a
 * cloud for shrubs, a spiky tuft for grasses and rosettes. `r` is the canopy
 * radius in mm; the outline is tinted with the plant's foliage colour.
 */
export function plantSymbol(plant: Plant, c: Vec2, r: number, seedKey = plant.id): Prim[] {
  const rnd = seeded(seedKey);
  const rot = rnd() * Math.PI * 2;
  const at = (a: number, k: number): Vec2 => ({ x: c.x + Math.cos(a + rot) * r * k, y: c.y + Math.sin(a + rot) * r * k });
  const out: Prim[] = [];
  const fill = plant.foliage;
  const scallop = (lobes: number, depth: number, k = 1): Vec2[] => Array.from({ length: lobes * 6 }, (_, i) => { const a = (i / (lobes * 6)) * Math.PI * 2; return at(a, k * (1 - depth + depth * Math.abs(Math.sin((a * lobes) / 2)))); });
  const trunk = () => out.push({ t: 'circle', c, r: Math.max(60, Math.min(260, r * 0.07)), w: 'light', fill: 'cut' });
  switch (plant.form) {
    case 'canopy': case 'umbrella': case 'weeping': {
      out.push({ t: 'poly', pts: scallop(plant.form === 'umbrella' ? 13 : 10, 0.1), closed: true, w: 'light', fill });
      const n = 5 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd() * 0.5; out.push({ t: 'line', a: at(a, 0.08), b: at(a, 0.5 + rnd() * 0.25), w: 'hairline' }); }
      trunk();
      break;
    }
    case 'columnar': case 'conifer': {
      const spikes = plant.form === 'conifer' ? 12 : 0;
      out.push(spikes ? { t: 'poly', pts: Array.from({ length: spikes * 2 }, (_, i) => at((i / (spikes * 2)) * Math.PI * 2, i % 2 ? 0.72 : 1)), closed: true, w: 'light', fill } : { t: 'circle', c, r, w: 'light', fill });
      out.push({ t: 'circle', c, r: r * 0.5, w: 'hairline' });
      trunk();
      break;
    }
    case 'palm': case 'fanpalm': case 'clumppalm': {
      const n = plant.form === 'fanpalm' ? 12 : 9;
      out.push({ t: 'circle', c, r, w: 'hairline', dash: true, fill });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push({ t: 'line', a: c, b: at(a, 0.96), w: 'light' });
        if (plant.form !== 'fanpalm') for (const t of [0.45, 0.7]) for (const s of [-1, 1]) out.push({ t: 'line', a: at(a, t), b: at(a + s * 0.16, t + 0.2), w: 'hairline' });
      }
      trunk();
      break;
    }
    case 'bamboo': {
      out.push({ t: 'circle', c, r, w: 'hairline', dash: true, fill });
      for (let i = 0; i < 7; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.6; out.push({ t: 'circle', c: at(a, d), r: Math.max(40, r * 0.09), w: 'light' }); }
      break;
    }
    case 'shrub': case 'climber': case 'flower': case 'topiary': {
      out.push(plant.form === 'topiary' ? { t: 'circle', c, r, w: 'light', fill } : { t: 'poly', pts: scallop(7, 0.16), closed: true, w: 'light', fill });
      if (plant.flower) out.push({ t: 'circle', c, r: r * 0.24, w: 'hairline', fill: plant.flower.color });
      else out.push({ t: 'line', a: at(0, 0.3), b: at(Math.PI, 0.3), w: 'hairline' }, { t: 'line', a: at(Math.PI / 2, 0.3), b: at(-Math.PI / 2, 0.3), w: 'hairline' });
      break;
    }
    case 'grass': case 'rosette': case 'paddle': {
      const n = plant.form === 'paddle' ? 7 : 12;
      out.push({ t: 'circle', c, r, w: 'hairline', dash: true, fill });
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ t: 'line', a: at(a, 0.1), b: at(a, i % 2 ? 0.7 : 0.98), w: plant.form === 'paddle' ? 'light' : 'hairline' }); }
      break;
    }
    case 'groundcover': {
      out.push({ t: 'circle', c, r, w: 'hairline', dash: true, fill });
      for (let i = 0; i < 6; i++) { const a = rnd() * Math.PI * 2; out.push({ t: 'circle', c: at(a, Math.sqrt(rnd()) * 0.7), r: Math.max(20, r * 0.07), w: 'hairline' }); }
      break;
    }
    case 'aquatic': {
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; out.push({ t: 'circle', c: at(a, 0.55), r: r * 0.3, w: 'hairline', fill }); }
      if (plant.flower) out.push({ t: 'circle', c, r: r * 0.2, w: 'hairline', fill: plant.flower.color });
      break;
    }
  }
  return out;
}
