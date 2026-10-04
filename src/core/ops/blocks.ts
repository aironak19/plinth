/**
 * `block.place` — drop a ready-made block into the model. Everything it creates
 * is ordinary model data (walls, room tags, doors, windows, stairs, furniture,
 * site features), produced with the same rules as hand drawing.
 */
import { current, type Draft } from 'immer';
import type { BuildingModel, Door, Id, ProjectDoc, RoomTag, StyleId, Wall } from '../model/types';
import { defineOp, OpError, type OpContext } from './registry';
import { addRoomRect } from './model';
import { layoutBlock, analyzeBlock, kitData, blockFootprint, blockTransform, snapBlock, siteSnapRings, type Placement, type Rect } from '../generate/blocks';
import { ensureCCW, intersection, rectPolygon, areaWithHoles, bbox } from '../geometry/polygon';
import { projectToSegment } from '../geometry/vec';
import { BLOCK_BY_ID, blockSize, type Side } from '../catalog/blocks';
import { deriveLevel } from '../derive/level';
import { makeDoor, makeFurniture, makeStair, makeWindow, nextTag, EXT_WALL, INT_WALL } from '../model/factory';
import { furnish, sharedEdge, type RoomSpec } from '../generate/fromRects';
import { STYLE_BY_ID } from '../catalog/styles';
import { HABITABLE } from '../derive/analysis';
import { ASSET_BY_ID } from '../catalog/assets';
import { formatLength } from '../units';
import { uid } from '../model/ids';
import { levelsSorted } from '../model/query';
import type { Vec2 } from '../geometry/vec';

type B = Draft<BuildingModel>;
const TOL = 8;

const styleOf = (ctx: OpContext): StyleId => (ctx.doc.options.find((o) => o.id === ctx.doc.activeOptionId)?.style ?? 'modern') as StyleId;

function onLine(w: Wall, axis: 'x' | 'y', c: number) {
  return axis === 'y' ? Math.abs(w.a.y - c) < TOL && Math.abs(w.b.y - c) < TOL : Math.abs(w.a.x - c) < TOL && Math.abs(w.b.x - c) < TOL;
}

function wallAt(b: B, levelId: Id, axis: 'x' | 'y', c: number, at: number): Draft<Wall> | undefined {
  return Object.values(b.walls).find((w) => {
    if (w.levelId !== levelId || !onLine(w, axis, c)) return false;
    const lo = axis === 'y' ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y);
    const hi = axis === 'y' ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y);
    return at > lo + 100 && at < hi - 100;
  });
}

function sideSeg(r: Rect, s: Side) {
  return s === 's' ? { axis: 'y' as const, c: r.y, lo: r.x, hi: r.x + r.w } : s === 'n' ? { axis: 'y' as const, c: r.y + r.h, lo: r.x, hi: r.x + r.w }
    : s === 'w' ? { axis: 'x' as const, c: r.x, lo: r.y, hi: r.y + r.h } : { axis: 'x' as const, c: r.x + r.w, lo: r.y, hi: r.y + r.h };
}

/** Create a door on a straight segment, swinging into `into`. Returns the door or null if it doesn't fit. */
function doorOn(ctx: OpContext, levelId: Id, seg: { axis: 'x' | 'y'; c: number; lo: number; hi: number }, into: Vec2, kind: Door['kind'], width?: number, at?: number): Door | null {
  const span = seg.hi - seg.lo;
  const wet = false;
  const wd = Math.min(width ?? (kind === 'sliding' ? Math.min(2400, span - 600) : kind === 'opening' ? Math.min(1500, span - 400) : wet ? 750 : 900), span - 300);
  if (wd < 600) return null;
  const centre = at ?? seg.lo + span / 2;
  const wall = wallAt(ctx.b, levelId, seg.axis, seg.c, centre);
  if (!wall) return null;
  const p = seg.axis === 'y' ? { x: centre, y: seg.c } : { x: seg.c, y: centre };
  const L = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  const offset = Math.max(wd / 2 + 60, Math.min(L - wd / 2 - 60, Math.hypot(p.x - wall.a.x, p.y - wall.a.y)));
  // Don't stack a door on top of an existing opening.
  const clash = [...Object.values(ctx.b.doors), ...Object.values(ctx.b.windows)].some((o) => o.wallId === wall.id && Math.abs(o.offset - offset) < (o.width + wd) / 2 + 50);
  if (clash) return null;
  const d = { x: wall.b.x - wall.a.x, y: wall.b.y - wall.a.y };
  const t = { x: into.x - p.x, y: into.y - p.y };
  const side: Door['side'] = -d.y * t.x + d.x * t.y >= 0 ? 'left' : 'right';
  const door = makeDoor({ wallId: wall.id, offset, width: wd, kind, side, height: kind === 'sliding' || kind === 'pivot' ? 2400 : kind === 'garage' ? 2400 : 2100, tag: nextTag(ctx.b as BuildingModel, 'D', levelId) }, styleOf(ctx));
  ctx.b.doors[door.id] = door;
  return door;
}

