import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync, crc32 } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RECOLOURED, TERRAIN } from "../web/app/village/game/palette.js";

/**
 * Draws the village's Gamine art: the arena, the leaderboard, the Game
 * Hall's screens, the Strategy Lab's boards, the Launch Pad, banners and
 * flags bearing the crest, and the small things of the agent grounds.
 * Everything lands in web/public/village/gamine; nothing here runs at
 * request time.
 *
 *   npx tsx scripts/village-art.ts
 *
 * The crest is web/public/gamine-tb.png, scaled down and never redrawn.
 * The rest is drawn here in the Tiny Swords pack's palette (the teal stone,
 * the wood, the thatch) and the crest's own greens, outlined like the pack,
 * at one art pixel to two world pixels - the scene draws these at scale 2.
 * Three of the pack's buildings are recoloured rather than redrawn: the
 * castle and the tower fly the crest's colours, and the old arena hut's
 * "ARENA" sign becomes a match screen for the Game Hall.
 *
 * The pack's ground, water, trees and bushes are recoloured from the
 * terrain palette (web/app/village/game/palette.ts) into public/village/warm,
 * colour for colour, never edited by hand; see the end of this file.
 *
 * No dependencies: a small PNG reader and writer on node:zlib.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "web/public");
const out = join(pub, "village/gamine");

// --- PNG ---------------------------------------------------------------------

type RGBA = [number, number, number, number];

function readPng(path: string): Raster {
  const buf = readFileSync(path);
  let at = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`${path}: only 8-bit PNGs`);
      colourType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alpha = data;
    else if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`${path}: colour type ${colourType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const img = new Raster(width, height);
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  let pos = 0;
  for (const [x0, y0, dx, dy] of passes as [number, number, number, number][]) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = pw * channels;
    let prev = new Uint8Array(stride);
    for (let r = 0; r < ph; r++) {
      const filter = raw[pos++]!;
      const line = new Uint8Array(raw.subarray(pos, pos + stride));
      pos += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? line[i - channels]! : 0;
        const b = prev[i]!;
        const c = i >= channels ? prev[i - channels]! : 0;
        let add = 0;
        if (filter === 1) add = a;
        else if (filter === 2) add = b;
        else if (filter === 3) add = (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        line[i] = (line[i]! + add) & 255;
      }
      for (let k = 0; k < pw; k++) {
        const s = k * channels;
        let px: RGBA;
        if (colourType === 6) px = [line[s]!, line[s + 1]!, line[s + 2]!, line[s + 3]!];
        else if (colourType === 2) px = [line[s]!, line[s + 1]!, line[s + 2]!, 255];
        else if (colourType === 4) px = [line[s]!, line[s]!, line[s]!, line[s + 1]!];
        else if (colourType === 0) px = [line[s]!, line[s]!, line[s]!, 255];
        else {
          const i = line[s]!;
          px = [palette![i * 3]!, palette![i * 3 + 1]!, palette![i * 3 + 2]!, alpha && i < alpha.length ? alpha[i]! : 255];
        }
        img.set(x0 + k * dx, y0 + r * dy, px);
      }
      prev = line;
    }
  }
  return img;
}

function writePng(path: string, img: Raster): void {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    rows[y * (img.w * 4 + 1)] = 0;
    Buffer.from(img.data.buffer, y * img.w * 4, img.w * 4).copy(rows, y * (img.w * 4 + 1) + 1);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  writeFileSync(path, Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

// --- Drawing -----------------------------------------------------------------

const hex = (s: string, a = 255): RGBA => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), a];

class Raster {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }
  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }
  set(x: number, y: number, c: RGBA): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data.set(c, i);
  }
  /** Over what is there: a translucent colour tints rather than replaces. */
  put(x: number, y: number, c: RGBA): void {
    if (c[3] >= 255) return this.set(x, y, c);
    if (c[3] <= 0) return;
    const [r, g, b, a] = this.get(Math.round(x), Math.round(y));
    const sa = c[3] / 255;
    const oa = sa + (a / 255) * (1 - sa);
    if (oa <= 0) return;
    const mix = (s: number, d: number) => Math.round((s * sa + (d * (a / 255) * (1 - sa))) / oa);
    this.set(x, y, [mix(c[0], r), mix(c[1], g), mix(c[2], b), Math.round(oa * 255)]);
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, c);
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (inEllipse(x, y, cx, cy, rx, ry)) this.put(x, y, c);
    }
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) this.put(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), c);
    return this;
  }
  blit(src: Raster, dx: number, dy: number, alpha = 1): this {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c[3] > 0) this.put(dx + x, dy + y, [c[0], c[1], c[2], Math.round(c[3] * alpha)]);
      }
    }
    return this;
  }
  /** A one-pixel line round everything drawn, as the pack outlines its art. */
  outline(c: RGBA = P.ink): this {
    const solid = (x: number, y: number) => this.get(x, y)[3] >= 128;
    const edge: [number, number][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.set(x, y, c);
    return this;
  }
  clone(): Raster {
    const r = new Raster(this.w, this.h);
    r.data.set(this.data);
    return r;
  }
}

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;

/** A deterministic random stream, so the art is the same on every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Area-averaged, so the crest's shapes survive being made small; then its edge made hard again, as pixel art's is. */
function scaled(src: Raster, w: number): Raster {
  const h = Math.max(1, Math.round((src.h * w) / src.w));
  const img = new Raster(w, h);
  const sx = src.w / w;
  const sy = src.h / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = Math.floor(y * sy); j < Math.ceil((y + 1) * sy); j++) {
        for (let i = Math.floor(x * sx); i < Math.ceil((x + 1) * sx); i++) {
          const c = src.get(i, j);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = Math.ceil((y + 1) * sy - Math.floor(y * sy)) * Math.ceil((x + 1) * sx - Math.floor(x * sx));
      if (a / n < 100) continue;
      img.set(x, y, [Math.round(r / a), Math.round(g / a), Math.round(b / a), 255]);
    }
  }
  return img;
}

// --- Palette -----------------------------------------------------------------

/** The pack's own colours (sampled from its buildings) and the crest's. */
const P = {
  ink: hex("#151228"),
  // The crest.
  navy: hex("#001727"),
  deep: hex("#00374d"),
  dteal: hex("#015f68"),
  teal: hex("#189b68"),
  green: hex("#5dcd50"),
  lime: hex("#9ae352"),
  glow: hex("#d9f958"),
  // The pack's teal stone.
  stoneHi: hex("#8cdeb8"),
  stone: hex("#55a1ab"),
  stoneLo: hex("#45718a"),
  stoneDk: hex("#355163"),
  stoneDeep: hex("#2d324b"),
  // Wood and thatch.
  thatch: hex("#efdb97"),
  woodHi: hex("#d7ad6e"),
  wood: hex("#b68357"),
  woodMid: hex("#9b7051"),
  woodLo: hex("#6b4a3e"),
  woodDk: hex("#493a58"),
  // The arena's floor.
  sandHi: hex("#f0dca4"),
  sand: hex("#e4c88f"),
  sandLo: hex("#d2b07a"),
  sandDk: hex("#b8955f"),
  // Old Town's roads' own (palette.ts), for the gate that joins one.
  road: hex(TERRAIN.dirt.edge),
  roadIn: hex(TERRAIN.dirt.base),
  // Prizes.
  goldHi: hex("#fbe7a1"),
  gold: hex("#e8b84b"),
  goldLo: hex("#b07a2a"),
  silver: hex("#c9d3dc"),
  bronze: hex("#c9844b"),
  red: hex("#d4745a"),
  redHi: hex("#ff5a4a"),
  redDk: hex("#7a2b2b"),
  screen: hex("#0e1f2e"),
  paper: hex("#efe2c0"),
  white: hex("#f5ecd8"),
};

/** What the crowd and the little agents wear: the site's colours and a few more. */
const WEAR = ["#5dcd50", "#189b68", "#e8b84b", "#d4745a", "#8f7bd8", "#4a6fa5", "#efdb97", "#9ae352", "#c95b8c", "#f5ecd8"].map((c) => hex(c));
const SKIN = ["#f1c9a5", "#d9a47c", "#a8714f", "#7a4e38"].map((c) => hex(c));

const CREST = readPng(join(pub, "gamine-tb.png"));
const crest = (w: number) => scaled(CREST, w);

// --- Pieces ------------------------------------------------------------------

/** A banner hanging from a crossbar on a pole, the crest on its cloth. */
function banner(cloth: RGBA, shade: RGBA, trim: RGBA, cw = 14, ch = 26): Raster {
  const w = cw + 6;
  const h = ch + 22;
  const img = new Raster(w, h);
  const mid = Math.floor(w / 2);
  img.rect(mid - 1, 3, 2, h - 3, P.woodMid).rect(mid - 1, 3, 1, h - 3, P.woodHi);
  img.rect(mid - 2, 0, 4, 3, P.gold).rect(mid - 1, 0, 2, 1, P.goldHi);
  img.rect(1, 5, w - 2, 2, P.woodLo);
  const x0 = 3;
  const y0 = 7;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      // A swallowtail: a notch cut up into the bottom.
      const notch = ch - 1 - y < 5 - Math.abs(x - (cw - 1) / 2) * 0.9;
      if (notch) continue;
      img.set(x0 + x, y0 + y, x === 0 || x === cw - 1 ? shade : cloth);
    }
  }
  // A gold edge along the bottom and down the sides.
  for (let x = 0; x < cw; x++) {
    for (let y = ch - 1; y >= 0; y--) {
      if (img.get(x0 + x, y0 + y)[3] > 0) {
        img.set(x0 + x, y0 + y, trim);
        break;
      }
    }
  }
  img.rect(x0, y0, cw, 1, trim);
  const c = crest(Math.min(cw - 2, Math.floor((ch - 9) * CREST.w / CREST.h)));
  img.blit(c, x0 + Math.floor((cw - c.w) / 2), y0 + 3);
  return img.outline();
}

