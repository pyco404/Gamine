/**
 * The village's set dressing as data: every piece's picture, place and size,
 * kept apart from the drawing (dressing.ts) and free of Phaser, so the root
 * suite can check it - Old Town's pieces are pinned in test/old-town.test.ts.
 */

import { PIER } from "./world";
import { SITES } from "./town";

export type Piece = {
  key: string;
  image: string;
  x: number;
  y: number;
  scale: number;
  /** Where the foot is, as a share of the picture's height: art is often padded below. */
  foot?: number;
  flip?: boolean;
  /** Solid to walkers: this wide and deep, in world pixels, above the foot. */
  solid?: { width: number; height: number };
  /** A sprite sheet, played on a loop. */
  sheet?: { frameWidth: number; frameHeight: number; frameRate: number; start?: number };
  /** A texture the map already loads, so it is not loaded again. */
  mapped?: boolean;
  /** Rides the water: a slow rise and fall. */
  bob?: boolean;
  /** A fixed depth, for a piece the map's own layering would bury: the lake's water is drawn over anything low in it. */
  depth?: number;
};

const ART = "/village/gamine";

/** A piece of the Gamine art, drawn at its two world pixels to the art pixel unless told otherwise. */
const art = (name: string, x: number, y: number, scale = 2, more: Partial<Piece> = {}): Piece => ({
  key: `ac-${name}`,
  image: `${ART}/${name}.png`,
  x,
  y,
  scale,
  ...more,
});
const banner = (x: number, y: number, kind: "banner" | "banner-fame" | "banner-gold" = "banner") => art(kind, x, y, 1.5);
/** A flag on a tall pole, the crest on it, in two frames of a slow wave. */
const flag = (x: number, y: number, start = 0) =>
  art("flag", x, y, 1.6, { sheet: { frameWidth: 28, frameHeight: 58, frameRate: 1.6, start } });
const tent = (x: number, y: number, flip = false) => art("tent", x, y, 1.6, { flip, solid: { width: 60, height: 40 } });
const fire = (x: number, y: number): Piece => ({
  key: "effects-fire-fire",
  image: "",
  x,
  y,
  scale: 0.34,
  foot: 0.75,
  mapped: true,
  sheet: { frameWidth: 128, frameHeight: 128, frameRate: 12 },
});
const cottage = (colour: "Blue" | "Red" | "Purple" | "Yellow", x: number, y: number, flip = false): Piece => ({
  key: `dress-house-${colour.toLowerCase()}`,
  image: `/village/reference/cottage-${colour === "Red" ? "red" : colour === "Purple" ? "green" : "gold"}.png`,
  x,
  y,
  scale: 0.55,
  foot: 1,
  flip,
  solid: { width: 56, height: 70 },
});
const bush = (key: string, x: number, y: number): Piece => ({ key, image: "", x, y, scale: 0.6, mapped: true });
const gold = (x: number, y: number, scale: number): Piece => ({ key: "prop-gold", image: "/fixtures/Gold.png", x, y, scale });

/** Move each landmark's props together with its door and sign. */
const atBuilding = (id: string, from: { x: number; y: number }, pieces: Piece[]): Piece[] => {
  const site = SITES[id]!;
  return pieces.map((p) => ({ ...p, x: p.x + site.x - from.x, y: p.y + site.y - from.y }));
};

