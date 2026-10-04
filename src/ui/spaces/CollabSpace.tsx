/**
 * Collaboration — the project's conversation, work and sign-off in one place.
 *
 * Nothing here is a side channel: comments, tasks, approvals and workflow
 * stages are part of the ProjectDoc and change only through typed operations,
 * so they are undoable, permission-checked by the dispatcher (try "View as
 * Client") and land in the same audit trail as model edits. Presence shows
 * only what this browser actually knows — never simulated live users.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleCheck, MapPin, MessageSquare, Plus, RotateCcw, Send, ArrowRight, AtSign } from 'lucide-react';
import { useStore } from '../../state/store';
import { useDoc } from '../../state/derived';
import { Avatar, Empty, relTime } from '../components';
import { ROLE_BY_ID, USER_BY_ID, can } from '../../core/model/org';
import { WORKFLOW, type Approval, type BuildingModel, type Comment, type ElementRef, type Id, type ProjectDoc, type TaskStatus, type WorkflowStage } from '../../core/model/types';
import { activeBuilding, elementLevelId, getElement, openingCenter } from '../../core/model/query';
import type { Vec2 } from '../../core/geometry/vec';
import { ROOM_LABEL } from '../plan/colors';

const STAGE_LABEL: Record<WorkflowStage, string> = { draft: 'Draft', internal_review: 'Internal review', client_review: 'Client review', approved: 'Approved', construction: 'Construction' };
const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To do' }, { id: 'in_progress', label: 'In progress' }, { id: 'in_review', label: 'In review' }, { id: 'done', label: 'Done' },
];
const DECISION: Record<Approval['decision'], { label: string; chip: string }> = {
  pending: { label: 'Pending', chip: 'warn' },
  approved: { label: 'Approved', chip: 'ok' },
  changes_requested: { label: 'Changes requested', chip: 'accent' },
  rejected: { label: 'Rejected', chip: 'err' },
};

// ------------------------------------------------------------------ helpers

/** Short display name: first name for people, the full name for households like “The Kapoors”. */
function userName(id: Id): string {
  const u = USER_BY_ID[id];
  if (!u) return 'Architect AI';
  return u.name.startsWith('The ') ? u.name : u.name.split(' ')[0];
}

/** `@priya` → u-priya. The handle is the user id without its prefix, matching the comment.add parser. */
const handleOf = (userId: Id) => userId.replace(/^u-/, '');

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

/** Human label for an element reference, e.g. "Room: Kitchen" or "Door D-101". Null when it no longer exists. */
function refLabel(doc: ProjectDoc, b: BuildingModel, ref: ElementRef): string | null {
  if (ref.kind === 'siteFeature') { const f = doc.site.features[ref.id]; return f ? `Site: ${f.name}` : null; }
  if (!getElement(b, ref)) return null;
  switch (ref.kind) {
    case 'room': { const r = b.rooms[ref.id]; return `Room: ${r.name || ROOM_LABEL[r.fn]}`; }
    case 'door': return `Door ${b.doors[ref.id].tag}`;
    case 'window': return `Window ${b.windows[ref.id].tag}`;
    case 'wall': return `Wall · ${b.walls[ref.id].kind}`;
    case 'stair': return 'Stair';
    case 'roof': return 'Roof';
    case 'column': return 'Column';
    case 'beam': return 'Beam';
    case 'furniture': return 'Furniture';
    case 'level': return `Level: ${b.levels[ref.id].name}`;
    default: return null;
  }
}

/** Where an element lives in plan, so the design space can frame it. */
function locate(b: BuildingModel, ref: ElementRef): { levelId?: Id; point?: Vec2 } {
  const levelId = ref.kind === 'siteFeature' ? undefined : elementLevelId(b, ref);
  const midOf = (a: Vec2, c: Vec2) => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
  switch (ref.kind) {
    case 'room': return { levelId, point: b.rooms[ref.id]?.point };
    case 'wall': { const w = b.walls[ref.id]; return { levelId, point: w ? midOf(w.a, w.b) : undefined }; }
    case 'beam': { const w = b.beams[ref.id]; return { levelId, point: w ? midOf(w.a, w.b) : undefined }; }
    case 'door': case 'window': {
      const o = ref.kind === 'door' ? b.doors[ref.id] : b.windows[ref.id];
      const w = o ? b.walls[o.wallId] : undefined;
      return { levelId, point: o && w ? openingCenter(w, o.offset) : undefined };
    }
    case 'stair': return { levelId, point: b.stairs[ref.id]?.origin };
    case 'column': return { levelId, point: b.columns[ref.id]?.position };
    case 'furniture': return { levelId, point: b.furniture[ref.id]?.position };
    default: return { levelId };
  }
}

