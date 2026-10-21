# One world, one camera, many angles

The Isometric world is Gamine's base layer on every route, not a page.
`WorldShell` (`web/app/shell.tsx`) keeps one `PersistentWorld` mounted for the
whole app; Launch, Explore, Agent, Live, Ladder, Games, Rewards and About are
overlays on it, and `/`, the site's home, is simply the route with no overlay
(`/field` and `/village` redirect there). The Agent page that used to be `/`,
for getting and managing agents, is `/agents`. The original
Phaser scene stays mounted but hidden: it runs the simulation and supplies the
captured art (see "Top is the source of truth"); `WorldCamera`
(`web/app/village/world-camera.tsx`) is the only thing that presents the world.

It opens on its home view: looking straight down (yaw 0°, tilt 90°) at the town
centre, the Arena with the market square below it, at a zoom that fits about
3,000 world units across the window (at least 0.3 on a phone). One continuous
orbit camera takes it from there; there are no projection-switching buttons.
Horizontal drag rotates; vertical drag changes elevation from 15° to 90°;
wheel and pinch zoom. Reset camera returns smoothly to the home view, and Whole
world reframes the whole world without changing the angle.

The shared world model, authored coordinates and live simulation are unchanged.
The six named projections remain internal math/render entry points for tests
and debugging. The original Phaser renderer supplies the same artwork and
continues to serve other routes, including the dedicated `/agent` camera.

## Shared spatial model

`web/lib/world/model.ts` assembles the existing layout into `WorldModel`. It
does not author another map. Its inputs are the existing town, road, landscape,
garden, prop, water and growth definitions, the imported map, and actual loaded
sprite-frame dimensions. `prepareWorldMap` produces exactly the previous
lake/river/ocean tile recipe, world bounds and roads. `createWorldModel` applies
the existing scenery exclusion rules once, deriving the same canopy lots used
by Top and forest generation.

The model includes the exact Top recipes (`map`, `sites`, `pieces`,
`districtPieces`, `lots`, `hiddenRoads`) alongside spatial `objects`:

- Bounds are the existing `WORLD`, including negative coordinates. The raised
  display slab is 120 world units deep; this is presentation, not new terrain.
- Roads retain their sampled center lines and widths, shared with the Roads graph.
- Water comes from uncovered wet terrain cells, excluding the dry crossing and
  shoreline overlays. The upper lake and river remain connected. Garden ponds
  use the existing elliptical footprints; the ocean and southern lake use their
  existing tiles.
- The arena uses `COLOSSEUM` and `COLOSSEUM_FLOOR`, including the existing arena
  anchor. Landmark sites, launch feature gates, market stalls, other dressing,
  plazas, garden rails/benches/solar lights and the mountain retain their positions.
- Movement areas include activity destinations, the hidden navigation paths and
  the actual nearest-dry spawn resolved by the scene.
- Opened plot pieces and forest trees are added by `VillageScene.worldSnapshot`.
  It uses the scene's monotonically opened plots and identical `chunkTrees` seed,
  road exclusions, reserved lots and plot clearings. It does not copy the subset
  of trees currently visible to Top's camera. Cleared trees stay cleared.

Objects have stable IDs, a type, render category, ground coordinates, width,
depth, height, elevation, orientation and optional art/label/anchor metadata.
`x` grows east, `y` grows south and `z` grows upward. A spatial object's `x/y`
is its footprint center. Existing building art is anchored at the south-center
foot of its image; `metadata.topAnchor` preserves that original coordinate while
the model converts to a centered footprint. A tree's trunk stays at its original
foot coordinate. Renderer projections never mutate these values.

The original layout modules remain the authored inputs. Add or move content
there, then extend the model/art adapter if introducing a new kind of object;
do not add camera-specific placement arrays. Pure model/projection modules do
not import Phaser, React, wallet code or the backend.

## Camera basis

`web/lib/world/projection.ts` accepts the six named projections or a continuous
`{yaw, tilt}` angle. South is yaw zero, east is +90°, north is 180° and west is
-90°. The ground stays fixed while the basis rotates:

```
across = x*cos(yaw) - y*sin(yaw)
along  = x*sin(yaw) + y*cos(yaw)
screenY = along*sin(tilt) - z*cos(tilt)
```

