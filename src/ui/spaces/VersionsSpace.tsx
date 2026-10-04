/**
 * Version history — Git-like checkpoints of the whole project.
 *
 * A version is a full snapshot of the ProjectDoc, so comparing two of them is
 * an honest diff: both plans are drawn from their own models and every metric
 * (areas, counts, design health, cost) is recomputed from each snapshot by the
 * same derivation engine the live model uses. Restoring always checkpoints
 * the current state first, so nothing is ever lost.
 */
import { useEffect, useMemo, useState } from 'react';
import { GitBranch, GitCompare, RotateCcw, Save, Check, ArrowRight } from 'lucide-react';
import { useStore } from '../../state/store';
import { useDoc, useUnits } from '../../state/derived';
import { Avatar, Empty, Modal, relTime } from '../components';
import { can, userName } from '../../core/model/org';
import type { Id, ProjectDoc, VersionRecord } from '../../core/model/types';
import { activeBuilding, activeOption, levelsSorted } from '../../core/model/query';
import { resolveRules } from '../../core/rules/rulesets';
import { deriveLevel } from '../../core/derive/level';
import { validate } from '../../core/derive/validation';
import { estimateCost } from '../../core/derive/cost';
import { analyzeSite } from '../../core/derive/site';
import { formatArea, formatMoneyCompact, areaValue, areaUnitLabel, groupDigits, type CurrencyCode, type UnitSystem } from '../../core/units';
import { planThumbnail } from '../plan/thumbnail';

// ------------------------------------------------------------------ metrics

interface RoomArea { name: string; level: string; area: number }
interface Metrics {
  builtUp: number; carpet: number; rooms: number; walls: number; doors: number; windows: number; levels: number;
  health: number; cost: number; currency: CurrencyCode; roomAreas: Map<Id, RoomArea>;
}

/** Older snapshots may predate later schema fields; fill them without mutating the stored record. */
function normalize(doc: ProjectDoc): ProjectDoc {
  return { ...doc, underlays: doc.underlays ?? [], cost: { ...doc.cost, includeFFE: doc.cost?.includeFFE ?? false } };
}

const metricsCache = new WeakMap<ProjectDoc, Metrics | null>();

function metricsOf(raw: ProjectDoc): Metrics | null {
  if (metricsCache.has(raw)) return metricsCache.get(raw)!;
  let out: Metrics | null = null;
  try {
    const doc = normalize(raw);
    const b = activeBuilding(doc);
    const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides);
    const roomAreas = new Map<Id, RoomArea>();
    let carpet = 0;
    for (const l of levelsSorted(b)) {
      const dl = deriveLevel(b, l.id);
      for (const r of dl.rooms) {
        carpet += r.area;
        if (r.tagId) roomAreas.set(r.tagId, { name: r.name, level: l.name, area: r.area });
      }
    }
    const est = estimateCost(doc, b, rules);
    out = {
      builtUp: analyzeSite(doc, b, rules).builtUpArea, carpet,
      rooms: Object.keys(b.rooms).length, walls: Object.keys(b.walls).length, doors: Object.keys(b.doors).length,
      windows: Object.keys(b.windows).length, levels: Object.keys(b.levels).length,
      health: validate(doc, b, rules).score, cost: est.grandTotal, currency: est.currency, roomAreas,
    };
  } catch (e) {
    console.warn('[plinth] could not derive metrics for snapshot', e);
  }
  metricsCache.set(raw, out);
  return out;
}

function useNarrow(px: number): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= px);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const h = () => setNarrow(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [px]);
  return narrow;
}

const CURRENT = 'current';

// ---------------------------------------------------------------- the space

