import { describe, it, expect } from 'vitest';
import { buildPlanarGraph, findFaces, findOuterBoundaries } from '@/core/geometry/planar';
import { area, offsetPolygonEdges, rectPolygon, difference, areaWithHoles } from '@/core/geometry/polygon';
import { computeWallOutlines } from '@/core/derive/walls';
import { makeWall } from '@/core/model/factory';
import { coverRectangles } from '@/core/derive/roof';
import { sunPosition } from '@/core/derive/sun';

const sq = (x: number, y: number, w: number, h: number) => {
  const p = rectPolygon(x, y, w, h);
  return p.map((a, i) => ({ id: `e${x}${y}${i}`, a, b: p[(i + 1) % 4] }));
};

describe('planar graph', () => {
  it('finds two rooms sharing a wall, including T-junctions', () => {
    const edges = [...sq(0, 0, 4000, 3000), { id: 'mid', a: { x: 2000, y: 0 }, b: { x: 2000, y: 3000 } }];
    const g = buildPlanarGraph(edges);
    const faces = findFaces(g);
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => Math.round(f.area / 1e6)).sort()).toEqual([6, 6]);
    expect(findOuterBoundaries(g)).toHaveLength(1);
  });
  it('ignores dangling walls', () => {
    const edges = [...sq(0, 0, 4000, 3000), { id: 'spur', a: { x: 1000, y: 1000 }, b: { x: 1000, y: 3000 } }];
    expect(findFaces(buildPlanarGraph(edges))).toHaveLength(1);
  });
  it('offsets a room loop by half wall thickness', () => {
    const net = offsetPolygonEdges(rectPolygon(0, 0, 4000, 3000), [115, 115, 115, 115]);
    expect(area(net)).toBeCloseTo((4000 - 230) * (3000 - 230), -2);
  });
});

describe('wall joins', () => {
  it('mitres an L corner without overlap', () => {
    const a = makeWall({ levelId: 'l', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 230 });
    const b = makeWall({ levelId: 'l', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 }, thickness: 230 });
    const o = computeWallOutlines([a, b]);
    const qa = o.get(a.id)!.quad, qb = o.get(b.id)!.quad;
    // outer corner of both walls meets at (4115, -115)
    expect(qa.some((p) => Math.abs(p.x - 4115) < 1 && Math.abs(p.y + 115) < 1)).toBe(true);
    expect(qb.some((p) => Math.abs(p.x - 4115) < 1 && Math.abs(p.y + 115) < 1)).toBe(true);
    expect(o.get(a.id)!.capB).toBe(false);
    expect(o.get(a.id)!.capA).toBe(true);
  });
});

describe('boolean & roof helpers', () => {
  it('subtracts a hole', () => {
    expect(areaWithHoles(difference([rectPolygon(0, 0, 10, 10)], [rectPolygon(2, 2, 2, 2)]))).toBeCloseTo(96);
  });
  it('covers an L with two rectangles', () => {
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    expect(coverRectangles(L)).toHaveLength(2);
  });
});

describe('sun', () => {
  it('puts the noon sun high and south in Mumbai in winter', () => {
    const s = sunPosition(19.07, 72.88, 1, 15, 12.5);
    expect(s.altitude).toBeGreaterThan(45);
    expect(s.azimuth).toBeGreaterThan(150);
    expect(s.azimuth).toBeLessThan(210);
  });
});
