# Organic field layout

The field also supports six views of the same shared geometry. See
[world projections](world-projections.md) for the model, camera transforms,
view controls, approximations and validation.

The field keeps its Phaser scene, world coordinates, building IDs and assets. The Arena remains at `(1400, 975)`. The two enclosing octagonal roads and rectangular Arena road have been removed.

## Districts

- The Arena, Notice Board, fountain and small market clearing form the town core.
- Strategy Lab sits west beside crop beds, the training yard and camp paths.
- Hiring Hall and cottages sit southwest near the western market lane to Bazaar.
- Hall of Fame, Treasury and Lookout occupy uneven northern sites, separated by trees and a pond.
- Game Hall, riverside cottages and workshops lead to the eastern bridge and Launch Pad.
- Rulebook House stands by the southern gardens, with a winding lane leading out to the lake.

Six winding country lanes branch away from town. They stop within wilderness instead of outlining the map edges. All streets, trails and plazas share the grey stone colour and texture; their widths still vary. Ponds, the river, western ocean, small mountain, woods and farm beds break up the grass. Forest clearing strength now changes gradually with distance and direction.

## Movement and expansion

`curvedPath` samples road bends into shared world coordinates. Rendering and the existing Roads graph consume those same points, so walking does not follow a different curve from the picture. Junctions share vertices; door spurs split the nearest lane where they join. An already connected door needs no extra spur. Local street circuits give agents alternate routes without forming a world perimeter.

The existing ground routing, Arena gates and match positions remain in place. Zoom, pan, spawning, agent selection, Find My Agent, building cards, labels and responsive sizing retain their existing implementations. Wallet, holder eligibility, autoplay, matches and payouts are unchanged.

Growth uses the real, non-retired token-agent roster across all qualifying tokens, excluding house residents and replay stand-ins. Each token agent counts independently, even when a wallet owns several. Seeded irregular neighbourhood clearings open instead of rows along rings. Plot thresholds, stable IDs within the new plan and monotonic opening behavior remain. Plots avoid streets, rivers, ponds, fixed landmarks and each other. New buildings are included in navigation obstacles. Twelve real residents per hall keep central forecourts; additional residents get separate dry homes distributed through opened neighbourhoods. Addresses remain stable while other agents arrive or play. Opened plots remain while the scene is running; a reload rebuilds from the current population. The legacy `INNER` and `OUTER` region constants remain as invisible expansion/camera/forest boundaries; they are not rendered roads.

The current expansion fills neighbourhoods within the existing world bounds; it does not generate unlimited new land. The layout test checks 1,000 separate dry residential spots. This is a placement check, not a guarantee of mobile frame rate with 1,000 animated characters.

Flat terrain and water-effect depths are below the world’s northern edge so actors at negative vertical coordinates remain visible. Characters show a fallback sprite while portraits load. Portraits load near the camera, at most four at once. Name collision work covers only visible labels, normally up to 150; hovered, selected and owner labels take priority. These changes reduce browser work without removing agents from the server roster.

## Changed files

- `web/app/village/game/world.ts`: country lanes, sampled curves, shared junctions and door spurs.
- `web/app/village/game/town.ts`: landmark positions, streets, trails, plaza and destinations.
- `web/app/village/game/map.ts`: consistent grey stone streets and country paths.
- `web/app/village/game/pieces.ts`: relocated props, cottages, workshops and farm beds.
- `web/app/village/game/dressing.ts`: market clearing and plaza dressing.
- `web/app/village/game/gardens.ts`: shared pond footprints and relocated fountain stonework.
- `web/app/village/game/landmarks.ts`: scenic footprints shared by growth and navigation.
- `web/app/village/game/growth.ts`: irregular expansion plots and scenery clearance.
- `web/app/village/game/population.ts`: real-agent counts, dry residential allocation and route clearance.
- `web/app/village/game/depth.ts`: terrain layering below the entire world.
- `web/app/village/game/hero.ts`: visible fallback characters during portrait loading.
- `web/app/village/game/labels.ts`, `test/labels.test.ts`: bounded name placement near the camera.
- `web/app/village/game/scene.ts`: population growth, neighbourhood homes and refreshed navigation.
- `web/app/village/game/index.ts`, `web/app/shell.tsx`: growth follows the roster rather than holder counters.
- `test/population.test.ts`: 1,000 residential spots, stable homes, exclusions and terrain layering.
- `web/app/village/game/forest.ts`: gradual irregular clearing density.
- `test/world.test.ts`: connected winding routes, open boundaries and building clearance.
- `test/old-town.test.ts`: landmark contracts, entrance access and alternative routes.
- `test/growth.test.ts`: pond clearance alongside existing expansion checks.
- `test/duels.test.ts`: agents meet on the nearest path without assuming a straight high street.
- `test/fixtures/old-town.json`: the intentionally redesigned landmark/prop layout. Road geometry is checked by navigation tests rather than a large sampled-point snapshot.
- `docs/world-layout.md`: this explanation.

