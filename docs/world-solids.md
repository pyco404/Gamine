# True 3D structures and living water

**Status: asset consistency pass, 2026-10-12, committed; not yet deployed.** All live houses,
village buildings, stalls, tents and trees now use shared 3D meshes. The arena and existing good
house models retain their geometry. Full house sprites and crossed tree planes are retired from
visible rendering; source images remain capture inputs and references for material/decal crops.
The former `?solid=0` switch no longer restores old scenery. `?water=0` still stops the water.
See [the consistency report](asset-consistency.md) for replacements, validation and performance.

## What is 3D

| Structure | World object | Reference art | Triangles |
| --- | --- | --- | --- |
| Cottage | yellow/blue houses, `growth-house-a`, Hiring Hall, Strategy Lab, Rulebook House | `cottage-gold.png` | 754 |
| Red cottage | red houses, `growth-house-b`, Game Hall | `cottage-red.png` | 842 |
| Townhouse | purple houses, `growth-apartments` | `cottage-green.png` | 650 |
| Workshop | smithy, `growth-office` | `smithy.png` | 442 |
| Blue market | blue stalls, `growth-shop` | `market-blue.png` | 226 |
| Red market | red stalls, `growth-kiosk` | `market-red.png` | 242 |
| Special building | Hall of Fame (`site:library`), Treasury (`site:chapel`) | `hall-of-fame.png` | 336 |
| Notice board | Notice Board (`site:board`) | `leaderboard.png` | 92 |
| Watchtower | Lookout, stock village tower | shared timber/thatch/stone | 344 |
| Shed | legacy hut/shed/mine keys when present | shared timber/slate/stone | 76 |
| Tent | camp tents | pixel canvas/timber | 80 |
| Bazaar | two joined existing market models | existing blue/red stall materials | 468 |
| Sign panels | hiring, strategy, scoreboard | displays only on the front; timber rear | 92 |
| Waypost | stock arrow signposts | shared timber/planks | 72 |
| Shrub | bushes and shrub decoration aliases | closed foliage lobes | 240 |
| Mushroom | mushroom decoration aliases | solid stem and cap | 44 |

Trees are seven closed mesh families: small (744 triangles), medium (856), large (968), round
(856), tall (856), sparse (632) and dense (1,080). Tapered trunks, roots and branches support
irregular leaf lobes textured in one green palette. No tree face carries the original tree sprite.
Every tree keeps its planted coordinate and seeded family as the camera moves. Trees and shrubs
share the buildings' material atlas, lighting, projection and shadow pass.

Counts are for the default variants. Buildings scale to their existing picture width; position
selects deterministic mirroring, roof tones and planting. Meshes are shared by family and variant,
with sizes rounded to two decimal places. Camera rotation changes uniforms only. Cottages and
townhouses have recessed doors and windows with visible wall thickness; workshops have a forge
bay and lean-to. The models use the village's reference art for pixel textures and details.

Each is one physical model on fixed local axes (x right, y front, z up), built once and shared
(`web/lib/world/solid-models.ts`). Walls, foundations, roofs with real thickness and overhang,
gable ends, chimney, dormer, posts, canopy, counter, crates, barrel, the board's panel with its
edge thickness, braces and roof. Doors, windows, banners, produce and the board's display are the
reference art's own pixels, cut out and laid on the walls; the same window continues on the sides
and back. The camera only changes uniforms: rotating never rebuilds geometry.

## How it is drawn

- **WebGL2, no library.** One small program; `web/app/village/game/solid-renderer.ts`.
- **Projection.** The vertex shader is `project()`'s own orthographic basis, so a 3D model lands on
  exactly the pixels the 2D world expects, and clip depth is distance toward the camera.
