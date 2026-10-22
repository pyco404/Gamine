/**
 * The village grows with real token agents:
 * as more agents arrive, plots open and buildings go up, and the
 * trees on their ground come down. Presentation only - nothing here is read
 * by anything that plays, pairs or pays.
 *
 * Pure, and free of Phaser and the web app's aliases, so the root suite can
 * test it. The scene (scene.ts) draws what this says.
 *
 * Growth comes in plans: a list of plots, each opening at a real-agent count, in
 * the order they open. New Town is opened by real agents across all qualifying tokens; house
 * residents, replay stand-ins and retiring agents do not contribute.
 * A plot never moves and never closes again once open in a page's life; if
 * the count falls, what stands stays standing until the page is reloaded.
 */

import { fromEdge, inNewTown, INNER, OUTER, type Pt } from "./world";
import { BAZAAR_SITE, LAUNCH_SITE, ROADS, SITES } from "./town";
import { RIVER_BANKS } from "./river";
import { GARDEN_PONDS } from "./landmarks";

/** Every picture a plot can be built from, with where it comes from and how it stands. */
export const PIECE_ART = {
  // The pack's own (public/fixtures).
  House_Blue: { src: "/village/gamine/modern-villa-blue.png", width: 128, height: 192, foot: 172 / 192 },
  House_Red: { src: "/village/gamine/modern-villa-red.png", width: 128, height: 192, foot: 172 / 192 },
  House_Yellow: { src: "/village/gamine/modern-villa-yellow.png", width: 128, height: 192, foot: 172 / 192 },
  House_Purple: { src: "/village/gamine/modern-villa-purple.png", width: 128, height: 192, foot: 172 / 192 },
  Plot: { src: "/fixtures/Plot.png", width: 90, height: 54, foot: 1 },
  Yard: { src: "/fixtures/Yard.png", width: 288, height: 107, foot: 1 },
  Pumpkin: { src: "/fixtures/Pumpkin.png", width: 64, height: 64, foot: 1 },
  Fence: { src: "/fixtures/Fence.png", width: 96, height: 30, foot: 1 },
  // A sheet of eight frames, 128 across.
  Sheep: { src: "/fixtures/Sheep.png", width: 128, height: 128, foot: 0.8, frames: 8 },
  // New Town's, drawn for Gamine (scripts/village-art.ts): glass, flat roofs, screens, lamps.
  office: { src: "/village/gamine/modern-office.png", width: 56, height: 74, foot: 1 },
  "house-a": { src: "/village/gamine/modern-house-a.png", width: 54, height: 50, foot: 1 },
  "house-b": { src: "/village/gamine/modern-house-b.png", width: 54, height: 50, foot: 1 },
  shop: { src: "/village/gamine/modern-shop.png", width: 58, height: 54, foot: 1 },
  apartments: { src: "/village/gamine/modern-apartments.png", width: 60, height: 86, foot: 1 },
  kiosk: { src: "/village/gamine/modern-kiosk.png", width: 38, height: 42, foot: 1 },
  lamp: { src: "/village/gamine/modern-lamp.png", width: 10, height: 38, foot: 1 },
  planter: { src: "/village/gamine/modern-planter.png", width: 22, height: 14, foot: 1 },
} as const satisfies Record<string, { src: string; width: number; height: number; foot: number; frames?: number }>;

export type PieceArt = keyof typeof PIECE_ART;

export type GrowthPiece = {
  image: PieceArt;
  x: number;
  y: number;
  scale: number;
  flip?: boolean;
};

export type Plot = {
  /** Stable, so a page can tell which plots it has already drawn. */
  id: string;
  /** Opens once this many real agents are on the field. */
  at: number;
  /** What a builder works at: the plot's front. */
  door: { x: number; y: number };
  pieces: GrowthPiece[];
};

/** A plan: plots in the order they open, by one count of real agents. */
export type Plan = { id: string; plots: Plot[] };

/** The plots of a plan open at this many holders, in the order they opened. */
export function openPlots(plan: Plan, holders: number): Plot[] {
  return plan.plots.filter((p) => holders >= p.at);
}

/** The next plot to open, and the count it opens at; null once every plot is open. */
export function nextPlot(plan: Plan, holders: number): Plot | null {
  return plan.plots.find((p) => holders < p.at) ?? null;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * The ground a plot takes: every piece's picture and some room round it. The
 * forest gives way here - a tree whose canopy reaches into it is taken down
 * when the plot opens, and never grows back, since a plot never closes.
 */
export function plotClearing(plot: Plot, margin = 40): Box {
  let box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of plot.pieces) {
    const size = PIECE_ART[p.image];
    const w = size.width * p.scale;
    const h = size.height * p.scale;
    box = {
      x0: Math.min(box.x0, p.x - w / 2),
      y0: Math.min(box.y0, p.y - h * size.foot),
      x1: Math.max(box.x1, p.x + w / 2),
      y1: Math.max(box.y1, p.y + h * (1 - size.foot)),
    };
  }
  return { x0: box.x0 - margin, y0: box.y0 - margin, x1: box.x1 + margin, y1: box.y1 + margin + 30 };
}

/** A tree's canopy, as the forest draws it: a tree sheet's frame is 192 pixels, drawn from its middle. */
export function canopy(tree: { x: number; y: number; s: number }): Box {
  return { x0: tree.x - 62 * tree.s, y0: tree.y - 150 * tree.s, x1: tree.x + 62 * tree.s, y1: tree.y + 10 };
}

