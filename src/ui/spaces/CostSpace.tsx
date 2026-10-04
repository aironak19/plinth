/** Quantity takeoff & cost estimation — measured from the model, priced from configurable rates. */
import { useMemo, useState } from 'react';
import { Download, Wand, Info } from 'lucide-react';
import { useStore } from '../../state/store';
import { useCost, useDoc, useRules, useUnits, useLevels } from '../../state/derived';
import { estimateCost, materialAlternativesFor } from '../../core/derive/cost';
import { validate } from '../../core/derive/validation';
import { formatArea, formatMoney, formatMoneyCompact, groupDigits, type CurrencyCode } from '../../core/units';
import { getMaterial } from '../../core/catalog/materials';
import { NumberInput, Switch, swatchStyle } from '../components';
import { computeImpact } from '../../core/ai/impact';
import { fxFor } from '../../core/model/factory';

const UNIT: Record<string, string> = { m2: 'm²', m3: 'm³', nos: 'nos', rm: 'rm' };
const CAT_COLOR = ['#3358d4', '#5b7be0', '#7e98e8', '#a3b6ef', '#c4cff3', '#9aa3b5', '#b9bfcc', '#d3d7df', '#e3e5ea'];

export default function CostSpace() {
  const doc = useDoc();
  const cost = useCost();
  const units = useUnits();
  const rules = useRules();
  const levels = useLevels();
  const dispatch = useStore((s) => s.dispatch);
  const cur = cost.currency as CurrencyCode;
  const M = (v: number) => formatMoneyCompact(v, cur);
  const [tab, setTab] = useState<'takeoff' | 'scenarios' | 'alternatives' | 'settings'>('takeoff');
  const s = cost.takeoff.summary;
  const qtyArea = (m2: number) => (units === 'metric' ? `${groupDigits(m2, 0)} m²` : `${groupDigits(m2 * 10.7639, 0)} sq ft`);
  const max = cost.byCategory[0]?.total ?? 1;

  const csv = () => {
    const rows = [['Category', 'Item', 'Quantity', 'Unit', `Rate (${cur})`, `Total (${cur})`], ...cost.lines.map((l) => [l.category, l.item, l.quantity.toFixed(2), UNIT[l.unit], l.rate.toFixed(0), l.total.toFixed(0)])];
    const blob = new Blob([rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${doc.meta.name.replace(/\W+/g, '-')}-BOQ.csv`; a.click();
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="row" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
          <div className="grow"><h1 className="page-title">Quantities & cost</h1><div className="page-sub">Every quantity is measured from the model, net of openings — change the design and this page updates.</div></div>
          <button className="btn" onClick={csv}><Download size={14} /> Export BOQ (CSV)</button>
        </div>
        <div className="grid g4" style={{ marginBottom: 18 }}>
          <div className="card card-pad stat"><div className="k">Estimated project cost</div><div className="v">{M(cost.grandTotal)}</div><div className="tiny muted">incl. margin, contingency & tax</div></div>
          <div className="card card-pad stat"><div className="k">Cost per {units === 'metric' ? 'm²' : 'sq ft'}</div><div className="v">{M(units === 'metric' ? cost.perM2 : cost.perSqft)}</div><div className="tiny muted">on {formatArea(cost.builtUpM2 * 1e6, units)} built-up</div></div>
          <div className="card card-pad stat"><div className="k">Material · labour</div><div className="v">{M(cost.materialTotal)}</div><div className="tiny muted">+ {M(cost.labourTotal)} labour</div></div>
          <div className="card card-pad stat"><div className="k">Loose furniture (FF&E)</div><div className="v">{M(cost.ffeTotal)}</div><div className="tiny muted">{doc.cost.includeFFE ? 'included in total' : 'listed separately'}</div></div>
        </div>
        <div className="seg" style={{ marginBottom: 16 }}>
          {([['takeoff', 'Takeoff & estimate'], ['scenarios', 'Design option comparison'], ['alternatives', 'Material alternatives'], ['settings', 'Rates & assumptions']] as const).map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {tab === 'takeoff' && (
          <div className="grid g12">
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="panel-head"><h2>Bill of quantities</h2><span className="muted small">{cost.lines.length} lines</span></div>
              <div className="scroll" style={{ maxHeight: 620 }}>
                <table className="table">
                  <thead><tr><th>Item</th><th className="r">Quantity</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead>
                  <tbody>
                    {[...new Set(cost.lines.map((l) => l.category))].map((cat) => (
                      <CategoryRows key={cat} cat={cat} lines={cost.lines.filter((l) => l.category === cat)} cur={cur} excluded={cat === 'Furniture' && !doc.cost.includeFFE} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="col" style={{ gap: 16 }}>
              <div className="card card-pad">
                <h3 style={{ marginBottom: 12 }}>Cost by category</h3>
                {cost.byCategory.map((c, i) => (
                  <div key={c.category} style={{ marginBottom: 9 }}>
                    <div className="row small"><span className="grow">{c.category}</span><b className="num">{M(c.total)}</b><span className="tiny muted num" style={{ width: 38, textAlign: 'right' }}>{((c.total / cost.grandTotal) * 100).toFixed(0)}%</span></div>
                    <div className="bar" style={{ marginTop: 3 }}><i style={{ width: `${(c.total / max) * 100}%`, background: CAT_COLOR[Math.min(i, CAT_COLOR.length - 1)] }} /></div>
                  </div>
                ))}
              </div>
              <div className="card card-pad">
                <h3 style={{ marginBottom: 10 }}>Cost by level</h3>
                {cost.byLevel.map((l) => <div key={l.levelId} className="row small" style={{ minHeight: 26 }}><span className="grow">{levels.find((x) => x.id === l.levelId)?.name ?? 'Site'}</span><b className="num">{M(l.total)}</b></div>)}
              </div>
              <div className="card card-pad">
                <h3 style={{ marginBottom: 10 }}>Material takeoff</h3>
                {[['Floor finishes', qtyArea(s.floorArea)], ['Tiles (floor + wall)', qtyArea(s.tileArea)], ['Paint', qtyArea(s.paintArea)], ['Exterior wall area', qtyArea(s.exteriorWallArea)], ['Roof area', qtyArea(s.roofArea)], ['Concrete', `${s.concreteVolume.toFixed(1)} m³`], ['Masonry', `${s.masonryVolume.toFixed(1)} m³`], ['Doors', String(s.doors)], ['Windows', `${s.windows} · ${qtyArea(s.glazingArea)} glazing`]].map(([k, v]) => <div key={k} className="row small" style={{ minHeight: 26 }}><span className="grow muted">{k}</span><b className="num">{v}</b></div>)}
              </div>
              <div className="card card-pad small muted"><div className="row" style={{ marginBottom: 6, color: 'var(--ink-2)' }}><Info size={13} /> <b>Assumptions</b></div>{cost.assumptions.map((a) => <div key={a} style={{ marginBottom: 4 }}>{a}</div>)}</div>
            </div>
          </div>
        )}

        {tab === 'scenarios' && <Scenarios />}
        {tab === 'alternatives' && <Alternatives />}
        {tab === 'settings' && (
          <div className="grid g2">
            <div className="card card-pad col" style={{ gap: 10 }}>
              <h3>Commercial assumptions</h3>
              <div className="prop"><span>Currency</span><select className="select" value={doc.cost.currency} onChange={(e) => { const c = e.target.value as CurrencyCode; dispatch([{ type: 'cost.update', params: { patch: { currency: c, fxPerInr: fxFor(c) } } }, { type: 'project.update', params: { patch: { currency: c } } }]); }}>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="prop"><span>FX per ₹1</span><NumberInput value={Number(doc.cost.fxPerInr.toFixed(5))} onCommit={(v) => dispatch([{ type: 'cost.update', params: { patch: { fxPerInr: v } } }])} /></div>
              <div className="prop"><span>Labour factor</span><NumberInput value={doc.cost.labourFactor} suffix="×" onCommit={(v) => dispatch([{ type: 'cost.update', params: { patch: { labourFactor: v } } }])} /></div>
              <div className="prop"><span>Contractor margin</span><NumberInput value={Math.round(doc.cost.contractorMargin * 100)} suffix="%" onCommit={(v) => dispatch([{ type: 'cost.update', params: { patch: { contractorMargin: v / 100 } } }])} /></div>
              <div className="prop"><span>Contingency</span><NumberInput value={Math.round(doc.cost.contingency * 100)} suffix="%" onCommit={(v) => dispatch([{ type: 'cost.update', params: { patch: { contingency: v / 100 } } }])} /></div>
              <div className="prop"><span>Tax (GST)</span><NumberInput value={Math.round(doc.cost.taxRate * 100)} suffix="%" onCommit={(v) => dispatch([{ type: 'cost.update', params: { patch: { taxRate: v / 100 } } }])} /></div>
              <div className="prop"><span>Include FF&E</span><Switch checked={doc.cost.includeFFE} onChange={(v) => dispatch([{ type: 'cost.update', params: { patch: { includeFFE: v } } }])} /></div>
              <div className="field"><label>Rate source (shown on every estimate)</label><textarea className="textarea" defaultValue={doc.cost.source} onBlur={(e) => e.target.value !== doc.cost.source && dispatch([{ type: 'cost.update', params: { patch: { source: e.target.value } } }])} /></div>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="panel-head"><h2>Material supply rates (₹)</h2><span className="muted small">Override any rate for this project</span></div>
              <div className="scroll" style={{ maxHeight: 520 }}>
                <table className="table">
                  <thead><tr><th>Material</th><th className="r">Catalogue</th><th className="r">Project rate</th></tr></thead>
                  <tbody>{[...new Set(cost.lines.filter((l) => l.materialId && l.directCost === undefined).map((l) => l.materialId!))].map((id) => {
                    const m = getMaterial(id);
                    const ov = doc.cost.rateOverrides[id];
                    return (
                      <tr key={id}><td><span className="row"><span className="swatch" style={swatchStyle(m)} />{m.name}</span></td><td className="r muted">₹{m.rate.toLocaleString('en-IN')}/{UNIT[m.costUnit]}</td>
                        <td className="r" style={{ width: 140 }}><NumberInput value={ov ?? m.rate} onCommit={(v) => dispatch([{ type: 'cost.update', params: { patch: { rateOverrides: { ...doc.cost.rateOverrides, [id]: v } } } }])} /></td></tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        <div className="tiny muted" style={{ marginTop: 18 }}>Rule set: {rules.name}. Estimates are for planning and budgeting; obtain contractor quotations for tendering.</div>
      </div>
    </div>
  );
}

function CategoryRows({ cat, lines, cur, excluded }: { cat: string; lines: ReturnType<typeof useCost>['lines']; cur: CurrencyCode; excluded: boolean }) {
  const [open, setOpen] = useState(cat !== 'Furniture');
  const total = lines.reduce((s, l) => s + l.total, 0);
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}><td colSpan={3} style={{ fontWeight: 600, background: 'var(--surface-2)' }}>{open ? '▾' : '▸'} {cat}{excluded && <span className="chip" style={{ marginLeft: 8, height: 18 }}>not in total</span>}</td><td className="r" style={{ fontWeight: 600, background: 'var(--surface-2)' }}>{formatMoneyCompact(total, cur)}</td></tr>
      {open && lines.map((l) => (
        <tr key={l.key}>
          <td><span className="row">{l.materialId && <span className="swatch" style={{ ...swatchStyle(getMaterial(l.materialId)), width: 12, height: 12 }} />}{l.item}</span></td>
          <td className="r num">{l.quantity < 10 ? l.quantity.toFixed(2) : groupDigits(l.quantity, 0)} {UNIT[l.unit]}</td>
          <td className="r num muted">{formatMoney(l.rate, cur)}</td>
          <td className="r num">{formatMoney(l.total, cur)}</td>
        </tr>
      ))}
    </>
  );
}

function Scenarios() {
  const doc = useDoc();
  const rules = useRules();
  const units = useUnits();
  const dispatch = useStore((s) => s.dispatch);
  const rows = useMemo(() => doc.options.map((o) => {
    const e = estimateCost(doc, o.building, rules);
    const h = validate(doc, o.building, rules);
    return { o, e, h };
  }), [doc, rules]);
  const base = rows.find((r) => r.o.id === doc.activeOptionId) ?? rows[0];
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="panel-head"><h2>Design options — same site, same rates</h2></div>
      <table className="table">
        <thead><tr><th>Option</th><th>Style</th><th className="r">Built-up</th><th className="r">Estimate</th><th className="r">Per {units === 'metric' ? 'm²' : 'sq ft'}</th><th className="r">vs active</th><th className="r">Health</th><th /></tr></thead>
        <tbody>{rows.map(({ o, e, h }) => (
          <tr key={o.id}>
            <td><b>{o.name}</b><div className="tiny muted">{o.description}</div></td>
            <td style={{ textTransform: 'capitalize' }}>{o.style}</td>
            <td className="r num">{formatArea(e.builtUpM2 * 1e6, units)}</td>
            <td className="r num">{formatMoneyCompact(e.grandTotal, e.currency)}</td>
            <td className="r num">{formatMoneyCompact(units === 'metric' ? e.perM2 : e.perSqft, e.currency)}</td>
            <td className="r num" style={{ color: e.grandTotal > base.e.grandTotal ? 'var(--err)' : e.grandTotal < base.e.grandTotal ? 'var(--ok)' : undefined }}>{o.id === base.o.id ? '—' : `${e.grandTotal > base.e.grandTotal ? '+' : '−'}${formatMoneyCompact(Math.abs(e.grandTotal - base.e.grandTotal), e.currency)}`}</td>
            <td className="r"><span className={`chip ${h.score >= 90 ? 'ok' : h.score >= 75 ? 'warn' : 'err'}`}>{h.score}</span></td>
            <td className="r">{o.id !== doc.activeOptionId && <button className="btn sm" onClick={() => dispatch([{ type: 'option.switch', params: { id: o.id } }])}>Make active</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      {rows.length < 2 && <div className="empty small">Create design options (top bar → option menu, or ask Architect AI for alternatives) to compare them here.</div>}
    </div>
  );
}

function Alternatives() {
  const doc = useDoc();
  const cost = useCost();
  const dispatch = useStore((s) => s.dispatch);
  const units = useUnits();
  const alts = useMemo(() => materialAlternativesFor(cost, doc.cost).slice(0, 14), [cost, doc.cost]);
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className="grid g2">
      {alts.map((a) => {
        const key = `${a.current.id}>${a.alternative.id}`;
        const ops = [{ type: 'material.replaceGlobal', params: { from: a.current.id, to: a.alternative.id } }];
        const imp = preview === key ? computeImpact(doc, ops) : null;
        return (
          <div key={key} className="card card-pad col" style={{ gap: 8 }}>
            <div className="row">
              <span className="swatch" style={{ ...swatchStyle(a.current), width: 34, height: 34 }} />
              <div className="grow"><div className="tiny muted">Current</div><b>{a.current.name}</b></div>
              <span className="muted">→</span>
              <span className="swatch" style={{ ...swatchStyle(a.alternative), width: 34, height: 34 }} />
              <div className="grow"><div className="tiny muted">Alternative</div><b>{a.alternative.name}</b></div>
            </div>
            <div className="grid g3" style={{ gap: 8 }}>
              <div className="stat"><div className="k">Estimated saving</div><div className="num" style={{ fontWeight: 650, color: 'var(--ok)' }}>{formatMoneyCompact(a.saving, doc.cost.currency)}</div></div>
              <div className="stat"><div className="k">Visual impact</div><div style={{ fontWeight: 600 }}>{a.visualImpact}</div></div>
              <div className="stat"><div className="k">Durability</div><div style={{ fontWeight: 600 }}>{a.durability}</div></div>
            </div>
            <div className="tiny muted">On {units === 'metric' ? `${a.quantity.toFixed(0)} m²` : `${(a.quantity * 10.764).toFixed(0)} sq ft`}, using project rates. Visual impact compares colour and family; durability uses the catalogue rating.</div>
            {imp?.ok && <div className="tiny" style={{ color: 'var(--ink-2)' }}>{imp.lines.join(' · ')} · health {imp.health.before} → {imp.health.after}</div>}
            <div className="row"><button className="btn sm" onClick={() => setPreview(preview === key ? null : key)}><Wand size={12} /> {preview === key ? 'Hide preview' : 'Preview change'}</button><span className="spacer" /><button className="btn sm primary" onClick={() => dispatch(ops)}>Apply everywhere</button></div>
          </div>
        );
      })}
      {!alts.length && <div className="empty">No cheaper like-for-like materials in the library for this design.</div>}
    </div>
  );
}