Front/Back/Left/Right look down at 28°, revealing both ground axes instead of
collapsing terrain into elevations. Left and Right use the physical screen-right
axis of a camera standing west/east, so a full orbit never mirrors the map.
Isometric keeps its high-angle basis (yaw 45°, tilt approximately 35.26°).
Top keeps its original top-down projection and Phaser rendering, including its
historical 0.78 floor compression and upright pixel sprites.

`unprojectGround`, `footprint`, `projectedBounds` and `depthOrder` use this same
basis. Depth ordering follows ground distance along the viewing axis, including
the near edge of structures. Trees and buildings draw together with opaque
canopies. `visibility.ts` uses rising sight rays and cross-axis buckets to hide
live agent markers behind scenery, including the hollow Arena. These volumes
are approximations of the procedural shapes, not pixel-perfect 3D meshes.

`projected-art.ts` retains internal named entry points and draws the terrain slab,
road ribbons, inset water, bridges, structures, Arena tiers, forests, mountain
and props at every angle. Directional framing fills more vertical space;
framing blends continuously toward the high-angle overview. Whole world fits
all outer edges. Labels stagger with leader lines when needed.

## Top is the source of truth

Every other view draws the world Top draws, captured from Top itself rather
than from a parallel layout (`VillageScene.captureTop`). Once Top's fixed
world is drawn, before any agent, forest chunk or boat exists:

- **Ground.** Every visible layer below the standing art (Phaser depth under
  `WORLD.y0`: terrain tiles, roads, plazas, roundabouts, water, river banks and
  bridge decks, ponds, district patches, garden and crossroad beds, flowers,
  market ground, the arena forecourt and every contact shadow) is rendered once,
  through a camera that sees the whole world from above, into one image at half
  resolution. Each view lays that image on the ground plane, so roads, water,
  bridges and forest edges match Top by construction.
- **Standing art.** Every standing picture Top placed (buildings, houses,
  stalls, tents, flags, banners, lanterns, benches, signs, statues, the fountain,
  the mountain, decoration trees) is recorded with its texture, frame, flip,
  natural size and foot. Views draw that exact frame upright on that foot, like
  Top's standees. `standee()` tags the pictures it stretches, so their natural
  proportions are recovered.
- **The Arena** stands in 3D on `COLOSSEUM`, in the village's materials
  (`ARENA_PALETTE`): red-brown roofs, shaded coursed stone, timber seating, a
  sand floor, thin green and brass trim, with Gamine's logo
  (`gamine-tb.png`, unaltered) in the middle of the floor. Its name sits on
  its north rim.
- **Drawn as shapes in Top**, and so taken from the same shared definitions:
  the arena's four gate torches (`ARENA_TORCHES`, which
  Top's `arena.ts` now draws from too) and the garden fences (`GARDEN_RAILS`,
  drawn as rails and posts).
- **Grown plots and the forest** come from the shared generators
  (`plotObjects`, `treeObject`), carrying the same textures, frames and anchors
  Top's `build()` and forest streaming use; flat pieces (plots, yards, planters)
  lie on the ground plane.

Left out on purpose: the arena's own sprite layers (the 3D arena replaces them),
sailing boats, glows and night effects.

Until the ground image is ready (a moment after the scene starts), views fall
back to the model's procedural surfaces and buildings described below.

## Fallback materials

`projected-materials.ts` loads Top's recoloured ground sheet and water texture
and the tree/prop sprite sheets, and `projected-art.ts` keeps procedural
cottages, roads and water, for the moment before Top's capture is ready.

## Live scene and interaction

`world-camera.tsx` owns the single world camera and Canvas 2D renderer, on
every route.
`VillageHandle.snapshot()` reads the same live heroes as the original renderer;
there is no second simulation or roster. Agents retain their own character art,
walking gait, weapons and activity props through `Hero.paintTo` and the shared
`Painter` interface. Owned agents stand on a gold ring.

- Primary mouse drag or one-finger drag on empty ground rotates and tilts.
  Eight CSS pixels distinguish a drag from a tap. Angles ease smoothly and stay
  where the user releases them, with no canonical-angle snapping or renderer
  handoff, even at the highest or lowest elevation.
- Wheel, pinch and the existing zoom buttons zoom. Shift/middle drag, two-finger
  drag and focused arrow keys pan; plus/minus zoom and `0` reframes.
- Picking uses the same projected anchors, sprite dimensions and draw ordering
  as the renderer. Alpha masks let transparent margins pass through, while nearer
  opaque scenery blocks farther buildings. Buildings and their labels open the
  original building cards. Visible live agents use padded character-sized hit
  boxes and the original selection/navigation callback.
