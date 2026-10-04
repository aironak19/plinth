import { lazy, Suspense, useState } from 'react';
import {
  ChevronLeft, PenTool, LandPlot, FileText, Calculator, Activity, MessageSquare, FileClock, Library, Settings, Check, Loader, CloudOff,
  CircleAlert, ChevronDown, Plus, Presentation, Sparkles, Search, Share2, Star, GitBranch, Eye,
} from 'lucide-react';
import { useStore, type Space } from '../../state/store';
import { useDoc, useHealth } from '../../state/derived';
import { Avatar, Avatars, Kbd, Popover, TextInput } from '../components';
import { Logo } from '../App';
import { DesignSpace } from '../spaces/DesignSpace';
import { ROLES } from '../../core/model/org';
import type { RoleId } from '../../core/model/types';

const SiteSpace = lazy(() => import('../spaces/SiteSpace'));
const DocsSpace = lazy(() => import('../spaces/DocsSpace'));
const CostSpace = lazy(() => import('../spaces/CostSpace'));
const AnalysisSpace = lazy(() => import('../spaces/AnalysisSpace'));
const CollabSpace = lazy(() => import('../spaces/CollabSpace'));
const VersionsSpace = lazy(() => import('../spaces/VersionsSpace'));
const LibrarySpace = lazy(() => import('../spaces/LibrarySpace'));
const SettingsSpace = lazy(() => import('../spaces/SettingsSpace'));

const STAGES: Record<string, string> = { draft: 'Draft', internal_review: 'Internal review', client_review: 'Client review', approved: 'Approved', construction: 'Construction' };

