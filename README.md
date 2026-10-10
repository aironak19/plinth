# Plinth — the intelligent architectural studio

**One building model. Every view, drawing, quantity and decision derived from it.**

Plinth is a browser-based architectural design, BIM and documentation platform for residential work: villas, houses, duplexes, farmhouses and bungalows. Change a bedroom from 12 ft to 14 ft and the walls, neighbouring rooms, doors, windows, areas, 3D model, elevations, sections, schedules, quantities, cost, design health and drawing sheets all update. Nobody re-enters the same information twice.

**Live demo:** https://aironak19.github.io/plinth/ — it runs entirely in your browser, and projects are saved on your device.

---

## What's inside

| Area | What works today |
|---|---|
| **Single building model** | A canonical, typed project model: site, levels, walls, doors, windows, rooms, stairs, roofs, columns, beams, furniture, design options, scenes, collaboration. Plans, 3D, drawings, schedules, quantities and cost are all *derived*; nothing is stored twice. |
| **Command-first operations** | Every change is a typed, permission-checked operation (`room.resize`, `wall.create`, `style.apply` …) with undo/redo patches and an audit trail. Mouse, keyboard, ⌘K palette, Architect AI and the Model API all use the same operations. |
| **Ready-made spaces (drag & drop)** | Over 70 standard-size spaces in 11 categories, each in 1–3 sizes:<br>• **Home kits:** whole 1–4 BHK homes, including narrow-plot layouts.<br>• **Rooms:** bedrooms and suites, bathrooms, 7 kitchen layouts, living and dining, home office / gym / pooja, utility and storage.<br>• **Circulation:** foyer, passage, U / L / straight stairs, lift.<br>• **Parking:** 1, 2 or 3 cars on standard 9 × 18 ft bays, tandem, garage, two-wheeler and driveway.<br>• **Outdoor living and gardens:** see *Landscape & outdoor living* below.<br>Each block arrives complete with walls, doors, windows and furniture. It snaps magnetically to what is already drawn and shares walls instead of doubling them. It opens a door into the best neighbouring room and refuses to overlap anything. It warns when a drop crosses the setback or leaves the plot. **R** rotates. Selecting a room offers one-click add-ons such as *Attached bath*, *Walk-in* and *Balcony*. **Simple mode** (the default) keeps the toolbar to the essentials so anyone can plan a home; **Pro** unlocks every drafting tool. The new-project wizard starts from a ready-made home that fits your plot. |
| **2D plan editor** | Walls with endpoint, midpoint, alignment, perpendicular, grid and ortho snapping. Type exact lengths while drawing (`12'6"`, `3.8m`). Rooms detected automatically from walls (planar-graph faces). Mitred wall joins and clean poché. Parametric doors and windows that cut their own openings. Drag room edges to resize with live propagation. Dimensions are always on screen: every room's size and area, every wall's length, room-by-room chains on all four sides, plot edge lengths and the size of each site item (with the car count for parking). Labels are placed so they never overlap, and zooming in reveals more. Inline dimension editing, marquee selection, a contextual toolbar, comment pins and design-health markers. |
| **3D & realistic rendering** | A real-time three.js viewport built from the same solids as the drawings.<br>• **Physical sky and sun** for the project's latitude, longitude, date and time — the same sky lights the model, fills the background and sets the haze. Presets land on the real sunrise, golden hour and dusk for that place and day.<br>• **Weather:** clear, scattered cloud, overcast, warm haze.<br>• **Night:** windows glow from inside, garden and gate lamps switch on, stars come out.<br>• **Materials:** procedural PBR with normal maps (brick, coursed stone, pavers, herringbone, cobbles, timber, gravel, plaster), reflective glass, rippling water.<br>• **Depth:** soft sun shadows, ground-truth ambient occlusion and bloom, with Fast / Balanced / High quality presets.<br>• **Photoreal mode:** progressive GPU path tracing in the same viewport — real bounce light, soft shadows and reflections, with denoising — then save the image.<br>• **Outputs:** high-resolution stills, 360° panoramas, turntable video, glTF/OBJ.<br>• Seven render styles (realistic, architectural, clay, sketch, x-ray, wireframe, draft), cutaway sections, walk mode and saved scenes. |
| **Landscape & outdoor living** | A complete garden toolset on the same model.<br>• **Design my garden:** one click lays out the whole plot in one of six styles (tropical resort, modern minimal, Indian courtyard, Mediterranean, zen, cottage) — compound wall and gate, a path to the front door, an outdoor room off the living space, style gardens, perimeter trees sized to the setbacks, foundation planting and lighting. Species are filtered to the project's climate; re-running replaces only what it generated.<br>• **Plant nursery:** 74 real species with botanical name, mature height and spread, sun, water, flowering season, planting distance and a practical note. Each has a landscape-plan symbol and a procedural 3D model with seasons, bloom and wind.<br>• **Planting age:** view the garden at year 1, year 5 or maturity.<br>• **Ready-made outdoor rooms:** stone patio, pergola sit-out, fire-pit circle, outdoor kitchen, jacuzzi deck, cabana, gazebo, yoga deck, children's play area, covered car porch, entrance gate.<br>• **Ready-planted gardens:** lawn, flowering border, kitchen garden, zen garden, tropical corner, palm avenue, bamboo and ashoka screens, tulsi courtyard, lotus pond, fountain court, succulent garden, rose garden, orchard.<br>• **Draw your own:** 20 paving, decking, gravel, lawn, pool and pond surfaces (drag a rectangle); hedges, fences and garden walls (click a line), or run one around the whole plot.<br>• **About 50 garden objects:** pergolas, gazebo, carports, outdoor furniture, fire pit, barbecue, outdoor kitchen, fountain, water wall, raised beds, play set, gates, lamp posts, bollards, uplights.<br>• **Documentation:** a keyed landscape plan (L-101) and a planting and hardscape schedule (L-102) in the drawing set.<br>• **Numbers:** softscape and hardscape areas, permeable ground, canopy cover, weekly irrigation demand, and every plant, surface, hedge and wall costed in the estimate.<br>• **Design health:** trees too close to the house, palms over pools and parking, poisonous plants near play areas, species unsuited to the climate, planting outside the plot. |
| **Site & zoning** | Any plot polygon (L-shaped, irregular), per-edge setbacks and road frontage, buildable zone, coverage / FAR / height / floors / parking meters, violation zones, and "Fix automatically" with an impact preview. |
| **Rule framework** | Regional rule packs (India NBC-based, US IRC, UAE villa) with per-project overrides. Nothing regulatory is hard-coded in the engine. |
| **Roofs & stairs** | Flat (with parapet), gable, hip, shed, butterfly and mansard roofs. L/T outlines are decomposed into intersecting volumes, and ridges, hips, valleys, gutters and downpipes are computed. Straight, L, U and spiral stairs with riser/tread calculation and safety checks. |
| **Documentation** | An automatic, always-current sheet set (A0–A4): cover and sheet index, site plan, floor plans, elevations, sections, roof plan, door/window/room schedules, area statement and takeoff. Title blocks and scale bars. Vector PDF export. |
| **Interoperability** | IFC4 export (walls, slabs, spaces, doors/windows in real openings, psets). DXF R12 export, plus DXF import that converts line pairs into walls. glTF/OBJ, SVG, CSV BOQ, and a Plinth JSON project file. |
| **Quantities & cost** | Takeoff measured net of openings, configurable rates and currency, margin / contingency / tax, cost by category and level, a design-option comparison, and material alternatives ("Italian → Indian marble saves ₹X") with previews. |
| **Design health** | A continuously running validation engine: geometry, rooms vs. minimum standards, openings, stairs, setbacks/FAR/coverage, daylight, accessibility, circulation (walking distance and reachability), structural coordination and documentation. Each issue jumps to the element; fixes are previewed before you apply them. |
| **Analysis** | Sun study with a sun-path diagram, daylight by room, and climate notes (overhangs, west sun, cross-ventilation). Generative design scores nine complete schemes in a Web Worker against your priorities. |
| **Architect AI** | Natural-language design that edits the structured model: *"make the master bedroom larger"*, *"add a powder room near the living room"*, *"add a master suite next to the landing"*, *"add 2 car parking"*, *"landscape the plot in tropical style"*, *"plant 4 royal palms along the west boundary"*, *"add a pergola sit-out"*, *"show rooms smaller than 100 sq ft"*, *"create a 4 bedroom villa on a 40 × 60 ft plot…"*. Every change is a proposal with a measured impact (areas, cost, health) and **Preview / Apply / Cancel**; nothing changes silently. It works offline with an on-device engine; add a Claude API key to use Claude (`claude-opus-5-5`) with the same operation tools. |
| **Collaboration** | Activity feed, comments pinned to rooms and locations with @mentions, lightweight tasks, an approval workflow (Draft → Internal review → Client review → Approved → Construction), notifications grouped per project, and live sync between open windows. |
| **Versions & options** | Git-like versions with change summaries, compare (plan and metric diff), restore and branch-to-option. Design options share the site and brief. |
| **Presentation** | Full-screen client mode: 3D overview, saved scenes, plans, a materials board, option comparison, and approve / request changes. |
| **Enterprise** | Roles and permissions enforced by the dispatcher (with "view as client / contractor"), an audit log, plan tiers as configuration, storage, a Model API explorer and console, and extensions (rule packs, libraries, exporters). |

