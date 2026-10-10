/**
 * The outdoor half of the "Add" library: a one-click garden designer, a plant
 * nursery with real horticultural data, paving and water you draw as areas,
 * hedges / fences / walls you draw as lines, and garden objects. Everything
 * is written for someone who has never opened a landscape drawing.
 */
import { useMemo, useState } from 'react';
import { Droplets, Sun, CloudSun, Cloud, Sparkles, Flower2, MoveHorizontal, MoveVertical } from 'lucide-react';
import { useStore } from '../../state/store';
import { useDoc } from '../../state/derived';
import { PLANTS, PLANT_TYPES, LANDSCAPE_STYLES, SUN_LABEL, WATER_LABEL, plantAssetId, searchPlants, type LandscapeStyle, type Plant, type PlantType } from '../../core/catalog/plants';
import { ASSETS, type Asset } from '../../core/catalog/assets';
import { getMaterial } from '../../core/catalog/materials';
import { plantSymbol, furnitureSymbol, primPath, type Prim } from '../../core/docs/symbols';
import { planLandscape, climateOf } from '../../core/generate/landscape';
import { ensureCCW, offsetPolygonEdges } from '../../core/geometry/polygon';
import { formatLength } from '../../core/units';
import type { SiteFeatureKind } from '../../core/model/types';
import type { PlaceSite } from '../../state/store';

// ------------------------------------------------------------- previews

function primsSvg(prims: Prim[], r: number, stroke = '#3d4a36'): string {
  const body = prims.map((p) => {
    if (p.t === 'text') return '';
    const fill = (p.t === 'poly' || p.t === 'circle') && p.fill ? (p.fill === 'cut' ? '#5b4a3a' : p.fill) : 'none';
    return `<path d="${primPath(p)}" fill="${fill}" fill-opacity="${fill === 'none' ? 0 : p.t === 'circle' && p.fill === 'cut' ? 1 : 0.42}" stroke="${stroke}" stroke-width="${r * 0.035}"${p.dash ? ` stroke-dasharray="${r * 0.12} ${r * 0.1}"` : ''}/>`;
  }).join('');
  const pad = r * 1.12;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${pad * 2} ${pad * 2}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}

const plantSvgCache = new Map<string, string>();
function plantSvg(p: Plant): string {
  let s = plantSvgCache.get(p.id);
  if (!s) { s = primsSvg(plantSymbol(p, { x: 0, y: 0 }, 1000, p.id), 1000); plantSvgCache.set(p.id, s); }
  return s;
}
function assetSvg(a: Asset): string {
  const r = Math.max(a.size.w, a.size.d) / 2;
  return primsSvg(furnitureSymbol({ id: `lib-${a.id}`, levelId: '', assetId: a.id, position: { x: 0, y: 0 }, rotation: 0, props: {} }), r, '#4a4843');
}

const SunIcon = ({ sun }: { sun: Plant['sun'] }) => (sun === 'full' ? <Sun size={11} /> : sun === 'partial' ? <CloudSun size={11} /> : <Cloud size={11} />);

// ------------------------------------------------------- garden designer

