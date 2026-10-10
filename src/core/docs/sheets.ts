/**
 * Sheet system — turns the model into a numbered drawing set.
 *
 * `buildSheetSet` decides *what* goes on each sheet and at which scale (fitting
 * from a fixed list of architectural scales, with one scale per family so plans
 * and elevations compare directly). `renderSheet` draws one sheet as a complete
 * standalone SVG with border, title block, view titles, north arrows and
 * graphic scales. Rendering is lazy so a 12-sheet set costs nothing until a
 * sheet is actually previewed or exported.
 */
import type { BuildingModel, Id, ProjectDoc } from '../model/types';
import { activeBuilding, levelsSorted } from '../model/query';
import { resolveRules } from '../rules/rulesets';
import {
  type DrawingResult, type ElevationDir, type SectionCut, drawElevation, drawLandscapePlan, drawPlan, drawRoofPlan, drawSection, drawSitePlan, suggestSectionCut,
} from './drawings';
import {
  AREA_COLUMNS, DOOR_COLUMNS, HARDSCAPE_COLUMNS, PLANTING_COLUMNS, ROOM_COLUMNS, TAKEOFF_COLUMNS, WINDOW_COLUMNS, type TableColumn, type TableRow,
  areaStatement, doorSchedule, hardscapeSchedule, keyValueSvg, landscapeSummary, plantingSchedule, roomSchedule, tableLayout, tableSvg, takeoffSummary, windowSchedule,
} from './schedules';
import { analyzeLandscape } from '../derive/landscape';
import { analyzeSite } from '../derive/site';
import { formatArea, formatLength } from '../units';
import { FONT, GREY, INK, LW, line, northArrow, num, rect, scaleBar, text, textWidth, wrapText } from './svg';

export type SheetSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';

/** ISO 216 sheet sizes, landscape (mm). */
export const SHEET_SIZES: Record<SheetSize, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 }, A1: { w: 841, h: 594 }, A2: { w: 594, h: 420 }, A3: { w: 420, h: 297 }, A4: { w: 297, h: 210 },
};

/** Architectural scales the auto-fit chooses from (1:n). */
export const SCALES = [50, 75, 100, 150, 200, 250, 500];

export type SheetViewKind = 'plan' | 'site' | 'landscape' | 'roof' | 'elevation' | 'section' | 'table' | 'keyvalue' | 'cover';

export interface SheetView {
  kind: SheetViewKind;
  /** View title printed under a drawing (or above a table). */
  title?: string;
  scale?: number;
  levelId?: Id;
  dir?: ElevationDir;
  axis?: 'x' | 'y';
  at?: number;
  cuts?: SectionCut[];
  columns?: TableColumn[];
  rows?: TableRow[];
  total?: TableRow;
  note?: string;
  items?: { label: string; value: string }[];
  /** Cell on the sheet, paper mm. */
  x: number; y: number; w: number; h: number;
}

export interface SheetDef {
  number: string;
  title: string;
  size: SheetSize;
  views: SheetView[];
  /** Scale shown in the title block: "1:100", "As shown" or "NTS". */
  scale: string;
  index: number;
  total: number;
  revision: string;
  date: string;
  /** Draw a north arrow in the drawing area. */
  north: boolean;
}

export interface SheetSetOptions {
  size: SheetSize;
  /** Preferred scale for floor plans (used when it fits). */
  scale?: number;
  revision?: string;
  date?: string | Date;
}

// ----------------------------------------------------------------- layout

const TITLE_BAND = 13;
const GAP = 8;
/** Row pitch of a key/value list at the default 2.2 mm text (see `keyValueSvg`). */
const KV_ROW = 2.2 * 2.3;

interface Geom { W: number; H: number; m: number; tb: number; area: { x: number; y: number; w: number; h: number } }

function geom(size: SheetSize): Geom {
  const { w: W, h: H } = SHEET_SIZES[size];
  const m = size === 'A4' ? 7 : 10;
  const tb = { A4: 50, A3: 62, A2: 68, A1: 76, A0: 86 }[size];
  const inset = size === 'A4' ? 4 : 7;
  return { W, H, m, tb, area: { x: m + inset, y: m + inset, w: W - 2 * m - tb - 2 * inset, h: H - 2 * m - 2 * inset } };
}

