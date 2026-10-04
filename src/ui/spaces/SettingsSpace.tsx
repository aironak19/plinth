/**
 * Project settings — the project's brief, rules, structure and people.
 *
 * Every field writes through a typed operation (project.update, project.rule,
 * cost.update, level.update, option.*), so a settings change is undoable,
 * audited and permission-checked exactly like a wall edit. Only keyboard
 * shortcuts are per-device preferences and live outside the document.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Check, Download, Plus, Trash, TriangleAlert, Lock } from 'lucide-react';
import { useStore } from '../../state/store';
import { useBuilding, useDoc, useLevels, useUnits } from '../../state/derived';
import { setSetting } from '../../state/persist';
import { Avatar, LengthInput, Modal, NumberInput, Seg, Switch, TextInput, relTime } from '../components';
import { ROLES, ROLE_BY_ID, USERS, USER_BY_ID, can, type Capability } from '../../core/model/org';
import { RULE_LABELS, RULE_SETS, RULE_SET_BY_ID, type RuleSet } from '../../core/rules/rulesets';
import { CITIES } from '../../core/derive/sun';
import { fxFor } from '../../core/model/factory';
import { formatLength, type CurrencyCode } from '../../core/units';
import type { DesignOption, ProjectType, RoleId } from '../../core/model/types';
import type { OpCall } from '../../core/ops';

type Tab = 'project' | 'rules' | 'levels' | 'options' | 'team' | 'shortcuts' | 'export';
const TABS: { id: Tab; label: string }[] = [
  { id: 'project', label: 'Project' }, { id: 'rules', label: 'Rules' }, { id: 'levels', label: 'Levels' }, { id: 'options', label: 'Design options' },
  { id: 'team', label: 'Team & permissions' }, { id: 'shortcuts', label: 'Shortcuts' }, { id: 'export', label: 'Export' },
];

const PROJECT_TYPES: ProjectType[] = ['villa', 'house', 'apartment', 'duplex', 'farmhouse', 'bungalow', 'townhouse', 'commercial', 'renovation', 'blank'];
const PHASES = ['Feasibility', 'Concept design', 'Schematic design', 'Design development', 'Construction documents', 'Tender', 'Construction administration'];
const CURRENCIES: { id: CurrencyCode; name: string }[] = [
  { id: 'INR', name: 'Indian rupee' }, { id: 'USD', name: 'US dollar' }, { id: 'EUR', name: 'Euro' },
  { id: 'GBP', name: 'British pound' }, { id: 'AED', name: 'UAE dirham' }, { id: 'SGD', name: 'Singapore dollar' },
];
const CAP_LABEL: Record<Capability, string> = {
  'model.view': 'View model', 'model.edit': 'Edit model', comment: 'Comment', approve: 'Approve', 'task.manage': 'Manage tasks',
  'version.manage': 'Versions', 'project.manage': 'Project settings', 'project.share': 'Share & request approval', 'docs.export': 'Export drawings',
  'cost.view': 'See cost', 'org.admin': 'Organization admin',
};
const CAPS = Object.keys(CAP_LABEL) as Capability[];
const SHORTCUT_LABEL: Record<string, string> = {
  select: 'Select tool', wall: 'Wall tool', door: 'Door tool', window: 'Window tool', stair: 'Stair tool', room: 'Room tool', column: 'Column tool',
  comment: 'Comment pin', move: 'Move selection', copy: 'Duplicate selection', align: 'Align furniture', elevation: 'Open elevations sheet',
  plan: 'Plan view', '3d': '3D view', split: 'Split view',
};
/** Keys the app reserves for fixed behaviour (help, rotate while placing). */
const RESERVED = new Set(['?', ']']);

function useAct() {
  const dispatch = useStore((s) => s.dispatch);
  return (ops: OpCall[], label?: string) => dispatch(ops, { keepSelection: true, label });
}

