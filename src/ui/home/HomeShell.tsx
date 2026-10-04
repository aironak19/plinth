/** Home: portfolio dashboard, projects, shared work, templates, library and administration. */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Bell, Copy, FolderOpen, House, LayoutTemplate, Library, MessageSquare, Plus, Search, Shield, Star, Trash, Users, Clock, CircleCheck, HardDrive, Sparkles, Ellipsis, Sun, Moon } from 'lucide-react';
import { useStore, type HomeSection } from '../../state/store';
import type { ProjectIndexEntry } from '../../state/persist';
import { Avatar, Avatars, Kbd, Popover, relTime, HealthRing } from '../components';
import { Logo } from '../App';
import { formatArea, formatMoneyCompact, type CurrencyCode } from '../../core/units';
import { USER_BY_ID, ME, userName } from '../../core/model/org';
import { TEMPLATES } from '../../state/seed';
import { planThumbnail } from '../plan/thumbnail';

const AdminPage = lazy(() => import('../admin/AdminPage'));
const LibraryPage = lazy(() => import('../spaces/LibrarySpace'));

const STAGE_LABEL: Record<string, string> = { draft: 'Draft', internal_review: 'Internal review', client_review: 'Client review', approved: 'Approved', construction: 'Construction' };
const STAGE_CHIP: Record<string, string> = { draft: '', internal_review: 'accent', client_review: 'warn', approved: 'ok', construction: 'ok' };

