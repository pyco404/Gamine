import type { Point } from "./roads";
import { curvedPath, LAKE_PATH, onOldGround, RING_WIDTH, withSpurs, WORLD_ROADS } from "./world";
import { ARENA_BLOCKS, ARENA_ENTRANCES, ARENA_RESERVED, COLOSSEUM, COLOSSEUM_FLOOR } from "./arena-geometry";
import { groundDepth } from "./depth";

/** Legacy default width; individual village streets and trails vary by use. */
export const ROAD_WIDTH = RING_WIDTH;

/**
 * The settlement's plan: where each building stands, the roads between them,
 * the agent grounds at the forest's edge, and which of the forest's trees give
 * way to it. The map (public/village/map.json) still brings the forest, the
 * lake and the ground; the town on it is laid out here, so an import of Agent
 * Quest's map (scripts/village-import.ts) never loses it.
 *
 * It is laid out to be read as the game is played, around the arena at its
 * heart:
 *
 *   - west, the way in: the Hiring Hall (get an agent), then the Strategy Lab
 *     (give it a strategy);
 *   - the middle: the arena, where agents compete, its front gate on the
 *     avenue up from the town square;
 *   - east: the Game Hall, with its screens of the matches playing;
 *   - north, behind the arena: the Treasury (what is won) and the Hall of
 *     Fame (who won it);
 *   - south, the town square: the leaderboard, the fountain, the Rulebook House;
 *   - round the edge, before the forest: the agent grounds, camps and a
 *     training yard where waiting agents wander.
 *
 * Positions are world pixels, each building's bottom-centre. The art drawn for
 * Gamine (scripts/village-art.ts, in /village/gamine) is at one art
 * pixel to two world pixels, so it is drawn at scale 2.
 */

export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type Site = {
  x: number;
  y: number;
  /** Its picture, from the site's root, and how big it is drawn against it. */
  art: string;
  scale: number;
  /** A sprite sheet's frame size, for a building that animates; played on a slow loop. */
  sheet?: { width: number; height: number; frameRate: number };
  /** Where agents gather, when it is not just below its foot. */
  door?: Point;
  /** A fixed depth, for a building agents stand inside of rather than in front of. */
  depth?: number;
  /** Where its name sits, as a world y, when over its roof would be wrong. */
  labelY?: number;
  /** What is solid to walkers, when its picture's box is not. */
  blocks?: Rect[];
};

const ART = "/village/gamine";

/** Keep the Arena's town anchor; share the new oval floor with match placement. */
const ARENA_FOOT = { x: 1400, y: 975 };
export const ARENA_FIELD = COLOSSEUM_FLOOR;

/** Matches stand on the sand in rows of this many, each pair this far from the next. */
export const ARENA_LAYOUT = { cols: 3, pairX: 132, pairY: 58 };

/**
 * New Town's two fixed buildings, on opposite sides of the band between the
 * rings (world.ts, growth.ts NEW_TOWN_FIXED): the Launch Pad east, the bazaar
 * west. Only while NEXT_PUBLIC_LAUNCHPAD is "1" (lib/launchpad.ts), read here
 * directly since this file stays free of the web app's aliases.
 */
const LAUNCHPAD = process.env.NEXT_PUBLIC_LAUNCHPAD === "1";
const LAUNCH_ART = { width: 64, height: 86, scale: 1.8 };
// On a clear plot north of the east lane; only the entrance spur reaches it.
const LAUNCH_FOOT = { x: 3060, y: 1190 };
export const LAUNCH_SITE: Site = {
  ...LAUNCH_FOOT,
  art: `${ART}/launch-pad.png`,
  scale: LAUNCH_ART.scale,
  sheet: { width: LAUNCH_ART.width, height: LAUNCH_ART.height, frameRate: 1.5 },
  door: { x: LAUNCH_FOOT.x, y: LAUNCH_FOOT.y + 17 },
};
/**
 * The bazaar: market stalls under striped awnings, the way to every token
 * launched here (/explore, places.ts). It may also become the venue for
 * Negotiation later (docs/economy.md, Which games), when that game is built.
 */
