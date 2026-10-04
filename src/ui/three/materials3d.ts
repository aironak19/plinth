/**
 * Procedural PBR materials. Textures are generated on a canvas from the
 * catalogue's pattern + colour, so every material renders without downloads and
 * stays consistent with the swatches shown in the library and inspector.
 */
import * as THREE from 'three';
import { getMaterial, type Material } from '../../core/catalog/materials';
import type { RenderStyle } from '../../core/model/types';

const texCache = new Map<string, THREE.Texture>();
const matCache = new Map<string, THREE.Material>();

/** How many pattern units one texture tile contains (so UV scale = patternScale × reps). */
export const PATTERN_REPS: Record<string, number> = { wood: 4, plank: 4, tile: 4, brick: 8, marble: 1, stone: 3, grass: 1, water: 1, concrete: 1, 'tiles-roof': 6, none: 1 };

function rand(seed: number) {
  let t = seed;
  return () => { t = (t * 16807) % 2147483647; return (t - 1) / 2147483646; };
}

function hexToRgb(hex: string) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function tint(hex: string, f: number) { const [r, g, b] = hexToRgb(hex); const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${c(r)},${c(g)},${c(b)})`; }

function makeTexture(m: Material): THREE.Texture | null {
  if (m.pattern === 'none') return null;
  const key = `${m.id}`;
  if (texCache.has(key)) return texCache.get(key)!;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rand(m.id.length * 9301 + m.color.charCodeAt(2));
  g.fillStyle = m.color;
  g.fillRect(0, 0, S, S);
  const noise = (amt: number, n = 2200, size = 2) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * amt})`; g.fillRect(r() * S, r() * S, size, size); } };
  switch (m.pattern) {
    case 'wood': case 'plank': {
      const n = 4, h = S / n;
      for (let i = 0; i < n; i++) {
        g.fillStyle = tint(m.color, 0.88 + r() * 0.22);
        if (m.pattern === 'wood') g.fillRect(0, i * h, S, h); else g.fillRect(i * h, 0, h, S);
        g.strokeStyle = 'rgba(0,0,0,0.06)';
        for (let k = 0; k < 9; k++) { g.beginPath(); const y = i * h + r() * h; if (m.pattern === 'wood') { g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + r() * 6 - 3, S * 0.6, y + r() * 6 - 3, S, y); } else { g.moveTo(y, 0); g.bezierCurveTo(y + r() * 6 - 3, S * 0.3, y + r() * 6 - 3, S * 0.6, y, S); } g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,0.22)';
        if (m.pattern === 'wood') { g.fillRect(0, i * h, S, 1.5); g.fillRect(((i * 97) % S), i * h, 1.5, h); } else g.fillRect(i * h, 0, 1.5, S);
      }
      break;
    }
    case 'tile': {
      const n = 4, t = S / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = tint(m.color, 0.96 + r() * 0.08); g.fillRect(i * t, j * t, t, t); }
      g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 2;
      for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke(); }
      noise(0.03);
      break;
    }
    case 'brick': {
      const rows = 8, bh = S / rows, bw = S / 4;
      g.fillStyle = '#d8d2c6'; g.fillRect(0, 0, S, S);
      for (let y = 0; y < rows; y++) for (let x = -1; x < 5; x++) { g.fillStyle = tint(m.color, 0.82 + r() * 0.3); g.fillRect(x * bw + (y % 2 ? bw / 2 : 0) + 2, y * bh + 2, bw - 4, bh - 4); }
      noise(0.05);
      break;
    }
    case 'marble': {
      noise(0.025, 3000, 3);
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = `rgba(110,110,115,${0.12 + r() * 0.18})`; g.lineWidth = 0.6 + r() * 1.6;
        g.beginPath(); let x = r() * S, y = 0; g.moveTo(x, y);
        while (y < S) { x += (r() - 0.45) * 30; y += 10 + r() * 20; g.lineTo(x, y); }
        g.stroke();
      }
      break;
    }
    case 'stone': {
      for (let i = 0; i < 26; i++) { g.fillStyle = tint(m.color, 0.8 + r() * 0.35); g.beginPath(); const x = r() * S, y = r() * S, w = 30 + r() * 60; g.ellipse(x, y, w, w * 0.55, r() * 3, 0, Math.PI * 2); g.fill(); }
      noise(0.07, 4000);
      break;
    }
    case 'grass': { noise(0.12, 9000, 2); break; }
    case 'water': {
      const grd = g.createLinearGradient(0, 0, S, S); grd.addColorStop(0, tint(m.color, 1.12)); grd.addColorStop(1, tint(m.color, 0.85)); g.fillStyle = grd; g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      for (let i = 0; i < 40; i++) { g.beginPath(); const x = r() * S, y = r() * S; g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 4, x + 24, y); g.stroke(); }
      break;
    }
    case 'concrete': { noise(0.06, 6000, 2); break; }
    case 'tiles-roof': {
      const rows = 6, h = S / rows;
      for (let y = 0; y < rows; y++) { g.fillStyle = tint(m.color, 0.9 + r() * 0.15); g.fillRect(0, y * h, S, h); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y * h + h - 3, S, 3); for (let x = 0; x < 8; x++) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x * (S / 8) + (y % 2 ? S / 16 : 0), y * h, 1.5, h); } }
      break;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  texCache.set(key, tex);
  return tex;
}

