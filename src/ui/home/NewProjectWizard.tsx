/** Guided project creation: type → site → floors → style → how to start. */
import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X, Sparkles, LayoutTemplate, FileUp, Image as ImageIcon, Box, Square, Check } from 'lucide-react';
import { useStore } from '../../state/store';
import { Modal, Seg, Switch, swatchStyle, HealthRing } from '../components';
import type { ProjectDoc, ProjectType, StyleId } from '../../core/model/types';
import { STYLES } from '../../core/catalog/styles';
import { getMaterial } from '../../core/catalog/materials';
import { CITIES } from '../../core/derive/sun';
import { defaultMeta, newProjectDoc, makeLevel, makeRoof, makeWall } from '../../core/model/factory';
import { emptyBuilding } from '../../core/model/query';
import { generateSchemes, siteFromProgram, DEFAULT_PROGRAM, northAngleFor, type Program, type Scheme } from '../../core/generate/layout';
import { resolveRules } from '../../core/rules/rulesets';
import { scoreBuilding } from '../../core/generate/score';
import { ft, formatArea } from '../../core/units';
import { planThumbnail } from '../plan/thumbnail';
import { TEMPLATES } from '../../state/seed';
import { uid } from '../../core/model/ids';
import { migrate } from '../../state/persist';

const TYPES: { id: ProjectType; label: string; hint: string }[] = [
  { id: 'villa', label: 'Villa', hint: 'Detached luxury home' }, { id: 'house', label: 'House', hint: 'Individual house' },
  { id: 'apartment', label: 'Apartment', hint: 'Single unit interior' }, { id: 'duplex', label: 'Duplex', hint: 'Two-level home' },
  { id: 'farmhouse', label: 'Farmhouse', hint: 'Large rural plot' }, { id: 'commercial', label: 'Commercial', hint: 'Small office / retail' },
  { id: 'renovation', label: 'Renovation', hint: 'Existing building' }, { id: 'blank', label: 'Blank project', hint: 'Start from nothing' },
];

type Start = 'blank' | 'ai' | 'template' | 'cad' | 'image' | 'model';

export function NewProjectWizard() {
  const open = useStore((s) => s.wizardOpen);
  if (!open) return null;
  return <Wizard />;
}

