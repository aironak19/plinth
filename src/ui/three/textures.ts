/**
 * Procedural PBR texture sets. Each pattern paints an albedo canvas and a
 * matching height field; the normal map is derived from the height field, so
 * joints, grain and pebbles catch the sun the way the real surface does. All
 * textures tile seamlessly and are generated once per material — no downloads.
 */
import * as THREE from 'three';
import type { Material, MaterialPattern } from '../../core/catalog/materials';

export interface TextureSet { map: THREE.Texture; normalMap: THREE.Texture; normalScale: number }

const S = 512;
const cache = new Map<string, TextureSet>();

export function rng(seed: number) {
  let t = (seed >>> 0) || 1;
  return () => { t ^= t << 13; t >>>= 0; t ^= t >> 17; t ^= t << 5; t >>>= 0; return t / 4294967296; };
}
export function hash(str: string): number { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function hexRgb(hex: string): [number, number, number] { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(hex: string, f: number, shift: [number, number, number] = [0, 0, 0]) { const [r, g, b] = hexRgb(hex); const c = (v: number, s: number) => Math.max(0, Math.min(255, Math.round(v * f + s))); return `rgb(${c(r, shift[0])},${c(g, shift[1])},${c(b, shift[2])})`; }
const grey = (v: number) => { const c = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${c},${c},${c})`; };

/** Tileable fractal value noise in [0, 1]. */
export function fbm(size: number, baseFreq: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = baseFreq * 2 ** o;
    const r = rng(seed + o * 7919);
    const lat = new Float32Array(f * f);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * f, y0 = Math.floor(gy), ty = gy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * f, x0 = Math.floor(gx), tx = gx - x0, sx = tx * tx * (3 - 2 * tx);
        const a = lat[(y0 % f) * f + (x0 % f)], b = lat[(y0 % f) * f + ((x0 + 1) % f)], c = lat[((y0 + 1) % f) * f + (x0 % f)], d = lat[((y0 + 1) % f) * f + ((x0 + 1) % f)];
        out[y * size + x] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
      }
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

interface Pair { c: CanvasRenderingContext2D; h: CanvasRenderingContext2D; r: () => number }

function pair(seed: number, base: string, baseHeight: number): Pair & { cc: HTMLCanvasElement; hc: HTMLCanvasElement } {
  const cc = document.createElement('canvas'), hc = document.createElement('canvas');
  cc.width = cc.height = hc.width = hc.height = S;
  const c = cc.getContext('2d', { willReadFrequently: true })!, h = hc.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = base; c.fillRect(0, 0, S, S);
  h.fillStyle = grey(baseHeight); h.fillRect(0, 0, S, S);
  return { c, h, r: rng(seed), cc, hc };
}

/** Draw the same shape on both canvases, wrapped so the tile stays seamless. */
function both(p: Pair, color: string, height: number, draw: (g: CanvasRenderingContext2D) => void, wrap = false) {
  for (const [g, style] of [[p.c, color], [p.h, grey(height)]] as const) {
    g.fillStyle = style; g.strokeStyle = style;
    if (!wrap) { draw(g); continue; }
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); draw(g); g.restore(); }
  }
}

const rect = (x: number, y: number, w: number, h: number) => (g: CanvasRenderingContext2D) => g.fillRect(x, y, w, h);
const rrect = (x: number, y: number, w: number, h: number, rad: number) => (g: CanvasRenderingContext2D) => { g.beginPath(); g.roundRect(x, y, w, h, rad); g.fill(); };
const ell = (x: number, y: number, rx: number, ry: number, rot: number) => (g: CanvasRenderingContext2D) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };

type Painter = (p: Pair, m: Material) => { grain: number; relief: number; normal: number; grainFreq?: number };

const PAINT: Record<Exclude<MaterialPattern, 'none' | 'water'>, Painter> = {
  wood: (p, m) => planks(p, m, false),
  plank: (p, m) => planks(p, m, true),
  tile: (p, m) => {
    const n = 4, t = S / n, j = 3;
    both(p, shade(m.color, 0.72), 0.25, rect(0, 0, S, S));
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) both(p, shade(m.color, 0.95 + p.r() * 0.1), 0.78 + p.r() * 0.06, rrect(i * t + j, k * t + j, t - 2 * j, t - 2 * j, 3));
    return { grain: 0.035, relief: 0.03, normal: 1.1 };
  },
  brick: (p, m) => {
    const rows = 12, bh = S / rows, bw = S / 4, j = 4;
    both(p, '#cfc8ba', 0.2, rect(0, 0, S, S));
    for (let y = 0; y < rows; y++) for (let x = -1; x < 5; x++) both(p, shade(m.color, 0.8 + p.r() * 0.34, [p.r() * 14 - 7, 0, 0]), 0.72 + p.r() * 0.12, rrect(x * bw + (y % 2 ? bw / 2 : 0) + j / 2, y * bh + j / 2, bw - j, bh - j, 2), true);
    return { grain: 0.09, relief: 0.1, normal: 1.8 };
  },
  stone: (p, m) => {
    // Coursed ashlar: rows of random-length blocks.
    const rows = 6, rh = S / rows, j = 5;
    both(p, shade(m.color, 0.55), 0.12, rect(0, 0, S, S));
    for (let y = 0; y < rows; y++) {
      let x = -p.r() * 60;
      const start = x;
      while (x < S + start) { const w = 60 + p.r() * 110; both(p, shade(m.color, 0.78 + p.r() * 0.4, [p.r() * 10 - 5, p.r() * 6 - 3, 0]), 0.55 + p.r() * 0.35, rrect(x + j / 2, y * rh + j / 2, w - j, rh - j, 4), true); x += w; }
    }
    return { grain: 0.12, relief: 0.2, normal: 2.2 };
  },
  marble: (p, m) => {
    for (let k = 0; k < 9; k++) {
      p.c.strokeStyle = `rgba(105,105,112,${0.1 + p.r() * 0.2})`; p.c.lineWidth = 0.8 + p.r() * 2.2;
      p.c.beginPath(); let x = p.r() * S, y = -10; p.c.moveTo(x, y);
      while (y < S + 10) { x += (p.r() - 0.45) * 46; y += 14 + p.r() * 30; p.c.lineTo(x, y); }
      p.c.stroke();
    }
    return { grain: 0.03, relief: 0.01, normal: 0.15, grainFreq: 3 };
  },
  grass: (p, m) => {
    for (let i = 0; i < 5200; i++) {
      const x = p.r() * S, y = p.r() * S, len = 5 + p.r() * 9, a = -Math.PI / 2 + (p.r() - 0.5) * 1.4, f = 0.7 + p.r() * 0.55;
      const col = shade(m.color, f, [p.r() * 18 - 4, p.r() * 14, -p.r() * 10]);
      for (const [g, st] of [[p.c, col], [p.h, grey(0.35 + f * 0.4)]] as const) { g.strokeStyle = st; g.lineWidth = 1.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); }
    }
    return { grain: 0.16, relief: 0.12, normal: 0.55, grainFreq: 3 };
  },
  concrete: () => ({ grain: 0.08, relief: 0.1, normal: 0.7, grainFreq: 4 }),
  plaster: () => ({ grain: 0.03, relief: 0.1, normal: 0.3, grainFreq: 9 }),
  asphalt: (p) => {
    for (let i = 0; i < 9000; i++) { const v = p.r(); both(p, `rgba(${v > 0.5 ? '210,210,210' : '20,20,22'},${0.1 + p.r() * 0.25})`, 0.3 + v * 0.5, rect(p.r() * S, p.r() * S, 1.6, 1.6)); }
    return { grain: 0.06, relief: 0.08, normal: 1.3, grainFreq: 8 };
  },
  'tiles-roof': (p, m) => {
    const rows = 6, rh = S / rows, cols = 8, cw = S / cols;
    for (let y = 0; y < rows; y++) for (let x = -1; x <= cols; x++) {
      const ox = (y % 2 ? cw / 2 : 0) + x * cw, f = 0.85 + p.r() * 0.25;
      const grd = (g: CanvasRenderingContext2D, lo: string, hi: string) => { const lg = g.createLinearGradient(ox, 0, ox + cw, 0); lg.addColorStop(0, lo); lg.addColorStop(0.5, hi); lg.addColorStop(1, lo); return lg; };
      p.c.fillStyle = grd(p.c, shade(m.color, f * 0.72), shade(m.color, f * 1.08)); p.c.fillRect(ox, y * rh, cw, rh);
      p.h.fillStyle = grd(p.h, grey(0.15), grey(0.9)); p.h.fillRect(ox, y * rh, cw, rh);
      both(p, 'rgba(0,0,0,0.35)', 0.05, rect(ox, y * rh + rh - 4, cw, 4));
    }
    return { grain: 0.06, relief: 0.04, normal: 2.4 };
  },
  gravel: (p, m) => {
    both(p, shade(m.color, 0.6), 0.1, rect(0, 0, S, S));
    for (let i = 0; i < 2600; i++) { const f = 0.7 + p.r() * 0.5; both(p, shade(m.color, f, [p.r() * 16 - 8, p.r() * 12 - 6, p.r() * 10 - 5]), 0.4 + p.r() * 0.6, ell(p.r() * S, p.r() * S, 4 + p.r() * 6, 3 + p.r() * 4, p.r() * 3), true); }
    return { grain: 0.05, relief: 0.05, normal: 2.6 };
  },
  cobble: (p, m) => {
    const n = 8, t = S / n;
    both(p, shade(m.color, 0.5), 0.1, rect(0, 0, S, S));
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const jx = (p.r() - 0.5) * 5, jy = (p.r() - 0.5) * 5, f = 0.78 + p.r() * 0.4;
      both(p, shade(m.color, f, [p.r() * 8 - 4, 0, 0]), 0.6 + p.r() * 0.35, rrect(i * t + 4 + jx, k * t + 4 + jy, t - 8, t - 8, 11));
    }
    return { grain: 0.1, relief: 0.12, normal: 2.6 };
  },
  herringbone: (p, m) => {
    const n = 8, u = S / n, j = 3;
    both(p, shade(m.color, 0.6), 0.15, rect(0, 0, S, S));
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const s = (a + b) % 4;
      if (s !== 0 && s !== 2) continue;
      const f = 0.84 + p.r() * 0.3, col = shade(m.color, f, [p.r() * 10 - 5, 0, 0]), hv = 0.7 + p.r() * 0.15;
      both(p, col, hv, s === 0 ? rrect(a * u + j / 2, b * u + j / 2, 2 * u - j, u - j, 2) : rrect(a * u + j / 2, b * u + j / 2, u - j, 2 * u - j, 2), true);
    }
    return { grain: 0.08, relief: 0.08, normal: 1.7 };
  },
  crazy: (p, m) => {
    // Jittered-grid Voronoi: irregular flags with recessed joints.
    const n = 5, cell = S / n, pts: { x: number; y: number; f: number }[] = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) pts.push({ x: (i + 0.15 + p.r() * 0.7) * cell, y: (k + 0.15 + p.r() * 0.7) * cell, f: 0.8 + p.r() * 0.36 });
    const ci = p.c.getImageData(0, 0, S, S), hi = p.h.getImageData(0, 0, S, S), [br, bg, bb] = hexRgb(m.color);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, f = 1;
      for (const q of pts) {
        let dx = Math.abs(x - q.x), dy = Math.abs(y - q.y);
        if (dx > S / 2) dx = S - dx; if (dy > S / 2) dy = S - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; f = q.f; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1), joint = edge < 5, o = (y * S + x) * 4, k = joint ? 0.5 : f;
      ci.data[o] = br * k; ci.data[o + 1] = bg * k; ci.data[o + 2] = bb * k; ci.data[o + 3] = 255;
      const hv = joint ? 40 : Math.min(230, 150 + edge * 4);
      hi.data[o] = hi.data[o + 1] = hi.data[o + 2] = hv; hi.data[o + 3] = 255;
    }
    p.c.putImageData(ci, 0, 0); p.h.putImageData(hi, 0, 0);
    return { grain: 0.1, relief: 0.1, normal: 2 };
  },
  soil: (p, m) => {
    for (let i = 0; i < 1600; i++) { const f = 0.6 + p.r() * 0.9; both(p, shade(m.color, f, [p.r() * 14, p.r() * 8, 0]), 0.3 + p.r() * 0.6, ell(p.r() * S, p.r() * S, 3 + p.r() * 8, 1.5 + p.r() * 3, p.r() * 3), true); }
    return { grain: 0.18, relief: 0.2, normal: 1.9, grainFreq: 6 };
  },
  foliage: (p, m) => {
    both(p, shade(m.color, 0.45), 0.05, rect(0, 0, S, S));
    for (let i = 0; i < 2400; i++) { const f = 0.6 + p.r() * 0.75; both(p, shade(m.color, f, [p.r() * 20 - 4, p.r() * 22, -p.r() * 10]), 0.25 + f * 0.5, ell(p.r() * S, p.r() * S, 5 + p.r() * 6, 2.5 + p.r() * 3, p.r() * 3.2), true); }
    return { grain: 0.06, relief: 0.05, normal: 2.4 };
  },
};

function planks(p: Pair, m: Material, vertical: boolean) {
  const n = 4, h = S / n;
  for (let i = 0; i < n; i++) {
    const f = 0.86 + p.r() * 0.26, col = shade(m.color, f, [p.r() * 10 - 5, 0, 0]);
    both(p, col, 0.7 + p.r() * 0.08, vertical ? rect(i * h, 0, h, S) : rect(0, i * h, S, h));
    for (let k = 0; k < 26; k++) {
      const y = i * h + p.r() * h, a = 0.05 + p.r() * 0.12, w1 = p.r() * 8 - 4, w2 = p.r() * 8 - 4;
      for (const [g, st] of [[p.c, `rgba(40,22,8,${a})`], [p.h, `rgba(0,0,0,${a * 1.4})`]] as const) {
        g.strokeStyle = st; g.lineWidth = 0.7 + p.r() * 1.2; g.beginPath();
        if (vertical) { g.moveTo(y, 0); g.bezierCurveTo(y + w1, S * 0.3, y + w2, S * 0.65, y, S); } else { g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + w1, S * 0.65, y + w2, S, y); }
        g.stroke();
      }
    }
    both(p, 'rgba(0,0,0,0.45)', 0.1, vertical ? rect(i * h, 0, 2.5, S) : rect(0, i * h, S, 2.5));
    if (!vertical) both(p, 'rgba(0,0,0,0.4)', 0.1, rect((i * 197) % S, i * h, 2.5, h));
  }
  return { grain: 0.05, relief: 0.03, normal: 1.2, grainFreq: 6 };
}

function normalFromHeight(hd: Uint8ClampedArray, strength: number): ImageData {
  const out = new ImageData(S, S);
  const at = (x: number, y: number) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * S + x) * 4;
    out.data[o] = (nx * 0.5 + 0.5) * 255; out.data[o + 1] = (ny * 0.5 + 0.5) * 255; out.data[o + 2] = (nz * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  return out;
}

function finish(tex: THREE.Texture, srgb: boolean) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function textureSet(m: Material, pattern: Exclude<MaterialPattern, 'none' | 'water'> = m.pattern as Exclude<MaterialPattern, 'none' | 'water'>, keyOverride?: string): TextureSet {
  const key = keyOverride ?? `${m.id}|${pattern}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const seed = hash(key);
  const flat = pattern === 'concrete' || pattern === 'plaster' || pattern === 'asphalt' || pattern === 'marble' || pattern === 'soil';
  const p = pair(seed, m.color, flat || pattern === 'grass' ? 0.5 : 0.2);
  const k = PAINT[pattern](p, m);
  // Per-pixel weathering: large blotches plus fine grain, applied to both colour and height.
  const blot = fbm(S, 3, 4, seed + 11), grain = fbm(S, (k.grainFreq ?? 8) * 4, 3, seed + 29);
  const ci = p.c.getImageData(0, 0, S, S), hi = p.h.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const f = 1 + (blot[i] - 0.5) * k.grain * 1.6 + (grain[i] - 0.5) * k.grain, o = i * 4;
    ci.data[o] *= f; ci.data[o + 1] *= f; ci.data[o + 2] *= f;
    hi.data[o] = Math.max(0, Math.min(255, hi.data[o] + (grain[i] - 0.5) * 255 * k.relief + (blot[i] - 0.5) * 255 * k.relief * 0.6));
  }
  p.c.putImageData(ci, 0, 0);
  const nc = document.createElement('canvas'); nc.width = nc.height = S;
  nc.getContext('2d')!.putImageData(normalFromHeight(hi.data, 2.2), 0, 0);
  const set: TextureSet = { map: finish(new THREE.CanvasTexture(p.cc), true), normalMap: finish(new THREE.CanvasTexture(nc), false), normalScale: k.normal };
  cache.set(key, set);
  return set;
}

