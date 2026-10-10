/**
 * The canonical project model — the single source of truth.
 *
 * Organization
 *  └── Project (ProjectDoc)
 *       ├── Site                 shared by every design option
 *       ├── Design options       each owns a BuildingModel
 *       │    └── Levels · Walls · Doors · Windows · Rooms · Stairs · Roofs
 *       │        Columns · Beams · Furniture
 *       ├── Scenes (cameras)
 *       ├── Cost settings
 *       └── Collaboration (comments, tasks, approvals, activity)
 *
 * Plans, 3D, elevations, sections, schedules, quantities, cost, renders and
 * reports are all *derived* from this — never stored separately.
 * All lengths are millimetres; angles are degrees unless named *Rad.
 */
import type { Vec2 } from '../geometry/vec';
import type { CurrencyCode, UnitSystem } from '../units';

export type Id = string;
export type Props = Record<string, string | number | boolean>;

// ---------------------------------------------------------------- building

export interface Level {
  id: Id;
  name: string;
  /** Finished floor level relative to project zero. */
  elevation: number;
  /** Floor-to-floor height. */
  height: number;
  slabThickness: number;
  visible: boolean;
  locked: boolean;
  order: number;
}

export type WallKind = 'exterior' | 'interior' | 'partition' | 'compound' | 'retaining' | 'parapet';

export interface Wall {
  id: Id;
  levelId: Id;
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** null → full level height (to the underside of the slab above). */
  height: number | null;
  baseOffset: number;
  kind: WallKind;
  structural: boolean;
  /** Core construction material (brick, block, concrete …). */
  materialId: Id;
  finishInteriorId: Id;
  finishExteriorId: Id;
  fireRating?: string;
  acousticRating?: string;
  insulation?: string;
  props: Props;
}

export type DoorKind = 'single' | 'double' | 'sliding' | 'folding' | 'pocket' | 'pivot' | 'french' | 'garage' | 'opening';

export interface Door {
  id: Id;
  wallId: Id;
  /** Centre of the opening measured along the wall from `a`. */
  offset: number;
  width: number;
  height: number;
  kind: DoorKind;
  /** Hinge at the end of the opening nearer the wall's `a` ('start') or `b' ('end'). */
  hinge: 'start' | 'end';
  /** Side of the wall (relative to a→b) the leaf swings into. */
  side: 'left' | 'right';
  swingAngle: number;
  materialId: Id;
  fireRating?: string;
  hardware?: string;
  tag: string;
  props: Props;
}

export type WindowKind = 'casement' | 'sliding' | 'fixed' | 'double' | 'single' | 'bay' | 'corner' | 'louvre' | 'skylight';

export interface Window {
  id: Id;
  wallId: Id;
  offset: number;
  width: number;
  height: number;
  sill: number;
  kind: WindowKind;
  glazing: 'single' | 'double' | 'low-e' | 'triple';
  frameMaterialId: Id;
  tag: string;
  props: Props;
}

export type RoomFunction =
  | 'living' | 'dining' | 'kitchen' | 'master_bedroom' | 'bedroom' | 'bathroom' | 'powder' | 'pooja'
  | 'foyer' | 'stair' | 'utility' | 'study' | 'family' | 'walkin' | 'corridor' | 'balcony' | 'parking'
  | 'store' | 'deck' | 'gym' | 'media' | 'other';

/**
 * A room is a tag placed inside a space. Its boundary, area and dimensions are
 * derived from the surrounding walls (see derive/rooms.ts).
 */
export interface RoomTag {
  id: Id;
  levelId: Id;
  point: Vec2;
  name: string;
  number: string;
  fn: RoomFunction;
  floorFinishId: Id;
  wallFinishId: Id;
  ceilingFinishId: Id;
  /** null → level height minus slab. */
  ceilingHeight: number | null;
  props: Props;
}

export type StairKind = 'straight' | 'L' | 'U' | 'spiral';

export interface Stair {
  id: Id;
  levelId: Id;
  kind: StairKind;
  /** Bottom-left corner of the stair footprint (before rotation). */
  origin: Vec2;
  /** Rotation in degrees about `origin`. 0 → first flight climbs towards +y. */
  rotation: number;
  width: number;
  targetRiser: number;
  tread: number;
  /** Mirror an L / U stair (turns left instead of right). */
  mirrored: boolean;
  materialId: Id;
  props: Props;
}

export type RoofKind = 'flat' | 'gable' | 'hip' | 'shed' | 'butterfly' | 'mansard';

