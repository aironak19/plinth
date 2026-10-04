/**
 * Command registry — the single list of user-invocable actions. The command
 * palette, keyboard shortcuts, menus and Architect AI's "do it for me" all call
 * these, which in turn dispatch model operations.
 */
import { useStore, type Space } from '../state/store';
import type { ElementRef } from '../core/model/types';
import { activeBuilding, levelsSorted } from '../core/model/query';
import { STYLES } from '../core/catalog/styles';

export interface Command {
  id: string;
  title: string;
  group: 'Create' | 'View' | 'Navigate' | 'Edit' | 'Project' | 'Export' | 'AI' | 'Style';
  keys?: string;
  icon?: string;
  when?: () => boolean;
  run: () => void;
}

const S = () => useStore.getState();
const inProject = () => !!S().doc && S().route.name === 'project';
const space = (sp: Space) => () => { const s = S(); if (s.doc) s.navigate({ name: 'project', id: s.doc.id, space: sp }); };
const design = (fn: () => void) => () => { space('design')(); fn(); };
const sel = (): ElementRef[] => S().selection;

export function getCommands(): Command[] {
  const s = S();
  const cmds: Command[] = [
    { id: 'tool.wall', title: 'Create wall', group: 'Create', keys: 'W', icon: 'wall', when: inProject, run: design(() => S().setTool('wall')) },
    { id: 'tool.room', title: 'Create room', group: 'Create', keys: 'R', icon: 'room', when: inProject, run: design(() => S().setTool('room')) },
    { id: 'tool.door', title: 'Add door', group: 'Create', keys: 'D', icon: 'door', when: inProject, run: design(() => S().setTool('door')) },
    { id: 'tool.window', title: 'Add window', group: 'Create', keys: 'N', icon: 'window', when: inProject, run: design(() => S().setTool('window')) },
    { id: 'tool.stair', title: 'Add stair', group: 'Create', keys: 'S', icon: 'stair', when: inProject, run: design(() => S().setTool('stair')) },
    { id: 'tool.column', title: 'Add column', group: 'Create', keys: 'O', icon: 'column', when: inProject, run: design(() => S().setTool('column')) },
    { id: 'tool.comment', title: 'Add comment', group: 'Create', keys: 'K', icon: 'comment', when: inProject, run: design(() => S().setTool('comment')) },
    { id: 'level.add', title: 'Add level on top', group: 'Create', icon: 'level', when: inProject, run: () => { const b = activeBuilding(S().doc!); const ls = levelsSorted(b); const names = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor']; S().dispatch([{ type: 'level.create', params: { name: names[ls.length] ?? `Level ${ls.length}`, copyExteriorFrom: ls[ls.length - 1]?.id } }]); } },
    { id: 'option.new', title: 'Create design option', group: 'Create', icon: 'option', when: inProject, run: () => S().dispatch([{ type: 'option.create', params: { name: `Option ${String.fromCharCode(65 + S().doc!.options.length)}` } }]) },
    { id: 'version.new', title: 'Create version', group: 'Project', keys: '⌘S', icon: 'version', when: inProject, run: () => void S().createVersion() },
    { id: 'view.plan', title: 'Show plan', group: 'View', keys: 'P', icon: 'plan', when: inProject, run: design(() => S().setView('plan')) },
    { id: 'view.3d', title: 'Show 3D', group: 'View', keys: '3', icon: '3d', when: inProject, run: design(() => S().setView('3d')) },
    { id: 'view.split', title: 'Split plan & 3D', group: 'View', keys: '2', icon: 'split', when: inProject, run: design(() => S().setView('split')) },
    { id: 'view.elevation', title: 'Generate elevation', group: 'View', keys: 'E', icon: 'docs', when: inProject, run: () => { space('docs')(); window.dispatchEvent(new CustomEvent('plinth:sheet', { detail: 'A-201' })); } },
    { id: 'view.section', title: 'Create section', group: 'View', icon: 'docs', when: inProject, run: () => { space('docs')(); window.dispatchEvent(new CustomEvent('plinth:sheet', { detail: 'A-301' })); } },
    { id: 'view.dims', title: s.layers.dimensions ? 'Hide dimensions' : 'Show dimensions', group: 'View', icon: 'ruler', when: inProject, run: () => S().set('layers', { ...S().layers, dimensions: !S().layers.dimensions }) },
    { id: 'view.furniture', title: s.layers.furniture ? 'Hide furniture' : 'Show furniture', group: 'View', icon: 'sofa', when: inProject, run: () => S().set('layers', { ...S().layers, furniture: !S().layers.furniture }) },
    { id: 'view.present', title: 'Present to client', group: 'View', icon: 'present', when: inProject, run: () => S().set('presentOpen', true) },
    { id: 'view.theme', title: s.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', group: 'View', icon: 'theme', run: () => S().setTheme(S().theme === 'dark' ? 'light' : 'dark') },
    { id: 'render.exterior', title: 'Render exterior', group: 'Export', icon: 'camera', when: inProject, run: design(() => { S().setView('3d'); setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:render')), 400); }) },
    { id: 'export.pdf', title: 'Export drawing set (PDF)', group: 'Export', icon: 'pdf', when: inProject, run: () => { space('docs')(); setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:export', { detail: 'pdf' })), 300); } },
    { id: 'export.dxf', title: 'Export plan (DXF)', group: 'Export', icon: 'pdf', when: inProject, run: () => { space('docs')(); setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:export', { detail: 'dxf' })), 300); } },
    { id: 'export.ifc', title: 'Export BIM model (IFC)', group: 'Export', icon: 'pdf', when: inProject, run: () => { space('docs')(); setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:export', { detail: 'ifc' })), 300); } },
    { id: 'export.gltf', title: 'Export 3D model (glTF)', group: 'Export', icon: 'camera', when: inProject, run: design(() => { S().setView('3d'); setTimeout(() => window.dispatchEvent(new CustomEvent('plinth:export3d', { detail: 'gltf' })), 400); }) },
    { id: 'ai.open', title: 'Ask Architect AI', group: 'AI', keys: '⌘J', icon: 'ai', when: inProject, run: design(() => S().set('aiOpen', true)) },
    { id: 'ai.check', title: 'Find conflicts in this design', group: 'AI', icon: 'health', when: inProject, run: space('analysis') },
    { id: 'go.site', title: 'Open site planning', group: 'Navigate', icon: 'site', when: inProject, run: space('site') },
    { id: 'go.docs', title: 'Open documentation', group: 'Navigate', icon: 'docs', when: inProject, run: space('docs') },
    { id: 'go.cost', title: 'Open quantities & cost', group: 'Navigate', icon: 'cost', when: inProject, run: space('cost') },
    { id: 'go.analysis', title: 'Open analysis & design health', group: 'Navigate', icon: 'health', when: inProject, run: space('analysis') },
    { id: 'go.collab', title: 'Open collaboration', group: 'Navigate', icon: 'comment', when: inProject, run: space('collab') },
    { id: 'go.versions', title: 'Open version history', group: 'Navigate', icon: 'version', when: inProject, run: space('versions') },
    { id: 'go.library', title: 'Open asset & material library', group: 'Navigate', icon: 'sofa', when: inProject, run: space('library') },
    { id: 'go.settings', title: 'Project settings, team & permissions', group: 'Navigate', icon: 'settings', when: inProject, run: space('settings') },
    { id: 'go.home', title: 'Go to dashboard', group: 'Navigate', icon: 'home', run: () => S().navigate({ name: 'home', section: 'home' }) },
    { id: 'go.admin', title: 'Organization administration', group: 'Navigate', icon: 'shield', run: () => S().navigate({ name: 'home', section: 'admin' }) },
    { id: 'project.new', title: 'New project', group: 'Project', icon: 'plus', run: () => S().set('wizardOpen', true) },
    { id: 'edit.undo', title: 'Undo', group: 'Edit', keys: '⌘Z', icon: 'undo', when: () => S().past.length > 0, run: () => S().undo() },
    { id: 'edit.redo', title: 'Redo', group: 'Edit', keys: '⇧⌘Z', icon: 'redo', when: () => S().future.length > 0, run: () => S().redo() },
    { id: 'edit.delete', title: 'Delete selection', group: 'Edit', keys: '⌫', icon: 'trash', when: () => sel().length > 0, run: () => S().dispatch([{ type: 'element.delete', params: { refs: sel() } }]) },
    { id: 'edit.copy', title: 'Copy selection', group: 'Edit', keys: 'C', icon: 'copy', when: () => sel().length > 0, run: () => S().dispatch([{ type: 'element.duplicate', params: { refs: sel(), delta: { x: 600, y: -600 } } }]) },
    { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'View', keys: '?', icon: 'keyboard', run: () => S().set('shortcutsOpen', true) },
  ];
  for (const st of STYLES) cmds.push({ id: `style.${st.id}`, title: `Apply ${st.name} style`, group: 'Style', icon: 'palette', when: inProject, run: () => S().dispatch([{ type: 'style.apply', params: { styleId: st.id } }]) });
  return cmds.filter((c) => !c.when || c.when());
}