const BAZAAR_FOOT = { x: -60, y: 1150 };
export const BAZAAR_SITE: Site = { ...BAZAAR_FOOT, art: `${ART}/bazaar.png`, scale: 2, door: { x: BAZAAR_FOOT.x, y: BAZAAR_FOOT.y + 18 } };
/** New Town's buildings: not Old Town's, and framed and checked apart from it. */
export const NEW_TOWN_SITES = new Set(["launchpad", "bazaar"]);

export const SITES: Record<string, Site> = {
  arena: {
    ...ARENA_FOOT,
    art: `${ART}/arena.png`,
    scale: 2,
    door: ARENA_ENTRANCES.front,
    depth: groundDepth(-350),
    labelY: 470,
    // Tiered walls wrap the oval; front/east gates and the sand stay open.
    blocks: ARENA_BLOCKS,
  },
  // Each sign follows its building's individual roofline, including the low
  // recruitment pavilion and the observation tower's mast.
  tavern: { x: 740, y: 1300, art: `${ART}/modern-hiring-hall.png`, scale: 1.2, labelY: 1180 },
  castle: { x: 600, y: 680, art: `${ART}/modern-strategy-lab.png`, scale: 1.2, labelY: 534 },
  forge: { x: 2060, y: 1030, art: `${ART}/modern-game-hall.png`, scale: 1.2, labelY: 897 },
  library: { x: 1530, y: 300, art: `${ART}/modern-hall-of-fame.png`, scale: 1.2, labelY: 150 },
  chapel: { x: 1960, y: 450, art: `${ART}/modern-treasury.png`, scale: 1.2, labelY: 283 },
  watchtower: { x: 860, y: 40, art: `${ART}/modern-lookout.png`, scale: 1.2, labelY: -135 },
  alchemist: { x: 1670, y: 1580, art: `${ART}/modern-rulebook-house.png`, scale: 1.2, labelY: 1436 },
  board: { x: 1840, y: 1230, art: `${ART}/leaderboard.png`, scale: 1.6, sheet: { width: 84, height: 74, frameRate: 1.5 } },
  ...(LAUNCHPAD ? { launchpad: LAUNCH_SITE, bazaar: BAZAAR_SITE } : {}),
};

/** The arena's sand: open to walkers, but nowhere anyone strolls to. */
export const RESERVED: Rect[] = ARENA_RESERVED;

/**
 * Every road is drawn by map.ts; its style says what kind of road it is.
 * All streets use the same grey stone colours; country lanes have narrower, weathered cobbles.
 */
type Path = { style: "main" | "secondary" | "trail" | "paved" | "dirt"; width: number; points: [number, number][] };

/**
 * The roads. A road joins another only at a point both name (roads.ts stitches
 * an end to the nearest vertex), so every junction is a vertex of the road it
 * meets.
 */
