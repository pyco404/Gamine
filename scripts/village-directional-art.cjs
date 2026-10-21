// Builds the back, left and right views of village structures from each one's own front art,
// and the manifest saying how each structure stands (web/lib/world/directional-views.json).
// node scripts/village-directional-art.cjs [name]
//
// Nothing here is invented: every pixel comes from the structure's front picture - its walls,
// roof, trim, base, windows, plants - so all four sides are the same object in the same materials.
//   back  - the front mirrored (what an object symmetric front-to-back shows from behind), with
//           what only the front has - a door, sign, emblem, display, lock - covered by the object's
//           own wall sections, or repainted in its own frame or canvas material.
//   right - the object's own end, as the front picture shows it; left is the front's own left end
//           where that differs (a chimney there), otherwise the right end mirrored.
// Each structure is one of three constructions, chosen for what it physically is:
//   body  - a volume with a picture on each wall (houses, halls, stalls, chests); its depth is its
//           end picture's width, so no picture is stretched, and a solid one's top is closed by a
//           low cap in colours sampled from its own roof and walls (the bazaar's three stalls stand
//           apart, so it has none).
//   board - a thin panel (signs, banners, flags, fences): a face each side, a narrow edge.
//   cross - a plane each way through its middle, for free-standing things seen the same from any
//           side (a tower, a tent, a rocket on its pad, statues, a fountain); the one facing the
//           camera most is drawn, so a round base never shows edge-on through another view.
const { PNG } = require("../web/node_modules/pngjs");
const fs = require("node:fs");
const path = require("node:path");

const WEB = path.join(__dirname, "../web/public");
const OUT = path.join(WEB, "village/reference/directional");
const MANIFEST = path.join(__dirname, "../web/lib/world/directional-views.json");

/*
 * Per structure, in its source picture's pixel coordinates (a sprite sheet's first frame):
 *   back.patches  - source rectangles `from` [x0, y0, x1, y1] laid `to` [x, y] on the mirrored front
 *   back.fill     - rectangles of the mirrored front repainted in the colour sampled `from` [x, y];
 *                   with `dark`, only pixels darker than that (a door's shadow, not the canvas round it)
 *   right         - source columns [x0, x1] of its end, or "back" / "front" for an object whose ends
 *                   look like that, or { from, clear, patches } to assemble it from the front's parts
 *   cap           - body only: eave and peak heights (fractions of its height), roof and wall colours
 */
