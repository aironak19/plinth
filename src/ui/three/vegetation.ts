/**
 * Procedural plants. Each growth form is described once as a skeleton — woody
 * tubes, leafy puffs, arching strips and loose cards — and rendered two ways:
 * as textured leaf cards for the realistic style, or as clean solids for the
 * architectural, clay and sketch styles. Geometry is cached per species and
 * variant, so a garden of two hundred plants costs a handful of buffers.
 */
import * as THREE from 'three';
import type { Plant } from '../../core/catalog/plants';
import { leafTexture, rng, hash, type LeafStyle } from './textures';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export interface PlantView { season: Season; /** 0–1: nursery size to mature. */ age: number }

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

interface Puff { c: V; r: V; density: number; leaf: LeafStyle; solid?: boolean }
interface Strip { pts: V[]; width: number; leaf: LeafStyle; taper?: number }
interface Card { c: V; right: V; up: V; leaf: LeafStyle; bloom?: boolean }
interface Tube { pts: V[]; radii: number[]; green?: boolean }
interface Skeleton { tubes: Tube[]; puffs: Puff[]; strips: Strip[]; cards: Card[]; crown: { c: V; h: number }; blooms: boolean }

const FROND_IDS = new Set(['cycas', 'fern', 'philodendron']);
const PLUME_IDS = new Set(['pampas', 'fountain-grass']);

function fib(n: number, i: number): V {
  const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.399963;
  return v3(Math.cos(a) * r, y, Math.sin(a) * r);
}

function arch(base: V, az: number, elev: number, len: number, droop: number, n = 6): V[] {
  const d = v3(Math.cos(az), 0, Math.sin(az)), pts: V[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, e = elev - droop * t * t * 1.6;
    pts.push(base.clone().addScaledVector(d, len * t * Math.max(0.15, Math.cos(e))).add(v3(0, len * t * Math.sin(elev) - droop * len * t * t * 0.55, 0)));
  }
  return pts;
}