export function GardenDesigner() {
  const doc = useDoc();
  const dispatch = useStore((s) => s.dispatch);
  const toast = useStore((s) => s.toast);
  const [style, setStyle] = useState<LandscapeStyle>(() => (Math.abs(doc.meta.location.lat) < 26 ? 'tropical' : 'modern'));
  const [busy, setBusy] = useState(false);
  const hasAuto = Object.values(doc.site.features).some((f) => f.props.auto);
  const run = () => {
    setBusy(true);
    // Let the button repaint before the layout search runs.
    setTimeout(() => {
      try {
        const plan = planLandscape(useStore.getState().doc!, style);
        if (plan.ops.length < 2) toast(plan.notes[0] ?? 'There isn’t enough open ground to landscape yet.', { kind: 'err' });
        else if (dispatch(plan.ops, { label: `${LANDSCAPE_STYLES.find((x) => x.id === style)!.label} garden designed` })) {
          useStore.getState().select([]);
          toast(plan.notes.slice(0, 4).join(' · '), { action: { label: 'Undo', run: () => useStore.getState().undo() } });
        }
      } finally { setBusy(false); }
    }, 30);
  };
  return (
    <div className="card" style={{ padding: 12, borderColor: 'var(--accent)', background: 'var(--accent-softer)' }}>
      <div className="row" style={{ gap: 8, marginBottom: 2 }}><Sparkles size={15} style={{ color: 'var(--accent)' }} /><b>Design my garden</b></div>
      <div className="tiny muted" style={{ lineHeight: 1.4, marginBottom: 8 }}>One click lays out the whole plot: compound wall and gate, a path to the door, an outdoor room, trees sized to your setbacks, planting beds and lights — with plants that suit a {climateOf(doc)} climate. Everything stays editable.</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {LANDSCAPE_STYLES.map((x) => <button key={x.id} className={`btn sm ${x.id === style ? 'active' : 'ghost'}`} style={{ height: 24, padding: '0 8px', fontSize: 11.5 }} onClick={() => setStyle(x.id)}>{x.label}</button>)}
      </div>
      <div className="tiny" style={{ color: 'var(--ink-2)', marginBottom: 8 }}>{LANDSCAPE_STYLES.find((x) => x.id === style)!.hint}</div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary sm" disabled={busy} onClick={run}>{busy ? 'Designing…' : hasAuto ? 'Redesign garden' : 'Design my garden'}</button>
        {hasAuto && <button className="btn sm" onClick={() => dispatch([{ type: 'landscape.clear', params: {} }], { label: 'Generated garden removed' })}>Remove</button>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- plants

export function PlantBrowser({ query }: { query?: string }) {
  const doc = useDoc();
  const units = doc.meta.units;
  const placing = useStore((s) => (s.tool === 'place' ? s.placeAsset : null));
  const startPlant = useStore((s) => s.startPlant);
  const [type, setType] = useState<PlantType | 'all'>('all');
  const [suit, setSuit] = useState(true);
  const climate = climateOf(doc);
  const list = useMemo(() => (query ? searchPlants(query) : PLANTS.filter((p) => (type === 'all' || p.type === type) && (!suit || p.climates.includes(climate)))), [query, type, suit, climate]);
  return (
    <div className="col" style={{ gap: 8 }}>
      {!query && (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button className={`chip ${type === 'all' ? 'accent' : ''}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setType('all')}>All</button>
            {PLANT_TYPES.map((t) => <button key={t.id} className={`chip ${type === t.id ? 'accent' : ''}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setType(t.id)}>{t.label}</button>)}
          </div>
          <label className="row tiny" style={{ gap: 6, color: 'var(--ink-2)' }}><input type="checkbox" checked={suit} onChange={(e) => setSuit(e.target.checked)} /> Only plants that grow well in {doc.meta.location.city} ({climate})</label>
          <div className="tiny muted">Click a plant, then click the plan as many times as you like. <b>Esc</b> stops.</div>
        </>
      )}
      {list.map((p) => {
        const id = plantAssetId(p.id), active = placing === id, ok = p.climates.includes(climate);
        return (
          <div key={p.id} className="card" role="button" tabIndex={0} aria-label={`${p.common}, ${p.botanical}`} onClick={() => startPlant(id)} onKeyDown={(e) => { if (e.key === 'Enter') startPlant(id); }}
            style={{ cursor: 'pointer', padding: 9, display: 'grid', gridTemplateColumns: '58px 1fr', gap: 10, borderColor: active ? 'var(--accent)' : undefined, boxShadow: active ? 'var(--ring)' : undefined }}>
            <div style={{ background: 'var(--paper)', borderRadius: 8, aspectRatio: '1', border: '1px solid var(--line)', padding: 3 }} dangerouslySetInnerHTML={{ __html: plantSvg(p) }} />
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}><b style={{ lineHeight: 1.2 }}>{p.common}</b>{p.flower && <span title={`Flowers ${p.flower.season}`} style={{ width: 9, height: 9, borderRadius: 5, background: p.flower.color, border: '1px solid rgba(0,0,0,0.15)', flex: 'none' }} />}</div>
              <div className="tiny muted" style={{ fontStyle: 'italic', lineHeight: 1.2 }}>{p.botanical}</div>
              <div className="row tiny" style={{ gap: 8, color: 'var(--ink-2)', flexWrap: 'wrap', marginTop: 1 }}>
                <span className="row" style={{ gap: 3 }} title="Mature height"><MoveVertical size={11} />{formatLength(p.height, units, { compact: true })}</span>
                <span className="row" style={{ gap: 3 }} title="Mature spread"><MoveHorizontal size={11} />{formatLength(p.spread, units, { compact: true })}</span>
                <span className="row" style={{ gap: 3 }}><SunIcon sun={p.sun} />{SUN_LABEL[p.sun]}</span>
                <span className="row" style={{ gap: 3 }}><Droplets size={11} />{WATER_LABEL[p.water].replace(' water', '')}</span>
              </div>
              <div className="tiny muted" style={{ lineHeight: 1.3 }}>{p.note}</div>
              {!ok && <div className="tiny" style={{ color: 'var(--warn)' }}>Not well suited to a {climate} climate</div>}
            </div>
          </div>
        );
      })}
      {!list.length && <div className="empty small">No plants match. Try “palm”, “fragrant”, “hedge” or a botanical name.</div>}
    </div>
  );
}