const STRUCTURES = [
  // Houses: the ridge runs along the front; the end shows the roof's slope and the end wall.
  { name: "cottage-gold", src: "village/reference/cottage-gold.png", form: "body", right: [62, 128],
    cap: { eave: 0.3, peak: 0.48, roof: [60, 40], wall: [64, 110] },
    back: { patches: [{ from: [75, 93, 106, 138], to: [73, 93] }] } }, // arched door -> its shuttered window
  { name: "cottage-red", src: "village/reference/cottage-red.png", form: "body", right: [62, 128],
    cap: { eave: 0.3, peak: 0.48, roof: [60, 50], wall: [70, 104] },
    back: { patches: [{ from: [66, 86, 110, 138], to: [67, 86] }] } }, // porch and door -> its window wall
  { name: "cottage-green", src: "village/reference/cottage-green.png", form: "body", right: [84, 128],
    cap: { eave: 0.3, peak: 0.5, roof: [100, 60], wall: [50, 86] },
    back: { patches: [{ from: [64, 98, 92, 132], to: [60, 98] }] } }, // door -> its shuttered window
  { name: "rulebook-house", src: "village/reference/rulebook-house.png", form: "body", right: [84, 128], left: [0, 44],
    cap: { eave: 0.32, peak: 0.5, roof: [40, 50], wall: [100, 96] },
    back: { patches: [{ from: [14, 56, 52, 140], to: [43, 56] }] } }, // entrance bay, book sign, steps -> its bookshelf bay
  // Halls.
  { name: "hall-of-fame", src: "village/reference/hall-of-fame.png", form: "body", right: [80, 128],
    cap: { eave: 0.3, peak: 0.46, roof: [110, 60], wall: [8, 110] },
    back: { patches: [
      { from: [52, 56, 76, 96], to: [52, 98] }, // door and steps -> its own tall window
      { from: [33, 44, 49, 62], to: [33, 62] }, { from: [33, 44, 49, 62], to: [33, 80] }, // banners -> the stone columns above them
      { from: [79, 44, 95, 62], to: [79, 62] }, { from: [79, 44, 95, 62], to: [79, 80] },
      { from: [88, 96, 112, 140], to: [87, 96] }, // trophy plinth -> its window, ivy and barrel
    ] } },
  { name: "treasury", src: "village/reference/treasury.png", form: "body", left: [0, 48], right: "left",
    cap: { eave: 0.3, peak: 0.46, roof: [40, 46], wall: [60, 90] },
    back: { patches: [
      { from: [16, 84, 40, 136], to: [51, 84] }, // vault door -> its barred window wall
      { from: [24, 70, 42, 88], to: [54, 68] }, // coin emblem -> its stone and ivy
      { from: [14, 108, 40, 140], to: [18, 108] }, // treasure chest -> its sacks and plants
    ] } },
  { name: "strategy-lab", src: "village/reference/strategy-lab.png", form: "body", left: [0, 48], right: "left",
    cap: { eave: 0.3, peak: 0.46, roof: [40, 50], wall: [20, 90] },
    back: { patches: [
      { from: [14, 96, 42, 132], to: [48, 96] }, // door -> its window wall
      { from: [2, 98, 28, 136], to: [0, 98] }, // the map easel -> its vines
    ] } },
  { name: "hiring-hall", src: "village/reference/hiring-hall.png", form: "body", left: [0, 48], right: "left",
    cap: { eave: 0.3, peak: 0.46, roof: [30, 46], wall: [20, 100] },
    back: { patches: [
      { from: [74, 58, 92, 84], to: [55, 58] }, // the scroll crest -> its gable's plaster and timber
      { from: [12, 94, 40, 128], to: [47, 94] }, // door -> its window wall
      { from: [6, 96, 28, 136], to: [5, 96] }, // the notice board -> its wall and plants
    ] } },
  { name: "game-hall", src: "village/reference/game-hall.png", form: "body", right: [80, 128],
    cap: { eave: 0.3, peak: 0.46, roof: [30, 56], wall: [40, 80] },
    back: { patches: [
      { from: [54, 44, 74, 62], to: [53, 62] }, { from: [54, 44, 74, 62], to: [53, 72] }, // pawn and dice -> its gable
      { from: [8, 100, 40, 140], to: [45, 100] }, // open doors -> its wall, window and barrels
    ] } },
  // The lookout: a free-standing square tower, its stair on one side. From behind there is no door; its
  // sides look the same. Crossed through its middle, every view is the one tower.
  { name: "lookout", src: "village/reference/lookout.png", form: "cross", right: "back",
    back: { patches: [{ from: [48, 106, 58, 138], to: [53, 106] }, { from: [48, 106, 58, 138], to: [61, 106] }] } }, // door -> its stone base
  // Stalls: open counters under an awning, the same goods seen from either side.
  { name: "market-blue", src: "village/reference/market-blue.png", form: "body", right: [90, 128], clear: [[0, 84, 10, 144]],
    cap: { eave: 0.32, peak: 0.32, roof: [60, 120], wall: [60, 120] }, back: {} },
  { name: "market-red", src: "village/reference/market-red.png", form: "body", right: [90, 128], clear: [[50, 10, 76, 20]],
    cap: { eave: 0.3, peak: 0.3, roof: [70, 120], wall: [70, 120] }, back: {} },
  { name: "bazaar", src: "village/gamine/bazaar.png", form: "body", right: [70, 98],
    back: { fill: [{ rect: [41, 41, 57, 55], from: [40, 46] }] } }, // the price board's display -> its frame's wood
  // The smithy: open-fronted forge; its back is closed timber, its left end a timbered gable.
  { name: "smithy", src: "village/reference/smithy.png", form: "body", right: [80, 128], left: [0, 52],
    cap: { eave: 0.3, peak: 0.46, roof: [80, 50], wall: [70, 100] },
    back: { patches: [
      { from: [56, 84, 84, 124], to: [80, 86] }, // forge and fire -> its hanging-tool wall
      { from: [56, 100, 84, 132], to: [60, 104] }, // anvil -> the same wall
      { from: [64, 84, 84, 100], to: [6, 66] }, // shield sign -> its timber
    ] } },
  // The Launch Pad: a rocket on a round pad, its gantry beside it. From the side the gantry stands behind the rocket.
  { name: "launch-pad", src: "village/gamine/launch-pad.png", frame: 64, form: "cross", back: {},
    right: { from: "front", clear: [[1, 0, 22, 66], [17, 26, 28, 33]], patches: [{ from: [2, 0, 18, 66], to: [28, 0] }, { from: [24, 0, 52, 70], to: [24, 0] }] } },
  // Boards: the display is on the front; the back is the board's own frame material.
  { name: "leaderboard", src: "village/gamine/leaderboard.png", frame: 84, form: "board", thickness: 6, right: [4, 8],
    back: { fill: [{ rect: [8, 15, 77, 57], from: [6, 30] }] } },
  { name: "scoreboard", src: "village/gamine/scoreboard.png", frame: 66, form: "board", thickness: 4, right: [2, 6],
    back: { fill: [{ rect: [6, 5, 61, 45], from: [4, 24] }] } },
  { name: "hiring-board", src: "village/gamine/hiring-board.png", form: "board", thickness: 4, right: [1, 5],
    back: { fill: [{ rect: [4, 12, 52, 36], from: [3, 22] }, { rect: [14, 1, 42, 9], from: [15, 5] }] } },
  { name: "strategy-board", src: "village/gamine/strategy-board.png", form: "board", thickness: 3, right: [3, 6],
    back: { fill: [{ rect: [4, 4, 38, 35], from: [4, 20] }] } },
  // Banners and flags: cloth, the same picture mirrored from behind; the pole at its edge.
  { name: "banner", src: "village/gamine/banner.png", form: "board", thickness: 2, right: [8, 12], back: {} },
  { name: "banner-fame", src: "village/gamine/banner-fame.png", form: "board", thickness: 2, right: [8, 12], back: {} },
  { name: "banner-gold", src: "village/gamine/banner-gold.png", form: "board", thickness: 2, right: [8, 12], back: {} },
  { name: "flag", src: "village/gamine/flag.png", frame: 28, form: "board", thickness: 2, right: [0, 4], back: {} },
  { name: "fence", src: "fixtures/Fence.png", form: "board", thickness: 4, right: [0, 6], back: {} },
  // Tents: the doorway only at the front; from behind and the sides, the canvas. Crossed, the four
  // triangles meet at one peak.
  { name: "tent", src: "village/gamine/tent.png", form: "cross", right: "back",
    back: { fill: [{ rect: [12, 12, 27, 40], from: [36, 30], dark: 0.22 }] } },
  // Small props.
  { name: "chest", src: "village/gamine/chest.png", form: "body", right: [21, 27],
    cap: { eave: 0.5, peak: 0.5, roof: [12, 4], wall: [12, 4] },
    back: { fill: [{ rect: [9, 12, 16, 18], from: [11, 18] }] } }, // the lock -> the lid's wood
  { name: "war-table", src: "village/gamine/war-table.png", form: "body", right: [38, 46],
    cap: { eave: 0.6, peak: 0.6, roof: [20, 10], wall: [4, 16] }, back: {} },
  { name: "bench", src: "village/gamine/bench.png", form: "body", right: [0, 6],
    cap: { eave: 0.45, peak: 0.45, roof: [15, 7], wall: [15, 7] }, back: {} },
  { name: "dummy", src: "village/gamine/dummy.png", form: "cross", right: "back",
    back: { fill: [{ rect: [6, 13, 14, 21], from: [6, 18] }] } }, // the target -> its burlap
  { name: "statue", src: "village/gamine/statue.png", form: "cross", right: "back",
    back: { fill: [{ rect: [6, 47, 20, 51], from: [8, 52] }] } }, // the plaque -> its plinth
  { name: "trophy", src: "village/gamine/trophy.png", form: "cross", right: "back", back: {} },
  { name: "fountain", src: "village/warm/fixtures/Fountain.png", as: "fixtures/Fountain.png", form: "cross", right: "front", back: {} },
  { name: "pumpkin", src: "village/warm/fixtures/Pumpkin.png", as: "fixtures/Pumpkin.png", form: "cross", right: "front", back: {} },
  { name: "gold", src: "fixtures/Gold.png", form: "cross", right: "front", back: {} },
  { name: "coins", src: "village/gamine/coins.png", form: "cross", right: "front", back: {} },
  { name: "log", src: "village/gamine/log.png", form: "body", right: [0, 5], back: {} },
  // New Town's growth buildings are their source pictures trimmed and shrunk
  // (village-reference-assets.cjs), so their views are the source's own views shrunk the same way.
  { name: "modern-office", src: "village/reference/modern-office.png", scaled: "smithy" },
  { name: "modern-house-a", src: "village/reference/modern-house-a.png", scaled: "cottage-gold" },
  { name: "modern-house-b", src: "village/reference/modern-house-b.png", scaled: "cottage-red" },
  { name: "modern-shop", src: "village/reference/modern-shop.png", scaled: "market-blue" },
  { name: "modern-apartments", src: "village/reference/modern-apartments.png", scaled: "cottage-green" },
  { name: "modern-kiosk", src: "village/reference/modern-kiosk.png", scaled: "market-red" },
];

