/**
 * Outdoor living, garden structures, lighting and plants. Like every other
 * asset these are parametric recipes, so the plan symbol, the 3D object, the
 * schedule and the estimate all come from one definition. Plants additionally
 * carry their horticultural record and are modelled procedurally in 3D.
 */
import type { Asset, AssetVariant, Part, PartSlot } from './assets';
import { PLANTS, PLANT_BY_ID, plantAssetId, type Plant } from './plants';

const box = (x: number, y: number, z: number, w: number, d: number, h: number, slot: PartSlot, overhead = false): Part => ({ shape: 'box', x, y, z, w, d, h, slot, overhead });
const cyl = (x: number, y: number, z: number, r: number, h: number, slot: PartSlot, overhead = false): Part => ({ shape: 'cyl', x, y, z, w: r * 2, d: r * 2, h, slot, overhead });
/** Ellipsoid: w × d footprint, h tall, resting on z. */
const blob = (x: number, y: number, z: number, w: number, d: number, h: number, slot: PartSlot, overhead = false): Part => ({ shape: 'sphere', x, y, z, w, d, h, slot, overhead });
const pyr = (x: number, y: number, z: number, w: number, d: number, h: number, slot: PartSlot): Part => ({ shape: 'pyramid', x, y, z, w, d, h, slot, overhead: true });
const cone = (x: number, y: number, z: number, r: number, h: number, slot: PartSlot, overhead = false): Part => ({ shape: 'cone', x, y, z, w: r * 2, d: r * 2, h, slot, overhead });

const TIMBER: AssetVariant[] = [
  { id: 'teak', name: 'Teak', colors: { wood: '#a9794d', fabric: '#e6dfd2', accent: '#8a6a4f', roof: '#6b5546' } },
  { id: 'charcoal', name: 'Charcoal', colors: { wood: '#3b3a38', fabric: '#b9b4aa', accent: '#2f2f2f', metal: '#2c2d2f', roof: '#2f3033' } },
  { id: 'white', name: 'White', colors: { wood: '#efece6', fabric: '#d9d2c4', accent: '#c9c2b4', metal: '#e8e6e1', roof: '#d8d3ca' } },
  { id: 'weathered', name: 'Weathered grey', colors: { wood: '#9a958c', fabric: '#ece7dd', accent: '#7f7a72', roof: '#77736c' } },
];
const STONE: AssetVariant[] = [
  { id: 'sandstone', name: 'Sandstone', colors: { stone: '#d2c2a5' } },
  { id: 'granite', name: 'Grey granite', colors: { stone: '#8f9090' } },
  { id: 'basalt', name: 'Black basalt', colors: { stone: '#4a4b4d' } },
  { id: 'white', name: 'White render', colors: { stone: '#ecebe6' } },
];
const METAL: AssetVariant[] = [
  { id: 'black', name: 'Matt black', colors: { metal: '#2a2b2d' } },
  { id: 'bronze', name: 'Bronze', colors: { metal: '#6a543c' } },
  { id: 'steel', name: 'Brushed steel', colors: { metal: '#9a9da0' } },
];

type Def = Omit<Asset, 'manufacturer' | 'sku' | 'library' | 'variants'> & Partial<Pick<Asset, 'variants'>>;
const A = (a: Def): Asset => ({
  manufacturer: 'Plinth Outdoor', library: 'public', variants: a.variants ?? TIMBER,
  sku: `PO-${a.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9)}`, ...a,
});

function posts(w: number, d: number, h: number, s: number, slot: PartSlot = 'wood'): Part[] {
  const x = w / 2 - s / 2, y = d / 2 - s / 2;
  return [box(-x, -y, 0, s, s, h, slot), box(x, -y, 0, s, s, h, slot), box(-x, y, 0, s, s, h, slot), box(x, y, 0, s, s, h, slot)];
}

function pergola(w: number, d: number): Part[] {
  const parts = posts(w, d, 2600, 150);
  for (const s of [-1, 1]) parts.push(box(0, s * (d / 2 - 75), 2600, w + 500, 100, 200, 'wood', true));
  const n = Math.max(4, Math.round(w / 450));
  for (let i = 0; i <= n; i++) parts.push(box(-w / 2 + (w / n) * i, 0, 2800, 60, d + 500, 140, 'wood', true));
  return parts;
}

