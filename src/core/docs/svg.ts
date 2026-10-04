/**
 * Paper-space SVG primitives for the documentation engine.
 *
 * Everything is emitted as plain attributes (no CSS, classes or variables) in
 * paper millimetres, because the same strings are previewed in the browser and
 * converted to vector PDF by svg2pdf.js, which only understands presentation
 * attributes. Line weights follow common architectural pen sets.
 */
import type { Vec2 } from '../geometry/vec';
import type { UnitSystem } from '../units';
import { MM_PER_FT } from '../units';

export const FONT = 'Inter, Helvetica, Arial, sans-serif';

/** Pen weights in paper millimetres. */
export const LW = { cut: 0.5, heavy: 0.35, medium: 0.25, light: 0.18, hairline: 0.13 } as const;
export type Pen = keyof typeof LW;

export const INK = '#1c1b19';
export const POCHE = '#1c1b19';
export const GREY = { dark: '#3a3936', mid: '#6b6964', soft: '#9a978f', rule: '#cfccc5', faint: '#e7e5e0', wash: '#f4f3f0' };
export const GLASS = '#9fc3d6';

/** Compact number for SVG output (2 decimals, no -0). */
export function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Approximate rendered width of a string in Helvetica (mm) — used for fitting and wrapping. */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    if (ch === ' ') w += 0.28;
    else if ('il.,:;\'|!'.includes(ch)) w += 0.25;
    else if ('ftjrI()[]"-'.includes(ch)) w += 0.36;
    else if ('mwMW'.includes(ch)) w += 0.84;
    else if (ch >= 'A' && ch <= 'Z') w += 0.67;
    else if (ch >= '0' && ch <= '9') w += 0.56;
    else w += 0.53;
  }
  return w * size * (bold ? 1.06 : 1);
}

export interface TextOpts {
  size: number;
  anchor?: 'start' | 'middle' | 'end';
  bold?: boolean;
  fill?: string;
  /** Rotation in degrees about the anchor point (clockwise, SVG convention). */
  rotate?: number;
  opacity?: number;
}

export function text(x: number, y: number, s: string, o: TextOpts): string {
  const attrs = [
    `x="${num(x)}"`, `y="${num(y)}"`, `font-family="${FONT}"`, `font-size="${num(o.size)}"`,
    `fill="${o.fill ?? INK}"`,
  ];
  if (o.anchor && o.anchor !== 'start') attrs.push(`text-anchor="${o.anchor}"`);
  if (o.bold) attrs.push('font-weight="bold"');
  if (o.opacity !== undefined) attrs.push(`fill-opacity="${num(o.opacity)}"`);
  if (o.rotate) attrs.push(`transform="rotate(${num(o.rotate)} ${num(x)} ${num(y)})"`);
  return `<text ${attrs.join(' ')}>${esc(s)}</text>`;
}

export interface StrokeOpts { stroke?: string; dash?: string; cap?: 'butt' | 'round' | 'square'; opacity?: number }

const strokeAttrs = (w: number, o: StrokeOpts = {}) =>
  `stroke="${o.stroke ?? INK}" stroke-width="${num(w)}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}${o.cap ? ` stroke-linecap="${o.cap}"` : ''}${o.opacity !== undefined ? ` stroke-opacity="${num(o.opacity)}"` : ''}`;

export function line(a: Vec2, b: Vec2, w: number, o: StrokeOpts = {}): string {
  return `<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" fill="none" ${strokeAttrs(w, o)}/>`;
}

export function rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; width?: number; dash?: string; fillOpacity?: number } = {}): string {
  const stroke = o.stroke ? ` ${strokeAttrs(o.width ?? LW.light, { stroke: o.stroke, dash: o.dash })}` : '';
  const fo = o.fillOpacity !== undefined ? ` fill-opacity="${num(o.fillOpacity)}"` : '';
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${o.fill ?? 'none'}"${fo}${stroke}/>`;
}

export function circle(c: Vec2, r: number, o: { fill?: string; stroke?: string; width?: number; fillOpacity?: number; dash?: string } = {}): string {
  const stroke = o.stroke ? ` ${strokeAttrs(o.width ?? LW.light, { stroke: o.stroke, dash: o.dash })}` : '';
  const fo = o.fillOpacity !== undefined ? ` fill-opacity="${num(o.fillOpacity)}"` : '';
  return `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(r)}" fill="${o.fill ?? 'none'}"${fo}${stroke}/>`;
}

/** Path data for closed rings (already in paper coordinates). */
export function ringsD(rings: Vec2[][], close = true): string {
  let d = '';
  for (const r of rings) {
    if (r.length < 2) continue;
    d += `M${num(r[0].x)} ${num(r[0].y)}`;
    for (let i = 1; i < r.length; i++) d += `L${num(r[i].x)} ${num(r[i].y)}`;
    if (close) d += 'Z';
  }
  return d;
}