- **Pixel look.** One 256-pixel atlas (`solid-materials.ts`): surfaces cut from the art where a clean
  patch exists (thatch, crate wood, the board's roof), else drawn in palettes sampled from it
  (plaster, coursed stone, clay tiles, planks, striped canvas). `texelFetch`, nearest, no
  antialiasing; surfaces tile mirrored at the source picture's own pixel size; light in eight steps
  from the south-west, as the art is lit. Cut-out decals discard below half alpha.
- **Grounding.** Each model casts a flat shadow, written once per pixel so overlaps do not darken.
- **Fitting into the 2D world.** A 3D model is an ordinary painter layer with bounds and depth, so
  agents pass in front of and behind it exactly as they do any building. All visible models render
  into separate slots of an offscreen atlas, so overlapping screen bounds never copy neighbouring
  models into a layer. Each atlas page is read off the GPU once; frames between camera changes
  only blit from it. Pages respect GPU viewport/renderbuffer limits up to 4096 pixels. Very large
  or high-DPI screens reduce the model rendering resolution to fit a complete screen-sized slot.
- **Draw calls.** Two per visible structure per camera change (shadow, model), one GPU read per
  atlas page per camera change, none while the camera is still.
- **Forest reuse.** Seven tree templates and one shrub template are rendered at each exact yaw/tilt,
  in a separate cache group on the same WebGL context. Thousands of trees reuse those pixels at
  their existing scale and position. Geometry and GPU buffers are shared; template canvases retain
  only the current pose. Rotation changes the projection of real fixed meshes, rather than turning
  sprite planes toward the camera. Stationary instances cause no uploads or GPU reads.
- **Fallback.** Without WebGL2, the same solid meshes provide Canvas faces with palette shading.
  The fallback never resurrects a full house facade or a crossed tree sprite.

Validation: `node scripts/check-world-solids.mjs` renders all 25 families from four directions,
compares overlapping batches against isolated renders, exercises multiple cache pages and
screen-filling models at DPR 1.25, 2 and 3, and saves a gallery to `/tmp/gamine-solid-review/families.png`.
`node scripts/check-asset-consistency.mjs` audits the live world, verifies all seven tree families,
orbits all four sides and a high angle, checks stationary template reuse and saves review images
in `/tmp/gamine-asset-consistency/`. `test/asset-consistency.test.ts` checks replacement coverage,
closed leaf meshes, deterministic variants and preservation of good models.
`test/world-solids.test.ts` checks geometry, materials, scaling, mirroring and mesh reuse.

## Water

`web/app/village/game/solid-water.ts`: one full-screen fragment pass a frame on its own canvas,
stacked by the page between the ground canvas and the scenery canvas, so nothing is read back
and bridges, piers, banks and trees stay over it.

- **Where the water is** comes from the ground image's own blue pixels, measured once into a mask
  at 4 world units a texel: bridge decks, banks and piers are excluded by what they are.
- **River:** streaks three to five cells long moving downstream along `riverCentre`'s own tangent
  (north, into the lake), each lane its own pace, faster mid-stream and up to 1.7x through the
  crossings; dark troughs behind some streaks; foam flicker on the banks.
- **Ponds, the lake and the sea:** slow drifting glints, an occasional sparkle, ripple rings that
  spread and fade.
- Every effect is decided per 4-unit cell on the ground plane, so it reads as crisp pixels at any
  zoom and keeps moving while the camera turns. Night tints it with everything else.
- **Elevation-ready:** a stretch is identified in the shader by region; a stream or a fall with its
  own surface height and flow is another region, not a new system.

**The lake's animals swim** (`game/sea-life.ts`, paths in `lib/world/landscape.ts`). Twelve fish,
turtles and rays are kept out of the baked ground and drawn every frame flat on the water, on the
main canvas under the scenery. Each wanders its own non-repeating loop within the lake, surging and
easing: fish dart with a swishing tail and a faint wake, turtles paddle and rise and dive, rays beat
their wings. Deeper animals draw fainter. `?water=0` holds them still.

## Terrain edge

The world block's sides are no longer a flat prism with painted strata lines. `lib/world/terrain-edge.ts`
builds one eroded perimeter mesh: the top ring is exactly the playable boundary at z = 0, and four
lower rings (turf, soil, earth, sediment, with occasional rock) step outward and down with seeded
erosion, rounded lower corners and uneven depth. Neighbouring segments share every vertex, so
there are no seams. `game/terrain-edge.ts` draws it in the ground bake only, culling back faces
and sorting the rest: no textures, GPU work, world objects or per-frame layers. Turf over the sea
takes a dark silt lip instead of grass. `test/terrain-edge.test.ts` checks the boundary, bounds
and closure; `scripts/check-terrain-edge.mjs` renders it in a browser.

## Layers

The world canvas is now a stack the browser composites: ground (baked per camera change), water
(per frame), scenery and agents (main canvas, baked scenery plus live actors), the night's tint
(`mix-blend-mode: multiply`), labels. Pointer input still goes to the main canvas.

## Performance

The earlier four-structure prototype was measured with `scripts/profile-world-rotation.mjs` on this machine's Intel UHD 620 (headless Chrome,
`--use-angle=gl`), continuous 360° rotation, the full world (8,542 objects, 7,388 trees):

| 1,000 agents | Mean frame | p95 | Paint interval | Heap |
| --- | --- | --- | --- | --- |
| Before (HEAD 3a6a7e1) | 91 ms | 148 ms | 139 ms (~7 fps) | 37-40 MB |
| Four-structure prototype and water on | 57 ms | 77 ms | 74 ms (~13.5 fps) | 34-37 MB, flat |

These measurements predate the expanded families. A local 100-agent, one-orbit smoke check with
software WebGL found stable world objects and agent instances, zero additional texture loads and
no browser errors; its 119 ms mean frame time is not comparable to the hardware numbers above.

Most of the gain is the renderer, not 3D: objects no longer keep a raster canvas each that grew
with every pose (~180 rebuilt per rotating frame before, ~14 tree templates now); the scenery is
baked once per camera change and between changes only the layers that overlap an agent are drawn
again.

An earlier version copied each 3D model and the water from WebGL into the 2D canvas every frame;
each copy made the GPU finish the 2D canvas's pending work, and at 1,000 agents that cost 50 ms a
frame. Hence the batch and the stacked water canvas.

## Further renderer work

The consistency pass uses shared tree renders to keep GPU work independent of forest population.
Scenery and agents still use the existing painter order; this preserves their occlusion behavior.
If a future world has substantially more unique structures or much larger crowds, one instanced
WebGL scenery pass with depth-tested agent quads could replace the remaining Canvas blits and
GPU readback. That is separate from this visual pass; the working arena renderer stays intact.
