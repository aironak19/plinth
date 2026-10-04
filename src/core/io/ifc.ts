/**
 * IFC4 export (ISO 10303-21 STEP).
 *
 * A compact but valid IFC4 Reference-View-style model: project, site, building
 * and one storey per level; walls (with Pset_WallCommon and materials), slabs,
 * flat-roof slabs / pitched roofs, parapets, columns, stairs, spaces, and doors
 * and windows set into real openings (IfcRelVoidsElement + IfcRelFillsElement).
 * Geometry is swept solids from the same derived outlines the plans use, so the
 * exported model matches the drawings. Lengths are millimetres.
 */
import type { BuildingModel, Door, DoorKind, ProjectDoc, Wall, Window } from '../model/types';
import { byLevel, levelAbove, levelsSorted, openingsOf, isDoor } from '../model/query';
import { deriveLevel } from '../derive/level';
import { computeStair } from '../derive/stairs';
import { computeRoof } from '../derive/roof';
import { resolveRules } from '../rules/rulesets';
import { getMaterial } from '../catalog/materials';
import { type Polygon, difference, ensureCCW, offsetPolygonEdges } from '../geometry/polygon';
import { type Vec2, type Vec3, add, norm, perp, rotate, scale, sub } from '../geometry/vec';

// ------------------------------------------------------------ STEP helpers

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** A new IFC GlobalId: 128 random bits compressed to 22 characters. */
export function ifcGuid(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 v4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; }
  return s;
}

/** STEP string literal (ISO 10303-21 encoding for quotes, backslashes and non-ASCII). */
export function stepString(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else if (cp <= 0xffff) out += `\\X2\\${cp.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
    else out += `\\X4\\${cp.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
  }
  return `'${out}'`;
}

/** STEP REAL: always has a decimal point, never an exponent for model-sized values. */
function real(v: number): string {
  if (!Number.isFinite(v)) return '0.';
  const r = Math.round(v * 1e6) / 1e6;
  if (r === 0) return '0.';
  const s = String(r);
  if (s.includes('e')) return r.toExponential().replace('e', 'E').replace(/^(-?\d)E/, '$1.E');
  return s.includes('.') ? s : `${s}.`;
}

const S = stepString;
const ref = (n: number) => `#${n}`;
const refs = (ns: number[]) => `(${ns.map(ref).join(',')})`;

class Step {
  private n = 0;
  readonly lines: string[] = [];
  add(e: string): number { const id = ++this.n; this.lines.push(`#${id}=${e};`); return id; }
}

const DOOR_OP: Record<DoorKind, string> = {
  single: '', double: '.DOUBLE_DOOR_SINGLE_SWING.', french: '.DOUBLE_DOOR_SINGLE_SWING.', sliding: '.SLIDING_TO_LEFT.', pocket: '.SLIDING_TO_LEFT.',
  folding: '.FOLDING_TO_LEFT.', pivot: '.USERDEFINED.', garage: '.ROLLINGUP.', opening: '.NOTDEFINED.',
};

const STAIR_TYPE: Record<string, string> = { straight: '.STRAIGHT_RUN_STAIR.', L: '.QUARTER_TURN_STAIR.', U: '.HALF_TURN_STAIR.', spiral: '.SPIRAL_STAIR.' };
const ROOF_TYPE: Record<string, string> = { gable: '.GABLE_ROOF.', hip: '.HIP_ROOF.', shed: '.SHED_ROOF.', butterfly: '.BUTTERFLY_ROOF.', mansard: '.MANSARD_ROOF.', flat: '.FLAT_ROOF.' };

function compoundAngle(deg: number): string {
  const sign = deg < 0 ? -1 : 1;
  let a = Math.abs(deg);
  const d = Math.floor(a); a = (a - d) * 60;
  const m = Math.floor(a); a = (a - m) * 60;
  const s = Math.floor(a);
  const us = Math.round((a - s) * 1e6);
  return `(${sign * d},${sign * m},${sign * s},${sign * us})`;
}

// ------------------------------------------------------------------ export

