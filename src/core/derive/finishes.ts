import type { BuildingModel, Id, Wall } from '../model/types';
import { pointInPolygon } from '../geometry/polygon';
import { type Vec2, add, norm, perp, scale, sub } from '../geometry/vec';
import type { DerivedLevel, DerivedRoom } from './level';

export interface WallSide { finishId: Id; room: DerivedRoom | null; exterior: boolean }

/**
 * Which finish is on each face of a wall? Rooms own their wall finish, so a
 * bathroom tags its walls with tile and the living room its walls with paint —
 * the same rule drives the 3D model, quantities and cost.
 */
export function wallSides(b: BuildingModel, dl: DerivedLevel, w: Wall): { left: WallSide; right: WallSide } {
  const d = norm(sub(w.b, w.a));
  const n = perp(d);
  const m = add(w.a, scale(sub(w.b, w.a), 0.5));
  const probe = (side: number): Vec2 => add(m, scale(n, side * (w.thickness / 2 + 150)));
  const side = (s: number): WallSide => {
    const p = probe(s);
    const room = dl.rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null;
    const insideFootprint = dl.footprint.some((f) => pointInPolygon(p, f));
    const exterior = !room && !insideFootprint;
    const tag = room?.tagId ? b.rooms[room.tagId] : undefined;
    const finishId = exterior ? w.finishExteriorId : tag?.wallFinishId ?? w.finishInteriorId;
    return { finishId, room, exterior };
  };
  return { left: side(1), right: side(-1) };
}
