/**
 * Organisation, roles & permissions (RBAC) and plan tiers.
 * Permissions are enforced by the operation dispatcher — not just hidden in UI.
 */
import type { RoleId, User } from './types';

export type Capability =
  | 'model.edit' | 'model.view' | 'comment' | 'approve' | 'task.manage' | 'version.manage'
  | 'project.manage' | 'project.share' | 'docs.export' | 'cost.view' | 'org.admin';

export const ROLES: { id: RoleId; name: string; description: string; caps: Capability[] }[] = [
  { id: 'owner', name: 'Organization owner', description: 'Full access, including billing and security.', caps: ['model.edit', 'model.view', 'comment', 'approve', 'task.manage', 'version.manage', 'project.manage', 'project.share', 'docs.export', 'cost.view', 'org.admin'] },
  { id: 'admin', name: 'Admin', description: 'Manages people, templates and libraries.', caps: ['model.edit', 'model.view', 'comment', 'approve', 'task.manage', 'version.manage', 'project.manage', 'project.share', 'docs.export', 'cost.view', 'org.admin'] },
  { id: 'architect', name: 'Architect', description: 'Creates and edits projects.', caps: ['model.edit', 'model.view', 'comment', 'approve', 'task.manage', 'version.manage', 'project.manage', 'project.share', 'docs.export', 'cost.view'] },
  { id: 'designer', name: 'Designer', description: 'Edits design, interiors and materials.', caps: ['model.edit', 'model.view', 'comment', 'task.manage', 'version.manage', 'docs.export', 'cost.view'] },
  { id: 'engineer', name: 'Engineer', description: 'Reviews technical information.', caps: ['model.view', 'comment', 'task.manage', 'docs.export', 'cost.view'] },
  { id: 'contractor', name: 'Contractor', description: 'Views construction information and quantities.', caps: ['model.view', 'comment', 'docs.export', 'cost.view'] },
  { id: 'client', name: 'Client', description: 'Views, comments and approves.', caps: ['model.view', 'comment', 'approve'] },
  { id: 'viewer', name: 'Viewer', description: 'Read-only.', caps: ['model.view'] },
];

export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, (typeof ROLES)[number]>;

export function can(role: RoleId, cap: Capability): boolean {
  return ROLE_BY_ID[role]?.caps.includes(cap) ?? false;
}

export const USERS: User[] = [
  { id: 'u-ronak', name: 'Ronak Mehta', initials: 'RM', color: '#3358d4', title: 'Principal Architect', email: 'ronak@studio.example', orgRole: 'owner' },
  { id: 'u-priya', name: 'Priya Nair', initials: 'PN', color: '#b2643f', title: 'Interior Designer', email: 'priya@studio.example', orgRole: 'designer' },
  { id: 'u-arjun', name: 'Arjun Rao', initials: 'AR', color: '#3f8a6a', title: 'Structural Engineer', email: 'arjun@studio.example', orgRole: 'engineer' },
  { id: 'u-meera', name: 'Meera Shah', initials: 'MS', color: '#8a5bb5', title: 'Project Architect', email: 'meera@studio.example', orgRole: 'architect' },
  { id: 'u-vikram', name: 'Vikram Builders', initials: 'VB', color: '#9a7b2f', title: 'Contractor', email: 'site@vikram.example', orgRole: 'contractor' },
  { id: 'u-client', name: 'The Kapoors', initials: 'KP', color: '#c0476b', title: 'Client', email: 'family@client.example', orgRole: 'client' },
];

export const USER_BY_ID = Object.fromEntries(USERS.map((u) => [u.id, u])) as Record<string, User>;
export const ME = 'u-ronak';

export function userName(id: string): string {
  return USER_BY_ID[id]?.name.split(' ')[0] ?? 'Someone';
}

/** SaaS tiers live in configuration; the app only ever asks `hasFeature`. */
export const PLANS = [
  { id: 'free', name: 'Free', projects: 3, storageGb: 1, features: ['plan', '3d', 'docs.basic'] },
  { id: 'pro', name: 'Professional', projects: 50, storageGb: 50, features: ['plan', '3d', 'docs.basic', 'docs.pdf', 'cost', 'ai', 'versions', 'ifc'] },
  { id: 'studio', name: 'Studio', projects: 500, storageGb: 500, features: ['plan', '3d', 'docs.basic', 'docs.pdf', 'cost', 'ai', 'versions', 'ifc', 'teams', 'templates', 'approvals'] },
  { id: 'enterprise', name: 'Enterprise', projects: Infinity, storageGb: Infinity, features: ['*'] },
] as const;

export const CURRENT_PLAN = 'studio';

export function hasFeature(feature: string, planId: string = CURRENT_PLAN): boolean {
  const plan = PLANS.find((p) => p.id === planId);
  return !!plan && ((plan.features as readonly string[]).includes('*') || (plan.features as readonly string[]).includes(feature));
}
