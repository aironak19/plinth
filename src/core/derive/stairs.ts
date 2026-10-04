/**
 * Stair generation. Risers, treads, landings and the footprint are computed from
 * the floor-to-floor height and the rule set — never typed in by hand.
 */
import type { Level, Stair } from '../model/types';
import type { RuleSet } from '../rules/rulesets';
import { type Vec2, rotate, add } from '../geometry/vec';
import { rectPolygon, type Polygon } from '../geometry/polygon';

export interface StairStep { poly: Polygon; z: number; landing?: boolean }

export interface StairInfo {
  risers: number;
  riser: number;
  treads: number;
  tread: number;
  totalRise: number;
  going: number;
  slope: number;
  blondel: number;
  steps: StairStep[];
  footprint: Polygon;
  /** Walking line for the plan arrow (local → world). */
  path: Vec2[];
  warnings: { code: string; message: string }[];
}

export function computeStair(s: Stair, level: Level, rules: RuleSet, rise?: number): StairInfo {
  const totalRise = rise ?? level.height;
  const risers = Math.max(2, Math.ceil(totalRise / Math.min(s.targetRiser, rules.values.stairMaxRiser + 0.01)));
  const riser = totalRise / risers;
  const T = s.tread;
  const W = s.width;
  const local: StairStep[] = [];
  let footprint: Polygon;
  let path: Vec2[];

  if (s.kind === 'straight') {
    for (let i = 0; i < risers - 1; i++) local.push({ poly: rectPolygon(0, i * T, W, T), z: (i + 1) * riser });
    const run = (risers - 1) * T;
    footprint = rectPolygon(0, 0, W, run);
    path = [{ x: W / 2, y: 0 }, { x: W / 2, y: run }];
  } else if (s.kind === 'L') {
    const n1 = Math.floor(risers / 2), n2 = risers - n1;
    const run1 = (n1 - 1) * T;
    for (let i = 0; i < n1 - 1; i++) local.push({ poly: rectPolygon(0, i * T, W, T), z: (i + 1) * riser });
    local.push({ poly: rectPolygon(0, run1, W, W), z: n1 * riser, landing: true });
    for (let i = 0; i < n2 - 1; i++) local.push({ poly: rectPolygon(W + i * T, run1, T, W), z: (n1 + i + 1) * riser });
    const run2 = (n2 - 1) * T;
    footprint = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: run1 }, { x: W + run2, y: run1 }, { x: W + run2, y: run1 + W }, { x: 0, y: run1 + W }];
    path = [{ x: W / 2, y: 0 }, { x: W / 2, y: run1 + W / 2 }, { x: W + run2, y: run1 + W / 2 }];
  } else if (s.kind === 'U') {
    const gap = 150;
    const n1 = Math.ceil(risers / 2), n2 = risers - n1;
    const run1 = (n1 - 1) * T, run2 = (n2 - 1) * T;
    const depth = Math.max(run1, run2);
    const off1 = depth - run1;
    for (let i = 0; i < n1 - 1; i++) local.push({ poly: rectPolygon(0, off1 + i * T, W, T), z: (i + 1) * riser });
    local.push({ poly: rectPolygon(0, depth, 2 * W + gap, W), z: n1 * riser, landing: true });
    for (let i = 0; i < n2 - 1; i++) local.push({ poly: rectPolygon(W + gap, depth - (i + 1) * T, W, T), z: (n1 + i + 1) * riser });
    footprint = rectPolygon(0, 0, 2 * W + gap, depth + W);
    path = [{ x: W / 2, y: off1 }, { x: W / 2, y: depth + W / 2 }, { x: W * 1.5 + gap, y: depth + W / 2 }, { x: W * 1.5 + gap, y: depth - run2 }];
  } else {
    // spiral — centre column, wedges sweeping ~330°
    const R = W + 150;
    const sweep = (330 * Math.PI) / 180;
    const n = risers - 1;
    const c = { x: R, y: R };
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * sweep - Math.PI / 2, a1 = ((i + 1) / n) * sweep - Math.PI / 2;
      const poly: Vec2[] = [add(c, { x: Math.cos(a0) * 150, y: Math.sin(a0) * 150 })];
      for (let k = 0; k <= 4; k++) {
        const a = a0 + ((a1 - a0) * k) / 4;
        poly.push(add(c, { x: Math.cos(a) * R, y: Math.sin(a) * R }));
      }
      poly.push(add(c, { x: Math.cos(a1) * 150, y: Math.sin(a1) * 150 }));
      local.push({ poly, z: (i + 1) * riser });
    }
    footprint = Array.from({ length: 24 }, (_, i) => add(c, { x: Math.cos((i / 24) * Math.PI * 2) * R, y: Math.sin((i / 24) * Math.PI * 2) * R }));
    path = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 11) * sweep - Math.PI / 2;
      return add(c, { x: Math.cos(a) * R * 0.6, y: Math.sin(a) * R * 0.6 });
    });
  }

  const xf = (p: Vec2): Vec2 => {
    const q = s.mirrored && s.kind !== 'straight' ? { x: -p.x + W, y: p.y } : p;
    return add(rotate(q, (s.rotation * Math.PI) / 180), s.origin);
  };
  const steps = local.map((st) => ({ ...st, poly: st.poly.map(xf) }));
  const treads = risers - 1;
  const going = treads * T;
  const warnings: StairInfo['warnings'] = [];
  const v = rules.values;
  if (riser > v.stairMaxRiser + 0.5) warnings.push({ code: 'riser', message: `Riser ${Math.round(riser)} mm exceeds the ${Math.round(v.stairMaxRiser)} mm maximum.` });
  if (T < v.stairMinTread - 0.5) warnings.push({ code: 'tread', message: `Tread ${Math.round(T)} mm is below the ${Math.round(v.stairMinTread)} mm minimum.` });
  if (W < v.stairMinWidth - 0.5) warnings.push({ code: 'width', message: `Clear width ${Math.round(W)} mm is below the ${Math.round(v.stairMinWidth)} mm minimum.` });
  const blondel = 2 * riser + T;
  if (blondel < 550 || blondel > 700) warnings.push({ code: 'comfort', message: `2R + T = ${Math.round(blondel)} mm — comfortable stairs fall between 550 and 700 mm.` });

  return {
    risers, riser, treads, tread: T, totalRise, going,
    slope: (Math.atan2(riser, T) * 180) / Math.PI,
    blondel, steps, footprint: footprint.map(xf), path: path.map(xf), warnings,
  };
}
