import { describe, it, expect } from 'vitest';
import { auraVilla } from '@/core/generate/auraVilla';
import { activeBuilding, levelsSorted } from '@/core/model/query';
import { drawElevation, drawPlan, drawRoofPlan, drawSection, drawSitePlan, suggestSectionCut } from '@/core/docs/drawings';
import { areaStatement, doorSchedule, roomSchedule, tableSvg, DOOR_COLUMNS, takeoffSummary, windowSchedule } from '@/core/docs/schedules';
import { buildSheetSet, renderSheet } from '@/core/docs/sheets';
import { dxfToWalls, exportDxf, parseDxf } from '@/core/io/dxf';
import { exportIfc, ifcGuid, stepString } from '@/core/io/ifc';

/** Regex sanity check that SVG markup is well-formed: balanced tags, no NaN/undefined, quoted attributes. */
function assertWellFormed(svg: string) {
  expect(svg.length).toBeGreaterThan(100);
  expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(svg))) {
    const [all, close, name, , self] = m;
    consumed += all.length;
    if (self) continue;
    if (close) expect(stack.pop()).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
  // every '<' must belong to a matched tag (text content is escaped)
  expect((svg.match(/</g) ?? []).length).toBe((svg.match(re) ?? []).length);
  expect(consumed).toBeGreaterThan(0);
}

const doc = auraVilla();
const b = activeBuilding(doc);
const levels = levelsSorted(b);

describe('drawings', () => {
  it('draws plans for every level with poché, symbols, labels and dimensions', () => {
    for (const l of levels) {
      const r = drawPlan(doc, b, l.id, { scale: 100 });
      assertWellFormed(r.svg);
      expect(r.width).toBeGreaterThan(50);
      expect(r.height).toBeGreaterThan(50);
      expect(r.svg).toContain('fill-rule="evenodd"');
      expect(r.svg).toContain('#1c1b19');
    }
    const g = drawPlan(doc, b, levels[0].id, { scale: 100 });
    expect(g.svg).toContain('LIVING ROOM');
    expect(g.svg).toContain('UP');
    expect(drawPlan(doc, b, levels[1].id, { scale: 100 }).svg).toContain('DN');
  });

  it('scales paper size inversely with the drawing scale', () => {
    const a = drawPlan(doc, b, levels[0].id, { scale: 100 });
    const c = drawPlan(doc, b, levels[0].id, { scale: 50 });
    expect(c.width - c.pad.x).toBeCloseTo(2 * (a.width - a.pad.x), 3);
    expect(a.model.w / 100 + a.pad.x).toBeCloseTo(a.width, 3);
  });

  it('draws site and roof plans', () => {
    const site = drawSitePlan(doc, b, { scale: 200 });
    assertWellFormed(site.svg);
    expect(site.svg).toContain('LAP POOL');
    expect(site.svg).toContain('SETBACK');
    const roof = drawRoofPlan(doc, b, { scale: 100 });
    assertWellFormed(roof.svg);
    expect(roof.svg).toContain('FALL');
  });

  it('projects elevations from the 3D solids, fast', () => {
    const t0 = performance.now();
    for (const d of ['north', 'south', 'east', 'west'] as const) {
      const e = drawElevation(doc, b, d, { scale: 100 });
      assertWellFormed(e.svg);
      expect(e.svg).toContain('FIRST FLOOR');
      expect(e.svg).toContain('#9fc3d6'); // glazing
      expect(e.height).toBeGreaterThan(60); // two storeys + parapet at 1:100
    }
    expect(performance.now() - t0).toBeLessThan(1200);
  });

  it('cuts sections with poché through walls, slabs and stairs', () => {
    for (const axis of ['x', 'y'] as const) {
      const at = suggestSectionCut(b, axis);
      const t0 = performance.now();
      const s = drawSection(doc, b, axis, at, { scale: 100 });
      expect(performance.now() - t0).toBeLessThan(300);
      assertWellFormed(s.svg);
      expect(s.svg).toContain('fill="#1c1b19"');
      expect(s.svg).toContain('TERRACE');
    }
  });
});

