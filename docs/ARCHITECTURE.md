# Plinth architecture

## Principles

1. **One source of truth.** The `ProjectDoc` is the only stored design data. Rooms, outlines, poché, 3D solids, drawings, schedules, quantities, cost, health and analysis are pure functions of it.
2. **One action updates everything that depends on it.** Operations keep the model consistent (joined wall ends travel together, openings re-anchor, stretches move everything beyond a plane, level height changes lift the levels above). Everything downstream re-derives.
3. **Command-first.** Every mutation is an `OpCall { type, params }` run through `applyOps`. It is permission-checked, applied with immer `produceWithPatches` (undo/redo), logged to the audit trail and summarised for version history.
4. **Assistive AI.** AI produces OpCalls only. They are previewed on a scratch copy with a measured impact and applied only on explicit approval.
5. **No hard-coded regulations.** Every check reads from a `RuleSet` with project overrides.

## Data model (`src/core/model/types.ts`)

```
ProjectDoc
├── meta            name, location (lat/lon), type, units, currency, rule set, members & roles
├── site            CCW boundary polygon, per-edge {kind, setback, road}, northAngle, features
├── options[]       design options (shared site & brief)
│   └── building    levels · walls · doors · windows · rooms (tags) · stairs · roofs · columns · beams · furniture
├── scenes          saved cameras + style + sun
├── comments · tasks · approvals · activity (audit) · stage
├── cost            currency, FX, rate overrides, margins, FF&E switch, source label
├── ruleOverrides · underlays · pendingChanges
VersionRecord       full snapshots + change summaries, stored separately
```

All lengths are millimetres. Plan space is x → east, y → north; 3D adds z up.

## Derivation pipeline (`src/core/derive`)

| Module | From | To |
|---|---|---|
| `walls.ts` | walls on a level | mitred outline quads (L-joins, T-joins, continuations, caps) |
| `level.ts` | walls + room tags + openings | planar graph → faces → net room polygons, areas, dims; footprint; poché (union − openings). Memoised on input identity, so editing one level never recomputes another. |
| `solids.ts` | building + site | planar faces with holes and reveals. Feeds the 3D viewport, elevations, sections and exports. |
| `site.ts` | site + building | buildable zone (per-edge capsule buffers subtracted from any polygon), coverage, FAR, setbacks, violations |
| `stairs.ts` / `roof.ts` | element + level | steps, landings, risers/treads; roof planes, ridges, hips, valleys, gutters, downpipes |
| `quantities.ts` / `cost.ts` | building | takeoff lines (net of openings) → priced estimate, alternatives |
| `validation.ts` | everything | `Issue[]` with element refs, locations and previewable fixes → Design Health |
| `analysis.ts` / `sun.ts` | building + location | daylight ratios, orientations, door-graph circulation (Dijkstra), solar position |

## Operations (`src/core/ops`)

`defineOp({ type, title, description, cap, model, schema, run })` registers an operation. The JSON schema doubles as the public API contract and the AI tool definition (`toolDefinitions()`). Model operations include `wall.create/update/move/moveEnd/setLength/split`, `room.create/tag/update/resize/split/carve`, `door.*`, `window.*`, `stair.*`, `roof.*`, `column.*`, `furniture.*`, `element.move/rotate/delete/duplicate`, `level.*`, `material.apply/replaceGlobal`, `style.apply`, `building.translate`, `model.stretch`, `site.*`, `option.*`, plus project, cost, comment, task, approval, workflow, scene and underlay operations.

## UI (`src/ui`)

- **Shell:** dashboard, wizard, project top bar (options, workflow stage, save state, presence, view-as role), module rail, ⌘K palette, toasts, keyboard shortcuts.
- **Design:** `PlanView` (SVG, screen-constant strokes, live drag preview by applying the pending op to a scratch doc), `Viewport3D` (three.js; rebuilds on model change, highlights selection without rebuilding), `Inspector` (progressive disclosure), `AIPanel`.
- **Spaces:** site, docs, cost, analysis (generative design in a Web Worker), collaboration, versions, library, settings; admin and presentation.