function Card({ title, sub, children, right }: { title: string; sub?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="panel-head" style={{ height: 'auto', minHeight: 44, padding: '10px 14px' }}>
        <div className="grow"><h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h2>{sub && <div className="tiny muted" style={{ marginTop: 2 }}>{sub}</div>}</div>
        {right}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return <div className="field"><label htmlFor={htmlFor}>{label}</label>{children}</div>;
}

export default function SettingsSpace() {
  const [tab, setTab] = useState<Tab>('project');
  const role = useStore((s) => s.role);
  const doc = useDoc();
  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 1040 }}>
        <h1 className="page-title">Project settings</h1>
        <div className="page-sub">{doc.meta.name} · every change is undoable and recorded in the activity log</div>
        {!can(role, 'project.manage') && (
          <div className="chip warn" style={{ marginTop: 12, height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>
            <Lock size={12} /> Acting as {ROLE_BY_ID[role]?.name}: you can review settings, but project changes will be refused.
          </div>
        )}
        <div className="seg" role="tablist" aria-label="Settings sections" style={{ margin: '18px 0 20px', flexWrap: 'wrap' }}>
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
        <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label} className="col" style={{ gap: 16 }}>
          {tab === 'project' && <ProjectTab />}
          {tab === 'rules' && <RulesTab />}
          {tab === 'levels' && <LevelsTab />}
          {tab === 'options' && <OptionsTab />}
          {tab === 'team' && <TeamTab />}
          {tab === 'shortcuts' && <ShortcutsTab />}
          {tab === 'export' && <ExportTab />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ project

function ProjectTab() {
  const doc = useDoc();
  const act = useAct();
  const m = doc.meta;
  const patch = (p: Partial<typeof m>) => act([{ type: 'project.update', params: { patch: p } }]);
  const phases = PHASES.includes(m.phase) ? PHASES : [m.phase, ...PHASES];
  const knownCity = CITIES.some((c) => c.city === m.location.city);
  return (
    <>
      <Card title="Details" sub="Shown on title blocks, sheets and project cards">
        <div className="grid g2">
          <Field label="Project name"><TextInput value={m.name} ariaLabel="Project name" onCommit={(v) => patch({ name: v })} /></Field>
          <Field label="Project type" htmlFor="set-type">
            <select id="set-type" className="select" value={m.type} onChange={(e) => patch({ type: e.target.value as ProjectType })} style={{ textTransform: 'capitalize' }}>
              {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Client"><TextInput value={m.client} ariaLabel="Client" onCommit={(v) => patch({ client: v })} /></Field>
          <Field label="Architect of record"><TextInput value={m.architect} ariaLabel="Architect of record" onCommit={(v) => patch({ architect: v })} /></Field>
          <Field label="Phase" htmlFor="set-phase">
            <select id="set-phase" className="select" value={m.phase} onChange={(e) => patch({ phase: e.target.value })}>
              {phases.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Location" sub="Drives sun studies, daylight analysis and the site’s north arrow context">
        <div className="grid g2">
          <Field label="City" htmlFor="set-city">
            <select id="set-city" className="select" value={m.location.city} onChange={(e) => {
              const c = CITIES.find((x) => x.city === e.target.value);
              if (c) patch({ location: { ...m.location, city: c.city, country: c.country, lat: c.lat, lon: c.lon } });
            }}>
              {!knownCity && <option value={m.location.city}>{m.location.city}</option>}
              {CITIES.map((c) => <option key={c.city} value={c.city}>{c.city}, {c.country}</option>)}
            </select>
          </Field>
          <Field label="Site address"><TextInput value={m.location.address ?? ''} ariaLabel="Site address" onCommit={(v) => patch({ location: { ...m.location, address: v } })} /></Field>
          <div className="small muted" style={{ alignSelf: 'end' }}>
            {m.location.country} · {Math.abs(m.location.lat).toFixed(3)}° {m.location.lat >= 0 ? 'N' : 'S'}, {Math.abs(m.location.lon).toFixed(3)}° {m.location.lon >= 0 ? 'E' : 'W'}
          </div>
        </div>
      </Card>

      <Card title="Units & currency" sub="Display only — the model is stored in millimetres and catalogue rates in INR">
        <div className="grid g2">
          <Field label="Units">
            <Seg value={m.units} onChange={(u) => patch({ units: u })} options={[{ value: 'imperial', label: 'Imperial (ft-in)' }, { value: 'metric', label: 'Metric (m)' }]} />
          </Field>
          <Field label="Currency" htmlFor="set-cur">
            <select id="set-cur" className="select" value={m.currency} onChange={(e) => {
              const c = e.target.value as CurrencyCode;
              act([{ type: 'project.update', params: { patch: { currency: c } } }, { type: 'cost.update', params: { patch: { fxPerInr: fxFor(c) } } }], `Currency set to ${c}`);
            }}>
              {CURRENCIES.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
            </select>
          </Field>
        </div>
        {m.currency !== 'INR' && (
          <div className="tiny muted" style={{ marginTop: 10 }}>
            Converted at 1 {m.currency} = ₹{(1 / doc.cost.fxPerInr).toFixed(2)}. Adjust the rate in Quantities & cost if your contract uses a different one.
          </div>
        )}
      </Card>
    </>
  );
}

// -------------------------------------------------------------------- rules

function RulesTab() {
  const doc = useDoc();
  const units = useUnits();
  const act = useAct();
  const base: RuleSet = RULE_SET_BY_ID[doc.meta.ruleSetId] ?? RULE_SETS[0];
  const overrides = doc.ruleOverrides;
  const keys = Object.keys(RULE_LABELS) as (keyof RuleSet['values'])[];
  const setRule = (key: string, value: number | null) => {
    const v = value !== null && Math.abs(value - base.values[key as keyof RuleSet['values']]) < 1e-9 ? null : value;
    act([{ type: 'project.rule', params: { key, value: v } }], v === null ? `${RULE_LABELS[key as keyof RuleSet['values']].label} reset to default` : `${RULE_LABELS[key as keyof RuleSet['values']].label} overridden`);
  };
  const count = keys.filter((k) => overrides[k] !== undefined).length;
  return (
    <>
      <Card title="Regional rule set" sub="Every design-health, site and stair check reads its limits from here">
        <div className="col" style={{ gap: 12 }}>
          <Field label="Rule set" htmlFor="set-rules">
            <select id="set-rules" className="select" value={base.id} onChange={(e) => act([{ type: 'project.update', params: { patch: { ruleSetId: e.target.value } } }], 'Rule set changed')}>
              {RULE_SETS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <div className="small subtle">{base.description}</div>
          <div role="note" style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 'var(--r)', background: 'var(--warn-soft)', color: 'var(--ink)' }}>
            <TriangleAlert size={16} style={{ color: 'var(--warn)', flex: 'none', marginTop: 1 }} />
            <div><div style={{ fontWeight: 600, marginBottom: 2 }}>Verify before permit submission</div><div className="small">{base.disclaimer}</div></div>
          </div>
        </div>
      </Card>

      <Card title="Project overrides" sub={`${count} of ${keys.length} values overridden for this project`}>
        <div style={{ overflowX: 'auto', margin: '-8px -6px' }}>
          <table className="table">
            <thead><tr><th>Rule</th><th className="r">{base.region} default</th><th style={{ width: 170 }}>This project</th><th style={{ width: 120 }} /></tr></thead>
            <tbody>
              {keys.map((k) => {
                const meta = RULE_LABELS[k];
                const def = base.values[k];
                const cur = overrides[k] ?? def;
                const overridden = overrides[k] !== undefined;
                const fmt = (v: number) => meta.kind === 'length' ? formatLength(v, units) : meta.kind === 'percent' ? `${Math.round(v * 1000) / 10}%` : `${v}`;
                return (
                  <tr key={k}>
                    <td>{meta.label}</td>
                    <td className="r muted">{fmt(def)}</td>
                    <td>
                      {meta.kind === 'length' && <LengthInput value={cur} units={units} min={0} ariaLabel={meta.label} onCommit={(v) => setRule(k, v)} />}
                      {meta.kind === 'percent' && <NumberInput value={Math.round(cur * 1000) / 10} suffix="%" step={1} ariaLabel={`${meta.label} (percent)`} onCommit={(v) => setRule(k, Math.min(100, Math.max(0, v)) / 100)} />}
                      {meta.kind === 'ratio' && <NumberInput value={cur} step={0.05} ariaLabel={meta.label} onCommit={(v) => setRule(k, Math.max(0, v))} />}
                      {meta.kind === 'count' && <NumberInput value={cur} step={1} ariaLabel={meta.label} onCommit={(v) => setRule(k, Math.max(0, Math.round(v)))} />}
                    </td>
                    <td className="r">
                      {overridden
                        ? <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}><span className="chip accent" style={{ height: 19 }}>Override</span><button className="btn ghost sm" onClick={() => setRule(k, null)} aria-label={`Reset ${meta.label}`}>Reset</button></div>
                        : <span className="tiny muted">Default</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------- levels

function LevelsTab() {
  const doc = useDoc();
  const levels = useLevels();
  const b = useBuilding();
  const units = useUnits();
  const act = useAct();
  const option = doc.options.find((o) => o.id === doc.activeOptionId);
  const update = (id: string, patch: Record<string, unknown>) => act([{ type: 'level.update', params: { id, patch } }]);
  return (
    <Card title="Levels" sub={`${option?.name ?? 'Active option'} · changing a floor-to-floor height moves every level above it`}>
      <div style={{ overflowX: 'auto', margin: '-8px -6px' }}>
        <table className="table">
          <thead><tr><th>Name</th><th className="r">Elevation</th><th style={{ width: 130 }}>Floor to floor</th><th style={{ width: 120 }}>Slab</th><th className="r">Elements</th><th>Visible</th><th>Locked</th></tr></thead>
          <tbody>
            {[...levels].reverse().map((l) => {
              const n = Object.values(b.walls).filter((w) => w.levelId === l.id).length + Object.values(b.rooms).filter((r) => r.levelId === l.id).length;
              return (
                <tr key={l.id}>
                  <td style={{ minWidth: 160 }}><TextInput className="input bare" value={l.name} ariaLabel={`Level name ${l.name}`} onCommit={(v) => update(l.id, { name: v })} /></td>
                  <td className="r muted">{formatLength(l.elevation, units)}</td>
                  <td><LengthInput value={l.height} units={units} min={1800} ariaLabel={`${l.name} floor-to-floor height`} onCommit={(v) => update(l.id, { height: v })} /></td>
                  <td><LengthInput value={l.slabThickness} units={units} min={50} ariaLabel={`${l.name} slab thickness`} onCommit={(v) => update(l.id, { slabThickness: v })} /></td>
                  <td className="r muted">{n}</td>
                  <td><Switch checked={l.visible} label={`${l.name} visible`} onChange={(v) => update(l.id, { visible: v })} /></td>
                  <td><Switch checked={l.locked} label={`${l.name} locked`} onChange={(v) => update(l.id, { locked: v })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!levels.length && <div className="empty">This option has no levels yet.</div>}
    </Card>
  );
}

// ------------------------------------------------------------------ options

function FreeText({ value, onCommit, ariaLabel, placeholder }: { value: string; onCommit: (v: string) => void; ariaLabel: string; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value;
  return (
    <input className="input" aria-label={ariaLabel} placeholder={placeholder} value={shown}
      onFocus={() => { setText(value); setFocused(true); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { setFocused(false); if (text.trim() !== value) onCommit(text.trim()); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function OptionsTab() {
  const doc = useDoc();
  const act = useAct();
  const [deleting, setDeleting] = useState<DesignOption | null>(null);
  return (
    <>
      <Card title="Design options" sub="Alternatives share the site, brief, rules and team; each owns its building">
        <div className="col" style={{ gap: 12 }}>
          {doc.options.map((o) => {
            const active = o.id === doc.activeOptionId;
            const b = o.building;
            return (
              <div key={o.id} className="card" style={{ padding: 14, boxShadow: 'none', borderColor: active ? 'var(--accent)' : undefined }}>
                <div className="grid g2" style={{ gap: 10 }}>
                  <Field label="Name"><TextInput value={o.name} ariaLabel={`Name of ${o.name}`} onCommit={(v) => act([{ type: 'option.update', params: { id: o.id, name: v } }])} /></Field>
                  <Field label="Description"><FreeText value={o.description} ariaLabel={`Description of ${o.name}`} placeholder="What makes this option different?" onCommit={(v) => act([{ type: 'option.update', params: { id: o.id, description: v } }])} /></Field>
                </div>
                <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  <span className="tiny muted" style={{ textTransform: 'capitalize' }}>
                    {o.style} · {Object.keys(b.levels).length} levels · {Object.keys(b.rooms).length} rooms · {Object.keys(b.walls).length} walls · created {relTime(o.createdAt)}
                  </span>
                  <span className="spacer" />
                  {active
                    ? <span className="chip accent"><Check size={12} /> Active</span>
                    : <button className="btn sm" onClick={() => act([{ type: 'option.switch', params: { id: o.id } }])}>Make active</button>}
                  <button className="btn ghost sm danger" disabled={doc.options.length <= 1} title={doc.options.length <= 1 ? 'A project needs at least one option' : undefined} onClick={() => setDeleting(o)} aria-label={`Delete ${o.name}`}><Trash size={13} /> Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {deleting && (
        <Modal onClose={() => setDeleting(null)} label={`Delete ${deleting.name}`} width={440}>
          <div className="panel-head"><h2>Delete “{deleting.name}”?</h2></div>
          <div style={{ padding: '14px 16px' }} className="small subtle">
            Its building ({Object.keys(deleting.building.rooms).length} rooms, {Object.keys(deleting.building.walls).length} walls) is removed from the project. You can undo this, and saved versions still contain it.
          </div>
          <div className="row" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
            <span className="spacer" />
            <button className="btn ghost" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn primary" style={{ background: 'var(--err)', borderColor: 'var(--err)' }} autoFocus onClick={() => { act([{ type: 'option.delete', params: { id: deleting.id } }]); setDeleting(null); }}>Delete option</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// --------------------------------------------------------------------- team

function TeamTab() {
  const doc = useDoc();
  const act = useAct();
  const me = useStore((s) => s.me);
  const members = doc.meta.members;
  const outside = USERS.filter((u) => !members.some((m) => m.userId === u.id));
  const [addId, setAddId] = useState('');
  const [addRole, setAddRole] = useState<RoleId>('viewer');
  const setMembers = (next: typeof members, label: string) => act([{ type: 'project.update', params: { patch: { members: next } } }], label);
  const roleCounts = useMemo(() => Object.fromEntries(ROLES.map((r) => [r.id, members.filter((m) => m.role === r.id).length])), [members]);
  const pickId = addId || outside[0]?.id || '';
  return (
    <>
      <Card title="Members" sub="Project roles decide what each person can do in this project — enforced by the operation dispatcher">
        <div style={{ overflowX: 'auto', margin: '-8px -6px' }}>
          <table className="table">
            <thead><tr><th>Person</th><th>Title</th><th style={{ width: 200 }}>Project role</th><th /></tr></thead>
            <tbody>
              {members.map((m) => {
                const u = USER_BY_ID[m.userId];
                const isOwner = m.userId === doc.meta.ownerId;
                return (
                  <tr key={m.userId}>
                    <td><div className="row"><Avatar id={m.userId} size={26} /><div><div style={{ fontWeight: 500 }}>{u?.name ?? m.userId}{m.userId === me ? ' (you)' : ''}</div><div className="tiny muted">{u?.email}</div></div></div></td>
                    <td className="muted">{u?.title}</td>
                    <td>
                      <select className="select" aria-label={`Role of ${u?.name ?? m.userId}`} value={m.role} disabled={isOwner}
                        onChange={(e) => setMembers(members.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as RoleId } : x)), `${u?.name.split(' ')[0] ?? 'Member'} is now ${ROLE_BY_ID[e.target.value as RoleId].name}`)}>
                        {ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td className="r">
                      {isOwner ? <span className="tiny muted">Project owner</span>
                        : <button className="btn ghost sm" aria-label={`Remove ${u?.name ?? m.userId}`} onClick={() => setMembers(members.filter((x) => x.userId !== m.userId), `${u?.name ?? 'Member'} removed from project`)}>Remove</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {outside.length > 0 && (
          <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
            <select className="select" style={{ width: 240 }} aria-label="Person to add" value={pickId} onChange={(e) => setAddId(e.target.value)}>
              {outside.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.title}</option>)}
            </select>
            <select className="select" style={{ width: 180 }} aria-label="Role for new member" value={addRole} onChange={(e) => setAddRole(e.target.value as RoleId)}>
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button className="btn" disabled={!pickId} onClick={() => { setMembers([...members, { userId: pickId, role: addRole }], `${USER_BY_ID[pickId]?.name} added as ${ROLE_BY_ID[addRole].name}`); setAddId(''); }}><Plus size={14} /> Add to project</button>
          </div>
        )}
      </Card>

      <Card title="Role permissions" sub="Read-only. Defined by the organization; every operation declares the capability it needs">
        <div style={{ overflowX: 'auto', margin: '-8px -6px' }}>
          <table className="table" style={{ minWidth: 820 }}>
            <thead>
              <tr><th>Role</th>{CAPS.map((c) => <th key={c} style={{ textAlign: 'center', whiteSpace: 'normal', minWidth: 56, lineHeight: 1.2, fontSize: 11 }}>{CAP_LABEL[c]}</th>)}</tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.id}>
                  <td style={{ minWidth: 150, maxWidth: 190 }}><div style={{ fontWeight: 500 }}>{r.name}</div><div className="tiny muted">{roleCounts[r.id] ? `${roleCounts[r.id]} in this project` : r.description}</div></td>
                  {CAPS.map((c) => (
                    <td key={c} style={{ textAlign: 'center' }}>
                      {r.caps.includes(c) ? <Check size={14} style={{ color: 'var(--ok)' }} aria-label="Allowed" /> : <span className="muted" aria-label="Not allowed">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- shortcuts

function ShortcutsTab() {
  const shortcuts = useStore((s) => s.shortcuts);
  const toast = useStore((s) => s.toast);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const bind = (action: string, raw: string) => {
    const key = raw.trim().toLowerCase().slice(-1);
    if (!key) return;
    if (RESERVED.has(key)) { setErrors((e) => ({ ...e, [action]: `“${key}” is reserved` })); return; }
    if (!/^[a-z0-9]$/.test(key)) { setErrors((e) => ({ ...e, [action]: 'Use a letter or digit' })); return; }
    const clash = Object.entries(shortcuts).find(([a, k]) => a !== action && k === key);
    if (clash) { setErrors((e) => ({ ...e, [action]: `Already used by ${SHORTCUT_LABEL[clash[0]] ?? clash[0]}` })); return; }
    setErrors((e) => ({ ...e, [action]: '' }));
    if (shortcuts[action] === key) return;
    const next = { ...shortcuts, [action]: key };
    useStore.setState({ shortcuts: next });
    void setSetting('shortcuts', next);
    toast(`${SHORTCUT_LABEL[action] ?? action} → ${key.toUpperCase()}`);
  };
  return (
    <Card title="Keyboard shortcuts" sub="Single-key bindings for tools and views. Saved on this device and applied to every project.">
      <div className="grid g2" style={{ columnGap: 28, rowGap: 0 }}>
        {Object.entries(shortcuts).map(([action, key]) => (
          <div key={action} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="grow">
              <div>{SHORTCUT_LABEL[action] ?? action}</div>
              {errors[action] && <div className="tiny" style={{ color: 'var(--err)' }} role="alert">{errors[action]}</div>}
            </div>
            <input className="input num" style={{ width: 48, textAlign: 'center', fontWeight: 600, textTransform: 'uppercase' }} maxLength={1} aria-label={`Shortcut for ${SHORTCUT_LABEL[action] ?? action}`}
              value={key} onFocus={(e) => e.target.select()} onChange={(e) => bind(action, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </div>
        ))}
      </div>
      <div className="tiny muted" style={{ marginTop: 12 }}>Fixed: ⌘K command palette · ⌘J Architect AI · ⌘Z / ⌘⇧Z undo & redo · ⌘S save version · ? shortcut help · ] rotate while placing.</div>
    </Card>
  );
}

// ------------------------------------------------------------------- export

function ExportTab() {
  const doc = useDoc();
  const json = useMemo(() => JSON.stringify(doc, null, 2), [doc]);
  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.meta.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'project'}.plinth.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const kb = new Blob([json]).size / 1024;
  return (
    <Card title="Export project" sub="A complete, portable copy of the canonical project document">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
        <div className="grow small subtle" style={{ minWidth: 260 }}>
          Includes the site, all {doc.options.length} design option{doc.options.length > 1 ? 's' : ''}, scenes, cost settings, rule overrides, comments ({doc.comments.length}), tasks ({doc.tasks.length}), approvals ({doc.approvals.length}) and activity ({doc.activity.length} events). Saved versions are not included.
          <div className="tiny muted" style={{ marginTop: 6 }}>Schema version {doc.schemaVersion} · {kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`}</div>
        </div>
        <button className="btn primary" onClick={download}><Download size={14} /> Download .plinth.json</button>
      </div>
    </Card>
  );
}
