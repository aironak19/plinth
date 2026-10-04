/**
 * Architect AI ↔ Claude. Claude sees a structured summary of the model and the
 * Plinth operation registry as tools. Its tool calls are *returned as a
 * proposal* (with impact preview) — never executed directly — honouring the
 * "assistive, not blindly autonomous" rule. Runs in the browser with the user's
 * own API key; the on-device engine is the fallback.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ElementRef, ProjectDoc } from '../model/types';
import { toolDefinitions, type OpCall } from '../ops';
import { activeBuilding, activeOption, levelsSorted, wallLength } from '../model/query';
import { deriveLevel } from '../derive/level';
import { analyzeSite } from '../derive/site';
import { validate } from '../derive/validation';
import { estimateCost } from '../derive/cost';
import { resolveRules } from '../rules/rulesets';
import { formatMoneyCompact } from '../units';
import type { Proposal } from './intent';

const SYSTEM = `You are Architect AI inside Plinth, a professional architectural BIM application.
You work on a structured building model (millimetres; plan x = east, y = north). You change it only by calling the provided operation tools; each call becomes a proposal the architect previews and approves, so propose complete, correct operations in one turn.
Prefer high-level operations (room_resize, room_carve, style_apply, material_apply, door_create) over raw geometry. Use exact ids from the model summary. Keep explanations short and specific, citing real numbers from the summary. For questions, answer from the summary without calling tools.
Never claim engineering certification; structural and energy remarks are conceptual.`;

function modelSummary(doc: ProjectDoc, selection: ElementRef[]): string {
  const b = activeBuilding(doc);
  const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides);
  const site = analyzeSite(doc, b, rules);
  const health = validate(doc, b, rules);
  const cost = estimateCost(doc, b, rules);
  const lines: string[] = [];
  lines.push(`Project: ${doc.meta.name}, ${doc.meta.location.city}. Units shown to user: ${doc.meta.units}. Style: ${activeOption(doc).style}. Rule set: ${rules.name}.`);
  lines.push(`Plot ${Math.round(site.plotArea / 1e6)} m², built-up ${Math.round(site.builtUpArea / 1e6)} m², FAR ${site.far.toFixed(2)} (max ${rules.values.maxFar}), coverage ${(site.coverage * 100).toFixed(1)}% (max ${rules.values.maxCoverage * 100}%).`);
  lines.push(`Design health ${health.score}/100. Estimated cost ${formatMoneyCompact(cost.grandTotal, cost.currency)}.`);
  for (const l of levelsSorted(b)) {
    const dl = deriveLevel(b, l.id);
    lines.push(`\nLevel "${l.name}" id=${l.id} elevation=${l.elevation} height=${l.height}`);
    for (const r of dl.rooms) {
      if (!r.tagId) continue;
      const t = b.rooms[r.tagId];
      lines.push(`  room id=${r.tagId} "${r.name}" fn=${r.fn} net ${Math.round(r.width)}×${Math.round(r.depth)} area=${(r.area / 1e6).toFixed(1)}m² bbox=[${Math.round(r.bbox.minX)},${Math.round(r.bbox.minY)},${Math.round(r.bbox.maxX)},${Math.round(r.bbox.maxY)}] floor=${t.floorFinishId} walls=${r.wallIds.join(',')}`);
    }
    for (const w of dl.walls) lines.push(`  wall id=${w.id} ${w.kind} (${Math.round(w.a.x)},${Math.round(w.a.y)})→(${Math.round(w.b.x)},${Math.round(w.b.y)}) len=${Math.round(wallLength(w))} t=${w.thickness}`);
  }
  for (const s of Object.values(b.stairs)) lines.push(`stair id=${s.id} ${s.kind} level=${s.levelId} origin=(${Math.round(s.origin.x)},${Math.round(s.origin.y)})`);
  for (const r of Object.values(b.roofs)) lines.push(`roof id=${r.id} ${r.kind} pitch=${r.pitch} material=${r.materialId}`);
  if (health.issues.length) lines.push(`\nOpen issues: ${health.issues.filter((i) => i.severity !== 'info').slice(0, 10).map((i) => i.title).join('; ')}`);
  if (selection.length) lines.push(`\nCurrent selection: ${selection.map((s) => `${s.kind} ${s.id}`).join(', ')}`);
  return lines.join('\n');
}

export async function askClaude(
  question: string, doc: ProjectDoc, selection: ElementRef[], apiKey: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<Proposal> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const tools = toolDefinitions((d) => !['building.replace', 'model.stretch'].includes(d.type)) as Anthropic.Beta.BetaTool[];
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools,
    tool_choice: { type: 'auto' },
    messages: [
      ...history,
      { role: 'user', content: `<model>\n${modelSummary(doc, selection)}\n</model>\n\n${question}` },
    ],
  });
  if (response.stop_reason === 'refusal') {
    return { kind: 'answer', title: 'Request declined', message: 'Claude declined this request. Try rephrasing it as a design change or question.' };
  }
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  const ops: OpCall[] = response.content
    .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    // Registry ids contain no underscores, so tool names map back 1:1 (room_resize → room.resize).
    .map((b) => ({ type: b.name.replace(/_/g, '.'), params: b.input as Record<string, unknown> }));
  if (ops.length) return { kind: 'change', title: summarise(ops), message: text || 'Proposed changes to the model.', ops };
  return { kind: 'answer', title: 'Architect AI', message: text || 'No answer.' };
}

function summarise(ops: OpCall[]): string {
  const names: Record<string, string> = { 'room.resize': 'Resize room', 'room.carve': 'Add a room', 'style.apply': 'Change style', 'material.apply': 'Apply material', 'door.create': 'Add door', 'window.create': 'Add window', 'wall.update': 'Edit wall', 'room.update': 'Edit room' };
  return ops.length === 1 ? names[ops[0].type] ?? ops[0].type : `${ops.length} model changes`;
}