## Validation

Run the eight field-related suites with launchpad disabled and enabled:

```sh
npm exec vitest run test/village.test.ts test/world.test.ts test/old-town.test.ts test/village-landscape.test.ts test/growth.test.ts test/duels.test.ts test/population.test.ts test/labels.test.ts
NEXT_PUBLIC_LAUNCHPAD=1 npm exec vitest run test/village.test.ts test/world.test.ts test/old-town.test.ts test/village-landscape.test.ts test/growth.test.ts test/duels.test.ts test/population.test.ts test/labels.test.ts
```

Also run root and web typechecks and the web production build. Browser previews cover desktop, maximum zoom out, dragging, mobile resizing and a simulated agent roster. No standalone lint script is configured in this project.

## Elevated pixel-world presentation (7 October 2026)

The same Phaser scene, world coordinates, road graph, building IDs and public
agent feed drive three camera views. `presentation.ts` defines World, District
(1.05 CSS pixels per world unit) and Agent (2.4), plus frame-rate independent
follow damping. The ground uses a vertical camera scale of 0.78; `billboard.ts`
keeps upright sprites proportional and anchored to their original feet.
Navigation coordinates and building footprints remain unprojected. This is
orthographic 2.5D, not a rotatable 3D engine or a new game mode.

`scene.ts` pans and zooms together over 900 ms, tracks a moving endpoint during
the transition, then follows the agent. Find My Agent cycles the owner's agents,
selects and briefly highlights each, and stays in the world. Selecting a character
also retains the existing public agent-page navigation. Drag, wheel and pinch
release follow. Reduced motion uses immediate framing and static selection.
Insets account for the navbar, desktop page panel and mobile sheet; density
changes preserve a manually chosen view. Building and character labels shrink
at close zoom. Ordinary character names stay hidden in World view, with a bounded
set in District/Agent views; selection and owner identities retain priority.

`districts.ts` supplies named terrain regions and visit destinations.
`district-scenery.ts` reuses the installed pixel art for neighbourhood props and
bakes dithered terrain into small reusable textures. The World view still frames
the original town, with expanding residential plots and countryside a pan away.
Every road uses grey stone. All road styles now share the exact same surface, kerb, highlight and joint
colours. Widths are six world pixels wider than the previous plan; main streets
remain wider than footpaths. Footpaths and country lanes use worn cobbles with sparser texture,
following the same organic centre lines. The legacy `dirt` map key now names
weathered grey stone and remains compatible with map/art scripts. Trees, houses and characters have shared
pixel shadows. Bridge decks retain their navigable dry tiles and gain visible
stone faces and corner parapets. River banks have stepped stone edges and reeds.
The Arena is now a wide oval colosseum: the outer footprint is 760 × 400 world
pixels, centred at `(1400, 775)`, with a 540 × 250 oval sand floor at
`(1400, 800)`. Four stepped timber seating tiers, emerald/teal seats, gold rails, warm stone
arches, tiled rear galleries and roofed stair/gate towers use the existing Phaser
renderer. Roof shingles, timber grain and masonry joints are clipped to the
curved surfaces as pixel details. Saturated green/teal banners have gold hems; warm sand has dithered
tone variation and a clearer original emblem. Torch flames and warm light pools
are stronger. Decorative crowds remain separate from actual agent counts. Ground, rear stands and front wall sort separately around walking
characters. The landmark anchor remains `(1400, 975)`. A front gate at
`(1400, 1010)` and east gate at `(1810, 775)` feed short curved approaches and
small oval stone forecourts with inset cobbles and emerald/gold inlays. Existing
benches, flags and gathering destinations surround the open front gate; there is
no rectangular surrounding plaza. Shared
`arena-geometry.ts` defines the oval shell, open gates, sand and conservative
64px collision blocks. Hidden routes enter through those gates and connect to
all match positions; match scheduling and interactions are unchanged.

The Launch Pad moved to `(3060, 1190)`, a clear plot north of the eastern
country lane. Its door at `(3060, 1207)` has an automatic entrance spur. The
country lane retains its existing bends. Growth reservations, district props
and minimap labels read the shared site coordinate rather than a duplicate.

Most autonomous strolls now visit a safe forecourt, market, terrace or Arena
approach, with pauses at sharp turns and longer rests near benches. Other strolls
still explore the wider world and the existing designated lakeside swimming area.
These are visual routines: they never modify autoplay, holding eligibility,
match scheduling, balances or payouts. Trunk occupancy comes from the same
seeded forest data as its art, cached by navigation chunk independently of rendered
chunks. Ground A* resolves blocked destinations to dry ground and stays put when
no safe connection exists, instead of falling back to a line through water/walls.
The collision grid is still 64 world pixels: tight spaces are conservative and
routines are deliberately simple, not a traffic/crowd simulation.