const PAPER = '#f4f2ee';

export function material3d(id: string, style: RenderStyle, opts: { highlight?: boolean; color?: string } = {}): THREE.Material {
  const key = `${id}|${style}|${opts.highlight ? 1 : 0}|${opts.color ?? ''}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = getMaterial(id);
  const glass = m.category === 'glass' || id === 'glass';
  const water = m.category === 'water';
  const site = id === 'ground' || id === 'lawn' || id === 'asphalt';
  let mat: THREE.Material;
  const color = opts.color ?? m.color;
  if (style === 'realistic') {
    const tex = opts.color ? null : makeTexture(m);
    const std = new THREE.MeshStandardMaterial({
      color: tex ? '#ffffff' : color, map: tex ?? undefined, roughness: m.roughness, metalness: m.metalness,
      transparent: glass || water, opacity: glass ? 0.32 : water ? 0.85 : 1, side: THREE.DoubleSide, envMapIntensity: 0.8,
    });
    if (tex) std.userData.repeatMm = m.patternScale * (PATTERN_REPS[m.pattern] ?? 1);
    mat = std;
  } else if (style === 'draft') {
    mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, transparent: glass, opacity: glass ? 0.35 : 1 });
  } else if (style === 'clay') {
    mat = new THREE.MeshStandardMaterial({ color: glass ? '#cfd8dc' : site ? '#dcd8cf' : '#ebe8e2', roughness: 0.95, side: THREE.DoubleSide, transparent: glass, opacity: glass ? 0.5 : 1 });
  } else if (style === 'architectural') {
    mat = new THREE.MeshStandardMaterial({ color: glass ? '#b9cfd8' : water ? '#a9d3dd' : id === 'lawn' ? '#dfe5d3' : id === 'ground' ? '#ecebe6' : PAPER, roughness: 0.9, side: THREE.DoubleSide, transparent: glass, opacity: glass ? 0.45 : 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  } else if (style === 'sketch') {
    mat = new THREE.MeshBasicMaterial({ color: glass ? '#e6eef1' : '#fbfaf7', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  } else if (style === 'xray') {
    mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: site ? 0.5 : 0.18, depthWrite: false, side: THREE.DoubleSide });
  } else {
    mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  }
  if (opts.highlight && 'emissive' in mat) {
    (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color('#3358d4');
    (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.45;
  }
  matCache.set(key, mat);
  return mat;
}

export function edgeMaterial(style: RenderStyle): THREE.LineBasicMaterial {
  const key = `edge|${style}`;
  if (matCache.has(key)) return matCache.get(key) as THREE.LineBasicMaterial;
  const m = new THREE.LineBasicMaterial({ color: style === 'xray' ? '#3358d4' : '#2a2926', transparent: true, opacity: style === 'architectural' ? 0.55 : style === 'xray' ? 0.5 : 0.9 });
  matCache.set(key, m);
  return m;
}
