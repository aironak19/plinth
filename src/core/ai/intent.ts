/**
 * Architect AI — on-device intent engine.
 *
 * Understands the *structured* model (rooms, walls, materials, rules) and turns
 * natural language into model operations. It never edits silently: every change
 * is returned as a Proposal with its impact for Preview / Apply / Cancel.
 * When a Claude API key is configured, ai/claude.ts uses the same operation
 * tools; this engine remains the offline fallback.
 */
import type { BuildingModel, ElementRef, ProjectDoc, RoomFunction, StyleId } from '../model/types';
import type { OpCall } from '../ops';
import { activeBuilding, activeOption, levelsSorted, openingCenter, wallLength } from '../model/query';
import { deriveLevel, type DerivedRoom } from '../derive/level';
import { validate } from '../derive/validation';
import { analyzeSite } from '../derive/site';
import { estimateCost, materialAlternativesFor } from '../derive/cost';
import { daylightAnalysis } from '../derive/analysis';
import { resolveRules } from '../rules/rulesets';
import { MATERIALS, getMaterial } from '../catalog/materials';
import { STYLES, STYLE_BY_ID } from '../catalog/styles';
import { formatArea, formatLength, formatMoneyCompact, ft, parseLength, MM2_PER_SQFT, MM2_PER_M2 } from '../units';
import { generateSchemes, DEFAULT_PROGRAM, type Program, type Scheme, siteFromProgram } from '../generate/layout';
import { dist, sub } from '../geometry/vec';

export interface Proposal {
  kind: 'change' | 'answer' | 'options' | 'clarify';
  title: string;
  message: string;
  ops?: OpCall[];
  highlight?: ElementRef[];
  schemes?: Scheme[];
  siteOps?: OpCall[];
  suggestions?: string[];
}

interface Ctx { doc: ProjectDoc; b: BuildingModel; selection: ElementRef[]; levelId?: string }

const FN_WORDS: [RegExp, RoomFunction][] = [
  [/master( bed(room)?)?/, 'master_bedroom'], [/bed ?rooms?|guest room/, 'bedroom'], [/living|lounge|drawing room/, 'living'],
  [/dining/, 'dining'], [/kitchen/, 'kitchen'], [/powder|toilet|wc/, 'powder'], [/bath ?rooms?|washroom/, 'bathroom'],
  [/pooja|puja|prayer|mandir/, 'pooja'], [/foyer|entry|entrance hall/, 'foyer'], [/stair(case|s)?/, 'stair'], [/utility|laundry/, 'utility'],
  [/study|office/, 'study'], [/family/, 'family'], [/walk-?in|wardrobe/, 'walkin'],
];

export function allRooms(b: BuildingModel): DerivedRoom[] {
  return levelsSorted(b).flatMap((l) => deriveLevel(b, l.id).rooms);
}

