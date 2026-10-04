/**
 * Design styles as *controlled transformations* of the model: a style is a set
 * of material, element-type and furniture-variant mappings. Applying a style
 * produces structured operations (see ops/style.ts) — never a generated image.
 */
import type { DoorKind, RoofKind, RoomFunction, StyleId, WindowKind } from '../model/types';

export interface StyleDef {
  id: StyleId;
  name: string;
  summary: string;
  palette: string[];
  exterior: string;
  exteriorAccent: string;
  interiorWall: string;
  floors: Partial<Record<RoomFunction, string>> & { default: string; wet: string };
  roof: { kind: RoofKind; material: string; pitch: number; overhang: number };
  windowKind: WindowKind;
  windowFrame: string;
  /** Window-to-wall ambition: multiplier on default window widths. */
  glazingFactor: number;
  doorMaterial: string;
  mainDoorKind: DoorKind;
  furnitureVariant: string;
  trees: string[];
}

export const STYLES: StyleDef[] = [
  {
    id: 'modern', name: 'Modern', summary: 'Flat roofs, large glazing, white render with timber and stone accents.',
    palette: ['#ece8df', '#2b2b2b', '#b98d5f', '#9c9285'],
    exterior: 'ext-texture', exteriorAccent: 'wood-cladding', interiorWall: 'plaster-white',
    floors: { default: 'vitrified', wet: 'anti-skid', living: 'italian-marble', dining: 'italian-marble', foyer: 'italian-marble', master_bedroom: 'oak', bedroom: 'oak', deck: 'deck-wood' },
    roof: { kind: 'flat', material: 'roof-membrane', pitch: 0, overhang: 300 },
    windowKind: 'sliding', windowFrame: 'alu-black', glazingFactor: 1.25, doorMaterial: 'oak', mainDoorKind: 'pivot', furnitureVariant: 'charcoal', trees: ['tree', 'shrub'],
  },
  {
    id: 'contemporary', name: 'Contemporary', summary: 'Soft minimal volumes, warm whites, board-formed concrete and oak.',
    palette: ['#f1ebe0', '#b9b7b1', '#b98d5f', '#5d6166'],
    exterior: 'ext-texture', exteriorAccent: 'concrete-board', interiorWall: 'paint-warm',
    floors: { default: 'vitrified', wet: 'anti-skid', living: 'terrazzo', dining: 'terrazzo', master_bedroom: 'oak', bedroom: 'oak', deck: 'deck-wood' },
    roof: { kind: 'flat', material: 'roof-membrane', pitch: 0, overhang: 450 },
    windowKind: 'casement', windowFrame: 'alu-black', glazingFactor: 1.15, doorMaterial: 'oak', mainDoorKind: 'pivot', furnitureVariant: 'ivory', trees: ['tree', 'shrub'],
  },
  {
    id: 'minimal', name: 'Minimal', summary: 'Pure white surfaces, concealed frames, polished concrete floors.',
    palette: ['#f4f4f2', '#b4b1aa', '#2b2b2b', '#e3dccd'],
    exterior: 'plaster-white', exteriorAccent: 'plaster-white', interiorWall: 'plaster-white',
    floors: { default: 'polished-concrete', wet: 'anti-skid', master_bedroom: 'oak', bedroom: 'oak' },
    roof: { kind: 'flat', material: 'roof-membrane', pitch: 0, overhang: 0 },
    windowKind: 'fixed', windowFrame: 'alu-black', glazingFactor: 1.3, doorMaterial: 'oak', mainDoorKind: 'pivot', furnitureVariant: 'ivory', trees: ['shrub'],
  },
  {
    id: 'traditional', name: 'Traditional', summary: 'Pitched clay-tile roofs, teak joinery, kota and terracotta floors.',
    palette: ['#d49a74', '#8b5a33', '#a4523a', '#8e9a8c'],
    exterior: 'ext-terracotta', exteriorAccent: 'exposed-brick', interiorWall: 'paint-warm',
    floors: { default: 'kota', wet: 'anti-skid', living: 'kota', master_bedroom: 'teak', bedroom: 'terracotta-tile', pooja: 'indian-marble', deck: 'terracotta-tile' },
    roof: { kind: 'hip', material: 'clay-tile', pitch: 26, overhang: 750 },
    windowKind: 'casement', windowFrame: 'teak', glazingFactor: 0.9, doorMaterial: 'teak', mainDoorKind: 'double', furnitureVariant: 'natural', trees: ['tree', 'palm'],
  },
  {
    id: 'mediterranean', name: 'Mediterranean', summary: 'Terracotta render, clay-tile roofs, arched warmth and stone floors.',
    palette: ['#d49a74', '#efe9de', '#a4523a', '#6f7350'],
    exterior: 'ext-terracotta', exteriorAccent: 'stone-cladding', interiorWall: 'paint-warm',
    floors: { default: 'terracotta-tile', wet: 'anti-skid', living: 'terracotta-tile', master_bedroom: 'oak', bedroom: 'oak', deck: 'terracotta-tile' },
    roof: { kind: 'hip', material: 'clay-tile', pitch: 22, overhang: 600 },
    windowKind: 'casement', windowFrame: 'upvc-white', glazingFactor: 0.95, doorMaterial: 'teak', mainDoorKind: 'french', furnitureVariant: 'olive', trees: ['palm', 'shrub'],
  },
  {
    id: 'tropical', name: 'Tropical', summary: 'Deep overhangs, timber screens, stone and lush planting.',
    palette: ['#8a5f3d', '#9c9285', '#6f8f4e', '#ece8df'],
    exterior: 'ext-texture', exteriorAccent: 'wood-cladding', interiorWall: 'paint-warm',
    floors: { default: 'kota', wet: 'anti-skid', living: 'indian-marble', master_bedroom: 'teak', bedroom: 'oak', deck: 'deck-wood' },
    roof: { kind: 'gable', material: 'metal-roof', pitch: 18, overhang: 1000 },
    windowKind: 'louvre', windowFrame: 'teak', glazingFactor: 1.1, doorMaterial: 'teak', mainDoorKind: 'pivot', furnitureVariant: 'natural', trees: ['palm', 'tree', 'shrub'],
  },
  {
    id: 'industrial', name: 'Industrial', summary: 'Exposed brick and concrete, black steel, polished concrete.',
    palette: ['#a85a3f', '#2b2b2b', '#b4b1aa', '#5d6166'],
    exterior: 'exposed-brick', exteriorAccent: 'concrete-board', interiorWall: 'exposed-brick',
    floors: { default: 'polished-concrete', wet: 'anti-skid', master_bedroom: 'oak', bedroom: 'laminate' },
    roof: { kind: 'shed', material: 'metal-roof', pitch: 10, overhang: 300 },
    windowKind: 'fixed', windowFrame: 'alu-black', glazingFactor: 1.2, doorMaterial: 'steel', mainDoorKind: 'pivot', furnitureVariant: 'charcoal', trees: ['shrub'],
  },
  {
    id: 'luxury', name: 'Luxury', summary: 'Statuario marble, stone cladding, bronze-black frames and teak.',
    palette: ['#efece6', '#9c9285', '#2b2b2b', '#8b5a33'],
    exterior: 'stone-cladding', exteriorAccent: 'wood-cladding', interiorWall: 'wallpaper-linen',
    floors: { default: 'italian-marble', wet: 'italian-marble', master_bedroom: 'teak', bedroom: 'oak', deck: 'deck-wood' },
    roof: { kind: 'flat', material: 'roof-membrane', pitch: 0, overhang: 600 },
    windowKind: 'sliding', windowFrame: 'alu-black', glazingFactor: 1.35, doorMaterial: 'teak', mainDoorKind: 'pivot', furnitureVariant: 'olive', trees: ['palm', 'tree'],
  },
];

export const STYLE_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s])) as Record<StyleId, StyleDef>;

const WET: RoomFunction[] = ['bathroom', 'powder', 'utility'];

export function floorFor(style: StyleDef, fn: RoomFunction): string {
  if (style.floors[fn]) return style.floors[fn]!;
  if (WET.includes(fn)) return style.floors.wet;
  if (fn === 'kitchen') return style.floors.kitchen ?? (style.id === 'luxury' ? 'italian-marble' : 'vitrified');
  return style.floors.default;
}

export function wallFinishFor(style: StyleDef, fn: RoomFunction): string {
  if (fn === 'bathroom' || fn === 'powder') return 'wall-tile';
  return style.interiorWall;
}