/** Jump to an element (or comment pin) in the design space: switch level, select, frame. */
function useGoTo() {
  const doc = useDoc();
  return (ref?: ElementRef, pin?: Comment['pin']) => {
    const s = useStore.getState();
    const b = activeBuilding(doc);
    if (ref?.kind === 'siteFeature') {
      s.navigate({ name: 'project', id: doc.id, space: 'site' });
      if (doc.site.features[ref.id]) s.select([ref]);
      return;
    }
    const exists = !!ref && !!getElement(b, ref);
    if (ref && !exists && !pin) { s.toast('That element is no longer in the active design option.', { kind: 'err' }); return; }
    const loc = ref && exists ? locate(b, ref) : {};
    const levelId = pin?.levelId ?? loc.levelId;
    const point = pin?.point ?? loc.point;
    s.navigate({ name: 'project', id: doc.id, space: 'design' });
    if (levelId && b.levels[levelId]) s.setLevel(levelId);
    if (ref && exists && ref.kind !== 'level') s.select([ref]);
    if (point) s.focusOn(point, levelId && b.levels[levelId] ? levelId : undefined);
  };
}

function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400e3);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

/** Comment text with @mentions of real people highlighted. */
function RichText({ body }: { body: string }) {
  const parts = body.split(/(@\w+)/g);
  return (
    <>
      {parts.map((p, i) => {
        const u = p.startsWith('@') ? USER_BY_ID[`u-${p.slice(1).toLowerCase()}`] : undefined;
        return u
          ? <span key={i} title={u.name} style={{ color: 'var(--accent)', background: 'var(--accent-softer)', borderRadius: 4, padding: '0 3px', fontWeight: 500 }}>@{u.name.split(' ')[0]}</span>
          : <span key={i}>{p}</span>;
      })}
    </>
  );
}

function TargetChip({ target, pin }: { target?: ElementRef; pin?: Comment['pin'] }) {
  const doc = useDoc();
  const goTo = useGoTo();
  const b = activeBuilding(doc);
  if (!target && !pin) return null;
  const label = target ? refLabel(doc, b, target) : null;
  const levelName = pin ? b.levels[pin.levelId]?.name : undefined;
  const text = label ?? (target ? 'Removed element' : `Pin on ${levelName ?? 'plan'}`);
  return (
    <button className="chip" style={{ border: 0, cursor: 'pointer' }} onClick={() => goTo(target, pin)} title="Show in the design space" aria-label={`Show ${text} in the design space`}>
      <MapPin size={11} /> {text}
    </button>
  );
}

// ----------------------------------------------------------------- the space

type Section = 'comments' | 'tasks' | 'approvals' | 'activity' | 'team';

