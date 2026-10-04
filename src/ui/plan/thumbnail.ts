/** Project card thumbnails are the real ground-floor plan of the model — never a stock image. */
import type { ProjectDoc } from '../../core/model/types';
import { activeBuilding, levelsSorted } from '../../core/model/query';
import { deriveLevel } from '../../core/derive/level';
import { bbox } from '../../core/geometry/polygon';
import { ROOM_TINT } from './colors';
import type { Vec2 } from '../../core/geometry/vec';

export function planThumbnail(doc: ProjectDoc, levelIndex = 0): string {
  const b = activeBuilding(doc);
  const level = levelsSorted(b)[levelIndex];
  const plot = doc.site.boundary;
  const bb = bbox(plot.length ? plot : [{ x: 0, y: 0 }, { x: 10000, y: 10000 }]);
  const pad = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) * 0.08;
  const vb = `${bb.minX - pad} ${-(bb.maxY + pad)} ${bb.maxX - bb.minX + 2 * pad} ${bb.maxY - bb.minY + 2 * pad}`;
  const pts = (p: Vec2[]) => p.map((q) => `${Math.round(q.x)},${Math.round(-q.y)}`).join(' ');
  const parts: string[] = [];
  parts.push(`<polygon points="${pts(plot)}" fill="#e7ecdc" stroke="#9a968e" stroke-width="${pad * 0.06}" stroke-dasharray="${pad * 0.3} ${pad * 0.15}"/>`);
  for (const f of Object.values(doc.site.features)) {
    if (!f.polygon) continue;
    const fill = f.kind === 'pool' ? '#9fd0dc' : f.kind === 'deck' ? '#d9c6a9' : '#dedad2';
    parts.push(`<polygon points="${pts(f.polygon)}" fill="${fill}"/>`);
  }
  if (level) {
    const dl = deriveLevel(b, level.id);
    for (const r of dl.rooms) parts.push(`<polygon points="${pts(r.polygon)}" fill="${ROOM_TINT[r.fn]}"/>`);
    for (const p of dl.poche) {
      const d = [p.outer, ...p.holes].map((ring) => `M${ring.map((q) => `${Math.round(q.x)} ${Math.round(-q.y)}`).join('L')}Z`).join('');
      parts.push(`<path d="${d}" fill="#1c1b19" fill-rule="evenodd"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
}
