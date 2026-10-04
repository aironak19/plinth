/** Project, site, option and collaboration operations. */
import type {
  Approval, BuildingModel, Comment, ElementRef, Id, ProjectMeta, Scene, SiteEdge, SiteFeature, StyleId, Task, WorkflowStage,
} from '../model/types';
import { defineOp, OpError } from './registry';
import { uid } from '../model/ids';
import type { Vec2 } from '../geometry/vec';
import { ensureCCW, signedArea } from '../geometry/polygon';
import { formatLength } from '../units';
import { userName } from '../model/org';
import { STYLE_BY_ID } from '../catalog/styles';

const vec2 = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };

// ---------------------------------------------------------------------- site

defineOp<{ boundary?: Vec2[]; edges?: SiteEdge[]; northAngle?: number }>({
  type: 'site.update', title: 'Edit site', cap: 'model.edit', model: true,
  description: 'Change the plot boundary (any polygon, mm), per-edge setbacks and road frontage, or north orientation.',
  schema: { type: 'object', properties: { boundary: { type: 'array', items: vec2 }, northAngle: { type: 'number' } } },
  run(ctx, p) {
    const s = ctx.doc.site;
    if (p.boundary) {
      if (p.boundary.length < 3) throw new OpError('Bad plot', 'A plot needs at least three corners.');
      const ccw = signedArea(p.boundary) >= 0;
      s.boundary = ensureCCW(p.boundary);
      const edges = p.edges ?? s.edges;
      const n = s.boundary.length;
      s.edges = Array.from({ length: n }, (_, i) => edges[ccw ? i : (n - 2 - i + n) % n] ?? edges[edges.length - 1] ?? { kind: 'side', setback: 1500 });
      ctx.notes.push('Plot boundary updated');
    } else if (p.edges) { s.edges = p.edges; ctx.notes.push('Setbacks updated'); }
    if (p.northAngle !== undefined) { s.northAngle = ((p.northAngle % 360) + 360) % 360; ctx.notes.push(`North set to ${Math.round(s.northAngle)}°`); }
  },
});

defineOp<{ edge: number; setback?: number; kind?: SiteEdge['kind']; road?: SiteEdge['road'] | null }>({
  type: 'site.edge', title: 'Edit plot edge', cap: 'model.edit', model: true,
  description: 'Set the setback, type (front/side/rear) or road frontage of one plot edge.',
  schema: { type: 'object', properties: { edge: { type: 'number' }, setback: { type: 'number' }, kind: { type: 'string', enum: ['front', 'side', 'rear'] } }, required: ['edge'] },
  run(ctx, p) {
    const e = ctx.doc.site.edges[p.edge];
    if (!e) throw new OpError('No edge', 'That plot edge doesn’t exist.');
    if (p.setback !== undefined) e.setback = Math.max(0, p.setback);
    if (p.kind) e.kind = p.kind;
    if (p.road !== undefined) e.road = p.road ?? undefined;
    ctx.notes.push(`${e.kind[0].toUpperCase() + e.kind.slice(1)} setback ${formatLength(e.setback, ctx.doc.meta.units)}`);
  },
});