- A drag starting on an agent or building reserves that object and never opens
  it on release. Shift/middle drag explicitly requests camera movement there.
  UI controls never enter the canvas gesture controller. Pointer capture, cancel,
  blur and unmount cleanup prevent held gestures from leaking into other routes.
- `VillageHandle.setWorldCamera` routes zoom, world-point targeting and owned-agent
  cycling to the camera. `findMine()` follows the selected live resident;
  a manual camera gesture releases that follow. `/agent` follows the owner's
  agent in the same camera, and gestures there cannot detach it.

### Across routes

The camera lives in `WorldCamera`, which stays mounted while routes change, so
yaw, tilt, zoom, focus and follow carry over from page to page and on back/forward;
nothing resets them except Reset camera, Whole world and the first framing. When a
page is open, the camera eases its centre into the part the page leaves
uncovered (right of a desktop panel, above a phone sheet). That is an on-screen
shift only: focus, zoom and angle are unchanged. Over an open page's exposed
margins, the wheel scrolls the page; Ctrl/pinch still zooms the world. A phone's
first framing shows the town rather than the whole world shrunk to its width.

Routes do not move the camera, except `/agent` following its owner; route-specific
focus (Launch Pad, Treasury and so on) is not implemented.

The original WebGL drawing and input are always off, but simulation, movement and
match playback continue. Geometry redraws only for
camera/model changes, capped at 30 Hz during movement; live positions are read
at 10 Hz and figures animate at 20 Hz. Forest preparation is bounded to three
chunks per snapshot and reused across rotations. Opened plots invalidate the
same cache. Canvas density is capped at 2.

## Projection limitations

- The camera is orthographic, with continuous yaw/tilt and no perspective lens.
  Building depth/height remain the shared approximations derived from existing
  sprite dimensions. No objects or authored coordinates are moved.
- Orbit views show Top's own pictures as upright cut-outs, not 3D models: a
  building seen from behind shows its front art. Agents and buildings are
  interactive directly in the world camera.
- The captured ground is half Top's resolution, so very close zoom shows it
  coarser than Top. Animated ground (sea waves, river ripples) is frozen at the
  moment of capture; masked sea waves are left out.
- Painter ordering is approximate for overlapping large footprints, and marker
  sight volumes approximate tree foliage and Arena walls. Labels are overlays.
- Ambient animals/ships, glow and match-table effects remain in the original
  renderer. The terrain's existing 64-unit shoreline resolution remains visible.
- Agent hit areas are padded rectangles rather than pixel masks. At crowded
  intersections, the foremost overlapping character receives the tap; zoom in
  or rotate to separate the characters. Landmark labels are also clickable.
- Framing low angles on a narrow phone crops distant outer edges to show more
  detail; Whole world or zoom out exposes them. Large populations and woodland
  can reduce frame rate on slower devices; 30 Hz is a cap, not a guarantee.

## Validation

Run root `npm run check`, web `npm run typecheck` and
`npm run build -- --webpack`. Field suites also run with
`NEXT_PUBLIC_LAUNCHPAD=1`. This repository has no lint script, linter dependency
or lint configuration; `npm run lint` currently reports a missing script.

`test/world-projections.test.ts` covers the unchanged recipes, world coordinates,
internal canonical projections, complete orbit, tilt clamps, inverse transforms,
easing, framing, occlusion and original sprite anchors.
`test/field-camera.test.ts` covers picking across arbitrary angles, transparent
and flipped sprite pixels, foreground occlusion, the procedural Arena and small
agent hit areas. Picking geometry stays DOM-free; the browser adapter caches
alpha masks from the existing loaded frames.

Browser verification exercises direct Isometric startup, absence of projection
buttons, rotation, high/low elevation, wheel/pinch zoom, pan, building and agent
taps versus drags, owned-agent targeting and mobile cancellation.
`scripts/check-world-shell.mjs` walks Field, Launch, Explore, Agent, Games, Live,
Ladder, Rewards and About (and back/forward) against a production build and asserts
one world canvas, one engine (one map load), an unchanged camera across
navigation, an intact wallet session, owner follow on `/agent`, a continuing
simulation, touch rotate/pinch on a phone and no page errors:

    BASE_URL=http://localhost:3001 node scripts/check-world-shell.mjs

The completed verification runs root `npm run check` (539 main tests and 11
real Postgres tests), web typecheck and the production webpack build. The
production build retains the existing optional Privy dependency warning.