// ----------------------------------------------------- surfaces & lines

interface SiteItem extends PlaceSite { id: string; hint: string; swatch?: string }

export const SURFACES: SiteItem[] = [
  { id: 'lawn', kind: 'lawn', name: 'Lawn', material: 'lawn', hint: 'Natural turf — the plot is lawn by default; use this to mark a separate lawn' },
  { id: 'turf', kind: 'lawn', name: 'Artificial turf', material: 'artificial-turf', hint: 'No mowing or watering; good for play areas' },
  { id: 'bed', kind: 'bed', name: 'Planting bed', material: 'mulch', hint: 'Soil and mulch with a stone edge — then add plants' },
  { id: 'patio-sandstone', kind: 'patio', name: 'Sandstone patio', material: 'sandstone-paving', hint: 'Warm buff flags for terraces and sit-outs' },
  { id: 'patio-granite', kind: 'patio', name: 'Granite paving', material: 'granite-paving', hint: 'Grey, slip-resistant, modern' },
  { id: 'patio-travertine', kind: 'patio', name: 'Travertine terrace', material: 'travertine', hint: 'Stays cool underfoot — ideal by a pool' },
  { id: 'patio-terracotta', kind: 'patio', name: 'Terracotta court', material: 'terracotta-paver', hint: 'Handmade tiles for courtyards' },
  { id: 'path-brick', kind: 'pathway', name: 'Brick path', material: 'brick-paver', hint: 'Herringbone clay pavers' },
  { id: 'path-stone', kind: 'pathway', name: 'Random stone path', material: 'crazy-paving', hint: 'Irregular stone with wide joints' },
  { id: 'drive-cobble', kind: 'driveway', name: 'Cobbled driveway', material: 'cobble', hint: 'Granite setts that take car loads' },
  { id: 'drive-paver', kind: 'driveway', name: 'Paver driveway', material: 'paver', hint: 'Interlocking concrete blocks' },
  { id: 'drive-aggregate', kind: 'driveway', name: 'Exposed aggregate drive', material: 'exposed-aggregate', hint: 'Grippy washed concrete' },
  { id: 'park-grass', kind: 'parking', name: 'Grass-paver parking', material: 'grass-paver', hint: 'Lets rain soak in under the car', props: { spaces: 1 } },
  { id: 'gravel', kind: 'gravel', name: 'Pea gravel', material: 'gravel', hint: 'Low-cost, drains freely' },
  { id: 'pebble', kind: 'gravel', name: 'White pebbles', material: 'white-pebble', hint: 'Crisp edging and dry courts' },
  { id: 'deck-wood', kind: 'deck', name: 'Hardwood deck', material: 'deck-wood', hint: 'Raised 150 mm timber platform' },
  { id: 'deck-composite', kind: 'deck', name: 'Composite deck', material: 'composite-deck', hint: 'No oiling, no splinters' },
  { id: 'sand', kind: 'gravel', name: 'Sand', material: 'sand', hint: 'Play sand or a beach corner' },
  { id: 'pool', kind: 'pool', name: 'Swimming pool', material: 'pool-water', hint: 'Tiled pool, 1.2 m deep, with a stone coping', swatch: '#5fb4c9' },
  { id: 'pond', kind: 'pond', name: 'Garden pond', material: 'pond-water', hint: 'Shallow planted pond — add lotus or lilies', swatch: '#4f7f73' },
];

