/**
 * Regional rule framework.
 *
 * Nothing regulatory is hard-coded in the engine: every check reads a value from
 * a rule set, and projects can override any value. The bundled sets are
 * *starting points* modelled on common residential norms (NBC 2016 for India,
 * the IRC for the US) — they must be verified against the local authority's
 * current bye-laws before use for permits.
 */
import type { RoomFunction } from '../model/types';

export interface RoomStandard { minArea: number; minWidth: number; minGlazingRatio?: number }

export interface RuleSet {
  id: string;
  name: string;
  region: string;
  description: string;
  disclaimer: string;
  values: {
    frontSetback: number;
    rearSetback: number;
    sideSetback: number;
    maxCoverage: number;      // 0..1 of plot area
    maxFar: number;           // floor area ratio / FSI
    maxHeight: number;        // mm
    maxFloors: number;
    parkingPerUnit: number;   // car spaces
    stairMaxRiser: number;
    stairMinTread: number;
    stairMinWidth: number;
    minHeadroom: number;
    minDoorWidth: number;
    accessibleDoorWidth: number;
    minCeilingHeight: number;
    downpipeSpacing: number;  // max gutter length per downpipe (mm)
    maxKitchenDiningDistance: number;
  };
  rooms: Partial<Record<RoomFunction, RoomStandard>>;
}

const m2 = (v: number) => v * 1e6;

export const RULE_SETS: RuleSet[] = [
  {
    id: 'in-generic',
    name: 'India — residential (NBC-based)',
    region: 'India',
    description: 'Defaults based on the National Building Code of India 2016 (Part 3 & 4) for low-rise residential buildings.',
    disclaimer: 'Indicative defaults. Local development control regulations (e.g. UDCPR, DCPR, BBMP) override these — verify setbacks, FSI and height with the planning authority.',
    values: {
      frontSetback: 3000, rearSetback: 1500, sideSetback: 1500,
      maxCoverage: 0.6, maxFar: 1.75, maxHeight: 15000, maxFloors: 4, parkingPerUnit: 2,
      stairMaxRiser: 190, stairMinTread: 250, stairMinWidth: 900, minHeadroom: 2200,
      minDoorWidth: 750, accessibleDoorWidth: 900, minCeilingHeight: 2750,
      downpipeSpacing: 9000, maxKitchenDiningDistance: 6000,
    },
    rooms: {
      master_bedroom: { minArea: m2(9.5), minWidth: 2400, minGlazingRatio: 0.1 },
      bedroom: { minArea: m2(9.5), minWidth: 2400, minGlazingRatio: 0.1 },
      living: { minArea: m2(9.5), minWidth: 2400, minGlazingRatio: 0.1 },
      dining: { minArea: m2(7.5), minWidth: 2400, minGlazingRatio: 0.1 },
      study: { minArea: m2(7.5), minWidth: 2100, minGlazingRatio: 0.1 },
      family: { minArea: m2(7.5), minWidth: 2400, minGlazingRatio: 0.1 },
      kitchen: { minArea: m2(5.0), minWidth: 1800, minGlazingRatio: 0.1 },
      bathroom: { minArea: m2(1.8), minWidth: 1200 },
      powder: { minArea: m2(1.1), minWidth: 900 },
      utility: { minArea: m2(1.5), minWidth: 1000 },
      pooja: { minArea: m2(1.2), minWidth: 900 },
    },
  },
  {
    id: 'us-irc',
    name: 'USA — IRC (one- & two-family)',
    region: 'United States',
    description: 'Defaults based on the International Residential Code 2021.',
    disclaimer: 'Indicative defaults. Zoning setbacks and coverage are set by the local jurisdiction — confirm with the building department.',
    values: {
      frontSetback: 7620, rearSetback: 6096, sideSetback: 1524,
      maxCoverage: 0.4, maxFar: 0.6, maxHeight: 10668, maxFloors: 3, parkingPerUnit: 2,
      stairMaxRiser: 196.85, stairMinTread: 254, stairMinWidth: 914, minHeadroom: 2032,
      minDoorWidth: 813, accessibleDoorWidth: 914, minCeilingHeight: 2134,
      downpipeSpacing: 12000, maxKitchenDiningDistance: 7000,
    },
    rooms: {
      master_bedroom: { minArea: m2(6.5), minWidth: 2134, minGlazingRatio: 0.08 },
      bedroom: { minArea: m2(6.5), minWidth: 2134, minGlazingRatio: 0.08 },
      living: { minArea: m2(11.1), minWidth: 2134, minGlazingRatio: 0.08 },
      dining: { minArea: m2(6.5), minWidth: 2134, minGlazingRatio: 0.08 },
      kitchen: { minArea: m2(4.6), minWidth: 1524, minGlazingRatio: 0.08 },
      bathroom: { minArea: m2(2.8), minWidth: 1524 },
      powder: { minArea: m2(1.4), minWidth: 914 },
    },
  },
  {
    id: 'uae-dubai',
    name: 'UAE — villa (Dubai-style)',
    region: 'United Arab Emirates',
    description: 'Indicative villa planning defaults typical of Dubai master communities.',
    disclaimer: 'Indicative only. Master-developer guidelines and Dubai Municipality rules take precedence.',
    values: {
      frontSetback: 3000, rearSetback: 3000, sideSetback: 3000,
      maxCoverage: 0.5, maxFar: 1.0, maxHeight: 12000, maxFloors: 3, parkingPerUnit: 2,
      stairMaxRiser: 180, stairMinTread: 280, stairMinWidth: 1000, minHeadroom: 2200,
      minDoorWidth: 800, accessibleDoorWidth: 900, minCeilingHeight: 2700,
      downpipeSpacing: 9000, maxKitchenDiningDistance: 6000,
    },
    rooms: {
      master_bedroom: { minArea: m2(12), minWidth: 3000, minGlazingRatio: 0.1 },
      bedroom: { minArea: m2(9), minWidth: 2700, minGlazingRatio: 0.1 },
      living: { minArea: m2(16), minWidth: 3500, minGlazingRatio: 0.1 },
      kitchen: { minArea: m2(7), minWidth: 2100, minGlazingRatio: 0.08 },
      bathroom: { minArea: m2(3), minWidth: 1500 },
    },
  },
];