/** Find the room a phrase refers to: exact name, then function word, then selection. */
export function resolveRoom(text: string, c: Ctx): DerivedRoom | undefined {
  const rooms = allRooms(c.b).filter((r) => r.tagId);
  const t = text.toLowerCase();
  const byName = rooms.filter((r) => t.includes(r.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  if (byName) return byName;
  if (/\b(this|selected) room\b/.test(t) || /\bit\b/.test(t)) {
    const sel = c.selection.find((s) => s.kind === 'room');
    if (sel) return rooms.find((r) => r.tagId === sel.id);
  }
  for (const [re, fn] of FN_WORDS) if (re.test(t)) {
    const cands = rooms.filter((r) => r.fn === fn || (fn === 'bedroom' && r.fn === 'master_bedroom' && /master/.test(t)));
    const n = t.match(/(?:bed ?room|bath(?:room)?)\s*(\d)/);
    if (n) { const m = cands.find((r) => r.name.includes(n[1])); if (m) return m; }
    if (cands.length) return cands.sort((a, b) => b.area - a.area)[0];
  }
  const sel = c.selection.find((s) => s.kind === 'room');
  return sel ? rooms.find((r) => r.tagId === sel.id) : undefined;
}

function findLength(t: string, units: ProjectDoc['meta']['units']): number | null {
  const m = t.match(/(-?\d+(?:\.\d+)?\s*(?:'\s*\d+(?:\.\d+)?\s*"?|ft|feet|foot|'|"|in(?:ch(?:es)?)?|mm|cm|m(?:et(?:er|re)s?)?)?)(?![\w])/);
  if (!m) return null;
  return parseLength(m[1].replace(/\s+/g, ' ').replace(/ (ft|feet|foot|in|inch|inches|mm|cm|m|meter|metre|meters|metres)$/, '$1'), units);
}

function findMaterial(t: string) {
  const s = t.toLowerCase();
  const scored = MATERIALS.map((m) => {
    const words = m.name.toLowerCase().replace(/[()]/g, '').split(/[\s+/,-]+/).filter((w) => w.length > 2);
    const hits = words.filter((w) => s.includes(w)).length;
    return { m, score: hits / words.length + (s.includes(m.name.toLowerCase()) ? 1 : 0) + hits * 0.1 };
  }).filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score);
  return scored[0]?.m;
}

const STYLE_RE = new RegExp(`\\b(${STYLES.map((s) => s.id).join('|')})\\b`);

export function interpret(input: string, doc: ProjectDoc, selection: ElementRef[] = [], levelId?: string): Proposal {
  const b = activeBuilding(doc);
  const c: Ctx = { doc, b, selection, levelId };
  const t = input.trim().toLowerCase();
  const units = doc.meta.units;
  const L = (mm: number) => formatLength(mm, units);
  const A = (mm2: number) => formatArea(mm2, units);
  const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides);

  if (!t) return { kind: 'clarify', title: 'Ask me anything about this design', message: '', suggestions: SUGGESTIONS };

  // ---- whole-house generation from a brief
  const plot = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|'|m)?\s*[x×*by]+\s*(\d+(?:\.\d+)?)\s*(ft|feet|'|m|meter|metre)?\s*(?:plot|site|land)?/);
  if ((/\b(create|design|generate|make|plan)\b.*\b(villa|house|home|bungalow|duplex|layout|plan)\b/.test(t) && /\bbed(room)?s?|bhk\b/.test(t)) || (plot && /\bbhk|bed/.test(t))) {
    const program = parseProgram(t);
    let site = doc.site;
    const siteOps: OpCall[] = [];
    if (plot) {
      const metric = /\bm\b|meter|metre/.test(plot[3] ?? '');
      const w = metric ? parseFloat(plot[1]) * 1000 : ft(parseFloat(plot[1]));
      const d = metric ? parseFloat(plot[2]) * 1000 : ft(parseFloat(plot[2]));
      const r = rules.values;
      site = siteFromProgram(w, d, r.frontSetback, r.sideSetback, r.rearSetback);
      siteOps.push({ type: 'site.update', params: { boundary: site.boundary, edges: site.edges } });
    }
    const schemes = generateSchemes(site, program);
    return {
      kind: 'options', title: `${schemes.length} concept schemes`,
      message: `I generated ${schemes.length} editable schemes for ${program.bedrooms} bedrooms on ${program.floors === 1 ? 'one floor' : `G+${program.floors - 1}`}${plot ? ` on a ${plot[1]} × ${plot[2]}${plot[3]?.startsWith('m') ? ' m' : ' ft'} plot` : ''}${program.pool ? ' with a pool' : ''}, entrance facing ${program.entrance}. Each one is a real model — walls, doors, windows, stairs, roof and furniture — that you can keep editing.`,
      schemes, siteOps,
    };
  }
  if (/\b(alternative|alternatives|options|variations?|other layouts?)\b/.test(t) && /\b(create|generate|give|show|make|three|3|more)\b/.test(t)) {
    const beds = allRooms(b).filter((r) => r.fn === 'bedroom' || r.fn === 'master_bedroom').length || 3;
    const floors = levelsSorted(b).filter((l) => l.elevation >= 0).length || 2;
    const has = (fn: RoomFunction) => allRooms(b).some((r) => r.fn === fn);
    const program: Program = { ...DEFAULT_PROGRAM, bedrooms: beds, floors, pooja: has('pooja'), powder: has('powder'), study: has('study'), style: activeOption(doc).style, pool: Object.values(doc.site.features).some((f) => f.kind === 'pool') };
    const schemes = generateSchemes(doc.site, program);
    return { kind: 'options', title: 'Alternative layouts', message: `Three alternatives with the same program (${beds} bedrooms, ${floors} floors) on this site. Adding one creates a new design option; your current option is untouched.`, schemes };
  }

  // ---- questions
  if (/how much|what('?s| is) the|total|used/.test(t) && /\b(floor )?area|built.?up|carpet|fsi|far\b/.test(t)) {
    const site = analyzeSite(doc, b, rules);
    const levels = levelsSorted(b).map((l) => { const d = deriveLevel(b, l.id); return `${l.name}: ${A(d.grossArea)} built-up · ${A(d.netArea)} carpet`; });
    return { kind: 'answer', title: 'Floor area', message: [`Built-up area is ${A(site.builtUpArea)} on a ${A(site.plotArea)} plot — FAR ${site.far.toFixed(2)} (max ${rules.values.maxFar}), ground coverage ${(site.coverage * 100).toFixed(1)}% (max ${(rules.values.maxCoverage * 100).toFixed(0)}%).`, ...levels].join('\n') };
  }
  const smaller = t.match(/(?:rooms?|spaces?)\s+(smaller|less|under|below|larger|bigger|over|above|more)\s+(?:than\s+)?(\d+(?:\.\d+)?)\s*(sq ?ft|sqft|square feet|m2|m²|sqm|square met(?:er|re)s?)?/);
  if (smaller) {
    const lim = parseFloat(smaller[2]) * (/m/.test(smaller[3] ?? '') && !/ft|feet/.test(smaller[3] ?? '') ? MM2_PER_M2 : units === 'metric' && !smaller[3] ? MM2_PER_M2 : MM2_PER_SQFT);
    const below = /smaller|less|under|below/.test(smaller[1]);
    const list = allRooms(b).filter((r) => r.tagId && (below ? r.area < lim : r.area > lim)).sort((x, y) => x.area - y.area);
    return { kind: 'answer', title: `${list.length} room${list.length === 1 ? '' : 's'} ${below ? 'under' : 'over'} ${A(lim)}`, message: list.length ? list.map((r) => `• ${r.name} — ${A(r.area)}`).join('\n') : 'None.', highlight: list.map((r) => ({ kind: 'room' as const, id: r.tagId! })) };
  }
  if (/\b(conflicts?|issues?|problems?|errors?|check|review|critique|health)\b/.test(t)) {
    const h = validate(doc, b, rules);
    const top = h.issues.filter((i) => i.severity !== 'info').slice(0, 8);
    return { kind: 'answer', title: `Design health ${h.score}/100`, message: top.length ? `${h.errors} error${h.errors === 1 ? '' : 's'}, ${h.warnings} warning${h.warnings === 1 ? '' : 's'}:\n${top.map((i) => `• ${i.title} — ${i.detail}`).join('\n')}\n\nOpen Design Health to preview fixes.` : 'No conflicts found. Geometry, rooms, openings, stairs and zoning all check out.', highlight: top.flatMap((i) => i.refs) };
  }
  if (/\b(cost|budget|estimate|price|expensive)\b/.test(t) && !/\b(reduce|cut|cheaper|save|lower)\b/.test(t)) {
    const e = estimateCost(doc, b, rules);
    return { kind: 'answer', title: `Estimate ${formatMoneyCompact(e.grandTotal, e.currency)}`, message: `${formatMoneyCompact(e.grandTotal, e.currency)} including margin, contingency and tax — ${formatMoneyCompact(e.perSqft, e.currency)}/sq ft built-up.\nLargest items: ${e.byCategory.slice(0, 4).map((x) => `${x.category} ${formatMoneyCompact(x.total, e.currency)}`).join(', ')}.\n${e.assumptions[0]}` };
  }
  if (/\b(reduce|cut|cheaper|save|lower)\b.*\b(cost|budget|money)\b|\bcheaper\b/.test(t)) {
    const e = estimateCost(doc, b, rules);
    const alts = materialAlternativesFor(e, doc.cost).filter((a, i, arr) => arr.findIndex((x) => x.current.id === a.current.id) === i).slice(0, 3);
    if (!alts.length) return { kind: 'answer', title: 'Already lean', message: 'I couldn’t find a cheaper like-for-like material in the library.' };
    return { kind: 'change', title: 'Value-engineering options', message: alts.map((a) => `• ${a.current.name} → ${a.alternative.name}: saves ${formatMoneyCompact(a.saving, e.currency)} (visual impact ${a.visualImpact.toLowerCase()}, durability ${a.durability.toLowerCase()})`).join('\n'), ops: alts.map((a) => ({ type: 'material.replaceGlobal', params: { from: a.current.id, to: a.alternative.id } })) };
  }
  if (/\b(daylight|light|sun|bright|dark)\b/.test(t) && /\b(how|which|show|is|are|check)\b/.test(t)) {
    const d = daylightAnalysis(doc, b).filter((x) => x.fn !== 'stair' && x.fn !== 'corridor');
    const low = d.filter((x) => x.ratio < 0.1).sort((x, y) => x.ratio - y.ratio);
    return { kind: 'answer', title: 'Daylight', message: `${d.length - low.length} of ${d.length} rooms meet a 10% glazing-to-floor ratio.${low.length ? `\nDarkest: ${low.slice(0, 5).map((x) => `${x.name} (${(x.ratio * 100).toFixed(1)}%)`).join(', ')}.` : ''}\nThis is a planning indicator, not a daylight simulation.` };
  }

  // ---- style
  const sm = t.match(STYLE_RE);
  if (sm && /\b(style|facade|façade|look|make|change|switch|convert|more|give)\b/.test(t)) {
    const st = STYLE_BY_ID[sm[1] as StyleId];
    return { kind: 'change', title: `Apply ${st.name} style`, message: `${st.summary}\nGeometry stays the same; materials, roof, windows, doors and furniture finishes change.`, ops: [{ type: 'style.apply', params: { styleId: st.id } }] };
  }

  // ---- selected wall edits: "make this wall 9 inches thick and use exposed brick"
  const selWall = selection.find((s) => s.kind === 'wall');
  if (selWall && /\b(this|selected|the) wall\b|\bthick|height|tall\b/.test(t)) {
    const w = b.walls[selWall.id];
    const patch: Record<string, unknown> = {};
    const parts: string[] = [];
    const thick = t.match(/(\d+(?:\.\d+)?\s*(?:"|in(?:ch(?:es)?)?|mm|cm))\s*(?:thick|wide)/) ?? t.match(/thick(?:ness)?\s*(?:to|of)?\s*(\d+(?:\.\d+)?\s*(?:"|in(?:ch(?:es)?)?|mm|cm))/);
    if (thick) { const v = parseLength(thick[1].replace(/\s/g, '').replace(/inches|inch/, 'in'), units); if (v) { patch.thickness = v; parts.push(`thickness ${L(w.thickness)} → ${L(v)}`); } }
    const high = t.match(/(\d+(?:\.\d+)?\s*(?:'|ft|feet|m|mm))\s*(?:high|tall)/);
    if (high) { const v = parseLength(high[1].replace(/\s/g, '').replace('feet', 'ft'), units); if (v) { patch.height = v; parts.push(`height → ${L(v)}`); } }
    const mat = findMaterial(t);
    if (mat) { if (mat.slots.includes('exterior') && w.kind === 'exterior') patch.finishExteriorId = mat.id; else if (mat.slots.includes('core')) patch.materialId = mat.id; else patch.finishInteriorId = mat.id; parts.push(mat.name); }
    if (Object.keys(patch).length) return { kind: 'change', title: 'Edit wall', message: `Wall: ${parts.join(', ')}.`, ops: [{ type: 'wall.update', params: { id: w.id, patch } }], highlight: [selWall] };
  }

  // ---- materials
  const replace = t.match(/replace (.+?) with (.+?)(?: everywhere| globally|$)/);
  if (replace) {
    const from = findMaterial(replace[1]), to = findMaterial(replace[2]);
    if (from && to) return { kind: 'change', title: 'Replace material', message: `Replace ${from.name} with ${to.name} everywhere in ${activeOption(doc).name}.`, ops: [{ type: 'material.replaceGlobal', params: { from: from.id, to: to.id } }] };
  }
  const matHit = /\b(floor|flooring|use|apply|change|make)\b/.test(t) ? findMaterial(t) : undefined;
  const roomForMat = resolveRoom(t, c);
  if (matHit && roomForMat && (matHit.slots.includes('floor') || matHit.slots.includes('wall'))) {
    const slot = /\bwalls?\b/.test(t) && matHit.slots.includes('wall') ? 'wallInterior' : matHit.slots.includes('floor') ? 'floor' : 'wallInterior';
    return { kind: 'change', title: `${matHit.name} in ${roomForMat.name}`, message: `Apply ${matHit.name} to the ${slot === 'floor' ? 'floor' : 'walls'} of ${roomForMat.name} (${A(roomForMat.area)}).`, ops: [{ type: 'material.apply', params: { refs: [{ kind: 'room', id: roomForMat.tagId }], slot, materialId: matHit.id } }], highlight: [{ kind: 'room', id: roomForMat.tagId! }] };
  }

  // ---- roof
  const roofKind = t.match(/\b(flat|gable|hip|hipped|shed|butterfly|mansard)\b.*\broof\b|\broof\b.*\b(flat|gable|hip|hipped|shed|butterfly|mansard)\b/);
  if (roofKind) {
    const kind = (roofKind[1] ?? roofKind[2]).replace('hipped', 'hip');
    const roof = Object.values(b.roofs)[0];
    if (roof) return { kind: 'change', title: `${kind[0].toUpperCase() + kind.slice(1)} roof`, message: `Change the roof to ${kind}. Ridges, hips, gutters and downpipes regenerate automatically.`, ops: [{ type: 'roof.update', params: { id: roof.id, patch: { kind, ...(kind !== 'flat' && roof.pitch < 5 ? { pitch: 25 } : {}), ...(kind === 'flat' ? { parapetHeight: 1050 } : { parapetHeight: 0 }) } } }], highlight: [{ kind: 'roof', id: roof.id }] };
  }

  // ---- add rooms: "add a powder room near the living room"
  const addRoom = t.match(/\badd (?:an? )?(powder room|powder|toilet|store(?: room)?|pooja(?: room)?|study|walk-?in(?: wardrobe)?|bathroom|bath)\b(?:.*\b(?:near|next to|beside|in|off|by)\b (.+))?/);
  if (addRoom) {
    const kind = addRoom[1];
    const fn: RoomFunction = /powder|toilet/.test(kind) ? 'powder' : /pooja/.test(kind) ? 'pooja' : /study/.test(kind) ? 'study' : /walk/.test(kind) ? 'walkin' : /bath/.test(kind) ? 'bathroom' : 'store';
    const name = { powder: 'Powder Room', pooja: 'Pooja', study: 'Study', walkin: 'Walk-in Wardrobe', bathroom: 'Bathroom', store: 'Store' }[fn as 'powder'] ?? 'Room';
    const size = fn === 'powder' ? [1500, 1800] : fn === 'study' ? [2700, 3000] : fn === 'bathroom' ? [1800, 2400] : [1500, 1500];
    const host = addRoom[2] ? resolveRoom(addRoom[2], c) : resolveRoom(t, c);
    if (!host) return { kind: 'clarify', title: 'Where should it go?', message: `Tell me which room to take the ${name.toLowerCase()} from, e.g. “add a ${name.toLowerCase()} in the living room”.` };
    if (!host.isRect) return { kind: 'clarify', title: 'Room shape', message: `${host.name} isn’t rectangular, so I can’t carve a corner from it safely. Try another room.` };
    // Pick the corner furthest from the host's doors.
    const doorPts = host.doorIds.map((id) => { const d = b.doors[id]; return openingCenter(b.walls[d.wallId], d.offset); });
    const corners = [['ne', host.bbox.maxX, host.bbox.maxY], ['nw', host.bbox.minX, host.bbox.maxY], ['se', host.bbox.maxX, host.bbox.minY], ['sw', host.bbox.minX, host.bbox.minY]] as const;
    const corner = [...corners].sort((x, y) => Math.min(...doorPts.map((p) => dist(p, { x: y[1], y: y[2] })), 1e9) - Math.min(...doorPts.map((p) => dist(p, { x: x[1], y: x[2] })), 1e9))[0][0];
    return { kind: 'change', title: `Add ${name.toLowerCase()}`, message: `Carve a ${L(size[0])} × ${L(size[1])} ${name.toLowerCase()} from the ${corner.toUpperCase()} corner of ${host.name} (away from its doors), with a door into ${host.name}.`, ops: [{ type: 'room.carve', params: { id: host.tagId, corner, w: size[0], h: size[1], name, fn } }], highlight: [{ kind: 'room', id: host.tagId! }] };
  }

  // ---- doors & windows
  const between = t.match(/\badd (?:an? )?(door|opening|sliding door)\b.*\bbetween\b (.+?) and (.+)/);
  if (between) {
    const r1 = resolveRoom(between[2], c), r2 = resolveRoom(between[3], c);
    if (r1 && r2) {
      const shared = r1.wallIds.filter((id) => r2.wallIds.includes(id)).map((id) => b.walls[id]).sort((x, y) => wallLength(y) - wallLength(x))[0];
      if (!shared) return { kind: 'answer', title: 'Not adjacent', message: `${r1.name} and ${r2.name} don’t share a wall.` };
      return { kind: 'change', title: `Door between ${r1.name} and ${r2.name}`, message: `Add a ${between[1]} in the shared wall.`, ops: [{ type: 'door.create', params: { wallId: shared.id, kind: between[1] === 'opening' ? 'opening' : between[1] === 'sliding door' ? 'sliding' : 'single' } }] };
    }
  }
  if (/\badd (?:an? |more )?(window|windows|skylight)\b/.test(t)) {
    const r = resolveRoom(t, c);
    if (r) {
      const dl = deriveLevel(b, r.levelId);
      const ext = r.wallIds.map((id) => b.walls[id]).filter((w) => dl.exteriorWallIds.has(w.id)).sort((x, y) => wallLength(y) - wallLength(x))[0];
      if (!ext) return { kind: 'answer', title: 'No outside wall', message: `${r.name} has no exterior wall for a window. A skylight needs a roof above it.` };
      const width = Math.min(wallLength(ext) - 600, Math.max(900, Math.round((r.area * 0.12) / 1500 / 50) * 50));
      return { kind: 'change', title: `Window in ${r.name}`, message: `Add a ${L(width)} window on ${r.name}’s longest outside wall.`, ops: [{ type: 'window.create', params: { wallId: ext.id, width } }], highlight: [{ kind: 'room', id: r.tagId! }] };
    }
  }

  // ---- stairs
  if (/\bstair/.test(t) && /\b(move|closer|shift|nearer)\b/.test(t)) {
    const s = Object.values(b.stairs)[0];
    if (!s) return { kind: 'answer', title: 'No stair', message: 'This design has no stair yet. Press S to add one.' };
    const ground = levelsSorted(b)[0];
    const dl = deriveLevel(b, ground.id);
    const entry = Object.values(b.doors).find((d) => dl.exteriorWallIds.has(d.wallId) && b.walls[d.wallId]?.levelId === ground.id);
    if (!entry) return { kind: 'answer', title: 'No entrance', message: 'I couldn’t find an entrance door.' };
    const e = openingCenter(b.walls[entry.wallId], entry.offset);
    const v = sub(e, s.origin);
    const amount = findLength(t, units) ?? ft(4);
    const d = Math.abs(v.x) > Math.abs(v.y) ? { x: Math.sign(v.x) * amount, y: 0 } : { x: 0, y: Math.sign(v.y) * amount };
    return { kind: 'change', title: 'Move staircase', message: `Move the stair ${L(amount)} towards the entrance (${Math.abs(d.x) > 0 ? (d.x > 0 ? 'east' : 'west') : d.y > 0 ? 'north' : 'south'}). Check the impact — walls around the stair don’t move with it.`, ops: [{ type: 'element.move', params: { refs: [{ kind: 'stair', id: s.id }], delta: d } }], highlight: [{ kind: 'stair', id: s.id }] };
  }

  // ---- rename
  const ren = t.match(/rename (.+?) (?:to|as) (.+)/);
  if (ren) {
    const r = resolveRoom(ren[1], c);
    if (r) { const name = input.trim().slice(input.toLowerCase().lastIndexOf(ren[2])).replace(/^["']|["']$/g, ''); return { kind: 'change', title: 'Rename room', message: `Rename ${r.name} to ${name}.`, ops: [{ type: 'room.update', params: { id: r.tagId, patch: { name } } }] }; }
  }

  // ---- levels
  if (/\badd (?:a |another )?(floor|level|storey|story)\b/.test(t)) {
    const n = levelsSorted(b).length;
    const names = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor'];
    const top = levelsSorted(b)[n - 1];
    return { kind: 'change', title: 'Add level', message: `Add ${names[n] ?? `Level ${n}`} on top, copying the exterior walls of ${top.name}. The roof moves up automatically.`, ops: [{ type: 'level.create', params: { name: names[n] ?? `Level ${n}`, copyExteriorFrom: top.id } }] };
  }

  // ---- resize rooms
  const resizeVerb = /\b(larger|bigger|wider|smaller|narrower|deeper|longer|shorter|increase|decrease|expand|enlarge|shrink|extend|resize|width|depth|wide|deep)\b/;
  if (resizeVerb.test(t)) {
    const r = resolveRoom(t, c);
    if (!r) return { kind: 'clarify', title: 'Which room?', message: 'Name the room (e.g. “make the master bedroom 2 ft wider”) or select it first.' };
    if (!r.isRect) return { kind: 'clarify', title: 'Room shape', message: `${r.name} isn’t a simple rectangle; drag its walls directly instead.` };
    const shrink = /\b(smaller|narrower|decrease|shrink|shorter|reduce)\b/.test(t);
    const depthWord = /\b(deeper|depth|deep|longer|length)\b/.test(t);
    const widthWord = /\b(wider|width|wide)\b/.test(t);
    const axis: 'x' | 'y' = depthWord ? 'y' : widthWord ? 'x' : r.width <= r.depth ? 'x' : 'y';
    const cur = axis === 'x' ? r.width : r.depth;
    const len = findLength(t.replace(/(bed ?room|bath)\s*\d/g, ''), units);
    let size: number;
    if (len && /\bby\b/.test(t)) size = cur + (shrink ? -len : len);
    else if (len && /\b(to|wide|deep|width|depth|=)\b/.test(t)) size = len;
    else size = cur + (shrink ? -1 : 1) * (units === 'metric' ? 600 : ft(2));
    const level = deriveLevel(b, r.levelId);
    // Grow towards whichever side is not the exterior when possible.
    const bb = r.centerLoop;
    const hi = Math.max(...bb.map((p) => p[axis])), lo = Math.min(...bb.map((p) => p[axis]));
    const extHi = r.wallIds.some((id) => level.exteriorWallIds.has(id) && Math.abs(b.walls[id].a[axis] - hi) < 5 && Math.abs(b.walls[id].b[axis] - hi) < 5);
    const extLo = r.wallIds.some((id) => level.exteriorWallIds.has(id) && Math.abs(b.walls[id].a[axis] - lo) < 5 && Math.abs(b.walls[id].b[axis] - lo) < 5);
    const anchor = extHi && !extLo ? 'max' : 'min';
    return {
      kind: 'change', title: `${shrink ? 'Shrink' : 'Enlarge'} ${r.name}`,
      message: `${r.name} ${axis === 'x' ? 'width' : 'depth'} ${L(cur)} → ${L(size)}. The ${anchor === 'min' ? (axis === 'x' ? 'east' : 'north') : axis === 'x' ? 'west' : 'south'} wall moves; neighbouring rooms, doors, windows and furniture beyond it shift with it.`,
      ops: [{ type: 'room.resize', params: { id: r.tagId, axis, size, anchor } }], highlight: [{ kind: 'room', id: r.tagId! }],
    };
  }

  // ---- fallback: material without a room → selection
  const m = findMaterial(t);
  if (m && selection.length) return { kind: 'change', title: `Apply ${m.name}`, message: `Apply ${m.name} to the selection.`, ops: [{ type: 'material.apply', params: { refs: selection, slot: m.slots.includes('floor') ? 'floor' : m.slots.includes('exterior') ? 'exterior' : 'wallInterior', materialId: m.id } }] };

  return { kind: 'clarify', title: 'I can help with that in a few ways', message: 'I work on the building model directly. Try one of these:', suggestions: SUGGESTIONS };
}

export function parseProgram(t: string): Program {
  const p: Program = { ...DEFAULT_PROGRAM };
  const beds = t.match(/(\d)\s*(?:bed(?:room)?s?|bhk)/);
  if (beds) p.bedrooms = Math.max(1, Math.min(7, parseInt(beds[1], 10)));
  else if (/\bthree\b/.test(t)) p.bedrooms = 3;
  const extra = t.match(/(\d)\s*(?:other |more |additional )?bedrooms?/g);
  if (/master bedroom/.test(t) && extra && extra.length && !/\d\s*bhk/.test(t)) {
    const n = parseInt(extra[extra.length - 1], 10);
    if (/\b4 bedroom\b/.test(t)) p.bedrooms = 4; else p.bedrooms = Math.max(p.bedrooms, n + 1);
  }
  const g = t.match(/g\s*\+\s*(\d)|ground\s*\+\s*(\d)/);
  if (g) p.floors = 1 + parseInt(g[1] ?? g[2], 10);
  else if (/single[- ]stor(e)?y|one floor|bungalow|single floor/.test(t)) p.floors = 1;
  else { const f = t.match(/(\d)\s*(?:floors|stor(?:e)?ys|levels)/); if (f) p.floors = parseInt(f[1], 10); }
  p.pooja = /pooja|puja|prayer|mandir/.test(t) && !/no pooja/.test(t);
  p.powder = /powder|guest toilet|toilet/.test(t) || p.powder;
  p.study = /study|office/.test(t);
  p.family = !/no family/.test(t);
  const car = t.match(/(\d)\s*-?\s*car/);
  p.parking = car ? parseInt(car[1], 10) : /parking|garage/.test(t) ? 2 : p.parking;
  p.pool = /pool/.test(t);
  p.garden = /garden|lawn|landscape/.test(t) || p.garden;
  const dir = t.match(/(north|south|east|west)[- ]facing|facing (north|south|east|west)|entrance (?:on|to|towards) the (north|south|east|west)/);
  if (dir) p.entrance = (dir[1] ?? dir[2] ?? dir[3]) as Program['entrance'];
  const st = t.match(STYLE_RE);
  if (st) p.style = st[1] as StyleId;
  return p;
}

export const SUGGESTIONS = [
  'Make the master bedroom 2 ft wider',
  'Add a powder room near the living room',
  'How much floor area is currently used?',
  'Show rooms smaller than 100 sq ft',
  'Find conflicts in this design',
  'Give me a more mediterranean façade',
  'Create three alternative layouts',
  'Use italian marble in the living room',
  'Reduce the construction cost',
  'Create a 4 bedroom villa on a 40 × 60 ft plot, G+1, pooja room, 2-car parking, garden, swimming pool, south-facing entrance',
];

export { getMaterial };
