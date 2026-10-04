/** Design workspace: levels & browser · plan / 3D / split canvas · contextual inspector or Architect AI. */
import { lazy, Suspense, useState } from 'react';
import {
  MousePointer2, BrickWall, Square, DoorOpen, AppWindow, Footprints, Columns3, Sofa, MessageSquare, Map, Box, SquareSplitHorizontal,
  Eye, EyeOff, Lock, LockOpen, Plus, RotateCw, Copy, Trash, Scissors, ArrowLeftRight, Palette, Sparkles, ChevronRight, Layers, Undo2, Redo2,
} from 'lucide-react';
import { useStore, type Tool } from '../../state/store';
import { useBuilding, useDoc, useLevels, useDerivedLevel, useHealth, useUnits } from '../../state/derived';
import { PlanView } from '../plan/PlanView';
import { Inspector } from '../inspector/Inspector';
import { AIPanel } from '../ai/AIPanel';
import { Kbd, LengthInput, Switch, useIsMobile } from '../components';
import { formatArea } from '../../core/units';
import { ROOM_TINT } from '../plan/colors';
import { ASSET_BY_ID } from '../../core/catalog/assets';
import type { ElementRef } from '../../core/model/types';
import { wallLength } from '../../core/model/query';

const Viewport3D = lazy(() => import('../three/Viewport3D'));
const LibraryPicker = lazy(() => import('./LibrarySpace').then((m) => ({ default: m.FurniturePicker })));

export function DesignSpace() {
  const view = useStore((s) => s.view);
  const levelId = useStore((s) => s.levelId);
  const aiOpen = useStore((s) => s.aiOpen);
  const levels = useLevels();
  const lid = levelId && levels.some((l) => l.id === levelId) ? levelId : levels[0]?.id;
  const mobile = useIsMobile();
  const hasSelection = useStore((s) => s.selection.length > 0);
  const [leftOpen, setLeftOpen] = useState(!mobile);
  return (
    <>
      {leftOpen && <LeftPanel levelId={lid} onClose={() => setLeftOpen(false)} />}
      <div className={`canvas-wrap ${view === 'split' ? 'split' : ''}`}>
        {(view === 'plan' || view === 'split') && lid && <div className="canvas-pane" style={view === 'plan' ? { position: 'absolute', inset: 0 } : undefined}><PlanView levelId={lid} /></div>}
        {(view === '3d' || view === 'split') && <div className="canvas-pane" style={view === '3d' ? { position: 'absolute', inset: 0 } : undefined}><Suspense fallback={<div className="empty">Loading 3D…</div>}><Viewport3D compact={view === 'split'} /></Suspense></div>}
        {!lid && <div className="empty" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>Add a level to start designing.</div>}
        <ViewSwitch />
        {view !== '3d' && !mobile && <Toolbar />}
        <ContextBar />
        <ProposalBanner />
        {!leftOpen && <button className="floating btn ghost" style={{ top: 12, left: 12, height: 34 }} onClick={() => setLeftOpen(true)}><Layers size={15} /> Levels</button>}
      </div>
      {aiOpen ? <AIPanel /> : (!mobile || hasSelection) && <Inspector />}
    </>
  );
}

function ViewSwitch() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const undo = useStore((s) => s.undo), redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0), canRedo = useStore((s) => s.future.length > 0);
  return (
    <div className="floating view-switch row" style={{ gap: 4 }}>
      <button className="btn ghost icon sm" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={15} /></button>
      <button className="btn ghost icon sm" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 size={15} /></button>
      <div className="seg">
        <button aria-pressed={view === 'plan'} onClick={() => setView('plan')} title="Plan (P)"><Map size={14} /> Plan</button>
        <button aria-pressed={view === 'split'} onClick={() => setView('split')} title="Split (2)"><SquareSplitHorizontal size={14} /></button>
        <button aria-pressed={view === '3d'} onClick={() => setView('3d')} title="3D (3)"><Box size={14} /> 3D</button>
      </div>
    </div>
  );
}

