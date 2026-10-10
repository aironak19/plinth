/**
 * Procedural PBR materials. Albedo and normal maps are generated from the
 * catalogue's pattern + colour (see textures.ts), so every material renders
 * without downloads and stays consistent with the swatches shown in the
 * library and inspector. Glass, water and lamps respond to the time of day.
 */
import * as THREE from 'three';
import { getMaterial, type MaterialPattern } from '../../core/catalog/materials';
import type { RenderStyle } from '../../core/model/types';
import { textureSet, waterNormal } from './textures';

const matCache = new Map<string, THREE.Material>();

/** How many pattern units one texture tile contains (so UV scale = patternScale × reps). */
export const PATTERN_REPS: Record<MaterialPattern, number> = {
  wood: 4, plank: 4, tile: 4, brick: 4, marble: 1, stone: 3, grass: 1.6, water: 1, concrete: 1, 'tiles-roof': 6, none: 1,
  gravel: 1, cobble: 8, herringbone: 4, crazy: 1, soil: 1, foliage: 1, asphalt: 2, plaster: 1.2,
};

const PAPER = '#f4f2ee';

// Materials whose glow follows the time of day.
const glass = new Set<THREE.MeshPhysicalMaterial>();
const lamps = new Set<THREE.MeshStandardMaterial>();
let night = 0;

/** 0 = full daylight, 1 = night. Windows glow from inside and lamps switch on. */
export function setNight(f: number) {
  night = f;
  for (const g of glass) { g.emissiveIntensity = 0.85 * f; g.opacity = 0.5 + 0.3 * f; }
  for (const l of lamps) l.emissiveIntensity = 0.25 + 3.2 * f;
}

/** Advance animated surfaces (water ripples). */
export function tickMaterials(dt: number) {
  const n = waterNormal();
  n.offset.x = (n.offset.x + dt * 0.012) % 1;
  n.offset.y = (n.offset.y + dt * 0.007) % 1;
}

const SLOT_PBR: Record<string, { roughness: number; metalness: number }> = {
  metal: { roughness: 0.38, metalness: 0.85 }, wood: { roughness: 0.62, metalness: 0 }, fabric: { roughness: 1, metalness: 0 },
  stone: { roughness: 0.88, metalness: 0 }, dark: { roughness: 0.55, metalness: 0.2 }, white: { roughness: 0.5, metalness: 0 },
  body: { roughness: 0.32, metalness: 0.55 }, roof: { roughness: 0.8, metalness: 0.05 }, soil: { roughness: 1, metalness: 0 }, sand: { roughness: 1, metalness: 0 },
  leaf: { roughness: 0.9, metalness: 0 }, trunk: { roughness: 0.95, metalness: 0 }, accent: { roughness: 0.6, metalness: 0 },
};

export function material3d(id: string, style: RenderStyle, opts: { highlight?: boolean; color?: string } = {}): THREE.Material {
  const key = `${id}|${style}|${opts.highlight ? 1 : 0}|${opts.color ?? ''}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = getMaterial(id);
  const slot = id.startsWith('slot-') ? id.slice(5) : null;
  const isGlass = m.category === 'glass' || id === 'glass' || slot === 'glass';
  const isWater = m.category === 'water' || slot === 'water';
  const isLamp = slot === 'light';
  const site = id === 'ground' || id === 'lawn' || id === 'asphalt';
  let mat: THREE.Material;
  const color = opts.color ?? m.color;
  if (style === 'realistic') {
    if (isGlass) {
      const g = new THREE.MeshPhysicalMaterial({ color: '#5f7880', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.5, side: THREE.DoubleSide, envMapIntensity: 5.5, ior: 1.52, specularIntensity: 1, emissive: new THREE.Color('#ffcf8f'), emissiveIntensity: 0, depthWrite: false });
      // Only building glazing glows at night; car windows and glass table tops stay dark.
      if (!slot) glass.add(g);
      mat = g;
    } else if (isWater) {
      const w = new THREE.MeshPhysicalMaterial({ color: slot ? '#5fb4c9' : color, roughness: 0.05, metalness: 0, transparent: true, opacity: m.opacity ?? 0.82, side: THREE.DoubleSide, normalMap: waterNormal(), normalScale: new THREE.Vector2(0.32, 0.32), clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 4.5, ior: 1.33 });
      w.userData.repeatMm = 2600;
      mat = w;
    } else if (isLamp) {
      const l = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: new THREE.Color(opts.color ?? '#ffd08a'), emissiveIntensity: 0.25, roughness: 0.4 });
      lamps.add(l); mat = l;
    } else if (slot || opts.color) {
      const pbr = SLOT_PBR[slot ?? ''] ?? { roughness: m.roughness, metalness: m.metalness };
      mat = new THREE.MeshStandardMaterial({ color, roughness: pbr.roughness, metalness: pbr.metalness, side: THREE.DoubleSide, envMapIntensity: 0.9 });
    } else {
      // Painted and plastered surfaces still get a fine trowel texture so light rakes across them.
      const pattern = m.pattern === 'none' ? (m.category === 'metal' || m.category === 'fabric' ? null : 'plaster') : (m.pattern as Exclude<MaterialPattern, 'none' | 'water'>);
      const set = pattern ? textureSet(m, pattern, pattern === 'plaster' ? 'shared-plaster' : undefined) : null;
      const std = new THREE.MeshStandardMaterial({
        color: set && m.pattern !== 'none' ? '#ffffff' : color, map: set && m.pattern !== 'none' ? set.map : undefined,
        normalMap: set?.normalMap, normalScale: set ? new THREE.Vector2(set.normalScale, set.normalScale) : undefined,
        roughness: m.roughness, metalness: m.metalness, side: THREE.DoubleSide, envMapIntensity: m.roughness < 0.4 ? 1.1 : 0.75,
      });
      if (set) std.userData.repeatMm = m.pattern === 'none' ? 1400 : m.patternScale * (PATTERN_REPS[m.pattern] ?? 1);
      mat = std;
    }
  } else if (style === 'draft') {
    mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, transparent: isGlass, opacity: isGlass ? 0.35 : 1 });
  } else if (style === 'clay') {
    mat = new THREE.MeshStandardMaterial({ color: isGlass ? '#cfd8dc' : site ? '#dcd8cf' : '#ebe8e2', roughness: 0.95, side: THREE.DoubleSide, transparent: isGlass, opacity: isGlass ? 0.5 : 1 });
  } else if (style === 'architectural') {
    mat = new THREE.MeshStandardMaterial({ color: isGlass ? '#b9cfd8' : isWater ? '#a9d3dd' : id === 'lawn' || slot === 'leaf' ? '#dfe5d3' : id === 'ground' ? '#ecebe6' : PAPER, roughness: 0.9, side: THREE.DoubleSide, transparent: isGlass, opacity: isGlass ? 0.45 : 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  } else if (style === 'sketch') {
    mat = new THREE.MeshBasicMaterial({ color: isGlass ? '#e6eef1' : '#fbfaf7', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
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
  if ((isGlass && !slot) || isLamp) setNight(night);
  return mat;
}

export function edgeMaterial(style: RenderStyle): THREE.LineBasicMaterial {
  const key = `edge|${style}`;
  if (matCache.has(key)) return matCache.get(key) as THREE.LineBasicMaterial;
  const m = new THREE.LineBasicMaterial({ color: style === 'xray' ? '#3358d4' : '#2a2926', transparent: true, opacity: style === 'architectural' ? 0.55 : style === 'xray' ? 0.5 : 0.9 });
  matCache.set(key, m);
  return m;
}
