# Gamine asset consistency review

Implemented 12 October 2026; committed, not yet deployed.

## Retired appearances and replacements

Full legacy house pictures and crossed tree planes no longer render in the world. Original PNGs
remain as capture/layout inputs and sources for small material/decorative crops; deleting them
would break those references. The replacement policy covers captured scenery, map objects and
growth plots, and the old `solid=0` switch cannot bring the legacy facades back.

| Retired appearance | Replacement |
| --- | --- |
| Yellow/blue residential houses, small houses, blue/yellow growth houses | Existing solid cottage family |
| Red residential/growth houses | Existing solid red cottage family |
| Purple houses and apartments | Existing solid townhouse family |
| Smithy and growth offices | Existing solid workshop family |
| Hiring Hall, Strategy Lab, Rulebook House | Existing solid cottage family |
| Game Hall | Existing solid red cottage family |
| Treasury | Existing solid hall family |
| Old huts, sheds and mine building keys, when present | New timber shed with a slate roof |
| Lookout and stock tower keys | Timber watchtower with posts, platform, rails, ladder and roof |

Existing good cottage, townhouse, workshop, market, Hall of Fame and Notice Board geometry is
preserved. The arena keeps its existing renderer, geometry and world coordinates. Doors remain
on appropriate fronts, windows use real wall openings, and roofs, chimneys and beams belong to
fixed world meshes rather than separate front/side pictures.

## Trees

Trees were rebuilt as closed, textured meshes with tapered trunks, roots, branches, irregular
canopy lobes and ground shadows. Seven deterministic variants form one pixel-art family:
small, medium, large, round, tall, sparse and dense. Trees retain their planted coordinates.
Shrubs also use closed foliage volumes. Neither uses camera-facing leaf cards or source sprites.

The audited 100-agent world contained 8,596 objects and 7,468 trees across all seven variants.
Every house, village building, stall, shop, tower, tent, tree and shrub had a solid replacement.
There were zero remaining legacy front-plane audit entries.

## Other small structures

Existing good blue/red market stalls and growth shops/kiosks are reused. The bazaar combines
those two market meshes. Five live camp tents now have pitched canvas surfaces and real poles.
Hiring, strategy and score signs have timber bodies and front-only display panels. Stock arrow
signs and mushrooms have volumetric replacements when present. The fallback also handles old
hut/shed/mine keys, although those keys were absent from the audited captured village.

## Rendering cost

Seven trees and one shrub render once per exact camera yaw/tilt. All forest instances reuse
those eight projected mesh caches. Camera changes do not rebuild geometry; stationary trees
cause no additional GPU uploads, reads or template renders. Only the current pose is retained.
The tree family uses 632–1,080 triangles per shared model and the existing shared pixel atlas,
lighting, projection and shadow pass. Canvas fallback uses the same solid volumes. Picking
shares projected mesh polygons rather than allocating a complete mesh for every forest tree.

One full 72-step camera orbit was measured before and after with moving agents, Chrome
SwiftShader/software WebGL, a 1440×950 viewport and the same profiling script/settings.
Times below are instrumented render times, not FPS or browser paint intervals.

| Agents | Mean render before → after | p95 before → after | Retained JS heap after orbit, before → after |
| --- | --- | --- | --- |
| 100 | 441 → 211 ms | 678 → 318 ms | 33.6 → 45.8 MB |
| 1,000 | 833 → 256 ms | 1,259 → 359 ms | 48.6 → 60.8 MB |

Both after runs kept world objects and agent instances stable, loaded zero additional textures,
rebuilt zero world models, and reported zero page errors. After-run heap stayed approximately
flat through rotation (45.7→45.8 MB and 62.0→60.8 MB). The new shared assets cost about 12 MB
of additional retained JavaScript memory in these samples. Vegetation adds 16 GPU draw calls
and one atlas read per changed pose, independent of tree count. The measurements showed no
render-time regression, but machine load varied and software rendering is slow; these samples
do not establish a hardware FPS guarantee or a general percentage speedup.

Raw results: `/tmp/gamine-rotation-profile/consistency-before.json` and
`consistency-after.json`, with CPU profiles and screenshots alongside them.

## Validation and review artifacts

- Root TypeScript and web TypeScript checks passed.
- Full Vitest suite: 593 passed, 11 Postgres-only cases skipped in the regular run;
  those 11 passed separately against a throwaway real Postgres.
- All 25 solid families from four directions, overlapping atlas batches, GPU size limits,
  screen-filling models at DPR 1.25, 2 and 3, and mirrored geometry.
- Live village coverage, four cardinal camera views and a high view, unchanged world objects,
  all seven tree families, and no extra GPU work for stationary duplicate trees.
- Closed canopy surfaces, seeded family selection, preservation of good models and picking
  translated/scaled meshes from four angles.

The combined check command was terminated before its final summary; the complete Vitest suite
was rerun separately and passed. Browser audits reported no page errors.

Local previews: `/tmp/gamine-asset-consistency/world-front.png`, `world-left.png`, `world-back.png`,
`world-right.png`, `world-high.png`, and `tree-family.png`. Audit: the adjacent `audit.json`.
Model gallery: `/tmp/gamine-solid-review/families.png`.

## Files changed

The review includes the unfinished building work completed in the preceding pass.

- `web/lib/world/solid-appearance.ts` — central replacement policy (new).
- `web/lib/world/solid-models.ts` — shared building, small structure and tree meshes.
- `web/lib/world/model.ts` — applies the policy to map, forest and growth objects.
- `web/lib/world/object-appearance.ts` — decoration aliases and solid asset audit.
- `web/lib/world/object-geometry.ts` — same solid geometry for fallback and picking.
- `web/lib/world/picking.ts` — shared projected picking shapes.
- `web/app/village/game/scene.ts` — captured/growth coverage and removal of legacy toggle.
- `web/app/village/game/solid-materials.ts` — pixel foliage, bark, canvas and display crops.
- `web/app/village/game/solid-renderer.ts` — shared vegetation caches and robust atlas packing.
- `web/app/village/game/fixed-world-art.ts` — routes world objects through solid rendering.
- `web/app/village/game/projected-art.ts` — draws solids correctly without capture layers.
- `test/asset-consistency.test.ts` — coverage, closed foliage, preservation and picking (new).
- `test/world-solids.test.ts` — building mesh and material validation.
- `test/world-orientation.test.ts` — directional tree volume expectations.
- `test/field-camera.test.ts` — geometry-based foliage occlusion.
- `scripts/check-world-solids.mjs` — real browser model/cache validation (new).
- `scripts/check-asset-consistency.mjs` — live world/tree reuse audit and previews (new).
- `docs/world-solids.md` — current renderer and asset documentation.
- `docs/world-directional-assets.md` — marks the former picture system as historical.
- `docs/asset-consistency.md` — this review report (new).
