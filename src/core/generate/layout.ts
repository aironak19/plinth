/**
 * Generative layout engine.
 *
 * Program (site + requirements + style) → several *editable* BIM schemes.
 * Zoning follows residential practice: a public band towards the road
 * (foyer, living), a service/stair band, and a private band towards the garden;
 * bedrooms go upstairs. Every scheme is built by buildFromSpec, then scored.
 */
import type { BuildingModel, ProjectDoc, RoomFunction, Site, SiteFeature, StyleId } from '../model/types';
import { buildFromSpec, roomsAdjacent, type DoorSpec, type LevelSpec, type RoomSpec } from './fromRects';
import { buildableZone } from '../derive/site';
import { coverRectangles, type Rect } from '../derive/roof';
import { ensureCCW, area } from '../geometry/polygon';
import { uid } from '../model/ids';
import { levelsSorted } from '../model/query';
import { STYLE_BY_ID } from '../catalog/styles';

export interface Program {
  bedrooms: number;
  floors: number;
  pooja: boolean;
  powder: boolean;
  study: boolean;
  family: boolean;
  parking: number;
  garden: boolean;
  pool: boolean;
  /** Direction the entrance faces. */
  entrance: 'south' | 'north' | 'east' | 'west';
  style: StyleId;
  budget?: number;
}

export const DEFAULT_PROGRAM: Program = { bedrooms: 4, floors: 2, pooja: true, powder: true, study: false, family: true, parking: 2, garden: true, pool: false, entrance: 'south', style: 'modern' };

export type Strategy = 'linear' | 'courtyard' | 'compact';

export interface Scheme {
  id: string;
  name: string;
  strategy: Strategy;
  summary: string;
  building: BuildingModel;
  features: SiteFeature[];
  style: StyleId;
  northAngle: number;
}

const TARGET: Partial<Record<RoomFunction, number>> = {
  foyer: 7, living: 30, dining: 15, kitchen: 12, pooja: 3.2, powder: 3.4, utility: 5, master_bedroom: 21, bathroom: 4.8,
  walkin: 5, bedroom: 15, family: 14, study: 9, stair: 10, corridor: 8,
};
const MIN_W: Partial<Record<RoomFunction, number>> = {
  foyer: 1800, living: 3600, dining: 3000, kitchen: 2600, pooja: 1500, powder: 1300, utility: 1500, master_bedroom: 3600,
  bathroom: 1650, walkin: 1500, bedroom: 3000, family: 3000, study: 2400, stair: 2500, corridor: 1500,
};

const g = (v: number, step = 150) => Math.round(v / step) * step;

interface Item { key: string; name: string; fn: RoomFunction; area: number; fixedW?: number; open?: boolean }

/** Largest axis-aligned rectangle inside the buildable zone. */
export function buildableRect(site: Site): Rect {
  const zone = buildableZone(site);
  let best: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const z of zone) for (const r of coverRectangles(ensureCCW(z.outer))) if (r.w * r.h > best.w * best.h) best = r;
  return best;
}

export function northAngleFor(entrance: Program['entrance']): number {
  const bearing = { south: 180, east: 90, north: 0, west: 270 }[entrance];
  return (((180 - bearing) % 360) + 360) % 360;
}

export function generateSchemes(site: Site, program: Program, strategies: Strategy[] = ['courtyard', 'linear', 'compact'], seed = 0): Scheme[] {
  const zone = buildableRect(site);
  const plotArea = area(ensureCCW(site.boundary));
  return strategies.map((s, i) => generateScheme(site, zone, plotArea, program, s, seed + i));
}

