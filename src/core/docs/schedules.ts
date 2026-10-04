/**
 * Schedules — door, window and room schedules, the area statement and a
 * material takeoff summary. Rows are read straight from the model (and the
 * derived rooms / takeoff), so a schedule can never drift from the drawings.
 *
 * Each schedule is exported twice: as display-ready row data (for the UI and
 * CSV) and, through `tableSvg`, as a vector table for sheets.
 */
import type { BuildingModel, Door, DoorKind, Id, ProjectDoc, Window } from '../model/types';
import { levelsSorted } from '../model/query';
import { deriveLevel, type DerivedRoom } from '../derive/level';
import { analyzeSite } from '../derive/site';
import { computeTakeoff, type QtyCategory } from '../derive/quantities';
import { resolveRules } from '../rules/rulesets';
import { getMaterial } from '../catalog/materials';
import { formatArea, formatLength, groupDigits, type UnitSystem } from '../units';
import { GREY, INK, LW, line, rect, text, textWidth } from './svg';

export interface TableColumn { key: string; label: string; align?: 'start' | 'middle' | 'end'; /** Fixed width in paper mm (else auto). */ width?: number }
export type TableRow = Record<string, string>;

// ------------------------------------------------------------- helpers

const naturalTag = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const size = (w: number, h: number, u: UnitSystem) => `${formatLength(w, u)} × ${formatLength(h, u)}`;

const DOOR_TYPE: Record<DoorKind, string> = {
  single: 'Single swing', double: 'Double swing', sliding: 'Sliding', folding: 'Folding', pocket: 'Pocket',
  pivot: 'Pivot', french: 'French (glazed)', garage: 'Garage', opening: 'Cased opening',
};
const WINDOW_TYPE: Record<Window['kind'], string> = {
  casement: 'Casement', sliding: 'Sliding', fixed: 'Fixed', double: 'Double casement', single: 'Single hung',
  bay: 'Bay', corner: 'Corner', louvre: 'Louvred vent', skylight: 'Skylight',
};
const GLAZING: Record<Window['glazing'], string> = { single: 'Single', double: 'Double (DGU)', 'low-e': 'Low-E DGU', triple: 'Triple' };

/** Map of opening id → the rooms on either side (from derived rooms). */
function openingRooms(b: BuildingModel): Map<Id, { level: string; rooms: string[] }> {
  const out = new Map<Id, { level: string; rooms: string[] }>();
  for (const l of levelsSorted(b)) {
    const dl = deriveLevel(b, l.id);
    const wallIds = new Set(dl.walls.map((w) => w.id));
    for (const o of [...Object.values(b.doors), ...Object.values(b.windows)]) if (wallIds.has(o.wallId)) out.set(o.id, { level: l.name, rooms: [] });
    const add = (r: DerivedRoom, id: Id) => { const e = out.get(id); if (e && !e.rooms.includes(r.name)) e.rooms.push(r.name); };
    for (const r of dl.rooms) { r.doorIds.forEach((id) => add(r, id)); r.windowIds.forEach((id) => add(r, id)); }
  }
  return out;
}

const roomsText = (rooms: string[]) => (rooms.length === 0 ? '—' : rooms.length === 1 ? `${rooms[0]} / Exterior` : rooms.join(' / '));

// ------------------------------------------------------------ schedules

export const DOOR_COLUMNS: TableColumn[] = [
  { key: 'tag', label: 'Tag' }, { key: 'type', label: 'Type' }, { key: 'size', label: 'W × H' },
  { key: 'material', label: 'Material' }, { key: 'level', label: 'Level' }, { key: 'rooms', label: 'Between' },
];

