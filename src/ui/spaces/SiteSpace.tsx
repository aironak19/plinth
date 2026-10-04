/**
 * Site planning: draw or edit any plot polygon, set per-edge setbacks and road
 * frontage, orient north, place landscape — and see the buildable zone,
 * coverage, FAR and violations recalculate as you drag.
 */
import { useMemo, useRef, useState } from 'react';
import { Compass, Plus, TriangleAlert, CircleCheck, Trash, Wand } from 'lucide-react';
import { useStore } from '../../state/store';
import { useBuilding, useDoc, useRules, useSite, useUnits, useLevels } from '../../state/derived';
import { buildableZone, analyzeSite } from '../../core/derive/site';
import { deriveLevel } from '../../core/derive/level';
import { bbox, ensureCCW, rectPolygon } from '../../core/geometry/polygon';
import { formatArea, formatLength, ft } from '../../core/units';
import { LengthInput, NumberInput, Prop } from '../components';
import { computeImpact } from '../../core/ai/impact';
import type { SiteFeatureKind } from '../../core/model/types';
import type { Vec2 } from '../../core/geometry/vec';
import { ringD } from '../plan/planUtils';

const FEATURE_KINDS: { kind: SiteFeatureKind; label: string; material: string }[] = [
  { kind: 'pool', label: 'Pool', material: 'pool-water' }, { kind: 'deck', label: 'Deck', material: 'deck-wood' },
  { kind: 'driveway', label: 'Driveway', material: 'paver' }, { kind: 'parking', label: 'Parking bay', material: 'paver' },
  { kind: 'pathway', label: 'Pathway', material: 'kota' }, { kind: 'lawn', label: 'Lawn', material: 'lawn' },
];

export default function SiteSpace() {
  const doc = useDoc();
  const b = useBuilding();
  const units = useUnits();
  const rules = useRules();
  const site = useSite();
  const levels = useLevels();
  const dispatch = useStore((s) => s.dispatch);
  const [edge, setEdge] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ i: number; p: Vec2 } | null>(null);
  const [adding, setAdding] = useState<SiteFeatureKind | null>(null);
  const [rect, setRect] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const boundary = useMemo(() => {
    const bd = ensureCCW(doc.site.boundary);
    if (!drag) return bd;
    return bd.map((p, i) => (i === drag.i ? drag.p : p));
  }, [doc.site.boundary, drag]);
  const liveSite = useMemo(() => ({ ...doc.site, boundary }), [doc.site, boundary]);
  const zone = useMemo(() => buildableZone(liveSite), [liveSite]);
  const analysis = useMemo(() => (drag ? analyzeSite({ ...doc, site: liveSite }, b, rules) : site), [drag, doc, liveSite, b, rules, site]);
  const ground = levels.find((l) => l.elevation >= 0) ?? levels[0];
  const footprint = ground ? deriveLevel(b, ground.id).footprint : [];

  const bb = bbox([...boundary, ...footprint.flat()]);
  const pad = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) * 0.16;
  const vb = { x: bb.minX - pad, y: -(bb.maxY + pad), w: bb.maxX - bb.minX + 2 * pad, h: bb.maxY - bb.minY + 2 * pad };
  const k = vb.w / 900; // world units per ~screen px
  const snapStep = units === 'metric' ? 250 : ft(0.5);
  const toWorld = (e: React.PointerEvent): Vec2 => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.round(p.x / snapStep) * snapStep, y: Math.round(-p.y / snapStep) * snapStep };
  };

  const fixOps = (s: typeof site.setbacks[number]) => {
    const move = s.required - s.actual + 25;
    return [{ type: 'building.translate', params: { delta: { x: Math.round(s.inward.x * move), y: Math.round(s.inward.y * move) } } }];
  };

  const e = edge !== null ? doc.site.edges[edge] : null;
  const edgeLen = (i: number) => { const a = boundary[i], c = boundary[(i + 1) % boundary.length]; return Math.hypot(c.x - a.x, c.y - a.y); };
  const north = doc.site.northAngle;

  return (
    <>
      <div className="canvas-wrap">
        <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: adding ? 'crosshair' : 'default' }} role="application" aria-label="Site plan editor"
          onPointerMove={(ev) => { if (drag) setDrag({ ...drag, p: toWorld(ev) }); if (rect) setRect({ ...rect, b: toWorld(ev) }); }}
          onPointerUp={() => {
            if (drag) { const nb = boundary.map((p) => ({ x: p.x, y: p.y })); dispatch([{ type: 'site.update', params: { boundary: nb } }], { label: 'Plot boundary reshaped' }); setDrag(null); }
            if (rect && adding) {
              const x = Math.min(rect.a.x, rect.b.x), y = Math.min(rect.a.y, rect.b.y), w = Math.abs(rect.b.x - rect.a.x), h = Math.abs(rect.b.y - rect.a.y);
              if (w > 500 && h > 500) { const fk = FEATURE_KINDS.find((f) => f.kind === adding)!; dispatch([{ type: 'site.feature.create', params: { kind: adding, name: fk.label, polygon: rectPolygon(x, y, w, h), materialId: fk.material, props: adding === 'parking' ? { spaces: Math.max(1, Math.floor(w / 2600)) } : {} } }]); }
              setRect(null); setAdding(null);
            }
          }}
          onPointerDown={(ev) => { if (adding) { const p = toWorld(ev); setRect({ a: p, b: p }); } }}