function uniqueName(b: B, levelId: Id, name: string): string {
  const names = new Set(Object.values(b.rooms).map((r) => r.name));
  if (!names.has(name)) return name;
  const base = name.replace(/\s+\d+$/, '');
  for (let i = 2; i < 30; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  void levelId;
  return `${base} ${uid('').slice(-3)}`;
}

function placeKit(ctx: OpContext, p: { levelId: Id }, pl: Placement): string[] {
  const kit = kitData(pl.def, pl.size)!;
  const T = blockTransform(kit.w, kit.d, pl.rot, pl.x, pl.y);
  const idMap = new Map<string, string>();
  const st = styleOf(ctx);
  const created: string[] = [];
  for (const w of Object.values(kit.b.walls)) {
    const nw = { ...JSON.parse(JSON.stringify(w)), id: uid('w'), levelId: p.levelId, a: T.point(w.a), b: T.point(w.b), finishExteriorId: STYLE_BY_ID[st].exterior, finishInteriorId: STYLE_BY_ID[st].interiorWall } as Wall;
    idMap.set(w.id, nw.id);
    ctx.b.walls[nw.id] = nw;
  }
  for (const d of Object.values(kit.b.doors)) { const nd = { ...JSON.parse(JSON.stringify(d)), id: uid('d'), wallId: idMap.get(d.wallId)!, tag: '' } as Door; nd.tag = nextTag(ctx.b as BuildingModel, 'D', p.levelId); ctx.b.doors[nd.id] = nd; }
  for (const wn of Object.values(kit.b.windows)) { const nw = { ...JSON.parse(JSON.stringify(wn)), id: uid('n'), wallId: idMap.get(wn.wallId)!, frameMaterialId: STYLE_BY_ID[st].windowFrame }; nw.tag = nextTag(ctx.b as BuildingModel, 'W', p.levelId); ctx.b.windows[nw.id] = nw; }
  for (const t of Object.values(kit.b.rooms)) { const nt = { ...JSON.parse(JSON.stringify(t)), id: uid('r'), levelId: p.levelId, point: T.point(t.point), name: uniqueName(ctx.b, p.levelId, t.name) } as RoomTag; ctx.b.rooms[nt.id] = nt; created.push(nt.id); }
  for (const f of Object.values(kit.b.furniture)) { const nf = { ...JSON.parse(JSON.stringify(f)), id: uid('f'), levelId: p.levelId, position: T.point(f.position), rotation: f.rotation + T.rot }; ctx.b.furniture[nf.id] = nf; }
  return created;
}

defineOp<{ blockId: string; size?: string; levelId: Id; x: number; y: number; rotation?: number }>({
  type: 'block.place', title: 'Add ready-made space', cap: 'model.edit', model: true,
  description: 'Drop a ready-made block (e.g. bedroom-bath, master-suite, kitchen-l, living-dining, foyer, stair-u, balcony, garage, pool, kit-2bhk) with its lower-left corner at (x, y) mm, rotated by 0/90/180/270°. Walls are shared with neighbours, a door connects it to the best adjacent room, and windows and furniture are added.',
  schema: { type: 'object', properties: { blockId: { type: 'string' }, size: { type: 'string', enum: ['S', 'M', 'L'] }, levelId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'number', enum: [0, 90, 180, 270] } }, required: ['blockId', 'levelId', 'x', 'y'] },
  run(ctx, p) {
    const def = BLOCK_BY_ID[p.blockId];
    if (!def) throw new OpError(`Unknown block ${p.blockId}`, 'That ready-made space isn’t in the library.');
    const level = ctx.b.levels[p.levelId];
    if (!level) throw new OpError('No level', 'Pick a level first.');
    if (level.locked) throw new OpError('Locked', `${level.name} is locked.`);
    const size = blockSize(def, p.size);
    const pl = layoutBlock(def.id, size.id, p.x, p.y, p.rotation ?? 0);
    const before = current(ctx.b) as BuildingModel;
    const an = analyzeBlock(before, p.levelId, pl);
    if (!an.ok) throw new OpError('Overlap', `${def.name} would overlap ${an.overlaps.slice(0, 2).join(' and ')}. Drop it next to existing rooms instead.`);
    const st = styleOf(ctx);
    const fmt = (mm: number) => formatLength(mm, ctx.doc.meta.units, { compact: true });
    const dims = `${fmt(pl.w)} × ${fmt(pl.d)}`;

    // ---- site-only blocks
    if (def.siteOnly) {
      const ground = levelsSorted(ctx.b as BuildingModel)[0];
      for (const s of pl.site) {
        const id = uid('sf');
        ctx.doc.site.features[id] = { id, kind: s.kind, name: s.name, polygon: [{ x: s.rect.x, y: s.rect.y }, { x: s.rect.x + s.rect.w, y: s.rect.y }, { x: s.rect.x + s.rect.w, y: s.rect.y + s.rect.h }, { x: s.rect.x, y: s.rect.y + s.rect.h }], materialId: s.material, props: s.kind === 'parking' ? { spaces: s.cars ?? 0 } : {} };
        ctx.created.push({ kind: 'siteFeature', id });
      }
      for (const pr of pl.props) { const f = makeFurniture({ levelId: ground.id, assetId: pr.asset, position: pr.p, rotation: pr.rot, variant: pr.variant }); ctx.b.furniture[f.id] = f; }
      ctx.notes.push(`${def.name} added (${dims})`);
      return;
    }

    // ---- whole-home kits
    if (def.kit) {
      const ids = placeKit(ctx, p, pl);
      ctx.created.push(...ids.slice(0, 1).map((id) => ({ kind: 'room' as const, id })));
      ctx.notes.push(`${def.name} added (${dims}, ${ids.length} rooms)`);
      return;
    }

    // ---- rooms
    const existingWalls = new Set(Object.keys(ctx.b.walls));
    const tagByPart = new Map<string, RoomTag>();
    for (const part of pl.parts) {
      const tag = addRoomRect(ctx, { levelId: p.levelId, x: part.rect.x, y: part.rect.y, w: part.rect.w, h: part.rect.h, name: uniqueName(ctx.b, p.levelId, part.name), fn: part.fn });
      tagByPart.set(part.key, tag as RoomTag);
    }
    ctx.created.length = 0;

    // Classify walls: what is now outside is exterior (9"), what is between rooms is interior.
    const dl = deriveLevel(current(ctx.b) as BuildingModel, p.levelId);
    for (const w of Object.values(ctx.b.walls)) {
      if (w.levelId !== p.levelId) continue;
      const ext = dl.exteriorWallIds.has(w.id);
      if (!existingWalls.has(w.id)) {
        w.kind = ext ? 'exterior' : 'interior';
        w.thickness = ext ? EXT_WALL : INT_WALL;
        w.structural = ext;
      } else if (!ext && w.kind === 'exterior') {
        // The wall is now between two rooms: it becomes interior and loses its windows.
        w.kind = 'interior';
        for (const win of Object.values(ctx.b.windows)) if (win.wallId === w.id) delete ctx.b.windows[win.id];
      }
    }
    // Open sides (balconies) become railing-height parapets.
    for (const part of pl.parts) for (const s of part.open) {
      const seg = sideSeg(part.rect, s);
      for (const w of Object.values(ctx.b.walls)) {
        if (w.levelId !== p.levelId || existingWalls.has(w.id) || !onLine(w, seg.axis, seg.c)) continue;
        const lo = seg.axis === 'y' ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y);
        if (lo >= seg.lo - TOL && lo <= seg.hi + TOL) { w.kind = 'parapet'; w.height = 1050; w.thickness = INT_WALL; w.structural = false; }
      }
    }

    // Doors inside the block and to the outside.
    const doorSides = new Map<string, { side: Side; at: number; width: number }[]>();
    const noteDoor = (key: string, side: Side, at: number, width: number) => { const l = doorSides.get(key) ?? []; l.push({ side, at, width }); doorSides.set(key, l); };
    const partBy = new Map(pl.parts.map((x) => [x.key, x]));
    const asSpec = (x: (typeof pl.parts)[number]): RoomSpec => ({ key: x.key, name: x.name, fn: x.fn, x: x.rect.x, y: x.rect.y, w: x.rect.w, h: x.rect.h });
    const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    for (const d of pl.doors) {
      const A = partBy.get(d.a);
      if (!A) continue;
      if (d.b === 'n' || d.b === 's' || d.b === 'e' || d.b === 'w') {
        const seg = sideSeg(A.rect, d.b);
        const door = doorOn(ctx, p.levelId, seg, centre(A.rect), d.kind ?? 'single', d.width);
        if (door) noteDoor(A.key, d.b, seg.lo + (seg.hi - seg.lo) / 2, door.width);
        continue;
      }
      const B2 = partBy.get(d.b);
      if (!B2) continue;
      const e = sharedEdge(asSpec(A), asSpec(B2));
      if (!e) continue;
      const wet = A.fn === 'bathroom' || A.fn === 'powder' || B2.fn === 'bathroom' || B2.fn === 'powder';
      const door = doorOn(ctx, p.levelId, e, centre(A.rect), d.kind ?? 'single', d.width ?? (wet && !d.kind ? 750 : undefined));
      if (door) {
        const opp: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
        noteDoor(A.key, e.sideA, (e.lo + e.hi) / 2, door.width);
        noteDoor(B2.key, opp[e.sideA], (e.lo + e.hi) / 2, door.width);
      }
    }
    let connected: string | null = null;
    if (an.neighbour) {
      const part = partBy.get(an.neighbour.partKey)!;
      const kind = def.entryDoor ?? (part.fn === 'stair' || part.fn === 'corridor' || (part.fn === 'dining' && (an.neighbour.fn === 'living' || an.neighbour.fn === 'kitchen')) ? 'opening' : 'single');
      const wet = part.fn === 'bathroom' || part.fn === 'powder';
      const sg = an.neighbour.seg;
      let door: Door | null = null;
      for (const f of [0.5, 0.25, 0.75, 0.12, 0.88]) {
        door = doorOn(ctx, p.levelId, sg, centre(part.rect), kind, wet ? 750 : kind === 'opening' ? 1200 : undefined, sg.lo + (sg.hi - sg.lo) * f);
        if (door) break;
      }
      if (door) {
        connected = an.neighbour.name;
        const r = part.rect;
        const side: Side = an.neighbour.seg.axis === 'y' ? (Math.abs(an.neighbour.seg.c - r.y) < 30 ? 's' : 'n') : (Math.abs(an.neighbour.seg.c - r.x) < 30 ? 'w' : 'e');
        noteDoor(part.key, side, (an.neighbour.seg.lo + an.neighbour.seg.hi) / 2, door.width);
      }
    }

    // Windows on exterior sides.
    const dl2 = deriveLevel(current(ctx.b) as BuildingModel, p.levelId);
    const sty = STYLE_BY_ID[st];
    for (const part of pl.parts) {
      const habitable = HABITABLE.includes(part.fn) || part.fn === 'family' || part.fn === 'foyer';
      const wetish = part.fn === 'bathroom' || part.fn === 'powder' || part.fn === 'utility' || part.fn === 'store' || part.fn === 'walkin' || part.fn === 'pooja' || part.fn === 'stair';
      if (!habitable && !wetish) continue;
      const sides = (['n', 's', 'e', 'w'] as Side[]).filter((s) => !part.open.includes(s)).map((s) => ({ s, seg: sideSeg(part.rect, s) }))
        .filter(({ seg }) => { const w = wallAt(ctx.b, p.levelId, seg.axis, seg.c, (seg.lo + seg.hi) / 2); return w && dl2.exteriorWallIds.has(w.id) && w.kind !== 'parapet'; })
        .sort((a, b2) => (b2.seg.hi - b2.seg.lo) - (a.seg.hi - a.seg.lo));
      let needed = habitable ? Math.max(1200, (part.rect.w * part.rect.h * 0.14 * sty.glazingFactor) / 1500) : 600;
      for (const { s, seg } of sides) {
        if (needed < 300) break;
        const doorsHere = (doorSides.get(part.key) ?? []).filter((d) => d.side === s);
        const blocked = doorsHere.map((d) => [d.at - d.width / 2 - 300, d.at + d.width / 2 + 300] as [number, number]);
        let free: [number, number][] = [[seg.lo + 450, seg.hi - 450]];
        for (const [b0, b1] of blocked) free = free.flatMap(([a0, a1]) => (b1 <= a0 || b0 >= a1 ? [[a0, a1]] : [...(b0 > a0 ? [[a0, b0] as [number, number]] : []), ...(b1 < a1 ? [[b1, a1] as [number, number]] : [])]));
        const best = free.sort((a, b2) => b2[1] - b2[0] - (a[1] - a[0]))[0];
        if (!best || best[1] - best[0] < 600) continue;
        const width = Math.round(Math.min(needed, best[1] - best[0], habitable ? 3000 : part.fn === 'stair' ? 1200 : 900) / 50) * 50;
        if (width < 600) continue;
        const c = (best[0] + best[1]) / 2;
        const wall = wallAt(ctx.b, p.levelId, seg.axis, seg.c, c)!;
        const pt = seg.axis === 'y' ? { x: c, y: seg.c } : { x: seg.c, y: c };
        const win = makeWindow({ wallId: wall.id, offset: Math.hypot(pt.x - wall.a.x, pt.y - wall.a.y), width, height: habitable ? 1500 : part.fn === 'stair' ? 1200 : 600, sill: habitable ? 750 : part.fn === 'stair' ? 1200 : 1500, kind: habitable ? sty.windowKind : 'louvre', tag: nextTag(ctx.b as BuildingModel, 'W', p.levelId) }, st);
        ctx.b.windows[win.id] = win;
        needed -= width;
        if (!habitable) break;
      }
    }

    // Stairs, furniture.
    for (const part of pl.parts) {
      if (part.stair) {
        const r = part.rect;
        const portrait = r.h >= r.w;
        const W = 1000, kind = part.stair;
        // Fit the stair's long dimension along the part's long side.
        const rotation = kind === 'L' ? 0 : portrait ? 0 : -90;
        const inset = INT_WALL / 2 + 30;
        const span = kind === 'U' ? 2 * W + 150 : W;
        const origin = rotation === 0
          ? { x: r.x + inset + Math.max(0, (r.w - 2 * inset - (kind === 'L' ? 0 : span)) / 2), y: r.y + inset }
          : { x: r.x + inset, y: r.y + r.h - inset - Math.max(0, (r.h - 2 * inset - span) / 2) };
        const stair = makeStair({ levelId: p.levelId, kind, width: W, tread: 260, origin, rotation });
        ctx.b.stairs[stair.id] = stair;
      }
      if (part.items) {
        for (const it of part.items) {
          const a = ASSET_BY_ID[it.asset];
          const f = makeFurniture({ levelId: p.levelId, assetId: it.asset, position: it.p, rotation: it.rot, variant: a?.variants.some((v) => v.id === sty.furnitureVariant) ? sty.furnitureVariant : it.variant });
          ctx.b.furniture[f.id] = f;
        }
      } else if (part.furnish && !part.stair) furnish(ctx.b as BuildingModel, p.levelId, asSpec(part), doorSides.get(part.key) ?? [], st);
    }

    const first = tagByPart.get(pl.def.entry ?? pl.parts[0].key) ?? [...tagByPart.values()][0];
    if (first) ctx.created.push({ kind: 'room', id: first.id });
    ctx.notes.push(`${def.name} added (${dims})${connected ? ` · connected to ${connected}` : ''}`);
  },
});