function skeleton(p: Plant, r: () => number, leavesOn: boolean): Skeleton {
  const H = p.height / 1000, W = p.spread / 1000;
  const s: Skeleton = { tubes: [], puffs: [], strips: [], cards: [], crown: { c: v3(0, H * 0.6, 0), h: H * 0.8 }, blooms: !!p.flower };
  const fine: LeafStyle = W > 7 || p.id === 'neem' || p.id === 'jacaranda' || p.id === 'gulmohar' || p.id === 'rain-tree' || p.id === 'amaltas' ? 'fine' : 'broad';
  const lean = (r() - 0.5) * H * 0.05;
  const trunkR = Math.max(0.05, Math.min(0.42, W * 0.026 + H * 0.006));
  const dens = leavesOn ? 1 : 0.1;

  const woody = (trunkH: number, crownC: V, crownR: V, n: number, puffScale: number) => {
    const top = v3(lean, trunkH, lean * 0.5);
    s.tubes.push({ pts: [v3(), v3(lean * 0.4, trunkH * 0.5, 0), top], radii: [trunkR, trunkR * 0.78, trunkR * 0.6] });
    for (let i = 0; i < n; i++) {
      const u = fib(n, i), c = crownC.clone().add(v3(u.x * crownR.x * 0.56, u.y * crownR.y * 0.5, u.z * crownR.z * 0.56));
      c.add(v3((r() - 0.5) * crownR.x * 0.16, (r() - 0.5) * crownR.y * 0.14, (r() - 0.5) * crownR.z * 0.16));
      s.puffs.push({ c, r: v3(crownR.x * puffScale, crownR.y * puffScale * 0.92, crownR.z * puffScale).multiplyScalar(0.9 + r() * 0.25), density: dens, leaf: fine });
      if (i % 2 === 0 || !leavesOn) s.tubes.push({ pts: [top.clone().lerp(v3(lean * 0.4, trunkH * 0.5, 0), 0.25 * r()), top.clone().lerp(c, 0.55), c], radii: [trunkR * 0.42, trunkR * 0.26, trunkR * 0.1] });
    }
    s.crown = { c: crownC, h: crownR.y * 2 };
  };

  switch (p.form) {
    case 'canopy': { const th = H * 0.36; woody(th, v3(lean, th + (H - th) * 0.52, 0), v3(W / 2, (H - th) * 0.55, W / 2), 10, 0.52); break; }
    case 'umbrella': { const th = H * 0.52; woody(th, v3(lean, th + (H - th) * 0.55, 0), v3(W / 2, (H - th) * 0.5, W / 2), 11, 0.46); break; }
    case 'weeping': {
      const th = H * 0.4; woody(th, v3(lean, th + (H - th) * 0.58, 0), v3(W / 2, (H - th) * 0.5, W / 2), 9, 0.5);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + r(); s.puffs.push({ c: v3(Math.cos(a) * W * 0.38, th + (H - th) * 0.22, Math.sin(a) * W * 0.38), r: v3(W * 0.1, (H - th) * 0.34, W * 0.1), density: dens * 0.8, leaf: 'fine' }); }
      break;
    }
    case 'columnar': {
      s.tubes.push({ pts: [v3(), v3(0, H * 0.14, 0)], radii: [trunkR * 0.8, trunkR * 0.7] });
      // A spindle of overlapping tufts: widest a third of the way up, tapering to a point.
      for (let i = 0; i < 8; i++) { const t = i / 7, k = Math.sin(Math.PI * Math.pow(0.12 + t * 0.86, 0.75)); s.puffs.push({ c: v3((r() - 0.5) * W * 0.08, H * (0.16 + t * 0.74), (r() - 0.5) * W * 0.08), r: v3((W / 2) * (0.35 + 0.65 * k), H * 0.105, (W / 2) * (0.35 + 0.65 * k)), density: 1.25, leaf: p.id === 'cypress' ? 'needle' : 'fine' }); }
      s.crown = { c: v3(0, H * 0.55, 0), h: H * 0.9 };
      break;
    }
    case 'conifer': {
      s.tubes.push({ pts: [v3(), v3(0, H * 0.96, 0)], radii: [trunkR * 0.9, trunkR * 0.12] });
      const tiers = 7;
      for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1), y = H * (0.16 + t * 0.78), R = (W / 2) * (1 - t * 0.86), n = Math.max(3, 6 - Math.floor(t * 3));
        for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + i * 0.7; s.puffs.push({ c: v3(Math.cos(a) * R * 0.55, y, Math.sin(a) * R * 0.55), r: v3(R * 0.55, H * 0.045, R * 0.55), density: 0.9, leaf: 'needle' }); }
      }
      s.crown = { c: v3(0, H * 0.55, 0), h: H * 0.85 };
      break;
    }
    case 'palm': case 'fanpalm': {
      const crownR = W / 2, th = H - crownR * (p.form === 'fanpalm' ? 0.55 : 0.5), bend = (r() - 0.5) * H * (p.id === 'coconut' ? 0.22 : 0.05);
      const tr = Math.max(0.09, Math.min(0.28, H * 0.016)) * (p.form === 'fanpalm' ? 1.5 : 1), top = v3(bend, th, bend * 0.4);
      s.tubes.push({ pts: [v3(), v3(bend * 0.25, th * 0.5, 0), top], radii: [tr * 1.25, tr * 0.9, tr * 0.8] });
      const n = p.form === 'fanpalm' ? 20 : 17;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.3, e = 1.05 - (i % 4) * 0.42 + (r() - 0.5) * 0.2;
        if (p.form === 'palm') s.strips.push({ pts: arch(top, a, e, crownR * (0.95 + r() * 0.2), 0.55 + r() * 0.3, 7), width: crownR * 0.36, leaf: 'frond' });
        else { const stalk = arch(top, a, e, crownR * 0.55, 0.15, 2), tip = stalk[stalk.length - 1]; s.tubes.push({ pts: [top, tip], radii: [0.025, 0.018], green: true }); s.strips.push({ pts: arch(tip, a, e - 0.25, crownR * 0.6, 0.2, 2), width: crownR * 0.72, leaf: 'fan', taper: 1 }); }
      }
      s.crown = { c: top, h: crownR * 1.6 };
      break;
    }
    case 'clumppalm': {
      const stems = 7;
      for (let k = 0; k < stems; k++) {
        const a = (k / stems) * Math.PI * 2 + r(), out = W * (0.05 + r() * 0.1), h = H * (0.55 + r() * 0.35), top = v3(Math.cos(a) * (out + h * 0.14), h, Math.sin(a) * (out + h * 0.14));
        s.tubes.push({ pts: [v3(Math.cos(a) * out, 0, Math.sin(a) * out), top], radii: [0.04, 0.028], green: true });
        for (let i = 0; i < 7; i++) s.strips.push({ pts: arch(top, (i / 7) * Math.PI * 2 + r(), 1 - (i % 3) * 0.4, W * 0.32, 0.6, 5), width: W * 0.13, leaf: 'frond' });
      }
      s.crown = { c: v3(0, H * 0.7, 0), h: H * 0.7 };
      break;
    }
    case 'bamboo': {
      for (let k = 0; k < 18; k++) {
        const a = r() * Math.PI * 2, out = Math.sqrt(r()) * W * 0.16, h = H * (0.65 + r() * 0.35), sway = h * (0.06 + r() * 0.1);
        const base = v3(Math.cos(a) * out, 0, Math.sin(a) * out), top = v3(Math.cos(a) * (out + sway), h, Math.sin(a) * (out + sway));
        s.tubes.push({ pts: [base, base.clone().lerp(top, 0.5).add(v3(0, 0, 0)), top], radii: [0.028, 0.024, 0.012] });
        for (let i = 0; i < 3; i++) { const t = 0.45 + i * 0.2 + r() * 0.1; s.puffs.push({ c: base.clone().lerp(top, t), r: v3(W * 0.16, H * 0.07, W * 0.16), density: 0.55 * dens, leaf: 'fine' }); }
      }
      break;
    }
    case 'shrub': case 'climber': {
      const tall = p.form === 'climber', n = 7;
      for (let i = 0; i < n; i++) { const u = fib(n * 2, i); s.puffs.push({ c: v3(u.x * W * 0.24, H * (tall ? 0.5 : 0.48) + u.y * H * 0.2, u.z * W * 0.24), r: v3(W * 0.3, H * (tall ? 0.42 : 0.36), W * 0.3), density: dens, leaf: 'broad' }); }
      s.tubes.push({ pts: [v3(), v3(0, H * 0.4, 0)], radii: [Math.min(0.05, W * 0.03), 0.02] });
      s.crown = { c: v3(0, H * 0.5, 0), h: H };
      break;
    }
    case 'topiary': s.puffs.push({ c: v3(0, H * 0.5, 0), r: v3(W / 2, H / 2, W / 2), density: 0.7, leaf: 'needle', solid: true }); s.crown = { c: v3(0, H * 0.5, 0), h: H }; break;
    case 'grass': {
      const n = 22;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r(), tilt = 0.12 + r() * 0.45, up = v3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).multiplyScalar(H * (0.42 + r() * 0.12)), right = v3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(W * 0.2); s.cards.push({ c: up.clone().add(v3(Math.cos(a) * W * 0.05, 0, Math.sin(a) * W * 0.05)), right, up, leaf: 'blade' }); }
      if (PLUME_IDS.has(p.id) && leavesOn) for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, d = W * 0.18 * r(); s.cards.push({ c: v3(Math.cos(a) * d, H * 0.82, Math.sin(a) * d), right: v3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(W * 0.1), up: v3(Math.cos(a) * 0.15, 1, Math.sin(a) * 0.15).multiplyScalar(H * 0.2), leaf: 'plume', bloom: true }); }
      s.crown = { c: v3(0, H * 0.4, 0), h: H };
      break;
    }
    case 'flower': case 'groundcover': {
      const low = p.form === 'groundcover', n = low ? 5 : 6;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r(); s.puffs.push({ c: v3(Math.cos(a) * W * 0.2, H * 0.4, Math.sin(a) * W * 0.2), r: v3(W * 0.32, H * 0.42, W * 0.32), density: dens * 0.8, leaf: low ? 'fine' : 'broad' }); }
      s.crown = { c: v3(0, H * 0.4, 0), h: H };
      break;
    }
    case 'rosette': {
      const trunk = p.id === 'yucca' ? H * 0.5 : p.id === 'cycas' ? H * 0.22 : 0, base = v3(0, trunk + 0.03, 0), n = p.id === 'agave' || p.id === 'aloe' ? 16 : 20, L = Math.max(W / 2, (H - trunk) * 0.8);
      if (trunk) s.tubes.push({ pts: [v3(), base], radii: [Math.max(0.08, W * 0.07), Math.max(0.07, W * 0.06)] });
      for (let i = 0; i < n; i++) s.strips.push({ pts: arch(base, (i / n) * Math.PI * 2 + r() * 0.3, 1.25 - (i % 4) * 0.33, L * (0.85 + r() * 0.3), FROND_IDS.has(p.id) ? 0.7 : 0.25, 5), width: L * (FROND_IDS.has(p.id) ? 0.3 : 0.2), leaf: FROND_IDS.has(p.id) ? 'frond' : 'paddle' });
      s.crown = { c: v3(0, trunk + H * 0.25, 0), h: H };
      break;
    }
    case 'paddle': {
      const fanned = p.id === 'travellers', trunk = p.id === 'banana' ? H * 0.45 : fanned ? H * 0.42 : 0, base = v3(0, trunk + 0.02, 0), L = (H - trunk) * (fanned ? 0.98 : 0.92);
      if (trunk) s.tubes.push({ pts: [v3(), base], radii: [Math.max(0.1, W * 0.05), Math.max(0.08, W * 0.04)], green: p.id === 'banana' });
      const n = fanned ? 13 : trunk ? 9 : 11;
      for (let i = 0; i < n; i++) {
        if (fanned) { const e = Math.PI / 2 - (i - (n - 1) / 2) * 0.2; s.strips.push({ pts: arch(base, e >= Math.PI / 2 ? Math.PI : 0, Math.min(e, Math.PI - e), L, 0.12, 5), width: L * 0.24, leaf: 'paddle' }); }
        else s.strips.push({ pts: arch(base, (i / n) * Math.PI * 2 + r() * 0.4, 1.35 - (i % 3) * 0.3 - r() * 0.15, L * (0.8 + r() * 0.25), 0.35 + r() * 0.2, 5), width: Math.min(W * 0.34, L * 0.3), leaf: 'paddle' });
      }
      s.crown = { c: v3(0, trunk + L * 0.4, 0), h: H };
      break;
    }
    case 'aquatic': {
      const lotus = p.id === 'lotus', n = lotus ? 7 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r(), d = W * (0.12 + r() * 0.3), y = lotus ? H * (0.25 + r() * 0.3) : -0.02, c = v3(Math.cos(a) * d, y, Math.sin(a) * d), sz = W * (0.16 + r() * 0.1);
        s.cards.push({ c, right: v3(sz, 0, 0), up: v3(0, 0.02, sz), leaf: 'pad' });
        if (lotus) s.tubes.push({ pts: [v3(c.x, -0.3, c.z), c], radii: [0.012, 0.01], green: true });
      }
      if (leavesOn) for (let i = 0; i < 4; i++) { const a = r() * Math.PI * 2, d = W * 0.28 * r(), y = lotus ? H * 0.75 : 0.06, c = v3(Math.cos(a) * d, y, Math.sin(a) * d); s.cards.push({ c, right: v3(W * 0.09, 0, 0), up: v3(0, 0.03, W * 0.09), leaf: 'bloom', bloom: true }); if (lotus) s.tubes.push({ pts: [v3(c.x, -0.3, c.z), c], radii: [0.012, 0.01], green: true }); }
      s.crown = { c: v3(0, H * 0.4, 0), h: Math.max(0.3, H) };
      break;
    }
  }
  return s;
}

