/**
 * Block card previews are produced by actually placing the block in a scratch
 * model and drawing the result — so the card shows exactly what you'll get,
 * walls, doors, windows and furniture included.
 */
import { applyOps } from '../../core/ops';
import { defaultMeta, makeLevel, newProjectDoc, rectSite } from '../../core/model/factory';
import { activeBuilding, emptyBuilding, openingsOf, isDoor } from '../../core/model/query';
import { deriveLevel } from '../../core/derive/level';
import { BLOCK_BY_ID } from '../../core/catalog/blocks';
import { doorSymbol, windowSymbol, furnitureSymbol, stairSymbol, primPath, type Prim } from '../../core/docs/symbols';
import { computeStair } from '../../core/derive/stairs';
import { resolveRules } from '../../core/rules/rulesets';
import { bbox } from '../../core/geometry/polygon';
import { ROOM_TINT } from '../plan/colors';
import { ft } from '../../core/units';

const cache = new Map<string, string>();
const PREVIEW_FILL: Record<string, string> = { pool: '#9fd0dc', pond: '#9cc4b6', lawn: '#cfe0b8', deck: '#dcc7a6', patio: '#e6d9bd', bed: '#cbb9a0', gravel: '#e4e0d6', pathway: '#dccfb8', driveway: '#d9d5cc', parking: '#dedbd3' };

export function blockPreviewSvg(blockId: string, sizeId: string): string {
  const key = `${blockId}:${sizeId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = BLOCK_BY_ID[blockId];
  const b0 = emptyBuilding();
  const lv = makeLevel({ name: 'Ground Floor', elevation: 450, slabThickness: 450, order: 0 });
  const up = makeLevel({ name: 'First Floor', elevation: 3650, order: 1 });
  b0.levels[lv.id] = lv; b0.levels[up.id] = up;
  let doc = newProjectDoc(defaultMeta({ name: 'preview' }), rectSite(ft(200), ft(200), { front: 0, side: 0, rear: 0 }), b0);
  try {
    doc = applyOps(doc, [{ type: 'block.place', params: { blockId, size: sizeId, levelId: lv.id, x: 0, y: 0 } }], { actor: 'u-ronak', role: 'owner', record: false }).doc;
  } catch {
    return '';
  }
  const b = activeBuilding(doc);
  const dl = deriveLevel(b, lv.id);
  const parts: string[] = [];
  const pts = (p: { x: number; y: number }[]) => p.map((q) => `${Math.round(q.x)},${Math.round(-q.y)}`).join(' ');
  const draw = (list: Prim[], stroke: string, sw: number) => list.map((p) => (p.t === 'text' ? '' : `<path d="${primPath(p)}" fill="${p.t === 'poly' && p.fill ? '#6f8f4e' : 'none'}" fill-opacity="0.35" stroke="${stroke}" stroke-width="${sw}"${p.dash ? ' stroke-dasharray="60 40"' : ''}/>`)).join('');
  const all: { x: number; y: number }[] = [];
  for (const f of Object.values(doc.site.features)) if (f.polygon) {
    all.push(...f.polygon);
    parts.push(`<polygon points="${pts(f.polygon)}" fill="${PREVIEW_FILL[f.kind] ?? '#e2ded6'}" stroke="#b9b4aa" stroke-width="20"/>`);
  }
  for (const r of dl.rooms) { all.push(...r.polygon); parts.push(`<polygon points="${pts(r.polygon)}" fill="${ROOM_TINT[r.fn]}"/>`); }
  for (const f of Object.values(b.furniture)) parts.push(furnitureSymbol(f).map((p) => (p.t === 'text' ? '' : `<path d="${primPath(p)}" fill="${(p.t === 'poly' || p.t === 'circle') && p.fill ? (p.fill === 'cut' ? '#5b4a3a' : p.fill.startsWith('#') ? p.fill : '#6f8f4e') : 'none'}" fill-opacity="0.4" stroke="#6f6b63" stroke-width="14"${p.dash ? ' stroke-dasharray="60 40"' : ''}/>`)).join(''));
  for (const s of Object.values(b.stairs)) parts.push(draw(stairSymbol(computeStair(s, b.levels[s.levelId], resolveRules('in-generic'))), '#4a4843', 16));
  for (const p of dl.poche) { all.push(...p.outer); parts.push(`<path d="${[p.outer, ...p.holes].map((ring) => `M${ring.map((q) => `${Math.round(q.x)} ${Math.round(-q.y)}`).join('L')}Z`).join('')}" fill="#1c1b19" fill-rule="evenodd"/>`); }
  for (const w of dl.walls) for (const o of openingsOf(b, w.id)) parts.push(draw(isDoor(o) ? doorSymbol(w, o) : windowSymbol(w, o), '#1c1b19', 18));
  if (!all.length) return '';
  const bb = bbox(all);
  const pad = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) * 0.06 + 200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bb.minX - pad} ${-(bb.maxY + pad)} ${bb.maxX - bb.minX + 2 * pad} ${bb.maxY - bb.minY + 2 * pad}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
  cache.set(key, svg);
  void def;
  return svg;
}
