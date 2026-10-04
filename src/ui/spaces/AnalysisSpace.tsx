/** Analysis: Design Health center, sun & shadow study, daylight, climate notes and generative design. */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, TriangleAlert, CircleX, Info, Wand, Sparkles, ArrowRight, Loader } from 'lucide-react';
import { useStore } from '../../state/store';
import { useBuilding, useDoc, useHealth, useLevels, useUnits } from '../../state/derived';
import { HealthRing } from '../components';
import { computeImpact } from '../../core/ai/impact';
import { daylightAnalysis, HABITABLE } from '../../core/derive/analysis';
import { sunPosition, sunriseSunset, CITIES } from '../../core/derive/sun';
import { formatArea, formatMoneyCompact } from '../../core/units';
import { METRICS, type MetricId, type SchemeScore } from '../../core/generate/score';
import { DEFAULT_PROGRAM, type Program, type Scheme } from '../../core/generate/layout';
import { planThumbnail } from '../plan/thumbnail';
import type { Issue } from '../../core/derive/validation';

const Viewport3D = lazy(() => import('../three/Viewport3D'));

export default function AnalysisSpace() {
  const [tab, setTab] = useState<'health' | 'sun' | 'daylight' | 'generative' | 'climate'>('health');
  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 32px 0' }}>
        <h1 className="page-title">Analysis</h1>
        <div className="seg" style={{ margin: '14px 0 4px' }}>
          {([['health', 'Design health'], ['sun', 'Sun & shadows'], ['daylight', 'Daylight'], ['climate', 'Climate & energy'], ['generative', 'Generative design']] as const).map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '14px 32px 40px', display: 'flex', flexDirection: 'column' }}>
        {tab === 'health' && <HealthCenter />}
        {tab === 'sun' && <SunStudy />}
        {tab === 'daylight' && <Daylight />}
        {tab === 'climate' && <Climate />}
        {tab === 'generative' && <Generative />}
      </div>
    </div>
  );
}

const SEV_ICON = { error: <CircleX size={15} style={{ color: 'var(--err)' }} />, warning: <TriangleAlert size={15} style={{ color: 'var(--warn)' }} />, info: <Info size={15} style={{ color: 'var(--info)' }} /> };