/** A flag on a tall pole, in two frames of a slow wave. */
function flagSheet(): Raster {
  const fw = 28;
  const fh = 58;
  const sheet = new Raster(fw * 2, fh);
  const c = crest(13);
  for (let f = 0; f < 2; f++) {
    const img = new Raster(fw, fh);
    img.rect(3, 4, 2, fh - 4, P.woodMid).rect(3, 4, 1, fh - 4, P.woodHi);
    img.rect(2, 1, 4, 3, P.gold);
    const cloth = new Raster(fw, fh);
    for (let x = 0; x < 21; x++) {
      const dy = Math.round(Math.sin((x / 21) * Math.PI * 1.3 + f * Math.PI) * 1.4 * (x / 21));
      for (let y = 0; y < 14; y++) cloth.set(5 + x, 5 + y + dy, y < 7 ? P.teal : P.dteal);
      cloth.set(5 + x, 5 + dy, P.lime);
    }
    cloth.blit(c, 9, 7 + Math.round(Math.sin(0.4 * Math.PI * 1.3 + f * Math.PI) * 0.6));
    img.blit(cloth, 0, 0);
    img.outline();
    sheet.blit(img, f * fw, 0);
  }
  return sheet;
}

/**
 * The leaderboard: the crest, a podium of three, the ranks below them with a
 * bar for each, a live light and an arrow for climbing. Two frames: the light
 * blinks and the arrow glows.
 */
function leaderboardSheet(): Raster {
  const fw = 84;
  const fh = 74;
  const sheet = new Raster(fw * 2, fh);
  for (let f = 0; f < 2; f++) {
    const img = new Raster(fw, fh);
    // Posts, then a roof of the pack's teal shingles.
    for (const x of [8, 72]) img.rect(x, 14, 4, fh - 15, P.woodMid).rect(x, 14, 1, fh - 15, P.woodHi);
    for (let y = 2; y < 13; y++) {
      const inset = Math.max(0, 12 - y) * 0.6;
      img.rect(Math.round(3 + inset), y, Math.round(fw - 6 - inset * 2), 1, y % 3 === 0 ? P.stoneDk : y < 6 ? P.stone : P.stoneLo);
    }
    img.rect(3, 12, fw - 6, 1, P.stoneDeep);
    // The board: a gold frame, the dark face.
    img.rect(5, 14, fw - 10, 46, P.goldLo).rect(6, 15, fw - 12, 44, P.gold).rect(8, 17, fw - 16, 40, P.screen);
    img.blit(crest(24), Math.round(fw / 2 - 12), 18);
    // The live light, top left; the arrow, top right.
    img.rect(11, 20, 4, 4, f === 0 ? P.redHi : P.redDk);
    if (f === 0) img.rect(12, 20, 1, 1, P.white);
    const arrow = f === 0 ? P.lime : P.glow;
    for (let k = 0; k < 4; k++) img.rect(69 - k, 20 + k, 1 + k * 2, 1, arrow);
    img.rect(68, 24, 3, 4, arrow);
    // The podium.
    const steps: [number, number, RGBA, number][] = [
      [11, 9, P.silver, 9],
      [20, 13, P.gold, 13],
      [33, 6, P.bronze, 9],
    ];
    for (const [x, hgt, colour, w] of steps) {
      const top = 55 - hgt;
      img.rect(x, top, w, hgt, colour).rect(x, top, w, 1, P.white);
      img.rect(x + Math.floor(w / 2) - 1, top - 4, 3, 3, SKIN[(x / 11) % SKIN.length | 0]!);
      img.rect(x + Math.floor(w / 2) - 2, top - 1, 5, 1, WEAR[x % WEAR.length]!);
    }
    img.rect(24, 36, 1, 1, P.gold).rect(26, 36, 1, 1, P.gold).rect(28, 36, 1, 1, P.gold).rect(24, 37, 5, 1, P.gold);
    // The ranks.
    const ranks: [RGBA, number][] = [
      [P.gold, 22],
      [P.silver, 17],
      [P.bronze, 13],
      [P.teal, 9],
      [P.teal, 6],
    ];
    ranks.forEach(([pip, len], i) => {
      const y = 35 + i * 4;
      img.rect(45, y, 3, 3, pip);
      img.rect(50, y, 3, 3, WEAR[(i * 3 + 1) % WEAR.length]!);
      img.rect(55, y, len, 3, i === 0 && f === 1 ? P.glow : P.green).rect(55, y, len, 1, P.lime);
    });
    img.outline();
    sheet.blit(img, f * fw, 0);
  }
  return sheet;
}

/** A tiny agent in profile on a screen: head, body, facing in. */
function tinyAgent(img: Raster, x: number, y: number, skin: RGBA, wear: RGBA): void {
  img.rect(x, y, 4, 4, skin).rect(x - 1, y + 4, 6, 5, wear).rect(x, y + 9, 1, 2, wear).rect(x + 3, y + 9, 1, 2, wear);
}

/** The Game Hall's screens: two matches playing, each with its score lights. Two frames: a point scored, the live light blinking. */
function scoreboardSheet(): Raster {
  const fw = 66;
  const fh = 66;
  const sheet = new Raster(fw * 2, fh);
  for (let f = 0; f < 2; f++) {
    const img = new Raster(fw, fh);
    for (const x of [9, 54]) img.rect(x, 30, 3, fh - 31, P.woodMid).rect(x, 30, 1, fh - 31, P.woodHi);
    img.rect(3, 3, fw - 6, 44, P.stoneDk).rect(4, 4, fw - 8, 42, P.stone).rect(4, 4, fw - 8, 1, P.stoneHi);
    img.rect(6, 6, fw - 12, 38, P.navy);
    img.blit(crest(14), Math.round(fw / 2 - 7), 7);
    img.rect(9, 9, 3, 3, f === 0 ? P.redHi : P.redDk);
    for (const [sx, a, b, lit] of [
      [8, 0, 4, 2 + f],
      [34, 6, 3, 1 + f],
    ] as const) {
      img.rect(sx, 18, 24, 24, P.teal).rect(sx + 1, 19, 22, 22, hex("#0a2a2a"));
      tinyAgent(img, sx + 3, 23, SKIN[a % SKIN.length]!, WEAR[a]!);
      tinyAgent(img, sx + 17, 23, SKIN[(b + 1) % SKIN.length]!, WEAR[b]!);
      // The clash between them.
      const spark = f === 0 ? P.gold : P.glow;
      img.rect(sx + 11, 26, 2, 2, spark).rect(sx + 10, 27, 4, 1, spark).rect(sx + 11, 25, 1, 4, spark);
      for (let k = 0; k < 3; k++) {
        img.rect(sx + 3 + k * 3, 37, 2, 2, k < lit ? P.lime : P.stoneDk);
        img.rect(sx + 14 + k * 3, 37, 2, 2, k < 3 - lit + f ? P.lime : P.stoneDk);
      }
    }
    img.outline();
    sheet.blit(img, f * fw, 0);
  }
  return sheet;
}

/** The planning table: a map of the field, routes drawn on it, pieces placed. */
function warTable(): Raster {
  const img = new Raster(46, 32);
  for (const x of [3, 39]) img.rect(x, 20, 4, 11, P.woodLo);
  img.rect(0, 6, 46, 16, P.wood).rect(0, 6, 46, 1, P.woodHi).rect(0, 19, 46, 3, P.woodMid);
  img.rect(3, 8, 40, 10, hex("#2f6b5a")).rect(3, 8, 40, 1, hex("#3f8a6f"));
  // Routes and a target.
  img.line(6, 15, 15, 11, P.lime).line(15, 11, 24, 14, P.lime).line(24, 14, 34, 10, P.glow);
  img.line(8, 10, 18, 16, P.paper).line(18, 16, 30, 16, P.paper);
  img.rect(35, 9, 4, 4, P.redHi).rect(36, 10, 2, 2, P.white);
  // Pieces.
  for (const [x, y, c] of [
    [10, 12, P.gold],
    [20, 9, P.redHi],
    [27, 15, P.white],
    [14, 15, P.teal],
  ] as const) img.rect(x, y - 2, 2, 3, c).rect(x, y - 3, 2, 1, P.ink);
  return img.outline();
}

/**
 * The strategy board, on an easel: a decision tree in chalk, its leaves the
 * three choices a strategy makes - fold, call, raise.
 */
function strategyBoard(): Raster {
  const img = new Raster(42, 50);
  img.line(9, 49, 14, 3, P.woodMid).line(10, 49, 15, 3, P.woodLo);
  img.line(33, 49, 28, 3, P.woodMid).line(32, 49, 27, 3, P.woodLo);
  img.rect(4, 4, 34, 28, P.wood).rect(5, 5, 32, 26, hex("#1f3d3a"));
  img.rect(4, 32, 34, 2, P.woodHi);
  const box = (x: number, y: number, c: RGBA) => img.rect(x, y, 6, 4, c);
  box(18, 7, P.white);
  img.line(20, 11, 11, 15, P.paper).line(23, 11, 30, 15, P.paper);
  box(8, 15, P.paper);
  box(27, 15, P.paper);
  img.line(10, 19, 8, 23, P.paper).line(12, 19, 15, 23, P.paper).line(29, 19, 26, 23, P.paper).line(31, 19, 33, 23, P.paper);
  for (const [x, c] of [
    [6, P.red],
    [13, P.lime],
    [24, P.gold],
    [31, P.lime],
  ] as const) img.rect(x, 23, 4, 4, c);
  img.rect(6, 33, 4, 1, P.white).rect(12, 33, 3, 1, P.glow);
  return img.outline();
}

/** The Hiring Hall's board: three agents for hire, one picked out in gold. */
function hiringBoard(): Raster {
  const img = new Raster(56, 50);
  for (const x of [5, 47]) img.rect(x, 12, 4, 37, P.woodMid).rect(x, 12, 1, 37, P.woodHi);
  img.rect(2, 10, 52, 30, P.woodLo).rect(3, 11, 50, 28, P.wood).rect(3, 11, 50, 1, P.woodHi);
  img.rect(14, 0, 28, 10, P.dteal).rect(15, 1, 26, 8, P.teal);
  img.blit(crest(14), 21, 1);
  [6, 21, 36].forEach((x, i) => {
    const picked = i === 1;
    if (picked) img.rect(x - 1, 13, 16, 22, P.gold);
    img.rect(x, 14, 14, 20, P.paper);
    img.rect(x + 4, 17, 6, 6, SKIN[(i + 1) % SKIN.length]!).rect(x + 2, 23, 10, 7, WEAR[[3, 0, 4][i]!]!);
    img.rect(x + 2, 31, 10, 1, P.woodLo);
  });
  // A check over the picked one.
  img.line(26, 6, 28, 8, P.glow).line(28, 8, 32, 3, P.glow);
  return img.outline();
}

