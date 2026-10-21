import { COLOSSEUM as O, COLOSSEUM_FLOOR as F, ARENA_GATE_WIDTH, ARENA_SIDE_WIDTH } from "./arena-geometry";
import { TERRAIN } from "./palette";

/** Bake an oval colosseum once in two-world-pixel steps, using the existing renderer and emblem. */
export const ARENA_ART_SCALE = 2, ARENA_ART_WIDTH = 420, ARENA_ART_HEIGHT = 280;
const SCALE = ARENA_ART_SCALE, W = ARENA_ART_WIDTH, H = ARENA_ART_HEIGHT;
export const ARENA_ART_LEFT = O.x - W, ARENA_ART_TOP = 975 - H * SCALE;
const STEP = Math.PI * 2 / 96;
/** A single material palette: identity colours carry the landmark; stone supports it. */
/**
 * The village's own materials: the Hall of Fame's and Game Hall's red-brown roofs, the Treasury's
 * grey-beige stone, the timber of the cottages' framing, a natural trodden-sand floor. Gamine
 * green is a trim and seating accent, gold a thin brass highlight.
 */
export const ARENA_PALETTE = {
  emerald: "#1f5a3e", green: "#2e7d52", teal: "#2a6a5c", dark: "#2a2119", mint: "#8cc79c",
  gold: "#d0a24a", goldLight: "#ecd08e", goldDark: "#7d5a2c",
  stone: "#c1aa83", stoneLight: "#e0ccaa", stoneShade: "#927d61", joint: "#67543d",
  wood: ["#4d3222", "#64412b", "#7b5234", "#94673f"], woodDark: "#33251b",
  roof: "#ad543a", roofLight: "#ce7953", roofShade: "#753b2b", roofTile: "#e5a174",
  sand: "#d6c39f", sandLight: "#ead9b7", sandShade: "#b6a17a", sandEdge: "#8c7452",
} as const;
const C = ARENA_PALETTE;
type P = [number, number];
const outer = (a: number, elevated = true): P => [O.x + Math.cos(a) * O.rx, O.y + Math.sin(a) * O.ry - (elevated ? O.wallHeight : 0)];
const ring = (a: number, t: number): P => [F.x + Math.cos(a) * (F.rx + (O.rx - F.rx) * t), F.y + (O.y - F.y) * t + Math.sin(a) * (F.ry + (O.ry - F.ry) * t) - O.wallHeight * t];
const openSector = (a: number) => Math.sin(a) > 0 && Math.abs(Math.cos(a) * O.rx) < ARENA_GATE_WIDTH / 2
  || Math.cos(a) > 0 && Math.abs(Math.sin(a) * O.ry) < ARENA_SIDE_WIDTH / 2;


const LEFT = ARENA_ART_LEFT, TOP = ARENA_ART_TOP;

