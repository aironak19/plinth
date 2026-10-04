/**
 * Client presentation: no technical chrome — the model, the scenes, the plans,
 * the materials and the options, with approve / request-changes built in.
 * Anyone can navigate it with the arrow keys or the buttons below.
 */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { X, ChevronLeft, ChevronRight, Check, MessageSquare, Pause, Play } from 'lucide-react';
import { useStore } from '../../state/store';
import { useBuilding, useDoc, useSite, useLevels, useCost, useHealth } from '../../state/derived';
import { formatArea, formatMoneyCompact } from '../../core/units';
import { getMaterial } from '../../core/catalog/materials';
import { swatchStyle } from '../components';
import { planThumbnail } from '../plan/thumbnail';
import { drawPlan } from '../../core/docs/drawings';
import type { Scene } from '../../core/model/types';

const Viewport3D = lazy(() => import('../three/Viewport3D'));

type Slide = { kind: 'hero' } | { kind: 'scene'; scene: Scene } | { kind: 'plan'; levelId: string } | { kind: 'materials' } | { kind: 'options' } | { kind: 'approve' };

export default function PresentMode() {
  const doc = useDoc();
  const b = useBuilding();
  const site = useSite();
  const levels = useLevels();
  const cost = useCost();
  const set = useStore((s) => s.set);
  const dispatch = useStore((s) => s.dispatch);
  const [i, setI] = useState(0);
  const [spin, setSpin] = useState(true);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const prevStyle = useMemo(() => useStore.getState().renderStyle, []);
  useEffect(() => { useStore.setState({ renderStyle: 'realistic' }); return () => useStore.setState({ renderStyle: prevStyle }); }, [prevStyle]);

  const slides: Slide[] = useMemo(() => [
    { kind: 'hero' },
    ...doc.scenes.map((scene) => ({ kind: 'scene' as const, scene })),
    ...levels.filter((l) => Object.values(b.walls).some((w) => w.levelId === l.id)).map((l) => ({ kind: 'plan' as const, levelId: l.id })),
    { kind: 'materials' },
    ...(doc.options.length > 1 ? [{ kind: 'options' as const }] : []),
    { kind: 'approve' },
  ], [doc.scenes, levels, b.walls, doc.options.length]);
  const slide = slides[Math.min(i, slides.length - 1)];

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') set('presentOpen', false);
      if (e.key === 'ArrowRight' || e.key === ' ') setI((x) => Math.min(slides.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [slides.length, set]);

  useEffect(() => { if (slide.kind === 'scene') setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:applyScene', { detail: slide.scene })), 60); }, [slide]);

  const bedrooms = Object.values(b.rooms).filter((r) => r.fn === 'bedroom' || r.fn === 'master_bedroom').length;
  const show3d = slide.kind === 'hero' || slide.kind === 'scene';
  const pending = doc.approvals.find((a) => a.decision === 'pending');

  const decide = (decision: 'approved' | 'changes_requested') => {
    const ops = [];
    if (pending) ops.push({ type: 'approval.decide', params: { id: pending.id, decision, note } });
    else { ops.push({ type: 'approval.request', params: { subject: `${doc.options.find((o) => o.id === doc.activeOptionId)?.name} — client review`, reviewerId: 'u-client', stage: 'client_review' } }); }
    if (note.trim()) ops.push({ type: 'comment.add', params: { body: note.trim() } });
    if (dispatch(ops)) setSent(decision === 'approved' ? 'Thank you — the design is approved.' : 'Thank you — your comments were sent to the design team.');
  };

  return (
    <div className="present" role="dialog" aria-label="Client presentation">
      <div className="present-top">
        <div><div style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em' }}>{doc.meta.name}</div><div style={{ opacity: 0.7, fontSize: 13 }}>{doc.meta.location.city} · {bedrooms} bedrooms · {formatArea(site.builtUpArea, doc.meta.units)} · by {doc.meta.architect}</div></div>
        <span className="spacer" />
        <button className="pbtn" onClick={() => set('presentOpen', false)} aria-label="Exit presentation"><X size={15} /> Exit</button>
      </div>

      <div style={{ position: 'absolute', inset: 0 }}>
        {show3d && <Suspense fallback={null}><Viewport3D present autoRotate={slide.kind === 'hero' && spin} /></Suspense>}
        {slide.kind === 'plan' && <PlanSlide levelId={slide.levelId} />}
        {slide.kind === 'materials' && <MaterialsSlide />}
        {slide.kind === 'options' && <OptionsSlide />}
        {slide.kind === 'approve' && (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <div style={{ width: 'min(560px, 90vw)', textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }}>What do you think?</div>
              <div style={{ opacity: 0.7, margin: '8px 0 22px' }}>Estimated construction cost {formatMoneyCompact(cost.grandTotal, cost.currency)} · {formatArea(site.builtUpArea, doc.meta.units)} built-up</div>
              {sent ? <div style={{ fontSize: 18 }}><Check size={18} /> {sent}</div> : (
                <>
                  <textarea className="textarea" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)', minHeight: 90 }} placeholder="Anything you’d like changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                    <button className="pbtn" onClick={() => decide('changes_requested')}><MessageSquare size={15} /> Request changes</button>
                    <button className="pbtn approve" onClick={() => decide('approved')}><Check size={15} /> Approve design</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {slide.kind === 'scene' && <div style={{ position: 'absolute', left: 24, bottom: 78, zIndex: 5, fontSize: 15, fontWeight: 600, textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>{slide.scene.name}</div>}
      <div className="present-bottom">
        <button className="pbtn" onClick={() => setI(Math.max(0, i - 1))} aria-label="Previous"><ChevronLeft size={16} /></button>
        {slides.map((s, k) => <button key={k} className="pbtn" aria-pressed={k === i} onClick={() => setI(k)} style={{ padding: '0 11px' }}>{s.kind === 'hero' ? 'Overview' : s.kind === 'scene' ? s.scene.name.replace(/^Scene \d+ — /, '') : s.kind === 'plan' ? levels.find((l) => l.id === s.levelId)?.name : s.kind === 'materials' ? 'Materials' : s.kind === 'options' ? 'Options' : 'Approve'}</button>)}
        <button className="pbtn" onClick={() => setI(Math.min(slides.length - 1, i + 1))} aria-label="Next"><ChevronRight size={16} /></button>
        {slide.kind === 'hero' && <button className="pbtn" onClick={() => setSpin(!spin)} aria-label={spin ? 'Pause rotation' : 'Rotate'}>{spin ? <Pause size={14} /> : <Play size={14} />}</button>}
      </div>
    </div>
  );
}

function PlanSlide({ levelId }: { levelId: string }) {
  const doc = useDoc();
  const b = useBuilding();
  const level = b.levels[levelId];
  const svg = useMemo(() => {
    try {
      const r = drawPlan(doc, b, levelId, { scale: 100, furniture: true, dimensions: false, roomLabels: true });
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.width} ${r.height}" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%">${r.svg}</svg>`;
    } catch { return planThumbnail(doc); }
  }, [doc, b, levelId]);
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '90px 40px 90px' }}>
      <div style={{ background: '#fbfaf7', borderRadius: 16, padding: 28, width: 'min(1100px, 92vw)', height: '100%', boxShadow: '0 30px 80px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ color: '#1c1b19', fontWeight: 650, fontSize: 18, marginBottom: 8 }}>{level?.name}</div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}

function MaterialsSlide() {
  const b = useBuilding();
  const groups = useMemo(() => {
    const g: Record<string, Set<string>> = { 'Floors': new Set(), 'Interior walls': new Set(), 'Façade': new Set(), 'Roof': new Set(), 'Windows & doors': new Set() };
    for (const r of Object.values(b.rooms)) { g.Floors.add(r.floorFinishId); g['Interior walls'].add(r.wallFinishId); }
    for (const w of Object.values(b.walls)) if (w.kind === 'exterior') g['Façade'].add(w.finishExteriorId);
    for (const r of Object.values(b.roofs)) g.Roof.add(r.materialId);
    for (const w of Object.values(b.windows)) g['Windows & doors'].add(w.frameMaterialId);
    for (const d of Object.values(b.doors)) g['Windows & doors'].add(d.materialId);
    return Object.entries(g).filter(([, s]) => s.size);
  }, [b]);
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '110px 6vw 100px' }}>
      <div style={{ fontSize: 28, fontWeight: 650, marginBottom: 20 }}>Material palette</div>
      {groups.map(([name, ids]) => (
        <div key={name} style={{ marginBottom: 26 }}>
          <div style={{ opacity: 0.6, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>{name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
            {[...ids].map((id) => { const m = getMaterial(id); return <div key={id}><div style={{ ...swatchStyle(m), height: 120, borderRadius: 12 }} /><div style={{ marginTop: 8, fontWeight: 600 }}>{m.name}</div><div style={{ opacity: 0.6, fontSize: 12 }}>{m.description}</div></div>; })}
          </div>
        </div>
      ))}
    </div>
  );
}

function OptionsSlide() {
  const doc = useDoc();
  const health = useHealth();
  const dispatch = useStore((s) => s.dispatch);
  void health;
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '110px 6vw 100px' }}>
      <div style={{ fontSize: 28, fontWeight: 650, marginBottom: 20 }}>Design options</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        {doc.options.map((o) => (
          <button key={o.id} onClick={() => dispatch([{ type: 'option.switch', params: { id: o.id } }], { silent: true })} style={{ textAlign: 'left', background: o.id === doc.activeOptionId ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)', border: `1px solid ${o.id === doc.activeOptionId ? '#fff' : 'rgba(255,255,255,0.14)'}`, borderRadius: 16, padding: 16, color: '#fff' }}>
            <div style={{ background: '#fbfaf7', borderRadius: 10, aspectRatio: '4/3', padding: 8 }} dangerouslySetInnerHTML={{ __html: planThumbnail({ ...doc, activeOptionId: o.id }) }} />
            <div style={{ fontWeight: 650, fontSize: 16, marginTop: 10 }}>{o.name}</div>
            <div style={{ opacity: 0.65, fontSize: 13 }}>{o.description || o.style}</div>
            {o.id === doc.activeOptionId && <div style={{ marginTop: 8, fontSize: 12 }}><Check size={12} /> Currently shown</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