### The flagship sample: Aura Villa

The first project you see is drawn on a real plot from a client's hand sketch: an L-shaped site of **52 × 49 ft stepping to 42 × 47 ft** (96 ft deep, about 4,522 sq ft). It is a G+1, five-bedroom villa (four upstairs plus a guest suite) with a pool, at 33.5% coverage and FAR 0.67, with every setback checked.

---

## Architecture

```
            Mouse · Keyboard · ⌘K · Architect AI · Model API
                              │  OpCall { type, params }
                              ▼
                 ┌─────────────────────────┐
                 │  Operation registry      │  typed · permission-checked · undoable · audited
                 └────────────┬────────────┘
                              ▼
                 ┌─────────────────────────┐
                 │  Canonical project model │  immutable (immer), structural sharing
                 └────────────┬────────────┘
         ┌──────────┬─────────┼──────────┬───────────┬────────────┐
         ▼          ▼         ▼          ▼           ▼            ▼
   Rooms (planar  Solids   Site &     Quantities  Validation   Analysis
   graph faces)   (faces)  zoning     & cost      (health)     (sun, daylight)
         │          │
         ▼          ▼
   2D plan     3D · elevations · sections · IFC · glTF
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model, derivation pipeline and extension points.

```
src/
  core/            ← pure TypeScript, no UI; fully unit-tested
    model/         types, factories, queries, org/RBAC
    geometry/      vectors, polygons & booleans, planar graph face detection
    derive/        rooms, wall joins, solids, site, stairs, roof, quantities, cost, validation, sun, analysis
    ops/           operation registry + model/project/collaboration operations
    generate/      layout generator, scoring, the Aura Villa sample
    ai/            on-device intent engine, impact preview, Claude provider
    docs/          plan symbols, drawings, schedules, sheets
    io/            PDF, DXF (import/export), IFC4
    catalog/       materials, assets, styles
    rules/         regional rule sets
  state/           store (undo/redo, autosave, versions, sync), persistence, derived hooks
  ui/              shell, dashboard, wizard, plan editor, 3D, inspector, spaces, AI panel, presentation
  workers/         generative design worker