>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="var(--paper)" />
          {/* roads */}
          {boundary.map((p, i) => {
            const ed = doc.site.edges[i];
            if (!ed?.road) return null;
            const q = boundary[(i + 1) % boundary.length];
            const L = edgeLen(i);
            const u = { x: (q.x - p.x) / L, y: (q.y - p.y) / L };
            const n = { x: u.y, y: -u.x };
            const w = ed.road.width;
            const poly = [{ x: p.x - u.x * pad, y: p.y - u.y * pad }, { x: q.x + u.x * pad, y: q.y + u.y * pad }, { x: q.x + u.x * pad + n.x * w, y: q.y + u.y * pad + n.y * w }, { x: p.x - u.x * pad + n.x * w, y: p.y - u.y * pad + n.y * w }];
            const m = { x: (p.x + q.x) / 2 + n.x * w / 2, y: (p.y + q.y) / 2 + n.y * w / 2 };
            return <g key={`r${i}`}><path d={ringD(poly)} fill="#d9d6d0" /><text x={m.x} y={-m.y} textAnchor="middle" fontSize={k * 12} fill="var(--ink-3)">{ed.road.name} · {formatLength(ed.road.width, units)}</text></g>;
          })}
          <path d={ringD(boundary)} fill="rgba(143,174,107,0.16)" stroke="var(--ink-2)" strokeWidth={k * 1.6} strokeDasharray={`${k * 12} ${k * 5} ${k * 2} ${k * 5}`} />
          {zone.map((z, i) => <path key={i} d={ringD(z.outer) + z.holes.map(ringD).join('')} fill="rgba(51,88,212,0.06)" stroke="var(--accent)" strokeWidth={k} strokeDasharray={`${k * 6} ${k * 4}`} />)}
          {Object.values(doc.site.features).map((f) => f.polygon && <path key={f.id} d={ringD(f.polygon)} fill={f.kind === 'pool' ? 'rgba(95,180,201,0.45)' : f.kind === 'deck' ? 'rgba(155,107,68,0.25)' : f.kind === 'lawn' ? 'rgba(143,174,107,0.3)' : 'rgba(150,145,135,0.22)'} stroke="var(--plan-light)" strokeWidth={k * 0.8} />)}
          {footprint.map((f, i) => <path key={i} d={ringD(f)} fill="var(--poche)" fillOpacity={0.82} />)}
          {analysis.violations.map((v, i) => <path key={`v${i}`} d={ringD(v.outer)} fill="rgba(194,65,58,0.55)" stroke="var(--err)" strokeWidth={k * 1.4} />)}
          {analysis.setbacks.map((s) => !s.ok && <line key={`s${s.edge}`} x1={s.from.x} y1={-s.from.y} x2={s.to.x} y2={-s.to.y} stroke="var(--err)" strokeWidth={k * 1.5} />)}
          {boundary.map((p, i) => {
            const q = boundary[(i + 1) % boundary.length];
            const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
            const L = edgeLen(i);
            const n = { x: (q.y - p.y) / L, y: -(q.x - p.x) / L };
            const ed = doc.site.edges[i];
            const t = { x: m.x + n.x * k * 26, y: m.y + n.y * k * 26 };
            const ang = (Math.atan2(-(q.y - p.y), q.x - p.x) * 180) / Math.PI;
            const rot = ang > 90 || ang < -90 ? ang + 180 : ang;
            return (
              <g key={`e${i}`} onPointerDown={(ev) => { ev.stopPropagation(); setEdge(i); }} style={{ cursor: 'pointer' }}>
                <line x1={p.x} y1={-p.y} x2={q.x} y2={-q.y} stroke={edge === i ? 'var(--accent)' : 'transparent'} strokeWidth={k * 10} strokeOpacity={0.35} />
                <text x={t.x} y={-t.y} textAnchor="middle" fontSize={k * 15} fontWeight={600} fill={edge === i ? 'var(--accent)' : 'var(--ink)'} transform={`rotate(${rot} ${t.x} ${-t.y})`}>{formatLength(L, units)}</text>
                <text x={t.x} y={-t.y + k * 14} textAnchor="middle" fontSize={k * 12.5} fill="var(--ink-3)" transform={`rotate(${rot} ${t.x} ${-t.y})`}>{ed?.kind ?? 'side'} · {formatLength(ed?.setback ?? 0, units)}</text>
              </g>
            );
          })}
          {boundary.map((p, i) => <circle key={`h${i}`} cx={p.x} cy={-p.y} r={k * 6} fill="var(--surface)" stroke="var(--accent)" strokeWidth={k * 2} style={{ cursor: 'move' }} onPointerDown={(ev) => { ev.stopPropagation(); (ev.target as Element).setPointerCapture(ev.pointerId); setDrag({ i, p }); }} aria-label={`Plot corner ${i + 1}`} />)}
          {rect && <rect x={Math.min(rect.a.x, rect.b.x)} y={-Math.max(rect.a.y, rect.b.y)} width={Math.abs(rect.b.x - rect.a.x)} height={Math.abs(rect.b.y - rect.a.y)} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={k} />}
          <g transform={`translate(${vb.x + vb.w - pad * 0.55} ${vb.y + pad * 0.6}) rotate(${north})`}>
            <circle r={pad * 0.32} fill="var(--surface)" stroke="var(--ink-3)" strokeWidth={k} />
            <path d={`M0 ${-pad * 0.28} L${pad * 0.09} ${pad * 0.12} L0 ${pad * 0.05} L${-pad * 0.09} ${pad * 0.12}Z`} fill="var(--ink)" />
            <text y={-pad * 0.36} textAnchor="middle" fontSize={k * 12} fontWeight={700} fill="var(--ink)">N</text>
          </g>
        </svg>
        <div className="floating ctxbar" style={{ top: 12, left: 12, transform: 'none' }}>
          <span className="title">Add to site</span><span className="sep" />
          {FEATURE_KINDS.map((f) => <button key={f.kind} aria-pressed={adding === f.kind} style={adding === f.kind ? { color: 'var(--accent)' } : undefined} onClick={() => setAdding(adding === f.kind ? null : f.kind)}><Plus size={12} /> {f.label}</button>)}
        </div>
        {adding && <div className="hint">Drag a rectangle on the site to add a {adding}</div>}
        {!adding && <div className="hint" style={{ top: 'auto', bottom: 16 }}>Drag the blue corners to reshape the plot · click an edge to set its setback and road</div>}
      </div>
      <aside className="panel right" style={{ width: 330 }} aria-label="Site analysis">
        <div className="panel-head"><h2>Site & zoning</h2><span className="chip">{rules.name.split(' — ')[0]}</span></div>
        <div className="panel-body">
          <div className="panel-section">
            <div className="grid g2" style={{ gap: 10 }}>
              {[['Plot area', formatArea(analysis.plotArea, units)], ['Perimeter', formatLength(analysis.plotPerimeter, units)], ['Buildable zone', formatArea(analysis.buildableArea, units)], ['Open area', formatArea(analysis.openArea, units)]].map(([a, v]) => <div key={a} className="stat"><div className="k">{a}</div><div className="num" style={{ fontWeight: 600, fontSize: 15 }}>{v}</div></div>)}
            </div>
          </div>
          <div className="panel-section col" style={{ gap: 10 }}>
            <Meter label="Ground coverage" value={analysis.coverage} max={rules.values.maxCoverage} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
            <Meter label="FAR / FSI" value={analysis.far} max={rules.values.maxFar} fmt={(v) => v.toFixed(2)} />
            <Meter label="Building height" value={analysis.buildingHeight} max={rules.values.maxHeight} fmt={(v) => formatLength(v, units)} />
            <Meter label="Floors" value={analysis.floors} max={rules.values.maxFloors} fmt={(v) => String(v)} />
            <Meter label="Parking spaces" value={Math.max(analysis.parkingProvided, Object.values(b.furniture).filter((f) => f.assetId.startsWith('car-')).length)} max={rules.values.parkingPerUnit} fmt={(v) => String(v)} atLeast />
          </div>
          <div className="panel-section">
            <div className="caps" style={{ marginBottom: 8 }}>Setbacks</div>
            {analysis.setbacks.map((s) => (
              <div key={s.edge} className="row" style={{ minHeight: 34, alignItems: 'flex-start', padding: '4px 0' }}>
                {s.ok ? <CircleCheck size={15} style={{ color: 'var(--ok)', marginTop: 2 }} /> : <TriangleAlert size={15} style={{ color: 'var(--err)', marginTop: 2 }} />}
                <div className="grow" onClick={() => setEdge(s.edge)} style={{ cursor: 'pointer' }}>
                  <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{s.kind} · edge {s.edge + 1}</div>
                  <div className="tiny muted num">Required {formatLength(s.required, units)} · current {formatLength(s.actual, units)}</div>
                </div>
                {!s.ok && <FixButton ops={fixOps(s)} />}
              </div>
            ))}
            {!analysis.setbacks.length && <div className="small muted">Add walls to see setback checks.</div>}
          </div>
          {e && edge !== null && (
            <div className="panel-section">
              <div className="caps" style={{ marginBottom: 8 }}>Edge {edge + 1} · {formatLength(edgeLen(edge), units)}</div>
              <div className="props">
                <Prop label="Type"><select className="select" value={e.kind} onChange={(ev) => dispatch([{ type: 'site.edge', params: { edge, kind: ev.target.value } }])}><option value="front">Front</option><option value="side">Side</option><option value="rear">Rear</option></select></Prop>
                <Prop label="Setback"><LengthInput value={e.setback} units={units} onCommit={(mm) => dispatch([{ type: 'site.edge', params: { edge, setback: mm } }])} /></Prop>
                <Prop label="Road"><select className="select" value={e.road ? 'yes' : 'no'} onChange={(ev) => dispatch([{ type: 'site.edge', params: { edge, road: ev.target.value === 'yes' ? { name: 'Access road', width: 9000 } : null } }])}><option value="no">No road</option><option value="yes">Road frontage</option></select></Prop>
                {e.road && <Prop label="Road width"><LengthInput value={e.road.width} units={units} onCommit={(mm) => dispatch([{ type: 'site.edge', params: { edge, road: { ...e.road!, width: mm } } }])} /></Prop>}
              </div>
            </div>
          )}
          <div className="panel-section">
            <div className="caps" style={{ marginBottom: 8 }}><Compass size={12} style={{ verticalAlign: -2 }} /> Orientation</div>
            <Prop label="True north"><NumberInput value={north} suffix="°" onCommit={(v) => dispatch([{ type: 'site.update', params: { northAngle: v } }])} /></Prop>
            <input type="range" min={0} max={359} value={north} onChange={(ev) => dispatch([{ type: 'site.update', params: { northAngle: Number(ev.target.value) } }], { silent: true })} aria-label="North angle" />
          </div>
          <div className="panel-section">
            <div className="caps" style={{ marginBottom: 8 }}>Plot shape</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button className="btn sm" onClick={() => { const b2 = bbox(boundary); dispatch([{ type: 'site.update', params: { boundary: rectPolygon(b2.minX, b2.minY, b2.maxX - b2.minX, b2.maxY - b2.minY) } }], { label: 'Plot made rectangular' }); }}>Rectangle</button>
              <button className="btn sm" onClick={() => { const nb = [...boundary]; const i = edge ?? 0; const a = nb[i], c = nb[(i + 1) % nb.length]; nb.splice(i + 1, 0, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }); dispatch([{ type: 'site.update', params: { boundary: nb } }], { label: 'Corner added to plot' }); }}>Add corner on edge {(edge ?? 0) + 1}</button>
              {boundary.length > 3 && edge !== null && <button className="btn sm ghost danger" onClick={() => { const nb = boundary.filter((_, i) => i !== (edge + 1) % boundary.length); dispatch([{ type: 'site.update', params: { boundary: nb } }], { label: 'Plot corner removed' }); setEdge(null); }}><Trash size={12} /> Remove corner</button>}
            </div>
          </div>
          <div className="panel-section">
            <div className="caps" style={{ marginBottom: 8 }}>Landscape & features</div>
            {Object.values(doc.site.features).map((f) => (
              <div key={f.id} className="list-item"><span className="grow">{f.name}</span><span className="tiny muted" style={{ textTransform: 'capitalize' }}>{f.kind}</span><button className="btn ghost icon sm" aria-label={`Remove ${f.name}`} onClick={() => dispatch([{ type: 'element.delete', params: { refs: [{ kind: 'siteFeature', id: f.id }] } }])}><Trash size={12} /></button></div>
            ))}
          </div>
          <div className="tiny muted">{rules.disclaimer}</div>
        </div>
      </aside>
    </>
  );
}