export const PIECES: Piece[] = [
  // Small gathering spaces around the oval, clear of its gate corridors.
  art("bench", 1240, 1000, 1.6),
  art("bench", 1575, 1000, 1.6),
  banner(1280, 1040),
  banner(1550, 1040),
  cottage("Yellow", 230, 1090),
  cottage("Blue", 200, 1350),
  cottage("Red", 650, 1570),
  cottage("Yellow", 870, 1460),
  {key:"village-smithy", image:"/village/reference/smithy.png", x:2810, y:1020, scale:0.8, solid:{width:76,height:70}},
  art("bench", 330, 1180, 1.6),
  art("log", 400, 1700, 1.6),
  tent(480, 1780),
  fire(530, 1810),
  // Farm beds and fences follow a small clearing off the strategy lane.
  ...[[330,490],[440,505],[350,560],[460,575]].map(([x,y]) => ({key:"farm-bed", image:"/fixtures/Plot.png",x:x!,y:y!,scale:1.1})),
  {key:"farm-fence",image:"/fixtures/Fence.png",x:330,y:600,scale:1.1},
  {key:"farm-fence",image:"/fixtures/Fence.png",x:460,y:615,scale:1.1},
  {key:"farm-pumpkin",image:"/fixtures/Pumpkin.png",x:520,y:560,scale:0.55},

  { key: 'market-blue', image: '/village/reference/market-blue.png', x: 1250, y: 1440, scale: 1, solid: { width: 98, height: 64 } },
  { key: 'market-red', image: '/village/reference/market-red.png', x: 1510, y: 1460, scale: 1, solid: { width: 98, height: 64 } },
  // The town's flags: at the ring road's corners and either side of the avenue up to the arena.
  flag(1070, 465),
  flag(1875, 735, 1),
  flag(900, 1060, 1),
  flag(1760, 1340),
  // Frame the approach from outside the main passage rather than standing across it.
  flag(1260, 1075, 1),
  flag(1540, 1075),

  // The Hiring Hall: the agents for hire on a board, one picked out.
  ...atBuilding("tavern", { x: 850, y: 1125 }, [
    art("hiring-board", 738, 1128, 1.6),
    banner(925, 1126),
    banner(778, 1126),
  ]),

  // The Strategy Lab: a decision tree on an easel and a planning table.
  ...atBuilding("castle", { x: 800, y: 760 }, [
    art("strategy-board", 662, 768, 1.6),
    art("war-table", 935, 702, 1.5),
    banner(712, 762),
  ]),

  // The Game Hall: screens of the matches playing.
  ...atBuilding("forge", { x: 2010, y: 765 }, [
    // The screen sits on the north terrace, clear of the river bank.
    art("scoreboard", 2060, 580, 1.6, { sheet: { frameWidth: 66, frameHeight: 66, frameRate: 1.2 } }),
    banner(1925, 770),
    banner(2095, 770),
  ]),

  // The Hall of Fame: a champion in gold and a cup, a banner of navy and gold, a path to the door.
  ...atBuilding("library", { x: 1400, y: 452 }, [
    art("statue", 1300, 474, 1.6),
    art("trophy", 1465, 482, 1.4),
    banner(1538, 456, "banner-fame"),
  ]),

  // The Treasury: a chest, coins and a sack of gold at its door.
  ...atBuilding("chapel", { x: 1705, y: 452 }, [
    art("chest", 1640, 476, 1.6),
    art("coins", 1752, 490, 1.4),
    gold(1792, 478, 0.36),
    banner(1602, 456, "banner-gold"),
  ]),

  // The Lookout.
  ...atBuilding("watchtower", { x: 1090, y: 450 }, [banner(1135, 452)]),

  // Bushes in the corners the arena leaves inside the ring road, the pack's own.
  bush("bush-1", 1046, 548),
  bush("bush-2", 1070, 566),
  bush("bush-4", 1752, 546),
  bush("bush-1", 1730, 566),
  bush("bush-2", 1046, 972),
  bush("bush-4", 1066, 958),
  bush("bush-1", 1754, 972),
  bush("bush-2", 1734, 958),

  // The town square: the fountain, benches round it.
  { key: "dress-fountain", image: "/fixtures/Fountain.png", x: 1300, y: 1222, scale: 0.6, solid: { width: 52, height: 26 } },
  art("bench", 1200, 1244, 1.6),
  art("bench", 1400, 1244, 1.6),

  // The agent grounds. North-west, a camp: tents round a fire.
  tent(795, 560),
  tent(918, 532, true),
  fire(862, 600),
  art("log", 826, 618, 1.6),
  art("log", 900, 620, 1.6, { flip: true }),

  // West, the training yard.
  art("dummy", 610, 905, 1.6),
  art("dummy", 682, 918, 1.6),
  art("bench", 718, 970, 1.6),
  flag(560, 960),

  // North-east, a terrace off the ring: benches, a tent, a fire.
  art("bench", 1925, 604, 1.6),
  art("bench", 2018, 606, 1.6),
  tent(2068, 568, true),
  fire(1972, 660),

  // South-west, a camp at the end of the high street.
  tent(598, 1262),
  fire(655, 1312),
  art("log", 700, 1312, 1.6, { flip: true }),

  // South-east, cottages off the dock road, a fire between them.
  cottage("Blue", 2085, 1250),
  cottage("Yellow", 2160, 1365, true),
  cottage("Red", 1990, 1480),
  fire(2100, 1318),
  art("bench", 2036, 1345, 1.6),

  // The lakeside, at the end of the trail south from the square.
  art("bench", 1100, 1580, 1.6),
  art("bench", 1470, 1550, 1.6),

  // A ship moored off the dock.
  // The pier on the small lake out in the Wilds (world.ts), from its north shore into the water. The old lake
  // below Old Town, its dock and its moored ship went when the world was laid out round it.
  art("pier", PIER.x, PIER.y + 60, 2, { depth: PIER.y + 60 }),
];

/** The tree sheet's frame, in its own pixels: a tree is drawn from the middle of it. */
const TREE_FRAME = 192;

const toSegment = (x: number, y: number, [ax, ay]: [number, number], [bx, by]: [number, number]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};

/**
 * Whether a tree stands on a road: its canopy clearly over the road, not just
 * brushing its edge. The map places trees without regard to its own roads, so
 * some hid stretches of them; those are not drawn. A positive `verge` keeps
 * the canopy that far off the road's edge instead, as the forest does.
 */
export function overRoad(
  d: { k: string; x: number; y: number; s: number },
  paths: { width: number; points: [number, number][] }[],
  verge = -6,
): boolean {
  if (!d.k.includes("tree")) return false;
  const h = TREE_FRAME * d.s;
  // Only the segments that come near the tree at all: the forest asks this of thousands of trees.
  const near: [[number, number], [number, number], number][] = [];
  for (const p of paths) {
    const reach = p.width / 2 + verge;
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1]!;
      const b = p.points[i]!;
      if (Math.min(a[0], b[0]) - reach > d.x + h * 0.2 || Math.max(a[0], b[0]) + reach < d.x - h * 0.2) continue;
      if (Math.min(a[1], b[1]) - reach > d.y + h * 0.25 || Math.max(a[1], b[1]) + reach < d.y - h * 0.3) continue;
      near.push([a, b, reach]);
    }
  }
  if (near.length === 0) return false;
  for (const fx of [-1, 0, 1]) {
    for (const fy of [-0.3, -0.1, 0.1, 0.25]) {
      const x = d.x + fx * h * 0.2;
      const y = d.y + fy * h;
      for (const [a, b, reach] of near) if (toSegment(x, y, a, b) < reach) return true;
    }
  }
  return false;
}

/** Queue every picture the dressing needs that the map does not already load. Paths are from the site's root. */