function Wizard() {
  const set = useStore((s) => s.set);
  const createProject = useStore((s) => s.createProject);
  const toast = useStore((s) => s.toast);
  const [step, setStep] = useState(0);
  const [type, setType] = useState<ProjectType>('villa');
  const [name, setName] = useState('');
  const [units, setUnits] = useState<'imperial' | 'metric'>('imperial');
  const [w, setW] = useState(40);
  const [d, setD] = useState(60);
  const [city, setCity] = useState('Mumbai');
  const [entrance, setEntrance] = useState<Program['entrance']>('south');
  const [floors, setFloors] = useState({ basement: false, ground: true, first: true, second: false, terrace: true });
  const [style, setStyle] = useState<StyleId>('modern');
  const [start, setStart] = useState<Start>('ai');
  const [program, setProgram] = useState<Program>({ ...DEFAULT_PROGRAM });
  const [schemes, setSchemes] = useState<{ s: Scheme; score: number; health: number; area: number; thumb: string }[]>([]);
  const [pick, setPick] = useState(0);
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [file, setFile] = useState<File | null>(null);
  const [cadInfo, setCadInfo] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const mm = (v: number) => (units === 'metric' ? v * 1000 : ft(v));
  const floorCount = (floors.ground ? 1 : 0) + (floors.first ? 1 : 0) + (floors.second ? 1 : 0);
  const loc = CITIES.find((c) => c.city === city) ?? CITIES[0];
  const close = () => set('wizardOpen', false);

  const baseDoc = (): ProjectDoc => {
    const rules = resolveRules('in-generic').values;
    const site = siteFromProgram(mm(w), mm(d), rules.frontSetback, rules.sideSetback, rules.rearSetback);
    site.northAngle = northAngleFor(entrance);
    const meta = defaultMeta({ name: name.trim() || `${TYPES.find((t) => t.id === type)?.label} — ${city}`, type, units, location: { city: loc.city, country: loc.country, lat: loc.lat, lon: loc.lon }, currency: loc.country === 'India' ? 'INR' : loc.country === 'USA' ? 'USD' : loc.country === 'UAE' ? 'AED' : loc.country === 'UK' ? 'GBP' : 'SGD', ruleSetId: loc.country === 'USA' ? 'us-irc' : loc.country === 'UAE' ? 'uae-dubai' : 'in-generic' });
    const doc = newProjectDoc(meta, site, emptyBuilding(), style);
    return doc;
  };

  const generate = () => {
    const doc = baseDoc();
    const prog = { ...program, floors: Math.max(1, floorCount), style, entrance };
    const rules = resolveRules(doc.meta.ruleSetId);
    const list = generateSchemes(doc.site, prog).map((s) => {
      const d2 = { ...doc, options: [{ ...doc.options[0], building: s.building }], site: { ...doc.site, features: Object.fromEntries(s.features.map((f) => [f.id, f])) } };
      const sc = scoreBuilding(d2, s.building, rules);
      return { s, score: sc.total, health: sc.metrics.health, area: sc.raw.builtUp, thumb: planThumbnail(d2) };
    });
    setSchemes(list);
    setPick(0);
  };

  const finish = async () => {
    try {
      if (start === 'template') { const t = TEMPLATES.find((x) => x.id === template)!; const doc = t.build(); if (name.trim()) doc.meta.name = name.trim(); await createProject(doc); return; }
      if (start === 'model' && file) {
        const doc = migrate(JSON.parse(await file.text()) as ProjectDoc);
        if (!doc.options?.length || !doc.site) throw new Error('Not a Plinth project');
        doc.id = uid('p');
        await createProject(doc);
        return;
      }
      const doc = baseDoc();
      const b = doc.options[0].building;
      if (start === 'ai') {
        const chosen = schemes[pick]?.s;
        if (!chosen) { toast('Generate concepts first'); return; }
        doc.options[0].building = chosen.building;
        doc.options[0].name = chosen.name;
        doc.options[0].description = chosen.summary;
        doc.options[0].style = chosen.style;
        for (const f of chosen.features) doc.site.features[f.id] = f;
        // Keep the other two schemes as design options to compare.
        schemes.forEach((x, i) => { if (i !== pick) doc.options.push({ id: uid('opt'), name: x.s.name, description: x.s.summary, style: x.s.style, building: x.s.building, createdAt: Date.now() }); });
      } else {
        let elev = floors.basement ? -3000 : 450;
        const names: [boolean, string][] = [[floors.basement, 'Basement'], [floors.ground, 'Ground Floor'], [floors.first, 'First Floor'], [floors.second, 'Second Floor']];
        let order = 0;
        for (const [on, n] of names) if (on) { const l = makeLevel({ name: n, elevation: elev, height: n === 'Basement' ? 3000 : 3200, order: order++, slabThickness: n === 'Ground Floor' ? 450 : 150 }); b.levels[l.id] = l; elev += l.height + (n === 'Basement' ? 450 : 0); }
        const top = Object.values(b.levels).sort((x, y) => y.order - x.order)[0];
        if (top && floors.terrace) { const r = makeRoof({ levelId: top.id, kind: 'flat' }, style); b.roofs[r.id] = r; }
        if (start === 'cad' && file) {
          const { parseDxf, dxfToWalls } = await import('../../core/io/dxf');
          const parsed = parseDxf(await file.text());
          const walls = dxfToWalls(parsed);
          const lv = Object.values(b.levels).find((l) => l.name === 'Ground Floor') ?? top;
          for (const wl of walls.walls) { const nw = makeWall({ levelId: lv.id, a: wl.a, b: wl.b, thickness: wl.thickness, kind: wl.thickness >= 200 ? 'exterior' : 'interior' }, style); b.walls[nw.id] = nw; }
          if (walls.underlay.length) doc.underlays.push({ id: uid('ul'), levelId: lv.id, name: file.name, image: null, lines: walls.underlay, x: 0, y: 0, width: 1, aspect: 1, opacity: 0.6, visible: true });
        }
        if (start === 'image' && file) {
          const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
          const img = new Image();
          await new Promise((res) => { img.onload = res; img.src = url; });
          const lv = Object.values(b.levels).find((l) => l.name === 'Ground Floor') ?? top;
          const width = mm(w) * 1.15;
          doc.underlays.push({ id: uid('ul'), levelId: lv.id, name: file.name, image: url, x: -mm(w) * 0.075, y: 0, width, aspect: img.height / img.width, opacity: 0.55, visible: true });
        }
      }
      await createProject(doc);
    } catch (e) {
      console.error(e);
      toast('We couldn’t create the project from that file. Check the format and try again.', { kind: 'err' });
    }
  };

  const steps = ['What are you designing?', 'Site information', 'Floors', 'Design style', 'How do you want to start?'];
  const canNext = step < 4;
  const plotArea = mm(w) * mm(d);

  return (
    <Modal onClose={close} label="New project" width={step === 4 && start === 'ai' ? 900 : 760}>
      <div style={{ padding: '18px 22px 0' }}>
        <div className="row"><div className="caps">New project · step {step + 1} of 5</div><span className="spacer" /><button className="btn ghost icon sm" onClick={close} aria-label="Close"><X size={15} /></button></div>
        <h2 style={{ margin: '6px 0 12px', fontSize: 20, letterSpacing: '-0.015em' }}>{steps[step]}</h2>
        <div className="steps">{steps.map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      </div>
      <div className="panel-body" style={{ padding: '18px 22px', minHeight: 300 }}>
        {step === 0 && (
          <div className="col" style={{ gap: 14 }}>
            <div className="grid g4" style={{ gap: 10 }}>
              {TYPES.map((t) => (
                <button key={t.id} className="wizard-opt" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                  <b>{t.label}</b><span className="small muted">{t.hint}</span>
                </button>
              ))}
            </div>
            <div className="field"><label htmlFor="pname">Project name</label><input id="pname" className="input" placeholder={`${TYPES.find((t) => t.id === type)?.label} — ${city}`} value={name} onChange={(e) => setName(e.target.value)} /></div>
          </div>
        )}
        {step === 1 && (
          <div className="grid g2" style={{ gap: 24 }}>
            <div className="col" style={{ gap: 14 }}>
              <div className="field"><label>Unit</label><Seg value={units} onChange={(u) => { setUnits(u); if (u === 'metric') { setW(Math.round(w * 0.3048 * 10) / 10); setD(Math.round(d * 0.3048 * 10) / 10); } else { setW(Math.round(w / 0.3048)); setD(Math.round(d / 0.3048)); } }} options={[{ value: 'imperial', label: 'Feet' }, { value: 'metric', label: 'Metres' }]} /></div>
              <div className="row">
                <div className="field grow"><label htmlFor="pw">Plot width</label><input id="pw" type="number" className="input num" value={w} min={5} onChange={(e) => setW(Number(e.target.value))} /></div>
                <span style={{ marginTop: 18 }} className="muted">×</span>
                <div className="field grow"><label htmlFor="pd">Plot depth</label><input id="pd" type="number" className="input num" value={d} min={5} onChange={(e) => setD(Number(e.target.value))} /></div>
              </div>
              <div className="field"><label htmlFor="city">Location</label><select id="city" className="select" value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((c) => <option key={c.city}>{c.city}</option>)}</select></div>
              <div className="field"><label>Entrance faces</label><Seg value={entrance} onChange={setEntrance} options={(['north', 'east', 'south', 'west'] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))} /></div>
              <div className="small muted">Plot area {formatArea(plotArea, units)}. Setbacks, FAR and coverage start from the {loc.country === 'USA' ? 'IRC' : loc.country === 'UAE' ? 'UAE villa' : 'NBC'} rule set and are editable in Site.</div>
            </div>
            <PlotPreview w={mm(w)} d={mm(d)} entrance={entrance} />
          </div>
        )}
        {step === 2 && (
          <div className="col" style={{ gap: 6, maxWidth: 420 }}>
            {([['terrace', 'Terrace / roof'], ['second', 'Second floor'], ['first', 'First floor'], ['ground', 'Ground floor'], ['basement', 'Basement']] as const).map(([k, l]) => (
              <div key={k} className="row card" style={{ padding: '10px 14px', boxShadow: 'none' }}>
                <span className="grow" style={{ fontWeight: 500 }}>{l}</span>
                <span className="small muted">{k === 'terrace' ? 'Flat roof with parapet' : k === 'basement' ? '3.0 m, below grade' : '3.2 m floor to floor'}</span>
                <Switch checked={floors[k]} onChange={(v) => setFloors({ ...floors, [k]: v })} label={l} />
              </div>
            ))}
            <div className="small muted">Levels can be added, renamed and re-heighted at any time — everything above moves with them.</div>
          </div>
        )}
        {step === 3 && (
          <div className="grid g4" style={{ gap: 10 }}>
            {STYLES.map((s) => (
              <button key={s.id} className="wizard-opt" aria-pressed={style === s.id} onClick={() => setStyle(s.id)}>
                <div className="row" style={{ gap: 3 }}>{[s.exterior, s.exteriorAccent, s.floors.default, s.roof.material].map((m, i) => <span key={i} className="swatch" style={{ ...swatchStyle(getMaterial(m)), width: 22, height: 22 }} />)}</div>
                <b>{s.name}</b><span className="small muted" style={{ lineHeight: 1.35 }}>{s.summary}</span>
              </button>
            ))}
          </div>
        )}
        {step === 4 && (
          <div className="col" style={{ gap: 16 }}>
            <div className="grid g3" style={{ gap: 10 }}>
              {([['ai', 'AI-generated concept', 'Three editable schemes from your brief', <Sparkles key="a" size={16} />], ['blank', 'Blank site', 'Your plot, levels and roof — draw from scratch', <Square key="b" size={16} />], ['template', 'Template', 'Company-standard starting points', <LayoutTemplate key="c" size={16} />], ['cad', 'Import CAD', 'DXF — convert lines to walls', <FileUp key="d" size={16} />], ['image', 'Import image / PDF scan', 'Trace over a sketch or plan', <ImageIcon key="e" size={16} />], ['model', 'Import existing model', 'Plinth project file (.json)', <Box key="f" size={16} />]] as const).map(([id, l, h, ic]) => (
                <button key={id} className="wizard-opt" aria-pressed={start === id} onClick={() => { setStart(id); setFile(null); setCadInfo(''); }}>
                  <div className="row">{ic}<b>{l}</b></div><span className="small muted">{h}</span>
                </button>
              ))}
            </div>
            {start === 'ai' && (
              <div className="col" style={{ gap: 12 }}>
                <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
                  <label className="row small">Bedrooms <input type="number" min={1} max={7} className="input num" style={{ width: 56 }} value={program.bedrooms} onChange={(e) => setProgram({ ...program, bedrooms: Number(e.target.value) })} /></label>
                  <label className="row small">Parking <input type="number" min={0} max={4} className="input num" style={{ width: 56 }} value={program.parking} onChange={(e) => setProgram({ ...program, parking: Number(e.target.value) })} /></label>
                  {(['pooja', 'powder', 'study', 'family', 'garden', 'pool'] as const).map((k) => <label key={k} className="row small" style={{ textTransform: 'capitalize' }}><input type="checkbox" checked={program[k]} onChange={(e) => setProgram({ ...program, [k]: e.target.checked })} /> {k === 'pooja' ? 'Pooja room' : k === 'powder' ? 'Powder room' : k}</label>)}
                  <span className="spacer" />
                  <button className="btn primary" onClick={generate}><Sparkles size={14} /> {schemes.length ? 'Regenerate' : 'Generate concepts'}</button>
                </div>
                {schemes.length > 0 && (
                  <div className="grid g3" style={{ gap: 10 }}>
                    {schemes.map((x, i) => (
                      <button key={x.s.id} className="wizard-opt" aria-pressed={pick === i} onClick={() => setPick(i)} style={{ padding: 10 }}>
                        <div style={{ aspectRatio: '4/3', background: 'var(--paper)', borderRadius: 8, position: 'relative' }}><div style={{ position: 'absolute', inset: 6 }} dangerouslySetInnerHTML={{ __html: x.thumb }} /></div>
                        <div className="row"><b className="grow">{x.s.name}</b>{pick === i && <Check size={15} style={{ color: 'var(--accent)' }} />}</div>
                        <span className="small muted" style={{ lineHeight: 1.35 }}>{x.s.summary}</span>
                        <div className="row small"><HealthRing score={x.health} size={30} /><span className="muted">{formatArea(x.area, units)} · score {x.score}</span></div>
                      </button>
                    ))}
                  </div>
                )}
                {!schemes.length && <div className="small muted">Uses your plot ({w} × {d} {units === 'metric' ? 'm' : 'ft'}), {floorCount} floor{floorCount === 1 ? '' : 's'}, {STYLES.find((s) => s.id === style)?.name.toLowerCase()} style and a {entrance}-facing entrance. All three schemes are kept as design options.</div>}
              </div>
            )}
            {start === 'template' && (
              <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Template">{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}</select>
            )}
            {(start === 'cad' || start === 'image' || start === 'model') && (
              <div className="card card-pad" style={{ boxShadow: 'none', borderStyle: 'dashed', textAlign: 'center' }}>
                <input ref={fileRef} type="file" hidden accept={start === 'cad' ? '.dxf' : start === 'image' ? 'image/*' : '.json,application/json'} onChange={async (e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && start === 'cad') {
                    try {
                      const { parseDxf, dxfToWalls } = await import('../../core/io/dxf');
                      const p = parseDxf(await f.text());
                      const wl = dxfToWalls(p);
                      setCadInfo(`Detected units: ${p.units} · Layers: ${p.layers.length} · Blocks: ${p.blocks} · ${wl.walls.length} walls recognised, ${wl.underlay.length} lines kept as underlay`);
                    } catch { setCadInfo('This DXF could not be read.'); }
                  }
                }} />
                <button className="btn" onClick={() => fileRef.current?.click()}><FileUp size={14} /> {file ? file.name : start === 'cad' ? 'Choose a DXF file' : start === 'image' ? 'Choose an image (sketch, scan, photo)' : 'Choose a Plinth project'}</button>
                <div className="small muted" style={{ marginTop: 8 }}>{cadInfo || (start === 'cad' ? 'DWG files: save as DXF from your CAD tool first (DWG is a proprietary format).' : start === 'image' ? 'The image is placed as a scaled underlay on the ground floor so you can trace walls over it.' : 'Files exported from Plinth → Settings → Export project.')}</div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="row" style={{ padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
        {step > 0 ? <button className="btn ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={14} /> Back</button> : <span />}
        <span className="spacer" />
        {canNext ? <button className="btn primary" onClick={() => setStep(step + 1)}>Continue <ArrowRight size={14} /></button>
          : <button className="btn primary" disabled={(start === 'ai' && !schemes.length) || ((start === 'cad' || start === 'image' || start === 'model') && !file)} onClick={() => void finish()}>Create project <ArrowRight size={14} /></button>}
      </div>
    </Modal>
  );
}

function PlotPreview({ w, d, entrance }: { w: number; d: number; entrance: string }) {
  const r = resolveRules('in-generic').values;
  const s = useMemo(() => 220 / Math.max(w, d), [w, d]);
  return (
    <svg viewBox={`-20 -20 ${w * s + 40} ${d * s + 60}`} style={{ width: '100%', maxHeight: 300 }} aria-label="Plot preview">
      <rect x={0} y={0} width={w * s} height={d * s} fill="var(--accent-softer)" stroke="var(--ink-2)" strokeWidth={1.5} strokeDasharray="6 3" />
      <rect x={r.sideSetback * s} y={r.rearSetback * s} width={(w - 2 * r.sideSetback) * s} height={(d - r.frontSetback - r.rearSetback) * s} fill="none" stroke="var(--accent)" strokeWidth={1} />
      <text x={(w * s) / 2} y={d * s + 18} textAnchor="middle" fontSize={11} fill="var(--ink-3)">Road · entrance faces {entrance}</text>
      <text x={(w * s) / 2} y={(d * s) / 2} textAnchor="middle" fontSize={11} fill="var(--accent)">Buildable zone</text>
    </svg>
  );
}