export const ROADS: Path[] = [
  // Short, uneven streets tie the districts together; no road rings the Arena.
  curvedPath("main", 60, [[665,790],[830,875],[1000,1010],[1190,1060],[1300,1200],[1400,1370]]),
  curvedPath("main", 60, [[1400,975],[1400,1010],[1190,1060]]),
  curvedPath("main", 54, [[1300,1200],[1510,1270],[1730,1320],[1966,1472]]),
  curvedPath("secondary", 44, [[1730,1320],[1840,1235],[2040,1150],[2060,1035]]),
  curvedPath("secondary", 46, [[2040,1150],[2180,1150],[2220,980],[2130,790]]),
  curvedPath("secondary", 46, [[2130,790],[1990,750],[1800,488],[1570,440],[1300,420],[1000,488]]),
  curvedPath("secondary", 36, [[1990,750],[1890,790],[1810,775],[1780,775]]),
  curvedPath("secondary", 42, [[1000,488],[920,675],[830,875]]),
  curvedPath("secondary", 38, [[665,790],[600,730],[600,685]]),
  curvedPath("secondary", 38, [[830,875],[760,1050],[740,1305]]),
  curvedPath("secondary", 38, [[1300,420],[1440,410],[1530,305]]),
  curvedPath("secondary", 38, [[1800,488],[1900,500],[1960,455]]),
  curvedPath("trail", 32, [[930,390],[860,240],[860,45]]),
  curvedPath("trail", 34, [[1730,1320],[1770,1420],[1740,1550],[1670,1585]]),
  curvedPath("trail", 32, [[665,790],[655,860],[650,930]]),
  curvedPath("trail", 32, [[1990,750],[1975,690],[1975,630]]),
  curvedPath("trail", 32, [[740,1305],[710,1320],[650,1295]]),
  curvedPath("trail", 34, [[1510,1270],[1510,1460],[1400,1470],[1400,1370]]),
  curvedPath("trail", 32, [[1400,1370],[1370,1420],[1310,1470],[1250,1475]]),
  curvedPath("trail", 32, [[1966,1472],[2080,1490],[2160,1380],[2050,1310]]),
  curvedPath("trail", 30, [[600,685],[480,675],[330,660]]),
  curvedPath("trail", 30, [[650,1295],[530,1480],[530,1810]]),
  curvedPath("trail", 32, [[350,850],[320,1040],[330,1180],[280,1200]]),
  ...withSpurs(WORLD_ROADS, LAUNCHPAD ? [LAUNCH_SITE.door!, BAZAAR_SITE.door!] : []),
  LAKE_PATH,
];

/**
 * Ways only agents know: across the arena's sand to every spot a match can
 * take, so an agent called to one walks in by the gate rather than over the
 * wall. Never drawn.
 */
export const HIDDEN_ROADS: Point[][] = [
  [ARENA_ENTRANCES.front, { x: 1400, y: 975 }, { x: 1400, y: 920 }, { x: 1400, y: 860 }, { x: 1400, y: 800 }],
  [ARENA_ENTRANCES.east, { x: 1720, y: 775 }, { x: 1640, y: 775 }, { x: 1540, y: 800 }, { x: 1400, y: 800 }],
  ...[762, 800, 860].map((y) => [-180, -100, 0, 100, 180].map((dx) => ({ x: 1400 + dx, y }))),
];

/** Paving the roads do not draw: the town square round the fountain, and a carpet up to the Hall of Fame. */
export const SQUARE = { x: 1300, y: 1200, rx: 130, ry: 65 };
export const CARPET = { x: 1530, y0: 302, y1: 330, width: 22 };

/** Where waiting agents wander to at the edge of town: camps, the training yard, the square, the lakeside. */
export const GROUNDS: Point[] = [
  { x: 330, y: 660 },
  { x: 530, y: 1840 },
  { x: 280, y: 1200 },
  { x: 2490, y: 850 },
  { x: 862, y: 618 },
  { x: 800, y: 600 },
  { x: 650, y: 955 },
  { x: 610, y: 925 },
  { x: 1975, y: 630 },
  { x: 1925, y: 610 },
  { x: 650, y: 1295 },
  { x: 2050, y: 1310 },
  { x: 1150, y: 1230 },
  { x: 1450, y: 1200 },
  { x: 1400, y: 1405 },
  { x: 1350, y: 1395 },
];

/** The settlement: inside it, the forest gives way to the town. */
const TOWN = { x: 1400, y: 840, rx: 1050, ry: 700 };
export const inTown = (p: Point) => ((p.x - TOWN.x) / TOWN.rx) ** 2 + ((p.y - TOWN.y) / TOWN.ry) ** 2 <= 1;

const segmentDistance = (p: Point, a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy);
};