export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** The trees a set of open plots takes down: indexes into the list given. */
export function felled(trees: readonly { x: number; y: number; s: number }[], plots: readonly Plot[]): number[] {
  const clearings = plots.map((p) => plotClearing(p));
  const out: number[] = [];
  trees.forEach((t, i) => {
    if (clearings.some((c) => overlaps(canopy(t), c))) out.push(i);
  });
  return out;
}

// --- New Town ------------------------------------------------------------------

/** The New Town plots' fixed neighbours, which no plot is laid over: the Launch Pad east, the bazaar west (town.ts). */
export const NEW_TOWN_FIXED: { id: string; at: Pt; room: number }[] = [
  { id: "launchpad", at: LAUNCH_SITE, room: 230 },
  { id: "bazaar", at: BAZAAR_SITE, room: 250 },
];

/** The real-agent count each plot opens at, in order: one at a time at first, then further apart as the town fills. */
export function thresholds(n: number): number[] {
  const out: number[] = [];
  let at = 1;
  for (let i = 0; i < n; i++) {
    out.push(Math.round(at));
    at = i < 6 ? at + 1 : Math.max(at + 1, at * 1.12);
  }
  return out;
}

const distToSegment = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** A deterministic random stream, so New Town is laid out the same on every load. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDINGS: PieceArt[] = ["house-a", "office", "shop", "house-b", "apartments", "kiosk"];

/** Stable, seeded growth plots in irregular neighbourhoods, clear of roads and water. */
function newTownPlan(): Plan {
  const rand = rng(20261005);
  // Neighbourhood clearings blend into wilderness; there are no rows along an enclosing road.
  const neighbourhoods = [
    { name: "market", x: 30, y: 910, rx: 320, ry: 550 },
    { name: "orchards", x: 560, y: -180, rx: 520, ry: 240 },
    { name: "north", x: 1840, y: -270, rx: 650, ry: 210 },
    { name: "homes", x: 960, y: 1970, rx: 550, ry: 300 },
    { name: "launch", x: 2940, y: 1300, rx: 210, ry: 630 },
    { name: "workshops", x: 2860, y: 160, rx: 280, ry: 570 },
    { name: "south", x: 2660, y: 1990, rx: 400, ry: 210 },
  ];
  const slots: { id: string; at: Pt }[] = [];
  for (let i = 0; i < 1400; i++) {
    const n = neighbourhoods[i % neighbourhoods.length]!;
    const angle = rand() * Math.PI * 2, radius = Math.sqrt(rand());
    const p = {x: Math.round(n.x + Math.cos(angle) * radius * n.rx), y: Math.round(n.y + Math.sin(angle) * radius * n.ry)};
    if (!inNewTown(p, 100)) continue;
    if (NEW_TOWN_FIXED.some((f) => Math.hypot(f.at.x - p.x, f.at.y - p.y) < f.room)) continue;
    slots.push({id: `${n.name}-${i}`, at: p});
  }
  // Each slot's building and maybe a planter; a slot whose ground would overlap one already laid -
  // where a row turns a corner, or tall buildings stack up an upright side - is left as open ground.
  const laid: { id: string; door: Pt; pieces: GrowthPiece[] }[] = [];
  for (const s of slots) {
    const image = BUILDINGS[Math.floor(rand() * BUILDINGS.length)]!;
    const size = PIECE_ART[image];
    // The building's foot sits a little below the slot, so it stands centred on it.
    const foot = { x: s.at.x, y: s.at.y + size.height };
    const flip = rand() < 0.5;
    const planter = rand() < 0.4;
    const pieces: GrowthPiece[] = [
      { image, x: foot.x, y: foot.y, scale: 2, flip },
    ];
    if (planter) pieces.push({ image: "planter", x: foot.x + (flip ? 1 : -1) * (size.width + 8), y: foot.y + 8, scale: 2 });
    const plot = { id: `new-town-${s.id}`, at: 0, door: { x: foot.x, y: foot.y + 20 }, pieces };
    const ground = plotClearing(plot, 0);
    if ([...RIVER_BANKS, ...GARDEN_PONDS].some((bank) => overlaps(ground, bank))) continue;
    if (Object.values(SITES).some((site) => overlaps(ground, {x0:site.x-160,y0:site.y-250,x1:site.x+160,y1:site.y+80}))) continue;
    const centre = {x:(ground.x0+ground.x1)/2,y:(ground.y0+ground.y1)/2};
    const reach = Math.hypot(ground.x1-ground.x0,ground.y1-ground.y0)/2 + 12;
    if (ROADS.some((road) => road.points.some(([x,y],i) => i > 0 && distToSegment(centre, {x:road.points[i-1]![0],y:road.points[i-1]![1]}, {x,y}) < reach + road.width/2))) continue;
    if (laid.some((other) => overlaps(ground, plotClearing({ ...other, at: 0 }, 0)))) continue;
    if (NEW_TOWN_FIXED.some((f) => overlaps(ground, { x0: f.at.x - 140, y0: f.at.y - 220, x1: f.at.x + 140, y1: f.at.y + 60 }))) continue;
    laid.push(plot);
    if (laid.length >= 100) break;
  }
  const at = thresholds(laid.length);
  return { id: "new-town", plots: laid.map((p, i) => ({ ...p, at: at[i]! })) };
}

export const NEW_TOWN: Plan = newTownPlan();

/** Whether a point is inside New Town's band at all (for the forest, which grows sparse there until plots open). */
export const inBand = (p: Pt) => fromEdge(INNER, p) > 0 && fromEdge(OUTER, p) < 0;
