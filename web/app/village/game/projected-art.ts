import { worldPerformance } from "../../../lib/world/render-performance";
import { ARENA_ENTRANCES, ARENA_GATE_WIDTH, ARENA_SIDE_WIDTH, COLOSSEUM_FLOOR } from "../../../lib/world/arena-geometry";
import type { ArtFrame, ArtRef, TopGround, WorldModel, WorldObject } from "../../../lib/world/model";
import { depthOrder, footprint, project, type Projection } from "../../../lib/world/projection";
import { TERRAIN, darker } from "./palette";
import { ARENA_PALETTE as A } from "./arena-art";
import { buildingMaterial, VILLAGE_MATERIAL as M, type ProjectedMaterials } from "./projected-materials";
import type { Pt } from "../../../lib/world/world";
import { fixedObjectLayer } from "./fixed-world-art";
import { drawTerrainEdge } from './terrain-edge';

export type ProjectionCamera = { x: number; y: number; scale: number };
/**
 * One upright piece of scenery in painter order. `bounds` is where it can paint, in projected world
 * units: WorldCamera redraws a layer over live actors only where those bounds meet one. A layer
 * without bounds is redrawn every frame.
 */
export type ProjectedLayer = { depth: number; bounds?: { x0: number; y0: number; x1: number; y1: number }; draw: () => void; drawScreen?: (camera: ProjectionCamera, width: number, height: number) => void };
type CaptureLayer = (layer: ProjectedLayer) => void;
type Vertex = Pt & { z?: number };
type Brush = {
  detail: boolean;
  ground: (points: Pt[], z: number, material?: CanvasPattern) => void;
  polygon: (points: Vertex[], colour: string, stroke?: string) => void;
  line: (points: Vertex[], colour: string, width?: number) => void;
};
const COLOUR = { grass: TERRAIN.grass.base, edge: TERRAIN.grass.light, earth: "#81552f", deep: "#3c2b20", water: TERRAIN.water.base, bank: TERRAIN.paved.hi,
  wall: M.plaster, shade: M.plasterShade, roof: M.goldRoof, gold: M.gold, glass: M.glass, wood: M.wood };

function brush(ctx: CanvasRenderingContext2D, view: Projection, scale: number, materials?: ProjectedMaterials): Brush {
  const path = (points: Vertex[]) => {
    ctx.beginPath();
    points.forEach((p, i) => { const s = project(view, p, p.z ?? 0); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  };
  return {
    detail: scale > 0.12,
    ground: (points, z, material) => {
      if (!material) return;
      // Texture coordinates remain on the shared ground plane as the camera rotates.
      const origin = project(view, { x: 0, y: 0 }, z), x = project(view, { x: 1, y: 0 }, z), y = project(view, { x: 0, y: 1 }, z);
      ctx.save(); ctx.transform(x.x - origin.x, x.y - origin.y, y.x - origin.x, y.y - origin.y, origin.x, origin.y);
      ctx.beginPath(); points.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath();
      ctx.fillStyle = material; ctx.fill(); ctx.restore();
    },
    polygon: (points, colour, stroke) => { if (!points.length) return; path(points); ctx.closePath(); ctx.fillStyle = colour; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); } },
    line: (points, colour, width = 2) => { path(points); ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.stroke(); },
  };
}

/** What Top supplies to draw itself: its ground layer and its texture frames. */
export type TopArt = { ground?: TopGround | null; art?: (ref: ArtRef) => ArtFrame | null };

/** Draws in ground-plane coordinates: the world's own x/y, laid flat at z=0 for this view. */
function onGround(ctx: CanvasRenderingContext2D, view: Projection, draw: () => void): void {
  const o = project(view, { x: 0, y: 0 }, 0), x = project(view, { x: 1, y: 0 }, 0), y = project(view, { x: 0, y: 1 }, 0);
  ctx.save(); ctx.transform(x.x - o.x, x.y - o.y, y.x - o.x, y.y - o.y, o.x, o.y); draw(); ctx.restore();
}

/**
 * Flat terrain art remains on the ground plane. Standing objects use fixed geometry below.
 */
function picture(ctx: CanvasRenderingContext2D, view: Projection, o: WorldObject, top?: TopArt): boolean {
  if (!o.metadata?.flat) return false;
  const ref = o.metadata?.art, f = ref && top?.art?.(ref);
  if (!ref || !f) return false;
  const foot = o.metadata?.topAnchor ?? { x: o.x, y: o.y };
  const draw = (x: number, y: number, w: number, h: number) => {
    ctx.save(); ctx.translate(x, y); if (ref.flipX) ctx.scale(-1, 1);
    ctx.drawImage(f.image as CanvasImageSource, f.x, f.y, f.width, f.height, -w / 2, -h, w, h);
    ctx.restore();
  };
  onGround(ctx, view, () => draw(foot.x, foot.y, o.width, o.depth));
  return true;
}

