/**
 * Architect AI — a co-pilot that works on the building model, not a chatbot.
 * Every change is shown as a proposal with its measured impact and is only
 * applied when the user presses Apply (never silently).
 */
import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, ArrowUp, Eye, Check, Wand, KeyRound, Loader } from 'lucide-react';
import { useStore } from '../../state/store';
import { useDoc } from '../../state/derived';
import { interpret, SUGGESTIONS, type Proposal } from '../../core/ai/intent';
import { computeImpact, type Impact } from '../../core/ai/impact';
import { planThumbnail } from '../plan/thumbnail';
import { scoreBuilding } from '../../core/generate/score';
import { resolveRules } from '../../core/rules/rulesets';
import { HealthRing } from '../components';
import { formatArea } from '../../core/units';
import type { OpCall } from '../../core/ops';
import type { ProjectDoc } from '../../core/model/types';

interface Msg { id: string; role: 'user' | 'ai'; text?: string; proposal?: Proposal; impact?: Impact; status?: 'applied' | 'cancelled'; via?: 'claude' | 'local' }

const history = new Map<string, Msg[]>();
let counter = 0;

export function AIPanel() {
  const doc = useDoc();
  const set = useStore((s) => s.set);
  const apiKey = useStore((s) => s.apiKey);
  const [msgs, setMsgs] = useState<Msg[]>(() => history.get(doc.id) ?? []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { history.set(doc.id, msgs); listRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [msgs, doc.id]);
  useEffect(() => {
    const h = (e: Event) => void ask((e as CustomEvent).detail as string);
    window.addEventListener('plinth:ask', h);
    return () => window.removeEventListener('plinth:ask', h);
  });

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const s = useStore.getState();
    const user: Msg = { id: `m${++counter}`, role: 'user', text: q };
    setMsgs((m) => [...m, user]);
    setBusy(true);
    try {
      let proposal: Proposal | null = null;
      let via: Msg['via'] = 'local';
      if (s.apiKey) {
        try {
          const { askClaude } = await import('../../core/ai/claude');
          proposal = await askClaude(q, s.doc!, s.selection, s.apiKey, msgs.filter((m) => m.text).slice(-6).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.text! })));
          via = 'claude';
        } catch (e) {
          console.warn('[plinth] Claude unavailable, using on-device engine', e);
        }
      }
      if (!proposal) proposal = interpret(q, s.doc!, s.selection, s.levelId ?? undefined);
      let impact: Impact | undefined;
      if (proposal.kind === 'change' && proposal.ops?.length) {
        impact = computeImpact(s.doc!, proposal.ops);
        if (!impact.ok) proposal = { kind: 'answer', title: 'That change isn’t possible', message: impact.error ?? 'The model rejected this change.' };
      }
      if (proposal.highlight?.length) s.select(proposal.highlight);
      setMsgs((m) => [...m, { id: `m${++counter}`, role: 'ai', proposal, impact, via }]);
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, p: Partial<Msg>) => setMsgs((m) => m.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <aside className="panel right" style={{ width: 360 }} aria-label="Architect AI">
      <div className="panel-head">
        <Sparkles size={15} style={{ color: 'var(--accent)' }} />
        <h2>Architect AI</h2>
        <span className="chip" title={apiKey ? 'Using Claude with the Plinth model API, with on-device fallback' : 'On-device engine — add a Claude API key in Administration → Integrations for open-ended requests'}>{apiKey ? 'Claude' : 'On-device'}</span>
        <button className="btn ghost icon sm" onClick={() => set('aiOpen', false)} aria-label="Close Architect AI"><X size={15} /></button>
      </div>
      <div className="panel-body col" ref={listRef} style={{ gap: 10 }}>
        {!msgs.length && (
          <div className="col" style={{ gap: 10 }}>
            <div className="ai-msg">I work directly on <b>{doc.meta.name}</b>’s building model — rooms, walls, materials, rules and costs. I’ll always show you the impact before anything changes.</div>
            <div className="caps" style={{ marginTop: 4 }}>Try</div>
            {SUGGESTIONS.map((sg) => <button key={sg} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', padding: '7px 10px', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => void ask(sg)}><Wand size={13} style={{ flex: 'none' }} /> {sg}</button>)}
            {!apiKey && <div className="small muted row" style={{ alignItems: 'flex-start', marginTop: 4 }}><KeyRound size={13} style={{ marginTop: 2 }} /> Works offline with the on-device engine. Connect Claude in Administration → Integrations for open-ended briefs.</div>}
          </div>
        )}
        {msgs.map((m) => m.role === 'user' ? <div key={m.id} className="ai-msg user">{m.text}</div> : <ProposalCard key={m.id} msg={m} onStatus={(st) => patch(m.id, { status: st })} doc={doc} />)}
        {busy && <div className="ai-msg row"><Loader size={14} className="spin" /> Thinking about the model…</div>}
      </div>
      <form className="row" style={{ padding: 10, borderTop: '1px solid var(--line)' }} onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
        <input className="input" placeholder={useStore.getState().selection.length ? 'Ask about the selection…' : 'Ask or instruct Architect AI…'} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Message Architect AI" />
        <button className="btn primary icon" type="submit" aria-label="Send" disabled={!input.trim() || busy}><ArrowUp size={15} /></button>
      </form>
    </aside>
  );
}

function ProposalCard({ msg, onStatus, doc }: { msg: Msg; onStatus: (s: 'applied' | 'cancelled') => void; doc: ProjectDoc }) {
  const p = msg.proposal!;
  const proposalState = useStore((s) => s.proposal);
  const setProposal = useStore((s) => s.setProposal);
  const dispatch = useStore((s) => s.dispatch);
  const select = useStore((s) => s.select);
  const previewing = proposalState?.proposal === p && proposalState.previewing;
  const units = doc.meta.units;
  const apply = (ops: OpCall[], label: string) => { if (dispatch(ops, { label })) { onStatus('applied'); setProposal(null); } };

  if (p.kind === 'options' && p.schemes) {
    const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides);
    return (
      <div className="ai-card">
        <div className="head"><Sparkles size={14} style={{ color: 'var(--accent)' }} />{p.title}</div>
        <div className="body col">
          <div className="small">{p.message}</div>
          {p.schemes.map((sc) => {
            const scratch: ProjectDoc = { ...doc, site: { ...doc.site, ...(p.siteOps?.[0]?.params as object ?? {}), features: Object.fromEntries(sc.features.map((f) => [f.id, f])) }, options: [{ ...doc.options[0], building: sc.building }], activeOptionId: doc.options[0].id };
            const score = scoreBuilding(scratch, sc.building, rules);
            return (
              <div key={sc.id} className="card" style={{ padding: 10, boxShadow: 'none' }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ width: 92, height: 72, background: 'var(--paper)', borderRadius: 8, flex: 'none' }} dangerouslySetInnerHTML={{ __html: planThumbnail(scratch) }} />
                  <div className="grow">
                    <b>{sc.name}</b>
                    <div className="tiny muted" style={{ lineHeight: 1.35 }}>{sc.summary}</div>
                    <div className="row tiny" style={{ marginTop: 4 }}><HealthRing score={score.metrics.health} size={26} /><span className="muted">{formatArea(score.raw.builtUp, units)} · light {score.metrics.light} · garden {score.metrics.garden}</span></div>
                  </div>
                </div>
                <button className="btn sm" style={{ marginTop: 8, width: '100%' }} disabled={msg.status === 'applied'} onClick={() => {
                  const ops: OpCall[] = [...(p.siteOps ?? []), { type: 'option.create', params: { name: sc.name, description: sc.summary, style: sc.style, building: sc.building, scores: score.metrics } }];
                  for (const f of sc.features) ops.push({ type: 'site.feature.create', params: { kind: f.kind, name: f.name, polygon: f.polygon, position: f.position, materialId: f.materialId, props: f.props } });
                  apply(ops, `Added scheme “${sc.name}” as a design option`);
                }}>Add as design option</button>
              </div>
            );
          })}
          <div className="tiny muted">Your current option is never overwritten — compare options from the top bar.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-card">
      <div className="head">{p.kind === 'change' ? <Wand size={14} style={{ color: 'var(--accent)' }} /> : <Sparkles size={14} style={{ color: 'var(--accent)' }} />}{p.title}{msg.via === 'claude' && <span className="chip" style={{ marginLeft: 'auto', height: 18 }}>Claude</span>}</div>
      <div className="body col">
        {p.message && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.message}</div>}
        {p.suggestions && <div className="col" style={{ gap: 4 }}>{p.suggestions.map((sg) => <button key={sg} className="btn sm" style={{ justifyContent: 'flex-start' }} onClick={() => window.dispatchEvent(new CustomEvent('plinth:ask', { detail: sg }))}>{sg}</button>)}</div>}
        {msg.impact?.ok && (
          <>
            <div className="caps" style={{ marginTop: 2 }}>Expected impact</div>
            <ul className="impact">{msg.impact.lines.length ? msg.impact.lines.map((l) => <li key={l}>{l}</li>) : <li>No measurable change to areas, cost or health</li>}</ul>
            <div className="row small"><span className="muted">Design health</span><b className="num">{msg.impact.health.before} → {msg.impact.health.after}</b></div>
          </>
        )}
        {p.highlight?.length ? <button className="btn sm" onClick={() => select(p.highlight!)}><Eye size={13} /> Show in plan</button> : null}
        {p.kind === 'change' && p.ops?.length ? (
          msg.status ? <div className="small" style={{ color: msg.status === 'applied' ? 'var(--ok)' : 'var(--ink-3)' }}>{msg.status === 'applied' ? <><Check size={13} /> Applied — undo with ⌘Z</> : 'Cancelled'}</div> : (
            <div className="row">
              <button className="btn sm" aria-pressed={previewing} onClick={() => setProposal(previewing ? null : { proposal: p, impact: msg.impact, previewing: true })}><Eye size={13} /> {previewing ? 'Hide preview' : 'Preview'}</button>
              <button className="btn sm ghost" onClick={() => { onStatus('cancelled'); setProposal(null); }}>Cancel</button>
              <span className="spacer" />
              <button className="btn sm primary" onClick={() => apply(p.ops!, p.title)}>Apply</button>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