export default function VersionsSpace() {
  const versions = useStore((s) => s.versions);
  const narrow = useNarrow(900);
  const [a, setA] = useState<string>(() => versions[0]?.id ?? CURRENT);
  const [b, setB] = useState<string>(CURRENT);
  const [restoring, setRestoring] = useState<VersionRecord | null>(null);
  const compare = (id: string) => { setA(id); setB(CURRENT); };

  const history = <History selected={a} onCompare={compare} onRestore={setRestoring} />;
  const comparePane = <Compare a={a} b={b} setA={setA} setB={setB} />;

  return (
    <>
      {narrow ? (
        <div className="page">
          <div className="page-inner">
            <h1 className="page-title">Version history</h1>
            <div className="card" style={{ margin: '16px 0 24px' }}>{history}</div>
            {comparePane}
          </div>
        </div>
      ) : (
        <>
          <aside className="panel" aria-label="Version history" style={{ width: 360 }}>
            <div className="panel-head"><h2>Version history</h2><span className="muted small">{versions.length} versions</span></div>
            <div className="panel-body" style={{ padding: 0 }}>{history}</div>
          </aside>
          <section className="page" aria-label="Compare versions"><div className="page-inner">{comparePane}</div></section>
        </>
      )}
      {restoring && <RestoreModal v={restoring} onClose={() => setRestoring(null)} />}
    </>
  );
}

// ------------------------------------------------------------------ history

function History({ selected, onCompare, onRestore }: { selected: string; onCompare: (id: string) => void; onRestore: (v: VersionRecord) => void }) {
  const doc = useDoc();
  const versions = useStore((s) => s.versions);
  const role = useStore((s) => s.role);
  const createVersion = useStore((s) => s.createVersion);
  const dispatch = useStore((s) => s.dispatch);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<Id, boolean>>({});
  const canManage = can(role, 'version.manage');
  const pending = doc.pendingChanges;

  const save = async () => {
    if (!canManage || busy) return;
    setBusy(true);
    try { await createVersion(name.trim() || undefined); setName(''); } finally { setBusy(false); }
  };

  const branch = (v: VersionRecord) => {
    const opt = activeOption(v.snapshot);
    dispatch([{ type: 'option.create', params: {
      name: `From v${v.number}`, description: `Branched from version ${v.number} — ${v.name}`, style: opt.style,
      building: JSON.parse(JSON.stringify(opt.building)),
    } }]);
  };

  return (
    <div>
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--line)' }} className="col">
        <div className="row">
          <input className="input grow" placeholder={`Version ${(versions[0]?.number ?? 0) + 1} name, e.g. Client presentation`} aria-label="New version name"
            value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void save(); }} />
          <button className="btn primary" onClick={() => void save()} disabled={!canManage || busy}><Save size={14} /> Save version</button>
        </div>
        {!canManage && <div className="tiny muted">Your role can browse and compare versions but not create or restore them.</div>}
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="caps grow">Changes since v{versions[0]?.number ?? 0}</span>
            <span className={`chip ${pending.length ? 'accent' : ''}`} style={{ height: 19 }}>{pending.length}</span>
          </div>
          {pending.length ? (
            <ul className="impact" style={{ marginTop: 0, maxHeight: 132, overflow: 'auto' }}>
              {[...pending].reverse().map((c, i) => <li key={`${c}-${i}`}>{c}</li>)}
            </ul>
          ) : <div className="tiny muted">No model changes since the last version.</div>}
          {pending.length > 0 && <div className="tiny muted" style={{ marginTop: 6 }}>A version is saved automatically after 15 changes.</div>}
        </div>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: '8px 0' }} aria-label="Versions, newest first">
        {versions.map((v, i) => {
          const open = expanded[v.id];
          const shown = open ? v.changes : v.changes.slice(0, 3);
          const isSel = selected === v.id;
          return (
            <li key={v.id} style={{ display: 'flex', gap: 10, padding: '10px 14px', background: isSel ? 'var(--accent-softer)' : undefined }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 28, flex: 'none' }}>
                <span className="num" style={{ fontSize: 11, fontWeight: 600, height: 22, minWidth: 28, borderRadius: 6, display: 'grid', placeItems: 'center', background: v.auto ? 'var(--bg-sunken)' : 'var(--ink)', color: v.auto ? 'var(--ink-2)' : 'var(--surface)' }}>v{v.number}</span>
                {i < versions.length - 1 && <span style={{ flex: 1, width: 2, background: 'var(--line)', marginTop: 4 }} />}
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span style={{ fontWeight: 600 }} className="truncate grow">{v.name}</span>
                  <span className={`chip ${v.auto ? '' : 'accent'}`} style={{ height: 19, fontSize: 10.5 }}>{v.auto ? 'Auto' : 'Manual'}</span>
                </div>
                <div className="row tiny muted" style={{ gap: 6, marginTop: 3 }}>
                  <Avatar id={v.authorId} size={16} /> {userName(v.authorId)} · <span title={new Date(v.createdAt).toLocaleString()}>{relTime(v.createdAt)}</span>
                  {i === 0 && <span className="chip ok" style={{ height: 17, fontSize: 10 }}>Latest</span>}
                </div>
                <ul className="impact" style={{ marginTop: 6 }}>
                  {shown.map((c, k) => <li key={k}>{c}</li>)}
                </ul>
                {v.changes.length > 3 && (
                  <button className="more-toggle tiny" onClick={() => setExpanded((x) => ({ ...x, [v.id]: !open }))} aria-expanded={!!open}>
                    {open ? 'Show fewer' : `${v.changes.length - 3} more changes`}
                  </button>
                )}
                <div className="row" style={{ gap: 2, marginTop: 6, marginLeft: -8, flexWrap: 'wrap' }}>
                  <button className="btn ghost sm" aria-pressed={isSel} onClick={() => onCompare(v.id)}><GitCompare size={13} /> Compare</button>
                  <button className="btn ghost sm" disabled={!canManage} onClick={() => onRestore(v)}><RotateCcw size={13} /> Restore</button>
                  <button className="btn ghost sm" onClick={() => branch(v)} title="Create a design option from this version’s building"><GitBranch size={13} /> Branch as option</button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {!versions.length && <Empty title="No versions yet">Save a version to create a restorable checkpoint.</Empty>}
    </div>
  );
}

function RestoreModal({ v, onClose }: { v: VersionRecord; onClose: () => void }) {
  const restoreVersion = useStore((s) => s.restoreVersion);
  const pending = useDoc().pendingChanges.length;
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await restoreVersion(v.id); onClose(); } finally { setBusy(false); } };
  return (
    <Modal onClose={onClose} label={`Restore version ${v.number}`} width={480}>
      <div className="panel-head"><h2>Restore version {v.number}?</h2></div>
      <div style={{ padding: '14px 16px' }} className="col">
        <div><b style={{ fontWeight: 600 }}>{v.name}</b> <span className="muted">· {userName(v.authorId)} · {new Date(v.createdAt).toLocaleString()}</span></div>
        <div className="small subtle">
          The model, site, design options and settings will return to this version. Your current state{pending ? `, including ${pending} unsaved change${pending > 1 ? 's' : ''},` : ''} is saved first as an automatic version, so you can come back to it. Comments and activity are kept.
        </div>
      </div>
      <div className="row" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void go()} disabled={busy} autoFocus><RotateCcw size={14} /> Restore v{v.number}</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ compare