## Landscape (`src/core/catalog/plants.ts`, `src/core/generate/landscape.ts`, `src/core/derive/landscape.ts`)

Landscape is not a separate module bolted on; it uses the same three ideas as the building.

- **One model.** Surfaces (lawn, beds, paving, decks, gravel, pools, ponds) are `SiteFeature` polygons; hedges, fences and garden walls are `SiteFeature` paths; plants and garden objects are ordinary placed assets. A plant asset carries its `Plant` record (botanical name, mature size, sun, water, climate, spacing), and that record alone drives its plan symbol, its 3D model, the planting schedule and its cost.
- **Operations.** "Design my garden" (`planLandscape`) is a pure function from the document to a list of the same operations the mouse issues (`site.feature.create`, `block.place`, `furniture.create`). It reads the plot, road, footprint and front door, filters each style's palette to the project's climate, and tags what it creates so a re-run replaces only its own work.
- **Derivation.** `analyzeLandscape` computes softscape / hardscape, permeable ground, canopy cover, irrigation demand and plant counts; quantities, cost, the L-series sheets and the landscape health rules all read from it.

## Rendering (`src/ui/three`)

- `environment.ts` — a physical sky driven by the real sun position. The sky is baked (without the sun disc) into the image-based lighting environment whenever the time or weather changes, so ambient colour, fog and exposure follow the hour. A twilight dome and stars fade in below the horizon; `setNight` switches window glow and lamps.
- `textures.ts` — every pattern paints an albedo canvas and a height field; the normal map is derived from the height field. No texture downloads.
- `vegetation.ts` — each growth form is a skeleton of tubes, leafy puffs, arching strips and cards, rendered as alpha-tested leaf cards (realistic) or solids (architectural, clay, sketch). Geometry is cached per species, variant and season.
- `post.ts` — MSAA render target → GTAO → bloom → tone mapping. Leaf cards are left out of the occlusion pre-pass.
- Photoreal mode hands the same scene to `three-gpu-pathtracer` (loaded on demand), with the sky supplied as a cube map and an edge-preserving denoise on the way to the screen.

## Performance

- Immutable model with structural sharing, plus per-level memoisation keyed on object identity.
- Broad-phase grid for planar-graph intersections; spatial hash for node merging.
- Heavy work (generative design) runs in a module Web Worker; three.js, PDF and exporters are code-split.
- 3D selection highlighting swaps materials without re-triangulating.

## Persistence & sync

`SyncAdapter` (`src/state/persist.ts`) abstracts storage. The bundled `localAdapter` uses IndexedDB, autosaves 700 ms after the last change, writes a recovery marker, shows an offline state, and syncs other open windows through `BroadcastChannel`. A cloud adapter (REST or CRDT) implements the same interface.

## Extending Plinth

- **Rule packs:** add a `RuleSet` to `src/core/rules/rulesets.ts`, or load one at runtime.
- **Operations:** `defineOp(...)`. It appears in the API console, the AI tools and the audit log automatically.
- **Assets & materials:** add recipes to `catalog/assets.ts` / `catalog/materials.ts`. The plan symbol and 3D object both derive from the recipe.
- **Exporters:** pure functions over `(doc, building)`, like `io/ifc.ts`.

## Roadmap

| Phase | Status |
|---|---|
| MVP: dashboard, wizard, autosave, versions, site & setbacks, levels, walls, rooms, doors, windows, stairs, roof, 2D + synchronized 3D, materials, furniture, cameras, plans/elevations/sections, PDF, comments, permissions, Architect AI, layout generation | **Shipped** |
| Phase 2: advanced roofs, structure objects, quantities, cost, design options, presentation mode, design health, daylight | **Shipped** (conceptual structure) |
| Phase 3: generative design, AI critique, IFC, schedules, rule engine, Model API | **Shipped**. AI rendering, manufacturer libraries and an energy simulation engine are planned. |
| Phase 4: real-time multi-user modelling (CRDT backend), WebXR walkthroughs, procurement & contractor workflows, marketplace | Planned. The data model and operation log are designed to replay over a CRDT/OT transport. |