type Measure = Pick<DrawingResult, 'model' | 'pad'>;

/** Largest drawing (smallest 1:n) from SCALES that fits the cell; falls back to the smallest scale. */
function fitScale(m: Measure, w: number, h: number, preferred?: number): number {
  const fits = (s: number) => m.model.w / s + m.pad.x <= w + 0.01 && m.model.h / s + m.pad.y <= h - TITLE_BAND + 0.01;
  if (preferred && fits(preferred)) return preferred;
  return SCALES.find(fits) ?? SCALES[SCALES.length - 1];
}

/** Two views side by side or stacked — whichever allows the larger common scale. */
function pairLayout(a: Measure, b: Measure, area: Geom['area']): { scale: number; cells: { x: number; y: number; w: number; h: number }[] } {
  const sideW = (area.w - GAP) / 2, stackH = (area.h - GAP) / 2;
  const side = Math.max(fitScale(a, sideW, area.h), fitScale(b, sideW, area.h));
  const stack = Math.max(fitScale(a, area.w, stackH), fitScale(b, area.w, stackH));
  if (stack <= side) {
    return { scale: stack, cells: [{ x: area.x, y: area.y, w: area.w, h: stackH }, { x: area.x, y: area.y + stackH + GAP, w: area.w, h: stackH }] };
  }
  return { scale: side, cells: [{ x: area.x, y: area.y, w: sideW, h: area.h }, { x: area.x + sideW + GAP, y: area.y, w: sideW, h: area.h }] };
}

const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;

// ---------------------------------------------------------------- the set

