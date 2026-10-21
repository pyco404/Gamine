# Fixed world objects and missing directional artwork

**Historical directional-art approach.** Houses, village structures and vegetation now use the
shared solid meshes described in [world-solids.md](world-solids.md). The full house pictures and
crossed tree planes described below are retired from visible rendering. Source art remains useful
for material crops and capture/layout inputs; physically flat objects such as flags retain their cloth faces.

Physical scenery now uses fixed local x/right, y/front and z/up axes tied to each object's world orientation. Camera yaw only changes projection and visible faces. Front artwork is attached to the front plane; it is never mirrored onto the back or substituted with another object's art. An optional `directionalAssets` map accepts correct front/back/left/right frames. Existing source-frame flips remain local to their original front artwork.

Geometry is continuous through diagonal angles; only cross-form structures switch plane at the diagonal (below). A five-degree dead band is available for future discrete directional sets. Scene source sprites remain hidden capture inputs. Agents keep their independent animation, facing, sprite instances and shared simulation. UI labels and speech remain readable camera-facing UI. Match tables, cards and chips now project from fixed world axes too.

## Derived directional sets

Every structure in the world now has a back, left and right view made from its own front picture,
so rotating the camera shows the same object in the same wall, roof, trim and base materials.
`scripts/village-directional-art.cjs` builds them into `web/public/village/reference/directional/`
and writes `web/lib/world/directional-views.json`, which says how each one stands. Nothing is
invented and no other object's art is borrowed. Each view is built from the front's own pixels:
- **Back:** the front mirrored, with what only the front has (a door, a sign or crest, a display,
  a lock, a plaque, a prop by the door) covered by the structure's own wall sections, or
  repainted in its own frame or canvas material.
- **Sides:** the structure's own ends, as the front picture shows them. Where one end has a
  front-only prop beside it (the Treasury's chest, the Strategy Lab's easel, the Hiring Hall's
  notice board), both sides use the clean end, one of them mirrored.

Each category stands as what it physically is, not as a house:

| Construction | Structures | How it stands |
| --- | --- | --- |
| body | cottages, Rulebook House, the five halls, smithy, market stalls, Bazaar, chest, war table, bench, log | a picture on each wall, as deep as its end picture is wide (no stretching); a solid one's top is closed by a low cap inside the painted silhouette, in its own sampled roof and wall colours, raised off the ground so gaps at its foot show ground |
| board | leaderboard, scoreboard, hiring and strategy boards, banners, flags, fence | a thin panel: the display or cloth on the front, the board's frame material (or the cloth's mirror) behind, a narrow edge |
| cross | Lookout, tents, Launch Pad, statue, trophy, practice dummy, fountain, pumpkin, gold, coins | a plane each way through its middle; the one facing the camera most is drawn, so a round base never shows edge-on through another view |

A structure with a derived set no longer gets its kind's generic box, beams, glass or rear door.
Sprite sheets (Launch Pad, leaderboard, scoreboard, flag) take their first frame for the other sides.
The fountain and pumpkin are built from their recoloured copies, as the scene loads them.

The growth buildings (`modern-office`, `-house-a`, `-house-b`, `-shop`, `-apartments`, `-kiosk`) are
their source pictures trimmed and shrunk, so their views are the source's own views shrunk the same
way (`scaled` entries in the script). A solid body's top is closed by a hipped lid set inside its
walls, in the roof's own colour sampled as a 9-pixel mean, so it never shows beside the pictures.

Still front-only, on their own fixed geometry: the modern villas (`growth-House_*`), the green cottage
piece (art derived, not placed), the campfire and torches, the solar lamps, stumps, the pier, and the mountain. Trees and shrubs
keep their own crossed-plane foliage. The derived views reuse each front's pixels; they are not
newly painted orthographic facades, so a back is close to a mirrored front.

## Temporary geometry

For structures without a derived set:

