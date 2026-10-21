# Mountain and arena polish

Implemented and validated, 13 October 2026.

## Mountain

The old eight-face peak is replaced by a shared 208-triangle solid mountain. Five irregular
contour rings form a broad scree base, broken lower slopes, an asymmetric shoulder and an
off-centre summit. A lower crag joins the footing and breaks the single triangular skyline.
Small faces replace the uninterrupted pyramid wedges. Medium stone gray,
cool blue-gray and lighter gray pixel textures share the existing building material atlas;
a restrained snow patch occupies only the summit. Fixed geometry, directional lighting and
ground shadows work from every camera angle. Canvas fallback and picking use the same mesh.

The existing mountain placement, source width, landmark label and landscape/navigation
reservations remain unchanged. This does not move roads, forests or other structures.

## Arena

The existing arena renderer and layout are preserved: centre (1400,775), width 760, depth 400,
wall height 48, main passage width 192 and east passage width 128. Its camera angle is unchanged.

- Warmer limestone/sandstone walls have staggered course joints, highlighted edges and shaded
  plinths. Small arcade recesses have defined arch stones rather than plain dark vertical marks.
- Six horizontal clay seating treads and vertical risers replace each broad sloping seating
  surface. Sandstone aisle sections, dark timber benches and restrained green accents separate
  seating from circulation.
- Main entrances retain real open passages, deep reveals and folded doors. Varied arch stones,
  darker door wood and the existing green/brass banners strengthen their appearance.
- Terracotta roof surfaces and trim use a richer clay palette. A few wall banners carry the
  green accent through the exterior.
- Sand is cleaner and lighter, with restrained edge wear, faint raking rings and a more readable
  central emblem. Floor grain is reduced from 900 to 320 marks; each gate corridor uses 180
  instead of 900 marks.

## Cost and validation

The mountain reuses the existing solid shader, texture atlas and render cache: one shared mesh,
two GPU draws (model and shadow) when rebaked, and cached blits between camera changes. No
new rendering library or independently loaded textures were added. Arena details remain in
the existing baked scenery system; lower sand grain counts offset some added architectural
detail. These are implementation cost limits, not a measured FPS claim.

Both TypeScript checks and 26 targeted tests passed, covering closed mountain surfaces, summit
snow, directional geometry, mesh sharing, unchanged arena dimensions, open entrances,
landscape routing and perimeter geometry. Browser previews inspect both landmarks from four
angles and assert unchanged placement/footprint and no page errors.

Previews and browser audit are in `/tmp/gamine-landmark-review/`.

## Files changed in this pass

- `web/lib/world/solid-models.ts` — mountain model and material identifiers.
- `web/lib/world/solid-appearance.ts` — mountain replacement policy.
- `web/lib/world/object-geometry.ts` — matching fallback colours and retirement of old mountain wedges.
- `web/app/village/game/solid-materials.ts` — four shared mountain pixel textures.
- `web/app/village/game/arena-art.ts` — coherent sandstone, clay and sand palette.
- `web/app/village/game/projected-art.ts` — arena masonry, arches, stepped seating, banners and floor polish.
- `test/world-landmarks.test.ts` — mountain topology and landmark preservation checks.
- `scripts/check-world-landmarks.mjs` — live world validation and rotated previews.
- `docs/world-landmarks.md` — this report.