tests/             model, geometry, units, generator, AI and documentation tests
```

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit, geometry, propagation, AI and docs tests
npm run build      # type-check + production build
```

## Keyboard

`W` wall · `R` room · `D` door · `N` window · `S` stair · `O` column · `K` comment · `V` select · `C` copy · `A` align · `P` plan · `3` 3D · `2` split · `E` elevations · `⌘K` command palette · `⌘J` Architect AI · `⌘Z` / `⇧⌘Z` undo/redo · `⌘S` create version · `?` all shortcuts

## Honest boundaries

- **Storage is local-first** (IndexedDB) behind a `SyncAdapter` interface. Cloud sync, SSO/MFA and multi-user real-time editing need a Plinth Cloud backend, which isn't part of this repository. Sync between windows on the same device works today.
- **Structure and energy are conceptual.** Columns, beams and climate notes are planning aids, not engineering-certified analysis.
- **Rule sets are starting points** based on published codes. Verify against the local authority before submitting for permits.
- **Cost rates are indicative** (2026 Indian metro). Every estimate shows its source, and every rate can be overridden per project.
- **The site is flat.** There is no terrain modelling, grading or cut-and-fill yet, so sloping plots, retaining walls that hold ground and stepped gardens can't be represented.
- **Irrigation is a sizing figure, not a design.** Weekly water demand and an irrigation allowance are estimated; there is no pipe, valve or sprinkler layout.
- **Plants are procedural models,** drawn from each species' growth form. They read correctly in plan and at garden scale, but they are not scanned botanical assets, and the library is 74 species where specialist landscape tools carry thousands.
- **Photoreal mode needs a capable GPU** (WebGL 2 with float textures). It converges in tens of seconds on a recent laptop; the real-time view works everywhere.
- **AI rendering, VR/AR and the extension marketplace** are designed for but not shipped. See the roadmap in `docs/ARCHITECTURE.md`.

---

Built with React, TypeScript, three.js, immer, polygon-clipping, jsPDF and svg2pdf.js.