defineOp<Omit<SiteFeature, 'id' | 'props'> & { props?: SiteFeature['props'] }>({
  type: 'site.feature.create', title: 'Add site feature', cap: 'model.edit', model: true,
  description: 'Add a pool, driveway, lawn, deck, parking bay, pathway, planter or tree to the site.',
  schema: { type: 'object', properties: { kind: { type: 'string' }, name: { type: 'string' }, polygon: { type: 'array', items: vec2 }, position: vec2 }, required: ['kind', 'name'] },
  run(ctx, p) {
    const f: SiteFeature = { id: uid('sf'), props: {}, ...p };
    ctx.doc.site.features[f.id] = f;
    ctx.created.push({ kind: 'siteFeature', id: f.id });
    ctx.notes.push(`${p.name} added to site`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<SiteFeature, 'id'>> }>({
  type: 'site.feature.update', title: 'Edit site feature', cap: 'model.edit', model: true,
  description: 'Change a site feature.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const f = ctx.doc.site.features[p.id];
    if (!f) throw new OpError('No feature', 'That site feature no longer exists.');
    Object.assign(f, p.patch);
    ctx.notes.push(`${f.name} updated`);
  },
});

// ------------------------------------------------------------------- options

defineOp<{ name: string; description?: string; fromOptionId?: Id; style?: StyleId; building?: BuildingModel; scores?: Record<string, number>; activate?: boolean }>({
  type: 'option.create', title: 'Create design option', cap: 'model.edit', model: false,
  description: 'Create a design alternative that shares the site and project information.',
  schema: { type: 'object', properties: { name: { type: 'string' }, fromOptionId: { type: 'string' } }, required: ['name'] },
  run(ctx, p) {
    const src = ctx.doc.options.find((o) => o.id === (p.fromOptionId ?? ctx.doc.activeOptionId));
    const building = p.building ?? (src ? JSON.parse(JSON.stringify(src.building)) : undefined);
    if (!building) throw new OpError('No source', 'Nothing to copy from.');
    const id = uid('opt');
    ctx.doc.options.push({ id, name: p.name, description: p.description ?? '', style: p.style ?? (src?.style ?? 'modern'), building, createdAt: Date.now(), scores: p.scores });
    if (p.activate !== false) ctx.doc.activeOptionId = id;
    ctx.notes.push(`Design option “${p.name}” created`);
  },
});

defineOp<{ id: Id }>({
  type: 'option.switch', title: 'Switch design option', cap: 'model.view', model: false,
  description: 'Make a design option active.',
  schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  run(ctx, p) {
    const o = ctx.doc.options.find((x) => x.id === p.id);
    if (!o) throw new OpError('No option', 'That option no longer exists.');
    ctx.doc.activeOptionId = p.id;
    ctx.notes.push(`Switched to ${o.name}`);
  },
});

defineOp<{ id: Id; name?: string; description?: string }>({
  type: 'option.update', title: 'Rename design option', cap: 'model.edit', model: false,
  description: 'Rename or describe a design option.',
  schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id'] },
  run(ctx, p) {
    const o = ctx.doc.options.find((x) => x.id === p.id);
    if (!o) throw new OpError('No option', 'That option no longer exists.');
    if (p.name) o.name = p.name;
    if (p.description !== undefined) o.description = p.description;
    ctx.notes.push(`Option renamed to ${o.name}`);
  },
});

defineOp<{ id: Id }>({
  type: 'option.delete', title: 'Delete design option', cap: 'model.edit', model: false,
  description: 'Delete a design option (the last remaining option cannot be deleted).',
  schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  run(ctx, p) {
    if (ctx.doc.options.length <= 1) throw new OpError('Last option', 'A project needs at least one design option.');
    const name = ctx.doc.options.find((o) => o.id === p.id)?.name;
    ctx.doc.options = ctx.doc.options.filter((o) => o.id !== p.id);
    if (ctx.doc.activeOptionId === p.id) ctx.doc.activeOptionId = ctx.doc.options[0].id;
    ctx.notes.push(`Option ${name} deleted`);
  },
});

defineOp<{ building: BuildingModel; style?: StyleId; label?: string }>({
  type: 'building.replace', title: 'Replace design', cap: 'model.edit', model: true,
  description: 'Replace the active option’s building with a generated or restored one.',
  schema: { type: 'object', properties: { building: { type: 'object' } }, required: ['building'] },
  run(ctx, p) {
    const o = ctx.doc.options.find((x) => x.id === ctx.doc.activeOptionId)!;
    o.building = p.building;
    if (p.style) o.style = p.style;
    ctx.notes.push(p.label ?? 'Design replaced');
  },
});

// ------------------------------------------------------------------- project

defineOp<{ patch: Partial<ProjectMeta> }>({
  type: 'project.update', title: 'Edit project details', cap: 'project.manage', model: false,
  description: 'Change project name, location, client, units, currency, rule set or phase.',
  schema: { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'] },
  run(ctx, p) {
    Object.assign(ctx.doc.meta, p.patch);
    if (p.patch.currency) ctx.doc.cost.currency = p.patch.currency;
    ctx.notes.push('Project details updated');
  },
});

defineOp<{ key: string; value: number | null }>({
  type: 'project.rule', title: 'Override a rule', cap: 'project.manage', model: false,
  description: 'Override a value of the selected regional rule set for this project.',
  schema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'number' } }, required: ['key'] },
  run(ctx, p) {
    if (p.value === null) delete ctx.doc.ruleOverrides[p.key];
    else ctx.doc.ruleOverrides[p.key] = p.value;
    ctx.notes.push('Rule override updated');
  },
});