export interface Roof {
  id: Id;
  /** The roof sits on top of this level. */
  levelId: Id;
  kind: RoofKind;
  /** 'auto' follows the level's exterior outline; otherwise an explicit rectangle. */
  footprint: 'auto' | { x: number; y: number; w: number; h: number };
  pitch: number;
  overhang: number;
  ridgeAxis: 'x' | 'y';
  parapetHeight: number;
  thickness: number;
  materialId: Id;
  props: Props;
}

export interface Column {
  id: Id;
  levelId: Id;
  position: Vec2;
  width: number;
  depth: number;
  shape: 'rect' | 'round';
  rotation: number;
  materialId: Id;
  props: Props;
}

export interface Beam {
  id: Id;
  levelId: Id;
  a: Vec2;
  b: Vec2;
  width: number;
  depth: number;
  materialId: Id;
  props: Props;
}

export interface FurnitureItem {
  id: Id;
  levelId: Id;
  assetId: Id;
  position: Vec2;
  rotation: number;
  /** Optional overrides of the asset's default size. */
  size?: { w: number; d: number; h: number };
  variant?: string;
  materialId?: Id;
  props: Props;
}

export interface BuildingModel {
  levels: Record<Id, Level>;
  walls: Record<Id, Wall>;
  doors: Record<Id, Door>;
  windows: Record<Id, Window>;
  rooms: Record<Id, RoomTag>;
  stairs: Record<Id, Stair>;
  roofs: Record<Id, Roof>;
  columns: Record<Id, Column>;
  beams: Record<Id, Beam>;
  furniture: Record<Id, FurnitureItem>;
}

export type ElementKind = 'wall' | 'door' | 'window' | 'room' | 'stair' | 'roof' | 'column' | 'beam' | 'furniture' | 'level' | 'siteFeature';

export const COLLECTION: Record<Exclude<ElementKind, 'siteFeature'>, keyof BuildingModel> = {
  wall: 'walls', door: 'doors', window: 'windows', room: 'rooms', stair: 'stairs', roof: 'roofs',
  column: 'columns', beam: 'beams', furniture: 'furniture', level: 'levels',
};

export interface ElementRef { kind: ElementKind; id: Id }

export type StyleId = 'modern' | 'contemporary' | 'minimal' | 'traditional' | 'mediterranean' | 'tropical' | 'industrial' | 'luxury';

export interface DesignOption {
  id: Id;
  name: string;
  description: string;
  style: StyleId;
  building: BuildingModel;
  createdAt: number;
  /** Optional generative-design scores attached when the option was generated. */
  scores?: Record<string, number>;
}

// -------------------------------------------------------------------- site

export type SiteEdgeKind = 'front' | 'side' | 'rear';

export interface SiteEdge {
  kind: SiteEdgeKind;
  setback: number;
  /** Road abutting this edge, if any. */
  road?: { name: string; width: number };
}

/**
 * Areas: pool, pond, lawn, bed (planting), gravel, and the paved kinds
 * (driveway, parking, pathway, patio, deck). Lines: hedge, fence and wall
 * follow `path` with `props.height` / `props.width`.
 */
export type SiteFeatureKind = 'pool' | 'driveway' | 'lawn' | 'deck' | 'tree' | 'parking' | 'pathway' | 'planter'
  | 'patio' | 'bed' | 'gravel' | 'pond' | 'hedge' | 'fence' | 'wall';

export const LINEAR_FEATURES: SiteFeatureKind[] = ['hedge', 'fence', 'wall'];
/** Paved, impermeable or semi-permeable ground. */
export const HARD_FEATURES: SiteFeatureKind[] = ['driveway', 'parking', 'pathway', 'patio', 'deck', 'gravel'];
/** Planted or water — counts as soft landscape. */
export const SOFT_FEATURES: SiteFeatureKind[] = ['lawn', 'bed', 'pond'];

export interface SiteFeature {
  id: Id;
  kind: SiteFeatureKind;
  name: string;
  polygon?: Vec2[];
  /** Centre-line of a hedge, fence or garden wall. */
  path?: Vec2[];
  position?: Vec2;
  radius?: number;
  materialId?: Id;
  props: Props;
}

export interface Site {
  /** CCW plot boundary. Edge i runs boundary[i] → boundary[i+1]. */
  boundary: Vec2[];
  edges: SiteEdge[];
  /** Bearing of true north measured clockwise from plan "up", degrees. */
  northAngle: number;
  features: Record<Id, SiteFeature>;
}