The world is the site's home at `/` (see world-projections.md), with free camera
gestures; the old `world-lens.tsx` minimap went with the Top view. `/agent`
opens a close follow camera on the signed-in owner's first available agent,
without a dashboard or sheet. The status panel can switch between that wallet's
separate token agents; camera gestures, blank clicks and nearby character clicks
do not detach follow. Its minimap is observational. Neither view controls agent
movement. Management remains at `/`, accessible from the compact status card.

`agent-status.tsx` displays identity, qualifying token, API reward power multiplier,
conviction days, visual activity and destination. Private readings refresh every
30 seconds and clear on agent/session changes or errors; unavailable power is
never invented. Ownership refreshes every minute and on navigation. Delayed field
arrival, missing ownership, sign-out, retirement and API failure have explicit
states. API eligibility and autoplay decide actual play; walking is presentation.

`welcome.tsx` frames the live world behind a green pixel menu, with existing art
as a first-paint/WebGL-failure fallback, Gamine's own visor/fern character, restrained ambient
lights and scanlines. Rotating loading phases yield to a deliberate Enter World
button. Watch Live, Find My Agent and the feature-gated Launch action dismiss the
menu and navigate normally. A ten-second fallback allows entry during connection
issues. The dialog keeps keyboard focus within its actions; reduced motion stops
ambient/sprite animation and removes the exit transition. No second world scene,
AI image generation, wallet action or extra rendering engine is required. The
welcome character is a local SVG of the existing v2 portrait generator
(`welcome-agent-195`, Anchor) rasterised to the same 40px palette grid as world
characters, with matching limbs. It does not depend on an API portrait request.

Performance: forest sprites still stream around the viewport. Portrait requests
are limited to four concurrent requests for nearby residents. Offscreen character
art and animations are culled while navigation/state continue; visible portrait
idle poses update at eight Hz. Labels are budgeted; the React HUD receives one
snapshot every 200 ms, not a DOM element per agent. Ground patches and shadows
share small textures. This reduces drawing cost, but does not promise a particular
frame rate for 1,000 simultaneously moving characters on every phone.

Changed presentation files: `game/presentation.ts`, `game/billboard.ts`,
`game/districts.ts`, `game/district-scenery.ts`, `game/scene.ts`, `game/index.ts`,
`game/hero.ts`, `game/building.ts`, `game/map.ts`, `game/dressing.ts`,
`game/river-scenery.ts`, `game/ground.ts`, `game/palette.ts`, `world-lens.tsx`,
`agent-status.tsx`, `app/agent/page.tsx`, `app/welcome.tsx`, `app/globals.css`,
`app/site-bar.tsx`, `app/sitemap.ts` and `app/shell.tsx`.
`test/arena-geometry.test.ts` checks the oval shell, open gates and connected
entrance/match/exterior routes. `test/presentation.test.ts` checks framing/damping and safe trunk/bridge/unreachable
navigation. Existing population, labels, growth, duel, landscape and village
regressions remain applicable. No new art licence, backend dependency or API
contract is introduced.


The upper lake and vertical river now form one water system. `river.ts` combines
their wet tiles before generating shoreline tiles; a smooth westward flare at
the lake mouth overlaps the existing lake. `waterTerrain()` replaces overlapping
legacy shore tiles as a group, so rendering and Ground agree about wet/dry land.
River bridge decks still follow the existing road crossings, and bank clearances
include the mouth. Exposed shoreline segments alone receive broken stones and
reeds, with no retaining wall through the confluence. The lake depth tint fades
towards the outlet; the minimap uses the same union. Road bends, bridge destinations
and the southern lakeside pier remain in place. Landscape tests cover continuous
wet connectivity, no walkable seam, crossing safety and routes to the world edges.

The Arena colour/detail pass changes code-drawn textures in `game/arena.ts` and
the Arena sign in `game/building.ts`; it recolours no shared image asset. The
original Gamine emblem is reused. The welcome page adds one local SVG from
the existing character generator, rather than a new externally sourced character.

Further files in the final arena/water pass: `game/arena-geometry.ts`,
`game/arena.ts`, `game/building.ts`, `game/town.ts`, `game/world.ts`,
`game/growth.ts`, `game/pieces.ts`, `game/river.ts`, `game/river-scenery.ts`,
`game/scenery.ts`, `game/scene.ts`, `world-lens.tsx`, `test/arena-geometry.test.ts`,
`test/growth.test.ts`, `test/village-landscape.test.ts` and the intentional
`test/fixtures/old-town.json` floor/entrance update.

Validation: root and web typechecks, production build, 66 affected tests with
launching enabled and disabled. Read-only browser simulations cover own-agent
follow/switching, mobile layout, 1,000 residents, Field return and signed-out
state, plus the Launch Pad, arena day/night views and the connected shoreline.
No wallet approval or financial transaction was performed by these previews.