function prism(b: Brush, view: Projection, o: WorldObject, wall: string = COLOUR.wall, roof: string = COLOUR.roof): void {
  const corners = footprint(o), z = o.elevation, top = z + o.height;
  const edges = corners.map((a, i) => ({ a, c: corners[(i + 1) % corners.length]! }))
    .sort((a, c) => project(view, a.a).depth + project(view, a.c).depth - project(view, c.a).depth - project(view, c.c).depth);
  for (const { a, c } of edges) {
    b.polygon([{ ...a, z }, { ...c, z }, { ...c, z: top }, { ...a, z: top }], a.x === c.x ? darker(wall, 0.3) : wall, M.outline);
    if (b.detail && o.height > 35 && o.category === "structure" && o.type !== "bridge") {
      const length = Math.hypot(c.x - a.x, c.y - a.y), n = Math.max(1, Math.floor(length / 28));
      for (let row = 0; row < Math.min(4, Math.floor(o.height / 26)); row++) for (let i = 0; i < n; i++) {
        const u = (i + 0.24) / n, v = (i + 0.63) / n;
        const p = { x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u };
        const q = { x: a.x + (c.x - a.x) * v, y: a.y + (c.y - a.y) * v };
        const h = z + 12 + row * 26;
        b.polygon([{ ...p, z: h }, { ...q, z: h }, { ...q, z: h + 12 }, { ...p, z: h + 12 }], COLOUR.glass, M.window);
      }
      b.line([{ ...a, z: top - 7 }, { ...c, z: top - 7 }], COLOUR.gold, 3);
    }
  }
  b.polygon(corners.map((p) => ({ ...p, z: top })), roof, darker(roof, 0.45));
  if (o.type === "bridge") {
    for (const side of [-1, 1]) b.line([{ x: o.x - o.width / 2, y: o.y + side * o.depth / 2, z: top + 10 }, { x: o.x + o.width / 2, y: o.y + side * o.depth / 2, z: top + 10 }], COLOUR.gold, 4);
    for (let d = -o.width / 2 + 9; d < o.width / 2; d += 12) b.line([{ x: o.x + d, y: o.y - o.depth / 2, z: top + 1 }, { x: o.x + d, y: o.y + o.depth / 2, z: top + 1 }], M.woodDark, 2);
  }
}

/** Gables, timber framing, warm plaster and tiled/thatch roofs use the reference village's materials. */
function cottage(b: Brush, view: Projection, o: WorldObject, material = buildingMaterial(o)): void {
  const z = o.elevation, top = z + o.height, eave = z + o.height * 0.68;
  const corners = footprint({ ...o, shape: undefined });
  prism(b, view, { ...o, shape: undefined, height: o.height * 0.68 }, material.wall, material.roof);
  const [nw, ne, se, sw] = corners as [Pt, Pt, Pt, Pt];
  const west = { x: nw.x, y: o.y, z: top }, east = { x: ne.x, y: o.y, z: top };
  const roofs = [
    { points: [{ ...nw, z: eave }, { ...ne, z: eave }, east, west], fill: material.roofLight },
    { points: [{ ...sw, z: eave }, { ...se, z: eave }, east, west], fill: material.roof },
    { points: [{ ...nw, z: eave }, { ...sw, z: eave }, west], fill: darker(material.wall, 0.2) },
    { points: [{ ...ne, z: eave }, { ...se, z: eave }, east], fill: material.wall },
  ].sort((a, c) => a.points.reduce((n, p) => n + project(view, p).depth, 0) / a.points.length - c.points.reduce((n, p) => n + project(view, p).depth, 0) / c.points.length);
  for (const face of roofs) b.polygon(face.points, face.fill, M.outline);
  b.line([west, east], material.roofLight, 4);
  for (const pair of [[nw, ne], [sw, se]] as const) {
    b.line(pair.map((p) => ({ ...p, z: eave })), M.timber, 4);
    if (b.detail) for (const t of [0.25, 0.5, 0.75]) {
      const y = pair[0].y + (o.y - pair[0].y) * t, h = eave + (top - eave) * t;
      b.line([{ x: nw.x, y, z: h }, { x: ne.x, y, z: h }], darker(material.roof, 0.2), 2);
      for (let x = nw.x + 8; x < ne.x; x += 18) b.line([{ x, y, z: h }, { x: x + 3, y: y + (o.y - y) * 0.15, z: h + (top - h) * 0.15 }], material.roofLight, 2);
    }
  }
  // Vertical posts and horizontal beams are attached to the same footprint, not camera-facing geometry.
  for (const p of corners) b.line([{ ...p, z }, { ...p, z: eave }], M.timber, 5);
  for (const level of [z + o.height * 0.12, z + o.height * 0.4]) for (let i = 0; i < 4; i++)
    b.line([{ ...corners[i]!, z: level }, { ...corners[(i + 1) % 4]!, z: level }], M.timber, 3);
  const doorWidth = Math.min(25, o.width * 0.18), doorHeight = Math.min(eave - z - 2, o.height * 0.35);
  b.polygon([{ x: o.x - doorWidth / 2, y: se.y, z }, { x: o.x + doorWidth / 2, y: se.y, z },
    { x: o.x + doorWidth / 2, y: se.y, z: z + doorHeight }, { x: o.x - doorWidth / 2, y: se.y, z: z + doorHeight }], M.woodDark, M.timber);
  b.line([{ x: o.x - doorWidth / 2, y: se.y, z: z + doorHeight }, { x: o.x + doorWidth / 2, y: se.y, z: z + doorHeight }], M.goldLight, 3);
  if (o.id.startsWith("site:")) {
    const banner = { x: o.x + o.width * 0.3, y: se.y, z: eave * 0.75 };
    b.polygon([{ ...banner, x: banner.x - 8 }, { ...banner, x: banner.x + 8 }, { ...banner, x: banner.x + 8, z: banner.z - 20 }, { ...banner, x: banner.x - 8, z: banner.z - 20 }], M.crestDark, M.gold);
    b.line([{ ...banner, x: banner.x - 3, z: banner.z - 7 }, { ...banner, x: banner.x + 3, z: banner.z - 7 }], M.crest, 4);
  }
}