/** A champion in gold on a stone plinth, the crest held up. */
function statue(): Raster {
  const img = new Raster(26, 60);
  img.rect(3, 42, 20, 17, P.stone).rect(3, 42, 20, 2, P.stoneHi).rect(3, 55, 20, 4, P.stoneLo).rect(2, 40, 22, 3, P.stoneHi);
  img.rect(9, 48, 8, 4, P.gold).rect(10, 49, 6, 1, P.goldHi);
  // The figure.
  img.rect(10, 31, 3, 9, P.goldLo).rect(14, 31, 3, 9, P.gold);
  img.rect(9, 20, 9, 12, P.gold).rect(9, 20, 2, 12, P.goldLo).rect(16, 21, 2, 10, P.goldHi);
  img.rect(10, 13, 7, 7, P.gold).rect(11, 14, 2, 2, P.goldHi);
  img.rect(6, 21, 3, 8, P.goldLo);
  img.rect(18, 10, 3, 11, P.gold);
  img.blit(crest(12), 14, 2);
  return img.outline();
}

/** A gold cup on a stone pillar. */
function trophy(): Raster {
  const img = new Raster(18, 34);
  img.rect(4, 16, 10, 17, P.stone).rect(4, 16, 10, 2, P.stoneHi).rect(4, 30, 10, 3, P.stoneLo).rect(3, 15, 12, 2, P.stoneHi);
  img.rect(4, 3, 10, 7, P.gold).rect(5, 4, 2, 5, P.goldHi).rect(5, 10, 8, 1, P.goldLo).rect(7, 11, 4, 2, P.gold).rect(5, 13, 8, 2, P.goldLo);
  img.rect(1, 4, 3, 1, P.gold).rect(1, 4, 1, 4, P.gold).rect(14, 4, 3, 1, P.gold).rect(16, 4, 1, 4, P.gold);
  return img.outline();
}

/** A treasure chest, open and heaped with coins, or shut. */
function chest(open: boolean): Raster {
  const img = new Raster(28, 24);
  const top = open ? 10 : 8;
  if (open) {
    img.rect(3, 1, 22, 8, P.woodLo).rect(4, 2, 20, 6, P.woodMid).rect(3, 4, 22, 1, P.gold);
    img.ellipse(14, 11, 11, 4, P.gold).ellipse(13, 10, 6, 2, P.goldHi);
    img.rect(9, 8, 1, 1, P.white).rect(19, 9, 1, 1, P.white);
  } else {
    img.ellipse(14, 9, 11, 4, P.woodMid).rect(3, 8, 22, 2, P.woodMid).rect(3, 7, 22, 1, P.wood);
  }
  img.rect(3, top + 1, 22, 11, P.wood).rect(3, top + 1, 22, 2, P.woodHi).rect(3, top + 10, 22, 2, P.woodLo);
  for (const x of [5, 20]) img.rect(x, top + 1, 3, 11, P.gold).rect(x, top + 1, 1, 11, P.goldHi);
  img.rect(12, top + 4, 4, 4, P.goldLo).rect(13, top + 5, 2, 2, P.ink);
  return img.outline();
}

function coins(): Raster {
  const img = new Raster(18, 10);
  img.ellipse(9, 6, 8, 3, P.goldLo).ellipse(8, 5, 6, 2.5, P.gold).ellipse(8, 4, 3, 1.5, P.goldHi);
  img.rect(14, 2, 3, 2, P.gold).rect(2, 3, 2, 2, P.gold);
  return img.outline();
}

/** A tent of the crest's teal, a pennant on its pole. */
function tent(): Raster {
  const img = new Raster(48, 42);
  const apex = { x: 24, y: 10 };
  for (let y = apex.y; y <= 38; y++) {
    const half = ((y - apex.y) / (38 - apex.y)) * 21;
    for (let x = Math.round(apex.x - half); x <= Math.round(apex.x + half); x++) img.set(x, y, x < apex.x ? P.teal : P.dteal);
  }
  for (let y = 38; y > 36; y--) for (let x = 3; x < 46; x++) if (img.get(x, y)[3]) img.set(x, y, P.gold);
  for (let y = 22; y <= 38; y++) {
    const half = ((y - 22) / 16) * 6;
    for (let x = Math.round(24 - half); x <= Math.round(24 + half); x++) img.set(x, y, P.navy);
  }
  img.line(24, 10, 15, 37, hex("#13755a")).line(24, 10, 33, 37, hex("#014a52"));
  img.rect(23, 2, 2, 9, P.woodLo);
  img.rect(25, 2, 7, 4, P.lime).rect(25, 4, 5, 2, P.green);
  return img.outline();
}

function bench(): Raster {
  const img = new Raster(30, 14);
  img.rect(1, 2, 28, 3, P.woodMid).rect(1, 2, 28, 1, P.woodHi);
  img.rect(1, 6, 28, 3, P.wood).rect(1, 6, 28, 1, P.woodHi);
  for (const x of [3, 25]) img.rect(x, 9, 2, 4, P.woodLo);
  return img.outline();
}

/** A training dummy: straw on a post, a target on its chest in the crest's colours. */
function dummy(): Raster {
  const img = new Raster(20, 38);
  img.rect(9, 12, 2, 25, P.woodLo).rect(2, 15, 16, 2, P.woodMid);
  img.rect(5, 11, 10, 14, P.woodHi).rect(5, 11, 2, 14, P.wood).rect(5, 17, 10, 1, P.wood);
  img.ellipse(10, 6, 4, 4.5, P.thatch).rect(8, 5, 1, 1, P.woodLo).rect(11, 5, 1, 1, P.woodLo);
  img.ellipse(10, 18, 3.5, 3.5, P.teal).ellipse(10, 18, 2, 2, P.lime).rect(10, 18, 1, 1, P.redHi);
  return img.outline();
}

function logSeat(): Raster {
  const img = new Raster(22, 10);
  img.rect(3, 2, 16, 6, P.woodMid).rect(3, 2, 16, 2, P.wood).ellipse(3, 5, 2.5, 3.2, P.woodHi).ellipse(3, 5, 1, 1.5, P.woodLo);
  return img.outline();
}

// --- The arena -----------------------------------------------------------------

/**
 * The arena, in art pixels. Seen from above and in front, as the pack draws
 * its buildings: an oval of sand ringed by a low wall, six tiers of seats
 * rising behind it (deep at the back, foreshortened at the front), an outer
 * wall with a parapet, a canopied box at the back centre under the big crest
 * banner, gates east and west, and the main gate in the front wall facing the
 * town's avenue.
 *
 * Drawn in layers, because agents fight on the sand: arena.png is everything,
 * drawn under the fighters; arena-front.png is the front wall alone, drawn
 * over them; the crowd is two overlays, still and cheering.
 */
export const ARENA = { w: 330, h: 230, cx: 165, fy: 154, frx: 118, fry: 50 };
const OY = 36;
const TIERS = 6;
const tier = (k: number) => ({ rx: 121 + 6.5 * k, ry: 53 + 5 * k, cy: ARENA.fy - 4 * k });
const WALL = { rx: 164, ry: 86, cy: 94 + OY };

