import * as Phaser from "phaser";
import { ARENA_TORCHES, COLOSSEUM as O, COLOSSEUM_FLOOR as F } from "./arena-geometry";
import { groundDepth } from "./depth";
import { ROAD_COLOURS } from "./palette";

import { paintArenaArt, ARENA_ART_SCALE as SCALE, ARENA_ART_WIDTH as W, ARENA_ART_HEIGHT as H, ARENA_ART_LEFT as LEFT, ARENA_ART_TOP as TOP } from "./arena-art";

export function loadArena(scene: Phaser.Scene): void {
  scene.load.image("ac-arena-emblem", "/gamine-tb.png");
}

/** Building owns the interactive back/floor layer; the front occludes actors inside the bowl. */
export function buildArenaArt(scene: Phaser.Scene): void {
  if (scene.textures.exists("building-arena")) return;
  const make = (key: string) => scene.textures.createCanvas(key, W, H)!;
  const back = make("building-arena"), front = make("ac-oval-front");
  const crowds = [make("ac-oval-crowd"), make("ac-oval-cheer")];
  const b = back.getContext(), f = front.getContext();
  paintArenaArt(b, f, crowds.map((c) => c.getContext()));
  for (const texture of [back, front, ...crowds]) texture.refresh();
}

export type ArenaHandle = { setCheering: (on: boolean) => void; setNight: (on: boolean) => void };
export function drawArena(scene: Phaser.Scene, still: boolean): ArenaHandle {
  const layer = (key: string, depth: number) => scene.add.image(LEFT, TOP, key).setOrigin(0).setScale(SCALE).setDepth(depth);
  layer("ac-oval-front", O.y + O.ry);
  const crowd = layer("ac-oval-crowd", O.y + O.ry + 1), cheer = layer("ac-oval-cheer", O.y + O.ry + 1).setVisible(false);
  // Gamine's mark, square, in the middle of the floor.
  scene.add.image(F.x, F.y, "ac-arena-emblem").setDisplaySize(136, 136).setAlpha(1).setDepth(groundDepth(-340));
  const plaza = scene.add.graphics().setDepth(groundDepth(-395));
  for (const [x, y, w, h] of [[1400, 1030, 300, 100], [1800, 775, 74, 90]] as const) {
    plaza.fillStyle(ROAD_COLOURS.paved.edge).fillEllipse(x, y, w, h);
    plaza.fillStyle(ROAD_COLOURS.paved.surface).fillEllipse(x, y, w - 10, h - 10);
    // Sparse inset cobbles keep this a village forecourt, not a rectangular sports plaza.
    for (let dy = -h / 2 + 12; dy < h / 2 - 8; dy += 12) for (let dx = -w / 2 + 12; dx < w / 2 - 8; dx += 16) {
      if ((dx / (w / 2 - 9)) ** 2 + (dy / (h / 2 - 9)) ** 2 > 1) continue;
      plaza.fillStyle(ROAD_COLOURS.paved.hi, .55).fillRect(x + dx, y + dy, 8, 4);
    }
  }
  // Emerald-and-gold stone inlays flank the open gathering/entrance corridor.
  for (const side of [-1, 1]) {
    const x = F.x + side * 115;
    plaza.fillStyle(0x116340, .8).fillRect(x - 10, 1027, 20, 8);
    plaza.fillStyle(0xd6a340).fillRect(x - 6, 1029, 12, 4);
  }
  let cheering = false, up = false;
  if (!still) scene.time.addEvent({ delay: 380, loop: true, callback: () => { up = cheering && !up; crowd.setVisible(!up); cheer.setVisible(up); } });
  const lit: Phaser.GameObjects.Image[] = [];
  for (const [i, { x, y }] of ARENA_TORCHES.entries()) {
    const post = scene.add.graphics().setDepth(y);
    post.fillStyle(0xf4bd54, .12).fillEllipse(x, y, 56, 24);
    post.fillStyle(0x153c32).fillRect(x - 4, y - 30, 8, 30);
    post.fillStyle(0xd6a340).fillRect(x - 6, y - 33, 12, 5).fillRect(x - 5, y - 5, 10, 3);
    post.fillStyle(0xe47b27).fillRect(x - 4, y - 43, 8, 10);
    post.fillStyle(0xffc95e).fillRect(x - 2, y - 46, 4, 12);
    post.fillStyle(0xffedab).fillRect(x - 1, y - 40, 2, 6);
    if (scene.textures.exists("dress-solar-glow")) {
      const glow = scene.add.image(x, y - 39, "dress-solar-glow").setDisplaySize(92, 84).setAlpha(0.85).setBlendMode(Phaser.BlendModes.ADD).setDepth(9001).setVisible(false);
      lit.push(glow);
      if (!still) scene.tweens.add({ targets: glow, alpha: 0.58, duration: 310 + i * 53, yoyo: true, repeat: -1 });
    }
  }
  return { setCheering: (on) => { cheering = on && !still; }, setNight: (on) => lit.forEach((g) => g.setVisible(on)) };
}
