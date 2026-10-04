/**
 * Contextual inspector. Shows the handful of properties that matter for the
 * selection, with everything else one click away under "More properties".
 * Every field commits a typed operation, so edits are undoable and audited.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, BrickWall, Square, DoorOpen, AppWindow, Footprints, Sofa, Columns3, Triangle, LandPlot, Info } from 'lucide-react';
import { useStore } from '../../state/store';
import { useBuilding, useCost, useDoc, useHealth, useRules, useSite, useUnits, useLevels } from '../../state/derived';
import { LengthInput, NumberInput, Prop, TextInput, swatchStyle, Popover, HealthRing, relTime } from '../components';
import { MATERIALS, getMaterial, type Material } from '../../core/catalog/materials';
import { ASSET_BY_ID } from '../../core/catalog/assets';
import { deriveLevel } from '../../core/derive/level';
import { computeStair } from '../../core/derive/stairs';
import { computeRoof } from '../../core/derive/roof';
import { formatArea, formatLength, formatMoneyCompact } from '../../core/units';
import { wallLength, levelAbove } from '../../core/model/query';
import { ROOM_FUNCTIONS, ROOM_LABEL } from '../plan/colors';
import type { ElementRef, RoomFunction } from '../../core/model/types';
import type { OpCall } from '../../core/ops';

export function Inspector() {
  const selection = useStore((s) => s.selection);
  return (
    <aside className="panel right" aria-label="Inspector">
      {selection.length === 0 ? <ProjectSummary /> : selection.length === 1 ? <ElementInspector refx={selection[0]} /> : <MultiInspector refs={selection} />}
    </aside>
  );
}

function useAct() {
  const dispatch = useStore((s) => s.dispatch);
  return (ops: OpCall[]) => dispatch(ops, { keepSelection: true });
}

export function MaterialPicker({ value, slot, onPick }: { value: string; slot: Material['slots'][number]; onPick: (id: string) => void }) {
  const m = getMaterial(value);
  const options = MATERIALS.filter((x) => x.slots.includes(slot));
  return (
    <Popover align="right" anchor={<button className="mat-pick" aria-label={`Material: ${m.name}`}><span className="swatch" style={swatchStyle(m)} /><span className="grow truncate small">{m.name}</span><ChevronDown size={12} className="muted" /></button>}>
      {(close) => (
        <div style={{ width: 260, maxHeight: 320, overflow: 'auto' }}>
          {options.map((o) => (
            <button key={o.id} onClick={() => { close(); onPick(o.id); }}>
              <span className="swatch" style={swatchStyle(o)} />
              <span className="grow"><span style={{ display: 'block' }}>{o.name}</span><span className="tiny muted">₹{o.rate.toLocaleString('en-IN')}/{o.costUnit} · durability {o.durability}/5</span></span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function Head({ icon, kind, title, sub }: { icon: React.ReactNode; kind: string; title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="insp-head">
      <div className="insp-kind">{icon}{kind}</div>
      <div className="insp-title">{title}</div>
      {sub && <div className="small muted" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function More({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="more-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {open ? 'Fewer properties' : 'More properties'}</button>
      {open && <div className="props">{children}</div>}
    </>
  );
}

function ElementInspector({ refx }: { refx: ElementRef }) {
  const b = useBuilding();
  const doc = useDoc();
  const units = useUnits();
  const rules = useRules();
  const act = useAct();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = () => setTimeout(() => nameRef.current?.focus(), 30);
    window.addEventListener('plinth:rename', h);
    return () => window.removeEventListener('plinth:rename', h);
  }, []);

  if (refx.kind === 'wall' && b.walls[refx.id]) {
    const w = b.walls[refx.id];
    const lv = b.levels[w.levelId];
    const up = levelAbove(b, w.levelId);
    const h = w.height ?? lv.height - (up?.slabThickness ?? 0);
    const patch = (p: Record<string, unknown>) => act([{ type: 'wall.update', params: { id: w.id, patch: p } }]);
    return (
      <>
        <Head icon={<BrickWall size={12} />} kind="Wall" title={`${w.kind === 'exterior' ? 'Exterior' : w.kind === 'interior' ? 'Interior' : w.kind} wall`} sub={`${lv.name} · ${getMaterial(w.materialId).name}`} />
        <div className="panel-body">
          <div className="props">
            <Prop label="Length"><LengthInput value={wallLength(w)} units={units} onCommit={(mm) => act([{ type: 'wall.setLength', params: { id: w.id, length: mm } }])} /></Prop>
            <Prop label="Height"><LengthInput value={h} units={units} onCommit={(mm) => patch({ height: mm })} /></Prop>
            <Prop label="Thickness"><LengthInput value={w.thickness} units={units} onCommit={(mm) => patch({ thickness: mm })} /></Prop>
            <Prop label="Material"><MaterialPicker value={w.materialId} slot="core" onPick={(id) => patch({ materialId: id })} /></Prop>
            <Prop label={w.kind === 'exterior' ? 'Exterior' : 'Finish'}><MaterialPicker value={w.kind === 'exterior' ? w.finishExteriorId : w.finishInteriorId} slot={w.kind === 'exterior' ? 'exterior' : 'wall'} onPick={(id) => patch(w.kind === 'exterior' ? { finishExteriorId: id } : { finishInteriorId: id })} /></Prop>
            <Prop label="Structural"><select className="select" value={w.structural ? 'yes' : 'no'} onChange={(e) => patch({ structural: e.target.value === 'yes' })}><option value="yes">Yes — load bearing</option><option value="no">No</option></select></Prop>
          </div>
          <More>
            <Prop label="Type"><select className="select" value={w.kind} onChange={(e) => patch({ kind: e.target.value, thickness: e.target.value === 'exterior' ? 230 : e.target.value === 'partition' ? 75 : w.thickness })}>{['exterior', 'interior', 'partition', 'compound', 'retaining', 'parapet'].map((k) => <option key={k}>{k}</option>)}</select></Prop>
            {w.kind === 'exterior' && <Prop label="Interior finish"><MaterialPicker value={w.finishInteriorId} slot="wall" onPick={(id) => patch({ finishInteriorId: id })} /></Prop>}
            <Prop label="Base offset"><LengthInput value={w.baseOffset} units={units} onCommit={(mm) => patch({ baseOffset: mm })} /></Prop>
            <Prop label="Fire rating"><select className="select" value={w.fireRating ?? ''} onChange={(e) => patch({ fireRating: e.target.value || undefined })}><option value="">Not rated</option><option>30 min</option><option>60 min</option><option>90 min</option><option>120 min</option></select></Prop>
            <Prop label="Acoustic"><select className="select" value={w.acousticRating ?? ''} onChange={(e) => patch({ acousticRating: e.target.value || undefined })}><option value="">Not rated</option><option>STC 40</option><option>STC 45</option><option>STC 50</option><option>STC 55</option></select></Prop>
            <Prop label="Insulation"><select className="select" value={w.insulation ?? ''} onChange={(e) => patch({ insulation: e.target.value || undefined })}><option value="">None</option><option>25 mm XPS</option><option>50 mm XPS</option><option>Mineral wool 50 mm</option></select></Prop>
            <Prop label="Layers"><span className="small muted">{w.kind === 'exterior' ? `${getMaterial(w.finishExteriorId).name} · ${getMaterial(w.materialId).name} ${Math.round(w.thickness)} mm · ${getMaterial(w.finishInteriorId).name}` : `${getMaterial(w.finishInteriorId).name} · ${getMaterial(w.materialId).name} ${Math.round(w.thickness)} mm`}</span></Prop>
            <Prop label="Openings"><span className="small">{Object.values(b.doors).filter((d) => d.wallId === w.id).length} doors · {Object.values(b.windows).filter((x) => x.wallId === w.id).length} windows</span></Prop>
            <Prop label="Element ID"><code className="tiny muted">{w.id}</code></Prop>
          </More>
          <BimNote />
        </div>
      </>
    );
  }

  if (refx.kind === 'room' && b.rooms[refx.id]) {
    const t = b.rooms[refx.id];
    const dl = deriveLevel(b, t.levelId);
    const r = dl.rooms.find((x) => x.tagId === t.id);
    const patch = (p: Record<string, unknown>) => act([{ type: 'room.update', params: { id: t.id, patch: p } }]);
    const std = rules.rooms[t.fn];
    return (
      <>
        <div className="insp-head">
          <div className="insp-kind"><Square size={12} />Room {t.number && `· ${t.number}`}</div>
          <input ref={nameRef} className="input bare insp-title" style={{ fontSize: 16, fontWeight: 600, height: 32, marginTop: 2, paddingLeft: 4, marginLeft: -4 }} defaultValue={t.name} key={t.id + t.name} aria-label="Room name"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) patch({ name: v }); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <div className="small muted">{b.levels[t.levelId].name}{r ? ` · ${formatArea(r.area, units)}` : ' · not enclosed'}</div>
        </div>
        <div className="panel-body">
          {r ? (
            <div className="props">
              {r.isRect ? (
                <>
                  <Prop label="Width"><LengthInput value={r.width} units={units} onCommit={(mm) => act([{ type: 'room.resize', params: { id: t.id, axis: 'x', size: mm } }])} ariaLabel="Room width" /></Prop>
                  <Prop label="Depth"><LengthInput value={r.depth} units={units} onCommit={(mm) => act([{ type: 'room.resize', params: { id: t.id, axis: 'y', size: mm } }])} ariaLabel="Room depth" /></Prop>
                </>
              ) : <Prop label="Shape"><span className="small muted">Irregular — drag walls to reshape</span></Prop>}
              <Prop label="Area"><b className="num">{formatArea(r.area, units)}</b>{std && <span className={`chip ${r.area >= std.minArea ? 'ok' : 'warn'}`} style={{ marginLeft: 8, height: 19 }}>min {formatArea(std.minArea, units)}</span>}</Prop>
              <Prop label="Function"><select className="select" value={t.fn} onChange={(e) => patch({ fn: e.target.value as RoomFunction })}>{ROOM_FUNCTIONS.map((f) => <option key={f} value={f}>{ROOM_LABEL[f]}</option>)}</select></Prop>
              <Prop label="Floor"><MaterialPicker value={t.floorFinishId} slot="floor" onPick={(id) => patch({ floorFinishId: id })} /></Prop>
              <Prop label="Walls"><MaterialPicker value={t.wallFinishId} slot="wall" onPick={(id) => patch({ wallFinishId: id })} /></Prop>
              <Prop label="Ceiling"><LengthInput value={r.ceilingHeight} units={units} onCommit={(mm) => patch({ ceilingHeight: mm })} /></Prop>
            </div>
          ) : <div className="small" style={{ color: 'var(--warn)' }}>This room tag isn’t inside a closed loop of walls. Close the walls around it and its area appears automatically.</div>}
          <More>
            <Prop label="Number"><TextInput value={t.number} onCommit={(v) => patch({ number: v })} /></Prop>
            <Prop label="Ceiling finish"><MaterialPicker value={t.ceilingFinishId} slot="ceiling" onPick={(id) => patch({ ceilingFinishId: id })} /></Prop>
            {r && <Prop label="Perimeter"><span className="num small">{formatLength(r.perimeter, units)}</span></Prop>}
            {r && <Prop label="Openings"><span className="small">{r.doorIds.length} doors · {r.windowIds.length} windows</span></Prop>}
            {r && <Prop label="Glazing"><span className="small num">{((r.glazingArea / Math.max(1, r.area)) * 100).toFixed(1)}% of floor area</span></Prop>}
            {r && <Prop label="Wall area"><span className="small num">{formatArea(r.perimeter * r.ceilingHeight, units)} gross</span></Prop>}
          </More>
        </div>
      </>
    );
  }

  if ((refx.kind === 'door' && b.doors[refx.id]) || (refx.kind === 'window' && b.windows[refx.id])) {
    const isD = refx.kind === 'door';
    const o = isD ? b.doors[refx.id] : b.windows[refx.id];
    const w = b.walls[o.wallId];
    const type = isD ? 'door.update' : 'window.update';
    const patch = (p: Record<string, unknown>) => act([{ type, params: { id: o.id, patch: p } }]);
    const kinds = isD ? ['single', 'double', 'sliding', 'folding', 'pocket', 'pivot', 'french', 'garage', 'opening'] : ['casement', 'sliding', 'fixed', 'double', 'single', 'bay', 'corner', 'louvre', 'skylight'];
    return (
      <>
        <Head icon={isD ? <DoorOpen size={12} /> : <AppWindow size={12} />} kind={isD ? 'Door' : 'Window'} title={o.tag} sub={`${o.kind} · in ${w?.kind ?? ''} wall`} />
        <div className="panel-body">
          <div className="props">
            <Prop label="Type"><select className="select" value={o.kind} onChange={(e) => patch({ kind: e.target.value })}>{kinds.map((k) => <option key={k}>{k}</option>)}</select></Prop>
            <Prop label="Width"><LengthInput value={o.width} units={units} onCommit={(mm) => patch({ width: mm })} /></Prop>
            <Prop label="Height"><LengthInput value={o.height} units={units} onCommit={(mm) => patch({ height: mm })} /></Prop>
            {!isD && <Prop label="Sill"><LengthInput value={(o as typeof b.windows[string]).sill} units={units} onCommit={(mm) => patch({ sill: mm })} /></Prop>}
            {isD && <Prop label="Swing"><select className="select" value={`${(o as typeof b.doors[string]).side}-${(o as typeof b.doors[string]).hinge}`} onChange={(e) => { const [side, hinge] = e.target.value.split('-'); patch({ side, hinge }); }}><option value="left-start">Left side · hinge start</option><option value="left-end">Left side · hinge end</option><option value="right-start">Right side · hinge start</option><option value="right-end">Right side · hinge end</option></select></Prop>}
            <Prop label={isD ? 'Material' : 'Frame'}><MaterialPicker value={isD ? (o as typeof b.doors[string]).materialId : (o as typeof b.windows[string]).frameMaterialId} slot={isD ? 'door' : 'frame'} onPick={(id) => patch(isD ? { materialId: id } : { frameMaterialId: id })} /></Prop>
          </div>
          <More>
            <Prop label="Tag"><TextInput value={o.tag} onCommit={(v) => patch({ tag: v })} /></Prop>
            <Prop label="Position"><LengthInput value={o.offset} units={units} onCommit={(mm) => patch({ offset: mm })} /></Prop>
            {isD && <Prop label="Swing angle"><NumberInput value={(o as typeof b.doors[string]).swingAngle} suffix="°" onCommit={(v) => patch({ swingAngle: Math.max(10, Math.min(180, v)) })} /></Prop>}
            {isD && <Prop label="Fire rating"><select className="select" value={(o as typeof b.doors[string]).fireRating ?? ''} onChange={(e) => patch({ fireRating: e.target.value || undefined })}><option value="">Not rated</option><option>FD30</option><option>FD60</option></select></Prop>}
            {isD && <Prop label="Hardware"><select className="select" value={(o as typeof b.doors[string]).hardware ?? ''} onChange={(e) => patch({ hardware: e.target.value || undefined })}><option value="">Standard lever</option><option>Smart lock</option><option>Pull handle</option><option>Concealed</option></select></Prop>}
            {!isD && <Prop label="Glazing"><select className="select" value={(o as typeof b.windows[string]).glazing} onChange={(e) => patch({ glazing: e.target.value })}><option value="single">Single</option><option value="double">Double</option><option value="low-e">Low-E double</option><option value="triple">Triple</option></select></Prop>}
            <Prop label="Area"><span className="small num">{formatArea(o.width * o.height, units)}</span></Prop>
          </More>
        </div>
      </>
    );
  }

  if (refx.kind === 'stair' && b.stairs[refx.id]) {
    const st = b.stairs[refx.id];
    const lv = b.levels[st.levelId];
    const up = levelAbove(b, st.levelId);
    const info = computeStair(st, lv, rules, up ? up.elevation - lv.elevation : lv.height);
    const patch = (p: Record<string, unknown>) => act([{ type: 'stair.update', params: { id: st.id, patch: p } }]);
    return (
      <>
        <Head icon={<Footprints size={12} />} kind="Stair" title={`${st.kind === 'U' ? 'U-shaped' : st.kind === 'L' ? 'L-shaped' : st.kind[0].toUpperCase() + st.kind.slice(1)} stair`} sub={`${lv.name} → ${up?.name ?? 'nowhere'}`} />
        <div className="panel-body">
          <div className="props">
            <Prop label="Type"><select className="select" value={st.kind} onChange={(e) => patch({ kind: e.target.value })}>{['straight', 'L', 'U', 'spiral'].map((k) => <option key={k}>{k}</option>)}</select></Prop>
            <Prop label="Width"><LengthInput value={st.width} units={units} onCommit={(mm) => patch({ width: mm })} /></Prop>
            <Prop label="Tread"><LengthInput value={st.tread} units={units} onCommit={(mm) => patch({ tread: mm })} /></Prop>
            <Prop label="Max riser"><LengthInput value={st.targetRiser} units={units} onCommit={(mm) => patch({ targetRiser: mm })} /></Prop>
          </div>
          <div className="card" style={{ padding: 12, marginTop: 10, boxShadow: 'none' }}>
            <div className="caps" style={{ marginBottom: 6 }}>Calculated</div>
            <div className="grid g2" style={{ gap: 6 }}>
              <div><div className="tiny muted">Risers</div><b className="num">{info.risers} × {Math.round(info.riser)} mm</b></div>
              <div><div className="tiny muted">Treads</div><b className="num">{info.treads} × {Math.round(info.tread)} mm</b></div>
              <div><div className="tiny muted">Total rise</div><b className="num">{formatLength(info.totalRise, units)}</b></div>
              <div><div className="tiny muted">Slope · 2R+T</div><b className="num">{info.slope.toFixed(1)}° · {Math.round(info.blondel)}</b></div>
            </div>
            {info.warnings.map((w) => <div key={w.code} className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>⚠ {w.message}</div>)}
            {!info.warnings.length && <div className="small" style={{ color: 'var(--ok)', marginTop: 8 }}>✓ Within {rules.name} limits</div>}
          </div>
          <More>
            <Prop label="Rotation"><NumberInput value={st.rotation} suffix="°" onCommit={(v) => patch({ rotation: v })} /></Prop>
            <Prop label="Mirrored"><select className="select" value={st.mirrored ? 'y' : 'n'} onChange={(e) => patch({ mirrored: e.target.value === 'y' })}><option value="n">No</option><option value="y">Yes</option></select></Prop>
            <Prop label="Finish"><MaterialPicker value={st.materialId} slot="floor" onPick={(id) => patch({ materialId: id })} /></Prop>
          </More>
        </div>
      </>
    );
  }

  if (refx.kind === 'roof' && b.roofs[refx.id]) {
    const rf = b.roofs[refx.id];
    const lv = b.levels[rf.levelId];
    const info = computeRoof(rf, lv, deriveLevel(b, lv.id), rules.values.downpipeSpacing);
    const patch = (p: Record<string, unknown>) => act([{ type: 'roof.update', params: { id: rf.id, patch: p } }]);
    return (
      <>
        <Head icon={<Triangle size={12} />} kind="Roof" title={`${rf.kind[0].toUpperCase() + rf.kind.slice(1)} roof`} sub={`On ${lv.name}`} />
        <div className="panel-body">
          <div className="props">
            <Prop label="Type"><select className="select" value={rf.kind} onChange={(e) => patch({ kind: e.target.value, ...(e.target.value === 'flat' ? { parapetHeight: 1050 } : { parapetHeight: 0, pitch: rf.pitch < 5 ? 25 : rf.pitch }) })}>{['flat', 'gable', 'hip', 'shed', 'butterfly', 'mansard'].map((k) => <option key={k}>{k}</option>)}</select></Prop>
            {rf.kind !== 'flat' && <Prop label="Pitch"><NumberInput value={rf.pitch} suffix="°" onCommit={(v) => patch({ pitch: Math.max(2, Math.min(60, v)) })} /></Prop>}
            <Prop label="Overhang"><LengthInput value={rf.overhang} units={units} onCommit={(mm) => patch({ overhang: mm })} /></Prop>
            {rf.kind === 'flat' && <Prop label="Parapet"><LengthInput value={rf.parapetHeight} units={units} onCommit={(mm) => patch({ parapetHeight: mm })} /></Prop>}
            {(rf.kind === 'gable' || rf.kind === 'shed' || rf.kind === 'butterfly') && <Prop label="Ridge along"><select className="select" value={rf.ridgeAxis} onChange={(e) => patch({ ridgeAxis: e.target.value })}><option value="x">East–west</option><option value="y">North–south</option></select></Prop>}
            <Prop label="Material"><MaterialPicker value={rf.materialId} slot="roof" onPick={(id) => patch({ materialId: id })} /></Prop>
          </div>
          <div className="card" style={{ padding: 12, marginTop: 10, boxShadow: 'none' }}>
            <div className="caps" style={{ marginBottom: 6 }}>Generated</div>
            <div className="grid g2" style={{ gap: 6 }} >
              <div><div className="tiny muted">Roof area</div><b className="num">{formatArea(info.slopedArea, units)}</b></div>
              <div><div className="tiny muted">Ridge / hips</div><b className="num">{formatLength(info.ridgeLength, units)} / {formatLength(info.hipLength, units)}</b></div>
              <div><div className="tiny muted">Valleys</div><b className="num">{formatLength(info.valleyLength, units)}</b></div>
              <div><div className="tiny muted">Gutters · downpipes</div><b className="num">{formatLength(info.gutterLength, units)} · {info.downpipes}</b></div>
            </div>
            {info.notes.map((n) => <div key={n} className="tiny muted" style={{ marginTop: 6 }}>{n}</div>)}
          </div>
        </div>
      </>
    );
  }

  if (refx.kind === 'furniture' && b.furniture[refx.id]) {
    const f = b.furniture[refx.id];
    const a = ASSET_BY_ID[f.assetId];
    const patch = (p: Record<string, unknown>) => act([{ type: 'furniture.update', params: { id: f.id, patch: p } }]);
    const size = f.size ?? a.size;
    return (
      <>
        <Head icon={<Sofa size={12} />} kind={a.category} title={a.name} sub={`${a.manufacturer} · ${a.sku}`} />
        <div className="panel-body">
          <div className="props">
            <Prop label="Rotation"><NumberInput value={f.rotation} suffix="°" onCommit={(v) => patch({ rotation: v })} /></Prop>
            <Prop label="Width"><LengthInput value={size.w} units={units} onCommit={(mm) => patch({ size: { ...size, w: mm } })} /></Prop>
            <Prop label="Depth"><LengthInput value={size.d} units={units} onCommit={(mm) => patch({ size: { ...size, d: mm } })} /></Prop>
            <Prop label="Variant"><select className="select" value={f.variant ?? a.variants[0]?.id} onChange={(e) => patch({ variant: e.target.value })}>{a.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Prop>
          </div>
          <More>
            <Prop label="Height"><LengthInput value={size.h} units={units} onCommit={(mm) => patch({ size: { ...size, h: mm } })} /></Prop>
            <Prop label="Upholstery"><MaterialPicker value={f.materialId ?? 'linen'} slot="furniture" onPick={(id) => patch({ materialId: id })} /></Prop>
            <Prop label="Library"><span className="small">{a.library} · {a.tags.join(', ')}</span></Prop>
            {a.price > 0 && <Prop label="Budget"><span className="small num">₹{a.price.toLocaleString('en-IN')}</span></Prop>}
          </More>
        </div>
      </>
    );
  }

  if (refx.kind === 'column' && b.columns[refx.id]) {
    const c = b.columns[refx.id];
    const patch = (p: Record<string, unknown>) => act([{ type: 'column.update', params: { id: c.id, patch: p } }]);
    return (
      <>
        <Head icon={<Columns3 size={12} />} kind="Column" title={`${c.shape === 'round' ? 'Round' : 'Rectangular'} column`} sub={`${b.levels[c.levelId]?.name} · ${getMaterial(c.materialId).name}`} />
        <div className="panel-body">
          <div className="props">
            <Prop label="Shape"><select className="select" value={c.shape} onChange={(e) => patch({ shape: e.target.value })}><option value="rect">Rectangular</option><option value="round">Round</option></select></Prop>
            <Prop label="Width"><LengthInput value={c.width} units={units} onCommit={(mm) => patch({ width: mm })} /></Prop>
            {c.shape === 'rect' && <Prop label="Depth"><LengthInput value={c.depth} units={units} onCommit={(mm) => patch({ depth: mm })} /></Prop>}
            <Prop label="Rotation"><NumberInput value={c.rotation} suffix="°" onCommit={(v) => patch({ rotation: v })} /></Prop>
            <Prop label="Material"><MaterialPicker value={c.materialId} slot="core" onPick={(id) => patch({ materialId: id })} /></Prop>
          </div>
          <BimNote structural />
        </div>
      </>
    );
  }

  if (refx.kind === 'siteFeature' && doc.site.features[refx.id]) {
    const f = doc.site.features[refx.id];
    return (
      <>
        <Head icon={<LandPlot size={12} />} kind="Site feature" title={f.name} sub={f.kind} />
        <div className="panel-body"><div className="props"><Prop label="Name"><TextInput value={f.name} onCommit={(v) => act([{ type: 'site.feature.update', params: { id: f.id, patch: { name: v } } }])} /></Prop>
          {f.polygon && <Prop label="Area"><span className="num small">{formatArea(Math.abs(f.polygon.reduce((s, p, i) => s + p.x * f.polygon![(i + 1) % f.polygon!.length].y - f.polygon![(i + 1) % f.polygon!.length].x * p.y, 0) / 2), units)}</span></Prop>}
          <Prop label="Material"><MaterialPicker value={f.materialId ?? 'paver'} slot="site" onPick={(id) => act([{ type: 'site.feature.update', params: { id: f.id, patch: { materialId: id } } }])} /></Prop></div></div>
      </>
    );
  }
  return <ProjectSummary />;
}

function BimNote({ structural }: { structural?: boolean }) {
  return (
    <div className="small muted row" style={{ marginTop: 14, alignItems: 'flex-start' }}>
      <Info size={13} style={{ marginTop: 2, flex: 'none' }} />
      <span>{structural ? 'Conceptual structural information — not an engineering-certified analysis.' : 'Changes here update plans, 3D, elevations, schedules, quantities and cost automatically.'}</span>
    </div>
  );
}

function MultiInspector({ refs }: { refs: ElementRef[] }) {
  const counts = refs.reduce<Record<string, number>>((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {});
  const dispatch = useStore((s) => s.dispatch);
  const roomRefs = refs.filter((r) => r.kind === 'room');
  return (
    <>
      <Head icon={<Square size={12} />} kind="Selection" title={`${refs.length} elements`} sub={Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(' · ')} />
      <div className="panel-body">
        {roomRefs.length > 0 && <Prop label="Floor"><MaterialPicker value="vitrified" slot="floor" onPick={(id) => dispatch([{ type: 'material.apply', params: { refs: roomRefs, slot: 'floor', materialId: id } }], { keepSelection: true })} /></Prop>}
        <div className="small muted" style={{ marginTop: 10 }}>Drag to move together · <b>C</b> duplicate · <b>A</b> align · <b>⌫</b> delete.</div>
      </div>
    </>
  );
}

/** Project analytics at a glance — every number is live from the model. */
function ProjectSummary() {
  const doc = useDoc();
  const units = useUnits();
  const site = useSite();
  const health = useHealth();
  const cost = useCost();
  const levels = useLevels();
  const b = useBuilding();
  const versions = useStore((s) => s.versions);
  const navigate = useStore((s) => s.navigate);
  const rooms = Object.keys(b.rooms).length;
  return (
    <>
      <Head icon={<Info size={12} />} kind="Project" title={doc.meta.name} sub={`${doc.meta.location.city} · ${doc.options.find((o) => o.id === doc.activeOptionId)?.name}`} />
      <div className="panel-body">
        <div className="row" style={{ gap: 14, marginBottom: 14, cursor: 'pointer' }} onClick={() => navigate({ name: 'project', id: doc.id, space: 'analysis' })}>
          <HealthRing score={health.score} />
          <div><div style={{ fontWeight: 600 }}>Design health</div><div className="small muted">{health.errors} errors · {health.warnings} warnings</div><div className="small" style={{ color: 'var(--accent)' }}>Open health center →</div></div>
        </div>
        <div className="grid g2" style={{ gap: 12 }}>
          {[
            ['Plot area', formatArea(site.plotArea, units)], ['Built-up area', formatArea(site.builtUpArea, units)],
            ['Ground coverage', `${(site.coverage * 100).toFixed(1)}%`], ['FAR / FSI', site.far.toFixed(2)],
            ['Rooms', String(rooms)], ['Floors', String(levels.filter((l) => l.elevation >= 0).length)],
            ['Estimated cost', formatMoneyCompact(cost.grandTotal, cost.currency)], ['Cost / sq ft', formatMoneyCompact(cost.perSqft, cost.currency)],
          ].map(([k, v]) => <div key={k} className="stat"><div className="k">{k}</div><div className="num" style={{ fontSize: 16, fontWeight: 600 }}>{v}</div></div>)}
        </div>
        <hr className="divider" style={{ margin: '14px 0' }} />
        <div className="row small"><span className="muted grow">Last revision</span><span>v{versions[0]?.number ?? 1} · {relTime(versions[0]?.createdAt ?? doc.meta.updatedAt)}</span></div>
        <div className="row small" style={{ marginTop: 6 }}><span className="muted grow">Unsaved-to-version changes</span><span>{doc.pendingChanges.length}</span></div>
        <div className="small muted" style={{ marginTop: 16 }}>Select anything in the plan or 3D to edit it. Press <b>⌘K</b> for every command or <b>⌘J</b> to ask Architect AI.</div>
      </div>
    </>
  );
}