// ------------------------------------------------------------ geometry

class Geo {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  tri(a: V, b: V, c: V, na: V, nb: V, nc: V, ua: [number, number], ub: [number, number], uc: [number, number], t: number) {
    for (const [p, n, u] of [[a, na, ua], [b, nb, ub], [c, nc, uc]] as const) { this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u[0], u[1]); this.col.push(t, t, t, 1); }
  }
  quad(c: V, right: V, up: V, n: V, t: number) {
    const a = c.clone().sub(right).sub(up), b = c.clone().add(right).sub(up), d = c.clone().add(right).add(up), e = c.clone().sub(right).add(up);
    this.tri(a, b, d, n, n, n, [0, 0], [1, 0], [1, 1], t); this.tri(a, d, e, n, n, n, [0, 0], [1, 1], [0, 1], t);
  }
  strip(pts: V[], width: number, taper: number, t: number) {
    const L: V[] = [], R: V[] = [], N: V[] = [];
    for (let i = 0; i < pts.length; i++) {
      const dir = (pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)])).normalize();
      const side = v3(-dir.z, 0, dir.x); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
      const w = (width / 2) * (taper >= 1 ? 1 : 1 - taper * (i / Math.max(1, pts.length - 1)));
      L.push(pts[i].clone().addScaledVector(side, -w)); R.push(pts[i].clone().addScaledVector(side, w));
      N.push(side.clone().cross(dir).normalize().multiplyScalar(-1).add(v3(0, 0.6, 0)).normalize());
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const v0 = i / (pts.length - 1), v1 = (i + 1) / (pts.length - 1);
      this.tri(L[i], R[i], R[i + 1], N[i], N[i], N[i + 1], [0, v0], [1, v0], [1, v1], t); this.tri(L[i], R[i + 1], L[i + 1], N[i], N[i + 1], N[i + 1], [0, v0], [1, v1], [0, v1], t);
    }
  }
  tube(pts: V[], radii: number[], segs = 7) {
    const rings: V[][] = [], norms: V[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const dir = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
      const a = Math.abs(dir.y) > 0.95 ? v3(1, 0, 0) : v3(0, 1, 0), u = a.clone().cross(dir).normalize(), w = dir.clone().cross(u).normalize();
      const ring: V[] = [], nr: V[] = [];
      for (let k = 0; k <= segs; k++) { const t = (k / segs) * Math.PI * 2, n = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(w, Math.sin(t)); nr.push(n); ring.push(pts[i].clone().addScaledVector(n, radii[Math.min(i, radii.length - 1)])); }
      rings.push(ring); norms.push(nr);
    }
    for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < segs; k++) {
      const u0 = k / segs, u1 = (k + 1) / segs, v0 = i, v1 = i + 1;
      this.tri(rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], norms[i][k], norms[i][k + 1], norms[i + 1][k + 1], [u0, v0], [u1, v0], [u1, v1], 1);
      this.tri(rings[i][k], rings[i + 1][k + 1], rings[i + 1][k], norms[i][k], norms[i + 1][k + 1], norms[i + 1][k], [u0, v0], [u1, v1], [u0, v1], 1);
    }
  }
  ellipsoid(c: V, r: V, t: number) {
    const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      const vs = [0, 1, 2].map((k) => v3(p.getX(i + k), p.getY(i + k), p.getZ(i + k)));
      const ns = vs.map((q) => v3(q.x / r.x, q.y / r.y, q.z / r.z).normalize());
      const ws = vs.map((q) => v3(q.x * r.x, q.y * r.y, q.z * r.z).add(c));
      this.tri(ws[0], ws[1], ws[2], ns[0], ns[1], ns[2], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5], t);
    }
    g.dispose();
  }
  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    // RGBA: the path tracer reads vertex colour as four components.
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.computeBoundingSphere();
    return g;
  }
}