function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const placeAsset = useStore((s) => s.placeAsset);
  const [picker, setPicker] = useState(false);
  const tools: { id: Tool; icon: React.ReactNode; label: string; key: string }[] = [
    { id: 'select', icon: <MousePointer2 size={17} />, label: 'Select', key: 'V' },
    { id: 'wall', icon: <BrickWall size={17} />, label: 'Wall', key: 'W' },
    { id: 'room', icon: <Square size={17} />, label: 'Room', key: 'R' },
    { id: 'door', icon: <DoorOpen size={17} />, label: 'Door', key: 'D' },
    { id: 'window', icon: <AppWindow size={17} />, label: 'Window', key: 'N' },
    { id: 'stair', icon: <Footprints size={17} />, label: 'Stair', key: 'S' },
    { id: 'column', icon: <Columns3 size={17} />, label: 'Column', key: 'O' },
  ];
  return (
    <>
      <div className="floating toolbar" role="toolbar" aria-label="Drawing tools">
        {tools.map((t) => (
          <button key={t.id} aria-pressed={tool === t.id} aria-label={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
            {t.icon}<span className="tip">{t.label} <Kbd>{t.key}</Kbd></span>
          </button>
        ))}
        <span className="sep" />
        <button aria-pressed={tool === 'place' || picker} aria-label="Furniture & objects" onClick={() => setPicker(!picker)}>
          <Sofa size={17} />{tool === 'place' && placeAsset ? <span className="small">{ASSET_BY_ID[placeAsset]?.name}</span> : null}<span className="tip">Furniture & objects</span>
        </button>
        <button aria-pressed={tool === 'comment'} aria-label="Comment (K)" onClick={() => setTool('comment')}><MessageSquare size={17} /><span className="tip">Comment <Kbd>K</Kbd></span></button>
      </div>
      {picker && (
        <div className="floating" style={{ bottom: 70, left: '50%', transform: 'translateX(-50%)', width: 560, maxHeight: 360, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Suspense fallback={<div className="empty">Loading library…</div>}>
            <LibraryPicker onPick={(id) => { setTool('place', id); setPicker(false); }} onClose={() => setPicker(false)} />
          </Suspense>
        </div>
      )}
    </>
  );
}

/** Only the actions that make sense for what is selected. */
function ContextBar() {
  const selection = useStore((s) => s.selection);
  const dispatch = useStore((s) => s.dispatch);
  const set = useStore((s) => s.set);
  const b = useBuilding();
  const tool = useStore((s) => s.tool);
  if (!selection.length || tool !== 'select') return null;
  const one = selection.length === 1 ? selection[0] : null;
  const act = (ops: Parameters<typeof dispatch>[0], keep = true) => dispatch(ops, { keepSelection: keep });
  const del = <button onClick={() => dispatch([{ type: 'element.delete', params: { refs: selection } }])} title="Delete (⌫)"><Trash size={14} /> Delete</button>;
  const dup = <button onClick={() => dispatch([{ type: 'element.duplicate', params: { refs: selection, delta: { x: 600, y: -600 } } }])} title="Duplicate (C)"><Copy size={14} /> Duplicate</button>;
  const ai = <button onClick={() => set('aiOpen', true)} title="Ask Architect AI about this"><Sparkles size={14} /> Ask AI</button>;
  let title = `${selection.length} selected`;
  let body: React.ReactNode = <>{dup}{del}</>;
  if (one?.kind === 'wall' && b.walls[one.id]) {
    const w = b.walls[one.id];
    title = `${w.kind === 'exterior' ? 'Exterior' : 'Interior'} wall`;
    body = (
      <>
        <button onClick={() => act([{ type: 'wall.split', params: { id: w.id, at: wallLength(w) / 2 } }], false)}><Scissors size={14} /> Split</button>
        <button onClick={() => act([{ type: 'door.create', params: { wallId: w.id } }], false)}><DoorOpen size={14} /> Door</button>
        <button onClick={() => act([{ type: 'window.create', params: { wallId: w.id } }], false)}><AppWindow size={14} /> Window</button>
        <span className="sep" />
        <button onClick={() => act([{ type: 'wall.update', params: { id: w.id, patch: { thickness: w.thickness > 150 ? 115 : 230, kind: w.thickness > 150 ? 'interior' : 'exterior' } } }])}>{w.thickness > 150 ? '4½" partition' : '9" wall'}</button>
        <button onClick={() => set('aiOpen', false)}><Palette size={14} /> Material</button>
        {dup}{del}{ai}
      </>
    );
  } else if (one?.kind === 'furniture' && b.furniture[one.id]) {
    title = ASSET_BY_ID[b.furniture[one.id].assetId]?.name ?? 'Item';
    body = <><button onClick={() => act([{ type: 'element.rotate', params: { refs: [one], angle: 90 } }])}><RotateCw size={14} /> Rotate</button><button onClick={() => set('aiOpen', false)}><Palette size={14} /> Material</button>{dup}{del}</>;
  } else if (one?.kind === 'room' && b.rooms[one.id]) {
    title = b.rooms[one.id].name;
    body = <><button onClick={() => window.dispatchEvent(new CustomEvent('plinth:rename'))}>Rename</button><button onClick={() => set('aiOpen', false)}><Palette size={14} /> Finishes</button><button onClick={() => { set('aiOpen', true); setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:ask', { detail: `Make the ${b.rooms[one.id].name} 2 ft wider` })), 50); }}><Sparkles size={14} /> Make larger</button>{del}</>;
  } else if (one && (one.kind === 'door' || one.kind === 'window')) {
    const o = one.kind === 'door' ? b.doors[one.id] : b.windows[one.id];
    if (!o) return null;
    title = `${one.kind === 'door' ? 'Door' : 'Window'} ${o.tag}`;
    body = (
      <>
        {one.kind === 'door' && <button onClick={() => act([{ type: 'door.update', params: { id: one.id, patch: { side: b.doors[one.id].side === 'left' ? 'right' : 'left' } } }])}><ArrowLeftRight size={14} /> Flip swing</button>}
        {one.kind === 'door' && <button onClick={() => act([{ type: 'door.update', params: { id: one.id, patch: { hinge: b.doors[one.id].hinge === 'start' ? 'end' : 'start' } } }])}>Hinge</button>}
        <button onClick={() => act([{ type: one.kind === 'door' ? 'door.update' : 'window.update', params: { id: one.id, patch: { width: o.width + 150 } } }])}>Wider</button>
        <button onClick={() => act([{ type: one.kind === 'door' ? 'door.update' : 'window.update', params: { id: one.id, patch: { width: Math.max(450, o.width - 150) } } }])}>Narrower</button>
        {del}
      </>
    );
  } else if (one?.kind === 'stair' && b.stairs[one.id]) {
    const st = b.stairs[one.id];
    const kinds = ['straight', 'L', 'U', 'spiral'] as const;
    title = `${st.kind} stair`;
    body = <><button onClick={() => act([{ type: 'element.rotate', params: { refs: [one], angle: 90 } }])}><RotateCw size={14} /> Rotate</button><button onClick={() => act([{ type: 'stair.update', params: { id: st.id, patch: { kind: kinds[(kinds.indexOf(st.kind) + 1) % 4] } } }])}>Type: {st.kind}</button><button onClick={() => act([{ type: 'stair.update', params: { id: st.id, patch: { mirrored: !st.mirrored } } }])}><ArrowLeftRight size={14} /> Mirror</button>{del}</>;
  }
  return (
    <div className="floating ctxbar" role="toolbar" aria-label="Selection actions">
      <span className="title">{title}</span><span className="sep" />{body}
    </div>
  );
}

function ProposalBanner() {
  const p = useStore((s) => s.proposal);
  const setProposal = useStore((s) => s.setProposal);
  const apply = useStore((s) => s.applyProposal);
  if (!p?.previewing) return null;
  return (
    <div className="floating" style={{ top: 58, left: '50%', transform: 'translateX(-50%)', padding: '8px 10px 8px 14px', display: 'flex', alignItems: 'center', gap: 10, borderColor: 'var(--accent)', boxShadow: 'var(--shadow-lg)' }}>
      <Sparkles size={15} style={{ color: 'var(--accent)' }} />
      <span style={{ fontWeight: 600 }}>Previewing: {p.proposal.title}</span>
      <span className="muted small">dashed blue = proposed</span>
      <button className="btn sm" onClick={() => setProposal({ ...p, previewing: false })}>Hide preview</button>
      <button className="btn sm ghost" onClick={() => setProposal(null)}>Cancel</button>
      <button className="btn sm primary" onClick={() => apply()}>Apply</button>
    </div>
  );
}

function LeftPanel({ levelId, onClose }: { levelId?: string; onClose: () => void }) {
  const doc = useDoc();
  const levels = useLevels();
  const setLevel = useStore((s) => s.setLevel);
  const dispatch = useStore((s) => s.dispatch);
  const layers = useStore((s) => s.layers);
  const set = useStore((s) => s.set);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const focusOn = useStore((s) => s.focusOn);
  const units = useUnits();
  const dl = useDerivedLevel(levelId ?? null);
  const health = useHealth();
  const [tab, setTab] = useState<'levels' | 'layers'>('levels');
  const sel = (r: ElementRef) => selection.some((x) => x.id === r.id);
  return (
    <aside className="panel" aria-label="Levels and project browser">
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'levels'} onClick={() => setTab('levels')}>Levels & rooms</button>
        <button role="tab" aria-selected={tab === 'layers'} onClick={() => setTab('layers')}>Layers</button>
        <button className="btn ghost icon sm" style={{ flex: 'none' }} onClick={onClose} aria-label="Collapse panel">‹</button>
      </div>
      <div className="panel-body">
        {tab === 'levels' ? (
          <>
            <div className="panel-section">
              <div className="row" style={{ marginBottom: 6 }}><span className="caps grow">Levels</span><button className="btn ghost icon sm" aria-label="Add level" onClick={() => { const names = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor']; dispatch([{ type: 'level.create', params: { name: names[levels.length] ?? `Level ${levels.length}`, copyExteriorFrom: levels[levels.length - 1]?.id } }]); }}><Plus size={14} /></button></div>
              {[...levels].reverse().map((l) => (
                <div key={l.id} className="list-item" aria-selected={l.id === levelId} onClick={() => setLevel(l.id)}>
                  <div className="grow"><div style={{ fontWeight: 500 }}>{l.name}</div><div className="tiny muted num">FFL {l.elevation >= 0 ? '+' : ''}{(l.elevation / 1000).toFixed(2)} m · <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-block', width: 64 }}><LengthInput className="input bare num tiny" value={l.height} units={units} onCommit={(mm) => dispatch([{ type: 'level.update', params: { id: l.id, patch: { height: mm } } }])} ariaLabel={`${l.name} height`} /></span></div></div>
                  <button className="btn ghost icon sm" aria-label={l.locked ? 'Unlock level' : 'Lock level'} onClick={(e) => { e.stopPropagation(); dispatch([{ type: 'level.update', params: { id: l.id, patch: { locked: !l.locked } } }], { silent: true }); }}>{l.locked ? <Lock size={13} /> : <LockOpen size={13} className="muted" />}</button>
                </div>
              ))}
            </div>
            {dl && (
              <div className="panel-section">
                <div className="row" style={{ marginBottom: 6 }}><span className="caps grow">Rooms on {dl.level.name}</span><span className="tiny muted">{formatArea(dl.netArea, units)}</span></div>
                {dl.rooms.filter((r) => r.tagId).sort((a, b) => b.area - a.area).map((r) => (
                  <div key={r.id} className="list-item" aria-selected={sel({ kind: 'room', id: r.tagId! })} onClick={() => { select([{ kind: 'room', id: r.tagId! }]); focusOn(r.labelPoint); }}>
                    <span className="swatch" style={{ background: ROOM_TINT[r.fn], width: 12, height: 12, borderRadius: 3 }} />
                    <span className="grow truncate">{r.name}</span>
                    <span className="tiny muted num">{formatArea(r.area, units)}</span>
                  </div>
                ))}
                {dl.orphanTags.map((t) => <div key={t.id} className="list-item" onClick={() => select([{ kind: 'room', id: t.id }])}><span className="chip warn" style={{ height: 18 }}>open</span><span className="grow truncate">{t.name}</span></div>)}
                {!dl.rooms.length && <div className="small muted" style={{ padding: 6 }}>No rooms yet. Press <Kbd>R</Kbd> and drag to create one, or ask Architect AI.</div>}
              </div>
            )}
            <div className="panel-section">
              <button className="list-item" style={{ width: '100%', border: 0, background: 'transparent' }} onClick={() => useStore.getState().navigate({ name: 'project', id: doc.id, space: 'analysis' })}>
                <span className={`chip ${health.score >= 90 ? 'ok' : health.score >= 75 ? 'warn' : 'err'}`}>{health.score}</span>
                <span className="grow" style={{ textAlign: 'left' }}>Design health</span>
                <span className="tiny muted">{health.errors} errors · {health.warnings} warnings</span><ChevronRight size={14} className="muted" />
              </button>
            </div>
          </>
        ) : (
          <div className="col" style={{ gap: 2 }}>
            {([['furniture', 'Furniture & fixtures'], ['dimensions', 'Dimensions'], ['site', 'Site, setbacks & landscape'], ['levelBelow', 'Level below (underlay)'], ['underlay', 'Reference images & CAD'], ['issues', 'Design health markers'], ['comments', 'Comment pins'], ['grid', 'Grid']] as const).map(([k, l]) => (
              <div key={k} className="row" style={{ minHeight: 34 }}>
                {layers[k] ? <Eye size={14} className="muted" /> : <EyeOff size={14} className="muted" />}
                <span className="grow">{l}</span>
                <Switch checked={layers[k]} onChange={(v) => set('layers', { ...layers, [k]: v })} label={l} />
              </div>
            ))}
            {doc.underlays.length > 0 && (
              <div className="panel-section" style={{ marginTop: 8 }}>
                <div className="caps" style={{ marginBottom: 6 }}>Underlays</div>
                {doc.underlays.map((u) => (
                  <div key={u.id} className="col" style={{ gap: 4, marginBottom: 10 }}>
                    <div className="row"><span className="grow truncate small">{u.name}</span><Switch checked={u.visible} onChange={(v) => dispatch([{ type: 'underlay.update', params: { id: u.id, patch: { visible: v } } }], { silent: true })} label="Visible" /></div>
                    {u.image && <div className="row tiny muted">Width <span style={{ width: 90 }}><LengthInput value={u.width} units={units} onCommit={(mm) => dispatch([{ type: 'underlay.update', params: { id: u.id, patch: { width: mm } } }])} /></span></div>}
                    <input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(e) => dispatch([{ type: 'underlay.update', params: { id: u.id, patch: { opacity: Number(e.target.value) } } }], { silent: true })} aria-label="Underlay opacity" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