export function path(d: string, o: { fill?: string; stroke?: string; width?: number; dash?: string; fillOpacity?: number; evenodd?: boolean; join?: 'miter' | 'round' | 'bevel' } = {}): string {
  if (!d) return '';
  const stroke = o.stroke ? ` ${strokeAttrs(o.width ?? LW.light, { stroke: o.stroke, dash: o.dash })}` : '';
  const fo = o.fillOpacity !== undefined ? ` fill-opacity="${num(o.fillOpacity)}"` : '';
  const fr = o.evenodd ? ' fill-rule="evenodd"' : '';
  const lj = o.join ? ` stroke-linejoin="${o.join}"` : '';
  return `<path d="${d}" fill="${o.fill ?? 'none'}"${fo}${fr}${stroke}${lj}/>`;
}

export const group = (body: string, transform?: string) => (transform ? `<g transform="${transform}">${body}</g>` : `<g>${body}</g>`);

/** Blend a hex colour towards another (default white) by t ∈ [0, 1]. */
export function mix(hex: string, t: number, toward = '#ffffff'): string {
  const p = (h: string) => {
    const s = h.replace('#', '');
    const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
  };
  const a = p(hex), b = p(toward);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** North arrow centred on (x, y); `bearing` is true north clockwise from sheet up. */
export function northArrow(x: number, y: number, size: number, bearing = 0): string {
  const r = size / 2;
  const tip = { x: 0, y: -r * 0.92 }, l = { x: -r * 0.36, y: r * 0.55 }, m = { x: 0, y: r * 0.28 }, rt = { x: r * 0.36, y: r * 0.55 };
  const P = (p: Vec2) => `${num(p.x)} ${num(p.y)}`;
  const body =
    circle({ x: 0, y: 0 }, r, { stroke: INK, width: LW.light }) +
    path(`M${P(tip)}L${P(l)}L${P(m)}Z`, { fill: INK }) +
    path(`M${P(tip)}L${P(rt)}L${P(m)}Z`, { fill: '#ffffff', stroke: INK, width: LW.hairline }) +
    text(0, -r - 1.4, 'N', { size: Math.max(2.2, size * 0.2), anchor: 'middle', bold: true });
  return `<g transform="translate(${num(x)} ${num(y)}) rotate(${num(bearing)})">${body}</g>`;
}

/** Choose graphic-scale divisions: total model length (mm), divisions and label unit. */
export function scaleBarSpec(scale: number, units: UnitSystem, targetPaper = 40): { total: number; parts: number; labels: string[] } {
  const target = targetPaper * scale;
  if (units === 'metric') {
    const opts = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
    let total = opts[0];
    for (const o of opts) if (o * 1000 <= target) total = o;
    const parts = total % 5 === 0 ? 5 : total % 4 === 0 ? 4 : total;
    const step = total / parts;
    return { total: total * 1000, parts, labels: Array.from({ length: parts + 1 }, (_, i) => `${+(i * step).toFixed(2)}`).map((s, i) => (i === parts ? `${s} m` : s)) };
  }
  const opts = [4, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
  let total = opts[0];
  for (const o of opts) if (o * MM_PER_FT <= target) total = o;
  const parts = total % 5 === 0 ? 5 : 4;
  const step = total / parts;
  return { total: total * MM_PER_FT, parts, labels: Array.from({ length: parts + 1 }, (_, i) => `${+(i * step).toFixed(1)}`).map((s, i) => (i === parts ? `${s} ft` : s)) };
}

/** Alternating black/white graphic scale bar; (x, y) is the top-left corner. Returns markup and width. */
export function scaleBar(x: number, y: number, scale: number, units: UnitSystem, targetPaper = 40): { svg: string; width: number } {
  const spec = scaleBarSpec(scale, units, targetPaper);
  const w = spec.total / scale;
  const seg = w / spec.parts;
  const h = 1.2;
  let s = '';
  for (let i = 0; i < spec.parts; i++) s += rect(x + i * seg, y, seg, h, { fill: i % 2 === 0 ? INK : '#ffffff', stroke: INK, width: LW.hairline });
  // label first, middle and last divisions only — keeps the bar quiet
  const show = new Set([0, Math.floor(spec.parts / 2), spec.parts]);
  spec.labels.forEach((lb, i) => { if (show.has(i)) s += text(x + i * seg, y + h + 2.4, lb, { size: 1.8, anchor: 'middle', fill: GREY.dark }); });
  return { svg: s, width: w };
}

/** Wrap text into lines that fit `maxWidth` (approximate metrics). */
export function wrapText(s: string, maxWidth: number, size: number, bold = false): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size, bold) > maxWidth) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Finished-floor style level label, e.g. "+3.65" or "+12' 0"". */
export function formatLevel(z: number, units: UnitSystem): string {
  if (Math.abs(z) < 0.5) return units === 'metric' ? '±0.00' : '±0\' 0"';
  const sign = z > 0 ? '+' : '-';
  if (units === 'metric') return `${sign}${(Math.abs(z) / 1000).toFixed(2)}`;
  const totalIn = Math.round(Math.abs(z) / 25.4);
  return `${sign}${Math.floor(totalIn / 12)}' ${totalIn % 12}"`;
}
