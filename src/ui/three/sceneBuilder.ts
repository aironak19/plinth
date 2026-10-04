/**
 * Model → three.js. Converts the shared Solid faces into BufferGeometry (with
 * world-space UVs so textures keep real-world scale) and builds furniture and
 * trees from the same asset recipes the plan symbols come from.
 */
import * as THREE from 'three';
import type { BuildingModel, ElementRef, ProjectDoc, RenderStyle } from '../../core/model/types';
import { buildSolids, type Face3, type Solid } from '../../core/derive/solids';
import type { RuleSet } from '../../core/rules/rulesets';
import { ASSET_BY_ID, assetColors } from '../../core/catalog/assets';
import { material3d, edgeMaterial } from './materials3d';
import { cross3, norm3, type Vec3 } from '../../core/geometry/vec';

/** Plan mm (x east, y north, z up) → three metres (x, y up, z south). */
export const toThree = (p: Vec3) => new THREE.Vector3(p.x / 1000, p.z / 1000, -p.y / 1000);
export const fromThree = (v: THREE.Vector3): Vec3 => ({ x: v.x * 1000, y: -v.z * 1000, z: v.y * 1000 });

function faceBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  if (Math.abs(n.z) > 0.92) return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: Math.sign(n.z) || 1, z: 0 } };
  const u = norm3(cross3({ x: 0, y: 0, z: 1 }, n));
  return { u, v: norm3(cross3(n, u)) };
}