function Compare({ a, b, setA, setB }: { a: string; b: string; setA: (v: string) => void; setB: (v: string) => void }) {
  const doc = useDoc();
  const units = useUnits();
  const versions = useStore((s) => s.versions);
  const [levelIndex, setLevelIndex] = useState(0);

  const pick = (id: string): { doc: ProjectDoc; label: string; sub: string } => {
    const v = versions.find((x) => x.id === id);
    if (!v) return { doc, label: 'Current design', sub: `${doc.pendingChanges.length} change${doc.pendingChanges.length === 1 ? '' : 's'} since last version` };
    return { doc: v.snapshot, label: `v${v.number} · ${v.name}`, sub: `${userName(v.authorId)} · ${new Date(v.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` };
  };
  const A = pick(a), B = pick(b);
  const mA = useMemo(() => metricsOf(A.doc), [A.doc]);
  const mB = useMemo(() => metricsOf(B.doc), [B.doc]);
  const levelNames = useMemo(() => {
    const la = levelsSorted(activeBuilding(A.doc)).map((l) => l.name);
    const lb = levelsSorted(activeBuilding(B.doc)).map((l) => l.name);
    return (lb.length >= la.length ? lb : la);
  }, [A.doc, B.doc]);
  const li = Math.min(levelIndex, Math.max(0, levelNames.length - 1));
  const thumbA = useMemo(() => { try { return planThumbnail(normalize(A.doc), li); } catch { return ''; } }, [A.doc, li]);
  const thumbB = useMemo(() => { try { return planThumbnail(normalize(B.doc), li); } catch { return ''; } }, [B.doc, li]);

  const options = [{ id: CURRENT, label: 'Current design' }, ...versions.map((v) => ({ id: v.id, label: `v${v.number} · ${v.name}` }))];
  const same = a === b;

  return (
    <div className="col" style={{ gap: 18 }}>
      <div>
        <h1 className="page-title">Compare</h1>
        <div className="page-sub">Both sides are recomputed from their own snapshot — plans, areas, health and cost.</div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="field" style={{ minWidth: 220, flex: 1 }}>
          <label htmlFor="cmp-a">From</label>
          <select id="cmp-a" className="select" value={a} onChange={(e) => setA(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </div>
        <ArrowRight size={16} className="muted desktop-only" style={{ marginTop: 18 }} aria-hidden />
        <div className="field" style={{ minWidth: 220, flex: 1 }}>
          <label htmlFor="cmp-b">To</label>
          <select id="cmp-b" className="select" value={b} onChange={(e) => setB(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </div>
        {levelNames.length > 1 && (
          <div className="field">
            <label>Level</label>
            <div className="seg" role="group" aria-label="Level shown in plans">
              {levelNames.map((n, i) => <button key={i} aria-pressed={li === i} onClick={() => setLevelIndex(i)}>{n}</button>)}
            </div>
          </div>
        )}
      </div>
      {same && <div className="chip warn" style={{ alignSelf: 'flex-start' }}>Pick two different versions to see a difference.</div>}

      <div className="grid g2">
        {[{ s: A, svg: thumbA, tag: 'From' }, { s: B, svg: thumbB, tag: 'To' }].map(({ s, svg, tag }) => (
          <figure key={tag} className="card" style={{ margin: 0, overflow: 'hidden' }}>
            <div className="project-thumb" style={{ aspectRatio: '4 / 3' }}>
              {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} style={{ position: 'absolute', inset: 12 }} aria-label={`${s.label} plan`} role="img" /> : <div className="empty">Plan unavailable</div>}
              <span className="chip stage">{tag}</span>
            </div>
            <figcaption style={{ padding: '10px 14px' }}>
              <div style={{ fontWeight: 600 }} className="truncate">{s.label}</div>
              <div className="tiny muted">{s.sub} · {activeOption(s.doc).name}</div>
            </figcaption>
          </figure>
        ))}
      </div>

      <MetricsTable a={mA} b={mB} units={units} />
      <RoomChanges a={mA} b={mB} units={units} />
    </div>
  );
}

function Delta({ d, fmt, good }: { d: number; fmt: (v: number) => string; good?: 'up' | 'down' }) {
  if (Math.abs(d) < 1e-9) return <span className="muted">—</span>;
  const color = good ? ((d > 0) === (good === 'up') ? 'var(--ok)' : 'var(--err)') : 'var(--ink-2)';
  return <span style={{ color, fontWeight: 500 }}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))}</span>;
}