export const BOUNDARIES: SiteItem[] = [
  { id: 'hedge-low', kind: 'hedge', name: 'Low hedge', hint: 'Golden duranta, 2 ft — edges paths and beds', props: { height: 600, width: 450, species: 'duranta' }, swatch: '#b8c93f' },
  { id: 'hedge', kind: 'hedge', name: 'Clipped hedge', hint: 'Kamini, 4 ft — a green garden wall', props: { height: 1200, width: 600, species: 'murraya' }, swatch: '#3f6f3a' },
  { id: 'hedge-tall', kind: 'hedge', name: 'Tall privacy hedge', hint: 'Ficus, 7 ft — screens the neighbours', props: { height: 2100, width: 800, species: 'ficus' }, swatch: '#335f33' },
  { id: 'fence-timber', kind: 'fence', name: 'Timber fence', material: 'wood-cladding', hint: 'Close-boarded, 5 ft', props: { height: 1500, width: 50 } },
  { id: 'fence-slat', kind: 'fence', name: 'Tall slat fence', material: 'composite-deck', hint: 'Modern horizontal boards, 6 ft', props: { height: 1800, width: 50 } },
  { id: 'wall-render', kind: 'wall', name: 'Compound wall', material: 'ext-texture', hint: 'Rendered masonry, 5 ft 6 in, stone coping', props: { height: 1650, width: 200 } },
  { id: 'wall-stone', kind: 'wall', name: 'Stone garden wall', material: 'stone-cladding', hint: 'Low dry-stone look, 3 ft — also a seat', props: { height: 900, width: 350 } },
  { id: 'wall-brick', kind: 'wall', name: 'Brick wall', material: 'exposed-brick', hint: 'Facing brick, 5 ft', props: { height: 1500, width: 230 } },
];

function SiteCard({ item, line }: { item: SiteItem; line?: boolean }) {
  const startSite = useStore((s) => s.startSite);
  const active = useStore((s) => (s.tool === 'surface' || s.tool === 'linear') && s.placeSite?.name === item.name);
  const color = item.swatch ?? getMaterial(item.material).color;
  return (
    <div className="card" role="button" tabIndex={0} aria-label={item.name} onClick={() => startSite(item)} onKeyDown={(e) => { if (e.key === 'Enter') startSite(item); }}
      style={{ cursor: 'pointer', padding: 9, display: 'grid', gridTemplateColumns: '40px 1fr', gap: 10, alignItems: 'center', borderColor: active ? 'var(--accent)' : undefined, boxShadow: active ? 'var(--ring)' : undefined }}>
      <div style={{ height: line ? 12 : 40, borderRadius: line ? 6 : 8, background: color, border: '1px solid rgba(0,0,0,0.12)' }} />
      <div style={{ minWidth: 0 }}><b>{item.name}</b><div className="tiny muted" style={{ lineHeight: 1.3 }}>{item.hint}</div></div>
    </div>
  );
}

export function SurfaceBrowser({ query }: { query?: string }) {
  const q = query?.toLowerCase();
  const list = q ? SURFACES.filter((s) => `${s.name} ${s.hint} ${s.kind}`.toLowerCase().includes(q)) : SURFACES;
  if (!list.length) return null;
  return (
    <div className="col" style={{ gap: 8 }}>
      {!query && <div className="tiny muted">Pick a surface, then <b>drag a rectangle</b> on the plan. Select it later to change the material.</div>}
      {list.map((s) => <SiteCard key={s.id} item={s} />)}
    </div>
  );
}