export function buildSheetSet(doc: ProjectDoc, b: BuildingModel, opts: SheetSetOptions): SheetDef[] {
  const g = geom(opts.size);
  const A = g.area;
  const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides ?? {});
  const levels = levelsSorted(b);
  const date = typeof opts.date === 'string' ? opts.date : fmtDate(opts.date ?? new Date());
  const revision = opts.revision ?? 'P1';
  type Draft = Omit<SheetDef, 'index' | 'total' | 'revision' | 'date' | 'size'>;
  const out: Draft[] = [];
  const hasBuilding = levels.length > 0 && Object.keys(b.walls).length > 0;

  // Section cuts through the middle of the building (through the stair when possible).
  const cuts: SectionCut[] = hasBuilding
    ? [{ axis: 'x', at: suggestSectionCut(b, 'x', rules), label: 'A' }, { axis: 'y', at: suggestSectionCut(b, 'y', rules), label: 'B' }]
    : [];

  // A-000 cover (index filled in once the set is known)
  out.push({ number: 'A-000', title: 'Cover & sheet index', views: [], scale: 'NTS', north: false });

  // A-001 site plan + site data column
  if (doc.site.boundary.length >= 3) {
    const infoW = Math.min(70, A.w * 0.3);
    const cellW = A.w - infoW - GAP;
    const s = fitScale(drawSitePlan(doc, b, { scale: 100 }), cellW, A.h);
    const items: { label: string; value: string }[] = [];
    const sa = analyzeSite(doc, b, rules);
    const u = doc.meta.units;
    items.push(
      { label: 'Plot area', value: formatArea(sa.plotArea, u) },
      { label: 'Buildable area', value: formatArea(sa.buildableArea, u) },
      { label: 'Footprint', value: formatArea(sa.footprintArea, u) },
      { label: 'Ground coverage', value: `${(sa.coverage * 100).toFixed(1)}%` },
      { label: 'Built-up area', value: formatArea(sa.builtUpArea, u) },
      { label: 'FAR / FSI', value: sa.far.toFixed(2) },
      { label: 'Building height', value: formatLength(sa.buildingHeight, u) },
      { label: 'Floors', value: String(sa.floors) },
    );
    const setbacks = sa.setbacks.map((c) => ({ label: `${c.kind[0].toUpperCase()}${c.kind.slice(1)} edge ${c.edge + 1}`, value: `${formatLength(c.actual, u)} / ${formatLength(c.required, u)}${c.ok ? '' : ' !'}` }));
    out.push({
      number: 'A-001', title: 'Site plan', scale: `1:${s}`, north: false,
      views: [
        { kind: 'site', title: 'Site plan', scale: s, x: A.x, y: A.y, w: cellW, h: A.h },
        { kind: 'keyvalue', title: 'Site data', items, x: A.x + cellW + GAP, y: A.y, w: infoW, h: A.h / 2 },
        { kind: 'keyvalue', title: 'Setbacks (actual / required)', items: setbacks, x: A.x + cellW + GAP, y: A.y + 8 + items.length * 5.1 + 12, w: infoW, h: A.h / 2 },
      ],
    });
  }

  // L-series: landscape plan and schedules — only once the project has planting or site features,
  // so a bare building keeps the sheet list it always had.
  const landscapeSheets = () => {
    if (doc.site.boundary.length < 3) return;
    const la = analyzeLandscape(doc, b);
    if (!la.hasLandscape) return;
    const planting = plantingSchedule(doc, b, la);
    const keyW = planting.length ? Math.min(66, A.w * 0.26) : 0;
    const cellW = A.w - (keyW ? keyW + GAP : 0);
    const s = fitScale(drawLandscapePlan(doc, b, { scale: 100 }, la), cellW, A.h);
    const views: SheetView[] = [{ kind: 'landscape', title: 'Landscape plan', scale: s, x: A.x, y: A.y, w: cellW, h: A.h }];
    if (keyW) {
      // Plant key beside the plan; the full schedule follows on L-102.
      const fitRows = Math.max(1, Math.floor((A.h - 6) / KV_ROW) - 1);
      const shown = planting.length > fitRows ? planting.slice(0, fitRows - 1) : planting;
      const items = shown.map((r) => ({ label: r.key, value: truncate(`${r.common} · ${r.qty}`, keyW - 14, 2.2) }));
      if (shown.length < planting.length) items.push({ label: '…', value: `+ ${planting.length - shown.length} more on L-102` });
      views.push({ kind: 'keyvalue', title: 'Plant key · quantity', items, x: A.x + cellW + GAP, y: A.y, w: keyW, h: A.h });
    }
    // The plan carries its own north arrow: the sheet's usual corner is taken by the plant key.
    out.push({ number: 'L-101', title: 'Landscape plan', scale: `1:${s}`, north: false, views });

    // Remarks take whatever width the other columns leave, so the table always fits the sheet.
    const fixed = tableLayout(PLANTING_COLUMNS.filter((c) => c.key !== 'remarks'), planting).width;
    const columns = PLANTING_COLUMNS.map((c) => (c.key === 'remarks' ? { ...c, width: Math.max(24, Math.min(110, A.w - fixed - 1)) } : c));
    const blocks: TableBlock[] = [
      ...(planting.length ? [{ title: 'Planting schedule', columns, rows: planting, note: 'Sizes are mature garden sizes. Quantities include hedge plants at the stated spacing. Keys match the tags on L-101.' }] : []),
      { title: 'Hardscape schedule', columns: HARDSCAPE_COLUMNS, rows: hardscapeSchedule(doc, b, la) },
      { title: 'Landscape summary', columns: [{ key: 'label', label: 'Item' }, { key: 'value', label: 'Value', align: 'end' as const }], rows: landscapeSummary(doc, b, la), note: 'Irrigation is a planning figure for mature planting in the dry season.' },
    ];
    const pages = flowTables(blocks.filter((bl) => bl.rows.length), A);
    pages.forEach((v, i) => out.push({ number: `L-${102 + i}`, title: pages.length > 1 ? `Planting & hardscape schedule (${i + 1}/${pages.length})` : 'Planting & hardscape schedule', scale: 'NTS', north: false, views: v }));
  };

  if (!hasBuilding) landscapeSheets();

  if (hasBuilding) {
    // Floor plans: one common scale.
    const planMeasures = levels.map((l) => drawPlan(doc, b, l.id, { scale: 100, cuts }));
    const planScale = Math.max(...planMeasures.map((m) => fitScale(m, A.w, A.h, opts.scale)));
    levels.forEach((l, i) => out.push({
      number: `A-${101 + i}`, title: `${l.name} plan`, scale: `1:${planScale}`, north: true,
      views: [{ kind: 'plan', title: `${l.name} plan`, scale: planScale, levelId: l.id, cuts, x: A.x, y: A.y, w: A.w, h: A.h }],
    }));

    // Elevations: two per sheet, common scale.
    const dirs: ElevationDir[][] = [['south', 'north'], ['east', 'west']];
    const em = new Map(dirs.flat().map((d) => [d, drawElevation(doc, b, d, { scale: 100 })]));
    const pairs = dirs.map(([p, q]) => pairLayout(em.get(p)!, em.get(q)!, A));
    const elevScale = Math.max(...pairs.map((p) => p.scale));
    dirs.forEach(([p, q], i) => out.push({
      number: `A-${201 + i}`, title: `${cap(p)} & ${q} elevations`, scale: `1:${elevScale}`, north: false,
      views: [
        { kind: 'elevation', dir: p, title: `${cap(p)} elevation`, scale: elevScale, ...pairs[i].cells[0] },
        { kind: 'elevation', dir: q, title: `${cap(q)} elevation`, scale: elevScale, ...pairs[i].cells[1] },
      ],
    }));

    // Sections A-A and B-B.
    const sm = cuts.map((c) => drawSection(doc, b, c.axis, c.at, { scale: 100 }));
    const sp = pairLayout(sm[0], sm[1], A);
    out.push({
      number: 'A-301', title: 'Sections A-A & B-B', scale: `1:${sp.scale}`, north: false,
      views: cuts.map((c, i) => ({ kind: 'section' as const, axis: c.axis, at: c.at, title: `Section ${c.label}-${c.label}`, scale: sp.scale, ...sp.cells[i] })),
    });

    // Roof plan.
    if (Object.keys(b.roofs).length) {
      const s = fitScale(drawRoofPlan(doc, b, { scale: 100 }), A.w, A.h, Math.max(planScale, 50));
      out.push({ number: 'A-401', title: 'Roof plan', scale: `1:${s}`, north: true, views: [{ kind: 'roof', title: 'Roof plan', scale: s, x: A.x, y: A.y, w: A.w, h: A.h }] });
    }

    landscapeSheets();

    // Schedules flow into columns and onto as many sheets as they need.
    let n = 601;
    const flow = (title: string, blocks: TableBlock[]) => {
      const pages = flowTables(blocks, A);
      pages.forEach((views, i) => out.push({ number: `A-${n++}`, title: pages.length > 1 ? `${title} (${i + 1}/${pages.length})` : title, scale: 'NTS', north: false, views }));
    };
    flow('Door & window schedules', [
      { title: 'Door schedule', columns: DOOR_COLUMNS, rows: doorSchedule(doc, b) },
      { title: 'Window schedule', columns: WINDOW_COLUMNS, rows: windowSchedule(doc, b) },
    ]);
    const as = areaStatement(doc, b);
    flow('Room schedule & area statement', [
      { title: 'Room schedule', columns: ROOM_COLUMNS, rows: roomSchedule(doc, b) },
      { title: 'Area statement', columns: AREA_COLUMNS, rows: as.rows, total: as.total, note: 'Built-up = gross floor area to outside faces of walls · Carpet = net usable floor area.' },
      ...(as.site.length ? [{ title: 'Plot ratios', columns: [{ key: 'label', label: 'Item' }, { key: 'value', label: 'Value', align: 'end' as const }], rows: as.site.map((x) => ({ label: x.label, value: x.value })) }] : []),
    ]);
    flow('Material takeoff summary', [
      { title: 'Material takeoff', columns: TAKEOFF_COLUMNS, rows: takeoffSummary(doc, b), note: 'Measured from the model, net of openings. Indicative quantities for budgeting — not a bill of quantities.' },
    ]);
  }

  // Cover: project data, area summary and sheet index.
  const cover = out[0];
  const total = out.length;
  const leftW = A.w * 0.52;
  const as = areaStatement(doc, b);
  cover.views = [
    { kind: 'cover', x: A.x, y: A.y, w: leftW, h: 70 },
    { kind: 'table', title: 'Area statement', columns: AREA_COLUMNS, rows: as.rows, total: as.total, x: A.x, y: A.y + 78, w: leftW, h: A.h - 78 },
    { kind: 'table', title: 'Sheet index', columns: [{ key: 'no', label: 'No.' }, { key: 'title', label: 'Drawing' }, { key: 'scale', label: 'Scale' }],
      rows: out.map((s) => ({ no: s.number, title: cap(s.title), scale: s.scale })), x: A.x + leftW + GAP * 2, y: A.y, w: A.w - leftW - GAP * 2, h: A.h },
  ];
  if (as.site.length) cover.views.push({ kind: 'keyvalue', title: 'Plot', items: as.site, x: A.x, y: A.y + 78 + 14 + (as.rows.length + 1) * 5.1 + 14, w: Math.min(leftW, 110), h: 40 });
  // Key plan: the real site, so the cover locates the project at a glance.
  const indexH = tableLayout([{ key: 'no', label: 'No.' }], out.map(() => ({ no: '' })), { title: 'Sheet index' }).height;
  const kx = A.x + leftW + GAP * 2, ky = A.y + indexH + GAP * 2, kw = A.w - leftW - GAP * 2, kh = A.h - indexH - GAP * 2;
  if (doc.site.boundary.length >= 3 && kh > 70) {
    const s = fitScale(drawSitePlan(doc, b, { scale: 100 }), kw, kh);
    cover.views.push({ kind: 'site', title: 'Key plan', scale: s, x: kx, y: ky, w: kw, h: kh });
  }

  return out.map((s, i) => ({ ...s, index: i + 1, total, revision, date, size: opts.size }));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface TableBlock { title: string; columns: TableColumn[]; rows: TableRow[]; total?: TableRow; note?: string }