function HealthCenter() {
  const health = useHealth();
  const doc = useDoc();
  const s = useStore();
  const [cat, setCat] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const list = health.issues.filter((i) => !cat || i.category === cat);
  const go = (i: Issue) => {
    s.navigate({ name: 'project', id: doc.id, space: 'design' });
    s.setView('plan');
    if (i.levelId) s.setLevel(i.levelId);
    if (i.refs.length) s.select(i.refs);
    if (i.point) setTimeout(() => s.focusOn(i.point!, i.levelId), 30);
  };
  return (
    <div className="grid g12" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="panel-head"><h2>{cat ?? 'All issues'}</h2><span className="muted small">{list.length} items · checked continuously</span>{cat && <button className="btn ghost sm" onClick={() => setCat(null)}>Show all</button>}</div>
        <div style={{ padding: 6 }}>
          {list.map((i) => {
            const imp = preview === i.id && i.fix ? computeImpact(doc, i.fix.ops) : null;
            return (
              <div key={i.id} className="list-item" style={{ alignItems: 'flex-start', cursor: 'default', padding: '10px 10px' }}>
                <span style={{ marginTop: 2 }}>{SEV_ICON[i.severity]}</span>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{i.title}</div>
                  <div className="small muted">{i.detail}</div>
                  {imp?.ok && <div className="small" style={{ marginTop: 6, color: 'var(--ink-2)' }}>Preview: {imp.lines.slice(0, 4).join(' · ') || 'no area changes'} · health {imp.health.before} → {imp.health.after}</div>}
                  {imp && !imp.ok && <div className="small" style={{ marginTop: 6, color: 'var(--err)' }}>{imp.error}</div>}
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="chip">{i.category}</span>
                    {(i.refs.length > 0 || i.point) && <button className="btn sm ghost" onClick={() => go(i)}>Show me <ArrowRight size={12} /></button>}
                    {i.fix && <button className="btn sm ghost" onClick={() => setPreview(preview === i.id ? null : i.id)}><Wand size={12} /> {preview === i.id ? 'Hide preview' : `Preview: ${i.fix.label}`}</button>}
                    {i.fix && preview === i.id && imp?.ok && <button className="btn sm primary" onClick={() => { s.dispatch(i.fix!.ops, { label: i.fix!.label }); setPreview(null); }}>Apply fix</button>}
                  </div>
                </div>
              </div>
            );
          })}
          {!list.length && <div className="empty"><CircleCheck size={22} style={{ color: 'var(--ok)' }} /><div>No issues — geometry, rooms, openings, stairs and zoning all check out.</div></div>}
        </div>
      </div>
      <div className="col" style={{ gap: 16 }}>
        <div className="card card-pad row" style={{ gap: 16 }}>
          <HealthRing score={health.score} size={86} />
          <div><div style={{ fontWeight: 650, fontSize: 16 }}>Design health {health.score} / 100</div><div className="small muted">{health.errors} errors · {health.warnings} warnings · {health.infos} notes</div><div className="tiny muted" style={{ marginTop: 4 }}>Errors −7, warnings −2.5, notes −0.5</div></div>
        </div>
        <div className="card" style={{ padding: 6 }}>
          {health.categories.map((c) => (
            <div key={c.category} className="list-item" aria-selected={cat === c.category} onClick={() => setCat(cat === c.category ? null : c.category)}>
              {c.status === 'ok' ? <CircleCheck size={15} style={{ color: 'var(--ok)' }} /> : SEV_ICON[c.status]}
              <span className="grow">{c.category}</span>
              <span className="tiny muted">{c.count ? `${c.count}` : 'OK'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SunStudy() {
  const doc = useDoc();
  const sun = useStore((s) => s.sun);
  const set = useStore((s) => s.set);
  const dispatch = useStore((s) => s.dispatch);
  const { lat, lon, city } = doc.meta.location;
  const { sunrise, sunset } = sunriseSunset(lat, lon, sun.month, sun.day);
  const pos = sunPosition(lat, lon, sun.month, sun.day, sun.hour);
  const hm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  // Sun-path polar diagram: real positions through the chosen day and the solstices.
  const path = (m: number, d: number) => Array.from({ length: 49 }, (_, i) => sunPosition(lat, lon, m, d, 4 + i * 0.35)).filter((p) => p.altitude > 0);
  const P = (p: { altitude: number; azimuth: number }) => { const r = 90 - p.altitude; const a = ((p.azimuth - doc.site.northAngle) * Math.PI) / 180; return { x: Math.sin(a) * r, y: -Math.cos(a) * r }; };
  const line = (pts: { altitude: number; azimuth: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${P(p).x.toFixed(1)} ${P(p).y.toFixed(1)}`).join('');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="grid g12" style={{ flex: 1, minHeight: 520 }}>
      <div className="card" style={{ position: 'relative', overflow: 'hidden', minHeight: 520 }}>
        <Suspense fallback={<div className="empty">Loading 3D…</div>}><Viewport3D compact /></Suspense>
      </div>
      <div className="col" style={{ gap: 16 }}>
        <div className="card card-pad col" style={{ gap: 10 }}>
          <div className="row"><b className="grow">{sun.day} {months[sun.month - 1]} · {hm(sun.hour)}</b><select className="select" style={{ width: 140 }} value={city} onChange={(e) => { const c = CITIES.find((x) => x.city === e.target.value)!; dispatch([{ type: 'project.update', params: { patch: { location: { ...doc.meta.location, city: c.city, country: c.country, lat: c.lat, lon: c.lon } } } }]); }} aria-label="Location">{CITIES.map((c) => <option key={c.city}>{c.city}</option>)}</select></div>
          <label className="small muted">Time of day</label>
          <input type="range" min={Math.floor(sunrise * 4) / 4} max={Math.ceil(sunset * 4) / 4} step={0.25} value={sun.hour} onChange={(e) => set('sun', { ...sun, hour: Number(e.target.value) })} aria-label="Time of day" />
          <label className="small muted">Date</label>
          <div className="row"><select className="select" value={sun.month} onChange={(e) => set('sun', { ...sun, month: Number(e.target.value) })} aria-label="Month">{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select><input className="input num" type="number" min={1} max={31} value={sun.day} onChange={(e) => set('sun', { ...sun, day: Number(e.target.value) })} aria-label="Day" /></div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {[['Winter solstice', 12, 21], ['Equinox', 3, 20], ['Summer solstice', 6, 21]].map(([l, m, d]) => <button key={l as string} className="btn sm" onClick={() => set('sun', { ...sun, month: m as number, day: d as number })}>{l}</button>)}
          </div>
          <div className="grid g3" style={{ gap: 8, marginTop: 4 }}>
            <div className="stat"><div className="k">Sunrise</div><b className="num">{hm(sunrise)}</b></div>
            <div className="stat"><div className="k">Sunset</div><b className="num">{hm(sunset)}</b></div>
            <div className="stat"><div className="k">Altitude · azimuth</div><b className="num">{Math.round(pos.altitude)}° · {Math.round(pos.azimuth)}°</b></div>
          </div>
        </div>
        <div className="card card-pad">
          <h3 style={{ marginBottom: 6 }}>Sun path · {city}</h3>
          <div className="tiny muted" style={{ marginBottom: 6 }}>Plan-oriented (true north rotated {Math.round(doc.site.northAngle)}°). Rings every 30° of altitude.</div>
          <svg viewBox="-100 -100 200 200" style={{ width: '100%', maxWidth: 300, display: 'block', margin: '0 auto' }} aria-label="Sun path diagram">
            {[90, 60, 30].map((r) => <circle key={r} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={0.6} />)}
            {['N', 'E', 'S', 'W'].map((d, i) => { const a = ((i * 90 - doc.site.northAngle) * Math.PI) / 180; return <text key={d} x={Math.sin(a) * 96} y={-Math.cos(a) * 96 + 3} textAnchor="middle" fontSize={8} fill="var(--ink-3)" fontWeight={600}>{d}</text>; })}
            <path d={line(path(6, 21))} fill="none" stroke="var(--warn)" strokeWidth={1} strokeDasharray="3 2" />
            <path d={line(path(12, 21))} fill="none" stroke="var(--info)" strokeWidth={1} strokeDasharray="3 2" />
            <path d={line(path(sun.month, sun.day))} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
            {pos.altitude > 0 && <circle cx={P(pos).x} cy={P(pos).y} r={4.5} fill="var(--warn)" stroke="#fff" strokeWidth={1} />}
          </svg>
          <div className="row tiny muted" style={{ justifyContent: 'center', gap: 12 }}><span style={{ color: 'var(--warn)' }}>— 21 Jun</span><span style={{ color: 'var(--info)' }}>— 21 Dec</span><span style={{ color: 'var(--accent)' }}>— selected day</span></div>
        </div>
      </div>
    </div>
  );
}

function Daylight() {
  const doc = useDoc();
  const b = useBuilding();
  const units = useUnits();
  const levels = useLevels();
  const rows = useMemo(() => daylightAnalysis(doc, b).filter((r) => r.fn !== 'stair'), [doc, b]);
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="panel-head"><h2>Daylight by room</h2><span className="muted small">Glazing-to-floor ratio · target 10–15% for habitable rooms</span></div>
      <table className="table">
        <thead><tr><th>Room</th><th>Level</th><th className="r">Floor area</th><th className="r">Glazing</th><th style={{ width: 220 }}>Ratio</th><th>Windows face</th></tr></thead>
        <tbody>{rows.sort((a, c) => a.ratio - c.ratio).map((r) => (
          <tr key={r.roomId}>
            <td><b>{r.name}</b>{HABITABLE.includes(r.fn) && <span className="tiny muted"> · habitable</span>}</td>
            <td className="muted">{levels.find((l) => l.id === r.levelId)?.name}</td>
            <td className="r num">{formatArea(r.area, units)}</td>
            <td className="r num">{formatArea(r.glazingArea, units)}</td>
            <td><div className="row"><div className="bar grow"><i style={{ width: `${Math.min(100, (r.ratio / 0.2) * 100)}%`, background: r.ratio >= 0.1 ? 'var(--ok)' : HABITABLE.includes(r.fn) ? 'var(--err)' : 'var(--ink-4)' }} /></div><span className="num small" style={{ width: 46, textAlign: 'right' }}>{(r.ratio * 100).toFixed(1)}%</span></div></td>
            <td>{r.orientations.length ? r.orientations.join(' · ') : <span className="muted">—</span>}{r.westGlazing > 0 && <span className="chip warn" style={{ marginLeft: 6, height: 18 }}>west sun</span>}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="tiny muted" style={{ padding: 12 }}>Planning indicator based on window area and orientation — not a daylight-factor simulation. Orientation uses the site’s true-north setting.</div>
    </div>
  );
}

function Climate() {
  const doc = useDoc();
  const b = useBuilding();
  const units = useUnits();
  const day = useMemo(() => daylightAnalysis(doc, b), [doc, b]);
  const { lat, lon, city } = doc.meta.location;
  const summerNoon = sunPosition(lat, lon, 6, 21, 12.5);
  const winterNoon = sunPosition(lat, lon, 12, 21, 12.5);
  const westPm = sunPosition(lat, lon, 4, 15, 16);
  const glaze = day.reduce((s, d) => s + d.glazingArea, 0);
  const west = day.reduce((s, d) => s + d.westGlazing, 0);
  const crossVent = day.filter((d) => HABITABLE.includes(d.fn) && d.orientations.length >= 2).length;
  const habitable = day.filter((d) => HABITABLE.includes(d.fn)).length;
  const southFacing = lat >= 0;
  const overhangFor = (h: number, alt: number) => h / Math.tan((Math.max(5, alt) * Math.PI) / 180);
  const tropical = Math.abs(lat) < 23.5;
  const recs = [
    { title: `Shade the ${southFacing ? 'south' : 'north'} glazing`, body: `At summer noon in ${city} the sun is ${Math.round(summerNoon.altitude)}° high; in winter ${Math.round(winterNoon.altitude)}°. A horizontal overhang of about ${(overhangFor(1500, winterNoon.altitude) / 1000).toFixed(2)} m over a 1.5 m window blocks direct sun until mid-winter${tropical ? ' — in the tropics, shade all year' : ''}.` },
    { title: 'Control west sun', body: `${((west / (glaze || 1)) * 100).toFixed(0)}% of the glazing faces west. At 4 pm in April the sun sits only ${Math.round(westPm.altitude)}° above the horizon, below any overhang — use vertical fins, louvres or deep verandahs on west façades.` },
    { title: 'Cross-ventilation', body: `${crossVent} of ${habitable} habitable rooms have windows on two or more façades. Rooms with a single façade benefit from a high-level vent or transfer grille.` },
    { title: 'Roof', body: tropical ? 'A flat terrace collects heat; add 50–75 mm insulation or a ventilated deck, or use a light-coloured reflective finish. Pitched roofs with ventilated voids perform better in this climate.' : 'Insulate the roof to the local energy code; pitched roofs with ventilated voids reduce summer heat gain.' },
  ];
  return (
    <div className="grid g2">
      <div className="card card-pad col" style={{ gap: 14 }}>
        <h3>Climate-aware recommendations · {city}</h3>
        {recs.map((r) => <div key={r.title}><div style={{ fontWeight: 600 }}>{r.title}</div><div className="small subtle">{r.body}</div></div>)}
      </div>
      <div className="card card-pad col" style={{ gap: 12 }}>
        <h3>Energy indicators (indicative)</h3>
        <div className="grid g2" style={{ gap: 10 }}>
          <div className="stat"><div className="k">Total glazing</div><b className="num">{formatArea(glaze, units)}</b></div>
          <div className="stat"><div className="k">West-facing glazing</div><b className="num">{formatArea(west, units)}</b></div>
          <div className="stat"><div className="k">Window-to-floor ratio</div><b className="num">{((glaze / Math.max(1, day.reduce((s, d) => s + d.area, 0))) * 100).toFixed(1)}%</b></div>
          <div className="stat"><div className="k">Cross-ventilated rooms</div><b className="num">{crossVent} / {habitable}</b></div>
        </div>
        <div className="small muted">Assumptions: solar geometry from the NOAA algorithm for {lat.toFixed(2)}°, {lon.toFixed(2)}°; orientation from the site’s true north; no thermal simulation is performed. Connect an energy-analysis extension for EnergyPlus-grade results.</div>
      </div>
    </div>
  );
}

interface GenResult { scheme: Scheme; score: SchemeScore }

function Generative() {
  const doc = useDoc();
  const b = useBuilding();
  const units = useUnits();
  const dispatch = useStore((s) => s.dispatch);
  const rooms = Object.values(b.rooms);
  const [program, setProgram] = useState<Program>(() => ({
    ...DEFAULT_PROGRAM,
    bedrooms: Math.max(1, rooms.filter((r) => r.fn === 'bedroom' || r.fn === 'master_bedroom').length),
    floors: Math.max(1, Object.values(b.levels).filter((l) => l.elevation >= 0).length),
    pooja: rooms.some((r) => r.fn === 'pooja'), study: rooms.some((r) => r.fn === 'study'), pool: Object.values(doc.site.features).some((f) => f.kind === 'pool'),
    style: doc.options.find((o) => o.id === doc.activeOptionId)!.style,
  }));
  const [weights, setWeights] = useState<Record<MetricId, number>>({ light: 1, garden: 1, privacy: 1, efficiency: 1, corridor: 1, cost: 1, heat: 1, health: 2 });
  const [results, setResults] = useState<GenResult[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const run = () => {
    worker.current?.terminate();
    const w = new Worker(new URL('../../workers/generate.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setProgress(0);
    setResults([]);
    w.onmessage = (e) => { if (e.data.done) { setResults(e.data.results); setProgress(null); } else setProgress(e.data.progress); };
    w.onerror = () => { setProgress(null); useStore.getState().toast('Generation failed — try a different brief.', { kind: 'err' }); };
    w.postMessage({ id: 1, doc, program, weights, count: 9 });
  };
  return (
    <div className="grid g12" style={{ alignItems: 'start' }}>
      <div className="col" style={{ gap: 12 }}>
        {progress !== null && <div className="card card-pad row"><Loader size={15} className="spin" /> Generating and scoring schemes in the background… {Math.round(progress * 100)}%<div className="bar grow"><i style={{ width: `${progress * 100}%` }} /></div></div>}
        {results.map((r, i) => (
          <div key={r.scheme.id} className="card" style={{ padding: 12, display: 'grid', gridTemplateColumns: '150px 1fr', gap: 14 }}>
            <div style={{ background: 'var(--paper)', borderRadius: 8, aspectRatio: '1', position: 'relative' }}><div style={{ position: 'absolute', inset: 6 }} dangerouslySetInnerHTML={{ __html: planThumbnail({ ...doc, site: { ...doc.site, features: Object.fromEntries(r.scheme.features.map((f) => [f.id, f])) }, options: [{ ...doc.options[0], building: r.scheme.building }], activeOptionId: doc.options[0].id }) }} /></div>
            <div className="col" style={{ gap: 6 }}>
              <div className="row"><span className="chip accent">#{i + 1}</span><b className="grow">{r.scheme.name}</b><span style={{ fontSize: 20, fontWeight: 650 }} className="num">{r.score.total}</span></div>
              <div className="tiny muted">{r.scheme.summary} · {formatArea(r.score.raw.builtUp, units)} · {formatMoneyCompact(r.score.raw.total, doc.cost.currency)}</div>
              <div className="grid g4" style={{ gap: '4px 12px' }}>
                {METRICS.map((m) => <div key={m.id}><div className="row tiny"><span className="grow muted">{m.label}</span><span className="num">{r.score.metrics[m.id]}</span></div><div className="bar" style={{ height: 4 }}><i style={{ width: `${r.score.metrics[m.id]}%`, background: weights[m.id] > 1 ? 'var(--accent)' : 'var(--ink-4)' }} /></div></div>)}
              </div>
              <div className="row"><span className="spacer" /><button className="btn sm primary" onClick={() => {
                const ops = [{ type: 'option.create', params: { name: r.scheme.name, description: r.scheme.summary, style: r.scheme.style, building: r.scheme.building, scores: r.score.metrics } }];
                dispatch(ops, { label: `Generated scheme “${r.scheme.name}” added as a design option` });
              }}>Add as design option</button></div>
            </div>
          </div>
        ))}
        {!results.length && progress === null && <div className="card empty"><Sparkles size={22} /><div style={{ marginTop: 6 }}>Set your priorities and generate. Nine complete schemes are built, validated and costed in the background, then ranked.</div></div>}
      </div>
      <div className="card card-pad col" style={{ gap: 12 }}>
        <h3>Brief</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <label className="row small">Bedrooms <input type="number" min={1} max={7} className="input num" style={{ width: 54 }} value={program.bedrooms} onChange={(e) => setProgram({ ...program, bedrooms: Number(e.target.value) })} /></label>
          <label className="row small">Floors <input type="number" min={1} max={3} className="input num" style={{ width: 54 }} value={program.floors} onChange={(e) => setProgram({ ...program, floors: Number(e.target.value) })} /></label>
          {(['pooja', 'study', 'pool', 'garden'] as const).map((k) => <label key={k} className="row small" style={{ textTransform: 'capitalize' }}><input type="checkbox" checked={program[k]} onChange={(e) => setProgram({ ...program, [k]: e.target.checked })} />{k}</label>)}
        </div>
        <h3 style={{ marginTop: 6 }}>Priorities</h3>
        {METRICS.map((m) => (
          <div key={m.id}>
            <div className="row small"><span className="grow">{m.goal === 'max' ? 'Maximise' : 'Minimise'} {m.label.replace('Low ', '').toLowerCase()}</span><span className="muted tiny num">{weights[m.id]}×</span></div>
            <input type="range" min={0} max={3} step={0.5} value={weights[m.id]} onChange={(e) => setWeights({ ...weights, [m.id]: Number(e.target.value) })} aria-label={`Weight for ${m.label}`} />
          </div>
        ))}
        <button className="btn primary" onClick={run} disabled={progress !== null}><Sparkles size={14} /> Generate 9 schemes</button>
        <div className="tiny muted">Each scheme is a complete editable model on this site. Scores are normalised 0–100 from the derived model (daylight ratio, open area, bedroom placement, carpet/built-up efficiency, corridor share, cost per area, west glazing and design health).</div>
      </div>
    </div>
  );
}