export function ProjectShell() {
  const route = useStore((s) => s.route);
  const space: Space = route.name === 'project' ? route.space : 'design';
  const doc = useDoc();
  const health = useHealth();
  const navigate = useStore((s) => s.navigate);
  const openComments = doc.comments.filter((c) => !c.resolved).length;
  const rail: { id: Space; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'design', label: 'Design — plan & 3D', icon: <PenTool size={19} strokeWidth={1.7} /> },
    { id: 'site', label: 'Site planning', icon: <LandPlot size={19} strokeWidth={1.7} /> },
    { id: 'docs', label: 'Documentation', icon: <FileText size={19} strokeWidth={1.7} /> },
    { id: 'cost', label: 'Quantities & cost', icon: <Calculator size={19} strokeWidth={1.7} /> },
    { id: 'analysis', label: 'Analysis & design health', icon: <Activity size={19} strokeWidth={1.7} />, badge: health.errors || undefined },
    { id: 'collab', label: 'Collaboration', icon: <MessageSquare size={19} strokeWidth={1.7} />, badge: openComments || undefined },
    { id: 'versions', label: 'Version history', icon: <FileClock size={19} strokeWidth={1.7} /> },
    { id: 'library', label: 'Assets & materials', icon: <Library size={19} strokeWidth={1.7} /> },
  ];
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <nav className="rail" aria-label="Modules">
          {rail.map((r, i) => (
            <span key={r.id} style={{ display: 'contents' }}>
              {i === 1 && <div className="rail-sep" />}
              {i === 5 && <div className="rail-sep" />}
              <button aria-current={space === r.id} title={r.label} aria-label={r.label} onClick={() => navigate({ name: 'project', id: doc.id, space: r.id })}>
                {r.icon}{r.badge ? <span className="badge">{r.badge}</span> : null}
              </button>
            </span>
          ))}
          <div className="spacer" />
          <button aria-current={space === 'settings'} title="Project settings, team & permissions" aria-label="Project settings" onClick={() => navigate({ name: 'project', id: doc.id, space: 'settings' })}><Settings size={19} strokeWidth={1.7} /></button>
        </nav>
        <div className="main">
          <Suspense fallback={<div className="empty" style={{ flex: 1 }}>Loading…</div>}>
            {space === 'design' && <DesignSpace />}
            {space === 'site' && <SiteSpace />}
            {space === 'docs' && <DocsSpace />}
            {space === 'cost' && <CostSpace />}
            {space === 'analysis' && <AnalysisSpace />}
            {space === 'collab' && <CollabSpace />}
            {space === 'versions' && <VersionsSpace />}
            {space === 'library' && <LibrarySpace />}
            {space === 'settings' && <SettingsSpace />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function TopBar() {
  const doc = useDoc();
  const s = useStore();
  const saveState = useStore((x) => x.saveState);
  const online = useStore((x) => x.online);
  const peers = Object.values(useStore((x) => x.peers)).filter((p) => p.projectId === doc.id);
  const option = doc.options.find((o) => o.id === doc.activeOptionId)!;
  return (
    <header className="topbar">
      <button className="btn ghost icon" aria-label="Back to dashboard" onClick={() => { void s.saveNow(); s.navigate({ name: 'home', section: 'home' }); }}><ChevronLeft size={18} /></button>
      <span className="brand-mark desktop-only" style={{ width: 24, height: 24 }}><Logo size={14} /></span>
      <div className="crumb">
        <TextInput className="input bare" value={doc.meta.name} ariaLabel="Project name" onCommit={(v) => s.dispatch([{ type: 'project.update', params: { patch: { name: v } } }], { silent: true })} />
        <button className="btn ghost icon sm desktop-only" aria-label={doc.meta.favorite ? 'Unfavorite' : 'Favorite'} onClick={() => void s.toggleFavorite(doc.id)}><Star size={14} fill={doc.meta.favorite ? 'currentColor' : 'none'} style={{ color: doc.meta.favorite ? 'var(--warn)' : undefined }} /></button>
        <span className="desktop-only muted">/</span>
        <Popover anchor={<button className="btn ghost sm desktop-only"><GitBranch size={13} /> {option.name} <ChevronDown size={13} /></button>}>
          {(close) => (
            <div style={{ width: 280 }}>
              <div className="caps" style={{ padding: '6px 9px' }}>Design options · shared site & brief</div>
              {doc.options.map((o) => (
                <button key={o.id} onClick={() => { close(); s.dispatch([{ type: 'option.switch', params: { id: o.id } }], { silent: true }); }}>
                  {o.id === doc.activeOptionId ? <Check size={14} /> : <span style={{ width: 14 }} />}
                  <span className="grow"><span style={{ display: 'block', fontWeight: 500 }}>{o.name}</span><span className="tiny muted">{o.description || o.style}</span></span>
                </button>
              ))}
              <div className="sep" />
              <button onClick={() => { close(); s.dispatch([{ type: 'option.create', params: { name: `Option ${String.fromCharCode(65 + doc.options.length)}`, description: `Branched from ${option.name}` } }]); }}><Plus size={14} /> Duplicate as new option</button>
            </div>
          )}
        </Popover>
        <Popover anchor={<button className="chip accent desktop-only" style={{ border: 0, cursor: 'pointer' }}>{STAGES[doc.stage]} <ChevronDown size={11} /></button>}>
          {(close) => (
            <div style={{ width: 220 }}>
              <div className="caps" style={{ padding: '6px 9px' }}>Workflow stage</div>
              {Object.entries(STAGES).map(([k, v]) => <button key={k} onClick={() => { close(); s.dispatch([{ type: 'workflow.stage', params: { stage: k } }]); }}>{doc.stage === k ? <Check size={14} /> : <span style={{ width: 14 }} />}{v}</button>)}
            </div>
          )}
        </Popover>
      </div>
      <span className="spacer" />
      <span className="save-state desktop-only" aria-live="polite">
        {!online ? <><CloudOff size={13} /> Offline · saved locally</> : saveState === 'saving' ? <><Loader size={13} className="spin" /> Saving…</> : saveState === 'error' ? <><CircleAlert size={13} style={{ color: 'var(--err)' }} /> Not saved</> : <><Check size={13} style={{ color: 'var(--ok)' }} /> Saved</>}
      </span>
      {peers.length > 0 && <span className="chip desktop-only" title={peers.map((p) => p.label).join(', ')}><span className="dot" style={{ color: 'var(--ok)' }} /> Also open in {peers.length} other window{peers.length > 1 ? 's' : ''}</span>}
      <Avatars ids={doc.meta.members.map((m) => m.userId)} max={4} />
      <button className="btn ghost desktop-only" style={{ color: 'var(--ink-3)' }} onClick={() => s.set('paletteOpen', true)}><Search size={14} /> <Kbd>⌘K</Kbd></button>
      <ViewAs />
      <button className="btn desktop-only" onClick={() => s.navigate({ name: 'project', id: doc.id, space: 'settings' })}><Share2 size={14} /> Share</button>
      <button className="btn" onClick={() => s.set('presentOpen', true)}><Presentation size={14} /> <span className="desktop-only">Present</span></button>
      <button className={`btn ${s.aiOpen ? 'primary' : ''}`} onClick={() => { if (s.route.name === 'project' && s.route.space !== 'design') s.navigate({ name: 'project', id: doc.id, space: 'design' }); s.set('aiOpen', !s.aiOpen); }}><Sparkles size={14} /> <span className="desktop-only">Architect AI</span></button>
    </header>
  );
}

/** Switch the acting role to experience exactly what a client or contractor can do — permissions are enforced by the dispatcher. */
function ViewAs() {
  const role = useStore((s) => s.role);
  const set = useStore((s) => s.set);
  const [, force] = useState(0);
  return (
    <Popover align="right" anchor={<button className={`btn ghost icon desktop-only ${role !== 'owner' ? 'active' : ''}`} title={`Acting as: ${role}`} aria-label="View as role"><Eye size={15} /></button>}>
      {(close) => (
        <div style={{ width: 250 }}>
          <div className="caps" style={{ padding: '6px 9px' }}>View project as</div>
          {ROLES.map((r) => (
            <button key={r.id} onClick={() => { close(); set('role', r.id as RoleId); force((n) => n + 1); useStore.getState().toast(r.id === 'owner' ? 'Full access restored' : `Now viewing as ${r.name} — ${r.description}`); }}>
              {role === r.id ? <Check size={14} /> : <span style={{ width: 14 }} />}
              <span className="grow"><span style={{ display: 'block', fontWeight: 500 }}>{r.name}</span><span className="tiny muted">{r.description}</span></span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export { Avatar };