const read = (file) => PNG.sync.read(fs.readFileSync(file));
const blank = (width, height) => new PNG({ width, height });
const at = (png, x, y) => (y * png.width + x) * 4;
const VISIBLE = 32; // the renderer's own threshold for a picture's visible pixels (scene.ts)

function crop(png, x0, y0, x1, y1) {
  const out = blank(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) png.data.copy(out.data, at(out, 0, y - y0), at(png, x0, y), at(png, x1, y));
  return out;
}
function mirror(png) {
  const out = blank(png.width, png.height);
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) png.data.copy(out.data, at(out, png.width - 1 - x, y), at(png, x, y), at(png, x, y) + 4);
  return out;
}
/** Lays `part` over `png` at (x, y), alpha-blended, as an image editor's paste with transparency. */
function paste(png, part, x, y) {
  for (let j = 0; j < part.height; j++) for (let i = 0; i < part.width; i++) {
    const tx = x + i, ty = y + j;
    if (tx < 0 || ty < 0 || tx >= png.width || ty >= png.height) continue;
    const s = at(part, i, j), d = at(png, tx, ty), a = part.data[s + 3] / 255;
    if (a === 0) continue;
    for (let c = 0; c < 4; c++) png.data[d + c] = Math.round(part.data[s + c] * a + png.data[d + c] * (1 - a));
  }
}
const lum = (png, i) => (png.data[i] * 0.3 + png.data[i + 1] * 0.59 + png.data[i + 2] * 0.11) / 255;
/** Repaints the visible pixels of a rectangle in one material (only those darker than `dark`, if given). */
function fill(png, [x0, y0, x1, y1], [r, g, b], dark) {
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x++) {
    const i = at(png, x, y);
    if (png.data[i + 3] === 0 || (dark !== undefined && lum(png, i) >= dark)) continue;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b;
  }
}
function clear(png, [x0, y0, x1, y1]) {
  for (let y = y0; y < Math.min(png.height, y1); y++) for (let x = x0; x < Math.min(png.width, x1); x++) png.data[at(png, x, y) + 3] = 0;
}
/** The box [x0, y0, x1, y1) of the visible pixels, as the renderer measures a front. */
function content(png) {
  let x0 = png.width, y0 = png.height, x1 = 0, y1 = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) if (png.data[at(png, x, y) + 3] >= VISIBLE) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  return [x0, y0, x1, y1];
}
/** Nearest-neighbour resize, as the shrunk pictures themselves were made. */
function resize(png, width, height) {
  const out = blank(Math.max(1, width), Math.max(1, height));
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const sx = Math.min(png.width - 1, Math.floor((x + 0.5) * png.width / out.width)), sy = Math.min(png.height - 1, Math.floor((y + 0.5) * png.height / out.height));
    png.data.copy(out.data, at(out, x, y), at(png, sx, sy), at(png, sx, sy) + 4);
  }
  return out;
}
/** The material round a point: the mean of the visible pixels within 4 of it, so one shadow pixel does not set a roof's colour. */
const colour = (png, [x, y]) => {
  const sum = [0, 0, 0]; let n = 0;
  for (let j = Math.max(0, y - 4); j <= Math.min(png.height - 1, y + 4); j++) for (let i = Math.max(0, x - 4); i <= Math.min(png.width - 1, x + 4); i++) {
    const k = at(png, i, j); if (png.data[k + 3] < VISIBLE) continue;
    for (let c = 0; c < 3; c++) sum[c] += png.data[k + c]; n++;
  }
  return "#" + sum.map((v) => Math.round(v / Math.max(1, n)).toString(16).padStart(2, "0")).join("");
};

