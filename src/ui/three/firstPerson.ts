/**
 * Walking through the house. A first-person camera at eye height that moves
 * the way people expect in a browser: drag to look around, W A S D or the
 * arrow keys to walk, click a spot on the floor to stroll there. Walls stop
 * you; doorways let you through — the navigation map is derived from the same
 * walls and doors as everything else, so it can never disagree with the plan.
 */
import * as THREE from 'three';
import type { BuildingModel, ProjectDoc, RoomFunction } from '../../core/model/types';
import { deriveLevel } from '../../core/derive/level';
import { levelsSorted, openingsOf, isDoor } from '../../core/model/query';
import { type Vec2, add, dist, norm, projectToSegment, scale, sub } from '../../core/geometry/vec';
import { pointInPolygon } from '../../core/geometry/polygon';
import { linearSpec } from '../../core/derive/solids';
import { ASSET_BY_ID } from '../../core/catalog/assets';

export interface NavRoom {
  id: string; tagId: string | null; name: string; fn: RoomFunction; levelId: string;
  polygon: Vec2[]; area: number; center: Vec2;
  /** Where to stand, and which way to face, on walking in. */
  entry: { p: Vec2; yaw: number };
}
interface Blocker { a: Vec2; b: Vec2; half: number }
export interface NavLevel { id: string; name: string; elevation: number; height: number; rooms: NavRoom[]; blockers: Blocker[]; ground: boolean }

const BODY = 230; // shoulder radius, mm

