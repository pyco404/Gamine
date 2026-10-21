import { standee } from "./billboard";
import { groundDepth } from "./depth";
import * as Phaser from "phaser";

import { ROAD_COLOURS, warm } from "./palette";
import { CARPET, SQUARE } from "./town";

/**
 * The village's set dressing: what makes the map read as a town built round
 * the game rather than eight landmarks in a forest - the crest flying over it,
 * each building's props (the leaderboard aside, which is a building), the
 * agent grounds at the forest's edge, the town square.
 * Placed here rather than in the map, so an import of Agent Quest's map
 * (scripts/village-import.ts) never loses it.
 *
 * The banners, flags, boards, statues, chests, tents and the rest are drawn
 * for Gamine (scripts/village-art.ts) in the Tiny Swords pack's palette
 * and the crest's. The cottages, the fountain, the gold sacks and the ship
 * are the pack's own or drawn for it before (public/fixtures/LICENSE.txt).
 *
 * Nothing here is clickable, and none of it is a building: it only decorates.
 * What is solid - a cottage, the fountain, a tent - is solid to walkers too,
 * so an agent goes round it rather than through it.
 */

import { overRoad, PIECES, type Piece } from "./pieces";

export { overRoad, PIECES };

export function loadDressing(scene: Phaser.Scene): void {
  const seen = new Set<string>();
  for (const p of PIECES) {
    if (p.mapped || seen.has(p.key) || scene.textures.exists(p.key)) continue;
    seen.add(p.key);
    // The pack's own pictures come recoloured to the terrain palette where they need it (palette.ts).
    const art = warm(p.image);
    const url = ["ac-banner", "ac-banner-fame", "ac-banner-gold", "ac-flag"].includes(p.key) ? `${art}?v=agp-logo-1` : art;
    if (p.sheet) scene.load.spritesheet(p.key, url, { frameWidth: p.sheet.frameWidth, frameHeight: p.sheet.frameHeight });
    else scene.load.image(p.key, url);
    // Its back and sides, where they have been made (directional-art.ts).
    for (const view of directionalSources(p.key, p.image)) scene.load.image(view.key, view.url);
  }
}

/** A piece's place on the ground, for the town's lots: the forest keeps clear of it. */
export type Bounds = { x: number; y: number; width: number; height: number };