/** Static pixel artwork only; geometry, collisions and autonomous movement live elsewhere. */
export function paintArenaArt(b: CanvasRenderingContext2D, f: CanvasRenderingContext2D, crowds: CanvasRenderingContext2D[]): void {
  const xy = ([x, y]: P): P => [Math.round((x - LEFT) / SCALE), Math.round((y - TOP) / SCALE)];
  const polygon = (ctx: CanvasRenderingContext2D, points: P[], fill: string, stroke?: string, material?: "wood" | "roof" | "stone") => {
    ctx.beginPath(); points.forEach((p, i) => { const [x, y] = xy(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (material) {
      ctx.save(); ctx.clip();
      const coords = points.map(xy), xs = coords.map(([x]) => x), ys = coords.map(([, y]) => y);
      const step = material === "roof" ? 3 : material === "wood" ? 4 : 5;
      for (let y = Math.floor(Math.min(...ys) / step) * step; y <= Math.max(...ys); y += step) {
        const brickWidth = material === "wood" ? 11 : material === "roof" ? 5 : 7;
        for (let x = Math.floor(Math.min(...xs) / brickWidth) * brickWidth - brickWidth; x <= Math.max(...xs); x += brickWidth) {
          const stagger = Math.abs(y / step) % 2 * Math.floor(brickWidth / 2);
          const n = ((x * 37 + y * 71) >>> 0) % 17;
          ctx.globalAlpha = .12 + n / 90;
          ctx.fillStyle = n % 3 ? (material === "roof" ? C.roofTile : C.stoneLight) : C.woodDark;
          ctx.fillRect(x + stagger, y, brickWidth - 1, step - 1);
          ctx.globalAlpha = material === "roof" ? .75 : .5;
          ctx.fillStyle = material === "wood" ? C.goldDark : material === "roof" ? C.roofTile : C.stoneLight;
          ctx.fillRect(x + stagger, y, brickWidth - 2, 1);
          ctx.globalAlpha = .7; ctx.fillStyle = material === "stone" ? C.joint : C.woodDark;
          ctx.fillRect(x + stagger, y + step - 1, brickWidth, 1);
          if (material !== "wood") ctx.fillRect(x + stagger + brickWidth - 1, y, 1, step);
          ctx.globalAlpha = .45; ctx.fillStyle = C.goldLight;
          ctx.fillRect(x + stagger + 1 + n % 3, y + 1, n % 4 ? 1 : 2, 1);
        }
      }
      ctx.restore();
    }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  };
  const ellipse = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, colour: string) => {
    ctx.fillStyle = colour;
    for (let sy = -ry; sy <= ry; sy += SCALE) {
      const half = rx * Math.sqrt(Math.max(0, 1 - (sy / ry) ** 2));
      ctx.fillRect(Math.round((x - half - LEFT) / SCALE), Math.round((y + sy - TOP) / SCALE), Math.round(half * 2 / SCALE), 1);
    }
  };
  ellipse(b, O.x + 8, O.y + 8, O.rx + 10, O.ry + 3, "#43543c");
  // Cobbled entry corridors, with individual worn stones rather than flat grey blocks.
  const paving = (x: number, y: number, width: number, height: number) => {
    const [px, py] = xy([x, y]);
    b.fillStyle = TERRAIN.paved.edge; b.fillRect(px, py, width / SCALE, height / SCALE);
    for (let row = 0; row < height / SCALE; row += 4) for (let col = -4; col < width / SCALE; col += 7) {
      const dx = Math.max(0, col + (row % 8 ? 3 : 0)), ww = Math.min(6, width / SCALE - dx);
      if (ww <= 0) continue;
      b.fillStyle = row % 3 ? TERRAIN.paved.base : TERRAIN.paved.mid; b.fillRect(px + dx, py + row, ww, 3);
      b.fillStyle = TERRAIN.paved.hi; b.fillRect(px + dx + 1, py + row, Math.max(1, ww - 2), 1);
    }
  };
  paving(O.x - 70, F.y + 100, 140, 76);
  paving(F.x + 220, O.y - 48, 164, 96);
  ellipse(b, F.x, F.y, F.rx + 2, F.ry + 2, C.sandEdge);
  ellipse(b, F.x, F.y, F.rx - 4, F.ry - 4, C.sand);
  ellipse(b, F.x - 12, F.y - 4, F.rx - 30, F.ry - 18, "#e6bd7d");
  let seed = 391;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 1600; i++) {
    const x = (random() * 2 - 1) * (F.rx - 8), y = (random() * 2 - 1) * (F.ry - 8);
    if ((x / (F.rx - 8)) ** 2 + (y / (F.ry - 8)) ** 2 > 1) continue;
    const [px, py] = xy([F.x + x, F.y + y]); b.fillStyle = i % 3 ? C.sandLight : C.sandShade; b.fillRect(px, py, i % 7 ? 1 : 2, 1);
  }
  for (let i = 0; i < 96; i++) {
    const a = i * STEP, z = a + STEP, mid = a + STEP / 2;
    if (openSector(mid)) continue;
    const ctx = Math.sin(mid) > 0 ? f : b;
    const p = outer(a), q = outer(z), lowP = outer(a, false), lowQ = outer(z, false);
    polygon(ctx, [p, q, lowQ, lowP], Math.cos(mid) < 0 ? C.stone : C.stoneShade, i % 8 === 0 ? C.joint : undefined, "stone");
    // A coloured cornice and gold cap bind the stone piers into one crafted building.
    polygon(ctx, [p, q, [q[0], q[1] + 12], [p[0], p[1] + 12]], i % 2 ? C.green : C.emerald, C.dark);
    polygon(ctx, [p, q, [q[0], q[1] + 3], [p[0], p[1] + 3]], C.goldLight);
    const [mx, my] = xy([(p[0] + q[0]) / 2, (lowP[1] + lowQ[1]) / 2]);
    ctx.fillStyle = C.joint; ctx.fillRect(mx - 4, my - 6, 8, 1); ctx.fillRect(mx, my - 6, 1, 6); ctx.fillRect(mx - 3, my + 1, 8, 1);
    if (Math.sin(mid) > 0 && i % 3 === 0) {
      const [x, y] = xy([(p[0] + q[0]) / 2, (lowP[1] + lowQ[1]) / 2]);
      ctx.fillStyle = C.dark; ctx.fillRect(x - 3, y - 13, 6, 11); ctx.fillRect(x - 2, y - 15, 4, 2);
      ctx.fillStyle = C.stoneLight; ctx.fillRect(x - 4, y - 13, 1, 12); ctx.fillRect(x + 3, y - 13, 1, 12); ctx.fillRect(x - 3, y - 15, 6, 1);
      ctx.fillStyle = C.gold; ctx.fillRect(x - 2, y - 16, 4, 1);
    }
    if (i % 8 === 0) {
      const [x, y] = xy(lowP);
      ctx.fillStyle = C.joint; ctx.fillRect(x - 3, y - 24, 6, 24);
      ctx.fillStyle = C.stoneLight; ctx.fillRect(x - 2, y - 23, 3, 22);
      ctx.fillStyle = C.gold; ctx.fillRect(x - 4, y - 25, 8, 3); ctx.fillRect(x - 4, y - 2, 8, 2);
    }
    for (let tier = 0; tier < 6; tier++) {
      const inner = tier / 6, out = (tier + 1) / 6;
      polygon(ctx, [ring(a, inner), ring(z, inner), ring(z, out), ring(a, out)], C.wood[Math.min(3, Math.floor(tier * 2 / 3))]!, i % 12 === 0 ? C.woodDark : undefined, "wood");
      // Green/teal seats, timber step risers and gold rails stay distinct at town zoom.
      polygon(ctx, [ring(a, out), ring(z, out), [ring(z, out)[0], ring(z, out)[1] + 3], [ring(a, out)[0], ring(a, out)[1] + 3]], tier % 2 ? C.teal : C.emerald);
      const [x, y] = xy(ring(mid, (tier + 0.62) / 6));
      ctx.fillStyle = C.woodDark; ctx.fillRect(x - 4, y - 2, 8, 4);
      ctx.fillStyle = tier % 2 ? C.teal : C.green; ctx.fillRect(x - 4, y - 3, 8, 3);
      ctx.fillStyle = C.mint; ctx.fillRect(x - 4, y - 3, 7, 1);
      ctx.fillStyle = C.gold; ctx.fillRect(x - 4, y, 8, 1);
      // Decorative spectators never enter the actual resident or reward counts.
      if ((i + tier) % 3 !== 0 && !(Math.sin(mid) < 0 && tier >= 4)) for (let pose = 0; pose < 2; pose++) {
        const c = crowds[pose]!, lift = pose && (i + tier) % 2 ? 2 : 0;
        c.fillStyle = [C.green, C.teal, C.gold, "#b46d48"][(i + tier) % 4]!;
        c.fillRect(x - 1, y - 3 - lift, 3, 3); c.fillStyle = "#d7bc8d"; c.fillRect(x, y - 5 - lift, 2, 2);
        if (lift) { c.fillRect(x - 2, y - 5, 1, 3); c.fillRect(x + 3, y - 5, 1, 3); }
      }
    }
    if (i % 8 === 4) {
      const [x, y] = xy(p); ctx.fillStyle = C.goldDark; ctx.fillRect(x - 7, y - 8, 15, 29);
      ctx.fillStyle = i % 16 ? C.emerald : C.teal; ctx.fillRect(x - 6, y - 7, 13, 26);
      ctx.fillStyle = C.goldLight; ctx.fillRect(x - 6, y - 7, 2, 24); ctx.fillRect(x + 5, y - 7, 2, 24); ctx.fillRect(x - 8, y - 9, 17, 2);
      ctx.fillStyle = C.mint; ctx.fillRect(x - 3, y, 2, 2); ctx.fillRect(x + 2, y, 2, 2);
      ctx.fillRect(x - 4, y - 3, 2, 7); ctx.fillRect(x + 3, y - 3, 2, 7);
      ctx.fillStyle = C.gold; ctx.fillRect(x - 5, y + 18, 4, 2); ctx.fillRect(x + 2, y + 18, 4, 2);
    }
  }
  // Covered rear galleries give the bowl the same tiled-roof silhouette as the town halls.
  const roofPoint = (a: number, t: number, lift: number): P => { const p = ring(a, t); return [p[0], p[1] - lift]; };
  for (let i = 50; i < 94; i++) {
    const a = i * STEP, z = a + STEP;
    polygon(b, [roofPoint(a, .67, 25), roofPoint(z, .67, 25), roofPoint(z, .88, 70), roofPoint(a, .88, 70)], i < 74 ? C.roofLight : C.roof, undefined, "roof");
    polygon(b, [roofPoint(a, .88, 70), roofPoint(z, .88, 70), roofPoint(z, 1.04, 28), roofPoint(a, 1.04, 28)], C.roofShade, undefined, "roof");
    for (const [t, lift] of [[.73, 38], [.8, 53], [.88, 70]] as const) {
      if (t === .88) polygon(b, [roofPoint(a, t, lift), roofPoint(z, t, lift), roofPoint(z, t, lift - 2), roofPoint(a, t, lift - 2)], C.goldLight);
    }
    polygon(b, [roofPoint(a, .67, 25), roofPoint(z, .67, 25), roofPoint(z, .67, 20), roofPoint(a, .67, 20)], C.emerald, C.gold);
    if (i % 4 === 2) {
      const [x, y] = xy(ring(a, .67));
      b.fillStyle = C.woodDark; b.fillRect(x - 2, y - 12, 4, 14);
      b.fillStyle = C.gold; b.fillRect(x - 3, y - 12, 6, 2);
    }
  }
  /** Masonry stair towers and tiled gate turrets, rooted in the existing solid wall. */
  const tower = (ctx: CanvasRenderingContext2D, foot: P, height: number, width: number) => {
    const [x, y] = xy(foot), h = height / SCALE, w = width / SCALE;
    polygon(ctx, [[foot[0] - width / 2, foot[1] - height], [foot[0] + width / 2, foot[1] - height], [foot[0] + width / 2, foot[1]], [foot[0] - width / 2, foot[1]]], C.stone, C.joint, "stone");
    ctx.fillStyle = C.stoneLight; ctx.fillRect(x - w / 2, y - h + 1, 3, h - 1);
    ctx.fillStyle = C.stoneShade; ctx.fillRect(x + w / 2 - 4, y - h, 4, h);
    for (let row = 4; row < h; row += 6) {
      ctx.fillStyle = C.joint; ctx.fillRect(x - w / 2 + 3, y - h + row, w - 7, 1);
      ctx.fillRect(x - w / 2 + 4 + row % 3, y - h + row - 5, 1, 5);
    }
    ctx.fillStyle = C.emerald; ctx.fillRect(x - w / 2 - 2, y - h + 8, w + 4, 4);
    ctx.fillStyle = C.gold; ctx.fillRect(x - w / 2 - 2, y - h + 8, w + 4, 1);
    ctx.fillStyle = C.dark; ctx.fillRect(x - 3, y - h + 19, 6, 11); ctx.fillRect(x - 2, y - h + 17, 4, 2);
    ctx.fillStyle = C.goldLight; ctx.fillRect(x - 2, y - h + 19, 1, 9);
    ctx.fillStyle = C.goldDark; ctx.fillRect(x - 4, y - h + 16, 8, 1); ctx.fillRect(x - 4, y - h + 30, 8, 2);
    ctx.fillStyle = C.gold; ctx.fillRect(x, y - h + 19, 1, 11); ctx.fillRect(x - 3, y - h + 24, 6, 1);
    // Stepped hip roof, ridge finial and timber eave; no smooth vector dome.
    const roofY = foot[1] - height;
    polygon(ctx, [[foot[0] - width / 2 - 6, roofY], [foot[0], roofY - 32], [foot[0] + width / 2 + 6, roofY], [foot[0] + width / 2, roofY + 6], [foot[0] - width / 2, roofY + 6]], C.roofShade, C.woodDark);
    polygon(ctx, [[foot[0] - width / 2 - 6, roofY], [foot[0], roofY - 32], [foot[0] + width / 3, roofY]], C.roofLight, C.roof);
    ctx.fillStyle = C.roofTile;
    for (let row = 0; row < 4; row++) ctx.fillRect(x - w / 2 + row * 2 - 2, y - h - row * 3, w - row * 4 + 4, 1);
    ctx.fillStyle = C.goldLight; ctx.fillRect(x - 1, y - h - 20, 2, 5);
    ctx.fillStyle = C.teal; ctx.fillRect(x + 1, y - h - 20, 8, 4);
    // Ivy, chips and a warm plinth break up the repeated masonry courses.
    for (let leaf = 0; leaf < 12; leaf++) {
      ctx.fillStyle = leaf % 3 ? C.emerald : C.green;
      ctx.fillRect(x + w / 2 - 3 + leaf % 3, y - 3 - leaf * 2, 2, 2);
    }
    ctx.fillStyle = C.goldDark; ctx.fillRect(x - w / 2 - 1, y - 3, w + 2, 3);
    ctx.fillStyle = C.stoneLight; ctx.fillRect(x - w / 2 - 1, y - 3, w + 2, 1);
  };
  for (const a of [Math.PI * 1.17, Math.PI * 1.83]) tower(b, outer(a, false), 100, 42);

  // The grand box: a small, roofed civic building within the rear gallery.
  // Its gable, glowing windows and embroidered balcony give the arena a focal silhouette.
  const boxY = ring(Math.PI * 1.5, .8)[1] + 30;
  const bx = O.x, by = boxY;
  polygon(b, [[bx - 61, by - 46], [bx + 61, by - 46], [bx + 61, by + 5], [bx - 61, by + 5]], C.wood[1], C.woodDark, "wood");
  polygon(b, [[bx - 69, by - 44], [bx, by - 96], [bx + 69, by - 44], [bx + 62, by - 38], [bx - 62, by - 38]], C.roofShade, C.woodDark, "roof");
  polygon(b, [[bx - 67, by - 45], [bx, by - 94], [bx + 44, by - 45]], C.roofLight, undefined, "roof");
  polygon(b, [[bx - 38, by - 43], [bx, by - 75], [bx + 38, by - 43]], C.emerald, C.goldLight);
  const [boxX, boxFoot] = xy([bx, by]);
  b.fillStyle = C.goldLight; b.fillRect(boxX - 1, boxFoot - 50, 2, 6);
  for (const sx of [-20, 20]) {
    b.fillStyle = C.goldDark; b.fillRect(boxX + sx - 5, boxFoot - 20, 10, 15);
    b.fillStyle = C.dark; b.fillRect(boxX + sx - 4, boxFoot - 19, 8, 13); b.fillRect(boxX + sx - 3, boxFoot - 21, 6, 2);
    b.fillStyle = C.gold; b.fillRect(boxX + sx - 2, boxFoot - 18, 1, 11); b.fillRect(boxX + sx + 1, boxFoot - 18, 1, 11);
    b.fillStyle = C.goldLight; b.fillRect(boxX + sx - 3, boxFoot - 13, 6, 1);
  }
  b.fillStyle = C.dark; b.fillRect(boxX - 8, boxFoot - 17, 16, 17);
  b.fillStyle = C.teal; b.fillRect(boxX - 6, boxFoot - 16, 12, 16);
  b.fillStyle = C.gold; b.fillRect(boxX - 6, boxFoot - 16, 2, 16); b.fillRect(boxX + 4, boxFoot - 16, 2, 16);
  b.fillStyle = C.emerald; b.fillRect(boxX - 32, boxFoot - 4, 64, 7);
  b.fillStyle = C.goldLight; b.fillRect(boxX - 33, boxFoot - 5, 66, 1); b.fillRect(boxX - 32, boxFoot + 2, 64, 1);
  for (let x = -29; x < 31; x += 6) { b.fillStyle = C.gold; b.fillRect(boxX + x, boxFoot - 3, 1, 5); }
  // Gold and emerald crest medallion on the gable.
  ellipse(b, bx, by - 57, 12, 12, C.goldDark); ellipse(b, bx, by - 59, 10, 10, C.goldLight); ellipse(b, bx, by - 59, 8, 8, C.emerald);
  b.fillStyle = C.mint; b.fillRect(boxX - 2, boxFoot - 31, 1, 2); b.fillRect(boxX + 1, boxFoot - 31, 1, 2);
  const gateY = O.y + O.ry;
  for (const side of [-1, 1]) {
    const [x, y] = xy([O.x + side * (ARENA_GATE_WIDTH / 2 + 8), gateY]);
    tower(f, [O.x + side * (ARENA_GATE_WIDTH / 2 + 12), gateY], 100, 28);
    f.fillStyle = C.emerald; f.fillRect(x - 5, y - 32, 10, 19);
    f.fillStyle = C.goldLight; f.fillRect(x - 5, y - 32, 1, 19); f.fillRect(x + 4, y - 32, 1, 19);
    f.fillStyle = C.mint; f.fillRect(x - 2, y - 26, 2, 2); f.fillRect(x + 1, y - 26, 2, 2);
  }
  const [gx, gy] = xy([O.x, gateY]);
  f.fillStyle = C.woodDark; f.fillRect(gx - 49, gy - 42, 98, 6);
  f.fillStyle = C.emerald; f.fillRect(gx - 50, gy - 49, 100, 9);
  f.fillStyle = C.gold; f.fillRect(gx - 50, gy - 50, 100, 2); f.fillRect(gx - 49, gy - 41, 98, 1);
  f.fillStyle = C.teal; f.fillRect(gx - 46, gy - 46, 92, 3);
  f.fillStyle = C.goldLight; f.fillRect(gx - 5, gy - 54, 10, 12);
  f.fillStyle = C.dark; f.fillRect(gx - 3, gy - 52, 6, 8);
  f.fillStyle = C.mint; f.fillRect(gx - 2, gy - 50, 1, 2); f.fillRect(gx + 1, gy - 50, 1, 2);
  // A pitched emerald tiled gatehouse roof, warm eaves and carved beam ends.
  const roofY = gateY - 100;
  polygon(f, [[O.x - 104, roofY + 6], [O.x - 82, roofY - 17], [O.x + 82, roofY - 17], [O.x + 104, roofY + 6]], C.emerald, C.dark);
  for (let row = 0; row < 6; row++) {
    const yy = roofY - 16 + row * 4, reach = 82 + row * 4;
    polygon(f, [[O.x - reach, yy], [O.x + reach, yy], [O.x + reach + 2, yy + 3], [O.x - reach - 2, yy + 3]], row % 2 ? C.green : C.teal);
    const [sx, sy] = xy([O.x - reach, yy]);
    for (let tile = 2; tile < reach; tile += 5) {
      f.fillStyle = C.dark; f.fillRect(sx + tile + row % 2 * 2, sy + 1, 1, 2);
      f.fillStyle = C.mint; f.fillRect(sx + tile + 1 + row % 2 * 2, sy, 3, 1);
    }
  }
  f.fillStyle = C.goldLight; f.fillRect(gx - 43, gy - 60, 86, 1); f.fillRect(gx - 53, gy - 47, 106, 2);
  for (const side of [-1, 1]) {
    f.fillStyle = C.woodDark; f.fillRect(gx + side * 45 - 2, gy - 40, 4, 8);
    f.fillStyle = C.gold; f.fillRect(gx + side * 45 - 3, gy - 40, 6, 2);
  }
}