export function doorSchedule(doc: ProjectDoc, b: BuildingModel): TableRow[] {
  const u = doc.meta.units;
  const where = openingRooms(b);
  return Object.values(b.doors)
    .filter((d: Door) => where.has(d.id))
    .sort((a, c) => naturalTag(a.tag, c.tag))
    .map((d) => {
      const w = where.get(d.id)!;
      return {
        id: d.id, tag: d.tag, type: DOOR_TYPE[d.kind] ?? d.kind, size: size(d.width, d.height, u),
        width: formatLength(d.width, u), height: formatLength(d.height, u),
        material: d.kind === 'opening' ? '—' : getMaterial(d.materialId).name, level: w.level, rooms: roomsText(w.rooms),
        fire: d.fireRating ?? '', hardware: d.hardware ?? '',
      };
    });
}

export const WINDOW_COLUMNS: TableColumn[] = [
  { key: 'tag', label: 'Tag' }, { key: 'type', label: 'Type' }, { key: 'size', label: 'W × H' }, { key: 'sill', label: 'Sill', align: 'end' },
  { key: 'glazing', label: 'Glazing' }, { key: 'frame', label: 'Frame' }, { key: 'level', label: 'Level' }, { key: 'rooms', label: 'Room' },
];

export function windowSchedule(doc: ProjectDoc, b: BuildingModel): TableRow[] {
  const u = doc.meta.units;
  const where = openingRooms(b);
  return Object.values(b.windows)
    .filter((n) => where.has(n.id))
    .sort((a, c) => naturalTag(a.tag, c.tag))
    .map((n) => {
      const w = where.get(n.id)!;
      return {
        id: n.id, tag: n.tag, type: WINDOW_TYPE[n.kind] ?? n.kind, size: size(n.width, n.height, u),
        width: formatLength(n.width, u), height: formatLength(n.height, u), sill: formatLength(n.sill, u),
        glazing: GLAZING[n.glazing] ?? n.glazing, frame: getMaterial(n.frameMaterialId).name, level: w.level,
        rooms: w.rooms.length ? w.rooms.join(' / ') : '—', area: formatArea(n.width * n.height, u),
      };
    });
}

export const ROOM_COLUMNS: TableColumn[] = [
  { key: 'number', label: 'No.' }, { key: 'name', label: 'Room' }, { key: 'level', label: 'Level' }, { key: 'size', label: 'W × D' },
  { key: 'area', label: 'Area', align: 'end' }, { key: 'floor', label: 'Floor finish' }, { key: 'wall', label: 'Wall finish' }, { key: 'ceiling', label: 'Ceiling ht.', align: 'end' },
];

export function roomSchedule(doc: ProjectDoc, b: BuildingModel): TableRow[] {
  const u = doc.meta.units;
  const rows: TableRow[] = [];
  levelsSorted(b).forEach((l, li) => {
    const dl = deriveLevel(b, l.id);
    const rooms = [...dl.rooms].sort((a, c) => naturalTag(a.number, c.number) || c.area - a.area);
    rooms.forEach((r, i) => {
      const tag = r.tagId ? b.rooms[r.tagId] : undefined;
      rows.push({
        id: r.id, number: r.number || String((li + 1) * 100 + i + 1), name: r.name, level: l.name,
        size: r.isRect ? size(r.width, r.depth, u) : `${size(r.width, r.depth, u)} (irreg.)`,
        area: formatArea(r.area, u), floor: getMaterial(tag?.floorFinishId ?? 'vitrified').name,
        wall: getMaterial(tag?.wallFinishId ?? 'plaster-white').name, ceiling: formatLength(r.ceilingHeight, u),
      });
    });
  });
  return rows;
}

export const AREA_COLUMNS: TableColumn[] = [
  { key: 'item', label: 'Item' }, { key: 'built', label: 'Built-up area', align: 'end' }, { key: 'carpet', label: 'Carpet area', align: 'end' }, { key: 'rooms', label: 'Rooms', align: 'end' },
];

export interface AreaStatement {
  rows: TableRow[];
  total: TableRow;
  site: { label: string; value: string }[];
}