/** Bake the softened floor mark once; retain the original logo colours. */
const floorMarks = new WeakMap<object, HTMLCanvasElement>();
function floorMarking(f: ArtFrame): HTMLCanvasElement {
  const key = f.image as object;
  let mark = floorMarks.get(key);
  if (mark) return mark;
  mark = document.createElement("canvas");
  mark.width = f.width; mark.height = f.height;
  const context = mark.getContext("2d")!;
  context.filter = `blur(${Math.max(1, Math.round(f.width / 60))}px)`;
  context.drawImage(f.image as CanvasImageSource, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
  floorMarks.set(key, mark);
  return mark;
}

/** Sand grain across the floor, seeded, so the floor and the marking on it read as one worn surface. */
const GRAIN = (() => {
  let seed = 20261008;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: 900 }, () => {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand());
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, light: rand() < 0.5, size: 2 + Math.floor(rand() * 3) };
  });
})();

function arenaFloor(ctx: CanvasRenderingContext2D, view: Projection, top?: TopArt): void {
  const { x, y, rx, ry } = COLOSSEUM_FLOOR;
  onGround(ctx, view, () => {
    ctx.save();
    // A worn, darker band round the wall's foot and raking rings across the sand.
    ctx.strokeStyle = A.sandShade; ctx.globalAlpha = 0.35; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.ellipse(x, y, rx - 8, ry - 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.18; ctx.lineWidth = 2;
    for (const k of [0.78, 0.6]) { ctx.beginPath(); ctx.ellipse(x, y, rx * k, ry * k, 0, 0, Math.PI * 2); ctx.stroke(); }
    // A smaller, softened knight mark reads as faded paint in the sand.
    const f = top?.art?.({ key: "ac-arena-emblem", frame: "__BASE" });
    if (f) {
      const width = 112, height = width * f.height / f.width;
      ctx.globalAlpha = 0.55; ctx.imageSmoothingEnabled = true;
      ctx.drawImage(floorMarking(f), x - width / 2, y - height / 2, width, height);
    }
    // Grain over everything on the floor, the marking included: worn in, not laid on top.
    for (const g of GRAIN.slice(0,320)) {
      ctx.globalAlpha = 0.18; ctx.fillStyle = g.light ? A.sandLight : A.sandShade;
      ctx.fillRect(x + g.x * (rx - 14), y + g.y * (ry - 12), g.size, g.size);
    }
    ctx.restore();
  });
}

/**
 * An open gate in the arena's outer wall, as wide as the passage agents walk through
 * A built archway, with deep masonry reveals and full-size doors folded against the exterior.
 * Every face is real geometry: the opening has no painted backdrop or panel across it.
 */
function arenaDoor(b: Brush, view: Projection, o: WorldObject, angle: number, width: number, height: number, banner: boolean): void {
  const rx = o.width / 2, ry = o.depth / 2;
  const at = { x: o.x + Math.cos(angle) * rx, y: o.y + Math.sin(angle) * ry };
  const normal = { x: Math.cos(angle) / rx, y: Math.sin(angle) / ry }, nl = Math.hypot(normal.x, normal.y);
  const n = { x: normal.x / nl, y: normal.y / nl }, t = { x: -n.y, y: n.x };
  const p = (u: number, z: number, out = 1.5) => ({ x: at.x + t.x * u + n.x * out, y: at.y + t.y * u + n.y * out, z });
  const rise = banner ? 32 : 20, spring = height - rise;
  const stone = banner ? 24 : 16, rear = banner ? -30 : -20, front = banner ? 18 : 10;
  const archPoint = (a: number, outer: boolean, out: number) => p(Math.cos(a) * (width / 2 + (outer ? stone : 0)), spring + Math.sin(a) * (rise + (outer ? stone : 0)), out);
  const surfaces: { depth: number; draw: () => void }[] = [];
  const face = (points: Vertex[], colour: string, stroke: string = A.joint) => surfaces.push({
    depth: points.reduce((sum, point) => sum + project(view, point).depth, 0) / points.length,
    draw: () => b.polygon(points, colour, stroke),
  });
  const line = (points: Vertex[], colour: string, weight = 2) => surfaces.push({
    depth: points.reduce((sum, point) => sum + project(view, point).depth, 0) / points.length + 0.01,
    draw: () => b.line(points, colour, weight),
  });
  // Thick jambs anchor the arch to the seating ends, with a shaded inner corridor.
  for (const side of [-1, 1]) {
    const u = side * width / 2, v = side * (width / 2 + stone);
    face([p(u, 0, rear), p(u, 0, front), p(u, spring, front), p(u, spring, rear)], A.stoneShade);
    face([p(v, 0, rear), p(v, 0, front), p(v, spring, front), p(v, spring, rear)], A.stone);
  }
  for (const out of [rear, front]) {
    for (const side of [-1, 1]) {
      const u = side * width / 2, v = side * (width / 2 + stone);
      face([p(u, 0, out), p(v, 0, out), p(v, spring, out), p(u, spring, out)], out === front ? A.stoneLight : A.stone);
      const surface = out + (out === front ? 0.2 : -0.2);
      face([p(u, 0, surface), p(v + side * 4, 0, surface), p(v + side * 4, 5, surface), p(u, 5, surface)], A.stoneLight);
      face([p(u, spring - 6, surface), p(v, spring - 6, surface), p(v, spring, surface), p(u, spring, surface)], A.emerald);
      line([p(u, spring, surface), p(v, spring, surface)], A.goldLight, 3);
      if (b.detail) for (let z = 12; z < spring - 6; z += 12) {
        line([p(u, z, surface), p(v, z, surface)], A.stoneShade, 1);
        const middle = (u + v) / 2 + side * (z % 24 ? 3 : -3);
        line([p(middle, z - 11, surface), p(middle, z, surface)], A.stoneShade, 1);
      }
    }
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 12, c = (i + 1) * Math.PI / 12;
      face([archPoint(a, false, out), archPoint(c, false, out), archPoint(c, true, out), archPoint(a, true, out)], out === front ? i % 3 === 0 ? A.stone : A.stoneLight : A.stone);
      if (out === rear) {
        face([archPoint(a, true, rear), archPoint(c, true, rear), archPoint(c, true, front), archPoint(a, true, front)], A.stone);
        face([archPoint(a, false, rear), archPoint(c, false, rear), archPoint(c, false, front), archPoint(a, false, front)], A.stoneShade);
      }
    }
  }
  // Each leaf could close half the opening; both are swung 165 degrees clear of the passage.
  const leaf = width / 2 - 4, open = 165 * Math.PI / 180;
  for (const side of [-1, 1] as const) {
    const hinge = side * width / 2;
    const end = (z: number) => p(hinge - side * leaf * Math.cos(open), z, front + 2 + leaf * Math.sin(open));
    const top = spring - 4, h = (z: number) => p(hinge, z, front + 2);
    face([h(0), end(0), end(top), h(top)], side < 0 ? A.wood[1] : A.wood[0], A.woodDark);
    if (b.detail) {
      for (let k = 1 / 6; k < 1; k += 1 / 6) {
        const q = (z: number) => { const e = end(z), start = h(z); return { x: start.x + (e.x - start.x) * k, y: start.y + (e.y - start.y) * k, z }; };
        line([q(1), q(top - 1)], A.woodDark, 1);
      }
      for (const z of [10, top - 10]) line([h(z), end(z)], A.goldDark, 4);
      line([h(12), end(top - 12)], A.wood[3], 3);
    }
    const e = end(top * 0.45);
    line([e, { ...e, z: e.z! + 5 }], A.goldLight, 3);
  }
  if (banner) {
    const z = height + stone + 2;
    for (const out of [rear - 0.5, front + 0.5]) {
      line([p(-18, z, out), p(18, z, out)], A.gold, 3);
      face([p(-14, z - 1, out), p(14, z - 1, out), p(14, z - 22, out), p(0, z - 28, out), p(-14, z - 22, out)], A.emerald, A.goldDark);
      line([p(-5, z - 11, out), p(5, z - 11, out)], A.goldLight, 3);
    }
  }
  surfaces.sort((a, c) => a.depth - c.depth).forEach((surface) => surface.draw());
}

