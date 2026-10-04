/**
 * Asset library. Each asset is a parametric recipe of primitives. The same recipe
 * produces the 3D object *and* the 2D plan symbol (a top-down projection), so
 * plan and model can never disagree.
 */

export type AssetCategory = 'living' | 'bedroom' | 'dining' | 'kitchen' | 'bathroom' | 'lighting' | 'exterior' | 'study' | 'utility' | 'pooja';
export type PartSlot = 'body' | 'accent' | 'fabric' | 'wood' | 'metal' | 'glass' | 'white' | 'leaf' | 'trunk' | 'dark' | 'light' | 'stone' | 'water';

export interface Part {
  shape: 'box' | 'cyl' | 'sphere' | 'cone';
  /** Centre of the part's base, in mm, relative to the asset centre on the floor. x → width, y → depth (front is −y). */
  x: number; y: number; z: number;
  w: number; d: number; h: number;
  slot: PartSlot;
  /** Optional: draw in plan with a dashed line (e.g. overhead elements). */
  overhead?: boolean;
}

export interface AssetVariant { id: string; name: string; colors: Partial<Record<PartSlot, string>> }

export interface Asset {
  id: string;
  name: string;
  category: AssetCategory;
  size: { w: number; d: number; h: number };
  parts: Part[];
  variants: AssetVariant[];
  manufacturer: string;
  sku: string;
  library: 'public' | 'company' | 'team' | 'personal';
  tags: string[];
  /** Rough cost in INR, used by the furniture line in estimates. */
  price: number;
  /** Plan symbol extras (text / glyphs) drawn on top of the projection. */
  glyph?: 'pillows' | 'basin' | 'hob' | 'sink' | 'wc' | 'car' | 'tree' | 'shower' | 'light' | 'tv' | 'bath';
}

const box = (x: number, y: number, z: number, w: number, d: number, h: number, slot: PartSlot, overhead = false): Part => ({ shape: 'box', x, y, z, w, d, h, slot, overhead });
const cyl = (x: number, y: number, z: number, r: number, h: number, slot: PartSlot): Part => ({ shape: 'cyl', x, y, z, w: r * 2, d: r * 2, h, slot });
const sph = (x: number, y: number, z: number, r: number, slot: PartSlot, overhead = false): Part => ({ shape: 'sphere', x, y, z, w: r * 2, d: r * 2, h: r * 2, slot, overhead });

const NEUTRAL: AssetVariant[] = [
  { id: 'natural', name: 'Natural', colors: { fabric: '#d8cfc0', wood: '#b98d5f', accent: '#8a6a4f' } },
  { id: 'charcoal', name: 'Charcoal', colors: { fabric: '#5a5856', wood: '#6b4a32', accent: '#2f2f2f' } },
  { id: 'olive', name: 'Olive', colors: { fabric: '#6f7350', wood: '#a0784f', accent: '#4c4f36' } },
  { id: 'ivory', name: 'Ivory', colors: { fabric: '#efe9de', wood: '#d2b48c', accent: '#c4b49a' } },
];

function chairsAround(tableW: number, tableD: number, n: number): Part[] {
  const parts: Part[] = [];
  const perSide = Math.max(1, Math.floor((n - (n > 4 ? 2 : 0)) / 2));
  for (let i = 0; i < perSide; i++) {
    const x = -tableW / 2 + (tableW / perSide) * (i + 0.5);
    for (const s of [-1, 1]) {
      const y = s * (tableD / 2 + 230);
      parts.push(box(x, y, 0, 440, 440, 450, 'fabric'));
      parts.push(box(x, y + s * 200, 450, 440, 50, 420, 'wood'));
    }
  }
  if (n > 4) for (const s of [-1, 1]) {
    parts.push(box(s * (tableW / 2 + 230), 0, 0, 440, 440, 450, 'fabric'));
    parts.push(box(s * (tableW / 2 + 430), 0, 450, 50, 440, 420, 'wood'));
  }
  return parts;
}

const A = (a: Omit<Asset, 'manufacturer' | 'sku' | 'library' | 'variants'> & Partial<Pick<Asset, 'variants' | 'manufacturer' | 'library'>>): Asset => ({
  manufacturer: a.manufacturer ?? 'Plinth Essentials',
  library: a.library ?? 'public',
  variants: a.variants ?? NEUTRAL,
  sku: `PE-${a.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`,
  ...a,
});

