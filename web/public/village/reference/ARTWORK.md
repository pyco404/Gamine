These game sprites were generated with the built-in image_gen tool for the
October 2026 reference-inspired field redesign. The supplied medieval village
image guided the visual direction; the live field keeps Gamine's landmarks,
official crest and interactive agents.

Prompt set: detailed 16-bit JRPG village sprites, top-down three-quarter view,
dark brown pixel outlines, golden thatch, cream plaster, timber frames, muted
green rounded trees, transparent backgrounds, no people, HUD or text. The first
3×3 atlas contains the seven buildings with their role-specific ornaments and
two deciduous trees. The second 3×2 atlas contains three different cottages, a
blacksmith and blue/red striped market stalls. A background-extraction edit
was requested for the second atlas to preserve the sprites on transparency.

`node scripts/village-reference-assets.cjs` extracts the atlases mechanically,
preserves alpha and scales with nearest-neighbour sampling. No runtime image
generation is involved. `node --import tsx scripts/village-art.ts --terrain-only`
rebuilds the existing terrain tiles from the shared palette.