function MetricsTable({ a, b, units }: { a: Metrics | null; b: Metrics | null; units: UnitSystem }) {
  if (!a || !b) return <div className="card"><Empty title="Metrics unavailable">One of these snapshots could not be analysed.</Empty></div>;
  const area = (v: number) => formatArea(v, units);
  const count = (v: number) => groupDigits(v);
  const sameCur = a.currency === b.currency;
  const rows: { k: string; a: string; b: string; d: number; fmt: (v: number) => string; good?: 'up' | 'down' }[] = [
    { k: 'Built-up area', a: area(a.builtUp), b: area(b.builtUp), d: b.builtUp - a.builtUp, fmt: area },
    { k: 'Carpet area', a: area(a.carpet), b: area(b.carpet), d: b.carpet - a.carpet, fmt: area },
    { k: 'Levels', a: count(a.levels), b: count(b.levels), d: b.levels - a.levels, fmt: count },
    { k: 'Rooms', a: count(a.rooms), b: count(b.rooms), d: b.rooms - a.rooms, fmt: count },
    { k: 'Walls', a: count(a.walls), b: count(b.walls), d: b.walls - a.walls, fmt: count },
    { k: 'Doors', a: count(a.doors), b: count(b.doors), d: b.doors - a.doors, fmt: count },
    { k: 'Windows', a: count(a.windows), b: count(b.windows), d: b.windows - a.windows, fmt: count },
    { k: 'Design health', a: `${a.health}`, b: `${b.health}`, d: b.health - a.health, fmt: count, good: 'up' },
    { k: 'Estimated cost', a: formatMoneyCompact(a.cost, a.currency), b: formatMoneyCompact(b.cost, b.currency), d: sameCur ? b.cost - a.cost : 0, fmt: (v) => formatMoneyCompact(v, b.currency) },
  ];
  return (
    <div className="card">
      <div className="panel-head"><h2>Metrics</h2><span className="muted small">Active design option of each snapshot</span></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Metric</th><th className="r">From</th><th className="r">To</th><th className="r">Change</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}><td>{r.k}</td><td className="r">{r.a}</td><td className="r">{r.b}</td><td className="r"><Delta d={r.d} fmt={r.fmt} good={r.good} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sameCur && <div className="tiny muted" style={{ padding: '8px 14px' }}>Cost is shown in each snapshot’s own currency; no difference is computed across currencies.</div>}
    </div>
  );
}