| Category | Missing-art treatment |
| --- | --- |
| Houses | Timber/plaster walls, matching roof colours, side/rear windows and rear access |
| Major landmarks | Material-matched bodies plus landmark-specific towers, extensions, steps or chimneys |
| Shops | Storefront, counter/awning and rear service door |
| Bazaar/market | Open posts, customer counter, canopy and rear storage |
| Signs/Notice Board | Thin sign panel, two posts and plain rear braces |
| Lookout | Posts, raised platform, fixed front ladder and roof |
| Tents | Triangular fabric volume with a front entrance |
| Trees/shrubs | Seeded asymmetric trunk and faceted foliage volumes; no spinning canopy sprite |
| Benches/tables | Fixed seat/back/legs or tabletop/legs |
| Flags/lamps/torches | Pole, cloth, lantern or flame volumes |
| Fountain | Tiered basin, water surfaces and central column |
| Launch Pad | Platform, rocket, fins and gantry |
| Fences/chests/statues/rocks | Category-specific rails, containers or simple decorative volumes |
| Practice dummy/stumps | Wooden training dummy or stump volumes |
| Unknown future props | Own fixed front art on a neutral support, reported for bespoke geometry |
| Arena/bridge/terrain | Existing Arena and bridge geometry, and projected terrain remain in place |

The original source frames may contain transparent padding. Their own opaque pixel bounds now determine rendered proportions and front UV coordinates; model footprints, positions and routing reservations remain unchanged. Picking uses the same projected faces and texture coordinates. Labels follow visible roofs rather than empty source-image padding.

## Complete loaded-asset inventory

Inventory captured from the 100-resident browser fixture. Growth repeats these same asset keys; the raw grouped inventory is [world-directional-assets.json](world-directional-assets.json). A present front means the existing source asset is available, not that it is a newly authored orthographic facade. Geometry-only trees and some props do not need their source silhouette as a directional face.

No authored back, left or right sets were found for these sprite assets. Arena, procedural torches and terrain require geometry rather than new directional artwork. Correct rear/side artwork remains missing for every sprite entry below.

| Type | Existing front asset / landmark | Back | Left | Right |
| --- | --- | --- | --- | --- |
| arena | `site:arena` — Arena | native geometry | native geometry | native geometry |
| bench | `ac-bench` | derived | derived | derived |
| bridge | `ac-pier` | missing | missing | missing |
| chest | `ac-chest` | derived | derived | derived |
| fence | `farm-fence` | derived | derived | derived |
| fence | `fence` | missing | missing | missing |
| fire | `effects-fire-fire` | missing | missing | missing |
| fire | `torch` | missing | missing | missing |
| flag | `ac-banner` | derived | derived | derived |
| flag | `ac-banner-fame` | derived | derived | derived |
| flag | `ac-banner-gold` | derived | derived | derived |
| flag | `ac-flag` | derived | derived | derived |
| fountain | `dress-fountain` | derived | derived | derived |
| house | `building-alchemist` — Rulebook House | derived | derived | derived |
| house | `dress-house-blue` | derived | derived | derived |
| house | `dress-house-red` | derived | derived | derived |
| house | `dress-house-yellow` | derived | derived | derived |
| house | `growth-apartments` | missing | missing | missing |
| house | `growth-house-a` | missing | missing | missing |
| house | `growth-house-b` | missing | missing | missing |
| house | `growth-office` | missing | missing | missing |
| lamp | `dress-solar-lamp` | missing | missing | missing |
| launch-pad | `building-launchpad` — Launch Pad | derived | derived | derived |
| major-building | `building-castle` — Strategy Lab | derived | derived | derived |
| major-building | `building-chapel` — Treasury | derived | derived | derived |
| major-building | `building-forge` — Game Hall | derived | derived | derived |
| major-building | `building-library` — Hall of Fame | derived | derived | derived |
| major-building | `building-tavern` — Hiring Hall | derived | derived | derived |
| market | `building-bazaar` — Bazaar | derived | derived | derived |
| market | `market-blue` | derived | derived | derived |
| market | `market-red` | derived | derived | derived |
| miscellaneous | `ac-dummy` | derived | derived | derived |
| miscellaneous | `stump-3` | missing | missing | missing |
| miscellaneous | `stump-4` | missing | missing | missing |
| mountain | `wild-mountain` — Mountain | missing | missing | missing |
| rock | `ac-coins` | derived | derived | derived |
| rock | `ac-log` | derived | derived | derived |
| rock | `farm-pumpkin` | derived | derived | derived |
| rock | `prop-gold` | derived | derived | derived |
| shop | `growth-kiosk` | missing | missing | missing |
| shop | `growth-shop` | missing | missing | missing |
| shop | `village-smithy` | derived | derived | derived |
| shrub | `bush-1` | missing | missing | missing |
| shrub | `bush-2` | missing | missing | missing |
| shrub | `bush-4` | missing | missing | missing |
| sign | `ac-hiring-board` | derived | derived | derived |
| sign | `ac-scoreboard` | derived | derived | derived |
| sign | `ac-strategy-board` | derived | derived | derived |
| sign | `building-board` — Notice Board | derived | derived | derived |
| statue | `ac-statue` | derived | derived | derived |
| statue | `ac-trophy` | derived | derived | derived |
| table | `ac-war-table` | derived | derived | derived |
| tent | `ac-tent` | derived | derived | derived |
| tower | `building-watchtower` — Lookout | derived | derived | derived |
| tree | `resources-trees-tree` | missing | missing | missing |

