/**
 * Site analysis & constraint engine: plot area, buildable zone (per-edge
 * setbacks on any polygon, including L-shaped and irregular plots), coverage,
 * FAR/FSI, height and setback compliance.
 */
import type { BuildingModel, ProjectDoc, Site } from '../model/types';
import type { RuleSet } from '../rules/rulesets';
import {
  type Polygon, type PolygonWithHoles, area, areaWithHoles, difference, ensureCCW, perimeter, segmentBuffer, union,
} from '../geometry/polygon';
import { type Vec2, dist, mid, norm, perp, projectToSegment, segmentIntersection, sub } from '../geometry/vec';
import { levelsSorted } from '../model/query';
import { deriveLevel } from './level';
import { analyzeLandscape, type LandscapeAnalysis } from './landscape';

export interface SetbackCheck {
  edge: number;
  kind: Site['edges'][number]['kind'];
  required: number;
  actual: number;
  ok: boolean;
  /** Closest points: on the building and on the plot edge. */
  from: Vec2;
  to: Vec2;
  /** Inward unit normal of the plot edge (direction to move the building to fix). */
  inward: Vec2;
}

export interface SiteAnalysis {
  plotArea: number;
  plotPerimeter: number;
  buildable: PolygonWithHoles[];
  buildableArea: number;
  footprint: PolygonWithHoles[];
  footprintArea: number;
  coverage: number;
  builtUpArea: number;
  far: number;
  openArea: number;
  violations: PolygonWithHoles[];
  setbacks: SetbackCheck[];
  buildingHeight: number;
  floors: number;
  parkingProvided: number;
  edgeLengths: number[];
  /** Garden numbers: soft / hard areas, permeability, planting, canopy, irrigation. */
  landscape: LandscapeAnalysis;
}

export function buildableZone(site: Site): PolygonWithHoles[] {
  const b = ensureCCW(site.boundary);
  const strips: Polygon[] = [];
  b.forEach((p, i) => {
    const q = b[(i + 1) % b.length];
    const sb = site.edges[i]?.setback ?? 0;
    if (sb > 0) strips.push(segmentBuffer(p, q, sb, 8));
  });
  return difference([b], strips);
}

function segSegDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { d: number; p: Vec2; q: Vec2 } {
  const x = segmentIntersection(a, b, c, d);
  if (x) return { d: 0, p: x.point, q: x.point };
  const cands = [
    (() => { const r = projectToSegment(a, c, d); return { d: r.dist, p: a, q: r.point }; })(),
    (() => { const r = projectToSegment(b, c, d); return { d: r.dist, p: b, q: r.point }; })(),
    (() => { const r = projectToSegment(c, a, b); return { d: r.dist, p: r.point, q: c }; })(),
    (() => { const r = projectToSegment(d, a, b); return { d: r.dist, p: r.point, q: d }; })(),
  ];
  return cands.reduce((m, c2) => (c2.d < m.d ? c2 : m));
}

export function analyzeSite(doc: ProjectDoc, building: BuildingModel, rules: RuleSet): SiteAnalysis {
  const site = doc.site;
  const boundary = ensureCCW(site.boundary);
  const plotArea = area(boundary);
  const buildable = buildableZone(site);
  const levels = levelsSorted(building);
  const derived = levels.map((l) => deriveLevel(building, l.id));
  const allFootprints = derived.flatMap((d) => d.footprint);
  const footprint = allFootprints.length ? union(allFootprints) : [];
  const footprintArea = areaWithHoles(footprint);
  const builtUpArea = derived.reduce((s, d) => s + d.grossArea, 0);
  const violations = footprint.length ? difference(footprint, buildable) : [];

  const setbacks: SetbackCheck[] = [];
  const edgeLengths: number[] = [];
  boundary.forEach((p, i) => {
    const q = boundary[(i + 1) % boundary.length];
    edgeLengths.push(dist(p, q));
    const e = site.edges[i];
    if (!footprint.length) return;
    let best = { d: Infinity, p: mid(p, q), q: mid(p, q) };
    for (const f of footprint) {
      const ring = f.outer;
      for (let k = 0; k < ring.length; k++) {
        const r = segSegDistance(ring[k], ring[(k + 1) % ring.length], p, q);
        if (r.d < best.d) best = r;
      }
    }
    const required = e?.setback ?? 0;
    setbacks.push({
      edge: i, kind: e?.kind ?? 'side', required, actual: best.d, ok: best.d + 1 >= required,
      from: best.p, to: best.q, inward: perp(norm(sub(q, p))),
    });
  });

  const top = levels[levels.length - 1];
  const roofs = Object.values(building.roofs);
  let buildingHeight = top ? top.elevation + top.height : 0;
  for (const r of roofs) {
    const lvl = building.levels[r.levelId];
    if (!lvl) continue;
    const extra = r.kind === 'flat' ? r.parapetHeight : 0;
    buildingHeight = Math.max(buildingHeight, lvl.elevation + lvl.height + extra);
  }
  void rules;

  const parkingProvided =
    Object.values(site.features).filter((f) => f.kind === 'parking').reduce((n, f) => n + Math.max(0, Number(f.props.spaces ?? 1)), 0);

  return {
    plotArea, plotPerimeter: perimeter(boundary), buildable, buildableArea: areaWithHoles(buildable),
    footprint, footprintArea, coverage: plotArea ? footprintArea / plotArea : 0, builtUpArea,
    far: plotArea ? builtUpArea / plotArea : 0, openArea: plotArea - footprintArea,
    violations, setbacks, buildingHeight, floors: levels.filter((l) => l.elevation >= 0).length, parkingProvided, edgeLengths,
    landscape: analyzeLandscape(doc, building),
  };
}