export function HomeShell() {
  const route = useStore((s) => s.route);
  const section: HomeSection = route.name === 'home' ? route.section : 'home';
  const navigate = useStore((s) => s.navigate);
  const set = useStore((s) => s.set);
  const theme = useStore((s) => s.theme);
  const nav: { id: HomeSection; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'Home', icon: <House size={16} /> },
    { id: 'projects', label: 'Projects', icon: <FolderOpen size={16} /> },
    { id: 'shared', label: 'Shared with me', icon: <Users size={16} /> },
    { id: 'templates', label: 'Templates', icon: <LayoutTemplate size={16} /> },
    { id: 'library', label: 'Asset library', icon: <Library size={16} /> },
    { id: 'admin', label: 'Administration', icon: <Shield size={16} /> },
  ];
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Logo /></span>Plinth</div>
        <span className="muted small desktop-only" style={{ marginLeft: 4 }}>Studio workspace</span>
        <div className="spacer" />
        <button className="btn ghost desktop-only" onClick={() => set('paletteOpen', true)} style={{ width: 280, justifyContent: 'flex-start', color: 'var(--ink-3)', border: '1px solid var(--line-strong)' }}>
          <Search size={14} /> Search projects, rooms, people… <span className="spacer" /><Kbd>⌘K</Kbd>
        </button>
        <button className="btn ghost icon" aria-label="Toggle theme" onClick={() => useStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        <NotificationsButton />
        <Avatar id={ME} size={28} />
      </header>
      <div className="workspace">
        <nav className="side-nav" aria-label="Main">
          <button className="btn primary" style={{ marginBottom: 12 }} onClick={() => set('wizardOpen', true)}><Plus size={15} /> New project</button>
          {nav.map((n) => (
            <div key={n.id} className="list-item" role="link" tabIndex={0} aria-selected={section === n.id} onClick={() => navigate({ name: 'home', section: n.id })} onKeyDown={(e) => e.key === 'Enter' && navigate({ name: 'home', section: n.id })}>
              {n.icon}{n.label}
            </div>
          ))}
          <div className="spacer" />
          <StorageMeter />
        </nav>
        <main className="page">
          <Suspense fallback={<div className="empty">Loading…</div>}>
            {section === 'home' && <Dashboard />}
            {section === 'projects' && <ProjectsPage title="Projects" filter={() => true} />}
            {section === 'shared' && <ProjectsPage title="Shared with me" filter={(p) => p.ownerId !== ME} />}
            {section === 'templates' && <TemplatesPage />}
            {section === 'library' && <div className="page-inner"><LibraryPage standalone /></div>}
            {section === 'admin' && <AdminPage />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Dashboard() {
  const index = useStore((s) => s.index);
  const open = useStore((s) => s.openProject);
  const set = useStore((s) => s.set);
  const navigate = useStore((s) => s.navigate);
  const active = index.filter((p) => p.stage !== 'construction');
  const approvals = index.flatMap((p) => p.approvalsPending.map((a) => ({ ...a, project: p })));
  const comments = index.flatMap((p) => p.commentsOpen.map((c) => ({ ...c, project: p })));
  const activity = index.flatMap((p) => p.activity.map((a) => ({ ...a, project: p }))).sort((a, b) => b.at - a.at).slice(0, 9);
  const builtUp = index.reduce((s, p) => s + p.builtUp, 0);
  const value = index.reduce((s, p) => s + p.cost, 0);
  const avgHealth = index.length ? Math.round(index.reduce((s, p) => s + p.health, 0) / index.length) : 0;
  const favorites = index.filter((p) => p.favorite);
  return (
    <div className="page-inner">
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 22 }}>
        <div className="grow">
          <h1 className="page-title">{greeting()}, Ronak</h1>
          <div className="page-sub">{active.length} active projects · {approvals.length} awaiting approval · {comments.filter((c) => c.mentionsMe).length} mentions</div>
        </div>
        <button className="btn" onClick={() => navigate({ name: 'home', section: 'templates' })}><LayoutTemplate size={15} /> From template</button>
        <button className="btn primary" onClick={() => set('wizardOpen', true)}><Sparkles size={15} /> New project</button>
      </div>

      <div className="grid g4" style={{ marginBottom: 20 }}>
        <Kpi k="Built-up area in design" v={formatArea(builtUp, 'imperial')} sub={`${index.reduce((s, p) => s + p.rooms, 0)} rooms across ${index.length} projects`} />
        <Kpi k="Estimated construction value" v={formatMoneyCompact(value, 'INR')} sub="Live from each model’s cost engine" />
        <Kpi k="Average design health" v={`${avgHealth}`} sub={`${index.filter((p) => p.health < 90).length} projects need attention`} />
        <Kpi k="Pending approvals" v={`${approvals.length}`} sub={`${index.reduce((s, p) => s + p.tasksOpen, 0)} open tasks`} />
      </div>

      <div className="row" style={{ margin: '6px 0 12px' }}><h2 className="section-title" style={{ fontSize: 15 }}>Recent projects</h2><span className="spacer" /><button className="btn ghost sm" onClick={() => navigate({ name: 'home', section: 'projects' })}>View all</button></div>
      <div className="grid g3" style={{ marginBottom: 28 }}>
        {index.slice(0, 6).map((p) => <ProjectCard key={p.id} p={p} onOpen={() => void open(p.id)} />)}
      </div>

      <div className="grid g12">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="panel-head"><h2>Team activity</h2><span className="muted small">Across all projects</span></div>
            <div style={{ padding: '4px 8px 8px' }}>
              {activity.map((a) => (
                <div key={a.id} className="list-item" onClick={() => void open(a.project.id, 'collab')}>
                  <Avatar id={a.actorId} />
                  <div className="grow"><div className="truncate">{a.summary}</div><div className="tiny muted">{a.project.name} · {relTime(a.at)}</div></div>
                </div>
              ))}
              {!activity.length && <div className="empty">No activity yet.</div>}
            </div>
          </div>
          {favorites.length > 0 && (
            <div className="card card-pad">
              <h3 style={{ marginBottom: 10 }}>Favorites</h3>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {favorites.map((p) => <button key={p.id} className="btn" onClick={() => void open(p.id)}><Star size={13} fill="currentColor" style={{ color: 'var(--warn)' }} /> {p.name}</button>)}
              </div>
            </div>
          )}
        </div>
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="panel-head"><h2>Pending approvals</h2><span className="chip">{approvals.length}</span></div>
            <div style={{ padding: '4px 8px 8px' }}>
              {approvals.map((a) => (
                <div key={a.id} className="list-item" onClick={() => void open(a.project.id, 'collab')}>
                  <CircleCheck size={16} className="muted" />
                  <div className="grow"><div className="truncate">{a.subject}</div><div className="tiny muted">{a.project.name} · waiting on {userName(a.reviewerId)}</div></div>
                </div>
              ))}
              {!approvals.length && <div className="empty small">Nothing waiting on anyone.</div>}
            </div>
          </div>
          <div className="card">
            <div className="panel-head"><h2>Open comments</h2><span className="chip">{comments.length}</span></div>
            <div style={{ padding: '4px 8px 8px' }}>
              {comments.slice(0, 5).map((c) => (
                <div key={c.id} className="list-item" style={{ alignItems: 'flex-start' }} onClick={() => void open(c.project.id, 'collab')}>
                  <Avatar id={c.authorId} />
                  <div className="grow"><div className="small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.body}</div><div className="tiny muted">{c.project.name} · {relTime(c.at)}{c.mentionsMe ? ' · mentions you' : ''}</div></div>
                </div>
              ))}
              {!comments.length && <div className="empty small">All caught up.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="card card-pad stat">
      <div className="k">{k}</div>
      <div className="v" style={{ marginTop: 4 }}>{v}</div>
      <div className="tiny muted" style={{ marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export function ProjectCard({ p, onOpen }: { p: ProjectIndexEntry; onOpen: () => void }) {
  const s = useStore.getState();
  return (
    <article className="card project-card" onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()} aria-label={`Open ${p.name}`}>
      <div className="project-thumb">
        <div dangerouslySetInnerHTML={{ __html: p.thumbnail }} style={{ position: 'absolute', inset: 10 }} />
        <span className={`chip stage ${STAGE_CHIP[p.stage]}`}>{STAGE_LABEL[p.stage]}</span>
        <div style={{ position: 'absolute', top: 8, right: 8 }} onClick={(e) => e.stopPropagation()}>
          <Popover align="right" anchor={<button className="btn ghost icon sm" aria-label="Project actions" style={{ background: 'var(--surface)' }}><Ellipsis size={15} /></button>}>
            {(close) => (
              <>
                <button onClick={() => { close(); void s.toggleFavorite(p.id); }}><Star size={14} /> {p.favorite ? 'Remove from favorites' : 'Add to favorites'}</button>
                <button onClick={() => { close(); void s.duplicateProject(p.id); }}><Copy size={14} /> Duplicate</button>
                <div className="sep" />
                <button className="danger" style={{ color: 'var(--err)' }} onClick={() => { close(); void s.deleteProject(p.id); }}><Trash size={14} /> Delete</button>
              </>
            )}
          </Popover>
        </div>
      </div>
      <div style={{ padding: '12px 14px 14px' }} className="col">
        <div className="row">
          <div className="grow">
            <div style={{ fontWeight: 600, fontSize: 14 }} className="truncate">{p.name} <span className="muted" style={{ fontWeight: 400 }}>— {p.city}</span></div>
            <div className="tiny muted" style={{ textTransform: 'capitalize' }}>{p.type} · {p.phase} · {formatArea(p.builtUp, 'imperial')}</div>
          </div>
          {p.favorite && <Star size={14} fill="currentColor" style={{ color: 'var(--warn)' }} />}
        </div>
        <div className="row small">
          <div className="progress grow"><i style={{ width: `${p.progress}%` }} /></div>
          <span className="num muted tiny">{p.progress}%</span>
        </div>
        <div className="row tiny muted">
          <Clock size={12} /> <span>Edited {relTime(p.updatedAt)}</span>
          <span className="spacer" />
          <span title="Design health" className={`chip ${p.health >= 90 ? 'ok' : p.health >= 75 ? 'warn' : 'err'}`} style={{ height: 19 }}>{p.health}</span>
          <Avatars ids={p.members} max={3} />
        </div>
      </div>
    </article>
  );
}

function ProjectsPage({ title, filter }: { title: string; filter: (p: ProjectIndexEntry) => boolean }) {
  const index = useStore((s) => s.index);
  const open = useStore((s) => s.openProject);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('all');
  const [sort, setSort] = useState<'recent' | 'name' | 'health'>('recent');
  const list = useMemo(() => index.filter(filter).filter((p) => (stage === 'all' || p.stage === stage || (stage === 'favorites' && p.favorite)) && `${p.name} ${p.city} ${p.type}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'health' ? a.health - b.health : b.updatedAt - a.updatedAt)), [index, filter, stage, q, sort]);
  return (
    <div className="page-inner">
      <div className="row" style={{ marginBottom: 18 }}>
        <h1 className="page-title grow">{title}</h1>
        <button className="btn primary" onClick={() => useStore.getState().set('wizardOpen', true)}><Plus size={15} /> New project</button>
      </div>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 260 }}><Search size={14} style={{ position: 'absolute', left: 9, top: 8 }} className="muted" /><input className="input" style={{ paddingLeft: 30 }} placeholder="Filter projects" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="seg">
          {[['all', 'All'], ['favorites', 'Favorites'], ['draft', 'Draft'], ['internal_review', 'In review'], ['client_review', 'Client review'], ['approved', 'Approved']].map(([v, l]) => <button key={v} aria-pressed={stage === v} onClick={() => setStage(v)}>{l}</button>)}
        </div>
        <span className="spacer" />
        <select className="select" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="recent">Recently edited</option><option value="name">Name</option><option value="health">Needs attention</option>
        </select>
      </div>
      <div className="grid g3">{list.map((p) => <ProjectCard key={p.id} p={p} onOpen={() => void open(p.id)} />)}</div>
      {!list.length && <div className="empty">No projects match.</div>}
    </div>
  );
}

function TemplatesPage() {
  const create = useStore((s) => s.createProject);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    setTimeout(() => {
      const out: Record<string, string> = {};
      for (const t of TEMPLATES) { try { out[t.id] = planThumbnail(t.build()); } catch { /* skip */ } }
      if (alive) setPreviews(out);
    }, 0);
    return () => { alive = false; };
  }, []);
  return (
    <div className="page-inner">
      <h1 className="page-title">Templates</h1>
      <div className="page-sub" style={{ marginBottom: 20 }}>Company-standard starting points. Each template is a complete model — layers, materials, title blocks, room standards and furniture — not a picture.</div>
      <div className="grid g3">
        {TEMPLATES.map((t) => (
          <article key={t.id} className="card project-card" onClick={() => void create(t.build())}>
            <div className="project-thumb">{previews[t.id] ? <div dangerouslySetInnerHTML={{ __html: previews[t.id] }} style={{ position: 'absolute', inset: 10 }} /> : <div className="empty">Generating…</div>}</div>
            <div style={{ padding: '12px 14px 14px' }} className="col">
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div className="small muted">{t.description}</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>{t.tags.map((g) => <span key={g} className="chip">{g}</span>)}<span className="spacer" /><span className="small" style={{ color: 'var(--accent)', fontWeight: 500 }}>Use template →</span></div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function StorageMeter() {
  const index = useStore((s) => s.index);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => { void navigator.storage?.estimate?.().then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 })); }, [index]);
  const projBytes = index.reduce((s, p) => s + p.sizeBytes, 0);
  const used = est?.usage ?? projBytes;
  const quota = Math.min(est?.quota ?? 5e9, 50e9);
  return (
    <div className="card" style={{ padding: 12, boxShadow: 'none' }}>
      <div className="row small" style={{ marginBottom: 6 }}><HardDrive size={14} className="muted" /><b className="grow" style={{ fontWeight: 500 }}>Storage</b><span className="muted tiny">{(used / 1e6).toFixed(1)} MB</span></div>
      <div className="bar"><i style={{ width: `${Math.max(2, (used / quota) * 100)}%` }} /></div>
      <div className="tiny muted" style={{ marginTop: 6 }}>{index.length} projects · saved on this device</div>
    </div>
  );
}

function NotificationsButton() {
  const index = useStore((s) => s.index);
  const open = useStore((s) => s.openProject);
  // Intelligent grouping: one row per project and kind, never a stream of duplicates.
  const groups = index.flatMap((p) => {
    const g: { id: string; text: string; sub: string; at: number; pid: string; who: string }[] = [];
    const mentions = p.commentsOpen.filter((c) => c.mentionsMe);
    if (mentions.length) g.push({ id: `${p.id}-m`, text: mentions.length === 1 ? `${userName(mentions[0].authorId)} mentioned you` : `${mentions.length} mentions`, sub: p.name, at: mentions[0].at, pid: p.id, who: mentions[0].authorId });
    if (p.approvalsPending.length) g.push({ id: `${p.id}-a`, text: `${p.approvalsPending.length} approval${p.approvalsPending.length > 1 ? 's' : ''} pending`, sub: p.name, at: p.approvalsPending[0].at, pid: p.id, who: p.approvalsPending[0].reviewerId });
    const others = p.activity.filter((a) => a.actorId !== ME && Date.now() - a.at < 3 * 86400e3);
    if (others.length) g.push({ id: `${p.id}-c`, text: others.length === 1 ? others[0].summary : `${others.length} design changes by the team`, sub: p.name, at: others[0].at, pid: p.id, who: others[0].actorId });
    return g;
  }).sort((a, b) => b.at - a.at);
  return (
    <Popover align="right" anchor={<button className="btn ghost icon" aria-label={`Notifications (${groups.length})`} style={{ position: 'relative' }}><Bell size={16} />{groups.length > 0 && <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 9, background: 'var(--err)' }} />}</button>}>
      {(close) => (
        <div style={{ width: 320 }}>
          <div className="caps" style={{ padding: '6px 9px' }}>Notifications</div>
          {groups.slice(0, 8).map((g) => (
            <button key={g.id} onClick={() => { close(); void open(g.pid, 'collab'); }} style={{ alignItems: 'flex-start' }}>
              <Avatar id={g.who} size={22} />
              <span className="grow"><span style={{ display: 'block', fontWeight: 500 }}>{g.text}</span><span className="tiny muted">{g.sub} · {relTime(g.at)}</span></span>
            </button>
          ))}
          {!groups.length && <div className="empty small">You’re all caught up.</div>}
        </div>
      )}
    </Popover>
  );
}

export { STAGE_LABEL, STAGE_CHIP, HealthRing, MessageSquare, USER_BY_ID, type CurrencyCode };