export interface PlantGeometry { parts: { key: string; geometry: THREE.BufferGeometry; kind: 'bark' | 'stem' | 'solid' | 'core' | LeafStyle; bloom?: boolean }[] }
const geoCache = new Map<string, PlantGeometry>();

function seasonColors(p: Plant, season: Season): [string, string] {
  if (!p.evergreen && season === 'autumn') return [p.foliage2 ?? '#c9862f', '#b5562a'];
  return [p.foliage, p.foliage2 ?? p.foliage];
}
export function bloomAmount(p: Plant, season: Season): number {
  if (!p.flower) return 0;
  const always = /year/i.test(p.flower.season);
  return season === 'spring' ? 1 : season === 'summer' ? (always ? 0.8 : 0.4) : season === 'autumn' ? (always ? 0.6 : 0.12) : always && p.evergreen ? 0.4 : 0;
}

function plantGeometry(p: Plant, variant: number, season: Season, realistic: boolean): PlantGeometry {
  const key = `${p.id}|${variant}|${season}|${realistic ? 1 : 0}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const r = rng(hash(`${p.id}:${variant}`));
  const leavesOn = p.evergreen || season !== 'winter';
  const sk = skeleton(p, r, leavesOn);
  const bloom = bloomAmount(p, season);
  const bark = new Geo(), stem = new Geo(), solid = new Geo(), core = new Geo();
  const leaves = new Map<string, Geo>();
  const lg = (leaf: LeafStyle, isBloom = false) => { const k = `${isBloom ? 'B' : 'L'}:${leaf}`; let g = leaves.get(k); if (!g) { g = new Geo(); leaves.set(k, g); } return g; };
  for (const t of sk.tubes) (t.green ? stem : bark).tube(t.pts, t.radii, t.radii[0] > 0.12 ? 9 : 6);
  const cBottom = sk.crown.c.y - sk.crown.h / 2;
  const tintAt = (y: number, inner: number) => Math.max(0.42, Math.min(1.12, 0.6 + 0.5 * ((y - cBottom) / Math.max(0.2, sk.crown.h)))) * (0.78 + 0.22 * inner);
  const H = p.height / 1000, W = p.spread / 1000;

  if (!realistic) {
    for (const pf of sk.puffs) if (leavesOn || pf.solid) solid.ellipsoid(pf.c, pf.r, 1);
    for (const st of sk.strips) solid.strip(st.pts, st.width * 0.8, 1, 1);
    if (!sk.puffs.length && !sk.strips.length) solid.ellipsoid(v3(0, H * 0.45, 0), v3(W * 0.45, H * 0.45, W * 0.45), 1);
  } else {
    for (const pf of sk.puffs) {
      if (pf.solid) solid.ellipsoid(pf.c, pf.r.clone().multiplyScalar(0.93), 1);
      // A dark core inside every puff stops daylight showing straight through the crown.
      else if (pf.density > 0.5) core.ellipsoid(pf.c, pf.r.clone().multiplyScalar(0.6), 1);
      const vol = Math.cbrt(pf.r.x * pf.r.y * pf.r.z), size = Math.max(0.18, Math.min(1.3, vol * 0.62)), n = Math.round(Math.max(6, Math.min(90, 34 * pf.density * (pf.solid ? 1.4 : 1))));
      for (let i = 0; i < n; i++) {
        const u = v3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(), rf = pf.solid ? 0.98 : 0.62 + r() * 0.42;
        const c = pf.c.clone().add(v3(u.x * pf.r.x * rf, u.y * pf.r.y * rf, u.z * pf.r.z * rf));
        const out = c.clone().sub(sk.crown.c).normalize().add(v3(0, 0.35, 0)).normalize();
        const tangent = v3(r() - 0.5, r() - 0.5, r() - 0.5).cross(u).normalize(), up = u.clone().cross(tangent).normalize(), sz = size * (0.7 + r() * 0.6) * (pf.solid ? 0.5 : 1);
        // Tilt each card away from the pure tangent plane so the crown has depth from every angle.
        const k = (r() - 0.5) * 0.9; tangent.addScaledVector(u, k).normalize(); up.addScaledVector(u, (r() - 0.5) * 0.9).normalize();
        const flower = bloom > 0 && rf > 0.82 && r() < bloom * (p.evergreen ? 0.45 : 0.75);
        lg(flower ? 'bloom' : pf.leaf, flower).quad(c, tangent.multiplyScalar(sz), up.multiplyScalar(sz), out, flower ? 1 : tintAt(c.y, rf));
      }
    }
    for (const st of sk.strips) lg(st.leaf).strip(st.pts, st.width, st.taper ?? 0, 0.82 + r() * 0.3);
    for (const cd of sk.cards) { const n = cd.right.clone().cross(cd.up).normalize(); if (n.y < 0) n.negate(); lg(cd.leaf, !!cd.bloom).quad(cd.c, cd.right, cd.up, n.add(v3(0, 0.8, 0)).normalize(), 0.85 + r() * 0.3); }
    // Flowering herbs and ground covers carry their colour on top.
    if ((p.form === 'flower' || p.form === 'groundcover') && bloom > 0) for (let i = 0; i < Math.round(12 * bloom); i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * W * 0.4, sz = Math.max(0.1, W * 0.2); lg('bloom', true).quad(v3(Math.cos(a) * d, H * (0.72 + r() * 0.2), Math.sin(a) * d), v3(sz, 0, 0), v3(0, 0.05, sz), v3(0, 1, 0), 1); }
  }
  const out: PlantGeometry = { parts: [] };
  const push = (g: Geo, kind: PlantGeometry['parts'][number]['kind'], k: string, isBloom = false) => { const geo = g.build(); if (geo) out.parts.push({ key: k, geometry: geo, kind, bloom: isBloom }); };
  push(bark, 'bark', 'bark'); push(stem, 'stem', 'stem'); push(solid, 'solid', 'solid'); push(core, 'core', 'core');
  for (const [k, g] of leaves) push(g, k.slice(2) as LeafStyle, k, k[0] === 'B');
  void seasonColors;
  geoCache.set(key, out);
  return out;
}

// ------------------------------------------------------------ materials

/** Shared clock for wind sway; the viewport advances it every frame. */
export const wind = { value: 0 };
const matCache = new Map<string, THREE.Material>();

function sway(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = `uniform float uWind;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      float plinthSway = sin(uWind * 1.3 + position.x * 1.7 + position.z * 1.3) * 0.011 * max(position.y, 0.0) + sin(uWind * 3.1 + position.y * 2.3) * 0.004;
      transformed.x += plinthSway; transformed.z += plinthSway * 0.6;`);
  };
  m.customProgramCacheKey = () => 'plinth-sway';
}

function leafMaterial(leaf: LeafStyle, c1: string, c2: string, seedKey: string): THREE.Material {
  const key = `leaf|${leaf}|${c1}|${c2}|${seedKey}`;
  let m = matCache.get(key);
  if (!m) {
    const std = new THREE.MeshStandardMaterial({ map: leafTexture(leaf, c1, c2, seedKey), alphaTest: 0.3, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 0.55 });
    sway(std);
    m = std; matCache.set(key, m);
  }
  return m;
}
function darken(hex: string, f: number) { const n = parseInt(hex.slice(1), 16); const c = (v: number) => Math.round(v * f).toString(16).padStart(2, '0'); return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`; }
function plainMaterial(color: string, key: string, rough = 0.95): THREE.Material {
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, vertexColors: false, envMapIntensity: 0.4 }); matCache.set(key, m); }
  return m;
}

