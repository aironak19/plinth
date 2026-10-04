/**
 * "Add" library — ready-made spaces anyone can drag onto the plan. Cards show
 * the real result (walls, doors, windows, furniture) and plain-language sizes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, GripVertical, MousePointerClick } from 'lucide-react';
import { useStore } from '../../state/store';
import { BLOCKS, BLOCK_CATEGORIES, searchBlocks, blockSize, type BlockCategory, type BlockDef } from '../../core/catalog/blocks';
import { blockPreviewSvg } from './blockPreview';
import { formatArea, formatLength, ft } from '../../core/units';

const EMPTY_IMG = typeof Image !== 'undefined' ? (() => { const i = new Image(); i.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; return i; })() : null;

export function BlockLibrary({ compact, initialCategory }: { compact?: boolean; initialCategory?: BlockCategory | 'all' }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<BlockCategory | 'all'>(initialCategory ?? 'all');
  useEffect(() => {
    const h = (e: Event) => { setCat((e as CustomEvent).detail as BlockCategory); setQ(''); };
    window.addEventListener('plinth:blockcat', h);
    return () => window.removeEventListener('plinth:blockcat', h);
  }, []);
  const list = useMemo(() => (q ? searchBlocks(q) : BLOCKS.filter((b) => cat === 'all' || b.category === cat)), [q, cat]);
  const grouped = useMemo(() => {
    if (q || cat !== 'all') return [{ id: 'results', label: q ? `${list.length} matches` : BLOCK_CATEGORIES.find((c) => c.id === cat)?.label ?? '', hint: '', blocks: list }];
    return BLOCK_CATEGORIES.map((c) => ({ ...c, blocks: list.filter((b) => b.category === c.id) }));
  }, [list, q, cat]);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} className="muted" style={{ position: 'absolute', left: 9, top: 8 }} />
        <input className="input" style={{ paddingLeft: 30 }} placeholder="What do you want to add?" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Search ready-made spaces" />
      </div>
      {!q && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          <button className={`chip ${cat === 'all' ? 'accent' : ''}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setCat('all')}>All</button>
          {BLOCK_CATEGORIES.map((c) => <button key={c.id} className={`chip ${cat === c.id ? 'accent' : ''}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setCat(c.id)}>{c.label}</button>)}
        </div>
      )}
      {!compact && <div className="tiny muted row" style={{ gap: 6 }}><GripVertical size={12} /> Drag onto the plan, or <MousePointerClick size={12} /> click then click the plan. <b>R</b> rotates.</div>}
      {grouped.map((g) => g.blocks.length > 0 && (
        <div key={g.id} className="col" style={{ gap: 8 }}>
          <div><div className="caps">{g.label}</div>{g.hint && <div className="tiny muted">{g.hint}</div>}</div>
          {g.blocks.map((b) => <BlockCard key={b.id} def={b} />)}
        </div>
      ))}
      {!list.length && <div className="empty small">Nothing matches “{q}”. Try “bedroom”, “bath”, “kitchen”, “stair” or “2bhk”.</div>}
    </div>
  );
}

function BlockCard({ def }: { def: BlockDef }) {
  const units = useStore((s) => s.doc?.meta.units ?? 'imperial');
  const placing = useStore((s) => (s.tool === 'block' ? s.placeBlock : null));
  const startBlock = useStore((s) => s.startBlock);
  const [sizeId, setSizeId] = useState(blockSize(def).id);
  const size = blockSize(def, sizeId);
  const svg = useMemo(() => blockPreviewSvg(def.id, size.id), [def.id, size.id]);
  const active = placing?.blockId === def.id;
  const dims = `${formatLength(ft(size.w), units, { compact: true })} × ${formatLength(ft(size.d), units, { compact: true })}`;
  return (
    <div className="card" draggable aria-label={`${def.name}, ${size.label}`} role="button" tabIndex={0}
      style={{ overflow: 'hidden', cursor: 'grab', borderColor: active ? 'var(--accent)' : undefined, boxShadow: active ? 'var(--ring)' : undefined }}
      onDragStart={(e) => { e.dataTransfer.setData('text/plinth-block', JSON.stringify({ blockId: def.id, size: size.id })); e.dataTransfer.effectAllowed = 'copy'; if (EMPTY_IMG) e.dataTransfer.setDragImage(EMPTY_IMG, 0, 0); startBlock(def.id, size.id); }}
      onClick={() => startBlock(def.id, size.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') startBlock(def.id, size.id); }}>
      <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 10, padding: 10 }}>
        <div style={{ background: 'var(--paper)', borderRadius: 8, aspectRatio: '1', border: '1px solid var(--line)', padding: 4 }} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="col" style={{ gap: 3, minWidth: 0 }}>
          <b style={{ lineHeight: 1.25 }}>{def.name}</b>
          <div className="tiny muted" style={{ lineHeight: 1.35 }}>{size.fits}</div>
          <div className="tiny num" style={{ color: 'var(--ink-2)' }}>{dims} · {formatArea(ft(size.w) * ft(size.d), units)}</div>
          {def.sizes.length > 1 && (
            <div className="row" style={{ gap: 3, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
              {def.sizes.map((s) => (
                <button key={s.id} className={`btn sm ${s.id === sizeId ? 'active' : 'ghost'}`} style={{ height: 22, padding: '0 7px', fontSize: 11 }} title={`${s.label} — ${s.fits}`}
                  onClick={() => { setSizeId(s.id); if (active) startBlock(def.id, s.id); }}>{s.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