function RoomChanges({ a, b, units }: { a: Metrics | null; b: Metrics | null; units: UnitSystem }) {
  if (!a || !b) return null;
  const EPS = 10_000; // 0.01 m² — below drawing precision
  const rows: { id: Id; name: string; level: string; a?: number; b?: number; status: 'added' | 'removed' | 'changed' | 'renamed'; note?: string }[] = [];
  for (const [id, rb] of b.roomAreas) {
    const ra = a.roomAreas.get(id);
    if (!ra) rows.push({ id, name: rb.name, level: rb.level, b: rb.area, status: 'added' });
    else if (Math.abs(rb.area - ra.area) > EPS) rows.push({ id, name: rb.name, level: rb.level, a: ra.area, b: rb.area, status: 'changed', note: ra.name !== rb.name ? `was ${ra.name}` : undefined });
    else if (ra.name !== rb.name) rows.push({ id, name: rb.name, level: rb.level, a: ra.area, b: rb.area, status: 'renamed', note: `was ${ra.name}` });
  }
  for (const [id, ra] of a.roomAreas) if (!b.roomAreas.has(id)) rows.push({ id, name: ra.name, level: ra.level, a: ra.area, status: 'removed' });
  const order = { added: 0, removed: 1, changed: 2, renamed: 3 };
  rows.sort((x, y) => order[x.status] - order[y.status] || Math.abs((y.b ?? 0) - (y.a ?? 0)) - Math.abs((x.b ?? 0) - (x.a ?? 0)));
  const chip = { added: 'ok', removed: 'err', changed: 'accent', renamed: '' } as const;
  const label = { added: 'Added', removed: 'Removed', changed: 'Resized', renamed: 'Renamed' } as const;
  const unchanged = [...b.roomAreas.keys()].filter((id) => a.roomAreas.has(id)).length - rows.filter((r) => r.status === 'changed' || r.status === 'renamed').length;
  const fmtDelta = (v: number) => `${groupDigits(areaValue(v, units), units === 'metric' ? 1 : 0)} ${areaUnitLabel(units)}`;
  return (
    <div className="card">
      <div className="panel-head"><h2>Room changes</h2><span className="muted small">{rows.length ? `${rows.length} changed · ${Math.max(0, unchanged)} unchanged` : 'No room changes'}</span></div>
      {rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Room</th><th>Level</th><th className="r">From</th><th className="r">To</th><th className="r">Change</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span style={{ fontWeight: 500 }}>{r.name}</span>{r.note && <span className="tiny muted"> · {r.note}</span>}</td>
                  <td className="muted">{r.level}</td>
                  <td className="r">{r.a !== undefined ? formatArea(r.a, units) : '—'}</td>
                  <td className="r">{r.b !== undefined ? formatArea(r.b, units) : '—'}</td>
                  <td className="r"><Delta d={(r.b ?? 0) - (r.a ?? 0)} fmt={fmtDelta} /></td>
                  <td className="r"><span className={`chip ${chip[r.status]}`} style={{ height: 19 }}>{label[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty small"><Check size={16} style={{ verticalAlign: -3 }} /> Every room has the same name and area in both.</div>
      )}
    </div>
  );
}
