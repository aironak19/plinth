/** ⌘K — one box for every command and every thing in the project (rooms, tags, drawings, materials, versions, people). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Sparkles, CornerDownLeft } from 'lucide-react';
import { useStore } from '../../state/store';
import { getCommands } from '../commands';
import { Icon } from '../icons';
import { Kbd } from '../components';
import { activeBuilding, levelsSorted } from '../../core/model/query';
import { deriveLevel } from '../../core/derive/level';
import { MATERIALS } from '../../core/catalog/materials';
import { USERS } from '../../core/model/org';
import { formatArea } from '../../core/units';

interface Item { id: string; title: string; sub?: string; group: string; icon: string; keys?: string; run: () => void }

function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  if (t.startsWith(s)) return 3;
  if (t.includes(s)) return 2;
  let i = 0;
  for (const ch of t) if (ch === s[i]) i++;
  return i === s.length ? 1 : 0;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const set = useStore((s) => s.set);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const s = useStore.getState();
    const out: Item[] = getCommands().map((c) => ({ id: c.id, title: c.title, group: c.group, icon: c.icon ?? 'command', keys: c.keys, run: c.run }));
    const doc = s.doc;
    if (doc && s.route.name === 'project') {
      const b = activeBuilding(doc);
      for (const l of levelsSorted(b)) {
        out.push({ id: `lv-${l.id}`, title: l.name, sub: 'Level', group: 'Levels', icon: 'level', run: () => { s.navigate({ name: 'project', id: doc.id, space: 'design' }); s.setLevel(l.id); } });
        for (const r of deriveLevel(b, l.id).rooms) {
          if (!r.tagId) continue;
          out.push({ id: `rm-${r.id}`, title: `Open ${r.name}`, sub: `${l.name} · ${formatArea(r.area, doc.meta.units)}`, group: 'Rooms', icon: 'room', run: () => { s.navigate({ name: 'project', id: doc.id, space: 'design' }); s.setLevel(l.id); s.select([{ kind: 'room', id: r.tagId! }]); s.focusOn(r.labelPoint, l.id); } });
        }
      }
      for (const d of Object.values(b.doors)) out.push({ id: `d-${d.id}`, title: `Door ${d.tag}`, sub: `${d.kind} · ${Math.round(d.width)} × ${Math.round(d.height)}`, group: 'Doors & windows', icon: 'door', run: () => goEl({ kind: 'door', id: d.id }, b.walls[d.wallId]?.levelId) });
      for (const w of Object.values(b.windows)) out.push({ id: `n-${w.id}`, title: `Window ${w.tag}`, sub: `${w.kind} · ${Math.round(w.width)} × ${Math.round(w.height)}`, group: 'Doors & windows', icon: 'window', run: () => goEl({ kind: 'window', id: w.id }, b.walls[w.wallId]?.levelId) });
      const sheets = ['A-000 Cover & index', 'A-001 Site plan', ...levelsSorted(b).map((l, i) => `A-10${i + 1} ${l.name} plan`), 'A-201 Elevations', 'A-202 Elevations', 'A-301 Sections', 'A-401 Roof plan', 'A-601 Door & window schedules', 'A-602 Room schedule'];
      for (const sh of sheets) out.push({ id: `sh-${sh}`, title: `Drawing ${sh}`, group: 'Drawings', icon: 'docs', run: () => { s.navigate({ name: 'project', id: doc.id, space: 'docs' }); setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:sheet', { detail: sh.split(' ')[0] })), 50); } });
      for (const v of s.versions) out.push({ id: `v-${v.id}`, title: `Revision ${v.number} — ${v.name}`, sub: v.changes.slice(0, 2).join(' · '), group: 'Versions', icon: 'version', run: () => s.navigate({ name: 'project', id: doc.id, space: 'versions' }) });
      for (const m of MATERIALS.filter((m) => m.slots.length)) out.push({ id: `m-${m.id}`, title: m.name, sub: `Material · ${m.category}`, group: 'Materials', icon: 'palette', run: () => s.navigate({ name: 'project', id: doc.id, space: 'library' }) });
      for (const c of doc.comments) out.push({ id: `c-${c.id}`, title: c.body.slice(0, 70), sub: 'Comment', group: 'Comments', icon: 'comment', run: () => s.navigate({ name: 'project', id: doc.id, space: 'collab' }) });
    }
    for (const u of USERS) out.push({ id: `u-${u.id}`, title: u.name, sub: u.title, group: 'People', icon: 'home', run: () => s.navigate({ name: 'home', section: 'admin' }) });
    for (const p of s.index) out.push({ id: `p-${p.id}`, title: p.name, sub: `${p.city} · ${p.phase}`, group: 'Projects', icon: 'building', run: () => void s.openProject(p.id) });
    function goEl(ref: { kind: 'door' | 'window'; id: string }, levelId?: string) {
      if (!doc) return;
      s.navigate({ name: 'project', id: doc.id, space: 'design' });
      if (levelId) s.setLevel(levelId);
      s.select([ref]);
    }
    return out;
  }, [open]);

  const filtered = useMemo(() => {
    const qq = q.trim();
    const isAsk = /^(make|add|how|show|find|create|give|move|change|use|replace|reduce|rename|what|which)\b/i.test(qq) && qq.split(' ').length > 2;
    const res = items.map((it) => ({ it, s: Math.max(score(qq, it.title), score(qq, it.sub ?? '') * 0.5) })).filter((x) => x.s > 0);
    res.sort((a, b) => b.s - a.s);
    const list = (qq ? res.slice(0, 60) : res.filter((x) => ['Create', 'View', 'Navigate', 'AI', 'Projects'].includes(x.it.group)).slice(0, 40)).map((x) => x.it);
    const s = useStore.getState();
    if (qq && s.doc && s.route.name === 'project') list.splice(isAsk ? 0 : Math.min(list.length, 6), 0, {
      id: 'ask', title: `Ask Architect AI: “${qq}”`, group: 'AI', icon: 'ai', run: () => {
        s.navigate({ name: 'project', id: s.doc!.id, space: 'design' });
        s.set('aiOpen', true);
        setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:ask', { detail: qq })), 60);
      },
    });
    return list;
  }, [q, items]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  if (!open) return null;
  const close = () => set('paletteOpen', false);
  const run = (it: Item) => { close(); it.run(); };
  let lastGroup = '';
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={17} className="muted" />
          <input ref={inputRef} value={q} placeholder="Type a command, search, or ask Architect AI…" aria-label="Command or search"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); run(filtered[active]); }
              else if (e.key === 'Escape') close();
            }} />
          <Kbd>esc</Kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {filtered.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.id}>
                {head && <div className="palette-group caps">{head}</div>}
                <div className="palette-item" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => run(it)}>
                  <span className="ico">{it.id === 'ask' ? <Sparkles size={14} /> : <Icon name={it.icon} size={14} />}</span>
                  <div className="grow">
                    <div className="truncate" style={{ fontWeight: 500 }}>{it.title}</div>
                    {it.sub && <div className="tiny muted truncate">{it.sub}</div>}
                  </div>
                  {it.keys && <Kbd>{it.keys}</Kbd>}
                </div>
              </div>
            );
          })}
          {!filtered.length && <div className="empty">No matches. Press Enter in a project to ask Architect AI.</div>}
        </div>
        <div className="palette-foot"><span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate</span><span><Kbd><CornerDownLeft size={10} /></Kbd> run</span><span>Try “make the kitchen 2 ft wider”</span></div>
      </div>
    </div>
  );
}