/**
 * Build one plant at its real size. `flat` supplies the single material used
 * by the non-photographic render styles.
 */
export function buildPlant(p: Plant, size: { w: number; h: number }, seedKey: string, view: PlantView, flat?: { leaf: THREE.Material; bark: THREE.Material }): THREE.Group {
  const seed = hash(seedKey), variant = seed % 4;
  const geo = plantGeometry(p, variant, view.season, !flat);
  const [c1, c2] = seasonColors(p, view.season);
  const group = new THREE.Group();
  for (const part of geo.parts) {
    let mat: THREE.Material;
    if (flat) mat = part.kind === 'bark' ? flat.bark : flat.leaf;
    else if (part.kind === 'bark') mat = plainMaterial(p.bark ?? '#6d5440', `bark|${p.bark ?? ''}`);
    else if (part.kind === 'stem') mat = plainMaterial(p.bark && p.type === 'bamboo' ? p.bark : c1, `stem|${p.id}|${c1}`, 0.7);
    else if (part.kind === 'solid') mat = plainMaterial(c1, `solid|${c1}`, 1);
    else if (part.kind === 'core') mat = plainMaterial(darken(c1, 0.42), `core|${c1}`, 1);
    else if (part.bloom) mat = part.kind === 'plume' ? leafMaterial('plume', p.foliage2 ?? '#efe6cf', '#ffffff', p.id) : leafMaterial('bloom', p.flower?.color ?? '#ffffff', p.flower?.color ?? '#ffffff', p.id);
    else mat = leafMaterial(part.kind as LeafStyle, c1, c2, p.id);
    const mesh = new THREE.Mesh(part.geometry, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.shared = true;
    group.add(mesh);
  }
  const age = 0.42 + 0.58 * Math.max(0, Math.min(1, view.age));
  const jitter = 0.9 + ((seed >> 4) % 100) / 500;
  const sx = (size.w / p.spread) * age * jitter, sy = (size.h / p.height) * age * jitter;
  group.scale.set(sx, sy, sx);
  group.rotation.y = ((seed >> 8) % 628) / 100;
  return group;
}
