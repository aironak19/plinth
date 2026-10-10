/**
 * Model → three.js. Converts the shared Solid faces into BufferGeometry (with
 * world-space UVs so textures keep real-world scale) and builds furniture and
 * trees from the same asset recipes the plan symbols come from.
 */
import * as THREE from 'three';
import type { BuildingModel, ElementRef, ProjectDoc, RenderStyle } from '../../core/model/types';
import { buildPlant, type PlantView } from './vegetation';
import { deriveLevel } from '../../core/derive/level';
import { levelsSorted } from '../../core/model/query';
import { pointInPolygon, distToPolygonEdge, bbox } from '../../core/geometry/polygon';
import { PLANT_BY_ID } from '../../core/catalog/plants';
import { rng, hash } from './textures';
import { buildSolids, SURFACE_Z, type Face3, type Solid } from '../../core/derive/solids';
import type { RuleSet } from '../../core/rules/rulesets';
import { ASSET_BY_ID, assetColors, isOutdoorAsset } from '../../core/catalog/assets';
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

export interface SceneLight { position: THREE.Vector3; color: string; power: number; range: number }
export interface SceneResult {
  group: THREE.Group; pickables: THREE.Object3D[]; byRef: Map<string, THREE.Mesh[]>;
  /** Alpha-tested leaf meshes, left out of the ambient-occlusion pre-pass. */
  foliage: THREE.Object3D[];
  /** Where lamps and lit rooms are, for night scenes. */
  lights: SceneLight[];
}
export interface SceneView extends PlantView { context: boolean }

const NEEDS_EDGES: RenderStyle[] = ['architectural', 'sketch', 'wireframe', 'xray'];

export function buildScene(doc: ProjectDoc, b: BuildingModel, rules: RuleSet, style: RenderStyle, hiddenLevels: Set<string>, selectedIds: Set<string>, view: SceneView = { season: 'summer', age: 1, context: true }): SceneResult {
  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const byRef = new Map<string, THREE.Mesh[]>();
  const foliage: THREE.Object3D[] = [];
  const lights: SceneLight[] = [];
  const realistic = style === 'realistic';
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

  // Outdoor items stand on whatever is under them: a room floor (terrace, verandah), a paved
  // surface, or the lawn — never floating at the plinth height of the level they were placed on.
  const surfaces = Object.values(doc.site.features).filter((f) => f.polygon && f.polygon.length > 2);
  const roomsByLevel = new Map<string, ReturnType<typeof deriveLevel>['rooms']>();
  const baseZ = (levelId: string, p: { x: number; y: number }, elevation: number): number => {
    let rooms = roomsByLevel.get(levelId);
    if (!rooms) { rooms = deriveLevel(b, levelId).rooms; roomsByLevel.set(levelId, rooms); }
    if (rooms.some((r) => pointInPolygon(p, r.polygon))) return elevation;
    let z = 0;
    for (const f of surfaces) if (f.kind !== 'pool' && f.kind !== 'pond' && pointInPolygon(p, f.polygon!)) z = Math.max(z, SURFACE_Z[f.kind] ?? 20);
    for (const f of surfaces) if (f.kind === 'pond' && pointInPolygon(p, f.polygon!)) z = -50;
    return z;
  };

  // Furniture, vehicles and plants from asset recipes.
  for (const f of Object.values(b.furniture)) {
    if (hiddenLevels.has(f.levelId)) continue;
    const asset = ASSET_BY_ID[f.assetId];
    const level = b.levels[f.levelId];
    if (!asset || !level) continue;
    const outdoor = isOutdoorAsset(asset);
    const z = (outdoor ? baseZ(f.levelId, f.position, level.elevation) : level.elevation) / 1000 + 0.004;
    const ref = { kind: 'furniture', id: f.id } as ElementRef;
    if (asset.plant) {
      const flat = realistic ? undefined : { leaf: material3d('slot-leaf', style), bark: material3d('slot-trunk', style) };
      const plant = buildPlant(asset.plant, { w: f.size?.w ?? asset.size.w, h: f.size?.h ?? asset.size.h }, f.id, view, flat);
      plant.position.set(f.position.x / 1000, z, -f.position.y / 1000);
      const meshes: THREE.Mesh[] = [];
      plant.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.userData.ref = ref; m.userData.levelId = f.levelId; meshes.push(m); pickables.push(m); if ((m.material as THREE.Material).alphaTest > 0) foliage.push(m); });
      byRef.set(`furniture:${f.id}`, meshes);
      plant.userData = { levelId: f.levelId };
      group.add(plant);
      continue;
    }
    const colors = assetColors(asset, f.variant);
    const item = new THREE.Group();
    const sel = selectedIds.has(f.id);
    for (const p of asset.parts) {
      let geo: THREE.BufferGeometry;
      if (p.shape === 'box') { geo = new THREE.BoxGeometry(p.w / 1000, p.h / 1000, p.d / 1000); geo.translate(0, p.h / 2000, 0); }
      else if (p.shape === 'cyl') { geo = new THREE.CylinderGeometry(p.w / 2000, p.w / 2000, p.h / 1000, 24); geo.translate(0, p.h / 2000, 0); }
      else if (p.shape === 'cone') { geo = new THREE.ConeGeometry(p.w / 2000, p.h / 1000, 24); geo.translate(0, p.h / 2000, 0); }
      else if (p.shape === 'pyramid') { geo = new THREE.ConeGeometry(1, p.h / 1000, 4); geo.rotateY(Math.PI / 4); geo.scale(p.w / 1000 / Math.SQRT2, 1, p.d / 1000 / Math.SQRT2); geo.translate(0, p.h / 2000, 0); }
      else { geo = new THREE.IcosahedronGeometry(1, p.slot === 'leaf' ? 1 : 3); geo.scale(p.w / 2000, p.h / 2000, p.d / 2000); geo.translate(0, p.h / 2000, 0); }
      const color = f.materialId && (p.slot === 'body' || p.slot === 'fabric') ? undefined : colors[p.slot];
      const mat = f.materialId && (p.slot === 'fabric' || p.slot === 'body') ? material3d(f.materialId, style, { highlight: sel }) : material3d(`slot-${p.slot}`, style, { color, highlight: sel });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x / 1000, p.z / 1000, -p.y / 1000);
      mesh.castShadow = p.slot !== 'glass' && p.slot !== 'water' && p.slot !== 'light';
      mesh.receiveShadow = p.slot !== 'light';
      mesh.userData = { ref, levelId: f.levelId };
      item.add(mesh);
      pickables.push(mesh);
      if (edges && style !== 'architectural') item.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMaterial(style)).translateX(p.x / 1000).translateY(p.z / 1000).translateZ(-p.y / 1000));
    }
    const sx = f.size ? f.size.w / asset.size.w : 1, sz = f.size ? f.size.d / asset.size.d : 1, sy = f.size ? f.size.h / asset.size.h : 1;
    item.scale.set(sx, sy, sz);
    item.position.set(f.position.x / 1000, z, -f.position.y / 1000);
    // asset local y (depth) points to the back; plan rotation is CCW from +y.
    item.rotation.y = (f.rotation * Math.PI) / 180;
    item.userData = { levelId: f.levelId };
    byRef.set(`furniture:${f.id}`, item.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh));
    group.add(item);
    if (realistic) {
      item.updateMatrixWorld(true);
      for (const p of asset.parts) if (p.slot === 'light') {
        const garden = outdoor;
        lights.push({ position: new THREE.Vector3(p.x / 1000, (p.z + p.h * 0.5) / 1000, -p.y / 1000).applyMatrix4(item.matrixWorld), color: asset.tags.includes('fire') ? '#ff9a4a' : '#ffd9a0', power: garden ? Math.max(4, Math.min(22, asset.size.h / 160)) : 9, range: garden ? 9 : 7 });
      }
    }
  }

  if (realistic) {
    // One warm ceiling light per room, largest rooms first — the glow seen through the glass at dusk.
    const rooms: { p: THREE.Vector3; area: number }[] = [];
    for (const lv of levelsSorted(b)) {
      if (hiddenLevels.has(lv.id)) continue;
      for (const r of deriveLevel(b, lv.id).rooms) if (r.tagId && r.fn !== 'balcony' && r.fn !== 'deck' && r.fn !== 'parking') rooms.push({ p: toThree({ x: r.labelPoint.x, y: r.labelPoint.y, z: lv.elevation + lv.height - 550 }), area: r.area });
    }
    rooms.sort((a, c) => c.area - a.area);
    for (const r of rooms.slice(0, 10)) lights.push({ position: r.p, color: '#ffd7a3', power: 9, range: 7.5 });
    if (view.context) addContext(group, foliage, doc, view);
  }
  return { group, pickables, byRef, foliage, lights };
}