/** Lay tables out in columns, splitting long ones into continued chunks; returns views per page. */
function flowTables(blocks: TableBlock[], A: Geom['area']): SheetView[][] {
  const pages: SheetView[][] = [[]];
  let x = A.x, y = A.y, colW = 0;
  const newColumn = () => { x += colW + GAP * 1.5; y = A.y; colW = 0; };
  for (const bl of blocks) {
    let rows = bl.rows;
    let part = 0;
    while (part === 0 || rows.length) {
      const probe = tableLayout(bl.columns, [], { title: bl.title, total: bl.total, note: bl.note });
      let avail = A.y + A.h - y - probe.height;
      // Keep a table whole when a fresh column would hold it; never start with fewer than 3 rows.
      const whole = probe.height + rows.length * probe.rowH;
      if (y > A.y && (avail < probe.rowH * 3 || (part === 0 && whole > A.y + A.h - y && whole <= A.h))) { newColumn(); avail = A.h - probe.height; }
      const fitRows = Math.max(1, Math.floor(avail / probe.rowH));
      const chunk = rows.slice(0, fitRows);
      const last = chunk.length === rows.length;
      const L = tableLayout(bl.columns, chunk, { title: bl.title, total: last ? bl.total : undefined, note: last ? bl.note : undefined });
      if (x + L.width > A.x + A.w + 0.01 && (x > A.x)) { pages.push([]); x = A.x; y = A.y; colW = 0; continue; }
      pages[pages.length - 1].push({
        kind: 'table', title: part ? `${bl.title} (cont.)` : bl.title, columns: bl.columns, rows: chunk,
        total: last ? bl.total : undefined, note: last ? bl.note : undefined, x, y, w: L.width, h: L.height,
      });
      colW = Math.max(colW, L.width);
      y += L.height + GAP * 1.2;
      rows = rows.slice(chunk.length);
      part++;
      if (rows.length) newColumn();
      if (!bl.rows.length) break;
    }
  }
  return pages.filter((p) => p.length);
}