/** Whether a point is on a road, its edge within `margin`. */
export function nearRoad(p: Point, margin: number): boolean {
  return ROADS.some((r) => r.points.some((a, i) => i > 0 && segmentDistance(p, r.points[i - 1]!, a) < r.width / 2 + margin));
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * The town's lots: each building and the ground its agents stand on, each
 * piece of dressing, each spot in the grounds. Nothing of the forest is drawn
 * over one.
 */
export function lots(pieces: { x: number; y: number; width: number; height: number }[]): Rect[] {
  const out: Rect[] = [
    { x0: COLOSSEUM.x - COLOSSEUM.rx - 30, y0: COLOSSEUM.y - COLOSSEUM.ry - 90, x1: COLOSSEUM.x + COLOSSEUM.rx + 30, y1: COLOSSEUM.y + COLOSSEUM.ry + 30 },
    { x0: SQUARE.x - SQUARE.rx - 30, y0: SQUARE.y - SQUARE.ry - 40, x1: SQUARE.x + SQUARE.rx + 30, y1: SQUARE.y + SQUARE.ry + 30 },
  ];
  for (const [id, s] of Object.entries(SITES)) {
    if (id === "arena") continue;
    const w = 130 * s.scale * (s.sheet ? 0.5 : 1) + 60;
    out.push({ x0: s.x - w, y0: s.y - 300, x1: s.x + w, y1: s.y + 40 });
    // The queue below a hall's door.
    out.push({ x0: s.x - 120, y0: s.y, x1: s.x + 120, y1: s.y + 190 });
  }
  for (const p of pieces) out.push({ x0: p.x - p.width / 2 - 20, y0: p.y - p.height - 20, x1: p.x + p.width / 2 + 20, y1: p.y + 30 });
  for (const g of GROUNDS) out.push({ x0: g.x - 60, y0: g.y - 60, x1: g.x + 60, y1: g.y + 40 });
  return out;
}

/** Small things of the forest floor that may stay in town, off the roads and the lots. */
const SMALL = /^(bush-|rock-[123]$|stump-|deco-0[239]$|deco-1[01]$)/;

/**
 * Whether one of the map's decorations still stands with the town on it.
 * Outside the town, everything does. Inside it a tree stays only where its
 * canopy is clear of every road and lot - the woods between the town's
 * quarters - and the small things only off them; the rest of what the map put
 * there (a gold mine, a lone tower, rows of stones) belonged to the old
 * layout.
 */
export function stands(d: { k: string; x: number; y: number; s: number }, taken: Rect[]): boolean {
  // The old lake below Old Town is gone - the inner ring and New Town are there now - and with it its
  // water, its rocks and its dock (world.ts has the new lake). Beyond the inner ring the forest is forest.ts's.
  if (d.k.includes("water") || d.k.includes("bridge")) return false;
  // Beyond the town, the map's woods round Old Town stand as they always did, up to the inner ring.
  if (!inTown(d)) {
    if (!onOldGround(d)) return false;
    // Outlying farms and houses need the same clear canopy space as the core.
    if (d.k.includes("tree")) {
      const canopy = { x0: d.x - 62 * d.s, y0: d.y - 150 * d.s, x1: d.x + 62 * d.s, y1: d.y + 10 };
      return !taken.some(l => overlaps(canopy, l));
    }
    return true;
  }
  if (d.k.includes("tree")) {
    const canopy = { x0: d.x - 62 * d.s, y0: d.y - 150 * d.s, x1: d.x + 62 * d.s, y1: d.y + 10 };
    if (taken.some((l) => overlaps(canopy, l))) return false;
    return ![{ x: d.x, y: d.y }, { x: d.x, y: d.y - 60 * d.s }, { x: d.x - 50 * d.s, y: d.y - 50 * d.s }, { x: d.x + 50 * d.s, y: d.y - 50 * d.s }].some((p) => nearRoad(p, 6));
  }
  if (!SMALL.test(d.k)) return false;
  return !nearRoad(d, 12) && !taken.some((l) => d.x > l.x0 && d.x < l.x1 && d.y > l.y0 && d.y < l.y1);
}

/** Old Town, framed: every one of its buildings, with room for the names over the top row. */
export function townBounds(): Rect {
  const old = Object.entries(SITES).filter(([id]) => !NEW_TOWN_SITES.has(id)).map(([, s]) => s);
  const xs = old.map((s) => s.x);
  const ys = old.map((s) => s.y);
  return { x0: Math.min(...xs) - 170, y0: Math.min(...ys) - 230, x1: Math.max(...xs) + 170, y1: Math.max(...ys) + 150 };
}
