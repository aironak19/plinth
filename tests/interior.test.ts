import { describe, it, expect } from 'vitest';
import { auraVilla } from '@/core/generate/auraVilla';
import { activeBuilding, levelsSorted } from '@/core/model/query';
import { buildSolids } from '@/core/derive/solids';
import { deriveLevel } from '@/core/derive/level';
import { resolveRules } from '@/core/rules/rulesets';
import { pointInPolygon } from '@/core/geometry/polygon';
import { buildNav, blocked } from '@/ui/three/firstPerson';

const doc = auraVilla();
const b = activeBuilding(doc);
const rules = resolveRules('in-generic');

describe('interiors — geometry', () => {
  it('every enclosed room has a finished ceiling facing down into it; open-air rooms have none', () => {
    const solids = buildSolids(doc, b, rules);
    for (const lv of levelsSorted(b)) {
      for (const r of deriveLevel(b, lv.id).rooms) {
        const c = solids.find((s) => s.id === `ceiling-${r.id}`);
        if (r.fn === 'balcony' || r.fn === 'deck' || r.fn === 'parking') { expect(c, r.name).toBeUndefined(); continue; }
        expect(c, r.name).toBeTruthy();
        expect(c!.layer).toBe('ceiling');
        expect(c!.faces[0].normal.z).toBeLessThan(-0.99);
        const z = c!.faces[0].outer[0].z;
        expect(z).toBeGreaterThan(lv.elevation + 2000);
        expect(z).toBeLessThanOrEqual(lv.elevation + lv.height);
      }
    }
  });

  it('doors stand open for a walkthrough: the leaf turns out of the opening', () => {
    const closed = buildSolids(doc, b, rules), open = buildSolids(doc, b, rules, { doorsOpen: true });
    const hinged = Object.values(b.doors).find((d) => d.kind === 'single')!;
    const w = b.walls[hinged.wallId];
    const along = (s: { faces: { outer: { x: number; y: number }[] }[] }) => { const d = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), ux = (w.b.x - w.a.x) / d, uy = (w.b.y - w.a.y) / d; const ts = s.faces.flatMap((f) => f.outer.map((p) => (p.x - w.a.x) * -uy + (p.y - w.a.y) * ux)); return Math.max(...ts) - Math.min(...ts); };
    const a = closed.find((s) => s.id === `door-${hinged.id}-leaf`)!, o = open.find((s) => s.id === `door-${hinged.id}-leaf`)!;
    expect(along(a)).toBeLessThan(60);            // closed: lies in the plane of the wall
    expect(along(o)).toBeGreaterThan(hinged.width * 0.7); // open: stands perpendicular to it
    expect(open.length).toBeLessThanOrEqual(closed.length);
  });
});

describe('interiors — walking', () => {
  const nav = buildNav(doc, b);

  it('you arrive inside each room, clear of walls and furniture', () => {
    const rooms = nav.flatMap((l) => l.rooms.map((r) => ({ l, r })));
    expect(rooms.length).toBeGreaterThan(15);
    for (const { l, r } of rooms) {
      expect(pointInPolygon(r.entry.p, r.polygon), `${r.name}: entry outside the room`).toBe(true);
      if (r.area > 4e6) expect(blocked(l, r.entry.p), `${r.name}: entry inside a wall or door leaf`).toBe(false);
      expect(Number.isFinite(r.entry.yaw)).toBe(true);
    }
  });

  it('walls stop you and doorways let you through', () => {
    const ground = nav.find((l) => l.ground)!;
    const dl = deriveLevel(b, ground.id);
    let doors = 0;
    for (const w of dl.walls) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), ux = (w.b.x - w.a.x) / len, uy = (w.b.y - w.a.y) / len;
      const openings = Object.values(b.doors).filter((d) => d.wallId === w.id);
      // The middle of every doorway, on the wall line, is passable.
      for (const d of openings) { if (d.width < 700) continue; doors++; expect(blocked(ground, { x: w.a.x + ux * d.offset, y: w.a.y + uy * d.offset }), `door ${d.tag}`).toBe(false); }
      // A point on the wall line away from any opening is not.
      if (len > 2500 && !openings.length) expect(blocked(ground, { x: w.a.x + ux * len / 2, y: w.a.y + uy * len / 2 })).toBe(true);
    }
    expect(doors).toBeGreaterThan(5);
  });

  it('the garden is walkable and fenced by the compound wall', () => {
    const ground = nav.find((l) => l.ground)!;
    const wall = Object.values(doc.site.features).find((f) => f.kind === 'wall')!;
    const [p, q] = wall.path!;
    expect(blocked(ground, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })).toBe(true);
    expect(nav.filter((l) => !l.ground).every((l) => !l.blockers.some((s) => s.a === p))).toBe(true);
  });
});