export function BoundaryBrowser({ query }: { query?: string }) {
  const doc = useDoc();
  const dispatch = useStore((s) => s.dispatch);
  const q = query?.toLowerCase();
  const list = q ? BOUNDARIES.filter((s) => `${s.name} ${s.hint} ${s.kind}`.toLowerCase().includes(q)) : BOUNDARIES;
  if (!list.length) return null;
  const around = (item: SiteItem) => {
    const plot = ensureCCW(doc.site.boundary);
    const inset = offsetPolygonEdges(plot, plot.map(() => Number(item.props?.width ?? 400) / 2 + 60));
    if (inset.length !== plot.length) return;
    dispatch([{ type: 'site.feature.create', params: { kind: item.kind as SiteFeatureKind, name: item.name, path: [...inset, inset[0]], materialId: item.material, props: item.props ?? {} } }], { label: `${item.name} around the plot` });
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      {!query && (
        <>
          <div className="tiny muted">Pick one, then <b>click along its line</b> on the plan. <b>Enter</b> or double-click finishes.</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => around(BOUNDARIES[1])}>Hedge around the plot</button>
            <button className="btn sm" onClick={() => around(BOUNDARIES[5])}>Wall around the plot</button>
          </div>
        </>
      )}
      {list.map((s) => <SiteCard key={s.id} item={s} line />)}
    </div>
  );
}

// ------------------------------------------------------- garden objects

const OBJECT_GROUPS: { label: string; match: (a: Asset) => boolean }[] = [
  { label: 'Seating & dining', match: (a) => a.category === 'outdoor' },
  { label: 'Shade & structures', match: (a) => a.category === 'garden' && /pergola|gazebo|carport|screen|shed|cabin|arch|trellis/.test(a.id) },
  { label: 'Fire, food & water', match: (a) => a.category === 'garden' && /fire|bbq|kitchen|pizza|jacuzzi|shower|fountain|water|bird/.test(a.id) },
  { label: 'Lighting', match: (a) => a.category === 'garden' && a.tags.includes('light') },
  { label: 'Gates, play & features', match: (a) => a.category === 'garden' && !/pergola|gazebo|carport|screen|shed|cabin|arch|trellis|fire|bbq|kitchen|pizza|jacuzzi|shower|fountain|water|bird/.test(a.id) && !a.tags.includes('light') },
  { label: 'Vehicles', match: (a) => a.category === 'exterior' },
];

export function ObjectBrowser({ query }: { query?: string }) {
  const doc = useDoc();
  const units = doc.meta.units;
  const placing = useStore((s) => (s.tool === 'place' ? s.placeAsset : null));
  const startPlant = useStore((s) => s.startPlant);
  const q = query?.toLowerCase();
  const all = ASSETS.filter((a) => (a.category === 'outdoor' || a.category === 'garden' || a.category === 'exterior') && (!q || `${a.name} ${a.tags.join(' ')}`.toLowerCase().includes(q)));
  if (!all.length) return null;
  const card = (a: Asset) => (
    <div key={a.id} className="card" role="button" tabIndex={0} aria-label={a.name} onClick={() => startPlant(a.id)} onKeyDown={(e) => { if (e.key === 'Enter') startPlant(a.id); }}
      style={{ cursor: 'pointer', padding: 8, borderColor: placing === a.id ? 'var(--accent)' : undefined, boxShadow: placing === a.id ? 'var(--ring)' : undefined }}>
      <div style={{ background: 'var(--paper)', borderRadius: 7, aspectRatio: '1.25', border: '1px solid var(--line)', padding: 4 }} dangerouslySetInnerHTML={{ __html: assetSvg(a) }} />
      <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.25, marginTop: 5 }}>{a.name}</div>
      <div className="tiny muted num">{formatLength(a.size.w, units, { compact: true })} × {formatLength(a.size.d, units, { compact: true })}</div>
    </div>
  );
  if (query) return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{all.map(card)}</div>;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="tiny muted">Click an item, then click the plan to place it. <b>R</b> rotates.</div>
      {OBJECT_GROUPS.map((g) => { const items = all.filter(g.match); return items.length ? <div key={g.label} className="col" style={{ gap: 6 }}><div className="caps">{g.label}</div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{items.map(card)}</div></div> : null; })}
    </div>
  );
}

export const OUTDOOR_TABS = [
  { id: 'plants', label: 'Plants', icon: Flower2 },
  { id: 'surfaces', label: 'Paving & water' },
  { id: 'boundaries', label: 'Hedges & walls' },
  { id: 'objects', label: 'Garden objects' },
] as const;
export type OutdoorTab = (typeof OUTDOOR_TABS)[number]['id'];
