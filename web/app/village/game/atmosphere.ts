import type { WorldModel } from "../../../lib/world/model";
import type { Pt } from "../../../lib/world/world";
import { COLOSSEUM, ARENA_ENTRANCES } from "../../../lib/world/arena-geometry";

type Screen = (point: Pt, z?: number) => Pt;
const sources = new WeakMap<WorldModel, { x: number; y: number; z: number }[]>();
const ripples = new WeakMap<WorldModel, Pt[]>();

/** Cheap animated water for CPU renderers and browsers without WebGL2. */
export function drawWaterRipples(ctx: CanvasRenderingContext2D, world: WorldModel, screen: Screen, width: number, height: number, seconds: number): void {
  let anchors = ripples.get(world);
  if (!anchors) {
    const tiles = world.objects.filter((o) => o.type === "water");
    const stride = Math.max(1, Math.ceil(tiles.length / 160));
    anchors = tiles.filter((_, i) => i % stride === 0).map((o) => ({ x: o.x, y: o.y }));
    ripples.set(world, anchors);
  }
  ctx.save(); ctx.strokeStyle = "#c2e2d1"; ctx.lineWidth = 1;
  for (const [i, p] of anchors.entries()) {
    const at = screen(p);
    if (at.x < -12 || at.x > width + 12 || at.y < -12 || at.y > height + 12) continue;
    const phase = seconds * .8 + i * 2.3, drift = Math.sin(phase) * 3;
    const left = screen({ x: p.x - 8 + drift, y: p.y }), right = screen({ x: p.x + 8 + drift, y: p.y });
    ctx.globalAlpha = .12 + (Math.sin(phase) + 1) * .11;
    ctx.beginPath(); ctx.moveTo(Math.round(left.x), Math.round(left.y)); ctx.lineTo(Math.round(right.x), Math.round(right.y)); ctx.stroke();
  }
  ctx.restore();
}
function chimneys(world: WorldModel) {
  let known = sources.get(world);
  if (!known) {
    known = world.objects.filter((o) => o.type === "building" && /house|cottage|tavern|forge/.test(o.metadata?.texture ?? o.metadata?.art?.key ?? o.id))
      .slice(0, 24).map((o) => ({ x: o.x + o.width * 0.12, y: o.y, z: o.height * 0.9 }));
    sources.set(world, known);
  }
  return known;
}

/** Bounded screen-space effects, using shared world anchors; no textures or simulation entities. */
export function drawAtmosphere(ctx: CanvasRenderingContext2D, world: WorldModel, screen: Screen, width: number, height: number,
  zoom: number, seconds: number, reduced: boolean, night: boolean): void {
  const t = reduced ? 0 : seconds, k = Math.max(0.35, Math.min(1.5, zoom));
  ctx.save(); ctx.imageSmoothingEnabled = false;
  // Smoke rises from a handful of existing roofs, culled before the tiny pixel particles are drawn.
  if (!reduced && zoom >= 0.22) for (const [i, chimney] of chimneys(world).entries()) {
    const at = screen(chimney, chimney.z);
    if (at.x < -30 || at.x > width + 30 || at.y < -30 || at.y > height + 60) continue;
    for (let n = 0; n < 3; n++) {
      const age = (t * 0.22 + n / 3 + i * 0.17) % 1, size = (3 + age * 8) * k;
      ctx.globalAlpha = (1 - age) * (night ? 0.2 : 0.3); ctx.fillStyle = night ? "#c1c2bc" : "#e4dfc8";
      ctx.fillRect(Math.round(at.x + Math.sin(age * 4 + i) * 12 * k), Math.round(at.y - age * 55 * k), Math.ceil(size), Math.ceil(size * 0.65));
    }
  }
  ctx.globalAlpha = 1;
  // Two entrance pennants. These are decoration, never extra selectable/collidable objects.
  for (const side of [-1, 1]) {
    const anchor = { x: ARENA_ENTRANCES.front.x + side * 135, y: ARENA_ENTRANCES.front.y + 26 };
    const base = screen(anchor), top = screen(anchor, 72);
    if (base.x < -40 || base.x > width + 40 || base.y < -40 || top.y > height + 40) continue;
    ctx.strokeStyle = "#604c2d"; ctx.lineWidth = Math.max(1, 2 * k); ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
    const flutter = Math.round(Math.sin(t * 2.5 + side) * 2 * k), w = Math.max(8, Math.round(23 * k)), h = Math.max(13, Math.round(37 * k));
    ctx.fillStyle = side === 1 ? "#237853" : "#296e69"; ctx.fillRect(Math.round(top.x), Math.round(top.y + 3 * k), w, h + flutter);
    ctx.fillStyle = "#e5bf65"; ctx.fillRect(Math.round(top.x), Math.round(top.y + 3 * k), w, Math.max(1, Math.round(2 * k)));
    ctx.fillRect(Math.round(top.x + w / 2 - k), Math.round(top.y + 13 * k), Math.max(2, Math.round(3 * k)), Math.max(4, Math.round(9 * k)));
  }
  if (night) {
    // Existing lamps carry a small warm core. No blur, bloom or large additive glow.
    for (const side of [-1, 1]) {
      const at = screen({ x: COLOSSEUM.x + side * 330, y: COLOSSEUM.y + 100 }, 38);
      ctx.fillStyle = "#ffe0a0"; ctx.fillRect(Math.round(at.x - 2 * k), Math.round(at.y - 3 * k), Math.max(2, 4 * k), Math.max(3, 6 * k));
    }
  }
  ctx.restore();
}

/** Clouds are translucent ground shadows, with fixed anchors and no texture allocation. */
export function drawCloudShadows(ctx: CanvasRenderingContext2D, screen: Screen, width: number, height: number, seconds: number, reduced: boolean): void {
  if (reduced) return;
  ctx.save(); ctx.fillStyle = "#183227"; ctx.globalAlpha = 0.055;
  for (let i = 0; i < 3; i++) {
    const x = ((seconds * 10 + i * 1150) % 4800) - 900, y = 300 + i * 330;
    const corners = [{ x, y }, { x: x + 340, y: y - 65 }, { x: x + 620, y: y + 35 }, { x: x + 380, y: y + 145 }, { x: x + 70, y: y + 120 }].map((p) => screen(p));
    if (corners.every((p) => p.x < 0) || corners.every((p) => p.x > width) || corners.every((p) => p.y < 0) || corners.every((p) => p.y > height)) continue;
    ctx.beginPath(); corners.forEach((p, j) => j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