// ----------------------------------------------------------------- project

export type ProjectType = 'villa' | 'house' | 'apartment' | 'duplex' | 'farmhouse' | 'bungalow' | 'townhouse' | 'commercial' | 'renovation' | 'blank';

export type WorkflowStage = 'draft' | 'internal_review' | 'client_review' | 'approved' | 'construction';

export const WORKFLOW: WorkflowStage[] = ['draft', 'internal_review', 'client_review', 'approved', 'construction'];

export interface ProjectMeta {
  name: string;
  type: ProjectType;
  location: { city: string; country: string; lat: number; lon: number; address?: string };
  client: string;
  architect: string;
  /** Design phase shown on cards, e.g. "Concept design". */
  phase: string;
  units: UnitSystem;
  currency: CurrencyCode;
  ruleSetId: string;
  favorite: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  ownerId: Id;
  /** Members and their project role. */
  members: { userId: Id; role: RoleId }[];
}

export type RoleId = 'owner' | 'admin' | 'architect' | 'designer' | 'engineer' | 'contractor' | 'client' | 'viewer';

export interface Scene {
  id: Id;
  name: string;
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number; projection: 'perspective' | 'orthographic' };
  renderStyle: RenderStyle;
  sun: { month: number; day: number; hour: number };
  hiddenLevels: Id[];
  thumbnail?: string;
  createdAt: number;
}

export type RenderStyle = 'realistic' | 'architectural' | 'clay' | 'sketch' | 'wireframe' | 'xray' | 'draft';

export interface Reply { id: Id; authorId: Id; body: string; createdAt: number }

export interface Comment {
  id: Id;
  authorId: Id;
  body: string;
  target?: ElementRef;
  /** Pin location in plan space (and level) when attached to a place. */
  pin?: { levelId: Id; point: Vec2 };
  createdAt: number;
  resolved: boolean;
  replies: Reply[];
  mentions: Id[];
}

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export interface Task {
  id: Id;
  title: string;
  assigneeId: Id;
  due: string;
  status: TaskStatus;
  target?: ElementRef;
  createdAt: number;
}

export interface Approval {
  id: Id;
  subject: string;
  target?: ElementRef;
  stage: WorkflowStage;
  decision: 'approved' | 'rejected' | 'changes_requested' | 'pending';
  requestedById: Id;
  reviewerId: Id;
  at: number;
  note: string;
}

export interface ActivityEntry {
  id: Id;
  at: number;
  actorId: Id;
  action: string;
  summary: string;
  target?: ElementRef;
}

export interface CostSettings {
  currency: CurrencyCode;
  /** Overrides of catalogue rates (per base unit, in INR). */
  rateOverrides: Record<string, number>;
  /** Exchange rate: units of `currency` per 1 INR. */
  fxPerInr: number;
  labourFactor: number;
  contractorMargin: number;
  contingency: number;
  taxRate: number;
  /** Include loose furniture (FF&E) in the project total. */
  includeFFE: boolean;
  /** Free-text provenance shown next to every estimate. */
  source: string;
}

export interface ProjectDoc {
  schemaVersion: number;
  id: Id;
  meta: ProjectMeta;
  site: Site;
  options: DesignOption[];
  activeOptionId: Id;
  scenes: Scene[];
  comments: Comment[];
  tasks: Task[];
  approvals: Approval[];
  activity: ActivityEntry[];
  stage: WorkflowStage;
  cost: CostSettings;
  /** Labels of model changes since the last saved version (for version summaries). */
  pendingChanges: string[];
  /** Rule overrides on top of the selected rule set. */
  ruleOverrides: Record<string, number>;
  /** Traced reference images (hand sketches, scanned plans, imported CAD lines). */
  underlays: Underlay[];
}

export interface Underlay {
  id: Id;
  levelId: Id;
  name: string;
  /** Image data URL, or null for CAD line underlays. */
  image: string | null;
  lines?: { a: Vec2; b: Vec2 }[];
  /** Lower-left corner and width of the image in plan mm (height follows aspect). */
  x: number;
  y: number;
  width: number;
  aspect: number;
  opacity: number;
  visible: boolean;
}

export interface VersionRecord {
  id: Id;
  projectId: Id;
  number: number;
  name: string;
  changes: string[];
  authorId: Id;
  createdAt: number;
  snapshot: ProjectDoc;
  auto: boolean;
}

export interface User { id: Id; name: string; initials: string; color: string; title: string; email: string; orgRole: RoleId }