export const ASSETS: Asset[] = [
  // Living
  A({ id: 'sofa-3', name: 'Three-seat sofa', category: 'living', size: { w: 2200, d: 950, h: 800 }, tags: ['sofa', 'couch', 'seating'], price: 95000,
    parts: [box(0, 0, 0, 2200, 950, 420, 'fabric'), box(0, 375, 420, 2200, 200, 380, 'fabric'), box(-1030, 0, 420, 140, 950, 200, 'fabric'), box(1030, 0, 420, 140, 950, 200, 'fabric'), box(-480, -60, 420, 900, 700, 90, 'fabric'), box(480, -60, 420, 900, 700, 90, 'fabric')] }),
  A({ id: 'sofa-l', name: 'L-shaped sectional', category: 'living', size: { w: 2800, d: 1800, h: 800 }, tags: ['sofa', 'sectional', 'seating'], price: 165000,
    parts: [box(0, 425, 0, 2800, 950, 420, 'fabric'), box(0, 800, 420, 2800, 200, 380, 'fabric'), box(925, -425, 0, 950, 850, 420, 'fabric'), box(1300, -425, 420, 200, 850, 380, 'fabric')] }),
  A({ id: 'armchair', name: 'Lounge armchair', category: 'living', size: { w: 850, d: 850, h: 780 }, tags: ['chair', 'seating'], price: 38000,
    parts: [box(0, 0, 0, 850, 850, 420, 'fabric'), box(0, 330, 420, 850, 190, 360, 'fabric'), box(-370, 0, 420, 110, 850, 180, 'fabric'), box(370, 0, 420, 110, 850, 180, 'fabric')] }),
  A({ id: 'coffee-table', name: 'Coffee table', category: 'living', size: { w: 1200, d: 650, h: 400 }, tags: ['table'], price: 28000,
    parts: [box(0, 0, 360, 1200, 650, 40, 'wood'), box(-520, -250, 0, 60, 60, 360, 'metal'), box(520, -250, 0, 60, 60, 360, 'metal'), box(-520, 250, 0, 60, 60, 360, 'metal'), box(520, 250, 0, 60, 60, 360, 'metal')] }),
  A({ id: 'tv-unit', name: 'Media console', category: 'living', size: { w: 2000, d: 450, h: 1300 }, tags: ['tv', 'media', 'console'], price: 55000, glyph: 'tv',
    parts: [box(0, 0, 150, 2000, 450, 400, 'wood'), box(0, 160, 850, 1400, 60, 800, 'dark')] }),
  A({ id: 'rug', name: 'Area rug', category: 'living', size: { w: 2400, d: 1700, h: 10 }, tags: ['rug', 'carpet'], price: 32000,
    parts: [box(0, 0, 0, 2400, 1700, 10, 'accent')] }),
  A({ id: 'bookshelf', name: 'Bookshelf', category: 'living', size: { w: 1200, d: 350, h: 2100 }, tags: ['shelf', 'storage'], price: 36000,
    parts: [box(0, 0, 0, 1200, 350, 2100, 'wood')] }),
  A({ id: 'plant-indoor', name: 'Indoor plant', category: 'living', size: { w: 500, d: 500, h: 1400 }, tags: ['plant'], price: 6000,
    parts: [cyl(0, 0, 0, 200, 400, 'stone'), sph(0, 0, 500, 350, 'leaf')] }),
  // Bedroom
  A({ id: 'bed-king', name: 'King bed', category: 'bedroom', size: { w: 1950, d: 2200, h: 1100 }, tags: ['bed', 'king'], price: 120000, glyph: 'pillows',
    parts: [box(0, 0, 0, 1950, 2150, 300, 'wood'), box(0, -50, 300, 1830, 2000, 250, 'white'), box(0, 1050, 0, 1950, 100, 1100, 'fabric'), box(-450, 800, 550, 700, 350, 140, 'light'), box(450, 800, 550, 700, 350, 140, 'light'), box(0, -500, 550, 1850, 900, 40, 'accent')] }),
  A({ id: 'bed-queen', name: 'Queen bed', category: 'bedroom', size: { w: 1650, d: 2150, h: 1050 }, tags: ['bed', 'queen'], price: 85000, glyph: 'pillows',
    parts: [box(0, 0, 0, 1650, 2100, 300, 'wood'), box(0, -40, 300, 1530, 1950, 250, 'white'), box(0, 1025, 0, 1650, 100, 1050, 'fabric'), box(-380, 780, 550, 600, 330, 140, 'light'), box(380, 780, 550, 600, 330, 140, 'light'), box(0, -480, 550, 1550, 850, 40, 'accent')] }),
  A({ id: 'bed-single', name: 'Single bed', category: 'bedroom', size: { w: 1000, d: 2050, h: 900 }, tags: ['bed', 'single', 'kids'], price: 42000, glyph: 'pillows',
    parts: [box(0, 0, 0, 1000, 2000, 300, 'wood'), box(0, -30, 300, 920, 1900, 220, 'white'), box(0, 1000, 0, 1000, 80, 900, 'wood'), box(0, 760, 520, 650, 320, 120, 'light')] }),
  A({ id: 'wardrobe', name: 'Wardrobe', category: 'bedroom', size: { w: 1800, d: 600, h: 2400 }, tags: ['wardrobe', 'closet', 'storage'], price: 140000,
    parts: [box(0, 0, 0, 1800, 600, 2400, 'wood')] }),
  A({ id: 'side-table', name: 'Bedside table', category: 'bedroom', size: { w: 500, d: 420, h: 550 }, tags: ['nightstand', 'table'], price: 14000,
    parts: [box(0, 0, 0, 500, 420, 550, 'wood'), sph(0, 0, 650, 110, 'light')] }),
  A({ id: 'dresser', name: 'Dresser', category: 'bedroom', size: { w: 1200, d: 450, h: 800 }, tags: ['dresser', 'storage'], price: 46000,
    parts: [box(0, 0, 0, 1200, 450, 800, 'wood'), box(0, 200, 800, 700, 30, 900, 'glass')] }),
  // Dining
  A({ id: 'dining-6', name: 'Dining set (6)', category: 'dining', size: { w: 2700, d: 1900, h: 870 }, tags: ['dining', 'table', 'chairs'], price: 145000,
    parts: [box(0, 0, 720, 1800, 950, 40, 'wood'), box(-800, 0, 0, 80, 800, 720, 'wood'), box(800, 0, 0, 80, 800, 720, 'wood'), ...chairsAround(1800, 950, 6)] }),
  A({ id: 'dining-4', name: 'Dining set (4)', category: 'dining', size: { w: 1400, d: 1850, h: 870 }, tags: ['dining', 'table', 'chairs'], price: 78000,
    parts: [box(0, 0, 720, 1200, 850, 40, 'wood'), box(-500, 0, 0, 80, 700, 720, 'wood'), box(500, 0, 0, 80, 700, 720, 'wood'), ...chairsAround(1200, 850, 4)] }),
  // Kitchen
  A({ id: 'kitchen-run', name: 'Kitchen counter run', category: 'kitchen', size: { w: 3000, d: 600, h: 900 }, tags: ['counter', 'cabinet', 'kitchen'], price: 260000, glyph: 'hob',
    parts: [box(0, 0, 0, 3000, 600, 860, 'wood'), box(0, 0, 860, 3000, 620, 40, 'stone'), box(0, 175, 1450, 3000, 350, 700, 'wood', true)] }),
  A({ id: 'kitchen-sink', name: 'Sink counter', category: 'kitchen', size: { w: 1800, d: 600, h: 900 }, tags: ['sink', 'counter', 'kitchen'], price: 120000, glyph: 'sink',
    parts: [box(0, 0, 0, 1800, 600, 860, 'wood'), box(0, 0, 860, 1800, 620, 40, 'stone')] }),
  A({ id: 'island', name: 'Kitchen island', category: 'kitchen', size: { w: 2000, d: 1000, h: 900 }, tags: ['island', 'kitchen'], price: 190000,
    parts: [box(0, 0, 0, 1800, 900, 860, 'wood'), box(0, 0, 860, 2000, 1000, 40, 'stone')] }),
  A({ id: 'fridge', name: 'Refrigerator', category: 'kitchen', size: { w: 900, d: 720, h: 1850 }, tags: ['fridge', 'appliance'], price: 140000,
    parts: [box(0, 0, 0, 900, 720, 1850, 'metal')] }),
  // Bathroom
  A({ id: 'wc', name: 'Wall-hung WC', category: 'bathroom', size: { w: 380, d: 560, h: 800 }, tags: ['toilet', 'wc'], price: 32000, glyph: 'wc',
    parts: [box(0, -20, 250, 360, 520, 160, 'white'), box(0, 230, 0, 380, 100, 800, 'white')] }),
  A({ id: 'vanity', name: 'Vanity with basin', category: 'bathroom', size: { w: 900, d: 500, h: 850 }, tags: ['basin', 'vanity', 'sink'], price: 42000, glyph: 'basin',
    parts: [box(0, 0, 300, 900, 500, 500, 'wood'), box(0, 0, 800, 900, 500, 50, 'stone'), box(0, 240, 950, 700, 20, 800, 'glass')] }),
  A({ id: 'shower', name: 'Walk-in shower', category: 'bathroom', size: { w: 1000, d: 1000, h: 2100 }, tags: ['shower'], price: 65000, glyph: 'shower',
    parts: [box(0, 0, 0, 1000, 1000, 20, 'stone'), box(0, -490, 0, 1000, 12, 2000, 'glass')] }),
  A({ id: 'bathtub', name: 'Freestanding bathtub', category: 'bathroom', size: { w: 1700, d: 800, h: 600 }, tags: ['bath', 'tub'], price: 160000, glyph: 'bath',
    parts: [box(0, 0, 0, 1700, 800, 600, 'white')] }),
  // Lighting
  A({ id: 'pendant', name: 'Pendant light', category: 'lighting', size: { w: 450, d: 450, h: 400 }, tags: ['light', 'pendant'], price: 18000, glyph: 'light',
    parts: [sph(0, 0, 2100, 220, 'light', true)] }),
  A({ id: 'chandelier', name: 'Chandelier', category: 'lighting', size: { w: 900, d: 900, h: 700 }, tags: ['light', 'chandelier'], price: 95000, glyph: 'light',
    parts: [sph(0, 0, 2200, 420, 'light', true)] }),
  A({ id: 'floor-lamp', name: 'Floor lamp', category: 'lighting', size: { w: 400, d: 400, h: 1650 }, tags: ['light', 'lamp'], price: 16000, glyph: 'light',
    parts: [cyl(0, 0, 0, 20, 1450, 'metal'), cyl(0, 0, 1450, 180, 250, 'light')] }),
  A({ id: 'bollard', name: 'Garden bollard', category: 'lighting', size: { w: 200, d: 200, h: 700 }, tags: ['light', 'outdoor'], price: 7500, glyph: 'light',
    parts: [cyl(0, 0, 0, 90, 700, 'dark')] }),
  // Study / pooja / utility
  A({ id: 'desk', name: 'Work desk', category: 'study', size: { w: 1500, d: 700, h: 750 }, tags: ['desk', 'study', 'office'], price: 38000,
    parts: [box(0, 0, 720, 1500, 700, 30, 'wood'), box(-700, 0, 0, 50, 650, 720, 'metal'), box(700, 0, 0, 50, 650, 720, 'metal'), box(0, -560, 0, 520, 520, 480, 'fabric'), box(0, -800, 480, 480, 60, 500, 'fabric')] }),
  A({ id: 'mandir', name: 'Pooja unit', category: 'pooja', size: { w: 900, d: 450, h: 1800 }, tags: ['pooja', 'mandir', 'temple'], price: 85000,
    parts: [box(0, 0, 0, 900, 450, 900, 'wood'), box(0, 100, 900, 900, 250, 900, 'wood'), box(0, 0, 900, 700, 300, 20, 'light')] }),
  A({ id: 'washer', name: 'Washer-dryer', category: 'utility', size: { w: 600, d: 600, h: 850 }, tags: ['washing machine', 'laundry'], price: 52000,
    parts: [box(0, 0, 0, 600, 600, 850, 'white')] }),
  // Exterior
  A({ id: 'car-sedan', name: 'Sedan', category: 'exterior', size: { w: 1850, d: 4700, h: 1450 }, tags: ['car', 'parking', 'vehicle'], price: 0, glyph: 'car',
    variants: [{ id: 'silver', name: 'Silver', colors: { body: '#b9bcc0' } }, { id: 'black', name: 'Black', colors: { body: '#2a2b2d' } }, { id: 'white', name: 'White', colors: { body: '#eeeeec' } }],
    parts: [box(0, 0, 300, 1850, 4700, 700, 'body'), box(0, 250, 1000, 1600, 2400, 450, 'glass'), cyl(-820, -1450, 0, 330, 250, 'dark'), cyl(820, -1450, 0, 330, 250, 'dark'), cyl(-820, 1450, 0, 330, 250, 'dark'), cyl(820, 1450, 0, 330, 250, 'dark')] }),
  A({ id: 'car-suv', name: 'SUV', category: 'exterior', size: { w: 1950, d: 4800, h: 1750 }, tags: ['car', 'parking', 'vehicle'], price: 0, glyph: 'car',
    variants: [{ id: 'white', name: 'White', colors: { body: '#eeeeec' } }, { id: 'grey', name: 'Graphite', colors: { body: '#55585c' } }, { id: 'blue', name: 'Navy', colors: { body: '#2c3e57' } }],
    parts: [box(0, 0, 350, 1950, 4800, 850, 'body'), box(0, 150, 1200, 1750, 2900, 550, 'glass'), cyl(-860, -1500, 0, 370, 280, 'dark'), cyl(860, -1500, 0, 370, 280, 'dark'), cyl(-860, 1500, 0, 370, 280, 'dark'), cyl(860, 1500, 0, 370, 280, 'dark')] }),
  A({ id: 'tree', name: 'Shade tree', category: 'exterior', size: { w: 4500, d: 4500, h: 7000 }, tags: ['tree', 'landscape', 'neem', 'mango'], price: 12000, glyph: 'tree',
    variants: [{ id: 'green', name: 'Summer', colors: { leaf: '#6f8f4e' } }, { id: 'flower', name: 'Flowering', colors: { leaf: '#b5728a' } }],
    parts: [cyl(0, 0, 0, 180, 3200, 'trunk'), sph(0, 0, 2800, 2250, 'leaf', true)] }),
  A({ id: 'palm', name: 'Palm tree', category: 'exterior', size: { w: 3000, d: 3000, h: 7500 }, tags: ['tree', 'palm', 'tropical'], price: 15000, glyph: 'tree',
    variants: [{ id: 'green', name: 'Green', colors: { leaf: '#5f8a45' } }],
    parts: [cyl(0, 0, 0, 160, 6500, 'trunk'), sph(0, 0, 6000, 1500, 'leaf', true)] }),
  A({ id: 'shrub', name: 'Shrub', category: 'exterior', size: { w: 1200, d: 1200, h: 1000 }, tags: ['plant', 'shrub', 'landscape'], price: 2500, glyph: 'tree',
    variants: [{ id: 'green', name: 'Green', colors: { leaf: '#77965a' } }],
    parts: [sph(0, 0, 0, 600, 'leaf')] }),
  A({ id: 'lounger', name: 'Sun lounger', category: 'exterior', size: { w: 700, d: 2000, h: 400 }, tags: ['pool', 'lounger', 'outdoor'], price: 26000,
    parts: [box(0, 0, 0, 700, 2000, 300, 'wood'), box(0, 750, 300, 700, 500, 350, 'fabric')] }),
  A({ id: 'outdoor-dining', name: 'Outdoor dining', category: 'exterior', size: { w: 2200, d: 1850, h: 870 }, tags: ['outdoor', 'dining'], price: 70000,
    parts: [box(0, 0, 720, 1600, 900, 40, 'wood'), box(0, 0, 0, 100, 100, 720, 'metal'), ...chairsAround(1600, 900, 4)] }),
];