/** Draw the dressing, each piece at the depth of its foot like the map's own; return what is solid, and where everything is. */
export function drawDressing(scene: Phaser.Scene, still: boolean, pieces: readonly Piece[] = PIECES): { solids: Bounds[]; placed: Bounds[] } {
  // Scattered worn cobbles under the stalls; the ordinary roads supply their connection.
  // No enclosing platform or kerb: grass meets the market along an uneven edge.
  const market = scene.add.graphics().setDepth(groundDepth(-410));
  for (const [sx, sy] of [[1250, 1440], [1510, 1460]]) {
    for (let row = -18; row <= 18; row += 9) for (let col = -48; col <= 48; col += 14) {
      if ((Math.abs(col) / 48 + Math.abs(row) / 24) > 1.5 || (col + row) % 5 === 0) continue;
      const x = sx! + col + row % 3, y = sy! + row;
      market.fillStyle(ROAD_COLOURS.paved.surface, .7).fillRect(x, y, 9, 5);
      market.fillStyle(ROAD_COLOURS.paved.hi, .4).fillRect(x + 1, y, 6, 2);
    }
  }
  // The square and the carpet first, just over the map's roads, so they join them without a seam.
  const g = scene.add.graphics().setDepth(groundDepth(-399));
  const sq = SQUARE;
  // The same stone colour as the roads, so they join without a colour change.
  const road = ROAD_COLOURS.paved;
  g.fillStyle(road.shadow, road.shadowAlpha).fillEllipse(sq.x, sq.y, sq.rx * 2 + 6, sq.ry * 2 + 6);
  g.fillStyle(road.edge, 1).fillEllipse(sq.x, sq.y, sq.rx * 2, sq.ry * 2);
  g.fillStyle(road.surface, 1).fillEllipse(sq.x, sq.y, sq.rx * 2 - 26, sq.ry * 2 - 16);
  const c = CARPET;
  g.fillStyle(road.edge, 1).fillRect(c.x - c.width / 2 - 3, c.y0, c.width + 6, c.y1 - c.y0);
  g.fillStyle(road.surface, 1).fillRect(c.x - c.width / 2 + 2, c.y0, c.width - 4, c.y1 - c.y0);

  const solids: Bounds[] = [];
  const placed: Bounds[] = [];
  for (const p of pieces) {
    if (!scene.textures.exists(p.key)) continue;
    const obj = p.sheet ? scene.add.sprite(p.x, p.y, p.key, p.sheet.start ?? 0) : scene.add.image(p.x, p.y, p.key);
    obj.setOrigin(0.5, p.foot ?? 1).setScale(p.scale).setFlipX(p.flip ?? false).setDepth(p.depth ?? p.y);
    if (p.sheet && obj instanceof Phaser.GameObjects.Sprite && !still) {
      const anim = `${p.key}:loop`;
      if (!scene.anims.exists(anim)) {
        scene.anims.create({ key: anim, frames: scene.anims.generateFrameNumbers(p.key, {}), frameRate: p.sheet.frameRate, repeat: -1 });
      }
      obj.play({ key: anim, startFrame: p.sheet.start ?? 0 });
    }
    if (p.bob && !still) {
      scene.tweens.add({ targets: obj, y: p.y + 3, angle: 1.5, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    if (p.solid) solids.push({ x: p.x, y: p.y, width: p.solid.width, height: p.solid.height });
    placed.push({ x: p.x, y: p.y, width: obj.displayWidth, height: obj.displayHeight * (p.foot ?? 1) });
    if (!p.key.includes("farm-bed") && !p.key.includes("pier")) standee(obj, Boolean(p.solid));
  }
  return { solids, placed };
}

/**
 * Solar lights round the town square and down to the lakeside: little lamp posts with a panel on top,
 * drawn here in the pack's palette since the pack has none. By day they are
 * dark, charging; at night they come on, a warm pool on the ground and a glow
 * drawn over the night's blue so it reads as light rather than as paint.
 */
import { SOLAR_LIGHTS } from "../../../lib/world/landmarks";
import { directionalSources } from "../../../lib/world/directional-art";
export { SOLAR_LIGHTS } from "../../../lib/world/landmarks";

/** The lamp, a row to a string, in art pixels: panel, lamp, cap, post, foot. */
const LAMP_ART = [
  ".ppppp.",
  "pPPPPPp",
  ".ooooo.",
  ".ogggo.",
  ".ogggo.",
  "..ooo..",
  "...o...",
  "...o...",
  "...o...",
  "...o...",
  "...o...",
  "...o...",
  "..ooo..",
];
const LAMP_COLOURS: Record<string, number> = { p: 0x1d2b4f, P: 0x4a6fa5, o: 0x2b2f36, g: 0xd8d2b8 };
/** World pixels to an art pixel, about the pack's own. */
const LAMP_PX = 2;
/** Where the lamp's glass is, in art pixels from the top. */
const LAMP_GLASS_Y = 3.5;

/** The lamp's picture and a soft round glow, made once. */
function lampTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists("dress-solar-lamp")) {
    const g = scene.make.graphics({}, false);
    LAMP_ART.forEach((row, y) =>
      [...row].forEach((c, x) => {
        const colour = LAMP_COLOURS[c];
        if (colour !== undefined) g.fillStyle(colour, 1).fillRect(x * LAMP_PX, y * LAMP_PX, LAMP_PX, LAMP_PX);
      }),
    );
    g.generateTexture("dress-solar-lamp", LAMP_ART[0]!.length * LAMP_PX, LAMP_ART.length * LAMP_PX);
    g.destroy();
  }
  if (!scene.textures.exists("dress-solar-glow")) {
    const size = 64;
    const canvas = scene.textures.createCanvas("dress-solar-glow", size, size);
    const ctx = canvas?.getContext();
    if (canvas && ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255,236,170,1)");
      grad.addColorStop(0.35, "rgba(255,214,120,0.45)");
      grad.addColorStop(1, "rgba(255,200,100,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      canvas.refresh();
    }
  }
}

/** Draw the solar lights, off; the handle turns them on for the night. */
export function drawSolarLights(scene: Phaser.Scene, still: boolean): { setNight: (on: boolean) => void } {
  lampTextures(scene);
  const lit: Phaser.GameObjects.GameObject[] = [];
  const height = LAMP_ART.length * LAMP_PX;
  for (const [i, at] of SOLAR_LIGHTS.entries()) {
    scene.add.image(at.x, at.y, "dress-solar-lamp").setOrigin(0.5, 1).setDepth(at.y);
    const glassY = at.y - height + LAMP_GLASS_Y * LAMP_PX;
    // Over the night's blue (depth 9,000), under the names: light, not a colour under the dark.
    const pool = scene.add.image(at.x, at.y + 2, "dress-solar-glow").setDisplaySize(90, 40).setAlpha(0.35);
    const halo = scene.add.image(at.x, glassY, "dress-solar-glow").setDisplaySize(44, 44).setAlpha(0.8);
    const glass = scene.add.rectangle(at.x, glassY, 3 * LAMP_PX, 2 * LAMP_PX, 0xfff6c8);
    for (const o of [pool, halo, glass]) {
      o.setDepth(9_001).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      lit.push(o);
    }
    // A slow breath, out of step from lamp to lamp.
    if (!still) {
      scene.tweens.add({ targets: halo, alpha: 0.55, duration: 1600 + i * 170, yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: i * 240 });
    }
  }
  return { setNight: (on) => lit.forEach((o) => (o as Phaser.GameObjects.Image).setVisible(on)) };
}
