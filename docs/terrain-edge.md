# Perimeter review

The former rectangular prism and three straight wall stripes were replaced with a cached,
segmented terrain shell. Its top rim follows the original boundary exactly at z=0. Everything
shaped by erosion is below that plane: shallow recesses, protrusions, uneven layer heights,
rounded lower corners and a variable bottom silhouette. Shared vertices keep neighbouring
modules and layers joined. The top field, world bounds and object placements are unchanged.

Materials are a turf lip (dark silt on coastal edges), topsoil, warm earth, deeper sediment and
scattered cooler rock. Fixed mineral patches add restrained detail. Lower corner rings wrap
inward beneath the intact playable corners. Paired triangles paint as single facets to avoid
visible diagonal seams.

For the current map: 182 modules, 1,456 geometry triangles and 176 rock triangles. Only facing
facets paint, during the existing ground bake. Geometry is cached by extent/depth in a bounded
eight-entry cache. One 256×256 ground sample is cached per ground image to identify coastal
lips. No GPU textures, live objects or per-frame perimeter passes are added.

The browser audit checked over 560,000 interior top-surface pixel samples across five camera
angles against the original ground image; all were unchanged. World data was also unchanged.
The isolated perimeter bake measured 4.7 ms mean / 9 ms p95 on this machine. It only runs when
the ground needs rebaking; these timings do not establish a hardware FPS guarantee.

Review images and audit: `/tmp/gamine-perimeter-review/`. Geometry tests check a flat unchanged
top, bounded erosion, variable depth, occasional rock, rounded lower corners and joined seams.

Perimeter files: `web/lib/world/terrain-edge.ts`, `web/app/village/game/terrain-edge.ts`, the
terrain call in `web/app/village/game/projected-art.ts`, `test/terrain-edge.test.ts`, and
`scripts/check-terrain-edge.mjs`.