function ovalArena(): { back: Raster; front: Raster; crowd: [Raster, Raster] } {
  const { w, h, cx, fy, frx, fry } = ARENA;
  const img = new Raster(w, h);
  const rand = rng(7);

  // Shadow, the outer wall's face with its courses of stone, and its top.
  img.ellipse(cx, WALL.cy + 12, WALL.rx + 1, WALL.ry, hex("#000000", 70));
  img.ellipse(cx, WALL.cy + 9, WALL.rx, WALL.ry, P.stoneLo);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inEllipse(x, y, cx, WALL.cy + 9, WALL.rx, WALL.ry)) continue;
      if (y % 4 === 0) img.set(x, y, P.stoneDk);
      else if ((x + (Math.floor(y / 4) % 2) * 5) % 10 === 0) img.set(x, y, P.stoneDk);
    }
  }
  img.ellipse(cx, WALL.cy, WALL.rx, WALL.ry, P.stone);
  img.ellipse(cx, WALL.cy, WALL.rx - 3, WALL.ry - 2, P.stoneHi);
  img.ellipse(cx, WALL.cy + 1, WALL.rx - 5, WALL.ry - 4, P.stone);

  // The tiers, back to front: each one's riser, then its seats.
  for (let k = TIERS; k >= 1; k--) {
    const t = tier(k);
    img.ellipse(cx, t.cy - 3, t.rx, t.ry, P.stoneDk);
    img.ellipse(cx, t.cy, t.rx, t.ry, k % 2 ? P.woodMid : P.wood);
    img.ellipse(cx, t.cy, t.rx, t.ry - 0.6, k % 2 ? P.wood : P.woodHi);
    img.ellipse(cx, t.cy + 1, t.rx - 0.5, t.ry - 0.5, k % 2 ? P.woodMid : P.wood);
  }

  // Aisles: stairs of stone down through the seats.
  for (const angle of [-0.62, -0.32, 0.32, 0.62].map((a) => -Math.PI / 2 + a * Math.PI)) {
    const inner = { x: cx + Math.cos(angle) * (frx + 6), y: fy - 6 + Math.sin(angle) * (fry + 4) };
    const outer = { x: cx + Math.cos(angle) * (tier(TIERS).rx - 1), y: tier(TIERS).cy + Math.sin(angle) * (tier(TIERS).ry - 1) };
    for (let s = -1; s <= 1; s++) img.line(inner.x + s, inner.y, outer.x + s, outer.y, s === 0 ? P.stoneHi : P.stone);
  }

  // The low wall round the sand: its lip at the front, its lip and face at the back, then the sand.
  img.ellipse(cx, fy + 4, frx + 3, fry + 3, P.stone);
  img.ellipse(cx, fy - 7, frx + 4, fry + 3, P.stoneHi);
  img.ellipse(cx, fy - 4, frx + 3, fry + 1, P.stoneDk);
  for (let x = 0; x < w; x += 6) for (let y = fy - fry - 8; y < fy; y++) if (inEllipse(x, y, cx, fy - 4, frx + 3, fry + 1) && !inEllipse(x, y, cx, fy, frx, fry)) img.set(x, y, P.stoneDeep);
  for (let y = fy - fry; y <= fy + fry; y++) {
    for (let x = cx - frx; x <= cx + frx; x++) {
      if (!inEllipse(x, y, cx, fy, frx, fry)) continue;
      const n = rand();
      const block = (Math.floor(x / 2) * 73 + Math.floor(y / 2) * 151) % 13;
      img.set(x, y, n < 0.06 ? P.sandDk : block < 2 ? P.sandHi : block < 4 ? P.sandLo : P.sand);
    }
  }
  // The back wall's shadow on the sand.
  for (let y = fy - fry; y < fy; y++) {
    for (let x = cx - frx; x <= cx + frx; x++) {
      if (inEllipse(x, y, cx, fy, frx, fry) && !inEllipse(x, y - 5, cx, fy, frx, fry)) img.put(x, y, hex("#7a5a3a", 90));
    }
  }
  // A ring marked in the sand, and the crest painted in the middle of it.
  for (let a = 0; a < Math.PI * 2; a += 0.01) img.put(cx + Math.cos(a) * 44, fy + 2 + Math.sin(a) * 19, hex("#189b68", 120));
  const mark = crest(Math.min(48, Math.floor(32 * CREST.w / CREST.h)));
  img.blit(mark, cx - Math.round(mark.w / 2), fy + 2 - Math.round(mark.h / 2), 0.45);

  // Gates east and west: tunnels into the stands, a torch beside each.
  const torches: { x: number; y: number }[] = [];
  for (const side of [-1, 1]) {
    const gx = cx + side * (frx + 9);
    img.rect(gx - 6, fy - 22, 12, 22, P.stone).rect(gx - 6, fy - 22, 12, 2, P.stoneHi);
    img.rect(gx - 4, fy - 17, 8, 17, P.ink).ellipse(gx, fy - 17, 4, 3, P.ink);
    img.rect(gx - 4, fy - 4, 8, 4, P.sandLo);
    const tx = gx + side * 9;
    img.rect(tx, fy - 18, 2, 8, P.woodLo).rect(tx - 1, fy - 21, 4, 3, P.gold).rect(tx, fy - 23, 2, 2, P.redHi);
    torches.push({ x: tx + 1, y: fy - 22 });
  }

  // The parapet along the back of the outer wall.
  for (let x = 10; x < w - 10; x += 9) {
    const u = (x + 2 - cx) / WALL.rx;
    if (Math.abs(u) > 0.97) continue;
    const top = Math.round(WALL.cy - WALL.ry * Math.sqrt(1 - u * u));
    img.rect(x, top - 4, 5, 5, P.stone).rect(x, top - 4, 5, 1, P.stoneHi).rect(x + 4, top - 3, 1, 4, P.stoneLo);
  }

  // The box at the back centre: a striped canopy over the best seats.
  const box = { x: cx - 26, y: tier(TIERS).cy - tier(TIERS).ry + 4, w: 52 };
  img.rect(box.x + 2, box.y + 6, box.w - 4, 14, P.stoneDk).rect(box.x + 3, box.y + 7, box.w - 6, 12, P.deep);
  for (let x = 0; x < box.w; x++) {
    const c = Math.floor(x / 4) % 2 ? P.gold : P.teal;
    img.rect(box.x + x, box.y, 1, 6, c);
    if (x % 4 < 2) img.set(box.x + x, box.y + 6, c);
  }
  img.rect(box.x, box.y, box.w, 1, P.goldHi);
  for (const x of [box.x + 2, box.x + box.w - 4]) img.rect(x, box.y + 6, 2, 14, P.gold);

  // Banners on the parapet; the great crest banner over the box.
  for (const u of [-0.8, -0.5, 0.5, 0.8]) {
    const x = Math.round(cx + u * WALL.rx);
    const top = Math.round(WALL.cy - WALL.ry * Math.sqrt(1 - u * u));
    img.blit(banner(P.teal, P.dteal, P.gold, 14, 22), x - 10, top - 34);
  }
  const great = banner(P.teal, P.dteal, P.gold, 30, 30);
  img.blit(great, cx - Math.floor(great.w / 2), 0);

  // The front: the main gate through the front wall, paved like the road, pillars and banners either side.
  const gateTop = fy + fry - 2;
  const gateBottom = WALL.cy + WALL.ry + 9;
  for (let y = gateTop; y <= gateBottom; y++) {
    for (let x = cx - 12; x <= cx + 12; x++) {
      if (y > gateTop + 2 || inEllipse(x, y, cx, fy, frx, fry)) img.set(x, y, Math.abs(x - cx) > 10 ? P.road : P.roadIn);
    }
  }
  for (const side of [-1, 1]) {
    const px = cx + side * 15 - (side < 0 ? 5 : 0);
    img.rect(px, gateBottom - 30, 6, 31, P.stone).rect(px, gateBottom - 30, 6, 2, P.stoneHi).rect(px + (side < 0 ? 0 : 5), gateBottom - 28, 1, 29, P.stoneDk);
    img.rect(px - 1, gateBottom - 33, 8, 3, P.gold).rect(px + 1, gateBottom - 36, 4, 3, P.redHi);
    torches.push({ x: px + 3, y: gateBottom - 35 });
    img.blit(banner(P.teal, P.dteal, P.gold, 10, 14), px + (side < 0 ? -14 : 8), gateBottom - 30);
  }
  img.outline();

  // The front wall alone: everything in front of the sand and south of its middle.
  const front = new Raster(w, h);
  for (let y = fy; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inEllipse(x, y, cx, fy, frx, fry)) continue;
      if (Math.abs(x - cx) <= 10 && y < gateBottom - 34) continue;
      const c = img.get(x, y);
      if (c[3] > 0) front.set(x, y, c);
    }
  }

  // The crowd: on every tier at the back and the sides, still and then cheering.
  const still = new Raster(w, h);
  const cheer = new Raster(w, h);
  const seat = rng(11);
  const aisles = [-0.62, -0.32, 0.32, 0.62].map((a) => -Math.PI / 2 + a * Math.PI);
  for (let k = 1; k <= TIERS; k++) {
    const t = tier(k);
    const inner = tier(k - 1);
    for (let a = Math.PI * 0.98; a < Math.PI * 2.02; a += 4.6 / t.rx) {
      const x = Math.round(cx + Math.cos(a) * (t.rx - 3.5));
      const y = Math.round(t.cy + Math.sin(a) * (t.ry - 3));
      if (y > fy - 6) continue;
      if (k > 0 && inEllipse(x, y, cx, inner.cy, inner.rx, inner.ry) && k > 1) continue;
      if (aisles.some((b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 5 / t.rx)) continue;
      if (x > box.x - 1 && x < box.x + box.w + 1 && y < box.y + 21) continue;
      if (Math.abs(x - cx) > frx && Math.abs(y - (fy - 12)) < 14) continue;
      if (seat() < 0.22) continue;
      const shirt = WEAR[Math.floor(seat() * WEAR.length)]!;
      const skin = SKIN[Math.floor(seat() * SKIN.length)]!;
      const shade: RGBA = [Math.round(shirt[0] * 0.7), Math.round(shirt[1] * 0.7), Math.round(shirt[2] * 0.7), 255];
      still.rect(x - 1, y - 1, 3, 2, shirt).rect(x - 1, y + 1, 3, 1, shade).rect(x, y - 3, 2, 2, skin);
      const up = seat() < 0.5;
      const hop = up && seat() < 0.5 ? 1 : 0;
      cheer.rect(x - 1, y - 1 - hop, 3, 2, shirt).rect(x - 1, y + 1 - hop, 3, 1, shade).rect(x, y - 3 - hop, 2, 2, skin);
      if (up) cheer.rect(x - 2, y - 4 - hop, 1, 2, skin).rect(x + 2, y - 4 - hop, 1, 2, skin);
    }
  }
  writeFileSync(join(out, "arena-torches.json"), JSON.stringify(torches));
  return { back: img, front, crowd: [still, cheer] };
}

// --- The Launch Pad ------------------------------------------------------------------

/**
 * The Launch Pad, where tokens are launched (web/lib/launchpad.ts): a round
 * pad of the pack's teal stone ringed in gold, a wooden gantry beside it, and
 * on it a rocket built as the village would build one - planks bound in gold,
 * teal fins, the crest on its side. Two frames, its flame low and high, played
 * slowly as the leaderboard is.
 */
const LAUNCH = { w: 64, h: 86 };

function launchPadFrame(high: boolean): Raster {
  const img = new Raster(LAUNCH.w, LAUNCH.h);
  const cx = 36;

  // The pad: its stone edge, its top, a gold ring and the scorched middle.
  img.ellipse(32, 76, 30, 9, P.stoneDk);
  img.ellipse(32, 73, 30, 8.5, P.stone);
  img.ellipse(32, 72, 28, 7, P.stoneHi);
  img.ellipse(32, 73, 25, 6, P.stone);
  img.ellipse(cx, 73, 15, 4.2, P.gold);
  img.ellipse(cx, 73, 13, 3.4, P.stoneLo);
  img.ellipse(cx, 73, 8, 2.2, P.stoneDeep);

  // The gantry: two posts, braces between them, an arm out to the rocket.
  for (const x of [4, 13]) img.rect(x, 12, 3, 62, P.woodMid).rect(x, 12, 1, 62, P.woodHi);
  for (let y = 18; y < 68; y += 12) {
    img.line(6, y, 13, y + 10, P.woodLo).line(13, y, 6, y + 10, P.woodLo);
    img.rect(4, y, 12, 2, P.wood);
  }
  img.rect(3, 10, 14, 3, P.woodLo).rect(3, 10, 14, 1, P.woodHi);
  img.rect(16, 30, cx - 24, 2, P.wood).rect(16, 30, cx - 24, 1, P.woodHi);
  // A pennant of the crest's teal on the gantry.
  img.rect(5, 2, 1, 9, P.woodLo).rect(6, 2, 7, 4, P.lime).rect(6, 4, 5, 2, P.green);

  // Fins, behind the body.
  for (let y = 0; y <= 14; y++) {
    const reach = Math.round((y / 14) * 7);
    img.rect(cx - 8 - reach, 50 + y, reach, 1, y > 11 ? P.dteal : P.teal);
    img.rect(cx + 8, 50 + y, reach, 1, y > 11 ? P.deep : P.dteal);
  }

  // The body: planks, lit from the left, bound in gold.
  img.rect(cx - 8, 18, 16, 46, P.wood);
  img.rect(cx - 8, 18, 3, 46, P.woodHi);
  img.rect(cx + 4, 18, 4, 46, P.woodMid);
  img.rect(cx + 7, 18, 1, 46, P.woodLo);
  for (const x of [cx - 3, cx + 2]) img.rect(x, 18, 1, 46, P.woodMid);
  for (const y of [20, 46, 60]) img.rect(cx - 8, y, 16, 2, P.gold).rect(cx - 8, y, 16, 1, P.goldHi);
  // A porthole with the crest in it.
  img.ellipse(cx, 33, 6.5, 6.5, P.goldLo).ellipse(cx, 33, 5.5, 5.5, P.navy);
  const c = crest(10);
  img.blit(c, cx - 5, 33 - Math.round(c.h / 2));

  // The nose: red, lit on the left.
  for (let y = 4; y <= 18; y++) {
    const half = Math.round(((y - 4) / 14) * 8);
    img.rect(cx - half, y, half * 2, 1, P.red);
    img.rect(cx - half, y, Math.max(1, Math.round(half / 2)), 1, P.redHi);
  }
  img.rect(cx - 1, 2, 2, 3, P.gold);

  // The nozzle, and the flame under it.
  img.rect(cx - 5, 64, 10, 3, P.stoneDk).rect(cx - 5, 64, 10, 1, P.stoneLo);
  const flame = high ? 13 : 8;
  for (let y = 0; y < flame; y++) {
    const half = Math.max(1, Math.round((high ? 6 : 5) * (1 - (y / flame) ** 1.5)));
    img.rect(cx - half, 67 + y, half * 2, 1, y < 2 ? P.glow : y < flame - 2 ? P.gold : P.redHi);
  }
  // Smoke rolling out over the pad when the flame is high.
  if (high) {
    for (const [x, y, r] of [
      [cx - 13, 73, 3.5],
      [cx + 13, 73, 3.5],
      [cx - 19, 71, 2.5],
      [cx + 19, 71, 2.5],
    ] as const) img.ellipse(x, y, r, r * 0.8, hex("#f5ecd8", 220));
  }
  return img.outline();
}