function chairs(tableW: number, tableD: number, n: number): Part[] {
  const out: Part[] = [];
  const per = Math.max(1, Math.floor((n - (n > 4 ? 2 : 0)) / 2));
  for (let i = 0; i < per; i++) {
    const x = -tableW / 2 + (tableW / per) * (i + 0.5);
    for (const s of [-1, 1]) { const y = s * (tableD / 2 + 260); out.push(box(x, y, 0, 480, 480, 440, 'fabric'), box(x, y + s * 220, 440, 480, 60, 400, 'wood')); }
  }
  if (n > 4) for (const s of [-1, 1]) { const x = s * (tableW / 2 + 260); out.push(box(x, 0, 0, 480, 480, 440, 'fabric'), box(x + s * 220, 0, 440, 60, 480, 400, 'wood')); }
  return out;
}

function lounger(x: number): Part[] {
  return [box(x, 0, 0, 700, 2000, 280, 'wood'), box(x, -150, 280, 660, 1500, 80, 'fabric'), box(x, 740, 280, 660, 500, 320, 'fabric')];
}

export const OUTDOOR_ASSETS: Asset[] = [
  // ------------------------------------------------------- outdoor living
  A({ id: 'outdoor-sofa', name: 'Outdoor sectional + coffee table', category: 'outdoor', size: { w: 2900, d: 2300, h: 780 }, tags: ['sit-out', 'sofa', 'lounge', 'patio', 'seating'], price: 185000,
    parts: [box(0, 700, 0, 2900, 900, 380, 'wood'), box(0, 700, 380, 2800, 800, 110, 'fabric'), box(0, 1080, 380, 2900, 140, 400, 'fabric'), box(-1000, -250, 0, 900, 1000, 380, 'wood'), box(-1000, -250, 380, 800, 950, 110, 'fabric'), box(-1380, -250, 380, 140, 1000, 400, 'fabric'), box(450, -350, 0, 1200, 700, 320, 'wood')] }),
  A({ id: 'outdoor-lounge', name: 'Lounge chairs + side table', category: 'outdoor', size: { w: 2300, d: 950, h: 800 }, tags: ['sit-out', 'chairs', 'verandah', 'patio', 'seating'], price: 68000,
    parts: [box(-750, 0, 0, 780, 850, 380, 'wood'), box(-750, 0, 380, 700, 760, 100, 'fabric'), box(-750, 380, 380, 780, 110, 420, 'wood'), box(750, 0, 0, 780, 850, 380, 'wood'), box(750, 0, 380, 700, 760, 100, 'fabric'), box(750, 380, 380, 780, 110, 420, 'wood'), cyl(0, -50, 0, 250, 480, 'metal')] }),
  A({ id: 'daybed', name: 'Canopy daybed', category: 'outdoor', size: { w: 2100, d: 2100, h: 2300 }, tags: ['daybed', 'cabana', 'pool', 'lounge'], price: 145000,
    parts: [box(0, 0, 0, 2000, 2000, 350, 'wood'), box(0, 0, 350, 1900, 1900, 180, 'fabric'), box(0, 800, 530, 1700, 250, 250, 'fabric'), ...posts(2100, 2100, 2200, 80), box(0, 0, 2200, 2200, 2200, 60, 'fabric', true)] }),
  A({ id: 'garden-bench', name: 'Garden bench', category: 'outdoor', size: { w: 1600, d: 600, h: 850 }, tags: ['bench', 'seat', 'garden'], price: 22000,
    parts: [box(0, -30, 400, 1600, 480, 60, 'wood'), box(0, 250, 460, 1600, 60, 390, 'wood'), box(-720, 0, 0, 80, 520, 400, 'metal'), box(720, 0, 0, 80, 520, 400, 'metal')] }),
  A({ id: 'bistro-set', name: 'Bistro table + 2 chairs', category: 'outdoor', size: { w: 1700, d: 700, h: 780 }, tags: ['bistro', 'balcony', 'cafe', 'breakfast'], price: 26000, variants: METAL,
    parts: [cyl(0, 0, 700, 350, 30, 'metal'), cyl(0, 0, 0, 40, 700, 'metal'), box(-620, 0, 0, 420, 420, 450, 'metal'), box(-800, 0, 450, 40, 420, 380, 'metal'), box(620, 0, 0, 420, 420, 450, 'metal'), box(800, 0, 450, 40, 420, 380, 'metal')] }),
  A({ id: 'outdoor-dining-6', name: 'Outdoor dining for 6', category: 'outdoor', size: { w: 3000, d: 2000, h: 860 }, tags: ['dining', 'alfresco', 'patio', 'table'], price: 125000,
    parts: [box(0, 0, 700, 2000, 1000, 50, 'wood'), box(-800, 0, 0, 100, 800, 700, 'metal'), box(800, 0, 0, 100, 800, 700, 'metal'), ...chairs(2000, 1000, 6)] }),
  A({ id: 'outdoor-dining-8', name: 'Outdoor dining for 8', category: 'outdoor', size: { w: 3600, d: 2100, h: 860 }, tags: ['dining', 'alfresco', 'patio', 'table'], price: 168000,
    parts: [box(0, 0, 700, 2600, 1100, 50, 'wood'), box(-1050, 0, 0, 100, 900, 700, 'metal'), box(1050, 0, 0, 100, 900, 700, 'metal'), ...chairs(2600, 1100, 8)] }),
  A({ id: 'bar-counter', name: 'Outdoor bar + stools', category: 'outdoor', size: { w: 2400, d: 1300, h: 1100 }, tags: ['bar', 'counter', 'entertaining'], price: 135000, variants: STONE,
    parts: [box(0, 250, 0, 2400, 600, 1050, 'stone'), box(0, 220, 1050, 2500, 720, 50, 'wood'), cyl(-750, -400, 0, 190, 750, 'metal'), cyl(0, -400, 0, 190, 750, 'metal'), cyl(750, -400, 0, 190, 750, 'metal')] }),
  A({ id: 'parasol', name: 'Cantilever parasol', category: 'outdoor', size: { w: 3000, d: 3000, h: 2700 }, tags: ['umbrella', 'shade', 'parasol', 'pool'], price: 42000,
    variants: [{ id: 'ivory', name: 'Ivory', colors: { fabric: '#efe9dc' } }, { id: 'charcoal', name: 'Charcoal', colors: { fabric: '#4a4a4a' } }, { id: 'terracotta', name: 'Terracotta', colors: { fabric: '#c0704c' } }, { id: 'olive', name: 'Olive', colors: { fabric: '#7b8058' } }],
    parts: [cyl(0, 1300, 0, 45, 2600, 'metal'), box(0, 650, 2550, 60, 1350, 60, 'metal', true), cone(0, 0, 2150, 1500, 480, 'fabric', true), box(0, 1300, 0, 600, 600, 90, 'dark')] }),
  A({ id: 'lounger-pair', name: 'Sun loungers + table', category: 'outdoor', size: { w: 2200, d: 2000, h: 600 }, tags: ['pool', 'lounger', 'sunbed', 'deck'], price: 64000,
    parts: [...lounger(-700), ...lounger(700), cyl(0, 300, 0, 220, 420, 'wood')] }),
  A({ id: 'swing-garden', name: 'Garden swing', category: 'outdoor', size: { w: 2300, d: 1500, h: 2200 }, tags: ['swing', 'jhoola', 'garden', 'seat'], price: 58000,
    parts: [box(-1080, -600, 0, 90, 90, 2100, 'wood'), box(-1080, 600, 0, 90, 90, 2100, 'wood'), box(1080, -600, 0, 90, 90, 2100, 'wood'), box(1080, 600, 0, 90, 90, 2100, 'wood'), box(0, 0, 2100, 2300, 120, 120, 'wood', true), box(0, 0, 450, 1600, 600, 70, 'wood'), box(0, 270, 520, 1600, 60, 480, 'wood'), box(-780, 0, 520, 20, 20, 1580, 'metal'), box(780, 0, 520, 20, 20, 1580, 'metal')] }),
  A({ id: 'hammock', name: 'Hammock', category: 'outdoor', size: { w: 3400, d: 1000, h: 1300 }, tags: ['hammock', 'relax', 'garden'], price: 18000,
    parts: [box(-1600, 0, 0, 100, 100, 1300, 'wood'), box(1600, 0, 0, 100, 100, 1300, 'wood'), box(0, 0, 480, 2600, 900, 40, 'fabric'), box(0, 0, 0, 3400, 120, 80, 'wood')] }),
  // ------------------------------------------------------------ shade
  A({ id: 'pergola', name: 'Pergola 10 × 10 ft', category: 'garden', size: { w: 3500, d: 3500, h: 2940 }, tags: ['pergola', 'shade', 'sit-out', 'patio', 'trellis'], price: 165000, parts: pergola(3000, 3000) }),
  A({ id: 'pergola-l', name: 'Pergola 16 × 12 ft', category: 'garden', size: { w: 5300, d: 4100, h: 2940 }, tags: ['pergola', 'shade', 'sit-out', 'patio', 'dining'], price: 285000, parts: pergola(4800, 3600) }),
  A({ id: 'gazebo', name: 'Gazebo', category: 'garden', size: { w: 4400, d: 4400, h: 4000 }, tags: ['gazebo', 'pavilion', 'shade', 'garden room'], price: 420000,
    parts: [box(0, 0, 0, 3800, 3800, 160, 'stone'), ...posts(3500, 3500, 2600, 180).map((p) => ({ ...p, z: 160 })), box(0, 0, 2760, 3900, 3900, 160, 'wood', true), pyr(0, 0, 2920, 4400, 4400, 1080, 'roof')] }),
  A({ id: 'carport', name: 'Carport — 1 car', category: 'garden', size: { w: 3200, d: 5600, h: 2600 }, tags: ['carport', 'parking', 'car porch', 'shade'], price: 185000, variants: METAL,
    parts: [...posts(3000, 5400, 2400, 120, 'metal'), box(0, 0, 2400, 3200, 5600, 120, 'metal', true), box(0, 0, 2520, 3200, 5600, 40, 'roof', true)] }),
  A({ id: 'carport-2', name: 'Carport — 2 cars', category: 'garden', size: { w: 6000, d: 5600, h: 2600 }, tags: ['carport', 'parking', 'car porch', 'shade'], price: 320000, variants: METAL,
    parts: [...posts(5800, 5400, 2400, 140, 'metal'), box(0, 0, 2400, 6000, 5600, 140, 'metal', true), box(0, 0, 2540, 6000, 5600, 40, 'roof', true)] }),
  A({ id: 'privacy-screen', name: 'Timber slat screen', category: 'garden', size: { w: 2400, d: 100, h: 1900 }, tags: ['screen', 'privacy', 'fence', 'slats'], price: 38000,
    parts: [box(-1150, 0, 0, 100, 100, 1900, 'wood'), box(1150, 0, 0, 100, 100, 1900, 'wood'), ...Array.from({ length: 9 }, (_, i) => box(0, 0, 150 + i * 190, 2200, 30, 120, 'wood'))] }),
  // -------------------------------------------------- fire, food, water
  A({ id: 'fire-pit', name: 'Fire pit', category: 'garden', size: { w: 1300, d: 1300, h: 450 }, tags: ['fire', 'firepit', 'bonfire', 'sit-out'], price: 48000, variants: STONE,
    parts: [cyl(0, 0, 0, 650, 400, 'stone'), cyl(0, 0, 400, 500, 20, 'dark'), blob(0, 0, 380, 520, 520, 190, 'light')] }),
  A({ id: 'fire-table', name: 'Gas fire table', category: 'garden', size: { w: 1500, d: 700, h: 450 }, tags: ['fire', 'table', 'modern', 'sit-out'], price: 95000, variants: STONE,
    parts: [box(0, 0, 0, 1500, 700, 420, 'stone'), box(0, 0, 420, 1000, 300, 15, 'dark'), box(0, 0, 420, 800, 160, 110, 'light')] }),
  A({ id: 'bbq', name: 'Barbecue island', category: 'garden', size: { w: 1800, d: 700, h: 1150 }, tags: ['bbq', 'grill', 'barbecue', 'outdoor kitchen'], price: 145000, variants: STONE,
    parts: [box(0, 0, 0, 1800, 700, 880, 'stone'), box(0, 0, 880, 1850, 750, 40, 'dark'), box(-300, 0, 920, 800, 550, 230, 'metal'), box(600, 0, 920, 380, 380, 12, 'metal')] }),
  A({ id: 'outdoor-kitchen', name: 'Outdoor kitchen (L)', category: 'garden', size: { w: 3200, d: 2400, h: 1150 }, tags: ['outdoor kitchen', 'bbq', 'grill', 'sink', 'counter'], price: 385000, variants: STONE, glyph: 'sink',
    parts: [box(0, 850, 0, 3200, 700, 880, 'stone'), box(0, 850, 880, 3250, 750, 40, 'dark'), box(-1250, -350, 0, 700, 1700, 880, 'stone'), box(-1250, -350, 880, 750, 1750, 40, 'dark'), box(400, 850, 920, 900, 550, 230, 'metal'), box(-1250, -400, 920, 420, 420, 15, 'metal'), box(1250, 850, 0, 600, 650, 870, 'metal')] }),
  A({ id: 'pizza-oven', name: 'Wood-fired oven', category: 'garden', size: { w: 1300, d: 1300, h: 1900 }, tags: ['pizza', 'oven', 'tandoor', 'outdoor kitchen'], price: 115000, variants: STONE,
    parts: [box(0, 0, 0, 1300, 1300, 900, 'stone'), blob(0, 0, 900, 1200, 1200, 650, 'stone'), box(0, -560, 950, 450, 120, 320, 'dark'), cyl(0, 250, 1450, 90, 450, 'metal')] }),
  A({ id: 'jacuzzi', name: 'Jacuzzi / spa', category: 'garden', size: { w: 2200, d: 2200, h: 900 }, tags: ['jacuzzi', 'spa', 'hot tub', 'pool'], price: 480000,
    parts: [box(0, 0, 0, 2200, 2200, 850, 'wood'), box(0, 0, 850, 2200, 2200, 50, 'white'), box(0, 0, 780, 1800, 1800, 110, 'water')] }),
  A({ id: 'outdoor-shower', name: 'Outdoor shower', category: 'garden', size: { w: 1000, d: 1000, h: 2300 }, tags: ['shower', 'pool', 'rinse'], price: 36000, variants: METAL, glyph: 'shower',
    parts: [box(0, 0, 0, 1000, 1000, 40, 'wood'), cyl(0, 420, 0, 30, 2250, 'metal'), box(0, 250, 2200, 40, 380, 40, 'metal', true), cyl(0, 80, 2150, 110, 30, 'metal', true)] }),
  A({ id: 'fountain', name: 'Tiered fountain', category: 'garden', size: { w: 2200, d: 2200, h: 1900 }, tags: ['fountain', 'water feature', 'courtyard'], price: 165000, variants: STONE,
    parts: [cyl(0, 0, 0, 1100, 450, 'stone'), cyl(0, 0, 380, 980, 80, 'water'), cyl(0, 0, 0, 160, 1100, 'stone'), cyl(0, 0, 1100, 520, 110, 'stone'), cyl(0, 0, 1180, 440, 40, 'water'), cyl(0, 0, 1210, 90, 480, 'stone'), blob(0, 0, 1690, 260, 260, 210, 'stone')] }),
  A({ id: 'water-wall', name: 'Water wall', category: 'garden', size: { w: 2600, d: 800, h: 2000 }, tags: ['water feature', 'cascade', 'wall', 'modern'], price: 210000, variants: STONE,
    parts: [box(0, 280, 0, 2600, 240, 2000, 'stone'), box(0, 145, 250, 2000, 20, 1600, 'water'), box(0, -100, 0, 2600, 600, 300, 'stone'), box(0, -100, 240, 2400, 440, 70, 'water')] }),
  A({ id: 'bird-bath', name: 'Bird bath', category: 'garden', size: { w: 650, d: 650, h: 850 }, tags: ['bird bath', 'garden', 'ornament'], price: 9500, variants: STONE,
    parts: [cyl(0, 0, 0, 180, 60, 'stone'), cyl(0, 0, 60, 70, 680, 'stone'), cyl(0, 0, 740, 325, 90, 'stone'), cyl(0, 0, 800, 270, 35, 'water')] }),
  // ---------------------------------------------- garden build-outs
  A({ id: 'raised-bed', name: 'Raised vegetable bed', category: 'garden', size: { w: 2400, d: 1200, h: 800 }, tags: ['vegetable', 'kitchen garden', 'raised bed', 'herbs'], price: 16000, glyph: 'tree',
    parts: [box(0, 0, 0, 2400, 1200, 450, 'wood'), box(0, 0, 440, 2300, 1100, 20, 'soil'), ...[-850, -280, 290, 860].flatMap((x, i) => [blob(x, -280, 440, 380, 380, 300 + (i % 2) * 90, 'leaf'), blob(x, 280, 440, 360, 360, 260 + ((i + 1) % 2) * 110, 'leaf')])] }),
  A({ id: 'trellis', name: 'Trellis with climber', category: 'garden', size: { w: 1900, d: 300, h: 2100 }, tags: ['trellis', 'climber', 'green wall', 'screen'], price: 14000, glyph: 'tree',
    parts: [box(-900, 0, 0, 80, 80, 2100, 'wood'), box(900, 0, 0, 80, 80, 2100, 'wood'), box(0, 0, 2020, 1880, 80, 80, 'wood'), box(0, 0, 200, 1720, 40, 1800, 'wood'), blob(0, -40, 150, 1750, 300, 1850, 'leaf')] }),
  A({ id: 'garden-arch', name: 'Garden arch', category: 'garden', size: { w: 1700, d: 700, h: 2400 }, tags: ['arch', 'arbour', 'entrance', 'climber'], price: 28000, glyph: 'tree',
    parts: [box(-750, 0, 0, 120, 600, 2200, 'wood'), box(750, 0, 0, 120, 600, 2200, 'wood'), box(0, 0, 2200, 1700, 700, 120, 'wood', true), blob(-760, 0, 900, 420, 720, 1500, 'leaf'), blob(760, 0, 1100, 420, 720, 1300, 'leaf'), blob(0, 0, 2150, 1750, 760, 380, 'leaf', true)] }),
  A({ id: 'stepping-stones', name: 'Stepping stones (5)', category: 'garden', size: { w: 700, d: 3200, h: 50 }, tags: ['path', 'stepping stone', 'garden', 'zen'], price: 6500, variants: STONE,
    parts: [-1280, -640, 0, 640, 1280].map((y, i) => cyl(i % 2 ? 60 : -60, y, 0, 270, 45, 'stone')) }),
  A({ id: 'boulders', name: 'Feature boulders', category: 'garden', size: { w: 2000, d: 1500, h: 900 }, tags: ['rock', 'boulder', 'zen', 'stone'], price: 24000, variants: STONE,
    parts: [blob(-350, 100, 0, 1100, 950, 820, 'stone'), blob(520, -250, 0, 800, 700, 520, 'stone'), blob(450, 420, 0, 520, 480, 330, 'stone')] }),
  A({ id: 'sculpture', name: 'Garden sculpture', category: 'garden', size: { w: 800, d: 800, h: 2100 }, tags: ['sculpture', 'art', 'statue', 'focal point'], price: 95000, variants: METAL,
    parts: [box(0, 0, 0, 700, 700, 600, 'stone'), blob(0, 0, 600, 620, 420, 900, 'metal'), blob(60, 0, 1350, 380, 300, 520, 'metal'), blob(-20, 0, 1800, 220, 200, 260, 'metal')] }),
  A({ id: 'tulsi-vrindavan', name: 'Tulsi vrindavan', category: 'garden', size: { w: 750, d: 750, h: 1400 }, tags: ['tulsi', 'vrindavan', 'pooja', 'courtyard', 'vastu'], price: 22000, variants: STONE, glyph: 'tree',
    parts: [box(0, 0, 0, 750, 750, 180, 'stone'), box(0, 0, 180, 560, 560, 560, 'stone'), box(0, 0, 740, 660, 660, 110, 'stone'), blob(0, 0, 830, 460, 460, 520, 'leaf'), blob(0, -330, 420, 90, 90, 90, 'light')] }),
  A({ id: 'play-set', name: 'Play set — swing & slide', category: 'garden', size: { w: 4200, d: 2600, h: 2600 }, tags: ['kids', 'play', 'swing', 'slide', 'children'], price: 135000,
    parts: [...posts(1500, 1500, 1500, 110).map((p) => ({ ...p, x: p.x - 1200 })), box(-1200, 0, 1400, 1500, 1500, 100, 'wood'), pyr(-1200, 0, 2300, 1800, 1800, 600, 'roof'), ...posts(1500, 1500, 900, 110).map((p) => ({ ...p, x: p.x - 1200, z: 1500 })),
      box(-1200, -1500, 500, 600, 1500, 60, 'accent'), box(-1200, -1500, 0, 600, 60, 500, 'accent'), box(600, -900, 0, 100, 100, 2300, 'wood'), box(600, 900, 0, 100, 100, 2300, 'wood'), box(1900, -900, 0, 100, 100, 2300, 'wood'), box(1900, 900, 0, 100, 100, 2300, 'wood'), box(600, 0, 2300, 3000, 120, 120, 'wood', true), box(900, 0, 500, 450, 200, 40, 'accent'), box(1500, 0, 500, 450, 200, 40, 'accent')],
    variants: [{ id: 'natural', name: 'Timber + red', colors: { wood: '#a9794d', accent: '#c8463a', roof: '#3f7a5a' } }, { id: 'blue', name: 'Timber + blue', colors: { wood: '#a9794d', accent: '#3f73b8', roof: '#e0a52c' } }] }),
  A({ id: 'trampoline', name: 'Trampoline', category: 'garden', size: { w: 3200, d: 3200, h: 2400 }, tags: ['kids', 'play', 'trampoline'], price: 42000, variants: METAL,
    parts: [cyl(0, 0, 700, 1600, 60, 'dark'), ...[0, 1, 2, 3, 4, 5].map((i) => cyl(Math.cos((i / 6) * Math.PI * 2) * 1550, Math.sin((i / 6) * Math.PI * 2) * 1550, 0, 35, 2400, 'metal'))] }),
  A({ id: 'sandpit', name: 'Sand pit', category: 'garden', size: { w: 2000, d: 2000, h: 300 }, tags: ['kids', 'play', 'sand'], price: 14000,
    parts: [box(0, 0, 0, 2000, 2000, 280, 'wood'), box(0, 0, 200, 1800, 1800, 60, 'sand')] }),
  A({ id: 'basketball-hoop', name: 'Basketball hoop', category: 'garden', size: { w: 1800, d: 1300, h: 3900 }, tags: ['sports', 'basketball', 'play', 'court'], price: 38000, variants: METAL,
    parts: [cyl(0, 500, 0, 70, 3050, 'metal'), box(0, 150, 2900, 80, 700, 80, 'metal', true), box(0, -150, 2900, 1800, 50, 1050, 'white', true), cyl(0, -400, 3050, 230, 25, 'accent', true)] }),
  A({ id: 'garden-shed', name: 'Garden shed', category: 'garden', size: { w: 2600, d: 2000, h: 2700 }, tags: ['shed', 'store', 'tools', 'outhouse'], price: 115000,
    parts: [box(0, 0, 0, 2400, 1800, 2000, 'wood'), box(0, -910, 0, 800, 30, 1900, 'accent'), pyr(0, 0, 2000, 2700, 2100, 700, 'roof')] }),
  A({ id: 'guard-cabin', name: 'Security cabin', category: 'garden', size: { w: 2000, d: 2000, h: 2800 }, tags: ['security', 'guard', 'gate', 'cabin'], price: 165000, variants: STONE,
    parts: [box(0, 0, 0, 1800, 1800, 2400, 'stone'), box(0, -905, 900, 1000, 20, 900, 'glass'), box(0, 0, 2400, 2200, 2200, 120, 'dark', true)] }),
  A({ id: 'ev-charger', name: 'EV charging point', category: 'garden', size: { w: 350, d: 250, h: 1400 }, tags: ['ev', 'charger', 'parking', 'electric'], price: 68000, variants: METAL,
    parts: [box(0, 0, 0, 300, 220, 1400, 'white'), box(0, -115, 950, 200, 12, 300, 'dark'), box(0, -118, 1280, 180, 8, 30, 'light')] }),
  // --------------------------------------------------- gates & lighting
  A({ id: 'gate-main', name: 'Main gate with pillars', category: 'garden', size: { w: 4900, d: 450, h: 2200 }, tags: ['gate', 'entrance', 'driveway', 'compound'], price: 245000,
    parts: [box(-2225, 0, 0, 450, 450, 2100, 'stone'), box(2225, 0, 0, 450, 450, 2100, 'stone'), box(-2225, 0, 2100, 540, 540, 90, 'stone'), box(2225, 0, 2100, 540, 540, 90, 'stone'), box(-1000, 0, 120, 1980, 60, 1700, 'wood'), box(1000, 0, 120, 1980, 60, 1700, 'wood'), blob(-2225, 0, 2190, 220, 220, 220, 'light'), blob(2225, 0, 2190, 220, 220, 220, 'light')],
    variants: [{ id: 'teak', name: 'Teak + sandstone', colors: { wood: '#8a5f3d', stone: '#d2c2a5' } }, { id: 'black', name: 'Black steel + white', colors: { wood: '#2a2b2d', stone: '#ecebe6' } }, { id: 'grey', name: 'Grey slats + basalt', colors: { wood: '#77736c', stone: '#4a4b4d' } }] }),
  A({ id: 'gate-pedestrian', name: 'Pedestrian gate', category: 'garden', size: { w: 1900, d: 400, h: 2100 }, tags: ['gate', 'wicket', 'entrance', 'compound'], price: 78000,
    parts: [box(-750, 0, 0, 400, 400, 2000, 'stone'), box(750, 0, 0, 400, 400, 2000, 'stone'), box(0, 0, 120, 1080, 50, 1650, 'wood')],
    variants: [{ id: 'teak', name: 'Teak + sandstone', colors: { wood: '#8a5f3d', stone: '#d2c2a5' } }, { id: 'black', name: 'Black steel + white', colors: { wood: '#2a2b2d', stone: '#ecebe6' } }] }),
  A({ id: 'lamp-post', name: 'Garden lamp post', category: 'garden', size: { w: 350, d: 350, h: 3200 }, tags: ['light', 'lamp', 'lighting', 'driveway'], price: 28000, variants: METAL, glyph: 'light',
    parts: [cyl(0, 0, 0, 120, 200, 'metal'), cyl(0, 0, 200, 45, 2700, 'metal'), blob(0, 0, 2900, 320, 320, 300, 'light')] }),
  A({ id: 'bollard-light', name: 'Bollard light', category: 'garden', size: { w: 180, d: 180, h: 800 }, tags: ['light', 'bollard', 'path', 'lighting'], price: 8500, variants: METAL, glyph: 'light',
    parts: [cyl(0, 0, 0, 80, 640, 'metal'), cyl(0, 0, 640, 78, 110, 'light'), cyl(0, 0, 750, 90, 50, 'metal')] }),
  A({ id: 'path-light', name: 'Path spike light', category: 'garden', size: { w: 160, d: 160, h: 450 }, tags: ['light', 'path', 'spike', 'lighting'], price: 2800, variants: METAL, glyph: 'light',
    parts: [cyl(0, 0, 0, 18, 380, 'metal'), cone(0, 0, 380, 80, 70, 'metal'), cyl(0, 0, 340, 40, 40, 'light')] }),
  A({ id: 'uplight', name: 'Tree uplight', category: 'garden', size: { w: 160, d: 160, h: 140 }, tags: ['light', 'uplight', 'spot', 'tree', 'lighting'], price: 3600, variants: METAL, glyph: 'light',
    parts: [cyl(0, 0, 0, 80, 100, 'metal'), cyl(0, 0, 100, 60, 30, 'light')] }),
];

