/**
 * Material catalogue.
 *
 * Rates are indicative 2026 Indian metro rates (INR, material + typical labour
 * split given separately) and are only defaults: every rate can be overridden
 * per project in Cost settings, and the source label travels with every estimate.
 */

export type MaterialCategory =
  | 'wood' | 'stone' | 'marble' | 'concrete' | 'brick' | 'tile' | 'metal' | 'glass' | 'fabric'
  | 'paint' | 'plaster' | 'wallpaper' | 'roofing' | 'landscape' | 'water';

export type MaterialPattern = 'none' | 'wood' | 'tile' | 'brick' | 'stone' | 'marble' | 'grass' | 'water' | 'concrete' | 'tiles-roof' | 'plank';

export type CostUnit = 'm2' | 'm3' | 'nos' | 'rm';

export interface Material {
  id: string;
  name: string;
  category: MaterialCategory;
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
  pattern: MaterialPattern;
  /** Pattern repeat in mm. */
  patternScale: number;
  /** Indicative supply rate in INR per costUnit. */
  rate: number;
  /** Labour rate in INR per costUnit. */
  labour: number;
  costUnit: CostUnit;
  durability: 1 | 2 | 3 | 4 | 5;
  /** Where the material is typically used — drives the picker and alternatives. */
  slots: ('floor' | 'wall' | 'exterior' | 'core' | 'roof' | 'frame' | 'door' | 'ceiling' | 'site' | 'furniture')[];
  description: string;
}

const M = (m: Material) => m;

