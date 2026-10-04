import { useEffect, lazy, Suspense } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../state/store';
import { CommandPalette } from './shell/CommandPalette';
import { HomeShell } from './home/HomeShell';
import { ProjectShell } from './shell/ProjectShell';
import { NewProjectWizard } from './home/NewProjectWizard';
import { Kbd, Modal } from './components';
import { getCommands } from './commands';

const PresentMode = lazy(() => import('./present/PresentMode'));

export function App() {
  const ready = useStore((s) => s.ready);
  const route = useStore((s) => s.route);
  const presentOpen = useStore((s) => s.presentOpen);
  const hasDoc = useStore((s) => !!s.doc);

  useEffect(() => { void useStore.getState().init(); }, []);
  useShortcuts();

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <div className="col" style={{ alignItems: 'center', gap: 14 }}>
          <div className="brand-mark" style={{ width: 40, height: 40, borderRadius: 11 }}><Logo size={22} /></div>
          <div className="muted small">Preparing your studio…</div>
        </div>
      </div>
    );
  }
  return (
    <>
      {route.name === 'project' && hasDoc ? <ProjectShell /> : <HomeShell />}
      <CommandPalette />
      <NewProjectWizard />
      <ShortcutsHelp />
      {presentOpen && hasDoc && <Suspense fallback={null}><PresentMode /></Suspense>}
      <Toasts />
    </>
  );
}

export function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M4 26h24M7 26V12.5L16 6l9 6.5V26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <rect x="13.5" y="17" width="5" height="9" fill="currentColor" />
    </svg>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function ShortcutsHelp() {
  const open = useStore((s) => s.shortcutsOpen);
  const set = useStore((s) => s.set);
  if (!open) return null;
  const cmds = getCommands().filter((c) => c.keys);
  const extra = [['Pan', 'Space + drag · scroll'], ['Zoom', '⌘ + scroll · pinch'], ['Nudge', 'Arrow keys (⇧ = 1 ft / 300 mm)'], ['Rotate furniture', 'R while placing · ] '], ['Finish wall chain', 'Enter · Esc · double-click'], ['Exact length', 'Type a length while drawing'], ['Command palette', '⌘K'], ['Architect AI', '⌘J']];
  return (
    <Modal onClose={() => set('shortcutsOpen', false)} label="Keyboard shortcuts" width={640}>
      <div className="panel-head"><h2>Keyboard shortcuts</h2><button className="btn ghost icon sm" onClick={() => set('shortcutsOpen', false)} aria-label="Close"><X size={15} /></button></div>
      <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 28px' }}>
        {cmds.map((c) => <div key={c.id} className="row" style={{ justifyContent: 'space-between', minHeight: 30 }}><span>{c.title}</span><Kbd>{c.keys}</Kbd></div>)}
        {extra.map(([a, b]) => <div key={a} className="row" style={{ justifyContent: 'space-between', minHeight: 30 }}><span>{a}</span><span className="muted small">{b}</span></div>)}
        <div className="muted small" style={{ gridColumn: '1 / -1', marginTop: 8 }}>Shortcuts can be customised in Project settings → Shortcuts.</div>
      </div>
    </Modal>
  );
}

/** Global keyboard handling. Single-key tool shortcuts are ignored while typing. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); s.set('paletteOpen', !s.paletteOpen); return; }
      if (mod && e.key.toLowerCase() === 'j' && s.doc) { e.preventDefault(); s.set('aiOpen', !s.aiOpen); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (s.doc) void s.createVersion(); return; }
      if (mod && e.key.toLowerCase() === 'd' && s.selection.length) { e.preventDefault(); s.dispatch([{ type: 'element.duplicate', params: { refs: s.selection, delta: { x: 600, y: -600 } } }]); return; }
      if (mod || e.altKey) return;
      if (e.key === '?') { s.set('shortcutsOpen', true); return; }
      if (!s.doc || s.route.name !== 'project' || s.presentOpen || s.paletteOpen) return;
      if (e.key === 'Escape') { if (s.proposal) s.setProposal(null); else if (s.tool !== 'select') s.setTool('select'); else s.select([]); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) { e.preventDefault(); s.dispatch([{ type: 'element.delete', params: { refs: s.selection } }]); return; }
      if (e.key.startsWith('Arrow') && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? (s.doc.meta.units === 'metric' ? 300 : 304.8) : s.doc.meta.units === 'metric' ? 10 : 25.4;
        const d = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } }[e.key]!;
        s.dispatch([{ type: 'element.move', params: { refs: s.selection, delta: d } }], { silent: true, keepSelection: true });
        return;
      }
      const k = e.key.toLowerCase();
      const sc = s.shortcuts;
      const inDesign = s.route.space === 'design';
      const goDesign = () => { if (!inDesign) s.navigate({ name: 'project', id: s.doc!.id, space: 'design' }); };
      const tools: [string, Parameters<typeof s.setTool>[0]][] = [['select', 'select'], ['wall', 'wall'], ['door', 'door'], ['window', 'window'], ['stair', 'stair'], ['room', 'room'], ['column', 'column'], ['comment', 'comment']];
      for (const [name, tool] of tools) if (k === sc[name]) { goDesign(); s.setTool(tool); return; }
      if (k === sc.plan) { goDesign(); s.setView('plan'); return; }
      if (k === sc['3d']) { goDesign(); s.setView('3d'); return; }
      if (k === sc.split) { goDesign(); s.setView('split'); return; }
      if (k === sc.elevation) { s.navigate({ name: 'project', id: s.doc.id, space: 'docs' }); setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:sheet', { detail: 'A-201' })), 50); return; }
      if (k === sc.copy && s.selection.length) { s.dispatch([{ type: 'element.duplicate', params: { refs: s.selection, delta: { x: 600, y: -600 } } }]); return; }
      if (k === sc.move && s.selection.length) { s.toast('Drag the selection, or use arrow keys to nudge'); return; }
      if (k === sc.align && s.selection.length > 1) { alignSelection(); return; }
      if (k === ']' || (k === 'r' && s.tool === 'place')) { s.set('placeRotation', (s.placeRotation + 90) % 360); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function alignSelection() {
  const s = useStore.getState();
  const b = s.doc!.options.find((o) => o.id === s.doc!.activeOptionId)!.building;
  const items = s.selection.filter((r) => r.kind === 'furniture').map((r) => b.furniture[r.id]).filter(Boolean);
  if (items.length < 2) { s.toast('Select two or more furniture items to align'); return; }
  const y = items[0].position.y;
  s.dispatch(items.slice(1).map((f) => ({ type: 'element.move', params: { refs: [{ kind: 'furniture', id: f.id }], delta: { x: 0, y: y - f.position.y } } })), { label: `Aligned ${items.length} items` });
}