function launchPadSheet(): Raster {
  const sheet = new Raster(LAUNCH.w * 2, LAUNCH.h);
  sheet.blit(launchPadFrame(false), 0, 0).blit(launchPadFrame(true), LAUNCH.w, 0);
  return sheet;
}

// --- New Town --------------------------------------------------------------------

/**
 * New Town's buildings, between the ring roads (web/app/village/game/growth.ts):
 * glass, flat roofs, screens and lamps, drawn at the pack's pixel size in its
 * outline and light, so they stand in the same world as Old Town's thatch.
 */
const M = {
  roof: hex("#3d434c"),
  roofHi: hex("#565d68"),
  wall: hex("#d9d4c7"),
  wallLo: hex("#b5afa1"),
  wallDk: hex("#8d877b"),
  concrete: hex("#9aa0a8"),
  concreteLo: hex("#747a83"),
  glass: hex("#5fb3c9"),
  glassHi: hex("#a9e3ef"),
  glassLo: hex("#3d7f99"),
  frame: hex("#2b3038"),
  door: hex("#2f3a46"),
};

/** A run of windows: glass with a lit pane and a frame round each. */
function windows(img: Raster, x: number, y: number, n: number, w: number, h: number, gap: number, lit = 1): void {
  for (let i = 0; i < n; i++) {
    const wx = x + i * (w + gap);
    img.rect(wx, y, w, h, M.frame).rect(wx + 1, y + 1, w - 2, h - 2, M.glass).rect(wx + 1, y + 1, w - 2, 1, M.glassHi);
    if ((i + lit) % 3 === 0) img.rect(wx + 1, y + 1, w - 2, h - 2, hex("#f3d98a"));
  }
}

/** A flat roof with a parapet, over a wall `w` wide. */
function flatRoof(img: Raster, x: number, y: number, w: number): void {
  img.rect(x - 1, y, w + 2, 4, M.roof).rect(x - 1, y, w + 2, 1, M.roofHi);
}

type ModernRole = "home" | "hiring" | "strategy" | "games" | "fame" | "treasury" | "lookout" | "rulebook";

/** Contemporary villas and civic houses, in the village's pixel scale:
 * limestone, timber cladding, glass balconies and planted roof terraces.
 * Their front doors stay at the centre of the original building plots. */
function modernVillageHouse(role: ModernRole, accent: RGBA = P.dteal, variant = "blue"): Raster {
  const img = new Raster(128, 144);
  const ivory = hex("#eee7d5"), wall = hex("#cec9b8"), shade = hex("#9fa596");
  const ink = hex("#263a3d"), copper = hex("#b77b4a"), brick = hex("#b5765b");
  const polygon = (points: [number, number][], colour: RGBA) => {
    for (let y = Math.min(...points.map((p) => p[1])); y <= Math.max(...points.map((p) => p[1])); y++) {
      const hits: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i]!, [bx, by] = points[(i + 1) % points.length]!;
        if ((ay <= y && by > y) || (by <= y && ay > y)) hits.push(ax + (y - ay) * (bx - ax) / (by - ay));
      }
      hits.sort((a, b) => a - b);
      for (let i = 1; i < hits.length; i += 2) img.line(Math.ceil(hits[i - 1]!), y, Math.floor(hits[i]!), y, colour);
    }
  };
  const box = (x: number, y: number, w: number, h: number, colour = ivory) => {
    polygon([[x + w, y], [x + w + 9, y - 8], [x + w + 9, y + h - 8], [x + w, y + h]], shade);
    img.rect(x, y, w, h, colour).rect(x, y, 3, h, ivory);
    polygon([[x - 2, y], [x + 7, y - 9], [x + w + 10, y - 9], [x + w + 1, y]], M.roof);
    img.line(x - 2, y, x + w + 1, y, wall);
  };
  const glass = (x: number, y: number, w: number, h: number, panes = 3) => {
    img.rect(x, y, w, h, ink).rect(x + 2, y + 2, w - 4, h - 4, M.glassLo);
    polygon([[x + 3, y + 3], [x + w - 4, y + 3], [x + 3, y + h - 4]], M.glass);
    img.line(x + 3, y + 3, x + w - 4, y + 3, M.glassHi);
    for (let i = 1; i < panes; i++) img.rect(x + Math.round(w * i / panes), y + 1, 1, h - 2, ink);
  };
  const door = (y = 113) => {
    glass(56, y, 17, 136 - y, 2);
    img.rect(54, y - 3, 21, 3, accent).rect(69, y + 12, 1, 3, P.goldHi);
    img.rect(51, 136, 27, 2, shade).rect(48, 138, 33, 3, wall).rect(45, 141, 39, 2, ivory);
  };
  const plant = (x: number, y: number, size = 6) => {
    img.rect(x - 6, y - 5, 12, 6, shade).rect(x - 5, y - 5, 10, 1, ivory);
    img.ellipse(x, y - 9, size, 5, hex("#335b3f")).ellipse(x - 2, y - 12, size - 2, 3, hex("#6a964e"));
  };
  const solar = (x: number, y: number, w: number) => {
    img.rect(x, y, w, 8, ink);
    for (let dx = 2; dx < w - 2; dx += 6) img.rect(x + dx, y + 1, 4, 6, M.glassLo).rect(x + dx, y + 1, 4, 1, M.glassHi);
  };
  img.ellipse(65, 136, 57, 6, hex("#152c21", 70));

  if (role === "hiring") {
    // Wide, single-storey welcome pavilion under a folded butterfly roof.
    box(10, 79, 103, 57, ivory);
    glass(17, 84, 91, 38, 7);
    polygon([[5, 70], [23, 53], [65, 68], [116, 51], [121, 68], [64, 80]], ink);
    polygon([[8, 68], [24, 55], [65, 70], [116, 54], [117, 64], [64, 75]], hex("#688b7d"));
    img.rect(14, 78, 3, 57, wall).rect(108, 76, 3, 59, wall);
    img.rect(21, 123, 29, 7, hex("#5c8550")).rect(78, 123, 28, 7, hex("#5c8550"));
    // The recruitment display: a visible roster, rather than a generic lobby.
    for (const [i, x] of [24, 39, 84, 99].entries()) {
      img.rect(x - 5, 91, 10, 19, P.deep);
      tinyAgent(img, x, 104, SKIN[i % SKIN.length]!, WEAR[i + 2]!);
      img.rect(x - 3, 108, 6, 1, P.gold);
    }
    door(106); plant(23, 135); plant(102, 135);
  } else if (role === "strategy") {
    // An L-shaped laboratory: tall glass tower and a low planted wing.
    box(13, 39, 44, 97, hex("#bacfd0"));
    glass(19, 45, 34, 74, 3);
    for (const y of [69, 94]) img.rect(18, y, 36, 3, ivory);
    box(54, 86, 56, 50, ivory);
    solar(25, 31, 28); plant(94, 78);
    glass(80, 94, 23, 28, 2);
    img.rect(79, 126, 27, 5, ink);
    // A branching decision tree on the lab's planning screen.
    img.rect(78, 96, 28, 29, P.deep);
    img.line(92, 103, 84, 112, P.lime).line(92, 103, 100, 112, P.lime);
    img.line(84, 112, 82, 120, P.lime).line(100, 112, 102, 120, P.lime);
    for (const [x, y] of [[92, 103], [84, 112], [100, 112], [82, 120], [102, 120]]) img.rect(x! - 2, y! - 2, 4, 4, P.gold);
    door(106); plant(23, 135);
  } else if (role === "games") {
    // Low charcoal entertainment hall, a sloping roof and a giant LED facade.
    box(8, 72, 104, 64, hex("#3d4b55"));
    polygon([[5, 68], [21, 59], [111, 40], [120, 53], [114, 72]], ink);
    polygon([[10, 65], [23, 61], [109, 44], [116, 52], [111, 66]], hex("#586b7b"));
    img.line(10, 69, 113, 70, P.teal).line(10, 71, 113, 72, P.glow);
    img.rect(17, 80, 87, 33, P.ink).rect(20, 83, 81, 27, P.deep);
    // A game controller on the giant display, with tournament lights beside it.
    img.ellipse(65, 97, 18, 8, M.glassHi).ellipse(51, 100, 6, 8, M.glassHi).ellipse(79, 100, 6, 8, M.glassHi);
    img.rect(50, 93, 3, 10, ink).rect(47, 97, 9, 3, ink);
    img.ellipse(75, 94, 2, 2, P.redHi).ellipse(81, 98, 2, 2, P.gold);
    for (let x = 24; x < 43; x += 4) img.rect(x, 102 - x % 3 * 4, 2, 4 + x % 3 * 4, P.green);
    for (let x = 86; x < 99; x += 4) img.rect(x, 89, 2, 15, P.gold);
    glass(19, 117, 27, 13); glass(83, 117, 21, 13);
    door(117);
  } else if (role === "fame") {
    // A circular glass museum crowned by a broad copper dome.
    img.ellipse(64, 129, 51, 8, shade).rect(14, 70, 99, 58, wall);
    for (let x = 22; x < 110; x += 13) glass(x, 75, 10, 41, 1);
    img.ellipse(64, 68, 53, 13, copper).ellipse(64, 61, 49, 23, P.goldLo);
    img.ellipse(64, 57, 45, 22, hex("#c79757")).ellipse(64, 53, 33, 17, hex("#d8b778"));
    for (const x of [36, 49, 79, 92]) img.line(x, 41 + Math.abs(x - 64) / 3, x, 67, hex("#a27641"));
    img.rect(61, 28, 6, 10, P.gold).ellipse(64, 28, 4, 3, P.goldHi);
    img.ellipse(64, 70, 53, 6, ink).ellipse(64, 68, 53, 3, ivory);
    img.rect(49, 79, 30, 25, P.deep).blit(scaled(trophy(), 19), 55, 79);
    door(113); plant(23, 135); plant(104, 135);
  } else if (role === "treasury") {
    // Solid bank: a stepped limestone roof and monumental gold-edged piers.
    box(13, 52, 97, 84, hex("#a8aeaa"));
    box(25, 35, 73, 17, wall); box(40, 24, 45, 11, ivory);
    glass(20, 66, 83, 44, 7);
    for (const x of [19, 42, 83, 103]) {
      img.rect(x - 4, 58, 9, 71, ivory).rect(x + 2, 60, 2, 67, P.goldLo);
      img.rect(x - 6, 56, 13, 4, wall).rect(x - 6, 127, 13, 5, wall);
    }
    img.rect(46, 46, 34, 6, P.gold).rect(48, 46, 30, 1, P.goldHi);
    // A round steel vault above the entrance, and stacked bullion on the roof.
    img.ellipse(64, 87, 18, 19, ink).ellipse(64, 86, 15, 16, M.concrete);
    img.ellipse(64, 86, 12, 13, M.concreteLo).ellipse(64, 86, 6, 6, P.silver);
    img.line(57, 86, 71, 86, ink).line(64, 79, 64, 93, ink);
    for (const [x, y] of [[44, 18], [59, 18], [74, 18], [53, 12], [68, 12]]) {
      img.rect(x!, y!, 12, 6, P.goldLo).rect(x!, y!, 12, 2, P.goldHi);
    }
    door(113);
  } else if (role === "lookout") {
    // A narrow observation tower, with a panoramic round deck and a mast.
    box(47, 51, 32, 85, ivory); glass(53, 58, 19, 55, 2);
    for (const y of [77, 96]) img.rect(49, y, 28, 3, ivory);
    img.ellipse(64, 48, 39, 9, shade).rect(26, 28, 76, 20, ink);
    for (let x = 30; x < 100; x += 12) glass(x, 30, 10, 16, 1);
    img.ellipse(64, 27, 43, 10, ink).ellipse(64, 24, 40, 9, M.glassLo);
    img.ellipse(64, 23, 29, 5, hex("#8bbab6"));
    img.rect(62, 5, 3, 19, ink).rect(60, 5, 7, 2, P.gold);
    img.line(53, 13, 73, 13, M.frame).ellipse(77, 17, 6, 3, M.glassHi);
    door(114); plant(42, 135); plant(86, 135);
  } else if (role === "rulebook") {
    // A terracotta library, staggered masses and three sawtooth skylights.
    box(19, 60, 86, 76, brick);
    for (let y = 65; y < 132; y += 6) {
      img.line(23, y, 101, y, hex("#98634b"));
      for (let x = 25 + (y % 12 ? 4 : 0); x < 103; x += 10) img.line(x, y, x, y + 5, hex("#c99370"));
    }
    for (const x of [20, 48, 76]) {
      polygon([[x - 3, 59], [x + 21, 31], [x + 25, 59]], ink);
      polygon([[x + 3, 53], [x + 20, 35], [x + 21, 53]], M.glass);
      img.line(x + 4, 55, x + 23, 55, ivory);
    }
    glass(27, 77, 20, 49, 1); glass(83, 77, 15, 49, 1);
    for (let y = 85; y < 125; y += 10) {
      img.rect(29, y, 16, 2, copper);
      for (let x = 30; x < 44; x += 4) img.rect(x, y - 6, 2, 6, x % 3 ? P.paper : P.teal);
    }
    img.rect(51, 72, 27, 20, ink).rect(53, 75, 10, 13, P.paper).rect(65, 75, 10, 13, P.thatch);
    img.line(64, 74, 64, 90, P.gold);
    door(111); plant(108, 134);
  } else {
    // Four homes have different rooflines and floor plans, not just colours.
    if (variant === "blue") {
      box(28, 58, 67, 78, ivory);
      polygon([[20, 60], [64, 22], [108, 60]], ink);
      polygon([[28, 56], [64, 28], [100, 56]], hex("#446e86"));
      glass(40, 68, 46, 23, 3); glass(35, 106, 15, 21, 1); glass(81, 106, 12, 21, 1);
      img.rect(34, 96, 58, 3, accent); door(110);
    } else if (variant === "red") {
      box(12, 91, 100, 45, hex("#e3d9c8"));
      polygon([[7, 88], [23, 70], [118, 70], [114, 88]], copper);
      img.rect(7, 88, 107, 4, brick);
      glass(20, 101, 29, 25, 2); glass(83, 101, 24, 25, 2);
      for (let x = 82; x < 112; x += 7) img.rect(x, 75, 3, 10, ivory);
      plant(36, 81); door(106);
    } else if (variant === "yellow") {
      box(14, 50, 49, 86, wall); box(61, 85, 47, 51, ivory);
      glass(21, 58, 35, 28, 2); glass(23, 99, 25, 25, 2);
      glass(84, 96, 18, 28, 1); solar(26, 42, 31);
      for (let x = 69; x < 112; x += 6) img.rect(x, 67, 2, 18, copper);
      for (let y = 66; y < 82; y += 5) img.rect(68, y, 45, 2, copper);
      door(110);
    } else {
      box(39, 30, 49, 106, hex("#d3cdc5"));
      for (const y of [40, 71, 101]) {
        glass(47, y, 33, 21, 3);
        img.rect(35, y + 22, 57, 7, accent).rect(35, y + 21, 57, 1, ivory);
        for (const x of [37, 50, 63, 76, 90]) img.rect(x, y + 22, 1, 6, ink);
      }
      solar(52, 22, 30); door(114);
    }
    plant(25, 135); plant(104, 135);
  }
  return img.outline(hex("#253630"));
}