function Meter({ label, value, max, fmt, atLeast }: { label: string; value: number; max: number; fmt: (v: number) => string; atLeast?: boolean }) {
  const ok = atLeast ? value >= max : value <= max + 1e-6;
  const pct = Math.min(100, (value / (max || 1)) * 100);
  return (
    <div>
      <div className="row small"><span className="grow">{label}</span><b className="num" style={{ color: ok ? 'var(--ink)' : 'var(--err)' }}>{fmt(value)}</b><span className="muted tiny num">{atLeast ? 'min' : 'max'} {fmt(max)}</span></div>
      <div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${pct}%`, background: ok ? 'var(--ok)' : 'var(--err)' }} /></div>
    </div>
  );
}

function FixButton({ ops }: { ops: { type: string; params: Record<string, unknown> }[] }) {
  const doc = useDoc();
  const dispatch = useStore((s) => s.dispatch);
  const [show, setShow] = useState(false);
  const impact = useMemo(() => (show ? computeImpact(doc, ops) : null), [show, doc, ops]);
  if (!show) return <button className="btn sm" onClick={() => setShow(true)}><Wand size={12} /> Fix</button>;
  return (
    <div className="card" style={{ padding: 8, width: 180, boxShadow: 'var(--shadow)' }}>
      <div className="tiny">Move the building inward. {impact?.lines.slice(0, 2).join(' · ')}</div>
      {impact && <div className="tiny muted">Health {impact.health.before} → {impact.health.after}</div>}
      <div className="row" style={{ marginTop: 6 }}><button className="btn sm ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn sm primary" onClick={() => { dispatch(ops, { label: 'Setback violation fixed' }); setShow(false); }}>Apply</button></div>
    </div>
  );
}