fs.mkdirSync(OUT, { recursive: true });
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const only = process.argv[2];
for (const s of STRUCTURES) {
  if (only && s.name !== only) continue;
  if (s.scaled) {
    // The source's views, scaled by exactly what took its front to this one's: same walls, roof and trim.
    const from = STRUCTURES.find((t) => t.name === s.scaled), source = manifest[`/${from.as ?? from.src}`];
    let original = read(path.join(WEB, from.src));
    if (from.frame) original = crop(original, 0, 0, from.frame, original.height);
    const [a0, b0, a1, b1] = content(original), [x0, y0, x1, y1] = content(read(path.join(WEB, s.src)));
    const fx = (x1 - x0) / (a1 - a0), fy = (y1 - y0) / (b1 - b0);
    const views = {};
    for (const side of ["back", "right", "left"]) {
      const view = read(path.join(OUT, `${s.scaled}-${side}.png`));
      views[side] = side === "back" ? resize(view, x1 - x0, y1 - y0) : resize(view, Math.round(view.width * fx), y1 - y0);
      fs.writeFileSync(path.join(OUT, `${s.name}-${side}.png`), PNG.sync.write(views[side]));
    }
    manifest[`/${s.src}`] = { ...source, name: s.name, depth: +(views.right.width / (x1 - x0)).toFixed(4) };
    console.log(s.name.padEnd(16), source.form.padEnd(6), `front ${x1 - x0}x${y1 - y0}`, `right ${views.right.width}`, `from ${s.scaled}`);
    continue;
  }
  let src = read(path.join(WEB, s.src));
  if (s.frame) src = crop(src, 0, 0, s.frame, src.height);
  // Stray pixels from a neighbour in the source sheet are not part of the structure.
  const original = src;
  if (s.clear) { src = crop(src, 0, 0, src.width, src.height); for (const r of s.clear) clear(src, r); }
  const [x0, y0, x1, y1] = content(original), W = src.width;
  const sample = (p) => [0, 1, 2].map((c) => src.data[at(src, p[0], p[1]) + c]);

  const back = mirror(src);
  for (const p of s.back.patches ?? []) paste(back, crop(src, ...p.from), p.to[0], p.to[1]);
  for (const f of s.back.fill ?? []) fill(back, f.rect, sample(f.from), f.dark);
  const backView = crop(back, W - x1, y0, W - x0, y1);
  // Ends come from the front with its front-only features already covered: a chest by the door
  // or a notice board at the corner is not on the building's side either.
  const clean = mirror(back);

  const end = (spec) => {
    if (spec === "back") return backView;
    if (spec === "front") return crop(src, x0, y0, x1, y1);
    if (Array.isArray(spec)) return crop(clean, spec[0], y0, spec[1], y1);
    const png = crop(src, 0, 0, W, src.height);
    for (const r of spec.clear ?? []) clear(png, r);
    for (const p of spec.patches ?? []) paste(png, crop(src, ...p.from), p.to[0], p.to[1]);
    const [a, , b] = content(png);
    return crop(png, a, y0, b, y1);
  };
  // An end with a front-only prop by it (a chest, an easel) takes the other end's picture, mirrored.
  const right = s.right === "left" ? mirror(end(s.left)) : end(s.right);
  const views = { back: backView, right, left: s.left ? end(s.left) : mirror(right) };
  for (const [side, png] of Object.entries(views)) fs.writeFileSync(path.join(OUT, `${s.name}-${side}.png`), PNG.sync.write(png));

  const entry = { name: s.name, form: s.form, depth: +(right.width / (x1 - x0)).toFixed(4) };
  if (s.thickness) entry.thickness = s.thickness;
  if (s.cap) entry.cap = { eave: s.cap.eave, peak: s.cap.peak, roof: colour(src, s.cap.roof), wall: colour(src, s.cap.wall) };
  manifest[`/${s.as ?? s.src}`] = entry; // `as`: the picture a piece names, where the scene loads its recoloured copy (palette.ts)
  console.log(s.name.padEnd(16), s.form.padEnd(6), `front ${x1 - x0}x${y1 - y0}`, `right ${right.width}`, `depth ${entry.depth}`);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