function rng(seed: number) {
  let t = seed + 0x6d2b79f5;
  return () => { t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Unit { items: Item[]; minW: number; area: number; fixedW?: number; open?: boolean; sideBySide?: boolean }

const STACK_MIN_DEPTH = 5200;
const minWOf = (u: Unit, h: number) => {
  if (u.fixedW) return u.fixedW;
  if (stacked(u, h)) return u.minW;
  const [head, ...rest] = u.items;
  const headMin = MIN_W[head.fn] ?? 1500;
  if (rest.length > 1 && h >= 3600) return headMin + Math.max(...rest.map((i) => MIN_W[i.fn] ?? 1500));
  return u.items.reduce((s, i) => s + (MIN_W[i.fn] ?? 1500), 0);
};

/** Proportional widths that respect minimums, snapped to the 150 mm grid. */
function splitWidths(total: number, mins: number[], areas: number[]): number[] {
  const sumA = areas.reduce((s, a) => s + a, 0) || 1;
  let w = areas.map((a, i) => Math.max(mins[i], (total * a) / sumA));
  const over = w.reduce((s, v) => s + v, 0) - total;
  if (over > 0) {
    const slack = w.map((v, i) => v - mins[i]);
    const ts = slack.reduce((s, v) => s + v, 0);
    w = ts > 0 ? w.map((v, i) => v - (over * slack[i]) / ts) : w.map((v) => (v * total) / (total + over));
  }
  return w.map((v) => Math.round(v / 150) * 150);
}
const stacked = (u: Unit, h: number) => u.items.length > 1 && !u.sideBySide && h >= STACK_MIN_DEPTH;

const unit = (...items: Item[]): Unit => ({
  items,
  sideBySide: items.some((i) => i.fn === 'kitchen'),
  minW: Math.max(...items.map((i) => i.fixedW ?? MIN_W[i.fn] ?? 1500)),
  area: items.reduce((s, i) => s + i.area, 0),
  fixedW: items.find((i) => i.fixedW)?.fixedW,
  open: items.every((i) => i.open),
});

function generateScheme(site: Site, Z: Rect, plotArea: number, p: Program, strategy: Strategy, seed: number): Scheme {
  const rand = rng(seed * 7919 + strategy.length);
  const style: StyleId = strategy === 'compact' && p.style === 'modern' ? 'tropical' : strategy === 'courtyard' && p.style === 'modern' ? 'contemporary' : p.style;
  const floors = Math.max(1, Math.min(3, p.floors));
  const I = (key: string, name: string, fn: RoomFunction, scale = 1, extra: Partial<Item> = {}): Item => ({ key, name, fn, area: (TARGET[fn] ?? 8) * scale, ...extra });

  // ---- footprint (centre-lines), kept clear of setbacks by half a wall + margin
  const inset = 300;
  const Zx0 = Z.x + inset, Zy0 = Z.y + inset, Zw = Z.w - 2 * inset, Zh = Z.h - 2 * inset;
  const bedsTotal = p.bedrooms;
  const groundBeds = floors === 1 ? bedsTotal : bedsTotal >= 4 ? 1 : 0;
  const upperBeds = bedsTotal - groundBeds;
  const perUpper = floors > 1 ? Math.ceil(upperBeds / (floors - 1)) : 0;
  const estGround = (7 + 30 + 15 + 12 + 5 + (p.pooja ? 3.2 : 0) + (p.powder ? 3.4 : 0) + (floors > 1 ? 11.7 : 0) + groundBeds * 20) * 1e6 * 1.15;
  const estUpper = floors > 1 ? (perUpper * 20 + 7 + 5 + (p.family ? 14 : 8) + 11.7 + (p.study ? 9 : 0)) * 1e6 * 1.15 : 0;
  const need = Math.max(estGround, estUpper);
  const parkingDepth = p.parking > 0 ? 5600 : 0;
  const rearKeep = p.pool ? 8500 : p.garden ? 3000 : 0;
  const maxCov = 0.58 * plotArea;
  const courtyard = strategy === 'courtyard' && Zw >= 11500;
  const aspect = strategy === 'linear' ? 2.0 : courtyard ? 1.2 : 1.05;
  let fw = Math.min(Zw, Math.sqrt(need * aspect) * (courtyard ? 1.12 : 1));
  const depthRoom = Zh - (Zh - parkingDepth - rearKeep > 9500 ? parkingDepth + rearKeep : Zh - parkingDepth > 9500 ? parkingDepth : 0);
  let fd = Math.min(depthRoom, (need * (courtyard ? 1.2 : 1)) / fw);
  if (fd < 9500 && depthRoom >= 9500) fd = 9500;
  if (fw * fd > maxCov) { const k = Math.sqrt(maxCov / (fw * fd)); fw *= k; fd *= k; }
  fw = Math.min(g(fw), Math.floor(Zw / 150) * 150);
  fd = Math.min(g(fd), Math.floor(Zh / 150) * 150);
  const x0 = g(Zx0 + (Zw - fw) / 2);
  const y0 = g(Zy0 + Math.min(Math.max(0, Zh - fd), parkingDepth));

  // ---- bands, shared by every floor so walls and the stair stack
  const stairDepth = 4500, stairW = 2600;
  const mid = strategy === 'linear' ? 1650 : stairDepth;
  const frontD = g((fd - mid) * (strategy === 'linear' ? 0.5 : 0.48));
  const by = [y0, y0 + frontD, y0 + frontD + mid];
  const ytop = y0 + fd;
  const bandH = [frontD, mid, ytop - by[2]];
  const cx0 = g(x0 + fw * 0.36), cx1 = g(x0 + fw * 0.64);

  const suite = (bed: Item, bathName: string, master = false): Unit =>
    unit(bed, ...(master ? [I(`${bed.key}-bath`, 'Master Bath', 'bathroom', 1.45), I(`${bed.key}-wi`, 'Walk-in Wardrobe', 'walkin')] : [I(`${bed.key}-bath`, bathName, 'bathroom')]));

  /** Lay units side by side across a band; each unit stacks its rooms from the hub side outwards. */
  const layBand = (units: Unit[], band: number, hubAtTop: boolean, rooms: RoomSpec[], xs = x0, xe = x0 + fw) => {
    let list = units.filter(Boolean);
    const W = xe - xs;
    const hB = bandH[band];
    // Overflow: drop optional rooms until minimum widths fit.
    while (list.reduce((s, u) => s + minWOf(u, hB), 0) > W && list.length > 1) {
      const drop = list.findIndex((u) => u.items.some((i) => i.fn === 'pooja' || i.fn === 'study' || i.fn === 'powder'));
      if (drop >= 0) list.splice(drop, 1); else break;
    }
    const fixed = list.reduce((s, u) => s + (u.fixedW ?? 0), 0);
    const flex = list.filter((u) => !u.fixedW);
    const totalA = flex.reduce((s, u) => s + u.area, 0) || 1;
    const avail = W - fixed;
    const widths = flex.map((u) => Math.max(minWOf(u, hB), (avail * u.area) / totalA));
    const excess = widths.reduce((s, w) => s + w, 0) - avail;
    if (excess > 0) {
      const slack = widths.map((w, k) => w - minWOf(flex[k], hB));
      const ts = slack.reduce((s, v) => s + v, 0) || 1;
      for (let k = 0; k < widths.length; k++) widths[k] -= (excess * slack[k]) / ts;
    }
    const sumW = widths.reduce((s, w) => s + w, 0);
    if (sumW > avail + 1) for (let k = 0; k < widths.length; k++) widths[k] *= avail / sumW;
    const y = by[band], h = bandH[band];
    let x = xs, fi = 0;
    list.forEach((u, idx) => {
      const w = u.fixedW ?? widths[fi++];
      const nx = idx === list.length - 1 ? xe : g(x + w);
      if (!u.open) placeUnit(u, x, nx, y, h, hubAtTop, rooms);
      x = nx;
    });
  };

  const placeUnit = (u: Unit, xa: number, xb: number, y: number, h: number, hubAtTop: boolean, rooms: RoomSpec[]) => {
    const [head, ...rest] = u.items;
    if (!rest.length) { rooms.push({ key: head.key, name: head.name, fn: head.fn, x: xa, y, w: xb - xa, h }); return; }
    if (!stacked(u, h)) {
      // Side by side: head room in one column, the rest in a second column (stacked if there is depth).
      const stackRest = rest.length > 1 && h >= 3600;
      const cols: Item[][] = stackRest ? [[head], rest] : u.items.map((i) => [i]);
      const mins = cols.map((c) => Math.max(...c.map((i) => MIN_W[i.fn] ?? 1500)));
      const areas = cols.map((c) => c.reduce((s2, i) => s2 + i.area, 0));
      const widths = splitWidths(xb - xa, mins, areas);
      let x = xa;
      cols.forEach((col, k) => {
        const nx = k === cols.length - 1 ? xb : x + widths[k];
        const tot = col.reduce((s2, i) => s2 + i.area, 0);
        let yy = y;
        col.forEach((it, k2) => {
          const ny = k2 === col.length - 1 ? y + h : g(yy + (h * it.area) / tot);
          rooms.push({ key: it.key, name: it.name, fn: it.fn, x, y: yy, w: nx - x, h: ny - yy });
          yy = ny;
        });
        x = nx;
      });
      return;
    }
    const restD = g(Math.max(1700, Math.min(h * 0.4, 2600)));
    const headD = h - restD;
    const hy = hubAtTop ? y + restD : y;
    const ry = hubAtTop ? y : y + headD;
    rooms.push({ key: head.key, name: head.name, fn: head.fn, x: xa, y: hy, w: xb - xa, h: headD });
    // Remaining rooms share the outer strip side by side.
    const tot = rest.reduce((s, i) => s + i.area, 0);
    let x = xa;
    rest.forEach((it, k) => {
      const nx = k === rest.length - 1 ? xb : g(x + ((xb - xa) * it.area) / tot);
      rooms.push({ key: it.key, name: it.name, fn: it.fn, x, y: ry, w: nx - x, h: restD });
      x = nx;
    });
  };

  // ---- ground floor
  const beds: Item[] = Array.from({ length: bedsTotal }, (_, i) => (i === 0 ? I('master', 'Master Bedroom', 'master_bedroom') : I(`bed${i + 1}`, `Bedroom ${i + 1}`, 'bedroom', 0.95 + rand() * 0.12)));
  const groundSuites = floors === 1 ? beds.map((b, i) => suite(b, i === 0 ? 'Master Bath' : `Bath ${i + 1}`, i === 0)) : beds.slice(bedsTotal - groundBeds).map((b) => suite({ ...b, name: 'Guest Bedroom', key: 'guest' }, 'Guest Bath'));
  const stairU = unit(I('stair', 'Stair', 'stair', 1, { fixedW: stairW }));
  const groundRooms: RoomSpec[] = [];
  const foyer = unit(I('foyer', 'Foyer', 'foyer'));
  const pooja = p.pooja ? unit(I('pooja', 'Pooja', 'pooja')) : null;
  const powder = p.powder ? unit(I('powder', 'Powder Room', 'powder')) : null;
  const living = unit(I('living', 'Living Room', 'living', 0.9 + rand() * 0.25));
  const dining = unit(I('dining', 'Dining', 'dining'));
  const kitchen = unit(I('kitchen', 'Kitchen', 'kitchen'), I('utility', 'Utility', 'utility'));
  if (strategy === 'linear') {
    layBand([foyer, living, ...(pooja ? [pooja] : []), ...groundSuites.slice(0, 1)].filter(Boolean) as Unit[], 0, true, groundRooms);
    layBand([unit(I('gallery', 'Gallery', 'corridor', 1))], 1, true, groundRooms);
    layBand([dining, kitchen, ...(powder ? [powder] : []), ...groundSuites.slice(1), ...(floors > 1 ? [stairU] : [])], 2, false, groundRooms);
  } else if (strategy === 'compact') {
    // Garden-facing living: service and entry towards the road, living opens to the rear garden.
    layBand([foyer, ...(powder ? [powder] : []), kitchen, ...(pooja ? [pooja] : [])], 0, true, groundRooms);
    layBand([dining, ...(floors > 1 ? [stairU] : [unit(I('hall', 'Family Hall', 'family'))])], 1, true, groundRooms);
    layBand([living, ...groundSuites], 2, false, groundRooms);
  } else {
    layBand([...(pooja ? [pooja] : []), foyer, ...groundSuites.slice(0, floors === 1 ? 2 : 1)], 0, true, groundRooms);
    layBand([living, ...(floors > 1 ? [stairU] : [unit(I('hall', 'Family Hall', 'family'))])], 1, true, groundRooms);
    const back = [dining, kitchen, ...(powder ? [powder] : []), ...groundSuites.slice(floors === 1 ? 2 : 1)];
    if (courtyard) {
      layBand([dining], 2, false, groundRooms, x0, cx0);
      layBand([kitchen, ...back.slice(2)], 2, false, groundRooms, cx1, x0 + fw);
    } else layBand(back, 2, false, groundRooms);
  }

  // ---- upper floors
  const upperRooms: RoomSpec[][] = [];
  let bi = 0;
  const upperBedList = beds.slice(0, upperBeds);
  for (let f = 0; f < floors - 1; f++) {
    const here = upperBedList.slice(bi, bi + perUpper);
    bi += perUpper;
    const rooms: RoomSpec[] = [];
    const masterHere = here.filter((b) => b.fn === 'master_bedroom');
    const others = here.filter((b) => b.fn !== 'master_bedroom');
    const hub = strategy === 'linear' ? unit(I('landing', 'Gallery', 'corridor')) : unit(I('landing', p.family ? 'Family Lounge' : 'Landing', p.family ? 'family' : 'corridor'));
    const study = p.study && f === 0 ? unit(I('study', 'Study', 'study')) : null;
    const isTop = f === floors - 2;
    const stairHere = isTop && floors > 2 ? stairU : stairU;
    if (strategy === 'linear') {
      layBand(others.map((b) => suite(b, b.name.replace('Bedroom', 'Bath'))), 0, true, rooms);
      layBand([hub], 1, true, rooms);
      layBand([...masterHere.map((b) => suite(b, 'Master Bath', true)), ...(study ? [study] : []), stairHere], 2, false, rooms);
    } else {
      const frontN = Math.max(1, Math.ceil(others.length / (masterHere.length ? 1 : 2)));
      layBand(others.slice(0, frontN).map((b) => suite(b, b.name.replace('Bedroom', 'Bath'))), 0, true, rooms);
      layBand([...(study ? [study] : []), hub, stairHere], 1, true, rooms);
      const back = [...masterHere.map((b) => suite(b, 'Master Bath', true)), ...others.slice(frontN).map((b) => suite(b, b.name.replace('Bedroom', 'Bath')))];
      if (courtyard) {
        layBand(back.slice(0, 1), 2, false, rooms, x0, cx0);
        layBand(back.slice(1).length ? back.slice(1) : [unit(I('lounge2', 'Upper Lounge', 'family'))], 2, false, rooms, cx1, x0 + fw);
      } else layBand(back.length ? back : [unit(I('lounge2', 'Upper Lounge', 'family'))], 2, false, rooms);
    }
    upperRooms.push(rooms);
  }

  const levels: LevelSpec[] = [
    { name: 'Ground Floor', height: 3200, rooms: groundRooms, doors: connect(groundRooms, true, p.garden || p.pool), stair: floors > 1 ? { room: 'stair', kind: 'U', tread: 270, width: 1000 } : undefined },
    ...upperRooms.map((rooms, i) => ({
      name: i === 0 ? 'First Floor' : 'Second Floor', height: 3200, rooms, doors: connect(rooms, false, false),
      stair: i < upperRooms.length - 1 ? { room: 'stair', kind: 'U' as const, tread: 270, width: 1000 } : undefined,
    })),
  ];
  const st = STYLE_BY_ID[style];
  const building = buildFromSpec({ levels, style, columns: true, roof: { kind: st.roof.kind, pitch: st.roof.pitch || 22, overhang: st.roof.overhang, materialId: st.roof.material, parapetHeight: st.roof.kind === 'flat' ? 1050 : 0 } });

  // ---- site features
  const features: SiteFeature[] = [];
  const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const ground0 = levelsSorted(building)[0];
  const frontY = Math.min(...site.boundary.map((q) => q.y));
  const front = y0 - 300 - frontY;
  if (p.parking > 0 && front >= 5000) {
    const w = Math.min(fw * 0.6, 2900 * p.parking);
    const px = g(x0 + fw - w);
    const ph = Math.min(front - 300, 5600);
    features.push({ id: uid('sf'), kind: 'parking', name: `${p.parking}-car parking`, polygon: rect(px, frontY + 300, w, ph), materialId: 'paver', props: { spaces: p.parking } });
    for (let i = 0; i < Math.min(p.parking, Math.floor(w / 2600)); i++) {
      const id = uid('f');
      building.furniture[id] = { id, levelId: ground0.id, assetId: i === 0 ? 'car-suv' : 'car-sedan', position: { x: px + 1400 + i * 2800, y: frontY + 300 + ph / 2 }, rotation: 0, variant: i === 0 ? 'white' : 'black', props: {} };
    }
  }
  const foyerR = groundRooms.find((r) => r.fn === 'foyer');
  if (foyerR) features.push({ id: uid('sf'), kind: 'pathway', name: 'Entrance path', polygon: rect(foyerR.x + foyerR.w / 2 - 700, frontY, 1400, Math.max(100, y0 - 130 - frontY)), materialId: 'kota', props: {} });
  const plotTop = Math.max(...site.boundary.map((q) => q.y));
  const rearY = ytop + 600;
  if (p.pool && plotTop - rearY > 5600) {
    const pw = Math.min(fw * 0.7, 12000), ph = Math.min(4000, plotTop - rearY - 2900);
    features.push({ id: uid('sf'), kind: 'deck', name: 'Pool deck', polygon: rect(x0, rearY, Math.min(fw, pw + 2400), 1600), materialId: 'deck-wood', props: {} });
    features.push({ id: uid('sf'), kind: 'pool', name: 'Swimming pool', polygon: rect(x0 + 900, rearY + 2300, pw, ph), materialId: 'pool-water', props: { depth: 1350 } });
  }
  if (courtyard) {
    features.push({ id: uid('sf'), kind: 'deck', name: 'Courtyard', polygon: rect(cx0 + 200, by[2] + 200, cx1 - cx0 - 400, ytop - by[2] - 200), materialId: 'kota', props: {} });
    const id = uid('f');
    building.furniture[id] = { id, levelId: ground0.id, assetId: 'tree', position: { x: (cx0 + cx1) / 2, y: (by[2] + ytop) / 2 + 400 }, rotation: 0, variant: 'flower', props: {} };
  }
  if (p.garden) {
    const bx = site.boundary.map((q) => q.x);
    const minX = Math.min(...bx), maxX = Math.max(...bx);
    const spots = [[minX + 1100, plotTop - 1300], [maxX - 1100, plotTop - 1300], [(minX + maxX) / 2, plotTop - 1200]];
    spots.forEach(([x, y], i) => {
      if (y < ytop + 1500) return;
      const id = uid('f');
      building.furniture[id] = { id, levelId: ground0.id, assetId: st.trees[i % st.trees.length], position: { x, y }, rotation: 0, props: {} };
    });
  }

  const names: Record<Strategy, [string, string]> = {
    courtyard: courtyard ? ['Courtyard Villa', 'Rooms wrap an open-to-sky court that brings light and cross-ventilation into the core of the plan.'] : ['Garden Villa', 'A three-band plan with living in the heart of the house and a private garden wing.'],
    linear: ['Modern Linear Villa', 'A gallery spine organises the plan; every room gets an outside wall, bedrooms stack over the garden side.'],
    compact: ['Tropical Compact Villa', 'A tight, efficient footprint under deep overhangs — the most garden and the lowest cost.'],
  };
  return { id: uid('sch'), name: names[strategy][0], strategy, summary: names[strategy][1], building, features, style, northAngle: northAngleFor(p.entrance) };
}

/** Spanning-tree door planning: every room reachable, with sensible adjacencies. */
function connect(rooms: RoomSpec[], isGround: boolean, gardenDoor: boolean): DoorSpec[] {
  const doors: DoorSpec[] = [];
  const pref = (fn: RoomFunction, to: RoomFunction): number => {
    const T: Partial<Record<RoomFunction, Partial<Record<RoomFunction, number>>>> = {
      living: { foyer: 10, dining: 6, family: 5, corridor: 4 },
      dining: { living: 10, kitchen: 7, family: 6, foyer: 3 },
      kitchen: { dining: 10, living: 3, utility: 2, family: 3 },
      utility: { kitchen: 10, dining: 2 },
      pooja: { foyer: 10, living: 8, dining: 4 },
      powder: { foyer: 8, living: 7, dining: 6, corridor: 6, family: 5 },
      bedroom: { family: 10, corridor: 9, living: 6, foyer: 5, stair: 2, dining: 1 },
      master_bedroom: { family: 10, corridor: 9, living: 5, foyer: 4 },
      bathroom: { bedroom: 10, master_bedroom: 10, walkin: 8, family: 2, corridor: 3 },
      walkin: { master_bedroom: 10 },
      study: { family: 9, living: 8, corridor: 8, stair: 5, foyer: 6 },
      family: { stair: 10, corridor: 8, living: 6, dining: 5 },
      corridor: { stair: 10, family: 8, living: 6 },
      stair: { living: 8, foyer: 9, family: 10, corridor: 10, dining: 4 },
      foyer: { living: 10 },
    };
    if ((fn === 'bathroom' || fn === 'powder') && (to === 'kitchen' || to === 'dining' || to === 'pooja' || to === 'stair')) return -1;
    if ((to === 'bathroom' || to === 'powder' || to === 'walkin') && fn !== 'bedroom' && fn !== 'master_bedroom' && fn !== 'bathroom' && fn !== 'walkin') return -1;
    if (fn === 'pooja' && (to === 'bathroom' || to === 'powder')) return -1;
    return T[fn]?.[to] ?? 1;
  };
  const start = isGround ? rooms.find((r) => r.fn === 'foyer') ?? rooms.find((r) => r.fn === 'living') : rooms.find((r) => r.fn === 'stair');
  if (!start) return doors;
  if (isGround) doors.push({ a: start.key, b: 's', kind: 'pivot' });
  const connected = new Set([start.key]);
  let progress = true;
  while (progress) {
    progress = false;
    let best: { a: RoomSpec; b: RoomSpec; score: number } | null = null;
    for (const a of rooms) {
      if (connected.has(a.key)) continue;
      for (const b of rooms) {
        if (!connected.has(b.key) || !roomsAdjacent(a, b, a.fn === 'stair' || b.fn === 'stair' ? 1300 : 1100)) continue;
        const s = pref(a.fn, b.fn);
        if (s < 0) continue;
        const priority = ['foyer', 'living', 'stair', 'family', 'corridor', 'dining'].includes(a.fn) ? 5 : 0;
        if (!best || s + priority > best.score) best = { a, b, score: s + priority };
      }
    }
    if (best) {
      const open = (best.a.fn === 'stair' || best.b.fn === 'stair') || (best.a.fn === 'dining' && best.b.fn === 'living') || (best.a.fn === 'living' && best.b.fn === 'dining');
      doors.push({ a: best.a.key, b: best.b.key, kind: open ? 'opening' : undefined, width: open ? 1200 : undefined });
      connected.add(best.a.key);
      progress = true;
    }
  }
  // Fallback: anything still unreachable connects to any adjacent reachable room.
  for (const a of rooms) {
    if (connected.has(a.key)) continue;
    const b = rooms.filter((x) => connected.has(x.key) && roomsAdjacent(a, x, 950)).sort((x, y) => pref(a.fn, y.fn) - pref(a.fn, x.fn))[0];
    if (b) { doors.push({ a: a.key, b: b.key }); connected.add(a.key); }
  }
  const k = rooms.find((r) => r.fn === 'kitchen'), d = rooms.find((r) => r.fn === 'dining');
  if (k && d && roomsAdjacent(k, d) && !doors.some((x) => (x.a === k.key && x.b === d.key) || (x.a === d.key && x.b === k.key))) doors.push({ a: k.key, b: d.key });
  if (gardenDoor) {
    const g2 = rooms.filter((r) => r.fn === 'dining' || r.fn === 'family' || r.fn === 'living').sort((x, y) => (y.y + y.h) - (x.y + x.h))[0];
    if (g2) doors.push({ a: g2.key, b: 'n', kind: 'sliding', width: Math.min(2700, g2.w - 900) });
  }
  return doors;
}

/** Apply a generated scheme to a project as a new design option (data only — callers dispatch ops). */
export function schemeOptionParams(s: Scheme) {
  return { name: s.name, description: s.summary, style: s.style, building: s.building };
}

export function siteFromProgram(width: number, depth: number, front = 3000, side = 1500, rear = 1500): Site {
  return {
    boundary: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }],
    edges: [{ kind: 'front', setback: front, road: { name: 'Access road', width: 9000 } }, { kind: 'side', setback: side }, { kind: 'rear', setback: rear }, { kind: 'side', setback: side }],
    northAngle: 0,
    features: {},
  };
}

export function applySchemeToDoc(doc: ProjectDoc, s: Scheme): void {
  for (const f of s.features) doc.site.features[f.id] = f;
  doc.site.northAngle = s.northAngle;
}
