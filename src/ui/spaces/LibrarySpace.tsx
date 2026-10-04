/** Asset & material library — the same recipes drive plan symbols, 3D objects, schedules and cost. */
import { useMemo, useState } from 'react';
import { Search, X, MousePointer2, Replace } from 'lucide-react';
import { useStore } from '../../state/store';
import { ASSETS, ASSET_CATEGORIES, assetColors, type Asset, type AssetCategory } from '../../core/catalog/assets';
import { MATERIALS, type Material } from '../../core/catalog/materials';
import { furnitureSymbol, primPath } from '../../core/docs/symbols';
import { swatchStyle, Popover } from '../components';
import { activeBuilding } from '../../core/model/query';
import type { ElementRef } from '../../core/model/types';

export function AssetSymbol({ asset, size = 96 }: { asset: Asset; size?: number }) {
  const prims = furnitureSymbol({ id: 'p', levelId: '', assetId: asset.id, position: { x: 0, y: 0 }, rotation: 0, props: {} });
  const r = Math.max(asset.size.w, asset.size.d) * 0.62;
  const colors = assetColors(asset);
  return (
    <svg viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`} width={size} height={size} aria-hidden>
      {prims.map((p, i) => p.t === 'text' ? null : <path key={i} d={primPath(p)} fill={'fill' in p && p.fill ? colors.leaf : 'var(--surface)'} fillOpacity={'fill' in p && p.fill ? 0.5 : 1} stroke="var(--plan-line)" strokeWidth={r / 90} strokeDasharray={p.dash ? `${r / 30} ${r / 40}` : undefined} />)}
    </svg>
  );
}

export function FurniturePicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState<AssetCategory>('living');
  const [q, setQ] = useState('');
  const list = ASSETS.filter((a) => (q ? `${a.name} ${a.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()) : a.category === cat));
  return (
    <>
      <div className="row" style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
        <Search size={14} className="muted" />
        <input className="input bare grow" autoFocus placeholder="Search furniture, fixtures, trees, cars…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>
      {!q && <div className="row" style={{ padding: '6px 8px', gap: 2, overflowX: 'auto', borderBottom: '1px solid var(--line)' }}>{ASSET_CATEGORIES.map((c) => <button key={c.id} className={`btn sm ${cat === c.id ? 'active' : 'ghost'}`} onClick={() => setCat(c.id)}>{c.label}</button>)}</div>}
      <div className="scroll" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6, padding: 8 }}>
        {list.map((a) => (
          <button key={a.id} className="wizard-opt" style={{ padding: 6, alignItems: 'center', gap: 2 }} onClick={() => onPick(a.id)} title={`${a.name} · ${a.size.w} × ${a.size.d} mm`}>
            <AssetSymbol asset={a} size={58} />
            <span className="tiny truncate" style={{ maxWidth: '100%' }}>{a.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export default function LibrarySpace({ standalone }: { standalone?: boolean }) {
  const [tab, setTab] = useState<'assets' | 'materials'>('assets');
  const [scope, setScope] = useState<Asset['library'] | 'all'>('all');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<AssetCategory | 'all'>('all');
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const s = useStore.getState();
  const inProject = !standalone && !!doc;
  const assets = ASSETS.filter((a) => (scope === 'all' || a.library === scope) && (cat === 'all' || a.category === cat) && `${a.name} ${a.tags.join(' ')} ${a.sku}`.toLowerCase().includes(q.toLowerCase()));
  const used = useMemo(() => {
    if (!doc) return new Set<string>();
    const b = activeBuilding(doc);
    const u = new Set<string>();
    for (const w of Object.values(b.walls)) { u.add(w.materialId); u.add(w.finishExteriorId); u.add(w.finishInteriorId); }
    for (const r of Object.values(b.rooms)) { u.add(r.floorFinishId); u.add(r.wallFinishId); u.add(r.ceilingFinishId); }
    for (const r of Object.values(b.roofs)) u.add(r.materialId);
    for (const w of Object.values(b.windows)) u.add(w.frameMaterialId);
    for (const d of Object.values(b.doors)) u.add(d.materialId);
    return u;
  }, [doc]);
  const materials = MATERIALS.filter((m) => m.slots.length && `${m.name} ${m.category}`.toLowerCase().includes(q.toLowerCase()));

  const applyMaterial = (m: Material) => {
    const refs: ElementRef[] = selection.filter((r) => ['room', 'wall', 'roof', 'window', 'door', 'stair', 'furniture', 'column'].includes(r.kind));
    if (!refs.length) { s.toast('Select rooms, walls or other elements in the plan first'); return; }
    const k = refs[0].kind;
    const slot = k === 'room' ? (m.slots.includes('floor') ? 'floor' : 'wallInterior') : k === 'wall' ? (m.slots.includes('exterior') ? 'exterior' : m.slots.includes('core') ? 'core' : 'wallInterior') : k === 'roof' ? 'roof' : k === 'window' ? 'frame' : k === 'door' ? 'door' : k === 'stair' ? 'stair' : 'furniture';
    s.dispatch([{ type: 'material.apply', params: { refs, slot, materialId: m.id } }], { keepSelection: true });
  };

  const body = (
    <>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="seg"><button aria-pressed={tab === 'assets'} onClick={() => setTab('assets')}>Assets ({ASSETS.length})</button><button aria-pressed={tab === 'materials'} onClick={() => setTab('materials')}>Materials ({materials.length})</button></div>
        <div style={{ position: 'relative', width: 260 }}><Search size={14} style={{ position: 'absolute', left: 9, top: 8 }} className="muted" /><input className="input" style={{ paddingLeft: 30 }} placeholder={tab === 'assets' ? 'Search name, tag or SKU' : 'Search materials'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {tab === 'assets' && <select className="select" style={{ width: 150 }} value={cat} onChange={(e) => setCat(e.target.value as AssetCategory | 'all')} aria-label="Category"><option value="all">All categories</option>{ASSET_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>}
        {tab === 'assets' && <div className="seg">{(['all', 'public', 'company', 'team', 'personal'] as const).map((sc) => <button key={sc} aria-pressed={scope === sc} onClick={() => setScope(sc)} style={{ textTransform: 'capitalize' }}>{sc === 'all' ? 'All libraries' : sc}</button>)}</div>}
        <span className="spacer" />
        {inProject && tab === 'materials' && <span className="small muted">{selection.length ? `${selection.length} selected in plan` : 'Select elements in the plan to apply'}</span>}
      </div>
      {tab === 'assets' ? (
        <div className="grid g4">
          {assets.map((a) => (
            <div key={a.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'grid', placeItems: 'center', background: 'var(--paper)', borderBottom: '1px solid var(--line)', padding: 8 }}><AssetSymbol asset={a} size={110} /></div>
              <div className="col" style={{ padding: 12, gap: 4 }}>
                <b>{a.name}</b>
                <div className="tiny muted num">{a.size.w} × {a.size.d} × {a.size.h} mm · {a.manufacturer} · {a.sku}</div>
                <div className="row" style={{ gap: 4 }}>{a.variants.slice(0, 4).map((v) => <span key={v.id} className="swatch" title={v.name} style={{ width: 14, height: 14, background: Object.values(v.colors)[0] }} />)}<span className="spacer" /><span className="chip" style={{ height: 19, textTransform: 'capitalize' }}>{a.library}</span></div>
                {inProject && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => { s.navigate({ name: 'project', id: doc!.id, space: 'design' }); s.setView('plan'); s.setTool('place', a.id); }}><MousePointer2 size={13} /> Place in plan</button>}
              </div>
            </div>
          ))}
          {!assets.length && <div className="empty">Nothing matches. Personal and team libraries fill up as your studio saves assets.</div>}
        </div>
      ) : (
        <div className="grid g4">
          {materials.map((m) => (
            <div key={m.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ ...swatchStyle(m), height: 92, backgroundSize: 'auto' }} />
              <div className="col" style={{ padding: 12, gap: 4 }}>
                <div className="row"><b className="grow">{m.name}</b>{used.has(m.id) && <span className="chip accent" style={{ height: 19 }}>In use</span>}</div>
                <div className="tiny muted">{m.description}</div>
                <div className="tiny num" style={{ color: 'var(--ink-2)' }}>₹{m.rate.toLocaleString('en-IN')} + ₹{m.labour.toLocaleString('en-IN')} labour / {m.costUnit === 'm2' ? 'm²' : m.costUnit === 'm3' ? 'm³' : m.costUnit} · roughness {m.roughness} · durability {m.durability}/5</div>
                {inProject && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn sm grow" onClick={() => applyMaterial(m)}>Apply to selection</button>
                    <Popover align="right" anchor={<button className="btn sm icon" title="Replace a material globally with this one" aria-label="Replace globally"><Replace size={13} /></button>}>
                      {(close) => (
                        <div style={{ width: 240 }}>
                          <div className="caps" style={{ padding: '6px 9px' }}>Replace everywhere with {m.name}</div>
                          {MATERIALS.filter((x) => used.has(x.id) && x.id !== m.id && x.costUnit === m.costUnit).map((x) => <button key={x.id} onClick={() => { close(); s.dispatch([{ type: 'material.replaceGlobal', params: { from: x.id, to: m.id } }]); }}><span className="swatch" style={swatchStyle(x)} />{x.name}</button>)}
                        </div>
                      )}
                    </Popover>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
  if (standalone) return <><h1 className="page-title">Asset library</h1><div className="page-sub" style={{ marginBottom: 18 }}>Parametric assets and PBR materials. Each asset’s plan symbol is its 3D recipe seen from above.</div>{body}</>;
  return <div className="page"><div className="page-inner"><h1 className="page-title" style={{ marginBottom: 4 }}>Assets & materials</h1><div className="page-sub" style={{ marginBottom: 18 }}>Place assets, apply materials to the selection or replace a material across the whole design.</div>{body}</div></div>;
}
