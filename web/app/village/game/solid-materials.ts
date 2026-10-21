import { SOLID_DECALS, SOLID_MATERIALS, type SolidMaterial } from "../../../lib/world/solid-models";

/**
 * The solid prototype's materials, in one small atlas: the structures' own pictures cut into
 * surfaces and decals, and pixel textures drawn in palettes sampled from those same pictures where
 * the art has no clean patch of a surface (plaster, coursed stone, tiles, planks). Built once.
 */
export type SolidAtlas = {
  canvas: HTMLCanvasElement;
  /** Per material, in atlas pixels: x, y, width, height. */
  rects: Float32Array;
  /** Per material: 1 for a decal (stretched once), 0 for a surface (tiled, mirrored). */
  modes: Float32Array;
};

const SOURCES = {
  cottage: "/village/reference/cottage-gold.png",
  hall: "/village/reference/hall-of-fame.png",
  stall: "/village/reference/market-blue.png",
  board: "/village/gamine/leaderboard.png",
  red: "/village/reference/cottage-red.png",
  green: "/village/reference/cottage-green.png",
  smithy: "/village/reference/smithy.png",
  marketRed: "/village/reference/market-red.png",
  hiring: '/village/gamine/hiring-board.png',
  strategy: '/village/gamine/strategy-board.png',
  score: '/village/gamine/scoreboard.png',
} as const;
type Source = keyof typeof SOURCES;

/** A seeded pixel painter: `palette` picks per pixel; `pattern` lays out joints and courses. */
type Paint = { size: [number, number]; draw: (g: CanvasRenderingContext2D, w: number, h: number, rand: () => number) => void };
type Spec = { crop: [Source, number, number, number, number]; darken?: number } | { paint: Paint };

const speckle = (base: string, others: string[], rate: number): Paint["draw"] => (g, w, h, rand) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rand() < rate) { g.fillStyle = others[Math.floor(rand() * others.length)]!; g.fillRect(x, y, 1, 1); }
};
/** Courses of blocks, staggered, each its own shade, mortar between. */
const masonry = (stones: string[], mortar: string, bw: number, bh: number): Paint["draw"] => (g, w, h, rand) => {
  g.fillStyle = mortar; g.fillRect(0, 0, w, h);
  for (let row = 0; row * bh < h; row++) for (let x = row % 2 ? -bw / 2 : 0; x < w; x += bw) {
    g.fillStyle = stones[Math.floor(rand() * stones.length)]!; g.fillRect(x + 1, row * bh + 1, bw - 1, bh - 1);
    g.fillStyle = stones[0]!; g.fillRect(x + 1, row * bh + 1, bw - 2, 1);
    if (rand() < 0.5) { g.fillStyle = mortar; g.fillRect(x + 2 + Math.floor(rand() * (bw - 4)), row * bh + 2, 1, 1); }
  }
};
/** Boards running across, a dark gap between, grain streaks along each. */
const boards = (tones: string[], gap: string, bh: number): Paint["draw"] => (g, w, h, rand) => {
  for (let y = 0; y < h; y += bh) {
    g.fillStyle = tones[Math.floor(rand() * tones.length)]!; g.fillRect(0, y, w, bh);
    g.fillStyle = gap; g.fillRect(0, y + bh - 1, w, 1);
    for (let k = 0; k < 3; k++) { g.fillStyle = tones[(k + 1) % tones.length]!; g.fillRect(Math.floor(rand() * w), y + 1 + Math.floor(rand() * (bh - 2)), 2 + Math.floor(rand() * 4), 1); }
  }
};
/** Rows of clay tiles, each with a lit upper edge and a shadowed lower one. */
const clayTiles = (tones: string[], light: string, shadow: string): Paint["draw"] => (g, w, h, rand) => {
  for (let row = 0; row * 4 < h; row++) for (let x = row % 2 ? -2 : 0; x < w; x += 4) {
    g.fillStyle = tones[Math.floor(rand() * tones.length)]!; g.fillRect(x, row * 4, 4, 4);
    g.fillStyle = light; g.fillRect(x + 1, row * 4, 2, 1);
    g.fillStyle = shadow; g.fillRect(x, row * 4 + 3, 4, 1); g.fillRect(x + 3, row * 4, 1, 3);
  }
};
/** Woven stripes running up the cloth, so a canopy reads as bands from its front edge back. */
const stripes = (bands: string[], weave: string, width: number): Paint["draw"] => (g, w, h, rand) => {
  for (let x = 0; x < w; x++) { g.fillStyle = bands[Math.floor(x / width) % bands.length]!; g.fillRect(x, 0, 1, h); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rand() < 0.035) { g.fillStyle = weave; g.fillRect(x, y, 1, 1); }
};
/** Thatch: short strands running down the slope, in courses, each course's lower edge in shadow. */
const thatching = (tones: string[], light: string, shadow: string, course: number): Paint["draw"] => (g, w, h, rand) => {
  for (let x = 0; x < w; x++) for (let y = 0; y < h; ) {
    const run = 2 + Math.floor(rand() * 3);
    g.fillStyle = rand() < 0.12 ? light : tones[Math.floor(rand() * tones.length)]!; g.fillRect(x, y, 1, run); y += run;
  }
  for (let y = course - 1; y < h; y += course) for (let x = 0; x < w; x++) if (rand() < 0.75) { g.fillStyle = shadow; g.fillRect(x, y, 1, 1); }
};
/** Vertical grain, for beams and posts. */
const grain = (base: string, dark: string, light: string): Paint["draw"] => (g, w, h, rand) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { const r = rand(); if (r < 0.14) { g.fillStyle = dark; g.fillRect(x, y, 1, 1 + Math.floor(rand() * 3)); } else if (r < 0.2) { g.fillStyle = light; g.fillRect(x, y, 1, 1); } }
};