describe('schedules', () => {
  it('lists every door and window with rooms on either side', () => {
    const doors = doorSchedule(doc, b);
    expect(doors).toHaveLength(Object.keys(b.doors).length);
    expect(doors[0].tag).toBe('D-101');
    expect(doors.find((d) => d.tag === 'D-101')!.rooms).toContain('Foyer');
    const wins = windowSchedule(doc, b);
    expect(wins).toHaveLength(Object.keys(b.windows).length);
    const rooms = roomSchedule(doc, b);
    expect(rooms.length).toBeGreaterThanOrEqual(20);
    const area = areaStatement(doc, b);
    expect(area.rows).toHaveLength(levels.length);
    expect(area.site.length).toBeGreaterThan(0);
    expect(takeoffSummary(doc, b).length).toBeGreaterThan(5);
    const t = tableSvg(DOOR_COLUMNS, doors, { title: 'Door schedule' });
    assertWellFormed(t.svg);
    expect(t.height).toBeGreaterThan(doors.length * 4);
  });
});

describe('sheets', () => {
  it('builds a numbered A3 set and renders every sheet', () => {
    const set = buildSheetSet(doc, b, { size: 'A3', date: '04 Oct 2026' });
    expect(set.length).toBeGreaterThanOrEqual(9);
    const numbers = set.map((s) => s.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of ['A-000', 'A-001', 'A-101', 'A-102', 'A-201', 'A-202', 'A-301', 'A-401', 'A-601']) expect(numbers).toContain(n);
    expect(set.every((s, i) => s.index === i + 1 && s.total === set.length)).toBe(true);
    for (const sh of set) {
      const svg = renderSheet(doc, sh, b);
      assertWellFormed(svg);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297"')).toBe(true);
      expect(svg).toContain(sh.number);
      expect(svg).toContain('Aura Villa');
      expect(svg).not.toMatch(/var\(|class=|<style/);
    }
  });

  it('fits other sheet sizes', () => {
    const a1 = buildSheetSet(doc, b, { size: 'A1', date: '04 Oct 2026' });
    const a4 = buildSheetSet(doc, b, { size: 'A4', date: '04 Oct 2026' });
    const planScale = (s: typeof a1) => s.find((x) => x.number === 'A-101')!.views[0].scale!;
    expect(planScale(a1)).toBeLessThan(planScale(a4));
    expect(renderSheet(doc, a1[2], b)).toContain('width="841mm"');
  });
});

describe('DXF', () => {
  it('round-trips walls through export → parse → wall recognition', () => {
    const text = exportDxf(doc, b, levels[0].id);
    expect(text).toContain('$INSUNITS');
    expect(text.trimEnd().endsWith('EOF')).toBe(true);
    const parsed = parseDxf(text);
    expect(parsed.units).toBe('millimetres');
    expect(parsed.unitScale).toBe(1);
    for (const l of ['A-WALL', 'A-DOOR', 'A-GLAZ', 'A-FURN', 'A-STRS', 'A-AREA-IDEN', 'C-PROP']) expect(parsed.layers).toContain(l);
    const wallPolys = parsed.entities.filter((e) => e.layer === 'A-WALL');
    expect(wallPolys.length).toBeGreaterThan(0);
    expect(wallPolys.every((e) => e.closed)).toBe(true);
    const res = dxfToWalls(parsed);
    expect(res.walls.length).toBeGreaterThanOrEqual(10);
    const thick = res.walls.map((w) => w.thickness);
    expect(thick.some((t) => Math.abs(t - 230) < 5)).toBe(true);
    expect(thick.some((t) => Math.abs(t - 115) < 5)).toBe(true);
    expect(res.underlay.length).toBeGreaterThan(0); // furniture, doors, text-free lines kept as underlay
  });

  it('reads LWPOLYLINE, POLYLINE and unit headers', () => {
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'WALLS', '90', '4', '70', '1', '10', '0', '20', '0', '10', '5', '20', '0', '10', '5', '20', '4', '10', '0', '20', '4',
      '0', 'LWPOLYLINE', '8', 'WALLS', '90', '4', '70', '1', '10', '0.23', '20', '0.23', '10', '4.77', '20', '0.23', '10', '4.77', '20', '3.77', '10', '0.23', '20', '3.77',
      '0', 'POLYLINE', '8', 'SKETCH', '66', '1', '70', '0', '0', 'VERTEX', '8', 'SKETCH', '10', '1', '20', '1', '0', 'VERTEX', '8', 'SKETCH', '10', '2', '20', '2', '0', 'SEQEND',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const p = parseDxf(dxf);
    expect(p.units).toBe('metres');
    expect(p.unitScale).toBe(1000);
    expect(p.entities).toHaveLength(3);
    expect(p.entities[2].pts).toHaveLength(2);
    const r = dxfToWalls(p);
    expect(r.walls).toHaveLength(4);
    for (const w of r.walls) expect(w.thickness).toBe(230);
    // corners snap to the centre-line rectangle 115 mm in from the outer face
    const xs = r.walls.flatMap((w) => [w.a.x, w.b.x]);
    expect(Math.min(...xs)).toBe(115);
    expect(Math.max(...xs)).toBe(4885);
    expect(r.underlay).toHaveLength(1);
  });
});

describe('IFC', () => {
  it('exports a referentially complete IFC4 file', () => {
    const ifc = exportIfc(doc, b);
    expect(ifc.startsWith('ISO-10303-21;')).toBe(true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC4'));");
    expect(ifc.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
    for (const e of ['IFCPROJECT(', 'IFCSITE(', 'IFCBUILDING(', 'IFCBUILDINGSTOREY(', 'IFCWALL(', 'IFCSLAB(', 'IFCSPACE(', 'IFCDOOR(', 'IFCWINDOW(',
      'IFCOPENINGELEMENT(', 'IFCRELVOIDSELEMENT(', 'IFCRELFILLSELEMENT(', 'IFCRELCONTAINEDINSPATIALSTRUCTURE(', 'IFCRELAGGREGATES(', "'Pset_WallCommon'", 'IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)']) {
      expect(ifc).toContain(e);
    }
    const data = ifc.slice(ifc.indexOf('DATA;'), ifc.lastIndexOf('ENDSEC;'));
    const defined = new Set([...data.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
    const lines = data.split('\n').filter((l) => l.startsWith('#'));
    expect(lines.length).toBe(defined.size);
    for (const l of lines) {
      expect(l.endsWith(';')).toBe(true);
      const body = l.slice(l.indexOf('=') + 1).replace(/'(?:[^']|'')*'/g, "''");
      for (const m of body.matchAll(/#(\d+)/g)) expect(defined.has(m[1])).toBe(true);
      // balanced parentheses outside strings
      let depth = 0;
      for (const ch of body) { if (ch === '(') depth++; else if (ch === ')') depth--; expect(depth).toBeGreaterThanOrEqual(0); }
      expect(depth).toBe(0);
    }
    // products carry a placement and a representation reference, never a bare number
    for (const m of ifc.matchAll(/^#\d+=IFC(?:WALL|SLAB|DOOR|WINDOW|SPACE|COLUMN|STAIR|OPENINGELEMENT)\('[^']*',#\d+,(?:'(?:[^']|'')*'|\$),\$,\$,(#\d+|\$),(#\d+|\$),/gm)) {
      expect(m[1]).toMatch(/^#/);
      expect(m[2]).toMatch(/^#/);
    }
    expect(ifc).toMatch(/^#\d+=IFCWALL\('[^']*',#\d+,'[^']*',\$,\$,#\d+,#\d+,/m);
    const counts = (re: RegExp) => (ifc.match(re) ?? []).length;
    expect(counts(/IFCBUILDINGSTOREY\(/g)).toBe(levels.length);
    expect(counts(/IFCDOOR\(/g)).toBe(Object.values(b.doors).filter((d) => d.kind !== 'opening').length);
    expect(counts(/IFCWINDOW\(/g)).toBe(Object.keys(b.windows).length);
    expect(counts(/IFCOPENINGELEMENT\(/g)).toBe(Object.keys(b.doors).length + Object.keys(b.windows).length);
  });

  it('makes unique 22-character GlobalIds and encodes strings', () => {
    const ids = new Set(Array.from({ length: 500 }, ifcGuid));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    expect(stepString("Ronak's villa")).toBe("'Ronak''s villa'");
    expect(stepString('Café')).toBe("'Caf\\X2\\00E9\\X0\\'");
  });
});
