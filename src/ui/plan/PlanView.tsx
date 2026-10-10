/**
 * Interactive floor-plan editor. Renders *one* level of the canonical model and
 * turns gestures into operations. During a drag it previews the operation on a
 * scratch copy, so neighbouring rooms, openings, dimensions and areas update
 * live — then commits a single undoable change on release.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useStore } from '../../state/store';
import { useDoc, useRules } from '../../state/derived';
import { applyOps, type OpCall } from '../../core/ops';
import { activeBuilding, levelBelow, wallLength, openingsOf } from '../../core/model/query';
import { deriveLevel, type DerivedRoom } from '../../core/derive/level';
import { computeStair } from '../../core/derive/stairs';
import { buildableZone, analyzeSite } from '../../core/derive/site';
import { validate } from '../../core/derive/validation';
import { doorSymbol, windowSymbol, stairSymbol, furnitureSymbol, columnSymbol, primPath, type Prim } from '../../core/docs/symbols';
import { ASSET_BY_ID, isGroundAsset } from '../../core/catalog/assets';
import type { SiteFeature } from '../../core/model/types';
import { linearSpec } from '../../core/derive/solids';
import { formatArea, formatLength, parseLength } from '../../core/units';
import { type Vec2, add, dist, mid, norm, perp, scale, sub, lineParam, dot, projectToSegment } from '../../core/geometry/vec';
import { bbox, pointInPolygon, rectPolygon, difference, areaWithHoles, ensureCCW } from '../../core/geometry/polygon';
import { ROOM_TINT } from './colors';
import { hitTest, snapPoint, ringD, lineD, dimensionChains, type Snap } from './planUtils';
import type { BuildingModel, ElementRef, ProjectDoc } from '../../core/model/types';
import { USER_BY_ID } from '../../core/model/org';
import { layoutBlock, analyzeBlock, snapBlock, siteSnapRings } from '../../core/generate/blocks';
import { getMaterial } from '../../core/catalog/materials';

interface ViewState { cx: number; cy: number; z: number }
type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'move'; refs: ElementRef[]; start: Vec2; cur: Vec2; moved: boolean }
  | { kind: 'endpoint'; wallId: string; end: 'a' | 'b'; cur: Vec2 }
  | { kind: 'edge'; tagId: string; axis: 'x' | 'y'; side: 'min' | 'max'; start: Vec2; cur: Vec2; size: number }
  | { kind: 'marquee'; start: Vec2; cur: Vec2 }
  | { kind: 'room'; start: Vec2; cur: Vec2 }
  | { kind: 'surface'; start: Vec2; cur: Vec2 };

const STROKE: Record<string, number> = { cut: 1.6, heavy: 1.3, medium: 1, light: 0.7, hairline: 0.55 };

const FEATURE_FILL: Record<string, string> = {
  pool: 'rgba(95,180,201,0.38)', pond: 'rgba(79,140,125,0.4)', deck: 'rgba(155,107,68,0.2)', lawn: 'rgba(120,165,90,0.24)', bed: 'rgba(120,95,65,0.2)',
  gravel: 'rgba(190,184,170,0.35)', patio: 'rgba(205,184,146,0.34)', driveway: 'rgba(150,145,135,0.2)', parking: 'rgba(150,145,135,0.16)', pathway: 'rgba(170,160,140,0.3)',
};
const FEATURE_PATTERN: Record<string, string> = { patio: 'pat-paving', pathway: 'pat-paving', deck: 'pat-deck', gravel: 'pat-gravel', bed: 'pat-bed', pool: 'pat-water', pond: 'pat-water' };

/** Hedges, fences and garden walls drawn at their true thickness. */
function LinearFeature({ f, on, hov }: { f: SiteFeature; on: boolean; hov: boolean }) {
  const { width } = linearSpec(f);
  const d = lineD(f.path!);
  const accent = on || hov;
  if (f.kind === 'hedge') return (
    <g>
      <path d={d} fill="none" stroke={accent ? 'var(--accent)' : '#5f8f4b'} strokeOpacity={on ? 0.75 : 0.6} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#33592c" strokeWidth={1} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
    </g>
  );
  if (f.kind === 'fence') return (
    <g>
      <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(width, 300)} />
      <path d={d} fill="none" stroke={accent ? 'var(--accent)' : 'var(--plan-line)'} strokeWidth={on ? 2.2 : 1.4} strokeDasharray="12 3 2 3" vectorEffect="non-scaling-stroke" />
    </g>
  );
  return <path d={d} fill="none" stroke={accent ? 'var(--accent)' : 'var(--poche)'} strokeOpacity={on ? 0.9 : 0.78} strokeWidth={width} strokeLinejoin="miter" />;
}