/**
 * Where should a block go to sit next to a given room? Tries every side, both
 * corners and the middle, all rotations — and returns the first placement that
 * doesn't overlap anything and actually connects to that room.
 */
export function findAttachPosition(b: BuildingModel, levelId: Id, tagId: Id, blockId: string, sizeId?: string, sitePoly?: Vec2[]): { x: number; y: number; rotation: number } | null {
  const def = BLOCK_BY_ID[blockId];
  const dl = deriveLevel(b, levelId);
  const room = dl.rooms.find((r) => r.tagId === tagId);
  if (!def || !room) return null;
  const xs = room.centerLoop.map((p) => p.x), ys = room.centerLoop.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const inside = (r: Rect) => !sitePoly || sitePoly.length < 3 || [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }].every((q) => pointIn(q, sitePoly));
  let best: { x: number; y: number; rotation: number; score: number } | null = null;
  for (const rotation of [0, 90, 180, 270]) {
    const fp = layoutBlock(def.id, sizeId, 0, 0, rotation);
    const { w, d } = fp;
    const cands: Vec2[] = [
      ...[minY, maxY - d, (minY + maxY - d) / 2].map((y) => ({ x: maxX, y })),
      ...[minY, maxY - d, (minY + maxY - d) / 2].map((y) => ({ x: minX - w, y })),
      ...[minX, maxX - w, (minX + maxX - w) / 2].map((x) => ({ x, y: maxY })),
      ...[minX, maxX - w, (minX + maxX - w) / 2].map((x) => ({ x, y: minY - d })),
    ];
    for (const c of cands) {
      const pl = layoutBlock(def.id, sizeId, c.x, c.y, rotation);
      const an = analyzeBlock(b, levelId, pl);
      if (!an.ok || an.neighbour?.tagId !== tagId) continue;
      const fits = inside({ x: pl.x, y: pl.y, w: pl.w, h: pl.d });
      const score = (fits ? 10 : 0) + (an.neighbour.seg.hi - an.neighbour.seg.lo) / 1000;
      if (!best || score > best.score) best = { x: c.x, y: c.y, rotation, score };
    }
  }
  return best ? { x: best.x, y: best.y, rotation: best.rotation } : null;
}