export const ASSET_BY_ID: Record<string, Asset> = Object.fromEntries(ASSETS.map((a) => [a.id, a]));

export const ASSET_CATEGORIES: { id: AssetCategory; label: string }[] = [
  { id: 'living', label: 'Living' }, { id: 'bedroom', label: 'Bedroom' }, { id: 'dining', label: 'Dining' },
  { id: 'kitchen', label: 'Kitchen' }, { id: 'bathroom', label: 'Bathroom' }, { id: 'lighting', label: 'Lighting' },
  { id: 'study', label: 'Study' }, { id: 'pooja', label: 'Pooja' }, { id: 'utility', label: 'Utility' }, { id: 'exterior', label: 'Exterior' },
];

export const DEFAULT_SLOT_COLORS: Record<PartSlot, string> = {
  body: '#c9c6bf', accent: '#a58f74', fabric: '#d8cfc0', wood: '#b98d5f', metal: '#8f9396', glass: '#a9c6d4',
  white: '#f5f4f1', leaf: '#6f8f4e', trunk: '#6d5440', dark: '#2f2f30', light: '#f7f1e3', stone: '#d8d3cb', water: '#5fb4c9',
};

export function assetColors(asset: Asset, variantId?: string): Record<PartSlot, string> {
  const v = asset.variants.find((x) => x.id === variantId) ?? asset.variants[0];
  return { ...DEFAULT_SLOT_COLORS, ...(v?.colors ?? {}) };
}