export default function CollabSpace() {
  const narrow = useNarrow(1000);
  const doc = useDoc();
  const [side, setSide] = useState<'tasks' | 'approvals'>('approvals');
  const [section, setSection] = useState<Section>('comments');
  const openTasks = doc.tasks.filter((t) => t.status !== 'done').length;
  const pending = doc.approvals.filter((a) => a.decision === 'pending').length;

  if (narrow) {
    const tabs: { id: Section; label: string }[] = [
      { id: 'comments', label: 'Comments' }, { id: 'tasks', label: `Tasks${openTasks ? ` · ${openTasks}` : ''}` },
      { id: 'approvals', label: `Approvals${pending ? ` · ${pending}` : ''}` }, { id: 'activity', label: 'Activity' }, { id: 'team', label: 'Team' },
    ];
    return (
      <div className="page">
        <div className="page-inner">
          <h1 className="page-title">Collaboration</h1>
          <div className="page-sub" style={{ marginBottom: 16 }}>Comments, tasks and approvals for {doc.meta.name}</div>
          <div className="seg" role="tablist" aria-label="Collaboration sections" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
            {tabs.map((t) => <button key={t.id} role="tab" aria-selected={section === t.id} aria-pressed={section === t.id} onClick={() => setSection(t.id)}>{t.label}</button>)}
          </div>
          <div role="tabpanel">
            {section === 'comments' && <Comments />}
            {section === 'tasks' && <div className="card card-pad"><Tasks /></div>}
            {section === 'approvals' && <div className="card card-pad"><Approvals /></div>}
            {section === 'activity' && <div className="card card-pad"><ActivityFeed /></div>}
            {section === 'team' && <div className="card card-pad"><Presence /></div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <aside className="panel" aria-label="Team and activity" style={{ width: 300 }}>
        <div className="panel-head"><h2>Team</h2><span className="muted small">{doc.meta.members.length} members</span></div>
        <div className="panel-body">
          <div className="panel-section"><Presence /></div>
          <div className="panel-section">
            <div className="caps" style={{ marginBottom: 8 }}>Activity</div>
            <ActivityFeed />
          </div>
        </div>
      </aside>
      <section className="page" aria-label="Comments">
        <div className="page-inner" style={{ maxWidth: 780 }}>
          <h1 className="page-title">Collaboration</h1>
          <div className="page-sub" style={{ marginBottom: 20 }}>
            {doc.comments.filter((c) => !c.resolved).length} open comments · {openTasks} open tasks · {pending} pending approvals · stage: {STAGE_LABEL[doc.stage]}
          </div>
          <Comments />
        </div>
      </section>
      <aside className="panel right" aria-label="Tasks and approvals" style={{ width: 340 }}>
        <div className="panel-tabs" role="tablist" aria-label="Tasks and approvals">
          <button role="tab" aria-selected={side === 'approvals'} onClick={() => setSide('approvals')}>Approvals{pending ? <span className="chip warn" style={{ height: 18 }}>{pending}</span> : null}</button>
          <button role="tab" aria-selected={side === 'tasks'} onClick={() => setSide('tasks')}>Tasks{openTasks ? <span className="chip" style={{ height: 18 }}>{openTasks}</span> : null}</button>
        </div>
        <div className="panel-body" role="tabpanel">{side === 'tasks' ? <Tasks /> : <Approvals />}</div>
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ presence

function Presence() {
  const doc = useDoc();
  const me = useStore((s) => s.me);
  const role = useStore((s) => s.role);
  const levelId = useStore((s) => s.levelId);
  const peers = Object.values(useStore((s) => s.peers)).filter((p) => p.projectId === doc.id);
  const b = activeBuilding(doc);
  const option = doc.options.find((o) => o.id === doc.activeOptionId);
  const levelName = (levelId && b.levels[levelId]?.name) || 'the plan';
  const lastBy = useMemo(() => {
    const m: Record<Id, { at: number; summary: string }> = {};
    for (const a of doc.activity) if (!m[a.actorId]) m[a.actorId] = { at: a.at, summary: a.summary };
    return m;
  }, [doc.activity]);
  const members = [...doc.meta.members].sort((x, y) => (x.userId === me ? -1 : y.userId === me ? 1 : (lastBy[y.userId]?.at ?? 0) - (lastBy[x.userId]?.at ?? 0)));
  return (
    <div className="col" style={{ gap: 10 }}>
      {members.map((m) => {
        const u = USER_BY_ID[m.userId];
        const isMe = m.userId === me;
        const last = lastBy[m.userId];
        const first = u?.name.split(' ')[0] ?? 'Someone';
        return (
          <div key={m.userId} className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Avatar id={m.userId} size={28} />
              {isMe && <span aria-hidden style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: 9, background: 'var(--ok)', boxShadow: '0 0 0 2px var(--surface)' }} />}
            </span>
            <div className="grow">
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 500 }}>{u?.name ?? m.userId}{isMe ? ' (you)' : ''}</span>
                <span className="chip" style={{ height: 18, fontSize: 10.5 }}>{ROLE_BY_ID[m.role]?.name ?? m.role}</span>
              </div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                {isMe
                  ? <>{first} (you) is {can(role, 'model.edit') ? 'editing' : 'viewing'} {levelName}{option ? ` in ${option.name}` : ''}{role !== m.role ? ` · acting as ${ROLE_BY_ID[role]?.name}` : ''}</>
                  : last ? <>Last active {relTime(last.at)} · {last.summary}</> : <>No activity in this project yet</>}
              </div>
            </div>
          </div>
        );
      })}
      {peers.length > 0 && (
        <div className="row tiny muted" style={{ paddingLeft: 36 }}>
          <span className="dot" style={{ color: 'var(--ok)' }} />
          Also open in {peers.length} other window{peers.length > 1 ? 's' : ''} on this device · {peers.map((p) => p.label).join(', ')}
        </div>
      )}
      <div className="tiny muted" style={{ marginTop: 2 }}>Presence reflects this device. Live multi-user presence requires a Plinth Cloud workspace.</div>
    </div>
  );
}