/** Small leaf clusters, deliberately crisp; the mesh provides crown volume and directional light. */
const foliage = (base: string, dark: string, light: string): Paint['draw'] => (g, w, h, rand) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    const dx = Math.floor(rand() * 2), dy = Math.floor(rand() * 2);
    g.fillStyle = dark; g.fillRect(x + dx, y + dy + 1, 3, 2);
    g.fillStyle = light; g.fillRect(x + dx, y + dy, 2, 1);
  }
};

const SPECS: Record<SolidMaterial, Spec> = {
  // Sampled from cottage-gold.png's walls, beams and chimney; hall-of-fame.png's stone and tiles; market-blue.png's crates.
  plaster: { paint: { size: [16, 16], draw: speckle("#ecd3a4", ["#e0c492", "#f4e0b8", "#d8bc8a"], 0.18) } },
  timber: { paint: { size: [8, 16], draw: grain("#543018", "#3c240c", "#6c3c18") } },
  stone: { paint: { size: [24, 16], draw: masonry(["#c09c78", "#b4906c", "#cca884", "#a8846c"], "#786048", 8, 4) } },
  fieldstone: { paint: { size: [18, 12], draw: masonry(["#9c8468", "#846c54", "#b49c84", "#6c543c"], "#3c3024", 6, 4) } },
  // cottage-gold.png's thatch: its golds, its highlight and the shadow under each course.
  thatch: { paint: { size: [24, 24], draw: thatching(["#d8840c", "#e4900c", "#d8900c", "#cc840c"], "#f4b43c", "#a86400", 6) } },
  thatchUnder: { paint: { size: [24, 24], draw: thatching(["#7a4a10", "#84520e", "#6c400c"], "#946018", "#4a2c06", 6) } },
  tiles: { paint: { size: [16, 16], draw: clayTiles(["#a83018", "#b43c24", "#9c3018", "#c03c24"], "#d4583c", "#54180c") } },
  tilesUnder: { paint: { size: [16, 16], draw: boards(["#54301a", "#4a2a16"], "#24140c", 4) } },
  planks: { paint: { size: [16, 16], draw: boards(["#9c6024", "#905418", "#844818"], "#3c1800", 4) } },
  darkPlanks: { paint: { size: [16, 16], draw: boards(["#543018", "#4a2a14", "#603818"], "#24140c", 4) } },
  // market-blue.png's awning: blue and cream bands, as wide as the picture's.
  canopy: { paint: { size: [16, 16], draw: stripes(["#e8d8b4", "#385682"], "#c8b894", 8) } },
  cloth: { paint: { size: [16, 16], draw: stripes(["#a89878", "#28406a"], "#887858", 8) } },
  crateWood: { crop: ["stall", 37, 103, 21, 8] },
  boardBack: { paint: { size: [16, 16], draw: boards(["#6c4424", "#603c20", "#784c28"], "#2c1a0c", 4) } },
  boardRoof: { crop: ["board", 10, 3, 60, 6] },
  gold: { paint: { size: [4, 4], draw: speckle("#e6ac32", ["#ffe298", "#b07818"], 0.3) } },
  brass: { paint: { size: [4, 4], draw: speckle("#c8902c", ["#e8c060"], 0.3) } },
  soil: { paint: { size: [8, 8], draw: speckle("#4a2e18", ["#3a2210", "#5c3a20"], 0.4) } },
  shadowWood: { paint: { size: [4, 4], draw: speckle("#2a1a10", ["#3a2416"], 0.3) } },
  clay: { paint: { size: [8, 8], draw: speckle("#9c4a24", ["#b45c2c", "#7c3a1c"], 0.3) } },
  // Variants within a family: an older, browner thatch; weathered brown tiles.
  thatchOld: { paint: { size: [24, 24], draw: thatching(["#b8780c", "#c4841a", "#a86c10", "#b07418"], "#d8a03c", "#7c4c08", 6) } },
  tilesBrown: { paint: { size: [16, 16], draw: clayTiles(["#8c4428", "#98502e", "#7c3c24", "#a45a34"], "#bc7048", "#40180c") } },
  // smithy.png's slate; cottage-green.png's shutters; market-red.png's awning; iron.
  slate: { paint: { size: [16, 16], draw: clayTiles(["#645a64", "#5a5a64", "#5a505a", "#6e646e"], "#827888", "#2c2830") } },
  slateUnder: { paint: { size: [16, 16], draw: boards(["#3c2a1e", "#34241a"], "#1c120c", 4) } },
  shutterGreen: { paint: { size: [8, 16], draw: boards(["#507828", "#466e1e", "#3c641e"], "#1c3010", 4) } },
  canopyRed: { paint: { size: [16, 16], draw: stripes(["#e8d8b4", "#c8371c"], "#c8b894", 8) } },
  clothRed: { paint: { size: [16, 16], draw: stripes(["#a89878", "#8a2412"], "#887858", 8) } },
  iron: { paint: { size: [4, 4], draw: speckle("#3c3c46", ["#5a5a64", "#28282e"], 0.3) } },
  bark: { paint: { size: [12, 24], draw: grain('#67431f', '#392a16', '#94602b') } },
  leaves: { paint: { size: [24, 24], draw: foliage('#4e702c', '#344e20', '#73903d') } },
  leavesLight: { paint: { size: [24, 24], draw: foliage('#648138', '#435e26', '#8fa54d') } },
  leavesDark: { paint: { size: [24, 24], draw: foliage('#3d5c25', '#2b401c', '#5d7a32') } },
  canvasGreen: { paint: { size: [16, 16], draw: boards(['#657641', '#5b6b39', '#6b7c48'], '#43502b', 8) } },
  mushroomCap: { paint: { size: [16, 16], draw: speckle('#aa4034', ['#efdab7', '#cc5d42'], .12) } },
  mountainRock: { paint: { size: [24,24], draw: speckle('#848a8a',['#747d80','#969b98','#81898c'],.2) } },
  mountainCool: { paint: { size: [24,24], draw: speckle('#657887',['#586c7e','#768996','#6c7c86'],.18) } },
  mountainLight: { paint: { size: [24,24], draw: speckle('#a5aaa6',['#919c9c','#b9bdb4','#9da7a5'],.18) } },
  peakSnow: { paint: { size: [16,16], draw: speckle('#d5dedb',['#becdd2','#e5e9df'],.12) } },
  // Decals, cut from the pictures as they are.
  door: { crop: ["cottage", 33, 97, 17, 35] },
  window: { crop: ["cottage", 85, 100, 13, 16] },
  dormerWindow: { crop: ["cottage", 81, 63, 12, 13] },
  lantern: { crop: ["cottage", 55, 98, 8, 15] },
  flowerBox: { crop: ["cottage", 83, 116, 20, 8] },
  ivy: { crop: ["cottage", 10, 95, 13, 32] },
  hallDoor: { crop: ["hall", 55, 104, 18, 24] },
  stainedWindow: { crop: ["hall", 56, 58, 17, 35] },
  banner: { crop: ["hall", 35, 64, 13, 33] },
  hallWindow: { crop: ["hall", 103, 102, 8, 18] },
  trophy: { crop: ["hall", 17, 100, 22, 22] },
  lamp: { crop: ["hall", 82, 107, 9, 11] },
  canopyEdge: { crop: ["stall", 22, 72, 88, 11] },
  tomatoes: { crop: ["stall", 40, 90, 20, 14] },
  greens: { crop: ["stall", 63, 87, 22, 16] },
  cauliflower: { crop: ["stall", 85, 92, 22, 11] },
  barrel: { crop: ["stall", 108, 98, 19, 30] },
  stallLantern: { crop: ["stall", 13, 80, 10, 13] },
  clothFront: { crop: ["stall", 35, 112, 72, 14] },
  boardDisplay: { crop: ["board", 5, 14, 74, 47] },
  boardRoofEdge: { crop: ["board", 3, 8, 79, 7] },
  gableWindow: { crop: ["cottage", 38, 68, 11, 10] },
  gableFlowers: { crop: ["cottage", 30, 77, 32, 10] },
  flowersBlue: { crop: ["cottage", 11, 119, 13, 9] },
  flowersRed: { crop: ["red", 83, 109, 24, 9] },
  flowersWhite: { crop: ["green", 51, 75, 24, 8] },
  fire: { crop: ["smithy", 20, 94, 21, 20] },
  anvil: { crop: ["smithy", 36, 114, 28, 16] },
  shield: { crop: ["smithy", 103, 70, 16, 18] },
  sacks: { crop: ["marketRed", 1, 101, 24, 29] },
  cheese: { crop: ["marketRed", 51, 91, 26, 18] },
  clothRedFront: { crop: ["marketRed", 56, 107, 31, 23] },
  canopyRedEdge: { crop: ["marketRed", 16, 64, 101, 14] },
  hiringDisplay: { crop: ['hiring', 7, 7, 42, 29] },
  strategyDisplay: { crop: ['strategy', 5, 5, 32, 29] },
  scoreDisplay: { crop: ['score', 7, 6, 52, 36] },
};

