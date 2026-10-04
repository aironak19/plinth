import {
  Box, BrickWall, Building, Calculator, Camera, Columns3, Command, Copy, DoorOpen, FileClock, FileText, Footprints, GitBranch, House, Keyboard,
  Layers, LandPlot, MessageSquare, Palette, Plus, Presentation, Redo2, Ruler, Settings, Shield, Sofa, Sparkles, Square, SquareSplitHorizontal,
  Trash, Undo2, AppWindow, Activity, Map, Moon, Search, type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  wall: BrickWall, room: Square, door: DoorOpen, window: AppWindow, stair: Footprints, column: Columns3, comment: MessageSquare, level: Layers,
  option: GitBranch, version: FileClock, plan: Map, '3d': Box, split: SquareSplitHorizontal, docs: FileText, ruler: Ruler, sofa: Sofa,
  present: Presentation, theme: Moon, camera: Camera, pdf: FileText, ai: Sparkles, health: Activity, site: LandPlot, cost: Calculator,
  settings: Settings, home: House, shield: Shield, plus: Plus, undo: Undo2, redo: Redo2, trash: Trash, copy: Copy, keyboard: Keyboard,
  palette: Palette, building: Building, command: Command, search: Search,
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Command;
  return <C size={size} strokeWidth={1.75} />;
}