function arena(b: Brush, view: Projection, o: WorldObject, floor?: () => void, capture?: CaptureLayer): void {
  const f = COLOSSEUM_FLOOR, rx = o.width / 2, ry = o.depth / 2;
  const south = Math.asin(ARENA_GATE_WIDTH / 2 / rx), east = Math.asin(ARENA_SIDE_WIDTH / 2 / ry);
  const edges = [Math.PI / 2 - south, Math.PI / 2 + south, east, Math.PI * 2 - east] as const;
  // Exact gate edges keep the visible openings as wide as the walkable corridors.
  const angles = [...new Set([...Array.from({ length: 40 }, (_, i) => i * Math.PI / 20), ...edges])].sort((a, c) => a - c);
  const outer = angles.map((a) => ({ x: o.x + Math.cos(a) * rx, y: o.y + Math.sin(a) * ry }));
  const inner = angles.map((a, i) => {
    if (a === edges[0] || a === edges[1]) {
      const x = outer[i]!.x;
      return { x, y: f.y + f.ry * Math.sqrt(1 - ((x - f.x) / f.rx) ** 2) };
    }
    if (a === edges[2] || a === edges[3]) {
      const y = outer[i]!.y;
      return { x: f.x + f.rx * Math.sqrt(1 - ((y - f.y) / f.ry) ** 2), y };
    }
    return { x: f.x + Math.cos(a) * f.rx, y: f.y + Math.sin(a) * f.ry };
  });
  const open = (a: number) => a > edges[0] && a < edges[1] || a < east || a > Math.PI * 2 - east;
  b.polygon(outer, A.stoneShade);
  b.polygon(footprint({ ...o, x: f.x, y: f.y, width: f.rx * 2, depth: f.ry * 2 }), A.sand, A.sandEdge);
  floor?.();
  // The sand continues out through both gaps at ground level, with no platform or sill.
  for (const [x0, y0, x1, y1] of [
    [o.x - ARENA_GATE_WIDTH / 2, f.y + 80, o.x + ARENA_GATE_WIDTH / 2, ARENA_ENTRANCES.front.y + 20],
    [f.x + 170, o.y - ARENA_SIDE_WIDTH / 2, ARENA_ENTRANCES.east.x + 20, o.y + ARENA_SIDE_WIDTH / 2],
  ] as const) {
    const rect = (left: number, top: number, right: number, bottom: number) => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
    b.polygon(rect(x0, y0, x1, y1), A.sand);
    if (b.detail) for (const [i, grain] of GRAIN.slice(0,180).entries()) {
      const x = x0 + (grain.x + 1) / 2 * (x1 - x0), y = y0 + (grain.y + 1) / 2 * (y1 - y0);
      b.polygon(rect(x, y, Math.min(x + grain.size, x1), Math.min(y + 1, y1)), i % 3 ? `${A.sandLight}88` : `${A.sandShade}55`);
    }
  }
  // A flush stone threshold meets the existing paved plaza; the corridor inside stays sandy.
  b.polygon([{ x: o.x - ARENA_GATE_WIDTH / 2, y: o.y + ry + 18 }, { x: o.x + ARENA_GATE_WIDTH / 2, y: o.y + ry + 18 },
    { x: o.x + ARENA_GATE_WIDTH / 2, y: o.y + ry + 30 }, { x: o.x - ARENA_GATE_WIDTH / 2, y: o.y + ry + 30 }], A.stoneLight, A.stoneShade);
  if (b.detail) for (let x = o.x - ARENA_GATE_WIDTH / 2 + 16; x < o.x + ARENA_GATE_WIDTH / 2; x += 16) b.line([{ x, y: o.y + ry + 18 }, { x, y: o.y + ry + 30 }], A.stoneShade, 1);
  const architecture: { depth: number; draw: () => void }[] = [];
  const segments = outer.map((a, i) => ({ a, c: outer[(i + 1) % outer.length]!, ia: inner[i]!, ic: inner[(i + 1) % inner.length]! }))
    .filter((_, i) => !open((angles[i]! + (angles[i + 1] ?? Math.PI * 2)) / 2));
  for (const [section, { a, c, ia, ic }] of segments.entries()) {
    architecture.push({ depth: (project(view, a).depth + project(view, c).depth) / 2, draw: () => {
      // Light from the south-west, as the village's art is shaded: walls turned away fall into shadow.
      const nx = (c.y - a.y), ny = -(c.x - a.x), lit = (-nx * 0.6 + ny * 0.8) / Math.hypot(nx, ny);
      const wall = lit > 0.2 ? A.stoneLight : lit > -0.3 ? A.stone : A.stoneShade;
      b.polygon([a, c, { ...c, z: o.height }, { ...a, z: o.height }], wall, A.joint);
      // Coursed stone: joint lines every course, plinth and cornice in shadow.
      if (b.detail) for (const [course,z] of [10,20,30,40].entries()) {
        b.line([{ ...a, z }, { ...c, z }], darker(wall, 0.13), 1);
        const t = course % 2 ? .3 : .7;
        const joint = { x:a.x+(c.x-a.x)*t,y:a.y+(c.y-a.y)*t };
        b.line([{...joint,z:z-9},{...joint,z}],darker(wall,.16),1);
        b.line([{...a,z:z+1},{...c,z:z+1}],`${A.stoneLight}66`,.6);
      }
      b.line([{ ...a, z: 2 }, { ...c, z: 2 }], A.stoneShade, 4);
      const midpoint = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      // Recessed arcade faces follow each wall's tangent, including their masonry arch rings.
      const length=Math.hypot(c.x-a.x,c.y-a.y), tangent={x:(c.x-a.x)/length,y:(c.y-a.y)/length};
      const ap=(u:number,z:number)=>({x:midpoint.x+tangent.x*u,y:midpoint.y+tangent.y*u,z});
      const half=Math.min(7,length*.2),spring=o.height-21,rise=half*.8;
      const curve=Array.from({length:7},(_,i)=>ap(Math.cos(Math.PI-i*Math.PI/6)*half,spring+Math.sin(i*Math.PI/6)*rise));
      b.polygon([ap(-half,7),...curve,ap(half,7)],A.dark);
      b.line([ap(-half+1,8),ap(-half+1,spring)],A.woodDark,2);
      if(b.detail) for(let i=0;i<6;i++) {
        const t=Math.PI-i*Math.PI/6,q=t-Math.PI/6;
        const arch=(angle:number,outer:boolean)=>ap(Math.cos(angle)*(half+(outer?3:0)),spring+Math.sin(angle)*(rise+(outer?3:0)));
        b.polygon([arch(t,false),arch(q,false),arch(q,true),arch(t,true)],i===2||i===3?A.stoneLight:wall,A.stoneShade);
      }
      // Six genuine horizontal treads and vertical risers replace the smooth seating ramp.
      const seat=(p:Pt,q:Pt,t:number,z:number)=>({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z});
      for(let row=0;row<6;row++) {
        const t0=row/6,t1=(row+1)/6,z=o.height-(o.height-8)*t0,next=o.height-(o.height-8)*t1;
        const pa=seat(a,ia,t0,z),pc=seat(c,ic,t0,z),qa=seat(a,ia,t1,z),qc=seat(c,ic,t1,z);
        const aisle=section%7===0;
        b.polygon([pa,pc,qc,qa],aisle?A.stone:row%2?A.roofLight:A.roof);
        b.polygon([qa,qc,{...qc,z:next},{...qa,z:next}],aisle?A.stoneShade:A.roofShade);
        b.line([qa,qc],aisle?A.stoneLight:A.roofTile,1.2);
        if(b.detail&&!aisle&&row%2===1) {
          const left={x:qa.x+(qc.x-qa.x)*.16,y:qa.y+(qc.y-qa.y)*.16},right={x:qa.x+(qc.x-qa.x)*.84,y:qa.y+(qc.y-qa.y)*.84};
          b.line([{...left,z:z+1},{...right,z:z+1}],A.woodDark,3);
          b.line([{...left,z:z+3},{...right,z:z+3}],row===5?A.emerald:A.wood[2],3);
          if (row === 5 && section % 3 === 0) {
            const at = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
            b.line([{ ...at, z: z + 5 }, { ...at, z: z + 14 }], section % 2 ? A.emerald : A.goldLight, 4);
            b.line([{ ...at, z: z + 15 }, { ...at, z: z + 19 }], "#cda477", 4);
          }
        }
      }
      // Trim: a green band under a thin brass rail.
      b.line([{ ...a, z: o.height - 6 }, { ...c, z: o.height - 6 }], A.emerald, 4);
      b.line([{ ...a, z: o.height - 2 }, { ...c, z: o.height - 2 }], A.goldLight, 2);
      b.line([{ ...a, z: o.height + 1 }, { ...c, z: o.height + 1 }], A.stoneShade, 3);
      if(section%6===2) {
        const n={x:nx/Math.hypot(nx,ny),y:ny/Math.hypot(nx,ny)},bp=(u:number,z:number)=>({x:midpoint.x+tangent.x*u+n.x*.3,y:midpoint.y+tangent.y*u+n.y*.3,z});
        b.line([bp(-6,o.height-7),bp(6,o.height-7)],A.woodDark,2);
        b.polygon([bp(-5,o.height-8),bp(5,o.height-8),bp(5,o.height-22),bp(0,o.height-27),bp(-5,o.height-22)],A.emerald,A.goldDark);
        b.line([bp(-2,o.height-14),bp(2,o.height-14)],A.goldLight,1.5);
      }
      // Exposed masonry at the ends of the stands frames each entrance from above too.
      for (const [p, q] of [[a, ia], [c, ic]] as const) if (edges.some((angle) => Math.hypot(p.x - o.x - Math.cos(angle) * rx, p.y - o.y - Math.sin(angle) * ry) < 0.01)) {
        b.polygon([p, q, { ...q, z: 8 }, { ...p, z: o.height }], A.stoneShade, A.joint);
        b.line([{ ...p, z: o.height }, { ...q, z: 8 }], A.stoneLight, 4);
      }
      if (midpoint.y < o.y - o.depth * 0.08) {
        const point = (outer: Pt, inner: Pt, t: number, z: number) => ({ x: inner.x + (outer.x - inner.x) * t, y: inner.y + (outer.y - inner.y) * t, z });
        const ridgeA = point(a, ia, 0.82, o.height), ridgeC = point(c, ic, 0.82, o.height);
        b.polygon([point(a, ia, 0.55, o.height * 0.65), point(c, ic, 0.55, o.height * 0.65), ridgeC, ridgeA], A.roofLight, A.roofShade);
        b.polygon([ridgeA, ridgeC, point(c, ic, 1, o.height * 0.75), point(a, ia, 1, o.height * 0.75)], A.roof, A.roofShade);
        b.line([ridgeA, ridgeC], A.gold, 2);
        if (b.detail) for (const t of [0.64, 0.73, 0.91]) b.line([point(a, ia, t, o.height * (t < 0.82 ? 0.65 + (t - 0.55) / 0.27 * 0.35 : 1 - (t - 0.82) / 0.18 * 0.25)),
          point(c, ic, t, o.height * (t < 0.82 ? 0.65 + (t - 0.55) / 0.27 * 0.35 : 1 - (t - 0.82) / 0.18 * 0.25))], A.roofTile, 2);
      }
    } });
  }
  for (const dx of [-1, 1]) {
    const tower = { ...o, x: o.x + dx * o.width * 0.35, y: o.y + o.depth * 0.34, width: 45, depth: 42, height: o.height + 24, shape: undefined };
    architecture.push({ depth: project(view, tower).depth, draw: () => {
      cottage(b, view, tower, { wall: A.stoneLight, roof: A.roof, roofLight: A.roofLight });
      b.line([{ x: tower.x, y: tower.y, z: tower.height }, { x: tower.x, y: tower.y, z: tower.height + 26 }], A.gold, 3);
      b.polygon([{ x: tower.x, y: tower.y, z: tower.height + 26 }, { x: tower.x + 20, y: tower.y, z: tower.height + 22 }, { x: tower.x, y: tower.y, z: tower.height + 13 }], A.green);
    } });
  }
  // The entrances (ARENA_ENTRANCES): the main gate south, a side gate east, each a door in the wall.
  for (const gate of [{ angle: Math.PI / 2, width: ARENA_GATE_WIDTH, height: 64, banner: true }, { angle: 0, width: ARENA_SIDE_WIDTH, height: 54, banner: false }]) {
    architecture.push({ depth: project(view, { x: o.x + Math.cos(gate.angle) * rx, y: o.y + Math.sin(gate.angle) * ry }).depth,
      draw: () => arenaDoor(b, view, o, gate.angle, gate.width, gate.height, gate.banner) });
  }
  // Every part paints inside the arena's own box, from below its floor to above its flags.
  const box = [o.x - rx, o.x + rx].flatMap((x) => [o.y - ry, o.y + ry].flatMap((y) => [0, o.height + 70].map((z) => project(view, { x, y }, z))));
  const bounds = { x0: Math.min(...box.map((p) => p.x)), y0: Math.min(...box.map((p) => p.y)), x1: Math.max(...box.map((p) => p.x)), y1: Math.max(...box.map((p) => p.y)) };
  architecture.sort((a, c) => a.depth - c.depth).forEach((part) => capture ? capture({ ...part, bounds }) : part.draw());
}