/** Plants as placeable assets. `parts` stay empty: plan symbol and 3D come from the plant's growth form. */
function plantAsset(p: Plant, id = plantAssetId(p.id), name = p.common, size?: Asset['size']): Asset {
  return {
    id, name, category: 'plant', size: size ?? { w: p.spread, d: p.spread, h: p.height }, parts: [],
    variants: [{ id: 'default', name: 'Natural', colors: { leaf: p.foliage } }],
    manufacturer: 'Plinth Nursery', sku: `PN-${p.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9)}`, library: 'public',
    tags: ['plant', p.type, p.botanical.toLowerCase(), ...p.styles], price: p.price, glyph: 'tree', plant: p,
  };
}

export const PLANT_ASSETS: Asset[] = [
  ...PLANTS.map((p) => plantAsset(p)),
  // Earlier generic ids, kept so existing projects upgrade to real species in place.
  plantAsset(PLANT_BY_ID.neem, 'tree', 'Shade tree', { w: 4500, d: 4500, h: 7000 }),
  plantAsset(PLANT_BY_ID.foxtail, 'palm', 'Palm tree', { w: 3600, d: 3600, h: 7500 }),
  plantAsset(PLANT_BY_ID.hibiscus, 'shrub', 'Shrub', { w: 1200, d: 1200, h: 1000 }),
];