export const RULE_SET_BY_ID = Object.fromEntries(RULE_SETS.map((r) => [r.id, r]));

export function resolveRules(ruleSetId: string, overrides: Record<string, number> = {}): RuleSet {
  const base = RULE_SET_BY_ID[ruleSetId] ?? RULE_SETS[0];
  return { ...base, values: { ...base.values, ...overrides } as RuleSet['values'] };
}

export const RULE_LABELS: Record<keyof RuleSet['values'], { label: string; kind: 'length' | 'ratio' | 'count' | 'percent' }> = {
  frontSetback: { label: 'Front setback', kind: 'length' },
  rearSetback: { label: 'Rear setback', kind: 'length' },
  sideSetback: { label: 'Side setback', kind: 'length' },
  maxCoverage: { label: 'Max ground coverage', kind: 'percent' },
  maxFar: { label: 'Max FAR / FSI', kind: 'ratio' },
  maxHeight: { label: 'Max building height', kind: 'length' },
  maxFloors: { label: 'Max floors', kind: 'count' },
  parkingPerUnit: { label: 'Parking spaces per home', kind: 'count' },
  stairMaxRiser: { label: 'Stair max riser', kind: 'length' },
  stairMinTread: { label: 'Stair min tread', kind: 'length' },
  stairMinWidth: { label: 'Stair min width', kind: 'length' },
  minHeadroom: { label: 'Min stair headroom', kind: 'length' },
  minDoorWidth: { label: 'Min door width', kind: 'length' },
  accessibleDoorWidth: { label: 'Accessible door width', kind: 'length' },
  minCeilingHeight: { label: 'Min ceiling height', kind: 'length' },
  downpipeSpacing: { label: 'Max gutter run per downpipe', kind: 'length' },
  maxKitchenDiningDistance: { label: 'Kitchen–dining distance target', kind: 'length' },
};
