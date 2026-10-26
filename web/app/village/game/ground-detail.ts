import type * as Phaser from "phaser";
import type { WorldModel } from "../../../lib/world/model";
import { groundDetail } from "../../../lib/world/ground-detail";
import { groundDepth } from "./depth";

/** One baked graphics layer: no added textures, actors or per-frame callbacks. */
export function drawGroundDetail(scene: Phaser.Scene, world: WorldModel): void {
  const g = scene.add.graphics().setDepth(groundDepth(-470));
  for (const p of groundDetail(world)) {
    const { x, y, variant: v } = p;
    g.fillStyle(0x263f2c, 0.09).fillEllipse(x, y + 2, 34 + v * 5, 13 + v * 3);
    if (p.kind === "flowers") {
      for (let i = 0; i < 5; i++) {
        const px = x + (i * 13 % 25) - 12, py = y + (i * 7 % 15) - 7;
        g.fillStyle(0x436947, 0.75).fillRect(px, py, 2, 5);
        g.fillStyle([0xdfc879, 0xb7b7db, 0xe6dfb6, 0xc28d91][v]!, 0.85).fillRect(px - 1, py - 2, 4, 3);
      }
    } else if (p.kind === "pebbles") {
      g.fillStyle(0xb2b09a, 0.65).fillRect(x - 6, y, 8, 4).fillRect(x + 4, y + 4, 5, 3);
      g.fillStyle(0x656e59, 0.6).fillRect(x - 6, y + 3, 8, 2);
    } else {
      g.fillStyle([0x748b57, 0x91a56b, 0x607e4e, 0xa0ac73][v]!, 0.65);
      for (let i = 0; i < 5; i++) g.fillRect(x + (i * 11 % 23) - 11, y + (i * 7 % 13) - 6, 2, 3 + i % 3);
    }
  }
}