// ------------------------------------------------------------- rendering

export function renderSheet(doc: ProjectDoc, sheet: SheetDef, b: BuildingModel = activeBuilding(doc)): string {
  const g = geom(sheet.size);
  const { W, H, m } = g;
  let s = rect(0, 0, W, H, { fill: '#ffffff' });
  s += rect(m, m, W - 2 * m, H - 2 * m, { stroke: INK, width: LW.heavy });
  s += line({ x: W - m - g.tb, y: m }, { x: W - m - g.tb, y: H - m }, LW.medium);
  for (const v of sheet.views) s += renderView(doc, b, sheet, v);
  if (sheet.north) s += northArrow(g.area.x + g.area.w - 8, g.area.y + 9, 13, doc.site.northAngle);
  s += titleBlock(doc, sheet, g);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${s}</svg>`;
}

function renderView(doc: ProjectDoc, b: BuildingModel, sheet: SheetDef, v: SheetView): string {
  const u = doc.meta.units;
  if (v.kind === 'table') {
    const t = tableSvg(v.columns ?? [], v.rows ?? [], { title: v.title, total: v.total, note: v.note });
    return `<g transform="translate(${num(v.x)} ${num(v.y)})">${t.svg}</g>`;
  }
  if (v.kind === 'keyvalue') {
    const kv = keyValueSvg(v.items ?? [], v.w);
    return `<g transform="translate(${num(v.x)} ${num(v.y)})">${text(0, 2.7, (v.title ?? '').toUpperCase(), { size: 2.75, bold: true })}<g transform="translate(0 5)">${kv.svg}</g></g>`;
  }
  if (v.kind === 'cover') return coverBlock(doc, sheet, v);
  const scale = v.scale ?? 100;
  let d: DrawingResult;
  switch (v.kind) {
    case 'plan': d = drawPlan(doc, b, v.levelId!, { scale, cuts: v.cuts }); break;
    case 'site': d = drawSitePlan(doc, b, { scale }); break;
    case 'landscape': d = drawLandscapePlan(doc, b, { scale }); break;
    case 'roof': d = drawRoofPlan(doc, b, { scale }); break;
    case 'elevation': d = drawElevation(doc, b, v.dir ?? 'south', { scale }); break;
    default: d = drawSection(doc, b, v.axis ?? 'x', v.at ?? 0, { scale }); break;
  }
  const availH = v.h - TITLE_BAND;
  const x = v.x + Math.max(0, (v.w - d.width) / 2);
  const y = v.y + Math.max(0, (availH - d.height) / 2);
  let s = `<g transform="translate(${num(x)} ${num(y)})">${d.svg}</g>`;
  // View title: bold name, rule, scale and a graphic scale bar.
  const tx = x + Math.min(10, d.width * 0.05), ty = y + d.height + 5;
  const tw = Math.max(70, Math.min(d.width * 0.8, 150));
  s += text(tx, ty, (v.title ?? '').toUpperCase(), { size: 3.2, bold: true });
  s += line({ x: tx, y: ty + 1.6 }, { x: tx + tw, y: ty + 1.6 }, LW.light);
  s += text(tx, ty + 5.4, `SCALE 1:${scale}`, { size: 2, fill: GREY.dark });
  const bar = scaleBar(0, 0, scale, u, 32);
  s += `<g transform="translate(${num(tx + tw - bar.width)} ${num(ty + 3.2)})">${bar.svg}</g>`;
  return s;
}

function coverBlock(doc: ProjectDoc, sheet: SheetDef, v: SheetView): string {
  const meta = doc.meta;
  let s = '';
  let y = v.y + 12;
  for (const ln of wrapText(meta.name.toUpperCase(), v.w, 11, true).slice(0, 2)) { s += text(v.x, y, ln, { size: 11, bold: true }); y += 12; }
  const sub = [cap(meta.type), [meta.location.city, meta.location.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  s += text(v.x, y - 4, sub, { size: 3.6, fill: GREY.dark });
  y += 6;
  s += line({ x: v.x, y }, { x: v.x + v.w, y }, LW.light);
  const rows: [string, string][] = [
    ['Client', meta.client], ['Architect', meta.architect], ['Location', meta.location.address ?? `${meta.location.city}, ${meta.location.country}`],
    ['Phase', meta.phase], ['Status', cap(doc.stage.replace(/_/g, ' '))], ['Issue', `Rev ${sheet.revision} · ${sheet.date}`],
  ];
  y += 6;
  const colW = v.w / 2;
  rows.forEach(([k, val], i) => {
    const cx = v.x + (i % 2) * colW, cy = y + Math.floor(i / 2) * 11;
    s += text(cx, cy, k.toUpperCase(), { size: 1.9, fill: GREY.mid, bold: true });
    s += text(cx, cy + 4.4, truncate(val, colW - 4, 3), { size: 3 });
  });
  return s;
}

function truncate(s: string, w: number, size: number): string {
  if (textWidth(s, size) <= w) return s;
  let t = s;
  while (t.length > 1 && textWidth(`${t}…`, size) > w) t = t.slice(0, -1);
  return `${t}…`;
}

function titleBlock(doc: ProjectDoc, sheet: SheetDef, g: Geom): string {
  const x0 = g.W - g.m - g.tb, x1 = g.W - g.m;
  const p = 4;
  const w = g.tb - 2 * p;
  const X = x0 + p;
  const meta = doc.meta;
  let s = '';
  const label = (y: number, t: string) => text(X, y, t.toUpperCase(), { size: 1.7, fill: GREY.mid, bold: true });
  const rule = (y: number) => line({ x: x0, y }, { x: x1, y }, LW.hairline, { stroke: GREY.rule });

  // top: project
  let y = g.m + p + 2;
  s += label(y, 'Project');
  y += 5.4;
  for (const ln of wrapText(meta.name, w, 4.6, true).slice(0, 2)) { s += text(X, y, ln, { size: 4.6, bold: true }); y += 5.4; }
  s += text(X, y - 1.2, truncate([meta.location.city, meta.location.country].filter(Boolean).join(', '), w, 2.2), { size: 2.2, fill: GREY.dark });
  y += 3.5;
  s += rule(y);
  const field = (k: string, v: string) => {
    y += 4.6; s += label(y, k);
    y += 4; s += text(X, y, truncate(v, w, 2.6), { size: 2.6 });
    y += 2.6; s += rule(y);
  };
  field('Client', meta.client);
  field('Architect', meta.architect);
  field('Stage', `${meta.phase} · ${cap(doc.stage.replace(/_/g, ' '))}`);
  y += 4.6;
  s += label(y, 'Notes');
  const notes = `Dimensions in ${meta.units === 'metric' ? 'metres / millimetres' : 'feet and inches'} unless noted. Do not scale from this drawing. Verify all dimensions on site before work begins. Generated from the live model — drawings, schedules and quantities share one source.`;
  y += 1.4;
  for (const ln of wrapText(notes, w, 1.8)) { y += 2.5; s += text(X, y, ln, { size: 1.8, fill: GREY.dark }); }

  // bottom: drawing identity
  const yb = g.H - g.m;
  let by = yb - p - 2.4;
  s += text(X, by, 'Plinth', { size: 2.6, bold: true });
  s += text(x1 - p, by, 'plinth · drawing set', { size: 1.6, anchor: 'end', fill: GREY.soft });
  by -= 5;
  s += line({ x: x0, y: by }, { x: x1, y: by }, LW.light);
  by -= 4;
  s += text(X, by, sheet.number, { size: 9, bold: true });
  by -= 10.5;
  s += label(by, 'Drawing no.');
  by -= 3.2;
  s += rule(by);
  // 2×2 grid
  const cells: [string, string][] = [['Scale', sheet.scale === 'NTS' ? 'NTS' : `${sheet.scale} @ ${sheet.size}`], ['Date', sheet.date], ['Revision', sheet.revision], ['Sheet', `${sheet.index} of ${sheet.total}`]];
  const half = w / 2;
  for (let r = 1; r >= 0; r--) {
    for (let c = 0; c < 2; c++) {
      const [k, v] = cells[r * 2 + c];
      s += text(X + c * half, by - 6.6, k.toUpperCase(), { size: 1.7, fill: GREY.mid, bold: true });
      s += text(X + c * half, by - 2.2, truncate(v, half - 2, 2.5), { size: 2.5 });
    }
    by -= 9.4;
    s += rule(by);
  }
  s += line({ x: X + half - 1.5, y: by }, { x: X + half - 1.5, y: by + 18.8 }, LW.hairline, { stroke: GREY.rule });
  const titleLines = wrapText(sheet.title.toUpperCase(), w, 3.6, true).slice(0, 3);
  by -= 3;
  for (let i = titleLines.length - 1; i >= 0; i--) { s += text(X, by, titleLines[i], { size: 3.6, bold: true }); by -= 4.6; }
  s += label(by - 0.4, 'Drawing');
  s += rule(by - 4.4);
  return s;
}

/** Render a whole set (convenience for exports). */
export function renderSheetSet(doc: ProjectDoc, b: BuildingModel, opts: SheetSetOptions): { sheets: SheetDef[]; svgs: string[] } {
  const sheets = buildSheetSet(doc, b, opts);
  return { sheets, svgs: sheets.map((sh) => renderSheet(doc, sh, b)) };
}