/** Built-up (gross) and carpet (net) area per level, plus plot ratios. */
export function areaStatement(doc: ProjectDoc, b: BuildingModel): AreaStatement {
  const u = doc.meta.units;
  let built = 0, carpet = 0, rooms = 0;
  const rows: TableRow[] = levelsSorted(b).map((l) => {
    const dl = deriveLevel(b, l.id);
    built += dl.grossArea; carpet += dl.netArea; rooms += dl.rooms.length;
    return { item: l.name, built: formatArea(dl.grossArea, u), carpet: formatArea(dl.netArea, u), rooms: String(dl.rooms.length) };
  });
  const total = { item: 'Total', built: formatArea(built, u), carpet: formatArea(carpet, u), rooms: String(rooms) };
  const site: AreaStatement['site'] = [];
  if (doc.site.boundary.length >= 3) {
    const a = analyzeSite(doc, b, resolveRules(doc.meta.ruleSetId, doc.ruleOverrides ?? {}));
    site.push(
      { label: 'Plot area', value: formatArea(a.plotArea, u) },
      { label: 'Ground coverage', value: `${formatArea(a.footprintArea, u)} (${(a.coverage * 100).toFixed(1)}%)` },
      { label: 'FAR / FSI', value: a.far.toFixed(2) },
      { label: 'Building height', value: formatLength(a.buildingHeight, u) },
      { label: 'Efficiency (carpet / built-up)', value: built ? `${((carpet / built) * 100).toFixed(0)}%` : '—' },
    );
  }
  return { rows, total, site };
}

export const TAKEOFF_COLUMNS: TableColumn[] = [
  { key: 'category', label: 'Category' }, { key: 'item', label: 'Item' }, { key: 'qty', label: 'Quantity', align: 'end' }, { key: 'unit', label: 'Unit' },
];

const UNIT_LABEL: Record<string, string> = { m2: 'm²', m3: 'm³', nos: 'nos', rm: 'rm' };
const CATEGORY_ORDER: QtyCategory[] = ['Concrete', 'Masonry', 'Floor finishes', 'Wall finishes', 'Exterior finishes', 'Ceilings', 'Roofing', 'Doors', 'Windows', 'Stairs', 'Landscape', 'Furniture', 'Services'];

/** Material takeoff summarised per category and item (levels merged). */
export function takeoffSummary(doc: ProjectDoc, b: BuildingModel): TableRow[] {
  const t = computeTakeoff(doc, b, resolveRules(doc.meta.ruleSetId, doc.ruleOverrides ?? {}));
  const merged = new Map<string, { category: QtyCategory; item: string; qty: number; unit: string }>();
  for (const l of t.lines) {
    if (l.category === 'Services') continue; // allowances, not measured quantities
    const key = `${l.category}|${l.item}|${l.unit}`;
    const e = merged.get(key);
    if (e) e.qty += l.quantity; else merged.set(key, { category: l.category, item: l.item, qty: l.quantity, unit: l.unit });
  }
  return [...merged.values()]
    .sort((a, c) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(c.category) || a.item.localeCompare(c.item))
    .map((e) => ({ category: e.category, item: e.item, qty: groupDigits(e.qty, e.unit === 'nos' ? 0 : e.qty < 10 ? 2 : 1), unit: UNIT_LABEL[e.unit] ?? e.unit }));
}

// --------------------------------------------------------------- table SVG

export interface TableOptions {
  title?: string;
  fontSize?: number;
  /** Stretch columns to this total width (paper mm). */
  width?: number;
  /** Bold total row drawn below a rule. */
  total?: TableRow;
  /** Note under the table. */
  note?: string;
}

export interface TableLayout { widths: number[]; rowH: number; headH: number; titleH: number; width: number; height: number }

