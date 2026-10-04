/**
 * Impact preview: apply proposed operations to a scratch copy and diff the
 * derived model — so every AI or automatic change states its consequences
 * ("Bedroom increases by 22 sq ft", "Design health 92 → 95") before it is applied.
 */
import type { ElementRef, ProjectDoc } from '../model/types';
import { applyOps, type OpCall } from '../ops';
import { activeBuilding, levelsSorted } from '../model/query';
import { deriveLevel } from '../derive/level';
import { validate } from '../derive/validation';
import { estimateCost } from '../derive/cost';
import { resolveRules } from '../rules/rulesets';
import { formatArea, formatMoneyCompact, MM2_PER_SQFT } from '../units';

export interface Impact {
  ok: boolean;
  error?: string;
  preview?: ProjectDoc;
  lines: string[];
  health: { before: number; after: number };
  cost: { before: number; after: number };
  changed: ElementRef[];
}

export function computeImpact(doc: ProjectDoc, ops: OpCall[]): Impact {
  const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides);
  const before = activeBuilding(doc);
  let preview: ProjectDoc;
  try {
    preview = applyOps(doc, ops, { actor: 'u-ai', role: 'owner', record: false }).doc;
  } catch (e) {
    const msg = (e as { userMessage?: string }).userMessage ?? (e as Error).message;
    return { ok: false, error: msg, lines: [], health: { before: 0, after: 0 }, cost: { before: 0, after: 0 }, changed: [] };
  }
  const after = activeBuilding(preview);
  const units = doc.meta.units;
  const lines: string[] = [];
  const changed: ElementRef[] = [];
  const roomsOf = (b: typeof before) => new Map(levelsSorted(b).flatMap((l) => deriveLevel(b, l.id).rooms).filter((r) => r.tagId).map((r) => [r.tagId!, r]));
  const rb = roomsOf(before), ra = roomsOf(after);
  const threshold = 0.5 * MM2_PER_SQFT;
  for (const [id, r] of ra) {
    const o = rb.get(id);
    if (!o) { lines.push(`${r.name} added (${formatArea(r.area, units)})`); changed.push({ kind: 'room', id }); continue; }
    const d = r.area - o.area;
    if (Math.abs(d) > threshold) { lines.push(`${r.name} ${d > 0 ? 'increases' : 'decreases'} by ${formatArea(Math.abs(d), units)}`); changed.push({ kind: 'room', id }); }
    else if (o.tagId && (before.rooms[o.tagId]?.floorFinishId !== after.rooms[o.tagId]?.floorFinishId)) changed.push({ kind: 'room', id });
  }
  for (const [id, r] of rb) if (!ra.has(id)) lines.push(`${r.name} removed`);
  const ca = [...ra.values()].reduce((s, r) => s + r.area, 0), cb = [...rb.values()].reduce((s, r) => s + r.area, 0);
  if (Math.abs(ca - cb) > threshold) lines.push(`Carpet area ${formatArea(cb, units)} → ${formatArea(ca, units)}`);
  for (const k of ['walls', 'doors', 'windows', 'stairs', 'roofs', 'furniture'] as const) {
    const nb = Object.keys(before[k]).length, na = Object.keys(after[k]).length;
    if (na !== nb) lines.push(`${na > nb ? '+' : ''}${na - nb} ${k}`);
  }
  const hb = validate(doc, before, rules), ha = validate(preview, after, rules);
  const cb2 = estimateCost(doc, before, rules).grandTotal, ca2 = estimateCost(preview, after, rules).grandTotal;
  if (Math.abs(ca2 - cb2) > 1000) lines.push(`Estimated cost ${ca2 > cb2 ? '+' : '−'}${formatMoneyCompact(Math.abs(ca2 - cb2), doc.cost.currency)}`);
  const newIssues = ha.issues.filter((i) => i.severity !== 'info' && !hb.issues.some((j) => j.id === i.id));
  const fixed = hb.issues.filter((i) => i.severity !== 'info' && !ha.issues.some((j) => j.id === i.id));
  for (const i of fixed.slice(0, 3)) lines.push(`Resolves: ${i.title}`);
  for (const i of newIssues.slice(0, 3)) lines.push(`⚠ New: ${i.title}`);
  return { ok: true, preview, lines, health: { before: hb.score, after: ha.score }, cost: { before: cb2, after: ca2 }, changed };
}
