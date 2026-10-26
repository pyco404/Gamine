import type { WorldModel } from "./model";
import { DISTRICTS } from "./districts";

export type GroundDetail = { x: number; y: number; kind: "grass" | "flowers" | "pebbles"; variant: number };

/** Flat decoration only. No new obstacles, destinations or simulation state. */
export function groundDetail(world: WorldModel): GroundDetail[] {
  let seed = 0x6a4d19;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const wet = new Set(world.map.terrain.filter(([, , key]) => key === "terrain-water").map(([x, y]) => `${x},${y}`));
  const dry = new Set(world.map.terrain.filter(([, , key]) => key !== "terrain-water").map(([x, y]) => `${x},${y}`));
  const safe = (x: number, y: number) => {
    const cell = `${Math.floor(x / 64)},${Math.floor(y / 64)}`;
    if (wet.has(cell) && !dry.has(cell)) return false;
    if (world.lots.some((b) => x > b.x0 - 12 && x < b.x1 + 12 && y > b.y0 - 12 && y < b.y1 + 12)) return false;
    if (world.objects.some((o) => o.type === "pond" || o.type === "arena" ?
      ((x - o.x) / (o.width / 2 + 18)) ** 2 + ((y - o.y) / (o.depth / 2 + 18)) ** 2 < 1 : false)) return false;
    return !world.map.paths.some((road) => road.points.some(([ax, ay], i) => {
      const next = road.points[i + 1]; if (!next) return false;
      const [bx, by] = next, dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - ax - t * dx, y - ay - t * dy) < road.width / 2 + 18;
    }));
  };
  const details: GroundDetail[] = [];
  for (const d of DISTRICTS) for (let i = 0; i < 64; i++) {
    const a = random() * Math.PI * 2, r = Math.sqrt(random());
    const x = Math.round(d.x + Math.cos(a) * d.rx * r), y = Math.round(d.y + Math.sin(a) * d.ry * r);
    if (x < world.bounds.x0 || x > world.bounds.x1 || y < world.bounds.y0 || y > world.bounds.y1 || !safe(x, y)) continue;
    const variant = Math.floor(random() * 4);
    details.push({ x, y, variant, kind: d.terrain === "rock" ? "pebbles" : i % 4 === 0 ? "flowers" : "grass" });
  }
  return details;
}