defineOp<{ patch: Partial<ProjectDocCost> }>({
  type: 'cost.update', title: 'Edit cost settings', cap: 'project.manage', model: false,
  description: 'Change currency, exchange rate, labour factor, margins or override material rates.',
  schema: { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'] },
  run(ctx, p) {
    Object.assign(ctx.doc.cost, p.patch);
    ctx.notes.push('Cost settings updated');
  },
});
type ProjectDocCost = import('../model/types').CostSettings;

// ------------------------------------------------------------- collaboration

defineOp<{ body: string; target?: ElementRef; pin?: Comment['pin']; mentions?: Id[] }>({
  type: 'comment.add', title: 'Comment', cap: 'comment', model: false,
  description: 'Add a comment, optionally attached to an element or a location.',
  schema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
  run(ctx, p) {
    if (!p.body.trim()) throw new OpError('Empty', 'Write something first.');
    const mentions = p.mentions ?? [...p.body.matchAll(/@(\w+)/g)].map((m) => m[1].toLowerCase()).map((n) => `u-${n}`);
    const c: Comment = { id: uid('cm'), authorId: ctx.actor, body: p.body.trim(), target: p.target, pin: p.pin, createdAt: Date.now(), resolved: false, replies: [], mentions };
    ctx.doc.comments.unshift(c);
    ctx.notes.push(`${userName(ctx.actor)} commented`);
  },
});

defineOp<{ id: Id; body: string }>({
  type: 'comment.reply', title: 'Reply', cap: 'comment', model: false, description: 'Reply to a comment.',
  schema: { type: 'object', properties: { id: { type: 'string' }, body: { type: 'string' } }, required: ['id', 'body'] },
  run(ctx, p) {
    const c = ctx.doc.comments.find((x) => x.id === p.id);
    if (!c) throw new OpError('No comment', 'That comment was removed.');
    c.replies.push({ id: uid('rp'), authorId: ctx.actor, body: p.body.trim(), createdAt: Date.now() });
    ctx.notes.push(`${userName(ctx.actor)} replied`);
  },
});

defineOp<{ id: Id; resolved: boolean }>({
  type: 'comment.resolve', title: 'Resolve comment', cap: 'comment', model: false, description: 'Resolve or reopen a comment.',
  schema: { type: 'object', properties: { id: { type: 'string' }, resolved: { type: 'boolean' } }, required: ['id', 'resolved'] },
  run(ctx, p) {
    const c = ctx.doc.comments.find((x) => x.id === p.id);
    if (!c) throw new OpError('No comment', 'That comment was removed.');
    c.resolved = p.resolved;
    ctx.notes.push(p.resolved ? 'Comment resolved' : 'Comment reopened');
  },
});

defineOp<Omit<Task, 'id' | 'createdAt' | 'status'> & { status?: Task['status'] }>({
  type: 'task.add', title: 'Add task', cap: 'task.manage', model: false, description: 'Create a lightweight project task.',
  schema: { type: 'object', properties: { title: { type: 'string' }, assigneeId: { type: 'string' }, due: { type: 'string' } }, required: ['title', 'assigneeId', 'due'] },
  run(ctx, p) {
    ctx.doc.tasks.unshift({ id: uid('tk'), createdAt: Date.now(), status: p.status ?? 'todo', ...p });
    ctx.notes.push(`Task “${p.title}” assigned to ${userName(p.assigneeId)}`);
  },
});

defineOp<{ id: Id; patch: Partial<Omit<Task, 'id'>> }>({
  type: 'task.update', title: 'Update task', cap: 'task.manage', model: false, description: 'Update a task.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] },
  run(ctx, p) {
    const t = ctx.doc.tasks.find((x) => x.id === p.id);
    if (!t) throw new OpError('No task', 'That task was removed.');
    Object.assign(t, p.patch);
    ctx.notes.push(`Task “${t.title}” → ${t.status.replace('_', ' ')}`);
  },
});

defineOp<{ subject: string; reviewerId: Id; target?: ElementRef; stage?: WorkflowStage }>({
  type: 'approval.request', title: 'Request approval', cap: 'project.share', model: false, description: 'Ask someone to approve the design, a drawing, a material or a room.',
  schema: { type: 'object', properties: { subject: { type: 'string' }, reviewerId: { type: 'string' } }, required: ['subject', 'reviewerId'] },
  run(ctx, p) {
    const a: Approval = { id: uid('ap'), subject: p.subject, target: p.target, stage: p.stage ?? ctx.doc.stage, decision: 'pending', requestedById: ctx.actor, reviewerId: p.reviewerId, at: Date.now(), note: '' };
    ctx.doc.approvals.unshift(a);
    ctx.notes.push(`Approval requested from ${userName(p.reviewerId)}: ${p.subject}`);
  },
});

defineOp<{ id: Id; decision: Approval['decision']; note?: string }>({
  type: 'approval.decide', title: 'Approve or reject', cap: 'approve', model: false, description: 'Record an approval decision.',
  schema: { type: 'object', properties: { id: { type: 'string' }, decision: { type: 'string' } }, required: ['id', 'decision'] },
  run(ctx, p) {
    const a = ctx.doc.approvals.find((x) => x.id === p.id);
    if (!a) throw new OpError('No approval', 'That approval request was withdrawn.');
    a.decision = p.decision; a.note = p.note ?? ''; a.at = Date.now(); a.reviewerId = ctx.actor;
    ctx.notes.push(`${userName(ctx.actor)} ${p.decision === 'approved' ? 'approved' : p.decision === 'rejected' ? 'rejected' : 'requested changes on'} ${a.subject}`);
  },
});

defineOp<{ stage: WorkflowStage }>({
  type: 'workflow.stage', title: 'Move workflow stage', cap: 'project.manage', model: false, description: 'Move the project to a workflow stage.',
  schema: { type: 'object', properties: { stage: { type: 'string' } }, required: ['stage'] },
  run(ctx, p) {
    ctx.doc.stage = p.stage;
    ctx.notes.push(`Project moved to ${p.stage.replace('_', ' ')}`);
  },
});

defineOp<{ scene: Omit<Scene, 'id' | 'createdAt'> }>({
  type: 'scene.save', title: 'Save scene', cap: 'model.view', model: false, description: 'Save the current camera, style and sun as a named scene.',
  schema: { type: 'object', properties: { scene: { type: 'object' } }, required: ['scene'] },
  run(ctx, p) {
    ctx.doc.scenes.push({ id: uid('sc'), createdAt: Date.now(), ...p.scene });
    ctx.notes.push(`Scene “${p.scene.name}” saved`);
  },
});

defineOp<{ id: Id }>({
  type: 'scene.delete', title: 'Delete scene', cap: 'model.view', model: false, description: 'Delete a saved scene.',
  schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  run(ctx, p) {
    ctx.doc.scenes = ctx.doc.scenes.filter((s) => s.id !== p.id);
    ctx.notes.push('Scene deleted');
  },
});

defineOp<{ underlay: import('../model/types').Underlay }>({
  type: 'underlay.add', title: 'Add underlay', cap: 'model.edit', model: false,
  description: 'Add a reference image or CAD linework to trace over.',
  schema: { type: 'object', properties: { underlay: { type: 'object' } }, required: ['underlay'] },
  run(ctx, p) {
    ctx.doc.underlays.push(p.underlay);
    ctx.notes.push(`Underlay “${p.underlay.name}” added`);
  },
});

defineOp<{ id: Id; patch: Partial<import('../model/types').Underlay> | null }>({
  type: 'underlay.update', title: 'Edit underlay', cap: 'model.edit', model: false,
  description: 'Move, scale, fade, hide or remove (patch = null) an underlay.',
  schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id'] },
  run(ctx, p) {
    const i = ctx.doc.underlays.findIndex((u) => u.id === p.id);
    if (i < 0) throw new OpError('No underlay', 'That underlay was removed.');
    if (p.patch === null) { ctx.doc.underlays.splice(i, 1); ctx.notes.push('Underlay removed'); return; }
    Object.assign(ctx.doc.underlays[i], p.patch);
    ctx.notes.push('Underlay adjusted');
  },
});

void STYLE_BY_ID;