function modernVilla(accent: RGBA, variant: string): Raster {
  // Match the old cottage sheet's canvas and foot, preserving its plot size.
  return new Raster(128, 192).blit(modernVillageHouse("home", accent, variant), 0, 28);
}

function modernOffice(): Raster {
  const img = new Raster(56, 74);
  img.rect(6, 12, 44, 62, M.concrete).rect(6, 12, 3, 62, M.wall).rect(47, 12, 3, 62, M.concreteLo);
  flatRoof(img, 6, 8, 44);
  // A glass front: three floors of curtain wall.
  for (const y of [16, 30, 44]) windows(img, 10, y, 4, 8, 11, 2, y / 2);
  // A screen over the door with the crest's green on it.
  img.rect(14, 57, 28, 6, M.frame).rect(15, 58, 26, 4, P.teal).rect(17, 59, 8, 2, P.lime).rect(28, 59, 10, 2, P.glow);
  img.rect(23, 64, 10, 10, M.door).rect(24, 65, 8, 9, M.glassLo).rect(28, 65, 1, 9, M.frame);
  // A dish on the roof.
  img.rect(38, 4, 6, 4, M.concreteLo).rect(40, 2, 2, 3, M.roofHi);
  return img.outline();
}

function modernHouse(accent: RGBA): Raster {
  const img = new Raster(54, 50);
  img.rect(4, 14, 46, 36, M.wall).rect(4, 14, 3, 36, hex("#ece8dd")).rect(47, 14, 3, 36, M.wallLo);
  flatRoof(img, 4, 10, 46);
  // A wide window and a door under an awning in its own colour.
  windows(img, 8, 20, 2, 12, 10, 2);
  img.rect(34, 18, 13, 3, accent).rect(34, 21, 13, 1, M.wallDk);
  img.rect(36, 24, 9, 26, M.door).rect(37, 25, 7, 6, M.glassLo).rect(43, 37, 1, 1, P.gold);
  img.rect(8, 34, 24, 6, accent).rect(8, 40, 24, 1, M.wallDk);
  img.rect(10, 42, 4, 8, M.concreteLo).rect(24, 42, 4, 8, M.concreteLo);
  // Solar panels on the roof.
  img.rect(10, 6, 14, 4, M.glassLo).rect(11, 7, 12, 1, M.glass);
  return img.outline();
}

function modernShop(): Raster {
  const img = new Raster(58, 54);
  img.rect(4, 14, 50, 40, M.wall).rect(4, 14, 3, 40, hex("#ece8dd")).rect(51, 14, 3, 40, M.wallLo);
  flatRoof(img, 4, 10, 50);
  // A lit sign board along the top.
  img.rect(8, 15, 42, 8, M.frame).rect(9, 16, 40, 6, P.navy);
  for (let x = 11; x < 47; x += 4) img.rect(x, 18, 2, 2, x % 8 === 3 ? P.glow : P.lime);
  // Shop windows either side of the door, and a striped awning over them.
  for (let x = 6; x < 52; x += 4) img.rect(x, 25, 4, 4, (x / 4) % 2 ? P.teal : P.white);
  windows(img, 8, 30, 2, 14, 14, 2);
  img.rect(40, 30, 10, 24, M.door).rect(41, 31, 8, 22, M.glassLo).rect(45, 31, 1, 22, M.frame);
  return img.outline();
}

function modernApartments(): Raster {
  const img = new Raster(60, 86);
  img.rect(6, 10, 48, 76, M.wallLo).rect(6, 10, 3, 76, M.wall).rect(51, 10, 3, 76, M.wallDk);
  flatRoof(img, 6, 6, 48);
  for (const y of [14, 28, 42, 56]) {
    windows(img, 10, y, 4, 8, 9, 2, y);
    // Balconies.
    img.rect(9, y + 10, 42, 2, M.concreteLo).rect(9, y + 10, 42, 1, M.concrete);
  }
  img.rect(24, 72, 12, 14, M.door).rect(25, 73, 10, 13, M.glassLo).rect(30, 73, 1, 13, M.frame);
  img.rect(22, 69, 16, 3, P.teal);
  return img.outline();
}

