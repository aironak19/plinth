/**
 * Application state. The project document is immutable; every change goes
 * through `dispatch(OpCall[])`, which applies typed operations, records
 * undo/redo patches and the audit trail, and schedules autosave.
 */
import { create } from 'zustand';
import { applyPatches, type Patch } from 'immer';
import { applyOps, OpError, type OpCall } from '../core/ops';
import type { ElementRef, Id, ProjectDoc, RenderStyle, RoleId, SiteFeatureKind, VersionRecord } from '../core/model/types';
import { LINEAR_FEATURES } from '../core/model/types';
import { ASSET_BY_ID, isGroundAsset } from '../core/catalog/assets';
import { activeBuilding, levelsSorted } from '../core/model/query';
import { uid } from '../core/model/ids';
import { ME } from '../core/model/org';
import { localAdapter, type ProjectIndexEntry, getSetting, setSetting, migrate } from './persist';
import { planThumbnail } from '../ui/plan/thumbnail';
import { auraVilla } from '../core/generate/auraVilla';
import { resolveRules } from '../core/rules/rulesets';
import { validate } from '../core/derive/validation';
import { estimateCost } from '../core/derive/cost';
import { analyzeSite } from '../core/derive/site';
import { WORKFLOW } from '../core/model/types';
import type { Proposal } from '../core/ai/intent';
import type { Impact } from '../core/ai/impact';
import { seedProjects } from './seed';

export type Space = 'design' | 'site' | 'docs' | 'cost' | 'analysis' | 'collab' | 'versions' | 'library' | 'settings';
export type HomeSection = 'home' | 'projects' | 'shared' | 'templates' | 'library' | 'admin';
export type Route = { name: 'home'; section: HomeSection } | { name: 'project'; id: Id; space: Space };
export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'stair' | 'column' | 'comment' | 'place' | 'pan' | 'block' | 'surface' | 'linear';
/** What the surface (drag a rectangle) and linear (click a line) landscape tools will create. */
export interface PlaceSite { kind: SiteFeatureKind; name: string; material?: string; props?: Record<string, string | number | boolean> }
export interface PlaceBlock { blockId: string; size: string; rotation: number }
export type ViewMode = 'plan' | '3d' | 'split';

interface HistoryEntry { patches: Patch[]; inverse: Patch[]; label: string }
export interface Toast { id: string; text: string; kind?: 'info' | 'err' | 'ok'; action?: { label: string; run: () => void } }
export interface ProposalState { proposal: Proposal; impact?: Impact; previewing: boolean }