export function exportIfc(doc: ProjectDoc, b: BuildingModel): string {
  const st = new Step();
  const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides ?? {});
  const now = new Date();
  const ts = Math.floor(now.getTime() / 1000);

  // --- context, units, ownership
  const origin = st.add('IFCCARTESIANPOINT((0.,0.,0.))');
  const dirZ = st.add('IFCDIRECTION((0.,0.,1.))');
  const dirX = st.add('IFCDIRECTION((1.,0.,0.))');
  const wcs = st.add(`IFCAXIS2PLACEMENT3D(${ref(origin)},${ref(dirZ)},${ref(dirX)})`);
  const ctx = st.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ref(wcs)},$)`);
  const body = st.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ref(ctx)},$,.MODEL_VIEW.,$)`);
  const uLen = st.add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const uArea = st.add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const uVol = st.add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const uAng = st.add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = st.add(`IFCUNITASSIGNMENT(${refs([uLen, uArea, uVol, uAng])})`);
  const person = st.add(`IFCPERSON($,${S(doc.meta.architect || 'Architect')},$,$,$,$,$,$)`);
  const org = st.add(`IFCORGANIZATION($,'Plinth',$,$,$)`);
  const pao = st.add(`IFCPERSONANDORGANIZATION(${ref(person)},${ref(org)},$)`);
  const app = st.add(`IFCAPPLICATION(${ref(org)},'0.1','Plinth','plinth')`);
  const oh = ref(st.add(`IFCOWNERHISTORY(${ref(pao)},${ref(app)},$,.ADDED.,${ts},$,$,${ts})`));

  const project = st.add(`IFCPROJECT(${S(ifcGuid())},${oh},${S(doc.meta.name)},${S(doc.meta.phase ?? '')},$,$,$,(${ref(ctx)}),${ref(units)})`);

  // --- spatial structure
  const sitePl = st.add(`IFCLOCALPLACEMENT($,${ref(wcs)})`);
  const loc = doc.meta.location;
  const site = st.add(`IFCSITE(${S(ifcGuid())},${oh},'Site',${S(loc.address ?? '')},$,${ref(sitePl)},$,$,.ELEMENT.,${compoundAngle(loc.lat)},${compoundAngle(loc.lon)},0.,$,$)`);
  const bldPl = st.add(`IFCLOCALPLACEMENT(${ref(sitePl)},${ref(wcs)})`);
  const building = st.add(`IFCBUILDING(${S(ifcGuid())},${oh},${S(doc.meta.name)},$,$,${ref(bldPl)},$,$,.ELEMENT.,$,$,$)`);
  st.add(`IFCRELAGGREGATES(${S(ifcGuid())},${oh},$,$,${ref(project)},(${ref(site)}))`);
  st.add(`IFCRELAGGREGATES(${S(ifcGuid())},${oh},$,$,${ref(site)},(${ref(building)}))`);

  // --- geometry helpers
  /** Local placement translated by (x, y, z) relative to `rel`; returns a '#n' reference. */
  const placement = (rel: string, x: number, y: number, z: number): string => {
    const p = st.add(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
    const ax = st.add(`IFCAXIS2PLACEMENT3D(${ref(p)},$,$)`);
    return ref(st.add(`IFCLOCALPLACEMENT(${rel},${ref(ax)})`));
  };
  const polyline2d = (ring: Vec2[]) => {
    const pts = ring.map((p) => st.add(`IFCCARTESIANPOINT((${real(p.x)},${real(p.y)}))`));
    return st.add(`IFCPOLYLINE(${refs([...pts, pts[0]])})`);
  };
  const extrusion = (outer: Polygon, holes: Polygon[], z0: number, depth: number) => {
    const o = ensureCCW(outer);
    const prof = holes.length
      ? st.add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${ref(polyline2d(o))},${refs(holes.map((h) => polyline2d([...ensureCCW(h)].reverse())))})`)
      : st.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${ref(polyline2d(o))})`);
    const p = st.add(`IFCCARTESIANPOINT((0.,0.,${real(z0)}))`);
    const pos = st.add(`IFCAXIS2PLACEMENT3D(${ref(p)},$,$)`);
    return st.add(`IFCEXTRUDEDAREASOLID(${ref(prof)},${ref(pos)},${ref(dirZ)},${real(Math.max(1, depth))})`);
  };
  const shape = (items: number[], type = 'SweptSolid') => {
    const rep = st.add(`IFCSHAPEREPRESENTATION(${ref(body)},'Body',${S(type)},${refs(items)})`);
    return ref(st.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(rep)}))`));
  };
  const surfaceModel = (faces: Vec3[][], zOff: number) => {
    const fs = faces.map((pts) => {
      const ps = pts.map((p) => st.add(`IFCCARTESIANPOINT((${real(p.x)},${real(p.y)},${real(p.z - zOff)}))`));
      const loop = st.add(`IFCPOLYLOOP(${refs(ps)})`);
      const bound = st.add(`IFCFACEOUTERBOUND(${ref(loop)},.T.)`);
      return st.add(`IFCFACE((${ref(bound)}))`);
    });
    const cfs = st.add(`IFCCONNECTEDFACESET(${refs(fs)})`);
    return st.add(`IFCFACEBASEDSURFACEMODEL((${ref(cfs)}))`);
  };

  const storeys: number[] = [];
  const wallPsets = new Map<string, number[]>();
  const wallMaterials = new Map<string, number[]>();
  const levels = levelsSorted(b);

  levels.forEach((level, idx) => {
    const dl = deriveLevel(b, level.id);
    const above = levelAbove(b, level.id);
    const topGap = above ? above.slabThickness : 0;
    const stPl = placement(ref(bldPl), 0, 0, level.elevation);
    const storey = st.add(`IFCBUILDINGSTOREY(${S(ifcGuid())},${oh},${S(level.name)},$,$,${stPl},$,$,.ELEMENT.,${real(level.elevation)})`);
    storeys.push(storey);
    const contained: number[] = [];

    // walls, openings, doors, windows
    for (const w of dl.walls) {
      const ol = dl.outlines.get(w.id);
      if (!ol) continue;
      const h = w.height ?? level.height - topGap;
      const wPl = placement(stPl, 0, 0, w.baseOffset);
      const external = dl.exteriorWallIds.has(w.id) || w.kind === 'exterior';
      const type = w.kind === 'parapet' ? '.PARAPET.' : w.kind === 'partition' || (!external && !w.structural) ? '.PARTITIONING.' : '.STANDARD.';
      const wall = st.add(`IFCWALL(${S(ifcGuid())},${oh},${S(`${cap(w.kind)} wall`)},$,$,${wPl},${shape([extrusion(ol.quad, [], 0, h)])},${S(w.id)},${type})`);
      contained.push(wall);
      const key = `${external ? 1 : 0}|${w.structural ? 1 : 0}|${w.fireRating ?? ''}|${w.kind}`;
      (wallPsets.get(key) ?? wallPsets.set(key, []).get(key)!).push(wall);
      (wallMaterials.get(w.materialId) ?? wallMaterials.set(w.materialId, []).get(w.materialId)!).push(wall);
      for (const o of openingsOf(b, w.id)) addOpening(w, o, wall, wPl, h, contained);
    }

    // floor slab (with stair voids from the level below)
    const below = idx > 0 ? levels[idx - 1] : undefined;
    const voids = below ? byLevel(b.stairs, below.id).map((s) => computeStair(s, below, rules).footprint) : [];
    const slabs = voids.length ? difference(dl.footprint, voids) : dl.footprint.map((p) => ({ outer: p, holes: [] as Polygon[] }));
    for (const sl of slabs) {
      const slab = st.add(`IFCSLAB(${S(ifcGuid())},${oh},${S(`Slab — ${level.name}`)},$,$,${placement(stPl, 0, 0, 0)},${shape([extrusion(sl.outer, sl.holes, -level.slabThickness, level.slabThickness)])},$,${idx === 0 ? '.BASESLAB.' : '.FLOOR.'})`);
      contained.push(slab);
    }

    // columns
    for (const c of byLevel(b.columns, level.id)) {
      const poly: Polygon = c.shape === 'round'
        ? Array.from({ length: 16 }, (_, i) => ({ x: c.position.x + (Math.cos((i / 16) * Math.PI * 2) * c.width) / 2, y: c.position.y + (Math.sin((i / 16) * Math.PI * 2) * c.width) / 2 }))
        : [{ x: -c.width / 2, y: -c.depth / 2 }, { x: c.width / 2, y: -c.depth / 2 }, { x: c.width / 2, y: c.depth / 2 }, { x: -c.width / 2, y: c.depth / 2 }].map((p) => add(rotate(p, (c.rotation * Math.PI) / 180), c.position));
      contained.push(st.add(`IFCCOLUMN(${S(ifcGuid())},${oh},'Column',$,$,${placement(stPl, 0, 0, 0)},${shape([extrusion(poly, [], 0, level.height - topGap)])},$,.COLUMN.)`));
    }

    // stairs: one swept solid per step
    for (const s of byLevel(b.stairs, level.id)) {
      const info = computeStair(s, level, rules, above ? above.elevation - level.elevation : level.height);
      const items = info.steps.map((step) => {
        const zTop = step.z;
        const zBot = s.kind === 'spiral' ? zTop - 60 : step.landing ? zTop - 200 : Math.max(0, zTop - info.riser - 180);
        return extrusion(step.poly, [], zBot, zTop - zBot);
      });
      if (items.length) contained.push(st.add(`IFCSTAIR(${S(ifcGuid())},${oh},${S(`${s.kind} stair`)},$,$,${placement(stPl, 0, 0, 0)},${shape(items)},$,${STAIR_TYPE[s.kind] ?? '.NOTDEFINED.'})`));
    }

    // roofs sitting on this level
    for (const roof of byLevel(b.roofs, level.id)) {
      const info = computeRoof(roof, level, dl, rules.values.downpipeSpacing);
      const zRel = info.baseZ - level.elevation;
      if (roof.kind === 'flat') {
        for (const o of info.outline) contained.push(st.add(`IFCSLAB(${S(ifcGuid())},${oh},'Roof slab',$,$,${placement(stPl, 0, 0, 0)},${shape([extrusion(o, [], zRel - roof.thickness, roof.thickness)])},$,.ROOF.)`));
        if (roof.parapetHeight > 0) for (const fp of dl.footprint) {
          const outer = ensureCCW(fp);
          const inner = offsetPolygonEdges(outer, outer.map(() => 115));
          const par = st.add(`IFCWALL(${S(ifcGuid())},${oh},'Parapet',$,$,${placement(stPl, 0, 0, 0)},${shape([extrusion(outer, [inner], zRel, roof.parapetHeight)])},$,.PARAPET.)`);
          contained.push(par);
          (wallPsets.get('1|0||parapet') ?? wallPsets.set('1|0||parapet', []).get('1|0||parapet')!).push(par);
        }
      } else {
        const planes = info.planes.filter((p) => p.kind === 'slope' || p.kind === 'gable').map((p) => p.pts);
        if (planes.length) contained.push(st.add(`IFCROOF(${S(ifcGuid())},${oh},'Roof',$,$,${placement(stPl, 0, 0, 0)},${shape([surfaceModel(planes, level.elevation)], 'SurfaceModel')},$,${ROOF_TYPE[roof.kind] ?? '.NOTDEFINED.'})`));
      }
    }

    // spaces (aggregated into the storey)
    const spaces = dl.rooms.map((r) => st.add(
      `IFCSPACE(${S(ifcGuid())},${oh},${S(r.number || r.name)},$,$,${placement(stPl, 0, 0, 0)},${shape([extrusion(r.polygon, [], 0, r.ceilingHeight)])},${S(r.name)},.ELEMENT.,.INTERNAL.,$)`,
    ));
    if (spaces.length) st.add(`IFCRELAGGREGATES(${S(ifcGuid())},${oh},$,$,${ref(storey)},${refs(spaces)})`);
    if (contained.length) st.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${S(ifcGuid())},${oh},$,$,${refs(contained)},${ref(storey)})`);
  });
  if (storeys.length) st.add(`IFCRELAGGREGATES(${S(ifcGuid())},${oh},$,$,${ref(building)},${refs(storeys)})`);

  // property sets and materials
  for (const [key, objs] of wallPsets) {
    const [ext, load, fire, kind] = key.split('|');
    const props = [
      st.add(`IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(${ext === '1' ? '.T.' : '.F.'}),$)`),
      st.add(`IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(${load === '1' ? '.T.' : '.F.'}),$)`),
      st.add(`IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER(${S(kind)}),$)`),
    ];
    if (fire) props.push(st.add(`IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL(${S(fire)}),$)`));
    const pset = st.add(`IFCPROPERTYSET(${S(ifcGuid())},${oh},'Pset_WallCommon',$,${refs(props)})`);
    st.add(`IFCRELDEFINESBYPROPERTIES(${S(ifcGuid())},${oh},$,$,${refs(objs)},${ref(pset)})`);
  }
  for (const [matId, objs] of wallMaterials) {
    const m = getMaterial(matId);
    const mat = st.add(`IFCMATERIAL(${S(m.name)},$,${S(m.category)})`);
    st.add(`IFCRELASSOCIATESMATERIAL(${S(ifcGuid())},${oh},$,$,${refs(objs)},${ref(mat)})`);
  }

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${S(`${doc.meta.name}.ifc`)},${S(now.toISOString().slice(0, 19))},(${S(doc.meta.architect || '')}),('Plinth'),'Plinth IFC export','Plinth','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
  ];
  return [...header, ...st.lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');

  function addOpening(w: Wall, o: Door | Window, wall: number, wPl: string, wallH: number, contained: number[]) {
    const d = norm(sub(w.b, w.a)), n = perp(d);
    const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
    const P = (s: number, t: number) => add(add(w.a, scale(d, s)), scale(n, t));
    const sill = isDoor(o) ? 0 : o.sill;
    const h = Math.max(1, Math.min(o.height, wallH - 20 - sill));
    const half = w.thickness / 2 + 10;
    const oPl = placement(wPl, 0, 0, sill);
    const opening = st.add(`IFCOPENINGELEMENT(${S(ifcGuid())},${oh},${S(`Opening ${o.tag}`)},$,$,${oPl},${shape([extrusion([P(s0, -half), P(s1, -half), P(s1, half), P(s0, half)], [], 0, h)])},$,.OPENING.)`);
    st.add(`IFCRELVOIDSELEMENT(${S(ifcGuid())},${oh},$,$,${ref(wall)},${ref(opening)})`);
    let filler: number | undefined;
    if (isDoor(o)) {
      if (o.kind === 'opening') return;
      const leaf = extrusion([P(s0, -25), P(s1, -25), P(s1, 25), P(s0, 25)], [], 0, h);
      const op = DOOR_OP[o.kind] || (o.hinge === 'start' ? '.SINGLE_SWING_LEFT.' : '.SINGLE_SWING_RIGHT.');
      const user = o.kind === 'pivot' ? S('PIVOT') : '$';
      filler = st.add(`IFCDOOR(${S(ifcGuid())},${oh},${S(o.tag)},$,$,${placement(oPl, 0, 0, 0)},${shape([leaf])},${S(o.tag)},${real(o.height)},${real(o.width)},${o.kind === 'garage' ? '.GATE.' : '.DOOR.'},${op},${user})`);
    } else {
      const pane = extrusion([P(s0, -30), P(s1, -30), P(s1, 30), P(s0, 30)], [], 0, h);
      const part = o.kind === 'sliding' || o.kind === 'double' || o.kind === 'casement' ? '.DOUBLE_PANEL_VERTICAL.' : '.SINGLE_PANEL.';
      filler = st.add(`IFCWINDOW(${S(ifcGuid())},${oh},${S(o.tag)},$,$,${placement(oPl, 0, 0, 0)},${shape([pane])},${S(o.tag)},${real(o.height)},${real(o.width)},${o.kind === 'skylight' ? '.SKYLIGHT.' : '.WINDOW.'},${part},$)`);
    }
    st.add(`IFCRELFILLSELEMENT(${S(ifcGuid())},${oh},$,$,${ref(opening)},${ref(filler)})`);
    contained.push(filler);
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
