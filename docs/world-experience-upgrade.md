# World experience upgrade

## Audit and implementation plan

The persistent Next.js shell owns navigation, wallet sessions, the field poll and
the shared server-sent match stream. Phaser owns the existing simulation, sprite
animation, pathfinding and captured ground artwork. WorldCamera presents that
same world through layered projected canvases, with a WebGL water/solid path and
canvas fallbacks. Native pixel art, procedural textures and deterministic world
geometry are reused. There is no WebSocket transport to replace.

The renderer already has districts, gardens, riverbanks, growth, directional
characters, activity props, shadows, day/night, culling and a baked scenery
cache. Rebuilding them would duplicate authoritative state. Improvements should
make those systems legible and enrich their presentation.

Preserve public API shapes, movement coordinates, road and collision geometry,
server activity snapshots, deterministic generation, wallet authentication,
private strategy ownership, match outcomes, scoring, holding thresholds,
70/30 creator-fee destinations, the 0.1 SOL fee, and disabled financial features.
No schema, signing or production changes are part of this upgrade.

Milestones:

1. Capture the local baseline and add deterministic, bounded ground detailing.
2. Add lightweight, culled atmosphere with reduced-motion support.
3. Improve navigation, camera controls and readable responsive world HUDs.
4. Show selected-agent information through existing authorized API reads and
   show actual arena playback without revealing an outcome early.
5. Validate typechecks, game/world tests, production build and desktop/mobile
   browser regressions, including camera gestures, lifecycle and screenshots.

Performance priorities are avoiding scenery rebuilds while idle, avoiding
per-frame full-world label filtering, bounding decorative work, pausing hidden
tab presentation, and keeping frequently ticking UI outside the world shell.
Diagnostics belong behind development-only flags. Software-rendered browser
measurements are regression evidence, not physical mobile GPU benchmarks.

Existing uncommitted work is retained. No production deployment is authorized
by this task. Changes remain uncommitted under the earlier no-commit instruction.

## Implemented

- Ground detail is seeded and bounded to at most 576 candidates across the
  existing districts. Small grass, flower and pebble clusters avoid roads,
  water, arena footprints and reserved lots. A single Graphics layer joins the
  existing ground bake; no extra texture files or collision objects are added.
- The existing arena gains cached decorative spectators and two animated entry
  pennants. Existing introductions, table actions, outcome animations and
  server-authoritative match data remain in use.
- A compact arena HUD expands inside the village. Its timer reads the actual
  renderer showing key, including replays and the arrival time of both agents.
  The shared reveal helper withholds future actions, hands and outcomes. Empty
  states do not invent matches; house exhibitions explicitly earn no rewards.
- Navigation uses readable type and a wordmark. Village stats distinguish
  players, house residents, matches and cosmetic activity. The persistent page
  shell remains a desktop side panel and a mobile bottom sheet.
- Village, arena and whole-world buttons, a district selector and a pan-drag
  toggle extend the existing camera. Rotation, Shift-pan, pinch, keyboard
  navigation, zoom limits, selected-agent follow and overlay scroll behavior
  remain. Focus changes ease; reduced motion frames immediately.
- Public agent records gain verified activity and Notice Board progress, plus
  shortened wallet/token identities with full-address copy actions retained.
  Existing authenticated agent management remains the only editing path.
- Holding verification distinguishes checking, unverified, stale/unavailable,
  eligible and temporarily ineligible states. This is display logic only.
- Atmosphere reuses world coordinates for culled chimney particles, entry
  banners, restrained torch cores and cloud shadows. Reduced motion suppresses
  smoke/cloud movement and freezes water animation; day/night remains manual.
- Landmark candidate lists are cached per world revision. Presentation skips
  hidden tabs. Mobile presentation caps backing density at 1.5, desktop at 2,
  and the hidden source renderer at 2. Water bridge uniforms reuse a typed array
  instead of allocating arrays each frame. Software WebGL contexts use at most
  160 small animated pixel ripples rather than the full-screen shader; native
  GPU contexts retain the detailed water pass. The water pass explicitly releases
  GPU resources during cleanup. Diagnostics are development-only.

## Upgrade files

Earlier wallet/configuration work remains in the working tree. The files below
are specifically part of this world/UI task:

- `web/app/globals.css`
- `web/app/site-bar.tsx`
- `web/app/shell.tsx`
- `web/app/holder-panel.tsx`
- `web/app/a/[id]/page.tsx`
- `web/app/a/[id]/ownership.tsx`
- `web/app/village/agent-status.tsx`
- `web/app/village/arena-hud.tsx`
- `web/app/village/selected-agent.tsx`
- `web/app/village/world-status.tsx`
- `web/app/village/world-camera.tsx`
- `web/app/village/game/index.ts`
- `web/app/village/game/scene.ts`
- `web/app/village/game/projected-art.ts`
- `web/app/village/game/solid-water.ts`
- `web/app/village/game/atmosphere.ts`
- `web/app/village/game/ground-detail.ts`
- `web/lib/world/ground-detail.ts`
- `web/lib/world/match-presentation.ts`
- `web/lib/eligibility-presentation.ts`
- `web/test/world-experience.test.ts`
- `scripts/check-world-experience.mjs`
- `scripts/check-world-shell.mjs`
- `scripts/check-world-agents.mjs`
- `docs/world-experience-upgrade.md`

## Validation and remaining checks

