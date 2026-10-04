/**
 * Command-first architecture.
 *
 * Every change to a project is an *operation*: a named, typed, permission-
 * checked function over the canonical model. The mouse, keyboard shortcuts,
 * the command palette, Architect AI and the public API all produce the same
 * OpCalls — so every action is undoable, auditable and scriptable.
 */
import { enablePatches, produceWithPatches, type Patch, type Draft } from 'immer';
import type { BuildingModel, ElementRef, Id, ProjectDoc } from '../model/types';
import type { Capability } from '../model/org';
import { can } from '../model/org';
import { resolveRules, type RuleSet } from '../rules/rulesets';
import { uid } from '../model/ids';
import type { RoleId } from '../model/types';

enablePatches();

export interface OpCall<P = Record<string, unknown>> { type: string; params: P }

export interface OpContext {
  doc: Draft<ProjectDoc>;
  /** Active design option's building (draft). */
  b: Draft<BuildingModel>;
  actor: Id;
  rules: RuleSet;
  /** Human-readable change descriptions collected while running. */
  notes: string[];
  created: ElementRef[];
}

export interface JsonSchema { type: string; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown }

export interface OpDef<P = any> {
  type: string;
  title: string;
  description: string;
  cap: Capability;
  /** Model edits feed version summaries; collaboration ops do not. */
  model: boolean;
  /** JSON schema for the params (used by the API and AI tool definitions). */
  schema: JsonSchema;
  run(ctx: OpContext, p: P): void;
}

const REGISTRY = new Map<string, OpDef>();

export function defineOp<P>(def: OpDef<P>): OpDef<P> {
  REGISTRY.set(def.type, def as OpDef);
  return def;
}

export function getOp(type: string): OpDef | undefined { return REGISTRY.get(type); }
export function allOps(): OpDef[] { return [...REGISTRY.values()]; }

export class OpError extends Error {
  constructor(message: string, public userMessage: string = message, public detail?: string) { super(message); }
}

export interface ApplyResult {
  doc: ProjectDoc;
  patches: Patch[];
  inverse: Patch[];
  notes: string[];
  created: ElementRef[];
}

export function applyOps(doc: ProjectDoc, calls: OpCall[], opts: { actor: Id; role: RoleId; label?: string; record?: boolean }): ApplyResult {
  for (const c of calls) {
    const def = REGISTRY.get(c.type);
    if (!def) throw new OpError(`Unknown operation ${c.type}`, `That action isn't available.`);
    if (!can(opts.role, def.cap)) throw new OpError(`Permission denied for ${c.type}`, `Your role can't ${def.title.toLowerCase()}.`);
  }
  const notes: string[] = [];
  const created: ElementRef[] = [];
  const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
    const rules = resolveRules(draft.meta.ruleSetId, draft.ruleOverrides);
    let isModel = false;
    for (const c of calls) {
      const def = REGISTRY.get(c.type)!;
      const opt = draft.options.find((o) => o.id === draft.activeOptionId) ?? draft.options[0];
      const ctx: OpContext = { doc: draft, b: opt.building, actor: opts.actor, rules, notes, created };
      def.run(ctx, c.params);
      if (def.model) isModel = true;
    }
    if (opts.record !== false) {
      const summary = opts.label ?? notes[0] ?? REGISTRY.get(calls[0]?.type)?.title ?? 'Change';
      draft.activity.unshift({ id: uid('act'), at: Date.now(), actorId: opts.actor, action: calls[0]?.type ?? 'change', summary, target: created[0] });
      if (draft.activity.length > 400) draft.activity.length = 400;
      if (isModel) {
        for (const n of notes.length ? notes : [summary]) if (!draft.pendingChanges.includes(n)) draft.pendingChanges.push(n);
        if (draft.pendingChanges.length > 60) draft.pendingChanges.splice(0, draft.pendingChanges.length - 60);
      }
      draft.meta.updatedAt = Date.now();
    }
  });
  return { doc: next, patches, inverse, notes, created };
}

/** AI / API tool definitions generated from the registry. */
export function toolDefinitions(filter?: (d: OpDef) => boolean) {
  return allOps().filter((d) => d.model && (!filter || filter(d))).map((d) => ({
    name: d.type.replace(/\./g, '_'),
    description: `${d.title}. ${d.description}`,
    input_schema: d.schema,
  }));
}