/**
 * A free spot on the plot for a site-only block (parking, lawn, pool): inside
 * the boundary, clear of the building and other site features, as close to
 * the road as possible, and flush against the house when it can be.
 */
export function findSitePosition(doc: ProjectDoc, b: BuildingModel, blockId: string, sizeId?: string, near?: Vec2): { x: number; y: number; rotation: number } | null {
  const def = BLOCK_BY_ID[blockId];
  const ground = levelsSorted(b)[0];
  if (!def?.siteOnly || !ground) return null;
  const plot = doc.site.boundary.length > 2 ? doc.site.boundary : ensureCCW(doc.site.boundary);
  const edges = plot.map((p, i) => ({ p, q: plot[(i + 1) % plot.length], e: doc.site.edges[i] }));
  const roads = edges.filter((x) => x.e?.road).length ? edges.filter((x) => x.e?.road) : edges.filter((x) => x.e?.kind === 'front');
  const others = Object.values(doc.site.features).filter((f) => f.polygon && f.polygon.length > 2).map((f) => f.polygon!);
  const rings = siteSnapRings(b, plot);
  const fp = deriveLevel(b, ground.id).footprint;
  const pb = bbox(plot);
  const step = 610;
  const valid = (x: number, y: number, rotation: number) => {
    const pl = layoutBlock(def.id, sizeId, x, y, rotation);
    const corners = [{ x: pl.x, y: pl.y }, { x: pl.x + pl.w, y: pl.y }, { x: pl.x + pl.w, y: pl.y + pl.d }, { x: pl.x, y: pl.y + pl.d }];
    if (!corners.every((q) => pointIn(q, plot))) return null;
    const r = rectPolygon(pl.x, pl.y, pl.w, pl.d);
    if (others.some((o) => areaWithHoles(intersection([r], [o])) > 0.3e6)) return null;
    if (!analyzeBlock(b, ground.id, pl).ok) return null;
    return pl;
  };
  let best: { x: number; y: number; rotation: number; score: number } | null = null;
  for (const rotation of [0, 90, 180, 270]) {
    const { w, d } = layoutBlock(def.id, sizeId, 0, 0, rotation);
    for (let y = pb.minY; y + d <= pb.maxY; y += step) {
      for (let x = pb.minX; x + w <= pb.maxX; x += step) {
        const c = { x: x + w / 2, y: y + d / 2 };
        if (!pointIn(c, plot)) continue;
        if (!valid(x, y, rotation)) continue;
        // Pull it flush against the house / plot edge when that keeps it valid.
        const sn = snapBlock(b, ground.id, w, d, c, 700, rings);
        const pos = valid(sn.x, sn.y, rotation) ? { x: sn.x, y: sn.y } : { x, y };
        const pc = { x: pos.x + w / 2, y: pos.y + d / 2 };
        const toRoad = roads.length ? Math.min(...roads.map((e) => projectToSegment(pc, e.p, e.q).dist)) : 0;
        const touches = fp.some((f) => { const fb = bbox(f); return pos.x <= fb.maxX + 50 && pos.x + w >= fb.minX - 50 && pos.y <= fb.maxY + 50 && pos.y + d >= fb.minY - 50; });
        const score = -toRoad / 1000 + (touches ? 2 : 0) - (near ? Math.hypot(pc.x - near.x, pc.y - near.y) / 4000 : 0);
        if (!best || score > best.score) best = { ...pos, rotation, score };
      }
    }
  }
  return best ? { x: best.x, y: best.y, rotation: best.rotation } : null;
}

function pointIn(p: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], c = poly[j];
    if ((a.y > p.y) !== (c.y > p.y) && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export { blockFootprint };