Both root and web TypeScript checks passed. The 112 web tests passed, including
16 new world, reveal timing, verification-state and software-water regressions. The selected
world/game suites passed 92 tests; the 9 holder tests passed separately with
local-port permission, after a sandbox restriction prevented the first server
startup. Source and database migration files are unchanged by this task.

The final optimized production build passed. The existing world-shell browser
regression passed against production: all nine destinations, one map load,
continuing agent movement, owner follow, history navigation, touch rotation and
pinch, and no page errors. The new experience suite passed at 1440×960 desktop,
390×844 touch/mobile and 768×1024 reduced-motion tablet sizes. It verifies camera
shortcuts, district selection, pan mode, progressing arena playback, public
agent selection without remounting the world, mobile menu/sheet behavior,
nonoverlapping arena/page-toggle controls, and no horizontal overflow.
A fresh 390px mobile read also confirmed layout and visual viewport widths of
390, visual scale 1, and a page-toggle right edge of 382px.
There is no configured ESLint command in this repository; whitespace checks and
TypeScript validation are available.

Screenshots and machine-readable browser results are written to
`/tmp/gamine-upgrade`. The browser scripts use local data and sign no wallet
messages or transactions. GPU timings from headless software rendering cannot
establish performance on a physical integrated GPU or phone.

No upgrade commits have been created and nothing has been staged. This follows
the earlier no-commit instruction while its conflict with the supplied commit
workflow remains unanswered. No production deployment or production financial
configuration change is performed by this task. Receiving addresses remain
unset and financial execution remains disabled.


## Screenshots and logs

- Before: `/tmp/gamine-upgrade/before-desktop.png`
- Desktop: `/tmp/gamine-upgrade/after-desktop.png`
- Expanded arena: `/tmp/gamine-upgrade/after-arena.png`
- Night: `/tmp/gamine-upgrade/after-night.png`
- Selected agent: `/tmp/gamine-upgrade/after-selected-agent.png`
- Mobile: `/tmp/gamine-upgrade/after-mobile.png`
- Reduced-motion tablet: `/tmp/gamine-upgrade/after-tablet-reduced-motion.png`
- Browser results: `/tmp/gamine-upgrade/browser-results.json`
- Production build: `/tmp/gamine-upgrade/production-build.log`
- Existing browser regression: `/tmp/gamine-upgrade/shell-browser.log`
- New browser regression: `/tmp/gamine-upgrade/experience-browser.log`
- Web tests: `/tmp/gamine-upgrade/web-tests.log`

## Limitations

The existing district/building coordinates, navigation and character art are
retained. No additional game modes, passive rewards or activity economy are
introduced. This does not claim a physical-phone or integrated-GPU benchmark;
representative browser sizes and reduced-motion/touch emulation were tested.
The development webpack runner still reports existing optional Privy/Farcaster
and legacy Phaser sea-mask warnings; the optimized production build and page
error assertions pass. There is no configured lint script to run.

Real-wallet signing and funded launches/payouts were deliberately not exercised.
Their existing unit tests passed, and launch readiness remains false with no
receiving address configured. Physical-device performance and visual testing
remain a recommended release check. Production deployment is a separate action.

Commit history for this upgrade: **none**. No staging or commits were performed.

## Rendering sample

An 8.1-second warmed production sample at 1440×960, with 24 house residents and
8,774 world objects, produced 91 painted frames: **11.3 painted FPS** (86 ms median
interval, 106.5 ms p95), on **SwiftShader software rendering** on the shared
development host. The world model stayed stable, the reported JS heap was
about 163 MiB, and there were no page errors. This is a post-change observation,
not an improvement claim or a physical-device benchmark. These software-renderer
figures do not establish smooth performance on phones; physical-device profiling
remains necessary. Raw data: `/tmp/gamine-upgrade/performance-before-water-fallback.json`.


### Software water comparison

The water-off comparison painted **29.4 FPS**, identifying the full-screen
shader as the main cost on this software GPU. With automatic lightweight
ripples enabled, the updated production sample painted **27.4 FPS** over eight
seconds (36.3 ms median interval, 48.9 ms p95), with the same 24 residents and
8,774 world objects. The world model remained stable and no page errors were
reported. This is about 2.4× the earlier 11.3 FPS observation on the shared
host, with animated water retained; it is not a physical-device guarantee.
Raw samples: `performance-before-water-fallback.json`,
`performance-without-water.json`, and `performance.json` in
`/tmp/gamine-upgrade`.

The legacy agent stress harness originally requested a 90° top view and an
80° high view, outside the existing 15–55° gesture bounds. It now reads the
shared bounds and stresses their endpoints; the product camera limits were not
changed. Large-population render checks run in development because their
internal identity/occlusion diagnostics are intentionally absent in production.

The completed stress run passed with both **100 and 1,000 agents** across six
camera views and the launch, live, games and world routes. Movement, viewport
retention, pixel occlusion and world continuity checks passed with no missing
renders or fallback character art. Median development frame intervals were
83.3 ms at 100 agents and 133.3 ms at 1,000 agents on this software-rendered
host. These checks establish rendering correctness under load, not smooth
large-population performance. Log: `/tmp/gamine-upgrade/agent-stress-browser.log`;
screenshots: `/tmp/gamine-upgrade/agents`.

The temporary development stress server was stopped after validation. The local
production preview remains available at `http://localhost:3001`, backed by the
isolated in-memory API, with launches and payout execution disabled.