// ------------------------------------------------------------------ activity

function ActivityFeed() {
  const doc = useDoc();
  const goTo = useGoTo();
  const [limit, setLimit] = useState(60);
  const b = activeBuilding(doc);
  const groups = useMemo(() => {
    const out: { day: string; items: typeof doc.activity }[] = [];
    for (const a of doc.activity.slice(0, limit)) {
      const day = dayLabel(a.at);
      const g = out[out.length - 1];
      if (g && g.day === day) g.items.push(a); else out.push({ day, items: [a] });
    }
    return out;
  }, [doc.activity, limit]);
  if (!doc.activity.length) return <Empty title="No activity yet">Edits, comments and approvals will appear here.</Empty>;
  return (
    <div className="col" style={{ gap: 12 }}>
      {groups.map((g) => (
        <div key={g.day}>
          <div className="tiny muted" style={{ fontWeight: 600, margin: '0 0 4px 8px' }}>{g.day}</div>
          {g.items.map((a) => {
            const linkable = !!a.target && (a.target.kind === 'siteFeature' ? !!doc.site.features[a.target.id] : !!getElement(b, a.target));
            const inner = (
              <>
                <Avatar id={a.actorId} size={22} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small" style={{ lineHeight: 1.35 }}>{a.summary.startsWith(userName(a.actorId)) ? <span className="subtle">{a.summary}</span> : <><b style={{ fontWeight: 600 }}>{userName(a.actorId)}</b> <span className="subtle">{a.summary}</span></>}</div>
                  <div className="tiny muted">{relTime(a.at)}{linkable ? ' · show in plan' : ''}</div>
                </div>
              </>
            );
            return linkable
              ? <div key={a.id} className="list-item" role="button" tabIndex={0} style={{ alignItems: 'flex-start' }} onClick={() => goTo(a.target)} onKeyDown={(e) => e.key === 'Enter' && goTo(a.target)}>{inner}</div>
              : <div key={a.id} className="list-item" style={{ alignItems: 'flex-start', cursor: 'default' }}>{inner}</div>;
          })}
        </div>
      ))}
      {doc.activity.length > limit && <button className="btn ghost sm" onClick={() => setLimit((l) => l + 100)}>Show older activity</button>}
    </div>
  );
}

// ------------------------------------------------------------------ comments

type CommentFilter = 'open' | 'resolved' | 'mentions';