export function solidGeometry(faces: Face3[], repeatMm?: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const rep = repeatMm ?? 1000;
  for (const f of faces) {
    const n = f.normal;
    if (!Number.isFinite(n.x) || (n.x === 0 && n.y === 0 && n.z === 0)) continue;
    const { u, v } = faceBasis(n);
    const proj = (p: Vec3) => new THREE.Vector2(p.x * u.x + p.y * u.y + p.z * u.z, p.x * v.x + p.y * v.y + p.z * v.z);
    const contour = f.outer.map(proj);
    const holes = (f.holes ?? []).map((h) => h.map(proj));
    let tris: number[][];
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { continue; }
    const all = [...f.outer, ...(f.holes ?? []).flat()];
    const all2 = [...contour, ...holes.flat()];
    // ShapeUtils may flip winding; orient each triangle to the face normal.
    for (const t of tris) {
      const [a, b, c] = t.map((i) => all[i]);
      const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const tn = cross3(e1, e2);
      const order = tn.x * n.x + tn.y * n.y + tn.z * n.z >= 0 ? t : [t[0], t[2], t[1]];
      for (const i of order) {
        const p = all[i];
        pos.push(p.x / 1000, p.z / 1000, -p.y / 1000);
        nor.push(n.x, n.z, -n.y);
        uv.push(all2[i].x / rep, all2[i].y / rep);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

export interface SceneResult { group: THREE.Group; pickables: THREE.Object3D[]; byRef: Map<string, THREE.Mesh[]> }

const NEEDS_EDGES: RenderStyle[] = ['architectural', 'sketch', 'wireframe', 'xray'];

export function buildScene(doc: ProjectDoc, b: BuildingModel, rules: RuleSet, style: RenderStyle, hiddenLevels: Set<string>, selectedIds: Set<string>): SceneResult {
  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const byRef = new Map<string, THREE.Mesh[]>();
  const solids: Solid[] = buildSolids(doc, b, rules, { hiddenLevels });
  const edges = NEEDS_EDGES.includes(style);
  for (const s of solids) {
    const sel = !!s.ref && selectedIds.has(s.ref.id);
    const mat = material3d(s.materialId, style, { highlight: sel });
    const geo = solidGeometry(s.faces, (mat.userData.repeatMm as number | undefined) ?? undefined);
    const mesh = new THREE.Mesh(geo, mat);
    const glass = s.layer === 'glass' || s.layer === 'water';
    mesh.castShadow = !glass && s.layer !== 'ground' && s.layer !== 'site' && s.layer !== 'road' && s.layer !== 'floor';
    mesh.receiveShadow = !glass;
    mesh.userData = { ref: s.ref, levelId: s.levelId, layer: s.layer };
    if (glass) mesh.renderOrder = 2;
    group.add(mesh);
    if (s.ref) {
      pickables.push(mesh);
      const k = `${s.ref.kind}:${s.ref.id}`;
      (byRef.get(k) ?? byRef.set(k, []).get(k)!).push(mesh);
    }
    if (edges && s.layer !== 'ground' && s.layer !== 'floor' && s.layer !== 'road') {
      const eg = new THREE.EdgesGeometry(geo, 24);
      const lines = new THREE.LineSegments(eg, sel ? new THREE.LineBasicMaterial({ color: '#3358d4' }) : edgeMaterial(style));
      lines.userData = { levelId: s.levelId };
      group.add(lines);
    }
  }
  // Furniture, cars & trees from asset recipes.
  for (const f of Object.values(b.furniture)) {
    if (hiddenLevels.has(f.levelId)) continue;
    const asset = ASSET_BY_ID[f.assetId];
    const level = b.levels[f.levelId];
    if (!asset || !level) continue;
    const colors = assetColors(asset, f.variant);
    const item = new THREE.Group();
    const sel = selectedIds.has(f.id);
    for (const p of asset.parts) {
      let geo: THREE.BufferGeometry;
      if (p.shape === 'box') { geo = new THREE.BoxGeometry(p.w / 1000, p.h / 1000, p.d / 1000); geo.translate(0, p.h / 2000, 0); }
      else if (p.shape === 'cyl') { geo = new THREE.CylinderGeometry(p.w / 2000, p.w / 2000, p.h / 1000, 18); geo.translate(0, p.h / 2000, 0); }
      else if (p.shape === 'cone') { geo = new THREE.ConeGeometry(p.w / 2000, p.h / 1000, 18); geo.translate(0, p.h / 2000, 0); }
      else { geo = new THREE.IcosahedronGeometry(p.w / 2000, p.slot === 'leaf' ? 1 : 2); geo.translate(0, p.h / 2000, 0); }
      const color = f.materialId && (p.slot === 'body' || p.slot === 'fabric') ? undefined : colors[p.slot];
      const mat = f.materialId && (p.slot === 'fabric' || p.slot === 'body') ? material3d(f.materialId, style, { highlight: sel }) : material3d(`slot-${p.slot}`, style, { color, highlight: sel });
      if (style === 'realistic' && p.slot === 'glass') (mat as THREE.MeshStandardMaterial).transparent = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x / 1000, p.z / 1000, -p.y / 1000);
      mesh.castShadow = p.slot !== 'glass';
      mesh.receiveShadow = true;
      if (p.slot === 'leaf' && style === 'realistic') mesh.scale.y = 0.85;
      mesh.userData = { ref: { kind: 'furniture', id: f.id } as ElementRef, levelId: f.levelId };
      item.add(mesh);
      pickables.push(mesh);
      if (edges && style !== 'architectural') item.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMaterial(style)).translateX(p.x / 1000).translateY(p.z / 1000).translateZ(-p.y / 1000));
    }
    const sx = f.size ? f.size.w / asset.size.w : 1, sz = f.size ? f.size.d / asset.size.d : 1, sy = f.size ? f.size.h / asset.size.h : 1;
    item.scale.set(sx, sy, sz);
    item.position.set(f.position.x / 1000, (asset.category === 'exterior' && level.elevation > 0 && asset.id !== 'lounger' ? 0 : level.elevation) / 1000 + 0.004, -f.position.y / 1000);
    // asset local y (depth) points to the back; plan rotation is CCW from +y.
    item.rotation.y = (f.rotation * Math.PI) / 180;
    item.userData = { levelId: f.levelId };
    const k = `furniture:${f.id}`;
    byRef.set(k, item.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh));
    group.add(item);
  }
  return { group, pickables, byRef };
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}