/** Column widths and heights for a table (shared by `tableSvg` and sheet pagination). */
export function tableLayout(columns: TableColumn[], rows: TableRow[], opts: TableOptions = {}): TableLayout {
  const fs = opts.fontSize ?? 2.2;
  const padX = 1.6;
  const all = opts.total ? [...rows, opts.total] : rows;
  let widths = columns.map((c) => c.width ?? Math.max(textWidth(c.label.toUpperCase(), fs * 0.82, true), ...all.map((r) => textWidth(r[c.key] ?? '', fs))) + padX * 2);
  const natural = widths.reduce((a, w) => a + w, 0);
  if (opts.width && natural > 0) widths = widths.map((w) => (w * opts.width!) / natural);
  const rowH = fs * 2.3, headH = fs * 2.6, titleH = opts.title ? fs * 3.2 : 0;
  const width = widths.reduce((a, w) => a + w, 0);
  const height = titleH + headH + all.length * rowH + (opts.note ? fs * 2.4 : 0);
  return { widths, rowH, headH, titleH, width, height };
}

/** A minimal vector table; (0,0) is the top-left corner. */
export function tableSvg(columns: TableColumn[], rows: TableRow[], opts: TableOptions = {}): { svg: string; width: number; height: number } {
  const fs = opts.fontSize ?? 2.2;
  const L = tableLayout(columns, rows, opts);
  const padX = 1.6;
  let s = '';
  let y = 0;
  if (opts.title) { s += text(0, fs * 1.9, opts.title.toUpperCase(), { size: fs * 1.25, bold: true }); y = L.titleH; }
  const colX: number[] = [];
  let x = 0;
  for (const w of L.widths) { colX.push(x); x += w; }
  const cellX = (i: number, al?: TableColumn['align']) => (al === 'end' ? colX[i] + L.widths[i] - padX : al === 'middle' ? colX[i] + L.widths[i] / 2 : colX[i] + padX);
  // header
  columns.forEach((c, i) => { s += text(cellX(i, c.align), y + L.headH * 0.66, c.label.toUpperCase(), { size: fs * 0.82, bold: true, anchor: c.align, fill: GREY.dark }); });
  y += L.headH;
  s += line({ x: 0, y }, { x: L.width, y }, LW.heavy);
  rows.forEach((r, ri) => {
    if (ri % 2 === 1) s += rect(0, y, L.width, L.rowH, { fill: GREY.wash });
    columns.forEach((c, i) => { s += text(cellX(i, c.align), y + L.rowH * 0.68, fit(r[c.key] ?? '', L.widths[i] - padX * 2, fs), { size: fs, anchor: c.align, fill: INK }); });
    y += L.rowH;
    s += line({ x: 0, y }, { x: L.width, y }, LW.hairline, { stroke: GREY.rule });
  });
  if (opts.total) {
    s += line({ x: 0, y }, { x: L.width, y }, LW.medium);
    columns.forEach((c, i) => { s += text(cellX(i, c.align), y + L.rowH * 0.68, opts.total![c.key] ?? '', { size: fs, anchor: c.align, bold: true }); });
    y += L.rowH;
    s += line({ x: 0, y }, { x: L.width, y }, LW.medium);
  }
  if (opts.note) s += text(0, y + fs * 1.8, opts.note, { size: fs * 0.82, fill: GREY.mid });
  return { svg: `<g>${s}</g>`, width: L.width, height: L.height };
}

/** Truncate a cell with an ellipsis when it would overflow its column. */
function fit(s: string, w: number, fs: number): string {
  if (textWidth(s, fs) <= w + 0.05) return s;
  let t = s;
  while (t.length > 1 && textWidth(`${t}…`, fs) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Simple label/value list (used for site data and project data blocks). */
export function keyValueSvg(items: { label: string; value: string }[], width: number, fs = 2.2): { svg: string; width: number; height: number } {
  let s = '';
  const rowH = fs * 2.3;
  items.forEach((it, i) => {
    const y = i * rowH;
    s += text(0, y + rowH * 0.68, it.label, { size: fs, fill: GREY.mid });
    s += text(width, y + rowH * 0.68, it.value, { size: fs, anchor: 'end', bold: true });
    s += line({ x: 0, y: y + rowH }, { x: width, y: y + rowH }, LW.hairline, { stroke: GREY.rule });
  });
  return { svg: `<g>${s}</g>`, width, height: items.length * rowH };
}