function modernKiosk(): Raster {
  const img = new Raster(38, 42);
  img.rect(4, 16, 30, 26, M.concrete).rect(4, 16, 3, 26, M.wall).rect(31, 16, 3, 26, M.concreteLo);
  // A curved glass canopy and a screen.
  img.rect(1, 10, 36, 6, M.glassLo).rect(2, 11, 34, 2, M.glass).rect(2, 11, 34, 1, M.glassHi);
  img.rect(8, 20, 22, 10, M.frame).rect(9, 21, 20, 8, P.teal).rect(11, 23, 6, 2, P.glow).rect(19, 23, 8, 2, P.lime).rect(11, 26, 14, 1, P.white);
  img.rect(10, 32, 18, 3, M.wallDk).rect(10, 32, 18, 1, M.wall);
  return img.outline();
}

/** A street lamp: a slim pole, a lit head. */
function modernLamp(): Raster {
  const img = new Raster(10, 38);
  img.rect(4, 6, 2, 30, M.frame).rect(2, 35, 6, 3, M.concreteLo);
  img.rect(1, 2, 8, 4, M.roof).rect(2, 5, 6, 2, P.glow).rect(3, 7, 4, 1, hex("#f3d98a", 160));
  return img.outline();
}

function modernPlanter(): Raster {
  const img = new Raster(22, 14);
  img.rect(1, 7, 20, 7, M.concrete).rect(1, 7, 20, 1, M.wall).rect(1, 13, 20, 1, M.concreteLo);
  for (const [x, y, c] of [
    [3, 3, P.green],
    [8, 1, P.teal],
    [13, 3, P.green],
    [17, 2, P.lime],
  ] as const) img.ellipse(x + 2, y + 3, 3, 3, c);
  return img.outline();
}

/**
 * The bazaar: three market stalls under striped awnings, crates and a lit
 * screen of the tokens on show. It leads to /explore; it may also become the
 * venue for Negotiation later.
 */
function bazaar(): Raster {
  const img = new Raster(98, 62);
  const stall = (x: number, y: number, a: RGBA, b: RGBA) => {
    // Posts, a counter, goods, and a striped awning.
    img.rect(x + 2, y + 12, 2, 20, P.woodLo).rect(x + 26, y + 12, 2, 20, P.woodLo);
    img.rect(x, y + 22, 30, 10, P.wood).rect(x, y + 22, 30, 1, P.woodHi).rect(x, y + 31, 30, 1, P.woodLo);
    for (let i = 0; i < 4; i++) img.ellipse(x + 5 + i * 7, y + 20, 2.5, 2, [P.redHi, P.gold, P.lime, P.paper][(i + x) % 4]!);
    for (let i = 0; i < 6; i++) img.rect(x - 2 + i * 6, y + 4, 6, 8, i % 2 ? a : b);
    img.rect(x - 2, y + 11, 34, 1, P.woodLo);
    for (let i = 0; i < 6; i++) img.rect(x - 2 + i * 6, y + 12, 6, 2, i % 2 ? a : b);
  };
  stall(4, 22, P.teal, P.white);
  stall(64, 22, P.red, P.white);
  stall(34, 4, P.gold, P.white);
  // A lit board of the tokens on show, between the front two.
  img.rect(40, 40, 18, 12, P.woodLo).rect(41, 41, 16, 10, P.navy);
  for (let i = 0; i < 3; i++) img.rect(43, 43 + i * 3, 4 + i * 3, 2, [P.lime, P.glow, P.teal][i]!);
  img.rect(48, 52, 2, 10, P.woodLo);
  // Crates and a sack.
  img.rect(2, 52, 8, 8, P.woodMid).rect(2, 52, 8, 1, P.woodHi).rect(88, 52, 8, 8, P.woodMid).rect(88, 52, 8, 1, P.woodHi);
  img.ellipse(84, 57, 3.5, 3, P.thatch);
  return img.outline();
}

/** The pier on the small lake: planks from the shore out over the water, posts down its sides. */
function pier(): Raster {
  const img = new Raster(24, 60);
  img.rect(4, 0, 16, 56, P.wood);
  for (let y = 2; y < 56; y += 4) img.rect(4, y, 16, 1, P.woodMid);
  img.rect(4, 0, 1, 56, P.woodHi);
  for (const y of [14, 30, 46]) img.rect(1, y, 4, 8, P.woodLo).rect(19, y, 4, 8, P.woodLo);
  img.rect(1, 54, 22, 6, P.woodLo);
  return img.outline();
}

// --- The pack's buildings, in the crest's colours --------------------------------

/** A flag's blue turned the crest's teal, its gold emblem the crest's green. */
function recolourFlag(img: Raster, box: { x0: number; y0: number; x1: number; y1: number }): void {
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const [r, g, b, a] = img.get(x, y);
      if (a < 100) continue;
      const lum = (r + g + b) / 3;
      if (b > r + 25 && b > 80) img.set(x, y, lum > 110 ? P.teal : lum > 70 ? P.dteal : P.deep);
      else if (r > 160 && g > 110 && b < 120) img.set(x, y, r > 220 ? P.glow : P.green);
    }
  }
}

/** The castle, for the Strategy Lab: its flag in the crest's colours and the crest over its gate. */
function strategyLab(): Raster {
  const img = readPng(join(pub, "village/buildings/Castle.png"));
  recolourFlag(img, { x0: 199, y0: 6, x1: 232, y1: 31 });
  const c = crest(30);
  img.blit(c, 200 - 15, 186);
  return img;
}

function lookout(): Raster {
  const img = readPng(join(pub, "village/buildings/Tower.png"));
  recolourFlag(img, { x0: 96, y0: 26, x1: 140, y1: 63 });
  return img;
}

/**
 * The old arena hut, for the Game Hall: its "ARENA" sign becomes a screen with
 * a match on it, and the crest goes up on its gable.
 */
function gameHall(): Raster {
  const img = readPng(join(pub, "village/buildings/Arena.png"));
  const s = { x: 180, y: 270, w: 61, h: 22 };
  img.rect(s.x, s.y, s.w, s.h, P.ink).rect(s.x + 1, s.y + 1, s.w - 2, s.h - 2, P.teal).rect(s.x + 3, s.y + 3, s.w - 6, s.h - 6, hex("#0a2a2a"));
  img.rect(s.x + 10, s.y + 6, 6, 6, SKIN[0]!).rect(s.x + 8, s.y + 12, 10, 5, WEAR[3]!);
  img.rect(s.x + 45, s.y + 6, 6, 6, SKIN[2]!).rect(s.x + 43, s.y + 12, 10, 5, WEAR[4]!);
  img.rect(s.x + 28, s.y + 9, 5, 5, P.glow).rect(s.x + 26, s.y + 11, 9, 1, P.gold).rect(s.x + 30, s.y + 7, 1, 9, P.gold);
  img.rect(s.x + 22, s.y + 4, 3, 3, P.redHi);
  const c = crest(40);
  img.blit(c, 160 - 20, 205);
  return img;
}

// --- Out ---------------------------------------------------------------------

/** The reference's walled courtyard: tiers on three sides and a broad south
 * gate. It keeps the original sand coordinates, so the live match, route
 * through the gate and layered cheering crowd all stay in the same place. */
function arena(): { back: Raster; front: Raster; crowd: [Raster, Raster] } {
  const { w, h, cx, fy, frx, fry } = ARENA;
  const img = new Raster(w, h), front = new Raster(w, h);
  const still = new Raster(w, h), cheer = new Raster(w, h);
  const rand = rng(71);
  const stone = hex("#99998b"), hi = hex("#d3c9a8"), dark = hex("#505b57"), shade = hex("#727b72");
  const block = (x: number, y: number, width: number, height: number) => {
    img.rect(x, y, width, height, dark).rect(x + 2, y + 1, width - 4, height - 2, stone);
    for (let yy = y + 1; yy < y + height - 2; yy += 5) {
      img.line(x + 2, yy, x + width - 3, yy, shade);
      for (let xx = x + 2 + (Math.floor(yy / 5) % 2) * 5; xx < x + width - 2; xx += 10) img.line(xx, yy, xx, yy + 4, shade);
    }
    img.rect(x + 1, y, width - 2, 2, hi).rect(x + width - 3, y + 2, 2, height - 2, shade);
  };
  img.rect(12, 44, w - 20, 182, hex("#142d23", 85));
  block(12, 40, 306, 177);
  img.rect(24, 46, 282, 159, P.woodLo);
  // Six galleries, inlaid rails and stairs running down each side.
  for (let k = 0; k < 6; k++) {
    const y = 48 + k * 9;
    img.rect(31, y, 268, 8, k % 2 ? P.wood : P.woodMid);
    img.rect(31, y, 268, 1, P.gold).rect(31, y + 6, 268, 2, dark);
    for (let x = 36; x < 295; x += 7) {
      if (Math.abs(x - cx) < 29 && k < 3) continue;
      const skin = SKIN[Math.floor(rand() * SKIN.length)]!, wear = WEAR[Math.floor(rand() * WEAR.length)]!;
      still.rect(x, y + 2, 3, 3, wear).rect(x + 1, y, 2, 2, skin);
      cheer.rect(x, y + 1, 3, 3, wear).rect(x + 1, y - 1, 2, 2, skin).rect(x - 1, y - 1, 1, 2, skin);
    }
  }
  for (const x of [27, 300]) {
    for (let y = 105; y < 204; y += 8) {
      img.rect(x - 5, y, 15, 7, P.wood).rect(x - 5, y, 15, 1, P.goldLo).rect(x - 5, y + 6, 15, 1, dark);
      still.rect(x, y + 2, 3, 3, WEAR[Math.floor(rand() * WEAR.length)]!).rect(x, y, 2, 2, SKIN[1]!);
      cheer.rect(x, y + 1, 3, 3, WEAR[Math.floor(rand() * WEAR.length)]!).rect(x, y - 1, 2, 2, SKIN[1]!);
    }
  }
  for (const x of [54, 104, 222, 272]) {
    img.rect(x, 47, 6, 56, shade).rect(x, 47, 1, 56, hi);
    for (let y = 49; y < 103; y += 5) img.rect(x, y, 6, 1, hi);
  }
  // The sand remains open for the actual agents and card table.
  img.rect(cx - frx - 3, fy - fry - 3, frx * 2 + 6, fry * 2 + 7, dark);
  img.rect(cx - frx - 1, fy - fry - 1, frx * 2 + 2, fry * 2 + 3, hi);
  img.rect(cx - frx, fy - fry, frx * 2, fry * 2, P.sand);
  for (let i = 0; i < 3400; i++) {
    const x = cx - frx + Math.floor(rand() * frx * 2), y = fy - fry + Math.floor(rand() * fry * 2);
    img.set(x, y, rand() < 0.5 ? P.sandHi : P.sandLo);
  }
  img.rect(cx - frx, fy - fry, frx * 2, 5, hex("#856842", 55));
  for (let a = 0; a < Math.PI * 2; a += 0.01) img.put(cx + Math.cos(a) * 46, fy + Math.sin(a) * 35, hex("#4f9361", 165));
  const mark = crest(Math.min(72, Math.floor(54 * CREST.w / CREST.h)));
  img.blit(mark, cx - Math.round(mark.w / 2), fy - Math.round(mark.h / 2), 0.45);
  // The royal box, with an embroidered canopy and the great crest.
  block(cx - 29, 42, 58, 29);
  img.rect(cx - 25, 47, 50, 17, P.deep).rect(cx - 24, 47, 48, 2, P.gold);
  for (const x of [cx - 25, cx + 24]) img.rect(x, 47, 2, 17, P.goldHi);
  img.blit(banner(P.dteal, P.deep, P.gold, 32, 27), cx - 19, 1);
  const torches: { x: number; y: number }[] = [];
  // Buttresses, crenellations and flaming braziers.
  for (const x of [13, 41, 285, 313]) {
    for (const y of [50, 121, 207]) {
      block(x - 7, y - 11, 15, 25);
      img.rect(x - 8, y - 13, 17, 3, hi).rect(x - 6, y + 11, 13, 3, P.goldLo);
      img.ellipse(x, y - 14, 5, 2, P.gold).rect(x - 3, y - 20, 6, 5, P.redHi);
      img.rect(x - 2, y - 23, 4, 8, hex("#ffb432")).rect(x - 1, y - 25, 2, 9, hex("#ffedac"));
      torches.push({ x, y: y - 19 });
    }
  }
  for (const x of [18, 72, 110, 218, 256, 310]) img.blit(banner(P.dteal, P.deep, P.gold, 10, 17), x - 8, 28);
  // South wall with an open gateway and a staircase to the avenue.
  for (const x of [46, 182]) block(x, 205, 102, 17);
  for (const x of [cx - 17, cx + 12]) {
    block(x, 193, 7, 34);
    img.blit(banner(P.dteal, P.deep, P.gold, 11, 17), x - 6, 186);
  }
  img.rect(cx - 10, 204, 20, 24, hex(TERRAIN.paved.base));
  for (let y = 209; y < 229; y += 4) img.rect(cx - 10, y, 20, 1, hi);
  for (let y = 192; y < h; y++) for (let x = 0; x < w; x++) {
    if (y < 204 && x > 46 && x < 283) continue;
    const colour = img.get(x, y); if (colour[3]) front.set(x, y, colour);
  }
  img.outline(); front.outline();
  writeFileSync(join(out, "arena-torches.json"), JSON.stringify(torches));
  return { back: img, front, crowd: [still, cheer] };
}

