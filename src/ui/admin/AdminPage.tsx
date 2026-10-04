/**
 * Organization administration.
 *
 * Everything shown is real for this deployment: people and roles come from the
 * org directory, the audit log is the merged operation trail of every project,
 * storage is measured from the browser, and the operation catalogue is read
 * live from the registry. Capabilities that need a hosted backend (SSO, MFA,
 * billing) say so plainly instead of pretending to be configured.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Download, Info, Lock, Play, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useStore } from '../../state/store';
import { Avatar, Avatars, Empty, relTime } from '../components';
import { CURRENT_PLAN, ME, PLANS, ROLES, ROLE_BY_ID, USERS, USER_BY_ID, can, type Capability } from '../../core/model/org';
import type { Id, RoleId } from '../../core/model/types';
import { RULE_SETS } from '../../core/rules/rulesets';
import { ASSETS } from '../../core/catalog/assets';
import { MATERIALS } from '../../core/catalog/materials';
import { allOps, getOp, type OpCall } from '../../core/ops';

type Tab = 'users' | 'teams' | 'audit' | 'plans' | 'storage' | 'security' | 'integrations' | 'api' | 'extensions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'users', label: 'Users & roles' }, { id: 'teams', label: 'Teams' }, { id: 'audit', label: 'Audit log' }, { id: 'plans', label: 'Plans & billing' },
  { id: 'storage', label: 'Storage' }, { id: 'security', label: 'Security' }, { id: 'integrations', label: 'Integrations' }, { id: 'api', label: 'Model API' },
  { id: 'extensions', label: 'Extensions' },
];

const TEAMS: { name: string; roles: RoleId[]; description: string }[] = [
  { name: 'Design', roles: ['owner', 'admin', 'architect', 'designer'], description: 'Architects and designers who author the model.' },
  { name: 'Engineering', roles: ['engineer'], description: 'Consultants who review structure and services.' },
  { name: 'Clients', roles: ['client'], description: 'Homeowners who review, comment and approve.' },
  { name: 'Contractors', roles: ['contractor'], description: 'Builders who read construction information and quantities.' },
];

const FEATURE_LABEL: Record<string, string> = {
  plan: '2D plans', '3d': '3D model & walkthrough', 'docs.basic': 'Drawings & schedules', 'docs.pdf': 'PDF sheet sets', cost: 'Quantities & cost',
  ai: 'Architect AI', versions: 'Version history', ifc: 'IFC export', teams: 'Teams & roles', templates: 'Company templates', approvals: 'Approval workflows',
};

const pre: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 11.5, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '10px 12px', overflow: 'auto', margin: 0, whiteSpace: 'pre', lineHeight: 1.5 };

function bytes(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function Section({ title, sub, children, right }: { title: string; sub?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="panel-head" style={{ height: 'auto', minHeight: 44, padding: '10px 14px' }}>
        <div className="grow"><h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h2>{sub && <div className="tiny muted" style={{ marginTop: 2 }}>{sub}</div>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Note({ kind = 'info', title, children }: { kind?: 'info' | 'warn' | 'ok'; title: string; children?: ReactNode }) {
  const c = kind === 'warn' ? 'var(--warn)' : kind === 'ok' ? 'var(--ok)' : 'var(--info)';
  const bg = kind === 'warn' ? 'var(--warn-soft)' : kind === 'ok' ? 'var(--ok-soft)' : 'var(--bg-sunken)';
  const Icon = kind === 'warn' ? TriangleAlert : kind === 'ok' ? ShieldCheck : Info;
  return (
    <div role="note" style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 'var(--r)', background: bg }}>
      <Icon size={16} style={{ color: c, flex: 'none', marginTop: 1 }} />
      <div><div style={{ fontWeight: 600 }}>{title}</div>{children && <div className="small subtle" style={{ marginTop: 2 }}>{children}</div>}</div>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users');
  const me = USER_BY_ID[ME];
  if (!me || !can(me.orgRole, 'org.admin')) {
    return <div className="page-inner"><Empty icon={<Lock size={20} />} title="Administrators only">Ask an organization owner or admin for access.</Empty></div>;
  }
  return (
    <div className="page-inner">
      <h1 className="page-title">Administration</h1>
      <div className="page-sub">Studio workspace · {USERS.length} people · signed in as {me.name} ({ROLE_BY_ID[me.orgRole].name})</div>
      <div className="seg" role="tablist" aria-label="Administration sections" style={{ margin: '18px 0 20px', flexWrap: 'wrap' }}>
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label} className="col" style={{ gap: 16 }}>
        {tab === 'users' && <UsersTab />}
        {tab === 'teams' && <TeamsTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'plans' && <PlansTab />}
        {tab === 'storage' && <StorageTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'integrations' && <IntegrationsTab />}
        {tab === 'api' && <ApiTab />}
        {tab === 'extensions' && <ExtensionsTab />}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- users

function useProjectsOf() {
  const index = useStore((s) => s.index);
  return useMemo(() => {
    const m: Record<Id, typeof index> = {};
    for (const u of USERS) m[u.id] = index.filter((p) => p.members.includes(u.id));
    return m;
  }, [index]);
}

function UsersTab() {
  const projectsOf = useProjectsOf();
  const index = useStore((s) => s.index);
  const open = useStore((s) => s.openProject);
  return (
    <>
      <Section title="People" sub="Organization role sets the default; each project can grant a different project role">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Person</th><th>Title</th><th>Organization role</th><th>Projects</th><th className="r">Reviews waiting</th></tr></thead>
            <tbody>
              {USERS.map((u) => {
                const ps = projectsOf[u.id] ?? [];
                const reviews = index.reduce((n, p) => n + p.approvalsPending.filter((a) => a.reviewerId === u.id).length, 0);
                return (
                  <tr key={u.id}>
                    <td><div className="row"><Avatar id={u.id} size={28} /><div><div style={{ fontWeight: 500 }}>{u.name}{u.id === ME ? ' (you)' : ''}</div><div className="tiny muted">{u.email}</div></div></div></td>
                    <td className="muted">{u.title}</td>
                    <td><span className={`chip ${can(u.orgRole, 'org.admin') ? 'accent' : ''}`}>{ROLE_BY_ID[u.orgRole].name}</span></td>
                    <td>
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {ps.slice(0, 3).map((p) => <button key={p.id} className="chip" style={{ border: 0, cursor: 'pointer' }} onClick={() => void open(p.id)} aria-label={`Open ${p.name}`}>{p.name}</button>)}
                        {ps.length > 3 && <span className="tiny muted">+{ps.length - 3} more</span>}
                        {!ps.length && <span className="tiny muted">None</span>}
                      </div>
                    </td>
                    <td className="r num">{reviews || <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="tiny muted" style={{ padding: '10px 14px' }}>This deployment uses Plinth’s built-in directory. Inviting and deprovisioning people is handled by your identity provider in Plinth Cloud.</div>
      </Section>
      <Section title="Roles" sub="Capabilities each role grants — the operation dispatcher refuses anything outside them">
        <div className="grid g2" style={{ padding: 14 }}>
          {ROLES.map((r) => (
            <div key={r.id} className="card" style={{ padding: 12, boxShadow: 'none' }}>
              <div className="row"><b style={{ fontWeight: 600 }} className="grow">{r.name}</b><Avatars ids={USERS.filter((u) => u.orgRole === r.id).map((u) => u.id)} /></div>
              <div className="small muted" style={{ margin: '2px 0 8px' }}>{r.description}</div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{r.caps.map((c) => <span key={c} className="chip" style={{ height: 19, fontSize: 11 }}>{c}</span>)}</div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function TeamsTab() {
  const projectsOf = useProjectsOf();
  return (
    <div className="grid g2">
      {TEAMS.map((t) => {
        const people = USERS.filter((u) => t.roles.includes(u.orgRole));
        const projects = new Set(people.flatMap((u) => (projectsOf[u.id] ?? []).map((p) => p.id)));
        return (
          <section key={t.name} className="card card-pad" aria-label={`${t.name} team`}>
            <div className="row"><h3 className="grow">{t.name}</h3><span className="chip">{people.length} {people.length === 1 ? 'person' : 'people'}</span></div>
            <div className="small muted" style={{ margin: '4px 0 12px' }}>{t.description} Active on {projects.size} project{projects.size === 1 ? '' : 's'}.</div>
            <div className="col" style={{ gap: 8 }}>
              {people.map((u) => (
                <div key={u.id} className="row"><Avatar id={u.id} /><span className="grow">{u.name}</span><span className="tiny muted">{u.title}</span></div>
              ))}
              {!people.length && <div className="tiny muted">No one with these roles yet.</div>}
            </div>
            <div className="tiny muted" style={{ marginTop: 12 }}>Derived from organization roles: {t.roles.map((r) => ROLE_BY_ID[r].name).join(', ')}.</div>
          </section>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------------- audit

function AuditTab() {
  const index = useStore((s) => s.index);
  const doc = useStore((s) => s.doc);
  const open = useStore((s) => s.openProject);
  const [person, setPerson] = useState('all');
  const [project, setProject] = useState('all');
  const rows = useMemo(() => index.flatMap((p) => {
    const acts = doc?.id === p.id ? doc.activity : p.activity;
    return acts.map((a) => ({ id: `${p.id}:${a.id}`, at: a.at, actorId: a.actorId, summary: a.summary, projectId: p.id, project: p.name }));
  }).sort((a, b) => b.at - a.at), [index, doc]);
  const actors = useMemo(() => [...new Set(rows.map((r) => r.actorId))], [rows]);
  const shown = rows.filter((r) => (person === 'all' || r.actorId === person) && (project === 'all' || r.projectId === project));
  const name = (id: Id) => USER_BY_ID[id]?.name ?? 'Architect AI';
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = ['time,person,project,action', ...shown.map((r) => [new Date(r.at).toISOString(), name(r.actorId), r.project, r.summary].map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `plinth-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Section title="Audit log" sub="Every change is an operation recorded with who, when and what — merged across projects"
      right={<button className="btn sm" onClick={exportCsv} disabled={!shown.length}><Download size={13} /> CSV</button>}>
      <div className="row" style={{ padding: '12px 14px', flexWrap: 'wrap' }}>
        <select className="select" style={{ width: 220 }} aria-label="Filter by person" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="all">Everyone</option>
          {actors.map((id) => <option key={id} value={id}>{name(id)}</option>)}
        </select>
        <select className="select" style={{ width: 220 }} aria-label="Filter by project" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="all">All projects</option>
          {index.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="spacer" />
        <span className="tiny muted">{shown.length} events</span>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 560 }}>
        <table className="table">
          <thead><tr><th style={{ width: 170 }}>Time</th><th style={{ width: 190 }}>Person</th><th style={{ width: 200 }}>Project</th><th>Action</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td title={new Date(r.at).toLocaleString()}><div>{new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div><div className="tiny muted">{relTime(r.at)}</div></td>
                <td><div className="row"><Avatar id={r.actorId} size={20} /><span className="truncate">{name(r.actorId)}</span></div></td>
                <td><button className="btn ghost sm" style={{ marginLeft: -9, maxWidth: 190 }} onClick={() => void open(r.projectId, 'collab')}><span className="truncate">{r.project}</span></button></td>
                <td>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <Empty title="No events match" />}
      </div>
      <div className="tiny muted" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
        The workspace index keeps each project’s six most recent events{doc ? `; ${doc.meta.name} shows its full trail because it is open` : ''}. Open a project for its complete history.
      </div>
    </Section>
  );
}

// -------------------------------------------------------------------- plans

function PlansTab() {
  const index = useStore((s) => s.index);
  const [usage, setUsage] = useState<number | null>(null);
  useEffect(() => { void navigator.storage?.estimate?.().then((e) => setUsage(e.usage ?? null)); }, []);
  return (
    <>
      <Note kind="warn" title="Billing is not connected in this deployment">Plan limits are configuration; no payment method, invoices or subscription are stored here.</Note>
      <div className="grid g4">
        {PLANS.map((p) => {
          const current = p.id === CURRENT_PLAN;
          const feats = p.features as readonly string[];
          const unlimited = (n: number) => !Number.isFinite(n);
          return (
            <section key={p.id} className="card card-pad col" aria-label={`${p.name} plan`} style={{ gap: 10, borderColor: current ? 'var(--accent)' : undefined, boxShadow: current ? 'var(--ring)' : undefined }}>
              <div className="row"><h3 className="grow" style={{ fontSize: 15 }}>{p.name}</h3>{current && <span className="chip accent">Current plan</span>}</div>
              <div className="small">
                <div>{unlimited(p.projects) ? 'Unlimited projects' : `${p.projects} projects`}</div>
                <div className="muted">{unlimited(p.storageGb) ? 'Unlimited storage' : `${p.storageGb} GB storage`}</div>
              </div>
              {current && !unlimited(p.projects) && (
                <div className="col" style={{ gap: 4 }}>
                  <div className="row tiny muted"><span className="grow">Projects</span><span className="num">{index.length} / {p.projects}</span></div>
                  <div className="bar"><i style={{ width: `${Math.min(100, (index.length / p.projects) * 100)}%` }} /></div>
                  {usage !== null && <>
                    <div className="row tiny muted" style={{ marginTop: 4 }}><span className="grow">Storage on this device</span><span className="num">{bytes(usage)}</span></div>
                    <div className="bar"><i style={{ width: `${Math.max(1, Math.min(100, (usage / (p.storageGb * 1e9)) * 100))}%` }} /></div>
                  </>}
                </div>
              )}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="col small">
                {feats.includes('*')
                  ? <li className="row" style={{ gap: 6 }}><Check size={13} style={{ color: 'var(--ok)' }} /> Every Plinth feature</li>
                  : feats.map((f) => <li key={f} className="row" style={{ gap: 6 }}><Check size={13} style={{ color: 'var(--ok)' }} /> {FEATURE_LABEL[f] ?? f}</li>)}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ storage

function StorageTab() {
  const index = useStore((s) => s.index);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
    void navigator.storage?.persisted?.().then(setPersisted);
  }, [index]);
  const total = index.reduce((s, p) => s + p.sizeBytes, 0);
  const max = Math.max(1, ...index.map((p) => p.sizeBytes));
  const sorted = [...index].sort((a, b) => b.sizeBytes - a.sizeBytes);
  const requestPersist = async () => {
    const ok = await navigator.storage?.persist?.();
    setPersisted(!!ok);
    useStore.getState().toast(ok ? 'This browser will keep Plinth data unless you clear it' : 'The browser declined persistent storage', { kind: ok ? 'ok' : 'err' });
  };
  return (
    <>
      <div className="grid g3">
        <div className="card card-pad stat"><div className="k">Used by this site</div><div className="v">{est ? bytes(est.usage) : '—'}</div><div className="tiny muted">Projects, versions, renders and settings</div></div>
        <div className="card card-pad stat"><div className="k">Available to this browser</div><div className="v">{est ? bytes(est.quota) : '—'}</div><div className="tiny muted">Quota granted by the browser</div></div>
        <div className="card card-pad stat"><div className="k">Project documents</div><div className="v">{bytes(total)}</div><div className="tiny muted">{index.length} projects, excluding versions</div></div>
      </div>
      {est && est.quota > 0 && (
        <div className="card card-pad">
          <div className="row small" style={{ marginBottom: 6 }}><span className="grow">Device quota</span><span className="num muted">{((est.usage / est.quota) * 100).toFixed(2)}%</span></div>
          <div className="bar"><i style={{ width: `${Math.max(0.5, (est.usage / est.quota) * 100)}%` }} /></div>
        </div>
      )}
      <Section title="By project" sub="Size of each saved project document">
        <div className="col" style={{ padding: 14, gap: 10 }}>
          {sorted.map((p) => (
            <div key={p.id}>
              <div className="row small" style={{ marginBottom: 4 }}><span className="grow truncate">{p.name}</span><span className="num muted">{bytes(p.sizeBytes)}</span></div>
              <div className="bar"><i style={{ width: `${(p.sizeBytes / max) * 100}%` }} /></div>
            </div>
          ))}
          {!index.length && <div className="empty">No projects yet.</div>}
        </div>
      </Section>
      <Section title="Durability" right={persisted === null ? null : <span className={`chip ${persisted ? 'ok' : 'warn'}`}>{persisted ? 'Persistent' : 'Best effort'}</span>}>
        <div className="row" style={{ padding: 14, flexWrap: 'wrap' }}>
          <div className="grow small subtle" style={{ minWidth: 240 }}>
            {persisted ? 'The browser has agreed not to evict Plinth’s data under storage pressure.' : 'Without persistent storage the browser may evict data when the disk is nearly full. Export important projects, or request persistence.'}
          </div>
          {!persisted && typeof navigator.storage?.persist === 'function' && <button className="btn sm" onClick={() => void requestPersist()}>Request persistent storage</button>}
        </div>
      </Section>
    </>
  );
}

// ----------------------------------------------------------------- security

function SecurityTab() {
  const index = useStore((s) => s.index);
  const ops = useMemo(() => allOps(), []);
  const byCap = useMemo(() => {
    const m: Partial<Record<Capability, number>> = {};
    for (const o of ops) m[o.cap] = (m[o.cap] ?? 0) + 1;
    return m;
  }, [ops]);
  const events = index.reduce((n, p) => n + p.activity.length, 0);
  return (
    <>
      <div className="grid g2">
        <Section title="Single sign-on" right={<span className="chip warn">Not configured</span>}>
          <div className="small subtle" style={{ padding: 14 }}>Requires Plinth Cloud deployment — configure your identity provider (SAML/OIDC). This local deployment has no server-side sign-in.</div>
        </Section>
        <Section title="Multi-factor authentication" right={<span className="chip warn">Not configured</span>}>
          <div className="small subtle" style={{ padding: 14 }}>Requires Plinth Cloud deployment — MFA is enforced by your identity provider (SAML/OIDC) once SSO is connected.</div>
        </Section>
      </div>
      <Section title="Enforced in this deployment">
        <div className="col" style={{ padding: 14, gap: 14 }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <ShieldCheck size={16} style={{ color: 'var(--ok)', flex: 'none', marginTop: 2 }} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>Role-based permissions in the operation dispatcher</div>
              <div className="small subtle">All {ops.length} operations declare a required capability and are refused for roles without it — whether they come from the UI, Architect AI or the API.</div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 6 }}>{(Object.entries(byCap) as [Capability, number][]).map(([c, n]) => <span key={c} className="chip" style={{ height: 19, fontSize: 11 }}>{c} · {n}</span>)}</div>
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <ShieldCheck size={16} style={{ color: 'var(--ok)', flex: 'none', marginTop: 2 }} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>Audit log of every operation</div>
              <div className="small subtle">Each dispatched operation records the actor, time and change in the project’s activity trail ({events} recent events indexed across {index.length} projects).</div>
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <ShieldCheck size={16} style={{ color: 'var(--ok)', flex: 'none', marginTop: 2 }} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>Local-only storage</div>
              <div className="small subtle">Projects, versions and settings are stored in this browser’s IndexedDB. Nothing is uploaded to a Plinth server. The only network requests that carry project data are Architect AI calls, sent directly to Anthropic when an API key is configured.</div>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------- integrations

function IntegrationsTab() {
  const apiKey = useStore((s) => s.apiKey);
  const setApiKey = useStore((s) => s.setApiKey);
  const toast = useStore((s) => s.toast);
  const [value, setValue] = useState('');
  const save = async () => {
    const k = value.trim();
    if (!k) return;
    await setApiKey(k);
    setValue('');
    toast(k.startsWith('sk-ant-') ? 'Anthropic API key saved on this device' : 'Key saved — it doesn’t look like an Anthropic key (sk-ant-…)', { kind: k.startsWith('sk-ant-') ? 'ok' : 'err' });
  };
  return (
    <Section title="Anthropic — Architect AI" sub="Model: Claude Opus 5.5, with on-device intent parsing as the fallback"
      right={<span className={`chip ${apiKey ? 'ok' : ''}`}>{apiKey ? 'Connected' : 'Not configured'}</span>}>
      <div className="col" style={{ padding: 14, gap: 12 }}>
        <div className="small subtle">
          With a key, Architect AI sends a structured summary of the open model and your request to Claude, which proposes typed operations you preview and approve. Without one, Plinth uses its on-device parser for common requests.
        </div>
        {apiKey && <div className="row small"><span className="muted">Current key</span><code style={{ fontFamily: 'var(--mono)' }}>{apiKey.slice(0, 7)}…{apiKey.slice(-4)}</code></div>}
        <form className="row" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label htmlFor="anthropic-key" className="sr-only">Anthropic API key</label>
          <input id="anthropic-key" className="input" type="password" autoComplete="off" spellCheck={false} placeholder={apiKey ? 'Replace key' : 'sk-ant-…'}
            value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ maxWidth: 420, flex: 1, minWidth: 220 }} />
          <button className="btn primary" type="submit" disabled={!value.trim()}>Save</button>
          {apiKey && <button className="btn danger" type="button" onClick={() => void setApiKey('').then(() => toast('API key removed — Architect AI uses on-device parsing'))}>Remove</button>}
        </form>
        <Note title="Where the key goes">
          The key is stored only in this browser’s IndexedDB. Requests go directly from your browser to api.anthropic.com — never through a Plinth server. Anyone with access to this browser profile can use it, so prefer a key with a spending limit.
        </Note>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- model API

function ApiTab() {
  const ops = useMemo(() => allOps().slice().sort((a, b) => a.type.localeCompare(b.type)), []);
  const [q, setQ] = useState('');
  const shown = ops.filter((o) => `${o.type} ${o.title} ${o.description}`.toLowerCase().includes(q.toLowerCase()));
  const groups = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const o of shown) { const g = o.type.split('.')[0]; m.set(g, [...(m.get(g) ?? []), o]); }
    return [...m.entries()];
  }, [shown]);
  return (
    <>
      <ApiConsole />
      <Section title="Operations" sub={`${ops.length} registered operations — the same calls the UI, Architect AI and integrations use`}
        right={<div style={{ position: 'relative', width: 220 }}><Search size={13} className="muted" style={{ position: 'absolute', left: 9, top: 9 }} /><input className="input" style={{ paddingLeft: 28 }} placeholder="Filter operations" aria-label="Filter operations" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>}>
        <div style={{ padding: '6px 14px 14px' }}>
          {groups.map(([g, list]) => (
            <div key={g} style={{ marginTop: 10 }}>
              <div className="caps" style={{ marginBottom: 4 }}>{g}</div>
              {list.map((o) => {
                const roles = ROLES.filter((r) => r.caps.includes(o.cap)).map((r) => r.name);
                return (
                  <details key={o.type} style={{ borderBottom: '1px solid var(--line)' }}>
                    <summary className="row" style={{ padding: '8px 2px', cursor: 'pointer', listStyle: 'revert' }}>
                      <code style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, minWidth: 180 }}>{o.type}</code>
                      <span className="grow truncate">{o.title}</span>
                      <span className={`chip ${o.model ? 'accent' : ''}`} style={{ height: 19, fontSize: 11 }}>{o.model ? 'Model' : 'Project'}</span>
                      <span className="chip" style={{ height: 19, fontSize: 11 }}>{o.cap}</span>
                    </summary>
                    <div className="col" style={{ padding: '4px 2px 14px', gap: 8 }}>
                      <div className="small subtle">{o.description}</div>
                      <div className="tiny muted">Allowed for: {roles.join(', ')}</div>
                      <pre style={pre}>{JSON.stringify(o.schema, null, 2)}</pre>
                    </div>
                  </details>
                );
              })}
            </div>
          ))}
          {!groups.length && <Empty title="No operations match" />}
        </div>
      </Section>
    </>
  );
}

const SAMPLE = `[
  { "type": "comment.add", "params": { "body": "Checked via the API console" } }
]`;

function ApiConsole() {
  const doc = useStore((s) => s.doc);
  const role = useStore((s) => s.role);
  const dispatch = useStore((s) => s.dispatch);
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () => {
    let calls: OpCall[];
    try {
      const parsed: unknown = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const [i, c] of arr.entries()) {
        if (!c || typeof c !== 'object' || typeof (c as OpCall).type !== 'string') throw new Error(`Item ${i + 1} needs a string "type"`);
        if ((c as OpCall).params !== undefined && (typeof (c as OpCall).params !== 'object' || (c as OpCall).params === null)) throw new Error(`Item ${i + 1}: "params" must be an object`);
        if (!getOp((c as OpCall).type)) throw new Error(`Item ${i + 1}: unknown operation "${(c as OpCall).type}"`);
      }
      calls = arr.map((c) => ({ type: (c as OpCall).type, params: (c as OpCall).params ?? {} }));
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Invalid JSON' });
      return;
    }
    if (!calls.length) { setResult({ ok: false, text: 'Nothing to run — the array is empty.' }); return; }
    const ok = dispatch(calls, { label: `API: ${calls.length === 1 ? getOp(calls[0].type)!.title : `${calls.length} operations`}` });
    setResult(ok
      ? { ok: true, text: `Applied ${calls.length} operation${calls.length > 1 ? 's' : ''} to ${doc?.meta.name} as one undoable step.` }
      : { ok: false, text: 'Refused — see the notification for the reason (permissions or invalid parameters). Nothing was changed.' });
  };
  return (
    <Section title="API console" sub="Run a JSON array of {type, params} calls against the open project — atomically, with undo and audit">
      <div className="col" style={{ padding: 14, gap: 10 }}>
        {doc
          ? <div className="row small"><span className="chip ok"><span className="dot" /> {doc.meta.name}</span><span className="muted">Runs as {ROLE_BY_ID[role]?.name}</span></div>
          : <Note title="No project is open">Open a project, then return here to run operations against it. You can still browse the catalogue below.</Note>}
        <textarea className="textarea" aria-label="Operations JSON" spellCheck={false} rows={7} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && doc) { e.preventDefault(); run(); } }}
          style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
        <div className="row">
          {result && <span className={`small grow`} role="status" style={{ color: result.ok ? 'var(--ok)' : 'var(--err)' }}>{result.text}</span>}
          {!result && <span className="grow tiny muted">⌘ Enter to run</span>}
          <button className="btn primary" disabled={!doc} onClick={run}><Play size={13} /> Run</button>
        </div>
      </div>
    </Section>
  );
}

// --------------------------------------------------------------- extensions

const SDK_SAMPLE = `import { defineOp } from 'plinth/core/ops';

defineOp<{ id: string; finish: string }>({
  type: 'acme.room.finish',
  title: 'Apply Acme finish',
  description: 'Set a room floor finish from the Acme catalogue.',
  cap: 'model.edit',          // checked by the dispatcher
  model: true,                // feeds version summaries
  schema: { type: 'object', properties: { id: { type: 'string' }, finish: { type: 'string' } }, required: ['id', 'finish'] },
  run(ctx, p) {
    ctx.b.rooms[p.id].floorFinishId = p.finish;
    ctx.notes.push('Acme finish applied');
  },
});`;

function ExtensionsTab() {
  const exporters = [
    { name: 'IFC4', detail: 'BIM model exchange with Revit, ArchiCAD and BIM viewers' },
    { name: 'DXF', detail: 'Plan linework for AutoCAD and other CAD tools' },
    { name: 'glTF', detail: '3D model for visualisation tools and the web' },
    { name: 'PDF', detail: 'Drawing sheet sets with title blocks' },
  ];
  return (
    <>
      <Section title="Installed" sub="Bundled with this deployment">
        <div className="col" style={{ padding: 14, gap: 16 }}>
          <div>
            <div className="row" style={{ marginBottom: 8 }}><b style={{ fontWeight: 600 }} className="grow">Regional rule packs</b><span className="chip ok">Installed · built-in</span></div>
            <div className="grid g3">
              {RULE_SETS.map((r) => (
                <div key={r.id} className="card" style={{ padding: 12, boxShadow: 'none' }}>
                  <div style={{ fontWeight: 500 }}>{r.name}</div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>{r.region} · {Object.keys(r.values).length} limits · {Object.keys(r.rooms).length} room standards</div>
                </div>
              ))}
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div className="grow"><div style={{ fontWeight: 600 }}>Plinth Essentials asset library</div><div className="small muted">{ASSETS.length} parametric furniture and fixture assets · {MATERIALS.length} materials with indicative rates</div></div>
            <span className="chip ok">Installed · built-in</span>
          </div>
          <div style={{ paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div className="row" style={{ marginBottom: 8 }}><b style={{ fontWeight: 600 }} className="grow">IFC / DXF / glTF / PDF exporters</b><span className="chip ok">Installed · built-in</span></div>
            <div className="grid g4">
              {exporters.map((x) => <div key={x.name} className="small"><div style={{ fontWeight: 500 }}>{x.name}</div><div className="tiny muted">{x.detail}</div></div>)}
            </div>
          </div>
        </div>
      </Section>
      <Section title="Extension SDK" sub="How studios extend Plinth">
        <div className="col" style={{ padding: 14, gap: 12 }}>
          <div className="small subtle">
            Extensions add capabilities through the same two seams the core uses. <b>Operations</b> are registered with <code style={{ fontFamily: 'var(--mono)' }}>defineOp</code>: each declares a title, a JSON schema and the capability it needs, and immediately becomes available to the command palette, Architect AI, the API console above, undo/redo and the audit log. <b>Rule packs</b> are plain <code style={{ fontFamily: 'var(--mono)' }}>RuleSet</code> objects — setbacks, coverage, FAR, stair and room standards — that every design-health and site check reads from.
          </div>
          <pre style={pre}>{SDK_SAMPLE}</pre>
          <div className="tiny muted">There is no third-party marketplace in this deployment; extensions are added to the codebase and shipped with your build.</div>
        </div>
      </Section>
    </>
  );
}
