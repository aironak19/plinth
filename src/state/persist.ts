/**
 * Local-first persistence. Projects, versions and renders live in IndexedDB so
 * work survives reloads, crashes and offline periods. A SyncAdapter interface
 * marks the seam where a cloud backend plugs in.
 */
import { createStore, del, get, set } from 'idb-keyval';
import type { ProjectDoc, VersionRecord } from '../core/model/types';

const store = createStore('plinth', 'kv');

export interface ProjectIndexEntry {
  id: string;
  name: string;
  city: string;
  type: string;
  phase: string;
  stage: string;
  updatedAt: number;
  createdAt: number;
  favorite: boolean;
  members: string[];
  thumbnail: string;
  progress: number;
  ownerId: string;
  shared: boolean;
  builtUp: number;
  health: number;
  cost: number;
  currency: string;
  sizeBytes: number;
  approvalsPending: { id: string; subject: string; reviewerId: string; at: number }[];
  commentsOpen: { id: string; authorId: string; body: string; at: number; mentionsMe: boolean }[];
  tasksOpen: number;
  activity: { id: string; actorId: string; summary: string; at: number }[];
  levels: number;
  rooms: number;
  stageIndex: number;
}

export interface RenderRecord { id: string; projectId: string; name: string; dataUrl: string; createdAt: number; style: string }

export interface SyncAdapter {
  name: string;
  loadIndex(): Promise<ProjectIndexEntry[]>;
  saveIndex(index: ProjectIndexEntry[]): Promise<void>;
  loadProject(id: string): Promise<ProjectDoc | undefined>;
  saveProject(doc: ProjectDoc): Promise<number>;
  deleteProject(id: string): Promise<void>;
  loadVersions(id: string): Promise<VersionRecord[]>;
  saveVersions(id: string, v: VersionRecord[]): Promise<void>;
}

export const localAdapter: SyncAdapter = {
  name: 'This device',
  async loadIndex() { return (await get<ProjectIndexEntry[]>('index', store)) ?? []; },
  async saveIndex(index) { await set('index', index, store); },
  async loadProject(id) {
    const doc = await get<ProjectDoc>(`project:${id}`, store);
    return doc ? migrate(doc) : undefined;
  },
  async saveProject(doc) {
    await set(`project:${doc.id}`, doc, store);
    try { localStorage.setItem('plinth:recovery', JSON.stringify({ id: doc.id, at: Date.now() })); } catch { /* storage may be unavailable */ }
    return JSON.stringify(doc).length;
  },
  async deleteProject(id) { await del(`project:${id}`, store); await del(`versions:${id}`, store); await del(`renders:${id}`, store); },
  async loadVersions(id) { return (await get<VersionRecord[]>(`versions:${id}`, store)) ?? []; },
  async saveVersions(id, v) { await set(`versions:${id}`, v, store); },
};

export async function loadRenders(projectId: string): Promise<RenderRecord[]> {
  return (await get<RenderRecord[]>(`renders:${projectId}`, store)) ?? [];
}
export async function saveRenders(projectId: string, r: RenderRecord[]) { await set(`renders:${projectId}`, r, store); }
export async function getSetting<T>(key: string): Promise<T | undefined> { return get<T>(`setting:${key}`, store); }
export async function setSetting<T>(key: string, v: T) { await set(`setting:${key}`, v, store); }

/** Schema migrations keep old projects opening forever. */
export function migrate(doc: ProjectDoc): ProjectDoc {
  const d = doc as ProjectDoc & { underlays?: unknown };
  if (!d.underlays) d.underlays = [];
  if (d.cost && d.cost.includeFFE === undefined) d.cost.includeFFE = false;
  return d;
}