## Current limits and follow-up art

For structures without a derived set, rear/side models are temporary geometry, not finished pixel-art directional packs. The existing front pictures include perspective and cannot supply accurate hidden architectural details. Treasury, Hall of Fame, Strategy Lab, Game Hall, Hiring Hall, Rulebook House, shop/storefronts and the Lookout need their own authored directional facades or richer bespoke meshes for exact fidelity. Market canopies, tent fabric, foliage, fountain and rocket surfaces would benefit from their own materials/geometry detail. Decorative animal, statue, rock and miscellaneous volumes are deliberately simple.

No unintended physical billboard remains in the migrated render path. Front planes becoming thin edge-on is expected physical projection, not a visibility switch. Flags are thin cloth. Shadows/glows captured into the terrain and readable UI overlays are not directional scenery. Arena geometry, entrance and faded floor logo are unchanged.

## Validation

- Full 360-degree orbit of 14 representative categories, with fixed meshes, valid projected vertices, stable agent instances and screenshots of each side.
- Browser movement/occlusion/zoom/rotation/tilt/route checks with 100 and 1,000 agents; no missing paints, remounts or texture fallbacks.
- Root and web typechecks and production build passed. Desktop/mobile shell tests passed camera persistence, touch controls, route overlays and wallet fixture continuity.
- Unit coverage for fixed match-table vertices, cardinal orientation, boundary dead band, correct face assets, no front-art reuse on rear/sides, opaque-frame proportions, picking, town layout and simulation routes.

Run `node scripts/check-world-objects.mjs` against a local web server to regenerate the detailed runtime inventory and screenshots in `/tmp/gamine-world-objects`.

## Files changed

- `web/lib/world/model.ts`: optional appearance/directional assets and source-frame content bounds.
- `web/lib/world/object-appearance.ts`: object classification, fixed orientation, optional side selection and inventory.
- `web/lib/world/object-geometry.ts`: stationary object-specific meshes and visible-face projection.
- `web/lib/world/object-materials.ts`: shared existing material palette.
- `web/lib/world/picking.ts`: mesh-based hit testing and matching front UV sampling.
- `web/app/village/game/fixed-world-art.ts`: cached mesh rasterization and fixed-face texture mapping.
- `web/app/village/game/projected-art.ts`: replace upright scenery sprite painting with fixed meshes.
- `web/app/village/game/projected-materials.ts`: use the shared material palette.
- `web/app/village/game/scene.ts`: cache source pixel bounds and provide table projection callbacks.
- `web/app/village/game/table.ts`: fix table/card/chip world orientation.
- `web/app/village/world-camera.tsx`: project physical tables and anchor labels to visible roofs.
- `test/world-orientation.test.ts`, `test/field-camera.test.ts`, `web/test/world-table.test.ts`: orientation, asset ownership and geometry-based picking coverage.
- `scripts/check-world-objects.mjs`, `scripts/check-world-agents.mjs`: full-orbit visual audit and physical occlusion regression.
- `docs/world-directional-assets.md`, `docs/world-directional-assets.json`: this report and complete grouped loaded-asset inventory.