let ripple: THREE.Texture | null = null;
/** Tileable ripple normal map shared by pools, ponds and fountains. */
export function waterNormal(): THREE.Texture {
  if (ripple) return ripple;
  const a = fbm(S, 6, 4, 4242), hd = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) hd[i * 4] = a[i] * 255;
  const nc = document.createElement('canvas'); nc.width = nc.height = S;
  nc.getContext('2d')!.putImageData(normalFromHeight(hd, 5), 0, 0);
  ripple = finish(new THREE.CanvasTexture(nc), false);
  return ripple;
}

// ------------------------------------------------------------- foliage

export type LeafStyle = 'broad' | 'fine' | 'needle' | 'frond' | 'fan' | 'blade' | 'paddle' | 'bloom' | 'pad' | 'plume';
const leafCache = new Map<string, THREE.Texture>();

/**
 * A transparent sprite of leaves (or petals) used on foliage cards. Tones vary
 * between the plant's two foliage colours so a canopy reads as thousands of
 * leaves rather than a flat green mass.
 */
export function leafTexture(style: LeafStyle, c1: string, c2: string, seedKey: string): THREE.Texture {
  const key = `${style}|${c1}|${c2}|${seedKey}`;
  const hit = leafCache.get(key);
  if (hit) return hit;
  const W = style === 'frond' || style === 'blade' || style === 'paddle' ? 128 : 256, H = style === 'frond' || style === 'paddle' ? 512 : 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!, r = rng(hash(key));
  const tone = () => { const t = r(); const [a, b, c] = hexRgb(c1), [d, e, f] = hexRgb(c2); const k = 0.62 + r() * 0.62; const mx = (u: number, v: number) => Math.max(0, Math.min(255, Math.round((u + (v - u) * t) * k))); return `rgb(${mx(a, d)},${mx(b, e)},${mx(c, f)})`; };
  const leaf = (x: number, y: number, len: number, wid: number, ang: number) => {
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = tone();
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.45, -wid, len, 0); g.quadraticCurveTo(len * 0.45, wid, 0, 0); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
    g.restore();
  };
  if (style === 'broad' || style === 'fine' || style === 'needle') {
    const n = style === 'broad' ? 120 : style === 'fine' ? 420 : 900, len = style === 'broad' ? 58 : style === 'fine' ? 30 : 20, wid = style === 'broad' ? 19 : style === 'fine' ? 8 : 3.4;
    for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (W / 2 - len * 0.7); leaf(W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d, len * (0.7 + r() * 0.6), wid * (0.7 + r() * 0.6), a + (r() - 0.5) * 1.6); }
  } else if (style === 'bloom') {
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (W / 2 - 22), x = W / 2 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d, pr = 7 + r() * 9;
      for (let k = 0; k < 5; k++) { const pa = (k / 5) * Math.PI * 2 + a; g.fillStyle = tone(); g.beginPath(); g.ellipse(x + Math.cos(pa) * pr * 0.55, y + Math.sin(pa) * pr * 0.55, pr * 0.6, pr * 0.38, pa, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,236,170,0.9)'; g.beginPath(); g.arc(x, y, pr * 0.22, 0, Math.PI * 2); g.fill();
    }
  } else if (style === 'frond') {
    // Pinnate frond: a rib with leaflets, drawn base (bottom) to tip (top).
    g.strokeStyle = shade(c1, 0.75); g.lineWidth = 4; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 6); g.stroke();
    for (let i = 0; i < 46; i++) { const t = i / 46, y = H - 20 - t * (H - 40), len = (W / 2 - 4) * Math.sin(Math.PI * (0.12 + t * 0.86)) * (0.85 + r() * 0.2); for (const s of [-1, 1]) leaf(W / 2, y, len, 4.2, s > 0 ? -0.5 - r() * 0.2 : Math.PI + 0.5 + r() * 0.2); }
  } else if (style === 'fan') {
    for (let i = 0; i < 34; i++) { const a = -Math.PI * (0.04 + (i / 33) * 0.92); leaf(W / 2, H - 14, (H - 26) * (0.82 + r() * 0.18), 9, a); }
  } else if (style === 'blade') {
    for (let i = 0; i < 9; i++) { const x = W / 2 + (r() - 0.5) * 30, lean = (r() - 0.5) * (W * 0.7); g.strokeStyle = tone(); g.lineWidth = 5 + r() * 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + lean * 0.2, H * 0.5, x + lean, 8 + r() * 50); g.stroke(); }
  } else if (style === 'paddle') {
    g.fillStyle = tone(); g.beginPath(); g.moveTo(W / 2, H); g.bezierCurveTo(-W * 0.25, H * 0.75, -W * 0.1, H * 0.12, W / 2, 4); g.bezierCurveTo(W * 1.1, H * 0.12, W * 1.25, H * 0.75, W / 2, H); g.fill();
    g.strokeStyle = shade(c2, 1.05); g.lineWidth = 3.5; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 8); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
    for (let i = 0; i < 36; i++) { const y = H - 16 - (i / 36) * (H - 40); for (const s of [-1, 1]) { g.beginPath(); g.moveTo(W / 2, y); g.lineTo(W / 2 + s * W * 0.5, y - 22); g.stroke(); } }
  } else if (style === 'pad') {
    g.fillStyle = tone(); g.beginPath(); g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, W / 2 - 8, 0.18, Math.PI * 2 - 0.18); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1.2; for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.cos(a) * (W / 2 - 12), H / 2 + Math.sin(a) * (W / 2 - 12)); g.stroke(); }
  } else {
    // plume: feathery seed head
    for (let i = 0; i < 420; i++) { const t = r(), y = H - 10 - t * (H - 20), w = Math.sin(Math.PI * t) * W * 0.3; g.strokeStyle = tone(); g.lineWidth = 1; g.beginPath(); g.moveTo(W / 2, y); g.lineTo(W / 2 + (r() - 0.5) * 2 * w, y - 16 - r() * 16); g.stroke(); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  leafCache.set(key, tex);
  return tex;
}