export function PlanView({ levelId }: { levelId: string }) {
  const doc = useDoc();
  const rules = useRules();
  const s = useStore();
  const { selection, tool, layers, snap, proposal, placeAsset, placeRotation, focus, placeBlock, placeSite } = s;
  const units = doc.meta.units;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<ViewState | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [snapRes, setSnapRes] = useState<Snap | null>(null);
  const [chain, setChain] = useState<Vec2[]>([]);
  const [typed, setTyped] = useState('');
  const [space, setSpace] = useState(false);
  const [dimEdit, setDimEdit] = useState<{ x: number; y: number; value: number; commit: (mm: number) => void } | null>(null);
  const [commentAt, setCommentAt] = useState<{ p: Vec2; sx: number; sy: number } | null>(null);
  const [hoverIssue, setHoverIssue] = useState<string | null>(null);

  // ---- live preview of the in-progress drag
  const dragOps = useMemo<OpCall[] | null>(() => {
    if (!drag) return null;
    if (drag.kind === 'move' && drag.moved) {
      const d = sub(drag.cur, drag.start);
      if (Math.hypot(d.x, d.y) < 1) return null;
      return [{ type: 'element.move', params: { refs: drag.refs, delta: d } }];
    }
    if (drag.kind === 'endpoint') return [{ type: 'wall.moveEnd', params: { id: drag.wallId, end: drag.end, to: drag.cur } }];
    if (drag.kind === 'edge') {
      const d = drag.axis === 'x' ? drag.cur.x - drag.start.x : drag.cur.y - drag.start.y;
      const size = drag.size + (drag.side === 'max' ? d : -d);
      if (Math.abs(size - drag.size) < 1) return null;
      return [{ type: 'room.resize', params: { id: drag.tagId, axis: drag.axis, size: Math.max(700, size), anchor: drag.side === 'max' ? 'min' : 'max' } }];
    }
    return null;
  }, [drag]);
  const liveDoc = useMemo<ProjectDoc>(() => {
    if (!dragOps) return doc;
    try { return applyOps(doc, dragOps, { actor: s.me, role: s.role, record: false }).doc; } catch { return doc; }
  }, [doc, dragOps, s.me, s.role]);

  const previewDoc = proposal?.previewing && proposal.impact?.preview ? proposal.impact.preview : null;
  const b = activeBuilding(liveDoc);
  const level = b.levels[levelId];
  const dl = useMemo(() => (level ? deriveLevel(b, levelId) : null), [b, levelId, level]);
  const pdl = useMemo(() => (previewDoc && activeBuilding(previewDoc).levels[levelId] ? deriveLevel(activeBuilding(previewDoc), levelId) : null), [previewDoc, levelId]);
  const below = level ? levelBelow(b, levelId) : undefined;
  const dlBelow = useMemo(() => (below && layers.levelBelow ? deriveLevel(b, below.id) : null), [b, below, layers.levelBelow]);
  const health = useMemo(() => (layers.issues ? validate(doc, activeBuilding(doc), rules) : null), [doc, rules, layers.issues]);
  const groundId = useMemo(() => { const ls = Object.values(b.levels).sort((x, y) => x.order - y.order); return (ls.find((l) => l.elevation >= 0) ?? ls[0])?.id; }, [b.levels]);
  const isGround = useMemo(() => { const ls = Object.values(b.levels).sort((x, y) => x.order - y.order); return ls.find((l) => l.elevation >= 0)?.id === levelId || ls[0]?.id === levelId; }, [b.levels, levelId]);
  const siteA = useMemo(() => (layers.site && isGround ? { zone: buildableZone(doc.site), analysis: analyzeSite(doc, activeBuilding(doc), rules) } : null), [doc, rules, layers.site, isGround]);

  // ---- ready-made block ghost (shared by click-to-place and drag-and-drop)
  const blockGhost = useMemo(() => {
    if (tool !== 'block' || !placeBlock || !cursor || !level) return null;
    try {
      const fp = layoutBlock(placeBlock.blockId, placeBlock.size, 0, 0, placeBlock.rotation);
      const tolB = Math.max(450, 18 / (view?.z ?? 0.05));
      const sn = snapBlock(b, levelId, fp.w, fp.d, cursor, tolB, fp.def.siteOnly ? siteSnapRings(b, doc.site.boundary) : undefined);
      const pl = layoutBlock(placeBlock.blockId, placeBlock.size, sn.x, sn.y, placeBlock.rotation);
      const an = analyzeBlock(b, levelId, pl);
      // Soft guidance (never blocks the drop): outside the plot, or past the setback line.
      const rect = rectPolygon(pl.x, pl.y, pl.w, pl.d);
      const outside = (zone: Parameters<typeof difference>[1]) => areaWithHoles(difference([rect], zone)) > 0.3e6;
      const warn = outside([ensureCCW(doc.site.boundary)]) ? 'Partly outside the plot'
        : !pl.def.siteOnly && isGround && outside(buildableZone(doc.site)) ? 'Crosses the setback line' : null;
      return { pl, an, sn, warn, wrongLevel: !!pl.def.siteOnly && !isGround };
    } catch { return null; }
  }, [tool, placeBlock, cursor, b, levelId, view?.z, isGround, level, doc.site]);

  // ---- sizing & initial fit
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = useCallback(() => {
    const pts = doc.site.boundary.length ? doc.site.boundary : dl?.walls.flatMap((w) => [w.a, w.b]) ?? [];
    if (!pts.length) { setView({ cx: 6000, cy: 6000, z: 0.04 }); return; }
    const bb = bbox(pts);
    const z = Math.min((size.w - 120) / (bb.maxX - bb.minX || 1), (size.h - 160) / (bb.maxY - bb.minY || 1));
    setView({ cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2, z: Math.max(0.005, Math.min(z, 0.5)) });
  }, [doc.site.boundary, dl, size.w, size.h]);
  useEffect(() => { if (!view && size.w > 100) fit(); }, [size, view, fit]);
  useEffect(() => {
    if (!focus) return;
    setView((v) => ({ cx: focus.point.x, cy: focus.point.y, z: Math.max(v?.z ?? 0.05, 0.07) }));
  }, [focus]);
  useEffect(() => { setChain([]); setTyped(''); }, [tool, levelId]);
  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('plinth:fit', onFit);
    return () => window.removeEventListener('plinth:fit', onFit);
  }, [fit]);

  const v = view ?? { cx: 0, cy: 0, z: 0.05 };
  const tx = size.w / 2 - v.cx * v.z, ty = size.h / 2 + v.cy * v.z;
  const toWorld = (sx: number, sy: number): Vec2 => ({ x: (sx - tx) / v.z, y: -(sy - ty) / v.z });
  const toScreen = (p: Vec2) => ({ x: p.x * v.z + tx, y: -p.y * v.z + ty });
  const tolMm = 9 / v.z;
  const gridStep = units === 'metric' ? (v.z > 0.12 ? 50 : v.z > 0.04 ? 100 : 500) : v.z > 0.12 ? 25.4 * 3 : v.z > 0.04 ? 152.4 : 304.8;

  // ---- keyboard: typed lengths, enter/escape for chains, space to pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { setSpace(true); e.preventDefault(); }
      if (tool === 'wall' && chain.length) {
        const startKey = /^[0-9.]$/.test(e.key);
        const contKey = typed.length > 0 && /^[0-9.'" a-z]$/i.test(e.key);
        if ((startKey || contKey) && !(e.metaKey || e.ctrlKey)) { setTyped((x) => x + e.key); e.stopPropagation(); e.preventDefault(); }
        else if (e.key === 'Backspace' && typed) { setTyped((x) => x.slice(0, -1)); e.preventDefault(); e.stopPropagation(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (typed && cursor) {
            const L = parseLength(typed, units);
            const from = chain[chain.length - 1];
            if (L && L > 50) {
              const dir = norm(sub(snapRes?.p ?? cursor, from));
              const to = add(from, scale(dir.x || dir.y ? dir : { x: 1, y: 0 }, L));
              s.dispatch([{ type: 'wall.create', params: { levelId, a: from, b: to, kind: 'interior' } }], { silent: true });
              setChain([...chain, to]);
            }
            setTyped('');
          } else { setChain([]); setTyped(''); }
        } else if (e.key === 'Escape') { setChain([]); setTyped(''); }
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    const linearKeys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (tool !== 'linear' || !chain.length || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finishLinear(chain); }
      else if (e.key === 'Escape') { e.stopPropagation(); setChain([]); }
    };
    window.addEventListener('keydown', linearKeys, true);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keydown', linearKeys, true); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, chain, typed, cursor, snapRes, units, levelId, s]);

  // ---- wheel: pan / zoom at cursor (native listener so we can preventDefault)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((cur) => {
        const vv = cur ?? v;
        if (e.ctrlKey || e.metaKey) {
          const rect = el.getBoundingClientRect();
          const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
          const txx = rect.width / 2 - vv.cx * vv.z, tyy = rect.height / 2 + vv.cy * vv.z;
          const wx = (sx - txx) / vv.z, wy = -(sy - tyy) / vv.z;
          const z = Math.max(0.004, Math.min(1.2, vv.z * Math.exp(-e.deltaY * 0.0022)));
          return { z, cx: wx - (sx - rect.width / 2) / z, cy: wy + (sy - rect.height / 2) / z };
        }
        return { ...vv, cx: vv.cx + e.deltaX / vv.z, cy: vv.cy - e.deltaY / vv.z };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (!level || !dl) return <div className="empty">This level no longer exists.</div>;

  const selected = (ref: { kind: string; id: string }) => selection.some((x) => x.kind === ref.kind && x.id === ref.id);
  const rel = (e: React.PointerEvent) => { const r = svgRef.current!.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };

  const dropBlock = () => {
    const g = blockGhost;
    if (!g || !placeBlock) return;
    if (g.wrongLevel) { s.toast('Outdoor spaces go on the ground floor — switch to it first'); return; }
    if (!g.an.ok) { s.toast(`${g.pl.def.name} ${g.an.reason?.toLowerCase() ?? 'doesn\u2019t fit here'} — drop it next to a room instead`, { kind: 'err' }); return; }
    if (s.dispatch([{ type: 'block.place', params: { blockId: placeBlock.blockId, size: placeBlock.size, levelId, x: g.pl.x, y: g.pl.y, rotation: g.pl.rot } }])) s.setTool('select');
  };

  const computeSnap = (raw: Vec2, from?: Vec2 | null, exclude?: Set<string>) => snapPoint(raw, dl.walls, tolMm, gridStep, { endpoints: snap.endpoints, grid: snap.grid, from, ortho: snap.ortho, exclude });

  const nearestWall = (p: Vec2) => {
    let best: { w: typeof dl.walls[number]; d: number } | null = null;
    for (const w of dl.walls) { const d = projectToSegment(p, w.a, w.b).dist; if (d < w.thickness / 2 + tolMm * 2 && (!best || d < best.d)) best = { w, d }; }
    return best?.w ?? null;
  };

  // ---------------------------------------------------------------- events
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { sx, sy } = rel(e);
    const p = toWorld(sx, sy);
    setDimEdit(null);
    if (e.button === 1 || space || tool === 'pan') { setDrag({ kind: 'pan', sx, sy, cx: v.cx, cy: v.cy }); return; }
    if (e.button !== 0) return;
    if (tool === 'select') {
      const handle = (e.target as Element).getAttribute?.('data-handle');
      if (handle) {
        const [kind, id, extra] = handle.split(':');
        if (kind === 'end') { setDrag({ kind: 'endpoint', wallId: id, end: extra as 'a' | 'b', cur: b.walls[id][extra as 'a' | 'b'] }); return; }
        if (kind === 'edge') {
          const room = dl.rooms.find((r) => r.tagId === id)!;
          const [axis, side] = extra.split('-') as ['x' | 'y', 'min' | 'max'];
          setDrag({ kind: 'edge', tagId: id, axis, side, start: p, cur: p, size: axis === 'x' ? room.width : room.depth });
          return;
        }
      }
      const hit = hitTest(liveDoc, b, dl, p, tolMm, rules, { site: !!siteA, furniture: layers.furniture });
      if (hit) {
        if (e.shiftKey) { s.select([hit], true); return; }
        const refs = selected(hit) ? selection : [hit];
        if (!selected(hit)) s.select([hit]);
        if (hit.kind !== 'room') setDrag({ kind: 'move', refs, start: p, cur: p, moved: false });
      } else {
        if (!e.shiftKey) s.select([]);
        setDrag({ kind: 'marquee', start: p, cur: p });
      }
      return;
    }
    if (tool === 'block') { dropBlock(); return; }
    const sn = computeSnap(p, tool === 'wall' || tool === 'linear' ? chain[chain.length - 1] : null);
    if (tool === 'wall') {
      if (!chain.length) { setChain([sn.p]); return; }
      const from = chain[chain.length - 1];
      if (dist(from, sn.p) < 100) return;
      s.dispatch([{ type: 'wall.create', params: { levelId, a: from, b: sn.p, kind: 'interior' } }], { silent: true });
      const closed = dist(sn.p, chain[0]) < 20 && chain.length > 1;
      setChain(closed ? [] : [...chain, sn.p]);
      setTyped('');
      return;
    }
    if (tool === 'room') { setDrag({ kind: 'room', start: sn.p, cur: sn.p }); return; }
    if (tool === 'surface' && placeSite) { setDrag({ kind: 'surface', start: sn.p, cur: sn.p }); return; }
    if (tool === 'linear' && placeSite) {
      if (chain.length > 1 && dist(sn.p, chain[0]) < Math.max(200, 12 / v.z)) { finishLinear([...chain, chain[0]]); return; }
      if (!chain.length || dist(chain[chain.length - 1], sn.p) > 100) setChain([...chain, sn.p]);
      return;
    }
    if (tool === 'door' || tool === 'window') {
      const w = nearestWall(p);
      if (!w) { s.toast('Click on a wall to place an opening'); return; }
      const off = lineParam(p, w.a, w.b) * wallLength(w);
      const side = dot(sub(p, w.a), perp(norm(sub(w.b, w.a)))) >= 0 ? 'left' : 'right';
      s.dispatch([{ type: tool === 'door' ? 'door.create' : 'window.create', params: tool === 'door' ? { wallId: w.id, offset: off, side } : { wallId: w.id, offset: off } }]);
      return;
    }
    if (tool === 'stair') { s.dispatch([{ type: 'stair.create', params: { levelId, origin: { x: sn.p.x - 1075, y: sn.p.y }, kind: 'U', width: 1000 } }]); s.setTool('select'); return; }
    if (tool === 'column') { s.dispatch([{ type: 'column.create', params: { levelId, position: sn.p } }], { silent: true }); return; }
    if (tool === 'place' && placeAsset) {
      // Trees, garden structures and vehicles always belong to the ground, whichever floor is being viewed.
      const onGround = isGroundAsset(ASSET_BY_ID[placeAsset]);
      s.dispatch([{ type: 'furniture.create', params: { levelId: onGround ? groundId ?? levelId : levelId, assetId: placeAsset, position: onGround || ASSET_BY_ID[placeAsset]?.plant ? (cursor ?? sn.p) : sn.p, rotation: placeRotation } }], { silent: !!ASSET_BY_ID[placeAsset]?.plant });
      return;
    }
    if (tool === 'comment') { setCommentAt({ p, sx, sy }); return; }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { sx, sy } = rel(e);
    const p = toWorld(sx, sy);
    setCursor(p);
    if (drag?.kind === 'pan') { setView({ ...v, cx: drag.cx - (sx - drag.sx) / v.z, cy: drag.cy + (sy - drag.sy) / v.z }); return; }
    if (drag?.kind === 'move') {
      const raw = sub(p, drag.start);
      const step = e.altKey ? 1 : units === 'metric' ? 10 : 25.4;
      const d = { x: Math.round(raw.x / step) * step, y: Math.round(raw.y / step) * step };
      if (!drag.moved && Math.hypot(raw.x, raw.y) * v.z < 4) return;
      setDrag({ ...drag, cur: add(drag.start, d), moved: true });
      return;
    }
    if (drag?.kind === 'endpoint') { const sn = computeSnap(p, null, new Set([drag.wallId])); setSnapRes(sn); setDrag({ ...drag, cur: sn.p }); return; }
    if (drag?.kind === 'edge') {
      const step = units === 'metric' ? 50 : 76.2;
      const d = { x: Math.round((p.x - drag.start.x) / step) * step, y: Math.round((p.y - drag.start.y) / step) * step };
      setDrag({ ...drag, cur: add(drag.start, d) });
      return;
    }
    if (drag?.kind === 'marquee') { setDrag({ ...drag, cur: p }); return; }
    if (drag?.kind === 'room' || drag?.kind === 'surface') { const sn = computeSnap(p); setSnapRes(sn); setDrag({ ...drag, cur: sn.p }); return; }
    if (tool === 'select') {
      const hit = hitTest(liveDoc, b, dl, p, tolMm, rules, { site: !!siteA, furniture: layers.furniture });
      s.setHover(hit);
      setSnapRes(null);
    } else if (tool !== 'pan' && tool !== 'block') setSnapRes(computeSnap(p, tool === 'wall' || tool === 'linear' ? chain[chain.length - 1] : null));
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === 'marquee') {
      const x0 = Math.min(drag.start.x, drag.cur.x), x1 = Math.max(drag.start.x, drag.cur.x), y0 = Math.min(drag.start.y, drag.cur.y), y1 = Math.max(drag.start.y, drag.cur.y);
      if ((x1 - x0) * v.z > 6) {
        const inBox = (q: Vec2) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
        const refs: ElementRef[] = [
          ...dl.walls.filter((w) => inBox(w.a) && inBox(w.b)).map((w) => ({ kind: 'wall' as const, id: w.id })),
          ...Object.values(b.furniture).filter((f) => f.levelId === levelId && inBox(f.position)).map((f) => ({ kind: 'furniture' as const, id: f.id })),
          ...Object.values(b.columns).filter((c) => c.levelId === levelId && inBox(c.position)).map((c) => ({ kind: 'column' as const, id: c.id })),
        ];
        s.select(refs, true);
      }
    } else if (drag.kind === 'room') {
      const x0 = Math.min(drag.start.x, drag.cur.x), y0 = Math.min(drag.start.y, drag.cur.y);
      const w = Math.abs(drag.cur.x - drag.start.x), h = Math.abs(drag.cur.y - drag.start.y);
      if (w > 600 && h > 600) s.dispatch([{ type: 'room.create', params: { levelId, x: x0, y: y0, w, h, name: 'New Room', fn: 'other' } }]);
    } else if (drag.kind === 'surface' && placeSite) {
      const x0 = Math.min(drag.start.x, drag.cur.x), y0 = Math.min(drag.start.y, drag.cur.y);
      const w = Math.abs(drag.cur.x - drag.start.x), h = Math.abs(drag.cur.y - drag.start.y);
      if (w > 300 && h > 300) {
        s.dispatch([{ type: 'site.feature.create', params: { kind: placeSite.kind, name: placeSite.name, polygon: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }], materialId: placeSite.material, props: placeSite.props ?? {} } }]);
        s.setTool('select');
      }
    } else if (dragOps) {
      s.dispatch(dragOps, { keepSelection: true });
    }
    setDrag(null);
    setSnapRes(null);
  };

  /** Turn the clicked points into a hedge, fence or garden wall. */
  function finishLinear(pts: Vec2[]) {
    const spec = useStore.getState().placeSite;
    setChain([]);
    if (!spec || pts.length < 2) return;
    s.dispatch([{ type: 'site.feature.create', params: { kind: spec.kind, name: spec.name, path: pts, materialId: spec.material, props: spec.props ?? {} } }]);
    s.setTool('select');
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool === 'wall') { setChain([]); return; }
    if (tool === 'linear') { finishLinear(chain); return; }
    const r = svgRef.current!.getBoundingClientRect();
    const p = toWorld(e.clientX - r.left, e.clientY - r.top);
    const room = dl.rooms.find((x) => x.tagId && pointInPolygon(p, x.polygon));
    if (room) { s.select([{ kind: 'room', id: room.tagId! }]); window.dispatchEvent(new CustomEvent('plinth:rename')); }
  };

  // ---------------------------------------------------------------- render
  const prims = (list: Prim[], cls: { stroke?: string; opacity?: number; width?: number } = {}) => list.map((p, i) => {
    if (p.t === 'text') return null;
    const fill = p.t === 'poly' || p.t === 'circle' ? p.fill : undefined;
    return (
    <path key={i} d={primPath(p)} fill={fill === 'cut' ? 'var(--poche)' : fill ?? 'none'} fillOpacity={fill && fill !== 'cut' ? 0.16 : 1}
      stroke={cls.stroke ?? (p.w === 'hairline' ? 'var(--plan-light)' : 'var(--plan-line)')} strokeWidth={(cls.width ?? 1) * STROKE[p.w]} strokeDasharray={p.dash ? '4 3' : undefined} vectorEffect="non-scaling-stroke" opacity={cls.opacity} />
    );
  });
  const stairTexts = (list: Prim[]) => list.filter((p): p is Extract<Prim, { t: 'text' }> => p.t === 'text').map((p, i) => { const q = toScreen(p.p); return <text key={i} x={q.x} y={q.y} textAnchor="middle" fontSize={10} fill="var(--ink-3)" fontWeight={600}>{p.text}</text>; });

  const grid = (() => {
    if (!layers.grid) return null;
    const step = gridStep * (gridStep * v.z < 8 ? 10 : 1);
    if (step * v.z < 6) return null;
    const tl = toWorld(0, 0), br = toWorld(size.w, size.h);
    const lines: React.ReactNode[] = [];
    const major = units === 'metric' ? 1000 : 304.8 * 5;
    let n = 0;
    for (let x = Math.floor(tl.x / step) * step; x <= br.x && n < 400; x += step, n++) lines.push(<line key={`x${n}`} x1={x} y1={-tl.y} x2={x} y2={-br.y} stroke={Math.abs(x % major) < 1 ? 'var(--plan-grid-major)' : 'var(--plan-grid)'} strokeWidth={1} vectorEffect="non-scaling-stroke" />);
    for (let y = Math.floor(br.y / step) * step; y <= tl.y && n < 800; y += step, n++) lines.push(<line key={`y${n}`} x1={tl.x} y1={-y} x2={br.x} y2={-y} stroke={Math.abs(y % major) < 1 ? 'var(--plan-grid-major)' : 'var(--plan-grid)'} strokeWidth={1} vectorEffect="non-scaling-stroke" />);
    return <g>{lines}</g>;
  })();

  const selRooms = selection.filter((r) => r.kind === 'room').map((r) => dl.rooms.find((x) => x.tagId === r.id)).filter(Boolean) as DerivedRoom[];
  const selWalls = selection.filter((r) => r.kind === 'wall').map((r) => b.walls[r.id]).filter((w) => w && w.levelId === levelId);
  const hover = s.hover;
  const upperStairs = below ? Object.values(b.stairs).filter((st) => st.levelId === below.id) : [];
  const changedRooms = new Set(proposal?.impact?.changed.filter((c) => c.kind === 'room').map((c) => c.id) ?? []);
  const underlays = layers.underlay ? doc.underlays.filter((u) => u.levelId === levelId && u.visible) : [];
  const comments = layers.comments ? doc.comments.filter((c) => !c.resolved && c.pin?.levelId === levelId) : [];
  const issues = health?.issues.filter((i) => i.point && (i.levelId === levelId || (!i.levelId && isGround))) ?? [];

  const cursorClass = drag?.kind === 'pan' || space ? 'panning' : tool === 'select' ? 'tool-select' : 'tool-draw';

  return (
    <div style={{ position: 'absolute', inset: 0 }}
      onDragOver={(e) => { if (!e.dataTransfer.types.includes('text/plinth-block')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; const r = svgRef.current!.getBoundingClientRect(); setCursor(toWorld(e.clientX - r.left, e.clientY - r.top)); }}
      onDragLeave={() => setCursor(null)}
      onDrop={(e) => { if (!e.dataTransfer.types.includes('text/plinth-block')) return; e.preventDefault(); dropBlock(); }}>
      <svg ref={svgRef} className={`plan-svg ${cursorClass}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { setCursor(null); s.setHover(null); }} onDoubleClick={onDoubleClick}
        role="application" aria-label={`Floor plan — ${level.name}`}>
        <g transform={`matrix(${v.z},0,0,${v.z},${tx},${ty})`}>
          {grid}
          {underlays.map((u) => u.image
            ? <image key={u.id} href={u.image} x={u.x} y={-(u.y + u.width * u.aspect)} width={u.width} height={u.width * u.aspect} opacity={u.opacity} preserveAspectRatio="none" />
            : <g key={u.id} opacity={u.opacity}>{u.lines?.map((l, i) => <line key={i} x1={l.a.x} y1={-l.a.y} x2={l.b.x} y2={-l.b.y} stroke="#7a8db8" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />)}</g>)}
          {siteA && (
            <g>
              <defs>
                <pattern id="pat-paving" width="600" height="600" patternUnits="userSpaceOnUse"><path d="M0 0H600M0 0V600" fill="none" stroke="rgba(90,80,65,0.35)" strokeWidth="14" /></pattern>
                <pattern id="pat-deck" width="150" height="150" patternUnits="userSpaceOnUse"><path d="M0 0H150" fill="none" stroke="rgba(110,70,40,0.4)" strokeWidth="12" /></pattern>
                <pattern id="pat-gravel" width="320" height="320" patternUnits="userSpaceOnUse"><circle cx="60" cy="70" r="18" fill="rgba(90,85,75,0.4)" /><circle cx="210" cy="40" r="14" fill="rgba(90,85,75,0.3)" /><circle cx="150" cy="200" r="20" fill="rgba(90,85,75,0.35)" /><circle cx="280" cy="250" r="13" fill="rgba(90,85,75,0.3)" /></pattern>
                <pattern id="pat-bed" width="420" height="420" patternUnits="userSpaceOnUse"><path d="M60 110l50 -60M250 300l50 -60M290 110l-40 -50M110 330l-40 -50" fill="none" stroke="rgba(70,110,55,0.55)" strokeWidth="16" strokeLinecap="round" /></pattern>
                <pattern id="pat-water" width="900" height="500" patternUnits="userSpaceOnUse"><path d="M40 250q110 -70 220 0t220 0" fill="none" stroke="rgba(40,110,140,0.4)" strokeWidth="14" /></pattern>
              </defs>
              <path d={ringD(doc.site.boundary)} fill="rgba(143,174,107,0.10)" stroke="var(--ink-3)" strokeWidth={1.4} strokeDasharray="10 4 2 4" vectorEffect="non-scaling-stroke" />
              {siteA.zone.map((z, i) => <path key={i} d={ringD(z.outer) + z.holes.map(ringD).join('')} fill="none" stroke="var(--accent)" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />)}
              {Object.values(doc.site.features).map((f) => f.polygon && (
                <g key={f.id}>
                  <path d={ringD(f.polygon)} fill={FEATURE_FILL[f.kind] ?? 'rgba(150,145,135,0.13)'} stroke={selected({ kind: 'siteFeature', id: f.id }) ? 'var(--accent)' : 'var(--plan-light)'} strokeWidth={selected({ kind: 'siteFeature', id: f.id }) ? 2 : 0.8} vectorEffect="non-scaling-stroke" />
                  {FEATURE_PATTERN[f.kind] && <path d={ringD(f.polygon)} fill={`url(#${FEATURE_PATTERN[f.kind]})`} style={{ pointerEvents: 'none' }} />}
                </g>
              ))}
              {Object.values(doc.site.features).map((f) => f.path && f.path.length > 1 && <LinearFeature key={f.id} f={f} on={selected({ kind: 'siteFeature', id: f.id })} hov={hover?.kind === 'siteFeature' && hover.id === f.id} />)}
              {siteA.analysis.violations.map((z, i) => <path key={`v${i}`} d={ringD(z.outer)} fill="rgba(194,65,58,0.25)" stroke="var(--err)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            </g>
          )}
          {dlBelow && dlBelow.poche.map((p, i) => <path key={`lb${i}`} d={ringD(p.outer) + p.holes.map(ringD).join('')} fill="none" stroke="var(--ink-4)" strokeOpacity={0.6} strokeWidth={0.7} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" fillRule="evenodd" />)}
          {dl.rooms.map((r) => (
            <path key={r.id} d={ringD(r.polygon)} fill={ROOM_TINT[r.fn]} fillOpacity={selected({ kind: 'room', id: r.tagId ?? '' }) ? 0.95 : 0.55}
              stroke={selected({ kind: 'room', id: r.tagId ?? '' }) ? 'var(--accent)' : hover?.kind === 'room' && hover.id === r.tagId ? 'var(--accent)' : 'none'} strokeWidth={2} strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />
          ))}
          {layers.furniture && Object.values(b.furniture).filter((f) => f.levelId === levelId).map((f) => {
            const on = selected({ kind: 'furniture', id: f.id }), hov = hover?.kind === 'furniture' && hover.id === f.id;
            return <g key={f.id}>{prims(furnitureSymbol(f), on || hov ? { stroke: 'var(--accent)', width: on ? 1.5 : 1.2 } : {})}</g>;
          })}
          {Object.values(b.stairs).filter((st) => st.levelId === levelId).map((st) => {
            const info = computeStair(st, level, rules);
            const on = selected({ kind: 'stair', id: st.id });
            return <g key={st.id}>{prims(stairSymbol(info), on ? { stroke: 'var(--accent)', width: 1.4 } : {})}</g>;
          })}
          {below && upperStairs.map((st) => <g key={`u${st.id}`}>{prims(stairSymbol(computeStair(st, below, rules), { upper: true }), { opacity: 0.8 })}</g>)}
          {dl.poche.map((p, i) => <path key={i} d={ringD(p.outer) + p.holes.map(ringD).join('')} fill="var(--poche)" fillRule="evenodd" />)}
          {selWalls.map((w) => { const o = dl.outlines.get(w.id); return o ? <path key={w.id} d={ringD(o.quad)} fill="var(--accent)" fillOpacity={0.55} stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null; })}
          {hover?.kind === 'wall' && !selected(hover) && dl.outlines.get(hover.id) && <path d={ringD(dl.outlines.get(hover.id)!.quad)} fill="var(--accent)" fillOpacity={0.25} />}
          {dl.walls.map((w) => openingsOf(b, w.id).map((o) => {
            const isD = 'swingAngle' in o;
            const on = selected({ kind: isD ? 'door' : 'window', id: o.id });
            return <g key={o.id}>{prims(isD ? doorSymbol(w, o) : windowSymbol(w, o), on ? { stroke: 'var(--accent)', width: 1.6 } : {})}</g>;
          }))}
          {Object.values(b.columns).filter((c) => c.levelId === levelId).map((c) => <g key={c.id}>{prims(columnSymbol(c), selected({ kind: 'column', id: c.id }) ? { stroke: 'var(--accent)' } : {})}</g>)}
          {pdl && (() => {
            const cur = new Map(dl.walls.map((w) => [w.id, w]));
            const changedWalls = pdl.walls.filter((w) => { const c = cur.get(w.id); return !c || c.a.x !== w.a.x || c.a.y !== w.a.y || c.b.x !== w.b.x || c.b.y !== w.b.y || c.thickness !== w.thickness; });
            const rooms = pdl.rooms.filter((r) => changedRooms.has(r.tagId ?? '') || !dl.rooms.some((x) => x.tagId === r.tagId));
            return (
              <g>
                {rooms.map((r) => <path key={`p${r.id}`} d={ringD(r.polygon)} fill="var(--accent)" fillOpacity={0.14} stroke="var(--accent)" strokeWidth={1.6} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
                {changedWalls.map((w) => { const o = pdl.outlines.get(w.id); return o ? <path key={`pw${w.id}`} d={ringD(o.quad)} fill="var(--accent)" fillOpacity={0.6} /> : null; })}
              </g>
            );
          })()}
          {snapRes?.guides.map(([a, c], i) => <line key={`g${i}`} x1={a.x} y1={-a.y} x2={c.x} y2={-c.y} stroke="var(--accent)" strokeWidth={0.8} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
          {(tool === 'wall' || tool === 'linear') && chain.length > 0 && (
            <g>
              <path d={lineD(chain)} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {cursor && <line x1={chain[chain.length - 1].x} y1={-chain[chain.length - 1].y} x2={(snapRes?.p ?? cursor).x} y2={-(snapRes?.p ?? cursor).y} stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
            </g>
          )}
          {(drag?.kind === 'room' || drag?.kind === 'surface') && <rect x={Math.min(drag.start.x, drag.cur.x)} y={-Math.max(drag.start.y, drag.cur.y)} width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
          {drag?.kind === 'marquee' && <rect x={Math.min(drag.start.x, drag.cur.x)} y={-Math.max(drag.start.y, drag.cur.y)} width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)} fill="var(--accent-softer)" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
          {blockGhost && (() => {
            const bad = !blockGhost.an.ok || blockGhost.wrongLevel;
            const stroke = bad ? 'var(--err)' : 'var(--accent)';
            return (
              <g style={{ pointerEvents: 'none' }}>
                {blockGhost.pl.site.map((st, i) => <rect key={`gs${i}`} x={st.rect.x} y={-(st.rect.y + st.rect.h)} width={st.rect.w} height={st.rect.h} fill={st.kind === 'pool' ? '#9fd0dc' : st.kind === 'lawn' ? '#cfe0b8' : st.kind === 'deck' ? '#dcc7a6' : '#e2ded6'} fillOpacity={0.75} stroke={stroke} strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
                {blockGhost.pl.parts.map((pt) => <rect key={pt.key} x={pt.rect.x} y={-(pt.rect.y + pt.rect.h)} width={pt.rect.w} height={pt.rect.h} fill={bad ? 'rgba(194,65,58,0.14)' : ROOM_TINT[pt.fn]} fillOpacity={0.8} stroke={stroke} strokeWidth={2} strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />)}
                <g opacity={0.75}>
                  {[...blockGhost.pl.props, ...blockGhost.pl.parts.flatMap((pt) => pt.items ?? [])].filter((it) => ASSET_BY_ID[it.asset]).map((it, i) =>
                    <g key={`gi${i}`}>{prims(furnitureSymbol({ id: `ghost${i}`, levelId, assetId: it.asset, position: it.p, rotation: it.rot, props: {} }), { stroke: bad ? 'var(--err)' : 'var(--ink-2)' })}</g>)}
                </g>
                <rect x={blockGhost.pl.x} y={-(blockGhost.pl.y + blockGhost.pl.d)} width={blockGhost.pl.w} height={blockGhost.pl.d} fill="none" stroke={stroke} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })()}
          {tool === 'place' && placeAsset && cursor && <g opacity={0.6}>{prims(furnitureSymbol({ id: 'ghost', levelId, assetId: placeAsset, position: snapRes?.p ?? cursor, rotation: placeRotation, props: {} }), { stroke: 'var(--accent)' })}</g>}
          {(tool === 'door' || tool === 'window') && cursor && (() => {
            const w = nearestWall(cursor);
            if (!w) return null;
            const off = lineParam(cursor, w.a, w.b) * wallLength(w);
            const width = tool === 'door' ? 900 : 1500;
            const side = dot(sub(cursor, w.a), perp(norm(sub(w.b, w.a)))) >= 0 ? 'left' : 'right';
            const sym = tool === 'door' ? doorSymbol(w, { id: 'g', wallId: w.id, offset: off, width, height: 2100, kind: 'single', hinge: 'start', side, swingAngle: 90, materialId: 'oak', tag: '', props: {} }) : windowSymbol(w, { id: 'g', wallId: w.id, offset: off, width, height: 1500, sill: 750, kind: 'casement', glazing: 'double', frameMaterialId: 'alu-black', tag: '', props: {} });
            return <g>{prims(sym, { stroke: 'var(--accent)', width: 1.6 })}</g>;
          })()}
        </g>

        {/* ---------------- screen-space layer: labels, dims, handles */}
        {dl.rooms.map((r) => {
          const q = toScreen(r.labelPoint);
          const px = Math.min(r.width, r.depth) * v.z;
          const pr0 = pdl?.rooms.find((x) => x.tagId === r.tagId);
          const area0 = pr0 && Math.abs(pr0.area - r.area) > 1e4 ? pr0 : r;
          // Tiny on screen: the area alone, so every room always reports its size.
          if (px < 34) return px < 16 ? null : <text key={`l${r.id}`} x={q.x} y={q.y + 3} textAnchor="middle" fontSize={8.5} fill="var(--ink-2)" className="num" style={{ pointerEvents: 'none' }}>{formatArea(area0.area, units)}</text>;
          const big = px > 52;
          const pr = pdl?.rooms.find((x) => x.tagId === r.tagId);
          const area = pr && Math.abs(pr.area - r.area) > 1e4 ? pr : r;
          return (
            <g key={`l${r.id}`} style={{ pointerEvents: 'none' }}>
              <text stroke="var(--paper)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" x={q.x} y={q.y - (big ? 8 : 2)} textAnchor="middle" fontSize={big ? 11 : 9.5} fontWeight={650} letterSpacing="0.04em" fill={r.tagId ? 'var(--ink)' : 'var(--ink-3)'}>{r.name.toUpperCase()}</text>
              {!big && <text stroke="var(--paper)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" x={q.x} y={q.y + 9} textAnchor="middle" fontSize={9} fill="var(--ink-2)" className="num">{formatArea(area.area, units)}</text>}
              {big && <text stroke="var(--paper)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" x={q.x} y={q.y + 7} textAnchor="middle" fontSize={10.5} fill="var(--ink-2)" className="num">{r.isRect ? `${formatLength(area.width, units)} × ${formatLength(area.depth, units)}` : 'Irregular'}</text>}
              {big && <text stroke="var(--paper)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" x={q.x} y={q.y + 20} textAnchor="middle" fontSize={10} fill={area !== r ? 'var(--accent)' : 'var(--ink-3)'} fontWeight={area !== r ? 600 : 400}>{formatArea(area.area, units)}</text>}
            </g>
          );
        })}
        {stairTexts(Object.values(b.stairs).filter((st) => st.levelId === levelId).flatMap((st) => stairSymbol(computeStair(st, level, rules))))}
        {layers.dimensions && (() => {
          // Every wall reports its length. Outer faces are covered by the exterior chains;
          // other walls get a tag on their room side, placed longest-first so tags never
          // collide with room labels, site labels or each other (zoom in to reveal more).
          type Box = { x0: number; y0: number; x1: number; y1: number };
          const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          const taken: Box[] = [];
          for (const r of dl.rooms) {
            const px = Math.min(r.width, r.depth) * v.z;
            if (px < 16) continue;
            const q = toScreen(r.labelPoint);
            const wd = Math.max(r.name.length * 7.4, 74) / 2 + 2, up = px > 52 ? 20 : 12, dn = px > 52 ? 26 : 13;
            taken.push({ x0: q.x - wd, y0: q.y - up, x1: q.x + wd, y1: q.y + dn });
          }
          if (siteA) for (const f of Object.values(doc.site.features)) if (f.polygon && f.polygon.length > 2) {
            const bb = bbox(f.polygon);
            const c = toScreen({ x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 });
            const nw = (bb.maxX - bb.minX) * v.z < 96, tall = nw && (bb.maxY - bb.minY) > (bb.maxX - bb.minX) * 1.6;
            taken.push(tall ? { x0: c.x - 8, y0: c.y - 50, x1: c.x + 8, y1: c.y + 50 } : nw ? { x0: c.x - 26, y0: c.y - 8, x1: c.x + 26, y1: c.y + 8 } : { x0: c.x - 48, y0: c.y - 16, x1: c.x + 48, y1: c.y + 14 });
          }
          const fp = dl.footprint.length ? bbox(dl.footprint.flat()) : null;
          const onFace = (w: (typeof dl.walls)[number]) => !!fp && w.kind !== 'interior' && w.kind !== 'partition' && (
            (Math.abs(w.a.x - w.b.x) < 5 && (Math.abs(w.a.x - fp.minX) < w.thickness || Math.abs(w.a.x - fp.maxX) < w.thickness)) ||
            (Math.abs(w.a.y - w.b.y) < 5 && (Math.abs(w.a.y - fp.minY) < w.thickness || Math.abs(w.a.y - fp.maxY) < w.thickness)));
          const out: JSX.Element[] = [];
          for (const w of [...dl.walls].sort((a, b) => wallLength(b) - wallLength(a))) {
            if (selWalls.some((x) => x.id === w.id) || onFace(w)) continue;
            const p = toScreen(w.a), q = toScreen(w.b);
            if (Math.hypot(q.x - p.x, q.y - p.y) < 48) continue;
            const n = perp(norm(sub(w.b, w.a)));
            const m = mid(w.a, w.b);
            const inRoom = (sg: number) => dl.rooms.some((r) => pointInPolygon(add(m, scale(n, sg * (w.thickness / 2 + 250))), r.polygon));
            const sg = inRoom(1) ? 1 : inRoom(-1) ? -1 : 1;
            const face = toScreen(add(m, scale(n, sg * (w.thickness / 2))));
            const tx = face.x + n.x * sg * 8, ty = face.y - n.y * sg * 8;
            const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
            const rot = ang > 90 || ang < -90 ? ang + 180 : ang;
            const label = formatLength(wallLength(w), units);
            const half = label.length * 2.9 + 3;
            const vert = Math.abs(Math.abs(rot) - 90) < 45;
            const box = vert ? { x0: tx - 7, y0: ty - half, x1: tx + 7, y1: ty + half } : { x0: tx - half, y0: ty - 7, x1: tx + half, y1: ty + 7 };
            if (taken.some((t) => hit(t, box))) continue;
            taken.push(box);
            out.push(<text key={`wl${w.id}`} x={tx} y={ty} textAnchor="middle" dominantBaseline="central" fontSize={9} fill="var(--ink-3)" stroke="var(--paper)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" transform={`rotate(${rot} ${tx} ${ty})`} className="num" style={{ pointerEvents: 'none' }}>{label}</text>);
          }
          return out;
        })()}
        {layers.dimensions && siteA && (() => {
          const ring = doc.site.boundary;
          const ccw = ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + (p.x * q.y - q.x * p.y); }, 0) > 0;
          return ring.map((p0, i) => {
            const q0 = ring[(i + 1) % ring.length];
            const p = toScreen(p0), q = toScreen(q0);
            const sl = Math.hypot(q.x - p.x, q.y - p.y);
            if (sl < 60) return null;
            const d = norm(sub(q0, p0));
            const out = ccw ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
            const m = toScreen(mid(p0, q0));
            const tx = m.x + out.x * 12, ty = m.y - out.y * 12;
            const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
            const rot = ang > 90 || ang < -90 ? ang + 180 : ang;
            return <text key={`pe${i}`} x={tx} y={ty} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="var(--ink-3)" transform={`rotate(${rot} ${tx} ${ty})`} className="num" style={{ pointerEvents: 'none' }}>{formatLength(dist(p0, q0), units)}</text>;
          });
        })()}
        {layers.dimensions && siteA && Object.values(doc.site.features).map((f) => {
          if (!f.polygon || f.polygon.length < 3) return null;
          const bb = bbox(f.polygon);
          const w = bb.maxX - bb.minX, h = bb.maxY - bb.minY;
          if (Math.min(w, h) * v.z < 26) return null;
          const c = toScreen({ x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 });
          const cars = f.kind === 'parking' ? Number(f.props.spaces ?? 0) : 0;
          const rect = f.polygon.length === 4 && f.polygon.every((pt) => (Math.abs(pt.x - bb.minX) < 2 || Math.abs(pt.x - bb.maxX) < 2) && (Math.abs(pt.y - bb.minY) < 2 || Math.abs(pt.y - bb.maxY) < 2));
          const line2 = `${rect ? `${formatLength(w, units, { compact: true })} × ${formatLength(h, units, { compact: true })}` : formatArea(Math.abs(f.polygon.reduce((a, p, i) => { const q = f.polygon![(i + 1) % f.polygon!.length]; return a + (p.x * q.y - q.x * p.y); }, 0)) / 2, units)}${cars ? ` · ${cars} car${cars > 1 ? 's' : ''}` : ''}`;
          const halo = { stroke: 'var(--paper)', strokeWidth: 3, strokeLinejoin: 'round' as const, paintOrder: 'stroke' };
          if (w * v.z < 96) {
            // Narrow on screen: one short line, turned to run along the item if it is tall.
            const short = cars ? `${cars} car${cars > 1 ? 's' : ''}` : rect ? `${formatLength(w, units, { compact: true })} × ${formatLength(h, units, { compact: true })}` : f.name;
            const tall = h > w * 1.6 && h * v.z > 70;
            return <text key={`sf${f.id}`} x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={600} fill="var(--ink-2)" {...halo} transform={tall ? `rotate(-90 ${c.x} ${c.y})` : undefined} className="num" style={{ pointerEvents: 'none' }}>{tall && rect ? `${short}${cars ? ` · ${formatLength(w, units, { compact: true })} × ${formatLength(h, units, { compact: true })}` : ''}` : short}</text>;
          }
          return (
            <g key={`sf${f.id}`} style={{ pointerEvents: 'none' }}>
              <text x={c.x} y={c.y - 4} textAnchor="middle" fontSize={9.5} fontWeight={650} letterSpacing="0.04em" fill="var(--ink-2)" {...halo}>{f.name.toUpperCase()}</text>
              <text x={c.x} y={c.y + 9} textAnchor="middle" fontSize={9.5} fill="var(--ink-2)" className="num" {...halo}>{line2}</text>
            </g>
          );
        })}
        {layers.dimensions && dimensionChains(dl).map((d, i) => <Dim key={i} a={add(d.a, d.offset)} b={add(d.b, d.offset)} toScreen={toScreen} label={formatLength(dist(d.a, d.b), units)} strong={d.overall} />)}
        {selWalls.map((w) => {
          const n = perp(norm(sub(w.b, w.a)));
          const off = scale(n, w.thickness / 2 + 650);
          const a = add(w.a, off), c = add(w.b, off);
          return <Dim key={`wd${w.id}`} a={a} b={c} toScreen={toScreen} label={formatLength(wallLength(w), units)} accent onClick={() => { const m = toScreen(mid(a, c)); setDimEdit({ x: m.x, y: m.y, value: wallLength(w), commit: (mm) => s.dispatch([{ type: 'wall.setLength', params: { id: w.id, length: mm } }], { keepSelection: true }) }); }} />;
        })}
        {selRooms.map((r) => r.isRect && (
          <g key={`rd${r.id}`}>
            <Dim a={{ x: r.bbox.minX, y: r.bbox.minY + 450 }} b={{ x: r.bbox.maxX, y: r.bbox.minY + 450 }} toScreen={toScreen} label={formatLength(r.width, units)} accent onClick={() => { const m = toScreen({ x: (r.bbox.minX + r.bbox.maxX) / 2, y: r.bbox.minY + 450 }); setDimEdit({ x: m.x, y: m.y, value: r.width, commit: (mm) => s.dispatch([{ type: 'room.resize', params: { id: r.tagId, axis: 'x', size: mm } }], { keepSelection: true }) }); }} />
            <Dim a={{ x: r.bbox.minX + 450, y: r.bbox.minY }} b={{ x: r.bbox.minX + 450, y: r.bbox.maxY }} toScreen={toScreen} label={formatLength(r.depth, units)} accent onClick={() => { const m = toScreen({ x: r.bbox.minX + 450, y: (r.bbox.minY + r.bbox.maxY) / 2 }); setDimEdit({ x: m.x, y: m.y, value: r.depth, commit: (mm) => s.dispatch([{ type: 'room.resize', params: { id: r.tagId, axis: 'y', size: mm } }], { keepSelection: true }) }); }} />
            {tool === 'select' && ([['x', 'max', { x: r.bbox.maxX, y: (r.bbox.minY + r.bbox.maxY) / 2 }], ['x', 'min', { x: r.bbox.minX, y: (r.bbox.minY + r.bbox.maxY) / 2 }], ['y', 'max', { x: (r.bbox.minX + r.bbox.maxX) / 2, y: r.bbox.maxY }], ['y', 'min', { x: (r.bbox.minX + r.bbox.maxX) / 2, y: r.bbox.minY }]] as const).map(([axis, side, p]) => {
              const q = toScreen(p);
              const vert = axis === 'x';
              return <rect key={axis + side} data-handle={`edge:${r.tagId}:${axis}-${side}`} x={q.x - (vert ? 4 : 14)} y={q.y - (vert ? 14 : 4)} width={vert ? 8 : 28} height={vert ? 28 : 8} rx={4} fill="var(--surface)" stroke="var(--accent)" strokeWidth={1.5} style={{ cursor: vert ? 'ew-resize' : 'ns-resize' }} aria-label={`Drag to resize ${r.name}`} />;
            })}
          </g>
        ))}
        {tool === 'select' && selWalls.map((w) => (['a', 'b'] as const).map((end) => { const q = toScreen(w[end]); return <circle key={w.id + end} data-handle={`end:${w.id}:${end}`} cx={q.x} cy={q.y} r={5.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} style={{ cursor: 'move' }} />; }))}
        {(tool === 'wall' || tool === 'linear') && chain.length > 0 && cursor && (() => {
          const from = chain[chain.length - 1], to = snapRes?.p ?? cursor;
          const q = toScreen(mid(from, to));
          return <g style={{ pointerEvents: 'none' }}><rect x={q.x - 38} y={q.y - 26} width={76} height={20} rx={10} fill="var(--ink)" /><text x={q.x} y={q.y - 12} textAnchor="middle" fontSize={11} fill="var(--surface)" fontWeight={600}>{typed || formatLength(dist(from, to), units)}</text></g>;
        })()}
        {(drag?.kind === 'room' || drag?.kind === 'surface') && (() => { const q = toScreen(mid(drag.start, drag.cur)); return <text x={q.x} y={q.y} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--accent)">{formatLength(Math.abs(drag.cur.x - drag.start.x), units)} × {formatLength(Math.abs(drag.cur.y - drag.start.y), units)}</text>; })()}
        {drag?.kind === 'move' && drag.moved && cursor && (() => { const q = toScreen(cursor); const d = sub(drag.cur, drag.start); return <text x={q.x + 14} y={q.y - 12} fontSize={11} fontWeight={600} fill="var(--accent)">Δ {formatLength(Math.hypot(d.x, d.y), units)}</text>; })()}
        {snapRes && snapRes.kind !== 'none' && snapRes.kind !== 'grid' && (() => { const q = toScreen(snapRes.p); return <g style={{ pointerEvents: 'none' }}><rect x={q.x - 5} y={q.y - 5} width={10} height={10} fill="none" stroke="var(--accent)" strokeWidth={1.6} transform={snapRes.kind === 'midpoint' ? `rotate(45 ${q.x} ${q.y})` : undefined} /><text x={q.x + 9} y={q.y + 16} fontSize={10} fill="var(--accent)">{snapRes.kind}</text></g>; })()}
        {blockGhost && (() => {
          const g = blockGhost;
          const tl = toScreen({ x: g.pl.x, y: g.pl.y + g.pl.d });
          const br = toScreen({ x: g.pl.x + g.pl.w, y: g.pl.y });
          const bad = !g.an.ok || g.wrongLevel;
          const ok = g.pl.def.siteOnly ? '✓ Ready to place on the site' : g.an.neighbour ? `✓ Connects to ${g.an.neighbour.name}` : 'Stand-alone — drop it touching a room to connect';
          const status = g.wrongLevel ? 'Outdoor spaces go on the ground floor' : !g.an.ok ? `✕ ${g.an.reason}` : g.warn ? `⚠ ${g.warn}${g.an.neighbour ? ` · connects to ${g.an.neighbour.name}` : ''}` : ok;
          const pill = bad ? 'var(--err)' : g.warn ? 'var(--warn)' : 'var(--ink)';
          const w = Math.max(160, status.length * 6.4 + 24);
          return (
            <g style={{ pointerEvents: 'none' }}>
              {g.pl.parts.map((pt) => { const c = toScreen({ x: pt.rect.x + pt.rect.w / 2, y: pt.rect.y + pt.rect.h / 2 }); const big = Math.min(pt.rect.w, pt.rect.h) * v.z > 40; return big ? <text key={pt.key} x={c.x} y={c.y + 4} textAnchor="middle" fontSize={10.5} fontWeight={650} letterSpacing="0.03em" fill="var(--ink)">{pt.name.toUpperCase()}</text> : null; })}
              <text x={tl.x} y={tl.y - 8} fontSize={12} fontWeight={650} fill={bad ? 'var(--err)' : 'var(--accent)'} stroke="var(--paper)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">{g.pl.def.name} · {formatLength(g.pl.w, units, { compact: true })} × {formatLength(g.pl.d, units, { compact: true })}</text>
              <rect x={(tl.x + br.x) / 2 - w / 2} y={br.y + 10} width={w} height={22} rx={11} fill={pill} />
              <text x={(tl.x + br.x) / 2} y={br.y + 25} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={500}>{status}</text>
            </g>
          );
        })()}
        {issues.map((i) => { const q = toScreen(i.point!); const c = i.severity === 'error' ? 'var(--err)' : i.severity === 'warning' ? 'var(--warn)' : 'var(--info)'; if (i.severity === 'info') return null; return (
          <g key={i.id} onPointerDown={(e) => { e.stopPropagation(); s.select(i.refs); }} onMouseEnter={() => setHoverIssue(i.id)} onMouseLeave={() => setHoverIssue(null)} style={{ cursor: 'pointer' }}>
            <circle cx={q.x + 14} cy={q.y - 14} r={7} fill={c} stroke="var(--surface)" strokeWidth={2} /><text x={q.x + 14} y={q.y - 10.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">!</text>
            {hoverIssue === i.id && <g><rect x={q.x + 26} y={q.y - 30} width={Math.min(320, 8 + i.title.length * 6.2)} height={22} rx={6} fill="var(--ink)" /><text x={q.x + 32} y={q.y - 15} fontSize={11} fill="var(--surface)">{i.title}</text></g>}
          </g>
        ); })}
        {comments.map((c) => { const q = toScreen(c.pin!.point); const u = USER_BY_ID[c.authorId]; return (
          <g key={c.id} transform={`translate(${q.x},${q.y})`} style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); s.navigate({ name: 'project', id: doc.id, space: 'collab' }); }}>
            <path d="M0 0 C -12 -6 -14 -26 0 -30 C 14 -26 12 -6 0 0Z" fill={u?.color ?? 'var(--accent)'} stroke="var(--surface)" strokeWidth={2} />
            <text y={-15} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#fff">{u?.initials ?? '?'}</text>
          </g>
        ); })}
      </svg>

      {dimEdit && (
        <div className="dim-input" style={{ left: dimEdit.x, top: dimEdit.y }}>
          <input autoFocus defaultValue={formatLength(dimEdit.value, units)} aria-label="Exact dimension"
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setDimEdit(null); if (e.key === 'Enter') { const v2 = parseLength((e.target as HTMLInputElement).value, units); if (v2 && v2 > 100) dimEdit.commit(v2); setDimEdit(null); } }}
            onBlur={() => setDimEdit(null)} />
        </div>
      )}
      {commentAt && <CommentComposer at={commentAt} onDone={() => setCommentAt(null)} levelId={levelId} dl={dl} />}
      {tool === 'wall' && <div className="hint">{chain.length ? <>Click to continue · type a length <span className="kbd">12'6"</span> + <span className="kbd">↵</span> · <span className="kbd">Esc</span> to finish</> : <>Click to start a wall · snaps to ends, midpoints and alignments · hold <span className="kbd">Space</span> to pan</>}</div>}
      {tool === 'room' && <div className="hint">Drag a rectangle to create a room — walls are added only where none exist</div>}
      {tool === 'surface' && placeSite && <div className="hint">Drag a rectangle to lay {placeSite.name.toLowerCase()} · <span className="kbd">Esc</span> cancel</div>}
      {tool === 'linear' && placeSite && <div className="hint">{chain.length ? <>Click the next corner · <span className="kbd">↵</span> or double-click to finish · click the first point to close the loop</> : <>Click along the line of the {placeSite.name.toLowerCase()}</>}</div>}
      {(tool === 'door' || tool === 'window') && <div className="hint">Click a wall to place a {tool} · it swings towards the side you click</div>}
      {tool === 'place' && placeAsset && <div className="hint">Click to place {ASSET_BY_ID[placeAsset]?.name} · <span className="kbd">R</span> rotate · <span className="kbd">Esc</span> done</div>}
      {tool === 'block' && placeBlock && <div className="hint">Move to position · it snaps to nearby walls · click to drop · <span className="kbd">R</span> rotate · <span className="kbd">Esc</span> cancel</div>}
      {tool === 'comment' && <div className="hint">Click anywhere to pin a comment to that spot</div>}
      {drag?.kind === 'edge' && <div className="hint">Resizing — walls, neighbours, openings and areas update together</div>}
      <PlanChrome z={v.z} cursor={cursor} onZoom={(f) => setView({ ...v, z: Math.max(0.004, Math.min(1.2, v.z * f)) })} onFit={fit} />
    </div>
  );
}

function Dim({ a, b, toScreen, label, strong, accent, onClick }: { a: Vec2; b: Vec2; toScreen: (p: Vec2) => { x: number; y: number }; label: string; strong?: boolean; accent?: boolean; onClick?: () => void }) {
  const p = toScreen(a), q = toScreen(b);
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (len < 30) return null;
  const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  const flip = ang > 90 || ang < -90;
  const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len;
  const color = accent ? 'var(--accent)' : 'var(--ink-3)';
  return (
    <g style={{ pointerEvents: onClick ? 'auto' : 'none', cursor: onClick ? 'text' : undefined }} onPointerDown={(e) => { if (onClick) { e.stopPropagation(); onClick(); } }}>
      <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={color} strokeWidth={strong ? 1 : 0.8} />
      {[p, q].map((t, i) => <line key={i} x1={t.x - 4 * (nx + ny * 0)} y1={t.y - 4 * ny} x2={t.x + 4 * nx} y2={t.y + 4 * ny} stroke={color} strokeWidth={1.2} transform={`rotate(45 ${t.x} ${t.y})`} />)}
      {onClick && <rect x={m.x - 36} y={m.y - 18} width={72} height={16} rx={4} fill="var(--surface)" transform={`rotate(${flip ? ang + 180 : ang} ${m.x} ${m.y})`} />}
      <text x={m.x} y={m.y - 5} textAnchor="middle" fontSize={10.5} fontWeight={accent ? 650 : 500} fill={color} transform={`rotate(${flip ? ang + 180 : ang} ${m.x} ${m.y})`} className="num">{label}</text>
    </g>
  );
}

function CommentComposer({ at, onDone, levelId, dl }: { at: { p: Vec2; sx: number; sy: number }; onDone: () => void; levelId: string; dl: ReturnType<typeof deriveLevel> }) {
  const [text, setText] = useState('');
  const dispatch = useStore((s) => s.dispatch);
  const room = dl.rooms.find((r) => r.tagId && pointInPolygon(at.p, r.polygon));
  const submit = () => {
    if (!text.trim()) { onDone(); return; }
    dispatch([{ type: 'comment.add', params: { body: text, pin: { levelId, point: at.p }, target: room?.tagId ? { kind: 'room', id: room.tagId } : undefined } }]);
    onDone();
  };
  return (
    <div className="floating" style={{ left: at.sx + 12, top: at.sy - 10, width: 280, padding: 10 }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="tiny muted" style={{ marginBottom: 6 }}>Comment{room ? ` on ${room.name}` : ''} · @mention to notify</div>
      <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. @priya can the island shrink by 6 inches?" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); if (e.key === 'Escape') onDone(); }} />
      <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}><button className="btn sm ghost" onClick={onDone}>Cancel</button><button className="btn sm primary" onClick={submit}>Comment</button></div>
    </div>
  );
}

function PlanChrome({ z, cursor, onZoom, onFit }: { z: number; cursor: Vec2 | null; onZoom: (f: number) => void; onFit: () => void }) {
  const units = useStore((s) => s.doc?.meta.units ?? 'imperial');
  const snap = useStore((s) => s.snap);
  const set = useStore((s) => s.set);
  const scaleLabel = `1:${Math.round(1 / (z * 3.78 / 1)) || 1}`;
  return (
    <>
      <div className="floating statusbar desktop-only">
        <span className="num" style={{ minWidth: 150 }}>{cursor ? `${formatLength(cursor.x, units)}, ${formatLength(cursor.y, units)}` : '—'}</span>
        <button aria-pressed={snap.endpoints} onClick={() => set('snap', { ...snap, endpoints: !snap.endpoints })} title="Object snapping">Snap</button>
        <button aria-pressed={snap.grid} onClick={() => set('snap', { ...snap, grid: !snap.grid })} title="Grid snapping">Grid</button>
        <button aria-pressed={snap.ortho} onClick={() => set('snap', { ...snap, ortho: !snap.ortho })} title="Orthogonal drawing">Ortho</button>
        <span>{scaleLabel} on screen</span>
      </div>
      <div className="floating zoom-ctrl">
        <button aria-label="Zoom out" onClick={() => onZoom(1 / 1.25)}>−</button>
        <span className="small num muted" style={{ minWidth: 44, textAlign: 'center' }}>{Math.round(z * 2000)}%</span>
        <button aria-label="Zoom in" onClick={() => onZoom(1.25)}>+</button>
        <button aria-label="Fit to view" onClick={onFit} style={{ width: 'auto', padding: '0 8px', fontSize: 12 }}>Fit</button>
      </div>
    </>
  );
}

export type { BuildingModel, ElementRef };
export { getMaterial };