const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`could not load ${url}`)); image.src = url;
});

/** Loads the reference pictures and packs every material into one atlas, shelf by shelf, a pixel apart. */
export async function buildSolidAtlas(): Promise<SolidAtlas> {
  const images = Object.fromEntries(await Promise.all((Object.keys(SOURCES) as Source[]).map(async (k) => [k, await load(SOURCES[k])] as const))) as Record<Source, HTMLImageElement>;
  const sizes = SOLID_MATERIALS.map((m) => { const s = SPECS[m]; return "crop" in s ? [s.crop[3], s.crop[4]] as const : s.paint.size; });
  const width = 256, rects = new Float32Array(SOLID_MATERIALS.length * 4), modes = new Float32Array(SOLID_MATERIALS.length);
  let x = 0, y = 0, shelf = 0;
  sizes.forEach(([w, h], i) => {
    if (x + w > width) { x = 0; y += shelf + 1; shelf = 0; }
    rects.set([x, y, w, h], i * 4); x += w + 1; shelf = Math.max(shelf, h);
  });
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = y + shelf + 1;
  const g = canvas.getContext("2d")!; g.imageSmoothingEnabled = false;
  let seed = 20261012;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  SOLID_MATERIALS.forEach((m, i) => {
    const [rx, ry, rw, rh] = rects.subarray(i * 4, i * 4 + 4) as unknown as number[];
    const s = SPECS[m];
    modes[i] = SOLID_DECALS.has(m) ? 1 : 0;
    g.save(); g.beginPath(); g.rect(rx!, ry!, rw!, rh!); g.clip(); g.translate(rx!, ry!);
    if ("crop" in s) {
      const [src, sx, sy, sw, sh] = s.crop;
      g.drawImage(images[src], sx, sy, sw, sh, 0, 0, sw, sh);
      if (s.darken) { g.globalCompositeOperation = "source-atop"; g.fillStyle = `rgba(20,10,4,${s.darken})`; g.fillRect(0, 0, sw, sh); }
    } else s.paint.draw(g, rw!, rh!, rand);
    g.restore();
  });
  return { canvas, rects, modes };
}