/**
 * Neighbourhood trees beyond the plot so the house sits in a place rather than
 * on an empty plane. Context only — not selectable and not part of the model.
 */
function addContext(group: THREE.Group, foliage: THREE.Object3D[], doc: ProjectDoc, view: SceneView) {
  const plot = doc.site.boundary;
  const bb = bbox(plot);
  const r = rng(hash(doc.id));
  const tropical = Math.abs(doc.meta.location.lat) < 26;
  const species = (tropical ? ['neem', 'mango', 'coconut', 'gulmohar', 'ashoka', 'rain-tree'] : ['ficus', 'jacaranda', 'olive', 'cypress', 'crepe-myrtle', 'tabebuia']).map((id) => PLANT_BY_ID[id]);
  const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
  const roadEdges = plot.map((p, i) => ({ p, q: plot[(i + 1) % plot.length], road: doc.site.edges[i]?.road })).filter((e) => e.road);
  let placed = 0;
  for (let i = 0; i < 400 && placed < 26; i++) {
    const p = { x: bb.minX - span * 1.6 + r() * (bb.maxX - bb.minX + span * 3.2), y: bb.minY - span * 1.6 + r() * (bb.maxY - bb.minY + span * 3.2) };
    if (pointInPolygon(p, plot)) continue;
    const d = distToPolygonEdge(p, plot);
    if (d < 6000) continue;
    // Keep the street clear.
    if (roadEdges.some((e) => { const ux = e.q.x - e.p.x, uy = e.q.y - e.p.y, len = Math.hypot(ux, uy) || 1, t = ((p.x - e.p.x) * ux + (p.y - e.p.y) * uy) / len, off = Math.abs(((p.x - e.p.x) * uy - (p.y - e.p.y) * ux) / len); return off < e.road!.width + 3000 && t > -span * 3 && t < len + span * 3; })) continue;
    const sp = species[Math.floor(r() * species.length)];
    const tree = buildPlant(sp, { w: sp.spread * (0.75 + r() * 0.4), h: sp.height * (0.75 + r() * 0.4) }, `ctx-${i}`, { season: view.season, age: 1 });
    tree.position.set(p.x / 1000, -0.03, -p.y / 1000);
    tree.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).alphaTest > 0) foliage.push(m); });
    group.add(tree);
    placed++;
  }
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    // Plant geometry is cached and shared between instances.
    if (m.geometry && !m.userData.shared) m.geometry.dispose();
  });
}