export const MATERIALS: Material[] = [
  // Cores
  M({ id: 'brick', name: 'Fly-ash brick masonry', category: 'brick', color: '#b5654a', roughness: 0.9, metalness: 0, pattern: 'brick', patternScale: 230, rate: 5600, labour: 1900, costUnit: 'm3', durability: 4, slots: ['core'], description: 'Load-bearing or infill masonry, 230 mm / 115 mm.' }),
  M({ id: 'aac-block', name: 'AAC block', category: 'concrete', color: '#d9d6cf', roughness: 0.95, metalness: 0, pattern: 'none', patternScale: 600, rate: 4800, labour: 1500, costUnit: 'm3', durability: 4, slots: ['core'], description: 'Lightweight autoclaved aerated concrete blocks — better thermal performance.' }),
  M({ id: 'rcc', name: 'Reinforced concrete (M25)', category: 'concrete', color: '#a7a6a2', roughness: 0.85, metalness: 0, pattern: 'concrete', patternScale: 1200, rate: 9500, labour: 3500, costUnit: 'm3', durability: 5, slots: ['core'], description: 'Structural concrete for slabs, beams and columns (conceptual).' }),
  // Finishes — walls
  M({ id: 'plaster-white', name: 'Plaster + white emulsion', category: 'paint', color: '#f2f0eb', roughness: 0.9, metalness: 0, pattern: 'none', patternScale: 1000, rate: 120, labour: 160, costUnit: 'm2', durability: 3, slots: ['wall', 'ceiling', 'exterior'], description: 'Gypsum/cement plaster with two coats of emulsion.' }),
  M({ id: 'paint-warm', name: 'Warm white emulsion', category: 'paint', color: '#f1ebe0', roughness: 0.9, metalness: 0, pattern: 'none', patternScale: 1000, rate: 130, labour: 160, costUnit: 'm2', durability: 3, slots: ['wall', 'ceiling'], description: 'Soft warm white interior paint.' }),
  M({ id: 'paint-sage', name: 'Sage emulsion', category: 'paint', color: '#c9cfbd', roughness: 0.9, metalness: 0, pattern: 'none', patternScale: 1000, rate: 150, labour: 160, costUnit: 'm2', durability: 3, slots: ['wall'], description: 'Muted sage accent paint.' }),
  M({ id: 'ext-texture', name: 'Exterior texture paint', category: 'paint', color: '#ece8df', roughness: 0.95, metalness: 0, pattern: 'none', patternScale: 1000, rate: 210, labour: 190, costUnit: 'm2', durability: 3, slots: ['exterior'], description: 'Weather-resistant acrylic texture finish.' }),
  M({ id: 'ext-terracotta', name: 'Terracotta lime render', category: 'plaster', color: '#d49a74', roughness: 0.95, metalness: 0, pattern: 'none', patternScale: 1000, rate: 340, labour: 260, costUnit: 'm2', durability: 3, slots: ['exterior', 'wall'], description: 'Warm Mediterranean lime render.' }),
  M({ id: 'exposed-brick', name: 'Exposed brick', category: 'brick', color: '#a85a3f', roughness: 0.9, metalness: 0, pattern: 'brick', patternScale: 230, rate: 950, labour: 420, costUnit: 'm2', durability: 5, slots: ['exterior', 'wall'], description: 'Wire-cut facing bricks with recessed joints.' }),
  M({ id: 'stone-cladding', name: 'Natural stone cladding', category: 'stone', color: '#9c9285', roughness: 0.85, metalness: 0, pattern: 'stone', patternScale: 600, rate: 2400, labour: 650, costUnit: 'm2', durability: 5, slots: ['exterior', 'wall'], description: 'Split-face sandstone / basalt cladding.' }),
  M({ id: 'concrete-board', name: 'Board-formed concrete', category: 'concrete', color: '#b9b7b1', roughness: 0.8, metalness: 0, pattern: 'plank', patternScale: 150, rate: 1600, labour: 700, costUnit: 'm2', durability: 5, slots: ['exterior', 'wall'], description: 'Exposed concrete with timber board texture.' }),
  M({ id: 'wood-cladding', name: 'Thermowood cladding', category: 'wood', color: '#8a5f3d', roughness: 0.7, metalness: 0, pattern: 'plank', patternScale: 140, rate: 3800, labour: 700, costUnit: 'm2', durability: 3, slots: ['exterior', 'wall'], description: 'Heat-treated timber rainscreen.' }),
  M({ id: 'wallpaper-linen', name: 'Linen wallpaper', category: 'wallpaper', color: '#e3dccd', roughness: 0.95, metalness: 0, pattern: 'none', patternScale: 1000, rate: 900, labour: 180, costUnit: 'm2', durability: 2, slots: ['wall'], description: 'Textured linen-look wallcovering.' }),
  M({ id: 'wall-tile', name: 'Ceramic wall tile', category: 'tile', color: '#e8e6e1', roughness: 0.3, metalness: 0, pattern: 'tile', patternScale: 300, rate: 780, labour: 380, costUnit: 'm2', durability: 4, slots: ['wall'], description: 'Glazed wall tiles for wet areas.' }),
  // Floors
  M({ id: 'italian-marble', name: 'Italian marble (Statuario)', category: 'marble', color: '#efece6', roughness: 0.18, metalness: 0, pattern: 'marble', patternScale: 1200, rate: 9500, labour: 900, costUnit: 'm2', durability: 4, slots: ['floor', 'wall'], description: 'Imported white marble with grey veining.' }),
  M({ id: 'indian-marble', name: 'Premium Indian marble', category: 'marble', color: '#ebe7df', roughness: 0.22, metalness: 0, pattern: 'marble', patternScale: 1200, rate: 3600, labour: 900, costUnit: 'm2', durability: 4, slots: ['floor', 'wall'], description: 'Makrana / Ambaji white marble.' }),
  M({ id: 'vitrified', name: 'Vitrified tile 800×800', category: 'tile', color: '#e4e1db', roughness: 0.25, metalness: 0, pattern: 'tile', patternScale: 800, rate: 1150, labour: 420, costUnit: 'm2', durability: 4, slots: ['floor'], description: 'Large-format polished vitrified tile.' }),
  M({ id: 'oak', name: 'Engineered oak', category: 'wood', color: '#b98d5f', roughness: 0.55, metalness: 0, pattern: 'wood', patternScale: 190, rate: 5200, labour: 650, costUnit: 'm2', durability: 3, slots: ['floor', 'furniture', 'door'], description: 'Engineered oak planks, matte lacquer.' }),
  M({ id: 'teak', name: 'Teak wood', category: 'wood', color: '#8b5a33', roughness: 0.5, metalness: 0, pattern: 'wood', patternScale: 160, rate: 7800, labour: 900, costUnit: 'm2', durability: 5, slots: ['floor', 'door', 'frame', 'furniture'], description: 'Solid teak — doors, frames and accent floors.' }),
  M({ id: 'laminate', name: 'Laminate wood floor', category: 'wood', color: '#a98058', roughness: 0.5, metalness: 0, pattern: 'wood', patternScale: 190, rate: 1500, labour: 300, costUnit: 'm2', durability: 2, slots: ['floor'], description: 'Budget wood-look laminate.' }),
  M({ id: 'anti-skid', name: 'Anti-skid ceramic', category: 'tile', color: '#cfcac1', roughness: 0.8, metalness: 0, pattern: 'tile', patternScale: 300, rate: 700, labour: 380, costUnit: 'm2', durability: 4, slots: ['floor'], description: 'Matte anti-skid tile for bathrooms and utility.' }),
  M({ id: 'kota', name: 'Kota stone', category: 'stone', color: '#8e9a8c', roughness: 0.6, metalness: 0, pattern: 'tile', patternScale: 600, rate: 1100, labour: 450, costUnit: 'm2', durability: 5, slots: ['floor', 'site'], description: 'Durable natural limestone, polished.' }),
  M({ id: 'terrazzo', name: 'Terrazzo', category: 'stone', color: '#ddd6cb', roughness: 0.35, metalness: 0, pattern: 'stone', patternScale: 400, rate: 2600, labour: 900, costUnit: 'm2', durability: 5, slots: ['floor'], description: 'Cast-in-situ terrazzo with marble chips.' }),
  M({ id: 'granite', name: 'Granite', category: 'stone', color: '#4a4744', roughness: 0.2, metalness: 0, pattern: 'stone', patternScale: 600, rate: 3200, labour: 800, costUnit: 'm2', durability: 5, slots: ['floor', 'furniture'], description: 'Black granite — counters and thresholds.' }),
  M({ id: 'terracotta-tile', name: 'Terracotta floor tile', category: 'tile', color: '#c0714e', roughness: 0.8, metalness: 0, pattern: 'tile', patternScale: 300, rate: 950, labour: 420, costUnit: 'm2', durability: 3, slots: ['floor', 'site'], description: 'Handmade terracotta tiles.' }),
  M({ id: 'polished-concrete', name: 'Polished concrete', category: 'concrete', color: '#b4b1aa', roughness: 0.4, metalness: 0, pattern: 'concrete', patternScale: 1500, rate: 1200, labour: 650, costUnit: 'm2', durability: 4, slots: ['floor'], description: 'Ground and sealed concrete topping.' }),
  // Ceiling
  M({ id: 'gypsum-ceiling', name: 'Gypsum false ceiling', category: 'plaster', color: '#f6f5f2', roughness: 0.95, metalness: 0, pattern: 'none', patternScale: 1000, rate: 650, labour: 250, costUnit: 'm2', durability: 3, slots: ['ceiling'], description: 'Gypsum board ceiling on GI framing.' }),
  // Frames / glass / metal
  M({ id: 'alu-black', name: 'Black aluminium', category: 'metal', color: '#2b2b2b', roughness: 0.4, metalness: 0.6, pattern: 'none', patternScale: 1000, rate: 1400, labour: 0, costUnit: 'm2', durability: 4, slots: ['frame'], description: 'Powder-coated aluminium frames.' }),
  M({ id: 'upvc-white', name: 'White uPVC', category: 'metal', color: '#f4f4f2', roughness: 0.5, metalness: 0, pattern: 'none', patternScale: 1000, rate: 950, labour: 0, costUnit: 'm2', durability: 3, slots: ['frame'], description: 'uPVC frames with steel reinforcement.' }),
  M({ id: 'glass', name: 'Clear glazing', category: 'glass', color: '#9fc3d6', roughness: 0.05, metalness: 0.1, opacity: 0.35, pattern: 'none', patternScale: 1000, rate: 2600, labour: 450, costUnit: 'm2', durability: 4, slots: ['frame'], description: 'Double-glazed clear units.' }),
  M({ id: 'steel', name: 'Brushed steel', category: 'metal', color: '#9ea2a6', roughness: 0.35, metalness: 0.8, pattern: 'none', patternScale: 1000, rate: 900, labour: 0, costUnit: 'm2', durability: 5, slots: ['furniture', 'frame'], description: 'Stainless steel finish.' }),
  // Roofing
  M({ id: 'roof-membrane', name: 'Waterproofed terrace', category: 'roofing', color: '#c7c3bb', roughness: 0.9, metalness: 0, pattern: 'none', patternScale: 1000, rate: 900, labour: 300, costUnit: 'm2', durability: 3, slots: ['roof'], description: 'APP membrane with screed and terrace tiles.' }),
  M({ id: 'clay-tile', name: 'Clay roof tiles', category: 'roofing', color: '#a4523a', roughness: 0.8, metalness: 0, pattern: 'tiles-roof', patternScale: 300, rate: 1500, labour: 450, costUnit: 'm2', durability: 4, slots: ['roof'], description: 'Mangalore / Spanish clay tiles.' }),
  M({ id: 'slate-tile', name: 'Slate shingles', category: 'roofing', color: '#4f5459', roughness: 0.7, metalness: 0, pattern: 'tiles-roof', patternScale: 300, rate: 2200, labour: 500, costUnit: 'm2', durability: 5, slots: ['roof'], description: 'Natural slate shingles.' }),
  M({ id: 'metal-roof', name: 'Standing-seam metal', category: 'roofing', color: '#5d6166', roughness: 0.45, metalness: 0.6, pattern: 'plank', patternScale: 400, rate: 1900, labour: 350, costUnit: 'm2', durability: 4, slots: ['roof'], description: 'Zinc-aluminium standing seam roofing.' }),
  // Fabric
  M({ id: 'linen', name: 'Linen fabric', category: 'fabric', color: '#d8cfc0', roughness: 1, metalness: 0, pattern: 'none', patternScale: 1000, rate: 0, labour: 0, costUnit: 'nos', durability: 3, slots: ['furniture'], description: 'Natural linen upholstery.' }),
  M({ id: 'velvet-olive', name: 'Olive velvet', category: 'fabric', color: '#6f7350', roughness: 1, metalness: 0, pattern: 'none', patternScale: 1000, rate: 0, labour: 0, costUnit: 'nos', durability: 3, slots: ['furniture'], description: 'Deep olive velvet upholstery.' }),
  M({ id: 'leather-tan', name: 'Tan leather', category: 'fabric', color: '#a0663f', roughness: 0.6, metalness: 0, pattern: 'none', patternScale: 1000, rate: 0, labour: 0, costUnit: 'nos', durability: 4, slots: ['furniture'], description: 'Aniline tan leather.' }),
  // Site / landscape
  M({ id: 'lawn', name: 'Lawn', category: 'landscape', color: '#8fae6b', roughness: 1, metalness: 0, pattern: 'grass', patternScale: 1000, rate: 250, labour: 80, costUnit: 'm2', durability: 2, slots: ['site'], description: 'Bermuda / Mexican grass lawn.' }),
  M({ id: 'paver', name: 'Concrete pavers', category: 'concrete', color: '#b8b2a7', roughness: 0.9, metalness: 0, pattern: 'tile', patternScale: 300, rate: 900, labour: 250, costUnit: 'm2', durability: 4, slots: ['site'], description: 'Interlocking paver blocks.' }),
  M({ id: 'deck-wood', name: 'Hardwood deck', category: 'wood', color: '#9b6b44', roughness: 0.7, metalness: 0, pattern: 'plank', patternScale: 140, rate: 4800, labour: 700, costUnit: 'm2', durability: 3, slots: ['site', 'floor'], description: 'Outdoor IPE / teak decking.' }),
  M({ id: 'pool-tile', name: 'Pool mosaic', category: 'tile', color: '#8fc9d6', roughness: 0.3, metalness: 0, pattern: 'tile', patternScale: 50, rate: 0, labour: 0, costUnit: 'm2', durability: 4, slots: [], description: 'Glass mosaic pool lining (costed with pool water area).' }),
  M({ id: 'asphalt', name: 'Asphalt road', category: 'concrete', color: '#5b5d60', roughness: 0.95, metalness: 0, pattern: 'none', patternScale: 1000, rate: 0, labour: 0, costUnit: 'm2', durability: 4, slots: [], description: 'Public road (context only).' }),
  M({ id: 'ground', name: 'Surrounding ground', category: 'landscape', color: '#cfc8b8', roughness: 1, metalness: 0, pattern: 'none', patternScale: 1000, rate: 0, labour: 0, costUnit: 'm2', durability: 1, slots: [], description: 'Context ground outside the plot.' }),
  M({ id: 'pool-water', name: 'Pool water', category: 'water', color: '#5fb4c9', roughness: 0.05, metalness: 0.1, opacity: 0.8, pattern: 'water', patternScale: 1000, rate: 26000, labour: 9000, costUnit: 'm2', durability: 4, slots: ['site'], description: 'Pool shell, tiling and filtration (per m² of water).' }),
];

export const MATERIAL_BY_ID: Record<string, Material> = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

export function getMaterial(id: string | undefined): Material {
  return (id && MATERIAL_BY_ID[id]) || MATERIAL_BY_ID['plaster-white'];
}

/** Alternatives in the same slot, ranked by price difference. */
export function materialAlternatives(id: string, slot: Material['slots'][number]): Material[] {
  const cur = getMaterial(id);
  return MATERIALS.filter((m) => m.id !== id && m.slots.includes(slot) && m.costUnit === cur.costUnit && m.category !== 'water')
    .sort((a, b) => Math.abs(a.rate - cur.rate) - Math.abs(b.rate - cur.rate));
}