function road(b: Brush, o: WorldObject): void {
  const points = o.points ?? [], half = (o.lineWidth ?? 30) / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, c = points[i]!, len = Math.hypot(c.x - a.x, c.y - a.y);
    if (!len) continue;
    const nx = -(c.y - a.y) / len * half, ny = (c.x - a.x) / len * half;
    b.polygon([{ x: a.x + nx, y: a.y + ny }, { x: c.x + nx, y: c.y + ny }, { x: c.x - nx, y: c.y - ny }, { x: a.x - nx, y: a.y - ny }], TERRAIN.paved.base, TERRAIN.paved.edge);
    b.line([{ x: a.x + nx * 0.83, y: a.y + ny * 0.83 }, { x: c.x + nx * 0.83, y: c.y + ny * 0.83 }], TERRAIN.paved.hi, 2);
    if (b.detail) for (let d = 9; d < len; d += 18) {
      const t = d / len, px = a.x + (c.x - a.x) * t, py = a.y + (c.y - a.y) * t;
      for (const lane of [-0.55, 0, 0.55]) {
        const stagger = lane === 0 ? 4 : 0;
        b.line([{ x: px + nx * lane, y: py + ny * lane }, { x: px + nx * (lane + 0.3), y: py + ny * (lane + 0.3) }], TERRAIN.paved.mid, 2);
        if (stagger) b.line([{ x: px - (c.x - a.x) / len * stagger, y: py - (c.y - a.y) / len * stagger }, { x: px + (c.x - a.x) / len * stagger, y: py + (c.y - a.y) / len * stagger }], TERRAIN.paved.hi, 2);
      }
    }
  }
}