/** Rooms, and the wall segments that block movement, for every level. */
export function buildNav(doc: ProjectDoc, b: BuildingModel): NavLevel[] {
  const levels = levelsSorted(b);
  const groundId = (levels.find((l) => l.elevation >= 0) ?? levels[0])?.id;
  return levels.map((level) => {
    const dl = deriveLevel(b, level.id);
    const blockers: Blocker[] = [];
    const doorAt = new Map<string, Vec2>();
    const leaves: Blocker[] = [];
    for (const w of dl.walls) {
      const d = norm(sub(w.b, w.a)), len = dist(w.a, w.b);
      const gaps: [number, number][] = [];
      for (const o of openingsOf(b, w.id)) {
        if (!isDoor(o)) continue;
        gaps.push([o.offset - o.width / 2 + 30, o.offset + o.width / 2 - 30]);
        doorAt.set(o.id, add(w.a, scale(d, o.offset)));
        // Hinged doors stand open while you walk; the leaf is something to walk around, not through.
        if (o.kind === 'single' || o.kind === 'double' || o.kind === 'french' || o.kind === 'pivot') {
          const n = { x: -d.y, y: d.x }, sg = o.side === 'left' ? 1 : -1, two = o.kind === 'double' || o.kind === 'french';
          const leaf = (s0: number, lenL: number) => { const h = add(w.a, scale(d, s0)); leaves.push({ a: add(h, scale(n, sg * (w.thickness / 2))), b: add(h, scale(n, sg * (w.thickness / 2 + lenL))), half: 25 }); };
          const s0 = o.offset - o.width / 2 + 60, s1 = o.offset + o.width / 2 - 60;
          if (two) { leaf(s0, (o.width - 120) / 2); leaf(s1, (o.width - 120) / 2); } else leaf(o.hinge === 'end' ? s1 : s0, o.width - 120);
        }
      }
      gaps.sort((x, y) => x[0] - y[0]);
      let s = 0;
      const seg = (s0: number, s1: number) => { if (s1 - s0 > 20) blockers.push({ a: add(w.a, scale(d, s0)), b: add(w.a, scale(d, s1)), half: w.thickness / 2 }); };
      for (const [g0, g1] of gaps) { seg(s, g0); s = Math.max(s, g1); }
      seg(s, len);
    }
    blockers.push(...leaves);
    // Furniture footprints (as rotated rectangles) so a vantage point is never inside a wardrobe or a bed.
    const furn = Object.values(b.furniture).filter((f) => f.levelId === level.id && ASSET_BY_ID[f.assetId] && (f.size?.h ?? ASSET_BY_ID[f.assetId].size.h) > 250).map((f) => {
      const a = ASSET_BY_ID[f.assetId], hw = (f.size?.w ?? a.size.w) / 2, hd = (f.size?.d ?? a.size.d) / 2, t = (-f.rotation * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
      return { hit: (q: Vec2, pad: number) => { const dx = q.x - f.position.x, dy = q.y - f.position.y, lx = dx * cs - dy * sn, ly = dx * sn + dy * cs; return Math.abs(lx) < hw + pad && Math.abs(ly) < hd + pad; } };
    });
    const ground = level.id === groundId;
    // In the garden, hedges, fences and compound walls are obstacles too (gates leave a gap).
    if (ground) for (const f of Object.values(doc.site.features)) if (f.path && f.path.length > 1) { const half = linearSpec(f).width / 2; for (let i = 0; i + 1 < f.path.length; i++) blockers.push({ a: f.path[i], b: f.path[i + 1], half }); }
    const rooms: NavRoom[] = dl.rooms.filter((r) => r.area > 1.2e6).map((r) => {
      const c = r.labelPoint;
      // Stand where a photographer would: just inside a doorway or tucked into a corner, clear of the
      // furniture, with the longest possible view across the room.
      const cands: { p: Vec2; door: boolean }[] = [];
      for (const id of r.doorIds) { const dp = doorAt.get(id); if (dp) { const into = norm(sub(c, dp)); for (const step of [650, 950, 1300]) cands.push({ p: add(dp, scale(into, step)), door: true }); } }
      for (const v of r.polygon) { const into = norm(sub(c, v)); for (const step of [750, 1100]) cands.push({ p: add(v, scale(into, step * Math.SQRT2)), door: false }); }
      // Fallback candidates on a grid, for rooms where doorways and corners are all taken up.
      const xs = r.polygon.map((q) => q.x), ys = r.polygon.map((q) => q.y);
      for (let x = Math.min(...xs) + 450; x < Math.max(...xs) - 400; x += 450) for (let y = Math.min(...ys) + 450; y < Math.max(...ys) - 400; y += 450) cands.push({ p: { x, y }, door: false });
      let best = -Infinity, entry = { p: c, yaw: r.width >= r.depth ? 0 : Math.PI / 2 };
      for (const cd of cands) {
        if (!pointInPolygon(cd.p, r.polygon)) continue;
        if (furn.some((f) => f.hit(cd.p, 380)) || leaves.some((l) => projectToSegment(cd.p, l.a, l.b).dist < 520)) continue;
        // Room for the body, and a long look across the room.
        const wall = Math.min(...r.polygon.map((q, i) => projectToSegment(cd.p, q, r.polygon[(i + 1) % r.polygon.length]).dist));
        if (wall < 330) continue;
        const score = dist(cd.p, c) + (cd.door ? 500 : 0) + Math.min(wall, 700) * 0.4;
        if (score > best) { best = score; entry = { p: cd.p, yaw: Math.atan2(c.y - cd.p.y, c.x - cd.p.x) }; }
      }
      return { id: r.id, tagId: r.tagId, name: r.name, fn: r.fn, levelId: level.id, polygon: r.polygon, area: r.area, center: c, entry };
    });
    return { id: level.id, name: level.name, elevation: level.elevation, height: level.height, rooms, blockers, ground };
  });
}

/** Would a person standing at `q` be touching a wall, a closed stretch of façade or an open door leaf? */
export function blocked(level: NavLevel, q: Vec2): boolean {
  for (const s of level.blockers) if (projectToSegment(q, s.a, s.b).dist < s.half + BODY) return true;
  return false;
}

export interface WalkState { levelId: string; room: NavRoom | null; pos: Vec2; yaw: number; outside: boolean }

export class FirstPerson {
  active = false;
  pos: Vec2 = { x: 0, y: 0 };
  yaw = 0;
  pitch = 0;
  levelId = '';
  /** Eye height above the floor, mm. */
  eye = 1600;
  private nav: NavLevel[] = [];
  private keys = new Set<string>();
  private target: Vec2 | null = null;
  private floorZ = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private lastEmit = 0;
  private lastKey = '';
  private readonly off: (() => void)[] = [];

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private cb: { onState: (s: WalkState) => void; onMove: () => void; onExit: () => void }) {
    const down = (e: PointerEvent) => { if (!this.active || e.button !== 0) return; this.drag = { x: e.clientX, y: e.clientY, moved: 0 }; dom.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!this.active || !this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy);
      // Grab-and-drag, like a panorama: the view follows the hand.
      const k = (this.camera.fov / 60) * 0.0042;
      this.yaw += dx * k;
      this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + dy * k));
      this.cb.onMove();
    };
    const up = (e: PointerEvent) => {
      if (!this.active || !this.drag) return;
      const click = this.drag.moved < 5;
      this.drag = null;
      if (click) this.walkTo(e);
    };
    const wheel = (e: WheelEvent) => {
      if (!this.active) return;
      e.preventDefault();
      this.target = null;
      this.tryMove(scale({ x: Math.cos(this.yaw), y: Math.sin(this.yaw) }, -Math.sign(e.deltaY) * Math.min(600, Math.abs(e.deltaY) * 2.2)));
    };
    const kd = (e: KeyboardEvent) => {
      if (!this.active) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Escape') { e.stopPropagation(); this.cb.onExit(); return; }
      if (/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|ShiftLeft|ShiftRight|PageUp|PageDown)$/.test(e.code)) { this.keys.add(e.code); this.target = null; e.stopPropagation(); e.preventDefault(); }
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    dom.addEventListener('pointerdown', down); dom.addEventListener('pointermove', move); dom.addEventListener('pointerup', up);
    dom.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
    this.off.push(() => { dom.removeEventListener('pointerdown', down); dom.removeEventListener('pointermove', move); dom.removeEventListener('pointerup', up); dom.removeEventListener('wheel', wheel); window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); });
  }

  setNav(nav: NavLevel[]) { this.nav = nav; if (this.active && !this.level()) this.cb.onExit(); }
  level(): NavLevel | undefined { return this.nav.find((l) => l.id === this.levelId); }
  rooms(): NavRoom[] { return this.nav.flatMap((l) => l.rooms); }

  enter(levelId: string, p: Vec2, yaw: number) {
    this.levelId = levelId; this.pos = { ...p }; this.yaw = yaw; this.pitch = -0.04; this.target = null; this.active = true;
    const lv = this.level();
    this.floorZ = lv ? this.floorAt(lv, p) : 0;
    this.apply(); this.emit(true);
  }
  enterRoom(room: NavRoom) { this.enter(room.levelId, room.entry.p, room.entry.yaw); }
  exit() { this.active = false; this.keys.clear(); this.target = null; this.drag = null; }

  roomAt(lv: NavLevel, p: Vec2): NavRoom | null { return lv.rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null; }
  private floorAt(lv: NavLevel, p: Vec2): number { return this.roomAt(lv, p) || !lv.ground ? lv.elevation : 0; }

  private tryMove(delta: Vec2): boolean {
    const lv = this.level();
    if (!lv) return false;
    // Take the step in slices so a fast stride can't tunnel through a thin partition.
    const n = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.y) / 120));
    let moved = false;
    for (let i = 0; i < n; i++) {
      const d = scale(delta, 1 / n);
      const full = add(this.pos, d);
      if (!blocked(lv, full)) { this.pos = full; moved = true; continue; }
      // Slide along the wall instead of stopping dead.
      const sx = { x: this.pos.x + d.x, y: this.pos.y }, sy = { x: this.pos.x, y: this.pos.y + d.y };
      if (Math.abs(d.x) > 0.5 && !blocked(lv, sx)) { this.pos = sx; moved = true; } else if (Math.abs(d.y) > 0.5 && !blocked(lv, sy)) { this.pos = sy; moved = true; } else break;
    }
    if (moved) this.cb.onMove();
    return moved;
  }

  /** Click on the floor: walk to that spot. */
  private walkTo(e: PointerEvent) {
    const r = this.dom.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const dir = ray.ray.direction, o = ray.ray.origin, y = this.floorZ / 1000;
    if (dir.y > -0.04) return;
    const t = (y - o.y) / dir.y;
    if (t < 0.3 || t > 16) return;
    this.target = { x: (o.x + dir.x * t) * 1000, y: -(o.z + dir.z * t) * 1000 };
  }

  update(dt: number) {
    if (!this.active) return;
    const lv = this.level();
    if (!lv) return;
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 3600 : 1900) * dt;
    if (turn) { this.yaw += turn * 1.7 * dt; this.cb.onMove(); }
    if (k.has('KeyQ')) { this.yaw += 1.7 * dt; this.cb.onMove(); }
    if (k.has('KeyE')) { this.yaw -= 1.7 * dt; this.cb.onMove(); }
    if (f || strafe) {
      const fw = { x: Math.cos(this.yaw), y: Math.sin(this.yaw) }, rt = { x: Math.sin(this.yaw), y: -Math.cos(this.yaw) };
      const v = norm({ x: fw.x * f + rt.x * strafe, y: fw.y * f + rt.y * strafe });
      this.tryMove(scale(v, speed));
    } else if (this.target) {
      const to = sub(this.target, this.pos), d = Math.hypot(to.x, to.y);
      if (d < 60 || !this.tryMove(scale(norm(to), Math.min(d, 2300 * dt)))) this.target = null;
    }
    // Settle onto whatever floor is underfoot (room slab, or the garden).
    const want = this.floorAt(lv, this.pos);
    if (Math.abs(want - this.floorZ) > 0.5) { this.floorZ += (want - this.floorZ) * Math.min(1, dt * 9); this.cb.onMove(); }
    this.apply();
    this.emit(false);
  }

  private apply() {
    const c = this.camera;
    c.position.set(this.pos.x / 1000, (this.floorZ + this.eye) / 1000, -this.pos.y / 1000);
    const cp = Math.cos(this.pitch);
    c.lookAt(c.position.x + Math.cos(this.yaw) * cp, c.position.y + Math.sin(this.pitch), c.position.z - Math.sin(this.yaw) * cp);
  }

  private emit(force: boolean) {
    const now = performance.now();
    const lv = this.level();
    if (!lv) return;
    const room = this.roomAt(lv, this.pos);
    const key = `${this.levelId}|${room?.id ?? ''}|${Math.round(this.pos.x / 150)}|${Math.round(this.pos.y / 150)}|${Math.round(this.yaw * 12)}`;
    if (!force && (key === this.lastKey || now - this.lastEmit < 90)) return;
    this.lastKey = key; this.lastEmit = now;
    this.cb.onState({ levelId: this.levelId, room, pos: { ...this.pos }, yaw: this.yaw, outside: !room });
  }

  dispose() { this.off.forEach((f) => f()); }
}