mkdirSync(out, { recursive: true });
const save = (name: string, img: Raster) => writePng(join(out, `${name}.png`), img);

// Rebuild the standalone flags without regenerating buildings or terrain.
if (process.argv.includes("--flags-only")) {
  save("banner", banner(P.teal, P.dteal, P.gold));
  save("banner-fame", banner(P.navy, P.deep, P.gold));
  save("banner-gold", banner(P.gold, P.goldLo, P.teal));
  save("flag", flagSheet());
  process.exit(0);
}

if (!process.argv.includes("--terrain-only")) {
  const modernBuildings: [string, ModernRole][] = [
    ["hiring-hall", "hiring"], ["strategy-lab", "strategy"], ["game-hall", "games"],
    ["hall-of-fame", "fame"], ["treasury", "treasury"], ["lookout", "lookout"], ["rulebook-house", "rulebook"],
  ];
  if (!process.argv.includes("--arena-only")) {
    for (const [name, role] of modernBuildings) save(`modern-${name}`, modernVillageHouse(role));
    for (const [name, accent] of [["blue", hex("#397d9a")], ["red", hex("#b77357")], ["yellow", P.goldLo], ["purple", hex("#756899")]] as const) {
      save(`modern-villa-${name}`, modernVilla(accent, name));
    }
  }
  if (process.argv.includes("--modern-only")) process.exit(0);

  const a = process.argv.includes("--oval") ? ovalArena() : arena();
  save("arena", a.back);
  save("arena-front", a.front);
  save("arena-crowd", a.crowd[0]);
  save("arena-cheer", a.crowd[1]);
  save("arena-card", a.back.clone().blit(a.crowd[0], 0, 0));
  // A focused rebuild preserves unrelated artwork in an active checkout.
  if (process.argv.includes("--arena-only")) process.exit(0);
  save("banner", banner(P.teal, P.dteal, P.gold));
  save("banner-fame", banner(P.navy, P.deep, P.gold));
  save("banner-gold", banner(P.gold, P.goldLo, P.teal));
  save("flag", flagSheet());
  const board = leaderboardSheet();
  save("leaderboard", board);
  save("leaderboard-card", new Raster(board.w / 2, board.h).blit(board, 0, 0));
  save("scoreboard", scoreboardSheet());
  save("war-table", warTable());
  save("strategy-board", strategyBoard());
  save("hiring-board", hiringBoard());
  save("statue", statue());
  save("trophy", trophy());
  save("chest", chest(true));
  save("chest-shut", chest(false));
  save("coins", coins());
  save("tent", tent());
  save("bench", bench());
  save("dummy", dummy());
  save("log", logSeat());
  save("strategy-lab", strategyLab());
  save("lookout", lookout());
  save("game-hall", gameHall());
  save("launch-pad", launchPadSheet());
  save("modern-office", modernOffice());
  save("modern-house-a", modernHouse(P.teal));
  save("modern-house-b", modernHouse(P.red));
  save("modern-shop", modernShop());
  save("modern-apartments", modernApartments());
  save("modern-kiosk", modernKiosk());
  save("modern-lamp", modernLamp());
  save("modern-planter", modernPlanter());
  save("bazaar", bazaar());
  save("pier", pier());
  save("launch-pad-card", launchPadFrame(true));
  console.log(`Wrote the village's Gamine art to ${out}`);
}

// --- The pack, recoloured ----------------------------------------------------

/**
 * The pack's cool greens and teals, each to its place in the terrain palette.
 * Exact colours only: the pack is drawn in a few flat ones, so nothing else
 * in a picture - wood, stone, a red flower - is touched.
 */
const { grass, tree, water } = TERRAIN;
const GRASS = { "#9bb94e": grass.base, "#bfba5b": grass.light, "#79a863": grass.low, "#679175": grass.shade, "#5a7d53": grass.shade, "#728844": grass.low };
const LEAVES = { "#bdd763": tree.tip, "#5ab659": tree.light, "#2f966a": tree.mid, "#27716f": tree.low, "#2a485e": tree.deep, "#161726": tree.shadow };
const BUSH = { "#d0deb5": grass.light, "#8cc3c4": tree.tip, "#669d9d": tree.light, "#506a69": tree.mid };
const SPROUT = { "#7cbb4e": grass.light, "#529650": tree.light, "#387253": tree.mid, "#3d4f4d": tree.deep };
/** The pack's outline, on foliage: the forest's own shadow instead of the pack's navy. */
const LEAF_INK = { "#161c2e": tree.shadow };
/** On the ground tiles the outline only ever edges the water: the water's dark edge. */
const SHORE = { "#161c2e": water.edge };

/** The pack's flat water, in the fountain and the yard's troughs. */
const POOL = { "#47aba9": water.base };

const deco = (ns: string[], map: Record<string, string>) => Object.fromEntries(ns.map((n) => [`village/tiny-swords/Deco/${n}.png`, map]));
const MAPS: Record<string, Record<string, string>> = {
  "village/tiny-swords/Terrain/Ground/Tilemap_Flat.png": { ...GRASS, ...SHORE },
  "village/tiny-swords/Resources/Trees/Tree.png": { ...LEAVES, ...LEAF_INK },
  ...deco(["04", "05", "06"], { ...BUSH, ...LEAF_INK }),
  ...deco(["08", "09"], { ...LEAVES, ...LEAF_INK }),
  ...deco(["07", "17"], LEAVES),
  ...deco(["10", "11", "12"], SPROUT),
  "fixtures/Fountain.png": POOL,
  "fixtures/Yard.png": POOL,
  "fixtures/Pumpkin.png": SPROUT,
};

function recolour(src: Raster, map: Record<string, string>): { img: Raster; changed: number } {
  const to = new Map(Object.entries(map).map(([from, c]) => [hex(from).slice(0, 3).join(), hex(c)]));
  const img = src.clone();
  let changed = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const c = img.get(x, y);
      const n = c[3] > 0 ? to.get(c.slice(0, 3).join()) : undefined;
      if (!n) continue;
      img.set(x, y, [n[0], n[1], n[2], c[3]]);
      changed++;
    }
  }
  return { img, changed };
}

/** The water: not the pack's flat teal but drawn from the palette, its base with short ripples of the darker teal. */
function waterTile(): Raster {
  const img = new Raster(64, 64).rect(0, 0, 64, 64, hex(water.base));
  const rand = rng(44);
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(rand() * 64);
    const y = Math.floor(rand() * 64);
    const len = 3 + Math.floor(rand() * 5);
    // Wrapped, so the tile repeats without a seam.
    for (let i = 0; i < len; i++) img.set((x + i) % 64, y, hex(rand() < 0.25 ? water.edge : water.mid));
  }
  return img;
}

const warmOut = join(pub, "village/warm");
for (const path of RECOLOURED) {
  mkdirSync(dirname(join(warmOut, path)), { recursive: true });
  if (path.endsWith("Water/Water.png")) {
    writePng(join(warmOut, path), waterTile());
    continue;
  }
  const map = MAPS[path];
  if (!map) throw new Error(`${path}: in RECOLOURED but given no colours`);
  const { img, changed } = recolour(readPng(join(pub, path)), map);
  // A picture none of whose colours were found has changed in the pack: say so rather than ship it unchanged.
  if (changed === 0) throw new Error(`${path}: no colour of its map found`);
  writePng(join(warmOut, path), img);
}
console.log(`Recoloured ${RECOLOURED.length} of the pack's pictures to ${warmOut}`);