function Comments() {
  const doc = useDoc();
  const me = useStore((s) => s.me);
  const [filter, setFilter] = useState<CommentFilter>('open');
  const mentionsMe = (c: Comment) => c.mentions.includes(me) || c.replies.some((r) => new RegExp(`@${handleOf(me)}\\b`, 'i').test(r.body));
  const counts = {
    open: doc.comments.filter((c) => !c.resolved).length,
    resolved: doc.comments.filter((c) => c.resolved).length,
    mentions: doc.comments.filter(mentionsMe).length,
  };
  const list = doc.comments.filter((c) => (filter === 'open' ? !c.resolved : filter === 'resolved' ? c.resolved : mentionsMe(c)));
  return (
    <div className="col" style={{ gap: 14 }}>
      <Composer />
      <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        <h2 className="section-title grow" style={{ fontSize: 14 }}>Comments</h2>
        <div className="seg" role="tablist" aria-label="Filter comments">
          {([['open', 'Open'], ['resolved', 'Resolved'], ['mentions', 'Mentions me']] as [CommentFilter, string][]).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={filter === v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l} <span className="muted tiny num">{counts[v]}</span></button>
          ))}
        </div>
      </div>
      {list.map((c) => <Thread key={c.id} c={c} />)}
      {!list.length && (
        <div className="card"><Empty icon={<MessageSquare size={20} />} title={filter === 'open' ? 'No open comments' : filter === 'resolved' ? 'Nothing resolved yet' : 'No one has mentioned you'}>
          {filter === 'open' ? 'Start a thread above, or pin a comment on the plan with the comment tool.' : null}
        </Empty></div>
      )}
    </div>
  );
}