type StaticGroups={surfaces:WorldObject[];flat:WorldObject[];standing:WorldObject[];water:Set<string>};
const groups=new WeakMap<WorldModel,StaticGroups>();
function staticGroups(world:WorldModel):StaticGroups {
  let known=groups.get(world);if(known)return known;
  known={surfaces:[],flat:[],standing:[],water:new Set()};
  for(const o of world.objects){
    if(o.category==='movement'||o.category==='agent')continue;
    if(o.type==='water')known.water.add(`${o.x},${o.y}`);
    if(o.category==='surface')known.surfaces.push(o);
    else if(o.metadata?.flat)known.flat.push(o);
    else known.standing.push(o);
  }
  groups.set(world,known);return known;
}

export function renderProjectedWorld(ctx: CanvasRenderingContext2D, world: WorldModel, view: Projection, camera: ProjectionCamera, width: number, height: number, materials?: ProjectedMaterials, top?: TopArt, capture?: CaptureLayer): void {
  const deviceTransform = ctx.getTransform();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2); ctx.scale(camera.scale, camera.scale); ctx.translate(-camera.x, -camera.y);
  const b = brush(ctx, view, camera.scale, materials), bounds = world.bounds;
  const corners = [{ x: bounds.x0, y: bounds.y0 }, { x: bounds.x1, y: bounds.y0 }, { x: bounds.x1, y: bounds.y1 }, { x: bounds.x0, y: bounds.y1 }];
  drawTerrainEdge(ctx, view, bounds, world.slabDepth, top?.ground);
  b.polygon(corners, COLOUR.grass);
  // Top's own ground layer when it has been captured: the same terrain, roads, water and beds.
  const ground = top?.ground;
  if (ground) onGround(ctx, view, () => ctx.drawImage(ground.image as CanvasImageSource, ground.x0, ground.y0, ground.width, ground.height));
  else b.ground(corners, 0, materials?.grass);
  const cached=staticGroups(world),waterCells=cached.water;
  // Captured scenery is sorted once with live actors by WorldCamera. Sorting every
  // ground tile and offscreen tree here duplicated that work on every camera delta.
  for (const o of (ground?[]:cached.surfaces)) {
    if (ground) continue;
    if (o.type === "road") { road(b, o); continue; }
    const wet = o.type === "water" || o.type === "pond";
    {
      const rim = footprint(o);
      if (wet) for (let i = 0; i < rim.length; i++) {
        const neighbour = [{ x: 0, y: -64 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { x: -64, y: 0 }][i];
        if (o.type === "water" && neighbour && waterCells.has(`${o.x + neighbour.x},${o.y + neighbour.y}`)) continue;
        b.polygon([rim[i]!, rim[(i + 1) % rim.length]!, { ...rim[(i + 1) % rim.length]!, z: o.elevation }, { ...rim[i]!, z: o.elevation }], TERRAIN.water.edge);
      }
      b.polygon(rim.map((p) => ({ ...p, z: o.elevation })), wet ? COLOUR.water : TERRAIN.paved.base, o.type === "pond" ? COLOUR.bank : undefined);
      if (wet) b.ground(rim, o.elevation, materials?.water);
      if (o.type === "pond") for (let i = 0; i < rim.length; i += 2) {
        const p = rim[i]!, q = rim[(i + 1) % rim.length]!;
        b.line([{ ...p, z: 1 }, { ...q, z: 1 }], i % 4 ? M.stone : M.stoneLight, 9);
      }
      if (o.type === "water") for (const [i, delta] of [{ x: 0, y: -64 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { x: -64, y: 0 }].entries()) {
        if (waterCells.has(`${o.x + delta.x},${o.y + delta.y}`)) continue;
        b.line([{ ...rim[i]!, z: 0 }, { ...rim[(i + 1) % rim.length]!, z: 0 }], TERRAIN.grass.shade, 5);
        b.line([{ ...rim[i]!, z: o.elevation }, { ...rim[(i + 1) % rim.length]!, z: o.elevation }], TERRAIN.water.edge, 3);
      }
      if (wet && (Math.round(o.x / 64) + Math.round(o.y / 64)) % 3 === 0) b.line([{ x: o.x - o.width * 0.2, y: o.y, z: o.elevation + 0.2 }, { x: o.x + o.width * 0.2, y: o.y, z: o.elevation + 0.2 }], "#8fc9df", 2);
    }
  }
  // Flat art lies on the ground, under everything standing.
  for (const o of depthOrder(view,cached.flat)) picture(ctx,view,o,top);
  const standing=cached.standing;
  for (const o of (ground?[]:standing)) {
    // Top's ground layer already carries its own shadows.
    if (ground || o.height < 12) continue;
    const at = project(view, o);
    if (Math.abs(at.x - camera.x) > width / camera.scale / 2 + o.width || Math.abs(at.y - camera.y) > height / camera.scale / 2 + o.depth) continue;
    const radius = o.type === "tree" ? o.width * 0.34 : o.width * 0.52;
    b.polygon(Array.from({ length: 8 }, (_, i) => ({ x: o.x + Math.cos(i * Math.PI / 4) * radius,
      y: o.y + Math.sin(i * Math.PI / 4) * (o.type === "tree" ? radius * 0.6 : o.depth * 0.5), z: 0.1 })), "#163e2438");
  }
  const near=standing.filter(o=>{
    const centre=project(view,o,o.height/2),reach=o.width+o.depth+o.height;
    return Math.abs(centre.x-camera.x)<=width/camera.scale/2+reach&&Math.abs(centre.y-camera.y)<=height/camera.scale/2+reach;
  });
  for (const o of (capture?near:depthOrder(view,near))) {
    if (o.type === "arena") { arena(b, view, o, () => arenaFloor(ctx, view, top), capture); continue; }
    const resolve = (ref: ArtRef): ArtFrame | null => {
      const captured = top?.art?.(ref); if (captured) return captured;
      const sprite = materials?.sprites.get(ref.key); if (!sprite) return null;
      const frame = typeof ref.frame === "number" ? ref.frame : 0;
      const columns = Math.max(1, Math.floor(sprite.image.width / sprite.width));
      return { image: sprite.image, x: frame % columns * sprite.width, y: Math.floor(frame / columns) * sprite.height, width: sprite.width, height: sprite.height };
    };
    if (o.type === "bridge") {
      const corners = footprint(o).flatMap((p) => [0, o.elevation + o.height + 12].map((z) => project(view, p, z)));
      const part = { depth: project(view, o).depth, draw: () => prism(b, view, o, COLOUR.wall, M.woodLight),
        bounds: { x0: Math.min(...corners.map((p) => p.x)) - 4, y0: Math.min(...corners.map((p) => p.y)) - 4, x1: Math.max(...corners.map((p) => p.x)) + 4, y1: Math.max(...corners.map((p) => p.y)) + 4 } };
      if (capture) capture(part); else part.draw();
    } else {
      const part = fixedObjectLayer(ctx, view, o, camera.scale, resolve);
      if (capture) capture(part);
      else if (part.drawScreen) {
        ctx.save(); ctx.setTransform(deviceTransform); part.drawScreen(camera, width, height); ctx.restore();
      } else part.draw();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Explicit view entry points share geometry/art; only their orthographic basis differs. */
export const renderIsometricView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "isometric", camera, w, h);
export const renderFrontView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "front", camera, w, h);
export const renderBackView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "back", camera, w, h);
export const renderLeftView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "left", camera, w, h);
export const renderRightView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "right", camera, w, h);