interface State {
  ready: boolean;
  route: Route;
  theme: 'light' | 'dark';
  me: Id;
  role: RoleId;
  index: ProjectIndexEntry[];
  doc: ProjectDoc | null;
  versions: VersionRecord[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  selection: ElementRef[];
  hover: ElementRef | null;
  levelId: Id | null;
  view: ViewMode;
  tool: Tool;
  placeAsset: string | null;
  placeRotation: number;
  placeSite: PlaceSite | null;
  proposal: ProposalState | null;
  saveState: 'saved' | 'saving' | 'offline' | 'error';
  online: boolean;
  toasts: Toast[];
  paletteOpen: boolean;
  wizardOpen: boolean;
  presentOpen: boolean;
  shortcutsOpen: boolean;
  aiOpen: boolean;
  renderStyle: RenderStyle;
  sun: { month: number; day: number; hour: number };
  /** How the 3D view is lit and dressed — a view setting, not part of the model. */
  view3d: { weather: 'clear' | 'cloudy' | 'overcast' | 'haze'; quality: 'fast' | 'balanced' | 'high'; season: 'spring' | 'summer' | 'autumn' | 'winter'; plantAge: number; context: boolean };
  layers: { furniture: boolean; dimensions: boolean; site: boolean; underlay: boolean; issues: boolean; comments: boolean; levelBelow: boolean; grid: boolean };
  snap: { grid: boolean; endpoints: boolean; ortho: boolean };
  focus: { point: { x: number; y: number }; levelId?: Id; at: number } | null;
  peers: Record<string, { projectId: string; label: string; at: number }>;
  apiKey: string;
  shortcuts: Record<string, string>;
  /** Ready-made block being placed (click-to-place or drag-and-drop). */
  placeBlock: PlaceBlock | null;
  /** Simple mode hides drafting tools and technical properties for non-architects. */
  simpleMode: boolean;
  leftTab: 'add' | 'levels' | 'layers';
}

interface Actions {
  init(): Promise<void>;
  navigate(r: Route): void;
  openProject(id: Id, space?: Space): Promise<void>;
  createProject(doc: ProjectDoc): Promise<void>;
  deleteProject(id: Id): Promise<void>;
  duplicateProject(id: Id): Promise<void>;
  toggleFavorite(id: Id): Promise<void>;
  dispatch(ops: OpCall[], opts?: { label?: string; silent?: boolean; keepSelection?: boolean }): boolean;
  undo(): void;
  redo(): void;
  select(refs: ElementRef[], additive?: boolean): void;
  setHover(ref: ElementRef | null): void;
  setTool(t: Tool, asset?: string): void;
  setLevel(id: Id): void;
  setView(v: ViewMode): void;
  set<K extends keyof State>(k: K, v: State[K]): void;
  toast(text: string, opts?: Omit<Toast, 'id' | 'text'>): void;
  dismissToast(id: string): void;
  createVersion(name?: string, auto?: boolean): Promise<void>;
  restoreVersion(id: Id): Promise<void>;
  setProposal(p: ProposalState | null): void;
  applyProposal(ops?: OpCall[]): void;
  focusOn(point: { x: number; y: number }, levelId?: Id): void;
  setApiKey(k: string): Promise<void>;
  setTheme(t: 'light' | 'dark'): void;
  startBlock(blockId: string, size: string): void;
  startSite(spec: PlaceSite): void;
  startPlant(assetId: string): void;
  setSimpleMode(v: boolean): void;
  saveNow(): Promise<void>;
}

export type Store = State & Actions;

const defaultShortcuts: Record<string, string> = {
  select: 'v', wall: 'w', door: 'd', window: 'n', stair: 's', room: 'r', column: 'o', comment: 'k', move: 'm', copy: 'c', align: 'a', elevation: 'e', plan: 'p', '3d': '3', split: '2',
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('plinth') : null;
const TAB = uid('tab');

export const useStore = create<Store>((setState, getState) => ({
  ready: false,
  route: { name: 'home', section: 'home' },
  theme: 'light',
  me: ME,
  role: 'owner',
  index: [],
  doc: null,
  versions: [],
  past: [],
  future: [],
  selection: [],
  hover: null,
  levelId: null,
  view: 'plan',
  tool: 'select',
  placeAsset: null,
  placeRotation: 0,
  placeSite: null,
  proposal: null,
  saveState: 'saved',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  toasts: [],
  paletteOpen: false,
  wizardOpen: false,
  presentOpen: false,
  shortcutsOpen: false,
  aiOpen: false,
  renderStyle: 'realistic',
  sun: { month: 1, day: 15, hour: 10 },
  view3d: { weather: 'clear', quality: 'balanced', season: 'summer', plantAge: 1, context: true },
  layers: { furniture: true, dimensions: true, site: true, underlay: true, issues: true, comments: true, levelBelow: true, grid: true },
  snap: { grid: true, endpoints: true, ortho: true },
  focus: null,
  peers: {},
  apiKey: '',
  shortcuts: defaultShortcuts,
  placeBlock: null,
  simpleMode: true,
  leftTab: 'add',

  async init() {
    let index = await localAdapter.loadIndex().catch(() => [] as ProjectIndexEntry[]);
    if (!index.length) {
      for (const doc of seedProjects()) {
        await localAdapter.saveProject(doc);
        await localAdapter.saveVersions(doc.id, [snapshot(doc, 1, 'Initial design', ['Project created'], false)]);
        index.push(indexEntry(doc, JSON.stringify(doc).length));
      }
      await localAdapter.saveIndex(index);
    }
    index = index.sort((a, b) => b.updatedAt - a.updatedAt);
    const theme = (await getSetting<'light' | 'dark'>('theme')) ?? (matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const apiKey = (await getSetting<string>('anthropicKey')) ?? '';
    const shortcuts = { ...defaultShortcuts, ...((await getSetting<Record<string, string>>('shortcuts')) ?? {}) };
    const simpleMode = (await getSetting<boolean>('simpleMode')) ?? true;
    setState({ simpleMode });
    document.documentElement.dataset.theme = theme;
    setState({ index, ready: true, theme, apiKey, shortcuts });
    const route = parseHash();
    if (route.name === 'project') await getState().openProject(route.id, route.space);
    else setState({ route });
    window.addEventListener('hashchange', () => {
      const r = parseHash();
      const cur = getState().route;
      if (JSON.stringify(r) === JSON.stringify(cur)) return;
      if (r.name === 'project' && (cur.name !== 'project' || cur.id !== r.id)) void getState().openProject(r.id, r.space);
      else setState({ route: r });
    });
    window.addEventListener('online', () => { setState({ online: true }); void getState().saveNow(); getState().toast('Back online · changes synced'); });
    window.addEventListener('offline', () => setState({ online: false, saveState: 'offline' }));
    window.addEventListener('beforeunload', () => { if (getState().saveState === 'saving') void getState().saveNow(); });
    channel?.addEventListener('message', (e) => onPeerMessage(e.data));
    setInterval(() => heartbeat(), 4000);
  },

  navigate(r) {
    setState({ route: r });
    const h = r.name === 'home' ? `#/${r.section === 'home' ? '' : r.section}` : `#/p/${r.id}/${r.space}`;
    if (location.hash !== h) history.pushState(null, '', h);
  },

  async openProject(id, space = 'design') {
    const cur = getState();
    if (cur.doc?.id === id) { cur.navigate({ name: 'project', id, space }); return; }
    if (cur.doc) await cur.saveNow();
    const doc = await localAdapter.loadProject(id);
    if (!doc) { cur.toast('That project could not be found on this device.', { kind: 'err' }); cur.navigate({ name: 'home', section: 'home' }); return; }
    let versions = await localAdapter.loadVersions(id);
    if (!versions.length) { versions = [snapshot(doc, 1, 'Initial design', ['Project opened'], false)]; await localAdapter.saveVersions(id, versions); }
    const levels = levelsSorted(activeBuilding(doc));
    const member = doc.meta.members.find((m) => m.userId === cur.me);
    setState({ doc, versions, past: [], future: [], selection: [], levelId: levels[0]?.id ?? null, proposal: null, role: member?.role ?? 'owner', tool: 'select' });
    getState().navigate({ name: 'project', id, space });
  },

  async createProject(doc) {
    await localAdapter.saveProject(doc);
    await localAdapter.saveVersions(doc.id, [snapshot(doc, 1, 'Initial design', ['Project created'], false)]);
    const index = [indexEntry(doc, JSON.stringify(doc).length), ...getState().index];
    await localAdapter.saveIndex(index);
    setState({ index, wizardOpen: false });
    await getState().openProject(doc.id, 'design');
    getState().toast(`${doc.meta.name} created`);
  },

  async deleteProject(id) {
    const entry = getState().index.find((p) => p.id === id);
    const doc = await localAdapter.loadProject(id);
    const index = getState().index.filter((p) => p.id !== id);
    await localAdapter.saveIndex(index);
    await localAdapter.deleteProject(id);
    setState({ index });
    getState().toast(`${entry?.name ?? 'Project'} deleted`, {
      action: doc ? { label: 'Undo', run: () => void getState().createProject(doc) } : undefined,
    });
  },

  async duplicateProject(id) {
    const doc = await localAdapter.loadProject(id);
    if (!doc) return;
    const copy: ProjectDoc = { ...JSON.parse(JSON.stringify(doc)), id: uid('p') };
    copy.meta.name = `${doc.meta.name} (copy)`;
    copy.meta.createdAt = copy.meta.updatedAt = Date.now();
    await localAdapter.saveProject(copy);
    const index = [indexEntry(copy, JSON.stringify(copy).length), ...getState().index];
    await localAdapter.saveIndex(index);
    setState({ index });
    getState().toast(`Duplicated as ${copy.meta.name}`);
  },

  async toggleFavorite(id) {
    const s = getState();
    if (s.doc?.id === id) { s.dispatch([{ type: 'project.update', params: { patch: { favorite: !s.doc.meta.favorite } } }], { silent: true }); return; }
    const doc = await localAdapter.loadProject(id);
    if (!doc) return;
    doc.meta.favorite = !doc.meta.favorite;
    await localAdapter.saveProject(doc);
    const index = s.index.map((p) => (p.id === id ? { ...p, favorite: doc.meta.favorite } : p));
    await localAdapter.saveIndex(index);
    setState({ index });
  },

  dispatch(ops, opts = {}) {
    const s = getState();
    if (!s.doc || !ops.length) return false;
    try {
      const r = applyOps(s.doc, ops, { actor: s.me, role: s.role, label: opts.label });
      const label = opts.label ?? r.notes[0] ?? 'Change';
      const selection = opts.keepSelection ? s.selection.filter((ref) => exists(r.doc, ref)) : r.created.length ? r.created.slice(0, 1) : s.selection.filter((ref) => exists(r.doc, ref));
      setState({ doc: r.doc, past: [...s.past.slice(-199), { patches: r.patches, inverse: r.inverse, label }], future: [], selection });
      scheduleSave();
      if (!opts.silent) s.toast(label, { action: { label: 'Undo', run: () => getState().undo() } });
      maybeAutoVersion();
      return true;
    } catch (e) {
      const msg = e instanceof OpError ? e.userMessage : 'We couldn’t complete this operation.';
      console.warn('[plinth] operation failed', ops, e);
      s.toast(msg, { kind: 'err' });
      return false;
    }
  },

  undo() {
    const s = getState();
    const h = s.past[s.past.length - 1];
    if (!s.doc || !h) return;
    const doc = applyPatches(s.doc, h.inverse);
    setState({ doc, past: s.past.slice(0, -1), future: [h, ...s.future], selection: s.selection.filter((r) => exists(doc, r)) });
    scheduleSave();
    s.toast(`Undid: ${h.label}`);
  },

  redo() {
    const s = getState();
    const h = s.future[0];
    if (!s.doc || !h) return;
    const doc = applyPatches(s.doc, h.patches);
    setState({ doc, future: s.future.slice(1), past: [...s.past, h] });
    scheduleSave();
    s.toast(`Redid: ${h.label}`);
  },

  select(refs, additive) {
    const s = getState();
    if (!additive) { setState({ selection: refs }); return; }
    const sel = [...s.selection];
    for (const r of refs) {
      const i = sel.findIndex((x) => x.kind === r.kind && x.id === r.id);
      if (i >= 0) sel.splice(i, 1); else sel.push(r);
    }
    setState({ selection: sel });
  },
  setHover(ref) { if (getState().hover?.id !== ref?.id) setState({ hover: ref }); },
  setTool(t, asset) { setState({ tool: t, placeAsset: asset ?? (t === 'place' ? getState().placeAsset : null), ...(t !== 'block' ? { placeBlock: null } : {}), ...(t !== 'surface' && t !== 'linear' ? { placeSite: null } : {}), ...(t !== 'select' ? { selection: [] } : {}) }); },
  /** Landscape work happens on the ground: switch to the plan and the ground floor, then arm the tool. */
  startSite(spec) {
    const st = getState();
    const b = st.doc ? activeBuilding(st.doc) : null;
    const ground = b ? Object.values(b.levels).sort((x, y) => x.order - y.order).find((l) => l.elevation >= 0) ?? Object.values(b.levels)[0] : null;
    setState({ tool: LINEAR_FEATURES.includes(spec.kind) ? 'linear' : 'surface', placeSite: spec, placeAsset: null, placeBlock: null, selection: [], view: st.view === '3d' ? 'plan' : st.view, levelId: ground?.id ?? st.levelId, layers: { ...st.layers, site: true } });
  },
  startPlant(assetId) {
    const st = getState();
    const b = st.doc ? activeBuilding(st.doc) : null;
    const ground = b ? Object.values(b.levels).sort((x, y) => x.order - y.order).find((l) => l.elevation >= 0) ?? Object.values(b.levels)[0] : null;
    const onGround = isGroundAsset(ASSET_BY_ID[assetId]);
    setState({ tool: 'place', placeAsset: assetId, placeBlock: null, placeSite: null, selection: [], view: st.view === '3d' ? 'plan' : st.view, levelId: onGround ? ground?.id ?? st.levelId : st.levelId });
  },
  startBlock(blockId, size) { setState({ tool: 'block', placeBlock: { blockId, size, rotation: getState().placeBlock?.blockId === blockId ? getState().placeBlock!.rotation : 0 }, selection: [], view: getState().view === '3d' ? 'plan' : getState().view }); },
  setSimpleMode(v) { void setSetting('simpleMode', v); setState({ simpleMode: v }); },
  setLevel(id) { setState({ levelId: id, selection: [] }); },
  setView(v) { setState({ view: v }); },
  set(k, v) { setState({ [k]: v } as Partial<State>); },

  toast(text, opts = {}) {
    const t: Toast = { id: uid('t'), text, ...opts };
    setState({ toasts: [...getState().toasts.slice(-2), t] });
    setTimeout(() => getState().dismissToast(t.id), opts.kind === 'err' ? 6000 : 3600);
  },
  dismissToast(id) { setState({ toasts: getState().toasts.filter((t) => t.id !== id) }); },

  async createVersion(name, auto = false) {
    const s = getState();
    if (!s.doc) return;
    const number = (s.versions[0]?.number ?? 0) + 1;
    const changes = s.doc.pendingChanges.length ? [...s.doc.pendingChanges] : ['No model changes'];
    const v = snapshot(s.doc, number, name ?? `Version ${number}`, changes, auto);
    const versions = [v, ...s.versions].slice(0, 80);
    const doc = { ...s.doc, pendingChanges: [] };
    setState({ versions, doc });
    await localAdapter.saveVersions(doc.id, versions);
    scheduleSave();
    if (!auto) s.toast(`Version ${number} saved`);
  },

  async restoreVersion(id) {
    const s = getState();
    const v = s.versions.find((x) => x.id === id);
    if (!s.doc || !v) return;
    await s.createVersion(`Before restoring v${v.number}`, true);
    const doc: ProjectDoc = { ...migrate(JSON.parse(JSON.stringify(v.snapshot))), activity: getState().doc!.activity, comments: getState().doc!.comments };
    doc.activity = [{ id: uid('act'), at: Date.now(), actorId: s.me, action: 'version.restore', summary: `Restored version ${v.number} — ${v.name}` }, ...doc.activity];
    setState({ doc, past: [], future: [], selection: [] });
    scheduleSave();
    s.toast(`Restored version ${v.number}`);
  },

  setProposal(p) { setState({ proposal: p }); },
  applyProposal(ops) {
    const s = getState();
    const list = ops ?? s.proposal?.proposal.ops;
    if (!list?.length) return;
    if (s.dispatch(list, { label: s.proposal?.proposal.title })) setState({ proposal: null });
  },

  focusOn(point, levelId) {
    if (levelId) setState({ levelId });
    setState({ focus: { point, levelId, at: Date.now() } });
  },

  async setApiKey(k) { await setSetting('anthropicKey', k); setState({ apiKey: k }); },
  setTheme(t) { document.documentElement.dataset.theme = t; void setSetting('theme', t); setState({ theme: t }); },

  async saveNow() {
    const s = getState();
    if (!s.doc) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const doc = s.doc;
    try {
      const size = await localAdapter.saveProject(doc);
      const index = [indexEntry(doc, size), ...getState().index.filter((p) => p.id !== doc.id)].sort((a, b) => b.updatedAt - a.updatedAt);
      await localAdapter.saveIndex(index);
      setState({ index, saveState: getState().online ? 'saved' : 'offline' });
      channel?.postMessage({ type: 'saved', id: doc.id, at: doc.meta.updatedAt, tab: TAB });
    } catch (e) {
      console.error('[plinth] save failed', e);
      setState({ saveState: 'error' });
    }
  },
}));

function scheduleSave() {
  useStore.setState({ saveState: 'saving' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void useStore.getState().saveNow(), 700);
}

function maybeAutoVersion() {
  const s = useStore.getState();
  if (s.doc && s.doc.pendingChanges.length >= 15) void s.createVersion(undefined, true);
}

function exists(doc: ProjectDoc, ref: ElementRef): boolean {
  if (ref.kind === 'siteFeature') return !!doc.site.features[ref.id];
  const b = activeBuilding(doc);
  const col = { wall: b.walls, door: b.doors, window: b.windows, room: b.rooms, stair: b.stairs, roof: b.roofs, column: b.columns, beam: b.beams, furniture: b.furniture, level: b.levels }[ref.kind];
  return !!col?.[ref.id];
}

export function snapshot(doc: ProjectDoc, number: number, name: string, changes: string[], auto: boolean): VersionRecord {
  return { id: uid('v'), projectId: doc.id, number, name, changes, authorId: ME, createdAt: Date.now(), snapshot: JSON.parse(JSON.stringify({ ...doc, pendingChanges: [] })), auto };
}

export function indexEntry(doc: ProjectDoc, size: number): ProjectIndexEntry {
  const b = activeBuilding(doc);
  const rules = resolveRules(doc.meta.ruleSetId, doc.ruleOverrides);
  let health = 0, cost = 0, builtUp = 0;
  try {
    health = validate(doc, b, rules).score;
    cost = estimateCost(doc, b, rules).grandTotal;
    builtUp = analyzeSite(doc, b, rules).builtUpArea;
  } catch { /* derived summaries are best-effort for the index */ }
  const stageIdx = WORKFLOW.indexOf(doc.stage);
  return {
    id: doc.id, name: doc.meta.name, city: doc.meta.location.city, type: doc.meta.type, phase: doc.meta.phase, stage: doc.stage,
    updatedAt: doc.meta.updatedAt, createdAt: doc.meta.createdAt, favorite: doc.meta.favorite,
    members: doc.meta.members.map((m) => m.userId), thumbnail: planThumbnail(doc),
    progress: Math.round(((stageIdx + 1) / WORKFLOW.length) * 100 * 0.9 + (health / 100) * 10),
    ownerId: doc.meta.ownerId, shared: doc.meta.ownerId !== ME, builtUp, health, cost, currency: doc.cost.currency, sizeBytes: size,
    approvalsPending: doc.approvals.filter((a) => a.decision === 'pending').map((a) => ({ id: a.id, subject: a.subject, reviewerId: a.reviewerId, at: a.at })),
    commentsOpen: doc.comments.filter((c) => !c.resolved).map((c) => ({ id: c.id, authorId: c.authorId, body: c.body, at: c.createdAt, mentionsMe: c.mentions.includes(ME) })),
    tasksOpen: doc.tasks.filter((t) => t.status !== 'done').length,
    activity: doc.activity.slice(0, 6).map((a) => ({ id: a.id, actorId: a.actorId, summary: a.summary, at: a.at })),
    levels: Object.keys(b.levels).length,
    rooms: Object.keys(b.rooms).length,
    stageIndex: stageIdx,
  };
}

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) return { name: 'project', id: parts[1], space: (parts[2] as Space) || 'design' };
  const sec = (parts[0] as HomeSection) || 'home';
  return { name: 'home', section: ['home', 'projects', 'shared', 'templates', 'library', 'admin'].includes(sec) ? sec : 'home' };
}

function heartbeat() {
  const s = useStore.getState();
  if (!channel) return;
  const level = s.doc && s.levelId ? activeBuilding(s.doc).levels[s.levelId]?.name : undefined;
  channel.postMessage({ type: 'presence', tab: TAB, projectId: s.doc?.id ?? '', label: s.doc ? `viewing ${level ?? s.doc.meta.name}` : 'on the dashboard', at: Date.now() });
  const peers = Object.fromEntries(Object.entries(s.peers).filter(([, p]) => Date.now() - p.at < 12000));
  if (Object.keys(peers).length !== Object.keys(s.peers).length) useStore.setState({ peers });
}

async function onPeerMessage(m: { type: string; tab: string; id?: string; projectId?: string; label?: string; at: number }) {
  if (m.tab === TAB) return;
  const s = useStore.getState();
  if (m.type === 'presence') useStore.setState({ peers: { ...s.peers, [m.tab]: { projectId: m.projectId ?? '', label: m.label ?? '', at: m.at } } });
  if (m.type === 'saved' && m.id) {
    const index = await localAdapter.loadIndex();
    useStore.setState({ index: index.sort((a, b) => b.updatedAt - a.updatedAt) });
    if (s.doc?.id === m.id && s.saveState === 'saved' && m.at > s.doc.meta.updatedAt) {
      const doc = await localAdapter.loadProject(m.id);
      if (doc) { useStore.setState({ doc, past: [], future: [] }); s.toast('Synced changes from another window'); }
    }
  }
}

export { auraVilla };

// Dev-only handle for scripted checks; never present in production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __plinthStore?: typeof useStore }).__plinthStore = useStore;