/** Textarea with @mention suggestions drawn from the project's members. Cmd/Ctrl+Enter submits. */
function MentionBox({ value, onChange, onSubmit, placeholder, rows = 3, ariaLabel }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string; rows?: number; ariaLabel: string }) {
  const doc = useDoc();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const updateQuery = (el: HTMLTextAreaElement) => {
    const m = el.value.slice(0, el.selectionStart).match(/@(\w*)$/);
    setQuery(m ? m[1].toLowerCase() : null);
  };
  const suggestions = query === null ? [] : doc.meta.members.map((m) => USER_BY_ID[m.userId]).filter((u) => u && (handleOf(u.id).startsWith(query) || u.name.toLowerCase().startsWith(query))).slice(0, 5);
  const insert = (userId: Id) => {
    const el = ref.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart).replace(/@\w*$/, `@${handleOf(userId)} `);
    const next = before + el.value.slice(el.selectionStart);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };
  return (
    <div style={{ position: 'relative' }}>
      <textarea ref={ref} className="textarea" rows={rows} placeholder={placeholder} aria-label={ariaLabel} value={value}
        onChange={(e) => { onChange(e.target.value); updateQuery(e.target); }}
        onKeyUp={(e) => updateQuery(e.currentTarget)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
          if (e.key === 'Escape') setQuery(null);
        }} />
      {suggestions.length > 0 && (
        <div className="menu" style={{ top: 'calc(100% + 4px)', left: 0, animation: 'fade var(--t-fast) var(--ease)' }} role="listbox" aria-label="Mention a member">
          {suggestions.map((u) => (
            <button key={u.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); insert(u.id); }}>
              <Avatar id={u.id} size={20} /><span className="grow">{u.name}</span><span className="tiny muted">@{handleOf(u.id)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function parseMentions(body: string, memberIds: Id[]): Id[] {
  const ids = [...body.matchAll(/@(\w+)/g)].map((m) => `u-${m[1].toLowerCase()}`);
  return [...new Set(ids.filter((id) => memberIds.includes(id) || USER_BY_ID[id]))];
}

function Composer() {
  const doc = useDoc();
  const dispatch = useStore((s) => s.dispatch);
  const selection = useStore((s) => s.selection);
  const role = useStore((s) => s.role);
  const [body, setBody] = useState('');
  const [attach, setAttach] = useState(true);
  const b = activeBuilding(doc);
  const sel = selection.length === 1 ? selection[0] : undefined;
  const selLabel = sel ? refLabel(doc, b, sel) : null;
  const submit = () => {
    if (!body.trim()) return;
    const target = attach && sel && selLabel ? sel : undefined;
    const loc = target ? locate(b, target) : {};
    const pin = loc.levelId && loc.point ? { levelId: loc.levelId, point: loc.point } : undefined;
    const ok = dispatch([{ type: 'comment.add', params: { body, target, pin, mentions: parseMentions(body, doc.meta.members.map((m) => m.userId)) } }], { silent: true });
    if (ok) { setBody(''); useStore.getState().toast('Comment posted'); }
  };
  return (
    <div className="card card-pad">
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <Avatar id={useStore.getState().me} size={28} />
        <div className="grow col" style={{ gap: 8 }}>
          <MentionBox value={body} onChange={setBody} onSubmit={submit} ariaLabel="New comment" placeholder={can(role, 'comment') ? 'Write a comment… type @ to mention someone' : 'Your role can view comments but not post them'} />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {sel && selLabel ? (
              <label className="row small subtle" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Attach to <span className="chip"><MapPin size={11} /> {selLabel}</span>
              </label>
            ) : <span className="tiny muted"><AtSign size={11} style={{ verticalAlign: -1 }} /> Select an element in the design space to attach a comment to it</span>}
            <span className="spacer" />
            <span className="tiny muted desktop-only">⌘ Enter</span>
            <button className="btn primary sm" disabled={!body.trim()} onClick={submit}><Send size={13} /> Comment</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Thread({ c }: { c: Comment }) {
  const dispatch = useStore((s) => s.dispatch);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const send = () => {
    if (!reply.trim()) return;
    if (dispatch([{ type: 'comment.reply', params: { id: c.id, body: reply } }], { silent: true })) { setReply(''); setReplying(false); }
  };
  return (
    <article className="card" style={{ padding: '14px 16px', opacity: c.resolved ? 0.78 : 1 }} aria-label={`Comment by ${USER_BY_ID[c.authorId]?.name ?? 'Someone'}`}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <Avatar id={c.authorId} size={28} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <b style={{ fontWeight: 600 }}>{USER_BY_ID[c.authorId]?.name ?? 'Architect AI'}</b>
            <span className="tiny muted">{relTime(c.createdAt)}</span>
            {c.resolved && <span className="chip ok" style={{ height: 19 }}><Check size={11} /> Resolved</span>}
            <span className="spacer" />
            <TargetChip target={c.target} pin={c.pin} />
          </div>
          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><RichText body={c.body} /></div>
          {c.replies.length > 0 && (
            <div className="col" style={{ gap: 10, marginTop: 12, paddingLeft: 12, borderLeft: '2px solid var(--line)' }}>
              {c.replies.map((r) => (
                <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <Avatar id={r.authorId} size={22} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}><b style={{ fontWeight: 600 }} className="small">{USER_BY_ID[r.authorId]?.name ?? 'Architect AI'}</b><span className="tiny muted">{relTime(r.createdAt)}</span></div>
                    <div className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><RichText body={r.body} /></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {replying ? (
            <div className="col" style={{ marginTop: 12, gap: 6 }}>
              <MentionBox value={reply} onChange={setReply} onSubmit={send} rows={2} ariaLabel="Reply" placeholder={`Reply to ${userName(c.authorId)}…`} />
              <div className="row"><span className="spacer" /><button className="btn ghost sm" onClick={() => { setReplying(false); setReply(''); }}>Cancel</button><button className="btn primary sm" disabled={!reply.trim()} onClick={send}>Reply</button></div>
            </div>
          ) : (
            <div className="row" style={{ marginTop: 10, gap: 4 }}>
              <button className="btn ghost sm" onClick={() => setReplying(true)}>Reply{c.replies.length ? ` · ${c.replies.length}` : ''}</button>
              <button className="btn ghost sm" onClick={() => dispatch([{ type: 'comment.resolve', params: { id: c.id, resolved: !c.resolved } }])}>
                {c.resolved ? <><RotateCcw size={13} /> Reopen</> : <><CircleCheck size={13} /> Resolve</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// --------------------------------------------------------------------- tasks

function isoDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function dueChip(due: string, done: boolean): { text: string; cls: string } {
  if (!due) return { text: 'No date', cls: '' };
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { text: due, cls: '' };
  const days = Math.round((d.getTime() - new Date(isoDate(new Date()) + 'T00:00:00').getTime()) / 86400e3);
  const text = days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return { text: !done && days < 0 ? `Overdue · ${text}` : text, cls: done ? '' : days < 0 ? 'err' : days <= 1 ? 'warn' : '' };
}

function Tasks() {
  const doc = useDoc();
  const dispatch = useStore((s) => s.dispatch);
  const me = useStore((s) => s.me);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<Id>(me);
  const [due, setDue] = useState(() => isoDate(new Date(Date.now() + 7 * 86400e3)));
  const add = () => {
    if (!title.trim()) return;
    if (dispatch([{ type: 'task.add', params: { title: title.trim(), assigneeId: assignee, due } }])) setTitle('');
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <form className="col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" placeholder="Add a task, e.g. Check stair headroom" aria-label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <div className="row">
          <select className="select grow" aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {doc.meta.members.map((m) => <option key={m.userId} value={m.userId}>{USER_BY_ID[m.userId]?.name ?? m.userId}</option>)}
          </select>
          <input className="input" type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 140 }} />
          <button className="btn primary icon" type="submit" aria-label="Add task" disabled={!title.trim()}><Plus size={15} /></button>
        </div>
      </form>
      {STATUSES.map((st) => {
        const items = doc.tasks.filter((t) => t.status === st.id);
        if (!items.length && st.id === 'in_review') return null;
        return (
          <section key={st.id} aria-label={st.label}>
            <div className="row" style={{ marginBottom: 6 }}><span className="caps">{st.label}</span><span className="tiny muted num">{items.length}</span></div>
            {items.map((t) => {
              const dc = dueChip(t.due, t.status === 'done');
              return (
                <div key={t.id} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)', alignItems: 'flex-start' }}>
                  <Avatar id={t.assigneeId} size={22} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 500, textDecoration: t.status === 'done' ? 'line-through' : undefined, color: t.status === 'done' ? 'var(--ink-3)' : undefined }}>{t.title}</div>
                    <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <span className="tiny muted">{userName(t.assigneeId)}</span>
                      <span className={`chip ${dc.cls}`} style={{ height: 19, fontSize: 11 }}>{dc.text}</span>
                      {t.target && <TargetChip target={t.target} />}
                    </div>
                  </div>
                  <select className="select" style={{ width: 112, height: 26, fontSize: 12 }} aria-label={`Status of ${t.title}`} value={t.status}
                    onChange={(e) => dispatch([{ type: 'task.update', params: { id: t.id, patch: { status: e.target.value as TaskStatus } } }])}>
                    {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              );
            })}
            {!items.length && <div className="tiny muted" style={{ padding: '4px 0 2px' }}>Nothing here.</div>}
          </section>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------- approvals

function Approvals() {
  const doc = useDoc();
  const dispatch = useStore((s) => s.dispatch);
  const role = useStore((s) => s.role);
  const me = useStore((s) => s.me);
  const idx = WORKFLOW.indexOf(doc.stage);
  const next = WORKFLOW[idx + 1];
  const reviewers = doc.meta.members.filter((m) => m.userId !== me);
  const [subject, setSubject] = useState('');
  const [reviewer, setReviewer] = useState<Id>(() => reviewers.find((m) => m.role === 'client')?.userId ?? reviewers[0]?.userId ?? me);
  const [notes, setNotes] = useState<Record<Id, string>>({});
  const canDecide = can(role, 'approve');
  const sorted = [...doc.approvals].sort((a, b) => (a.decision === 'pending' ? 0 : 1) - (b.decision === 'pending' ? 0 : 1) || b.at - a.at);
  const request = () => {
    if (!subject.trim() || !reviewer) return;
    if (dispatch([{ type: 'approval.request', params: { subject: subject.trim(), reviewerId: reviewer } }])) setSubject('');
  };
  const decide = (id: Id, decision: Approval['decision']) => {
    if (dispatch([{ type: 'approval.decide', params: { id, decision, note: notes[id]?.trim() || undefined } }])) setNotes((n) => ({ ...n, [id]: '' }));
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <section aria-label="Workflow">
        <div className="caps" style={{ marginBottom: 8 }}>Workflow</div>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {WORKFLOW.map((st, i) => {
            const done = i < idx, cur = i === idx;
            return (
              <li key={st} className="row" style={{ alignItems: 'stretch', gap: 10 }} aria-current={cur ? 'step' : undefined}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 18 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 18, display: 'grid', placeItems: 'center', flex: 'none', background: done ? 'var(--ok)' : cur ? 'var(--accent)' : 'var(--bg-sunken)', color: '#fff' }}>
                    {done ? <Check size={11} strokeWidth={3} /> : cur ? <span style={{ width: 6, height: 6, borderRadius: 6, background: '#fff' }} /> : null}
                  </span>
                  {i < WORKFLOW.length - 1 && <span style={{ flex: 1, width: 2, minHeight: 12, background: done ? 'var(--ok)' : 'var(--line)' }} />}
                </div>
                <div className="small" style={{ paddingBottom: 10, fontWeight: cur ? 600 : 400, color: cur ? 'var(--ink)' : done ? 'var(--ink-2)' : 'var(--ink-3)' }}>
                  {STAGE_LABEL[st]}{cur && <span className="tiny muted" style={{ fontWeight: 400 }}> · current</span>}
                </div>
              </li>
            );
          })}
        </ol>
        <button className="btn sm" style={{ width: '100%' }} disabled={!next} onClick={() => next && dispatch([{ type: 'workflow.stage', params: { stage: next } }])}>
          {next ? <>Move to {STAGE_LABEL[next]} <ArrowRight size={13} /></> : 'Final stage reached'}
        </button>
      </section>

      <section aria-label="Request approval" className="col" style={{ gap: 8, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <div className="caps">Request approval</div>
        <input className="input" placeholder="What needs sign-off? e.g. Ground floor plan" aria-label="Approval subject" value={subject} onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') request(); }} />
        <div className="row">
          <select className="select grow" aria-label="Reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            {reviewers.map((m) => <option key={m.userId} value={m.userId}>{USER_BY_ID[m.userId]?.name ?? m.userId} · {ROLE_BY_ID[m.role]?.name}</option>)}
          </select>
          <button className="btn primary sm" disabled={!subject.trim() || !reviewers.length} onClick={request}>Request</button>
        </div>
      </section>

      <section aria-label="Approvals" className="col" style={{ gap: 10, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <div className="caps">Approvals · {doc.approvals.length}</div>
        {sorted.map((a) => (
          <div key={a.id} className="card" style={{ padding: 12, boxShadow: 'none' }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{a.subject}</div>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  {a.decision === 'pending'
                    ? <>Waiting on {userName(a.reviewerId)} · requested by {userName(a.requestedById)} {relTime(a.at)}</>
                    : <>{userName(a.reviewerId)} · {relTime(a.at)} · requested by {userName(a.requestedById)}</>}
                </div>
              </div>
              <span className={`chip ${DECISION[a.decision].chip}`}>{DECISION[a.decision].label}</span>
            </div>
            <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
              <span className="chip" style={{ height: 19, fontSize: 11 }}>{STAGE_LABEL[a.stage]}</span>
              {a.target && <TargetChip target={a.target} />}
            </div>
            {a.note && <div className="small subtle" style={{ marginTop: 8 }}>“{a.note}”</div>}
            {a.decision === 'pending' && (
              <div className="col" style={{ gap: 6, marginTop: 10 }}>
                <input className="input" style={{ height: 28 }} placeholder="Note (optional)" aria-label={`Decision note for ${a.subject}`} value={notes[a.id] ?? ''} disabled={!canDecide}
                  onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} onKeyDown={(e) => e.stopPropagation()} />
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn sm primary" disabled={!canDecide} onClick={() => decide(a.id, 'approved')}><Check size={13} /> Approve</button>
                  <button className="btn sm" disabled={!canDecide} onClick={() => decide(a.id, 'changes_requested')}>Request changes</button>
                  <button className="btn sm danger" disabled={!canDecide} onClick={() => decide(a.id, 'rejected')}>Reject</button>
                </div>
                {!canDecide && <div className="tiny muted">Your role ({ROLE_BY_ID[role]?.name}) can’t record approval decisions.</div>}
              </div>
            )}
          </div>
        ))}
        {!doc.approvals.length && <Empty title="No approvals yet">Request sign-off on a plan, material or room.</Empty>}
      </section>
    </div>
  );
}

