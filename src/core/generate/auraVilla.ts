/**
 * Aura Villa — the flagship sample project, drawn on the client's real plot:
 * an L-shaped site of 52 ft × 49 ft (road side) stepping to 42 ft × 47 ft at the
 * rear (96 ft deep overall, ≈ 4,522 sq ft), taken from the hand sketch in
 * `Aura Villa/`. The road is assumed on the 52 ft edge (south); edit in Site.
 */
import { ASSET_BY_ID } from '../catalog/assets';
import type { ProjectDoc } from '../model/types';
import { defaultMeta, newProjectDoc } from '../model/factory';
import { buildFromSpec, type RoomSpec } from './fromRects';
import { ft } from '../units';
import { uid } from '../model/ids';
import { levelsSorted } from '../model/query';

const R = (key: string, name: string, fn: RoomSpec['fn'], x: number, y: number, w: number, h: number): RoomSpec => ({ key, name, fn, x: ft(x), y: ft(y), w: ft(w), h: ft(h) });

export function auraVilla(): ProjectDoc {
  const building = buildFromSpec({
    style: 'modern',
    columns: true,
    roof: { kind: 'flat', parapetHeight: 1050, overhang: 450 },
    levels: [
      {
        name: 'Ground Floor', height: 3200,
        rooms: [
          R('foyer', 'Foyer', 'foyer', 6, 21.5, 7, 9),
          R('pooja', 'Pooja', 'pooja', 6, 30.5, 7, 6),
          R('powder', 'Powder Room', 'powder', 6, 36.5, 7, 7),
          R('living', 'Living Room', 'living', 13, 21.5, 18, 22),
          R('guest', 'Guest Bedroom', 'bedroom', 31, 21.5, 15, 10),
          R('stair', 'Stair', 'stair', 31, 31.5, 8, 12),
          R('gbath', 'Guest Bath', 'bathroom', 39, 31.5, 7, 12),
          R('dining', 'Dining', 'dining', 6, 43.5, 14, 12),
          R('kitchen', 'Kitchen', 'kitchen', 20, 43.5, 12, 12),
          R('family', 'Family Lounge', 'family', 6, 55.5, 20, 10),
          R('utility', 'Utility', 'utility', 26, 55.5, 6, 10),
        ],
        doors: [
          { a: 'foyer', b: 's', kind: 'pivot' },
          { a: 'foyer', b: 'living' },
          { a: 'pooja', b: 'foyer' },
          { a: 'powder', b: 'living' },
          { a: 'guest', b: 'living' },
          { a: 'stair', b: 'living', kind: 'opening', width: 1100, at: ft(2) },
          { a: 'gbath', b: 'guest' },
          { a: 'dining', b: 'living', kind: 'opening', width: 1800 },
          { a: 'kitchen', b: 'dining' },
          { a: 'utility', b: 'kitchen' },
          { a: 'family', b: 'dining', kind: 'opening', width: 2400 },
          { a: 'family', b: 'n', kind: 'sliding', width: 3000 },
          { a: 'utility', b: 'e' },
        ],
        stair: { room: 'stair', kind: 'U', tread: 260, width: 1000 },
      },
      {
        name: 'First Floor', height: 3200,
        rooms: [
          R('master', 'Master Bedroom', 'master_bedroom', 6, 21.5, 18, 15.5),
          R('mbath', 'Master Bath', 'bathroom', 6, 37, 9, 6.5),
          R('walkin', 'Walk-in Wardrobe', 'walkin', 15, 37, 9, 6.5),
          R('hall', 'Landing', 'corridor', 24, 31.5, 7, 12),
          R('bed2', 'Bedroom 2', 'bedroom', 24, 21.5, 15, 10),
          R('bath2', 'Bath 2', 'bathroom', 39, 21.5, 7, 10),
          R('stair', 'Stair', 'stair', 31, 31.5, 8, 12),
          R('study', 'Study', 'study', 39, 31.5, 7, 12),
          R('fam', 'Family Room', 'family', 20, 43.5, 12, 9),
          R('bed3', 'Bedroom 3', 'bedroom', 6, 43.5, 14, 14),
          R('bath3', 'Bath 3', 'bathroom', 6, 57.5, 8, 8),
          R('bed4', 'Bedroom 4', 'bedroom', 20, 52.5, 12, 13),
          R('bath4', 'Bath 4', 'bathroom', 14, 57.5, 6, 8),
        ],
        doors: [
          { a: 'stair', b: 'hall', kind: 'opening', width: 1100, at: ft(9) },
          { a: 'master', b: 'hall', at: ft(3.5) },
          { a: 'bed2', b: 'hall' },
          { a: 'fam', b: 'hall', kind: 'opening', width: 1500 },
          { a: 'bath2', b: 'bed2' },
          { a: 'study', b: 'stair' },
          { a: 'bed3', b: 'fam' },
          { a: 'bed4', b: 'fam' },
          { a: 'bath3', b: 'bed3' },
          { a: 'bath4', b: 'bed4' },
          { a: 'mbath', b: 'master' },
          { a: 'walkin', b: 'master' },
        ],
      },
    ],
  });

  const meta = defaultMeta({
    name: 'Aura Villa',
    type: 'villa',
    client: 'Private client',
    phase: 'Concept design',
    tags: ['G+1', '5 BHK', 'L-shaped plot'],
    favorite: true,
    location: { city: 'Mumbai', country: 'India', lat: 19.076, lon: 72.8777, address: 'Plot as per hand sketch (Aura Villa)' },
  });
  const site = {
    boundary: [
      { x: 0, y: 0 }, { x: ft(52), y: 0 }, { x: ft(52), y: ft(49) }, { x: ft(42), y: ft(49) }, { x: ft(42), y: ft(96) }, { x: 0, y: ft(96) },
    ],
    edges: [
      { kind: 'front' as const, setback: 3000, road: { name: '30 ft access road', width: ft(30) } },
      { kind: 'side' as const, setback: 1500 },
      { kind: 'rear' as const, setback: 1500 },
      { kind: 'side' as const, setback: 1500 },
      { kind: 'rear' as const, setback: 1500 },
      { kind: 'side' as const, setback: 1500 },
    ],
    northAngle: 0,
    features: {} as ProjectDoc['site']['features'],
  };
  const doc = newProjectDoc(meta, site, building, 'modern');
  const f = (id: string, v: ProjectDoc['site']['features'][string]) => { doc.site.features[id] = v; };
  const rect = (x: number, y: number, w: number, h: number) => [{ x: ft(x), y: ft(y) }, { x: ft(x + w), y: ft(y) }, { x: ft(x + w), y: ft(y + h) }, { x: ft(x), y: ft(y + h) }];
  f('sf-parking', { id: 'sf-parking', kind: 'parking', name: 'Two-car parking', polygon: rect(25, 2, 21, 17.5), materialId: 'paver', props: { spaces: 2 } });
  f('sf-path', { id: 'sf-path', kind: 'pathway', name: 'Entrance path', polygon: rect(7, 0, 5.5, 21.2), materialId: 'kota', props: {} });
  f('sf-deck', { id: 'sf-deck', kind: 'deck', name: 'Pool deck', polygon: rect(6, 66, 30, 6), materialId: 'deck-wood', props: {} });
  f('sf-pool', { id: 'sf-pool', kind: 'pool', name: 'Lap pool', polygon: rect(10, 75, 26, 11), materialId: 'pool-water', props: { depth: 1350 } });

  const ground = levelsSorted(building)[0];
  const add = (assetId: string, x: number, y: number, rotation = 0, variant?: string) => {
    const id = uid('f');
    building.furniture[id] = { id, levelId: ground.id, assetId, position: { x: ft(x), y: ft(y) }, rotation, variant, props: {} };
  };
  add('car-suv', 30.5, 10.8, 0, 'white');
  add('car-sedan', 40.5, 10.8, 0, 'black');
  // ---- landscape: a tropical garden specified with real species
  const P = (id: string, x: number, y: number, k = 1) => {
    const fid = uid('f'), a = ASSET_BY_ID[`plant-${id}`];
    building.furniture[fid] = { id: fid, levelId: ground.id, assetId: a.id, position: { x: ft(x), y: ft(y) }, rotation: 0, props: {}, ...(k !== 1 ? { size: { w: a.size.w * k, d: a.size.d * k, h: a.size.h * k } } : {}) };
  };
  // Compound wall on the three private sides; the road front stays open to the gate, path and drive.
  f('sf-wall', { id: 'sf-wall', kind: 'wall', name: 'Compound wall', path: [{ x: ft(52) - 130, y: 130 }, { x: ft(52) - 130, y: ft(49) - 130 }, { x: ft(42) - 130, y: ft(49) - 130 }, { x: ft(42) - 130, y: ft(96) - 130 }, { x: 130, y: ft(96) - 130 }, { x: 130, y: 130 }], materialId: 'ext-texture', props: { height: 1650, width: 200 } });
  f('sf-hedge', { id: 'sf-hedge', kind: 'hedge', name: 'Front hedge', path: [{ x: ft(13.2), y: ft(1) }, { x: ft(24.2), y: ft(1) }], props: { height: 900, width: 600, species: 'murraya' } });
  f('sf-bed-front', { id: 'sf-bed-front', kind: 'bed', name: 'Entrance planting', polygon: rect(13, 2.4, 11.4, 4.2), materialId: 'mulch', props: {} });
  f('sf-bed-pool', { id: 'sf-bed-pool', kind: 'bed', name: 'Poolside planting', polygon: rect(1, 87.4, 8, 7.6), materialId: 'mulch', props: {} });
  f('sf-bed-rear', { id: 'sf-bed-rear', kind: 'bed', name: 'Rear border', polygon: rect(10, 92.4, 30.5, 2.8), materialId: 'mulch', props: {} });
  add('gate-pedestrian', 9.75, 0.7, 0, 'teak');
  // Trees and palms
  P('frangipani', 18.5, 9.5, 0.9); P('foxtail', 3.2, 6); P('foxtail', 3.2, 30, 0.9);
  P('areca', 4.6, 90.4); P('foxtail', 2.6, 93.6, 0.85); P('heliconia', 5.2, 93.2); P('alocasia', 2.6, 88.8); P('fern', 6.8, 88.6); P('spider-lily', 8, 91);
  P('crepe-myrtle', 39, 60); P('pygmy-date', 39.2, 71); P('frangipani', 3.4, 79.5, 0.85);
  for (const x of [12, 17, 22, 27, 32, 37.5]) P(x % 2 > 0.6 ? 'heliconia' : 'giant-strelitzia', x, 93.8, x % 2 > 0.6 ? 1 : 0.6);
  for (const x of [14, 17.4, 20.8]) P('ixora', x, 5.3);
  P('bird-of-paradise', 23, 4.2); P('spider-lily', 15.6, 3.4); P('spider-lily', 19.2, 3.3);
  P('hibiscus', 49, 40); P('areca', 49.6, 24, 0.8); P('ashoka', 50, 31, 0.8); P('ashoka', 50, 36.5, 0.8);
  // Pool terrace and lights
  add('lounger-pair', 20, 90.2, 0); add('parasol', 27.5, 89.6, 0, 'ivory');
  add('outdoor-dining', 30, 69.5, 90);
  for (const y of [4, 10, 16]) { add('path-light', 6.4, y); add('path-light', 13.1, y + 3); }
  add('uplight', 19.6, 10.4); add('uplight', 4.2, 80.4); add('bollard-light', 9, 73.5); add('bollard-light', 37, 73.5);

  // Collaboration history — what a live project looks like.
  const now = Date.now();
  const H = 3600e3;
  const rooms = Object.values(building.rooms);
  const kitchen = rooms.find((r) => r.name === 'Kitchen');
  const master = rooms.find((r) => r.name === 'Master Bedroom');
  doc.comments = [
    { id: uid('cm'), authorId: 'u-priya', body: '@ronak The kitchen island looks tight against the dining opening — can we check clearances?', target: kitchen ? { kind: 'room', id: kitchen.id } : undefined, pin: kitchen ? { levelId: kitchen.levelId, point: kitchen.point } : undefined, createdAt: now - 3 * H, resolved: false, replies: [{ id: uid('rp'), authorId: 'u-ronak', body: 'Good catch — I’ll test a 3 ft wider kitchen in Option B.', createdAt: now - 2.5 * H }], mentions: ['u-ronak'] },
    { id: uid('cm'), authorId: 'u-client', body: 'We love the master bedroom facing the road. Could the bed wall get a feature panel?', target: master ? { kind: 'room', id: master.id } : undefined, pin: master ? { levelId: master.levelId, point: master.point } : undefined, createdAt: now - 26 * H, resolved: false, replies: [], mentions: [] },
    { id: uid('cm'), authorId: 'u-arjun', body: 'Columns at the L-junction should align on both floors; current grid is fine conceptually.', createdAt: now - 50 * H, resolved: true, replies: [], mentions: [] },
  ];
  doc.tasks = [
    { id: uid('tk'), title: 'Finalise master bedroom layout', assigneeId: 'u-priya', due: '2026-10-12', status: 'in_review', target: master ? { kind: 'room', id: master.id } : undefined, createdAt: now - 30 * H },
    { id: uid('tk'), title: 'Pool deck levels & drainage', assigneeId: 'u-arjun', due: '2026-10-15', status: 'in_progress', createdAt: now - 20 * H },
    { id: uid('tk'), title: 'Façade material board for client', assigneeId: 'u-ronak', due: '2026-10-09', status: 'todo', createdAt: now - 6 * H },
  ];
  doc.approvals = [
    { id: uid('ap'), subject: 'Ground floor zoning', stage: 'internal_review', decision: 'approved', requestedById: 'u-ronak', reviewerId: 'u-meera', at: now - 40 * H, note: 'Circulation works well.' },
    { id: uid('ap'), subject: 'Concept design — client sign-off', stage: 'client_review', decision: 'pending', requestedById: 'u-ronak', reviewerId: 'u-client', at: now - 4 * H, note: '' },
  ];
  doc.activity = [
    { id: uid('act'), at: now - 2.5 * H, actorId: 'u-ronak', action: 'comment.reply', summary: 'Ronak replied on Kitchen' },
    { id: uid('act'), at: now - 3 * H, actorId: 'u-priya', action: 'comment.add', summary: 'Priya commented on Kitchen' },
    { id: uid('act'), at: now - 4 * H, actorId: 'u-ronak', action: 'approval.request', summary: 'Approval requested from The Kapoors: Concept design' },
    { id: uid('act'), at: now - 9 * H, actorId: 'u-ronak', action: 'stair.update', summary: 'Stair redesigned as U-shaped, 260 mm treads' },
    { id: uid('act'), at: now - 30 * H, actorId: 'u-priya', action: 'material.apply', summary: 'Italian marble applied to Living Room' },
  ];
  doc.stage = 'client_review';
  doc.scenes = [
    { id: uid('sc'), name: 'Front exterior', camera: { position: [ft(70), ft(-40), ft(28)], target: [ft(24), ft(36), ft(8)], fov: 40, projection: 'perspective' }, renderStyle: 'realistic', sun: { month: 1, day: 15, hour: 10 }, hiddenLevels: [], createdAt: now },
    { id: uid('sc'), name: 'Pool & garden', camera: { position: [ft(62), ft(128), ft(52)], target: [ft(22), ft(70), ft(2)], fov: 40, projection: 'perspective' }, renderStyle: 'realistic', sun: { month: 4, day: 20, hour: 17.5 }, hiddenLevels: [], createdAt: now },
    { id: uid('sc'), name: 'Massing (clay)', camera: { position: [ft(-40), ft(-30), ft(60)], target: [ft(24), ft(44), ft(6)], fov: 38, projection: 'perspective' }, renderStyle: 'clay', sun: { month: 6, day: 21, hour: 13 }, hiddenLevels: [], createdAt: now },
  ];
  doc.meta.createdAt = now - 14 * 24 * H;
  doc.meta.updatedAt = now - 2 * H;
  return doc;
}
