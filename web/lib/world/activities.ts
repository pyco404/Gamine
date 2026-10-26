import { canSpar } from "./character";

export type Point = { x: number; y: number };

/** Cosmetic world behavior only. Bluff & Fold alone earns rewards; these completions never affect scoring or payouts. */
export const ACTIVITY_TYPES = ["farming", "gathering", "delivery", "exploration", "sparring"] as const;
export type Activity = (typeof ACTIVITY_TYPES)[number];
export type Capability = "farm" | "gather" | "delivery-source" | "delivery-target" | "explore" | "spar";
export type ActivityDestination = Point & {
  id: string; name: string; capabilities: readonly Capability[]; capacity: number;
};
export const ACTIVITY_CONFIG = {
  tickMs: 250, routesPerTick: 8, pace: 0.85, speed: 95,
  initialRestMs: [1_000, 14_000], restMs: [8_000, 22_000], retryMs: 5_000,
  workMs: { farming: [24_000, 48_000], gathering: [16_000, 32_000], delivery: [4_000, 8_000], exploration: [8_000, 24_000], sparring: [45_000, 75_000] },
  sparringMs: [12_000, 20_000],
} as const;
/** A friendly practice bout, separate from Bluff & Fold and its match records. */
export type SparringState = { id: string; partnerId: string; partnerPosition: Point; startedAt: number; endsAt: number; side: 0 | 1 };
export type NoticeJob = { id: string; title: string; expiresAt: number; capacity: number; activity: Activity; sourceId: string | null; targetId: string };
export type ActivityPlan = { activity: Activity; source: ActivityDestination | null; target: ActivityDestination; job?: NoticeJob };
export type ActivityResult = {
  id: string; agentId: string; activity: Activity; sourceId: string | null;
  destinationId: string; startedAt: number; completedAt: number; distance: number; success: true; jobId?: string; partnerId?: string;
};
export type ActivityState = {
  activity: Activity | "idle"; phase: "traveling" | "working" | "returning" | "resting";
  destinationId: string | null; destination: string; route: string | null;
  startedAt: number; completesAt: number | null; progress: number; carrying?: boolean; job?: NoticeJob; sparring?: SparringState;
};
export type ActivityEntry = {
  id: string; home: Point; cycle: number; plan: ActivityPlan | null;
  phase: ActivityState["phase"]; leg: "source" | "target" | "home";
  startedAt: number; phaseAt: number; until: number; moving: boolean;
  endpoint: Point | null; trip: number; distance: number; recent: ActivityResult[]; path: Point[]; sparring?: SparringState;
};
type Entry = ActivityEntry;
export type ActivityHost = {
  position: (id: string) => Point | null;
  /** Return null for unreachable goals; never silently move to a distant substitute. */
  prepare: (id: string, destination: Point) => Point[] | null;
  travel: (id: string, path: Point[], arrived: () => void) => void;
  rest: (id: string, resting: boolean) => void;
  assignJob?: (id: string, plan: ActivityPlan, now: number) => NoticeJob | undefined;
};

export function activityHash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}
const hash = activityHash;
function random(seed: string): () => number {
  let n = hash(seed);
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}
const duration = (range: readonly [number, number], rand: () => number) => range[0] + rand() * (range[1] - range[0]);
function pick<T>(items: readonly T[], weight: (item: T) => number, rand: () => number): T | null {
  let at = rand() * items.reduce((sum, item) => sum + weight(item), 0);
  for (const item of items) { at -= weight(item); if (at < 0) return item; }
  return items.at(-1) ?? null;
}

/** Stable preferences, independent of rendering, network updates and iteration order. */
export function activityPreferences(id: string): Record<Activity, number> {
  const rand = random(`preference:${id}`), favorite = Math.floor(rand() * ACTIVITY_TYPES.length);
  const weights = Object.fromEntries(ACTIVITY_TYPES.map((type, i) => [type, i === favorite ? 45 : 10 + Math.floor(rand() * 16)])) as Record<Activity, number>;
  // Armed residents spend more of their free time practicing together.
  weights.sparring = canSpar(id) ? 120 : 0;
  return weights;
}
export function chooseActivity(id: string, cycle: number, from: Point, destinations: readonly ActivityDestination[]): ActivityPlan | null {
  const rand = random(`activity:${id}:${cycle}`), weights = activityPreferences(id);
  const capability: Record<Activity, Capability> = { farming: "farm", gathering: "gather", delivery: "delivery-source", exploration: "explore", sparring: "spar" };
  const available = ACTIVITY_TYPES.filter((type) => weights[type] > 0 && destinations.some((d) => d.capabilities.includes(capability[type]) &&
    (type !== "delivery" || destinations.some((target) => target.id !== d.id && target.capabilities.includes("delivery-target")))));
  const activity = pick(available, (type) => weights[type], rand);
  if (!activity) return null;
  const local = (d: ActivityDestination) => 1 / (1 + Math.hypot(d.x - from.x, d.y - from.y) / 800) ** 2;
  const first = pick(destinations.filter((d) => d.capabilities.includes(capability[activity]) && (activity !== "delivery" ||
    destinations.some((target) => target.id !== d.id && target.capabilities.includes("delivery-target")))), local, rand)!;
  const target = activity === "delivery" ? pick(destinations.filter((d) => d.id !== first.id && d.capabilities.includes("delivery-target")), local, rand)! : first;
  return { activity, source: activity === "delivery" ? first : null, target };
}

/** A single bounded tick drives every agent. Walking is delegated to the existing world router. */
export class ActivitySimulation {
  private entries = new Map<string, Entry>();
  private lastTick = -Infinity;
  private cursor = 0;
  private now = 0;
  constructor(readonly destinations: readonly ActivityDestination[], private host: ActivityHost) {}

  has(id: string): boolean { return this.entries.has(id); }
  add(id: string, home: Point, now: number): void {
    const existing = this.entries.get(id);
    if (existing) { existing.home = home; return; }
    this.entries.set(id, { id, home, cycle: 0, plan: null, phase: "resting", leg: "home", startedAt: now, phaseAt: now,
      until: now + duration(ACTIVITY_CONFIG.initialRestMs, random(id)), moving: false, endpoint: null, trip: 0, distance: 0, recent: [], path: [] });
    this.host.rest(id, true);
  }
  remove(id: string): void {
    const partner = this.entries.get(this.entries.get(id)?.sparring?.partnerId ?? "");
    if (partner?.sparring?.partnerId === id) this.rest(partner, this.now);
    this.entries.delete(id); this.host.rest(id, false);
  }
  recent(id: string): readonly ActivityResult[] { return this.entries.get(id)?.recent ?? []; }
  save(): ActivityEntry[] { return structuredClone([...this.entries.values()]); }
  get routingCursor(): number { return this.cursor; }
  /** Resume the saved journey/work/rest with fresh callbacks after a process restart. */
  restore(saved: ActivityEntry[], now: number, cursor = 0): void {
    this.now = now;
    this.cursor = cursor;
    this.entries = new Map(structuredClone(saved).map((e) => [e.id, e]));
    for (const e of this.entries.values()) {
      if (e.moving) this.travel(e);
      else this.host.rest(e.id, e.phase === "resting");
    }
  }

  state(id: string, now: number): ActivityState | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const dest = e.leg === "source" ? e.plan?.source : e.plan?.target;
    return { activity: e.plan?.activity ?? "idle", phase: e.phase,
      destinationId: e.leg === "home" ? null : dest?.id ?? null,
      destination: e.leg === "home" ? "Home forecourt" : dest?.name ?? "Home forecourt",
      route: e.plan?.source ? `${e.plan.source.name} → ${e.plan.target.name}` : null,
      carrying: e.plan?.activity === "delivery" && e.leg === "target",
      ...(e.plan?.job ? { job: e.plan.job } : {}),
      ...(e.sparring ? { sparring: e.sparring } : {}),
      startedAt: e.phaseAt, completesAt: e.until > e.phaseAt ? e.until : null,
      progress: e.until > e.phaseAt ? Math.max(0, Math.min(e.moving ? 0.95 : 1, (now - e.phaseAt) / (e.until - e.phaseAt))) : 0 };
  }

  tick(now: number): void {
    this.now = now;
    if (now - this.lastTick < ACTIVITY_CONFIG.tickMs) return;
    this.lastTick = now;
    const entries = [...this.entries.values()];
    if (!entries.length) return;
    this.pairSparring(entries, now);
    const occupied = new Map<string, number>();
    const reserve = (p: ActivityPlan) => {
      for (const d of [p.source, p.target]) if (d) occupied.set(d.id, (occupied.get(d.id) ?? 0) + 1);
    };
    for (const e of entries) if (e.plan) reserve(e.plan);
    let budget = ACTIVITY_CONFIG.routesPerTick;
    const start = this.cursor % entries.length;
    for (let i = 0; i < entries.length; i++) {
      const index = (start + i) % entries.length, e = entries[index]!;
      if (e.plan?.job && now >= e.plan.job.expiresAt) { e.trip++; this.rest(e, now); continue; }
      if (e.moving) continue;
      if (e.phase === "working") {
        if (now < e.until) continue;
        // A warm-up without a partner is not a completed fight.
        if (e.plan?.activity === "sparring" && !e.sparring) { this.rest(e, now); continue; }
        if (e.leg === "source") {
          e.leg = "target"; e.phase = "traveling"; e.phaseAt = now; e.until = now;
        } else {
          const plan = e.plan!;
          e.recent.unshift({ id: `${e.id}:${e.startedAt}:${e.cycle}`, agentId: e.id, activity: plan.activity, sourceId: plan.source?.id ?? null,
            destinationId: plan.target.id, startedAt: e.startedAt, completedAt: now, distance: e.distance, success: true,
            ...(plan.job ? { jobId: plan.job.id } : {}), ...(e.sparring ? { partnerId: e.sparring.partnerId } : {}) });
          e.recent.length = Math.min(e.recent.length, 4);
          e.plan = null; e.leg = "home"; e.phase = "returning"; e.phaseAt = now; e.until = now;
          delete e.sparring;
        }
      }
      if (e.phase === "resting") {
        if (now < e.until || budget <= 0) continue;
        const position = this.host.position(e.id);
        if (!position) continue;
        e.cycle++;
        e.plan = chooseActivity(e.id, e.cycle, position, this.destinations.filter((d) => (occupied.get(d.id) ?? 0) < d.capacity));
        if (!e.plan) { e.until = now + ACTIVITY_CONFIG.retryMs; continue; }
        const job = this.host.assignJob?.(e.id, e.plan, now);
        if (job) e.plan.job = job;
        reserve(e.plan);
        e.startedAt = now; e.phaseAt = now; e.until = now; e.distance = 0;
        e.leg = e.plan.source ? "source" : "target"; e.phase = "traveling";
      }
      if (budget <= 0) continue;
      budget--;
      this.cursor = index + 1;
      const destination = e.leg === "home" ? e.home : (e.leg === "source" ? e.plan!.source! : e.plan!.target);
      // Stable spacing within the destination area avoids a single pile of bodies.
      const seed = hash(`${e.id}:${e.leg}`);
      const to = e.leg === "home" ? destination : { x: destination.x + (seed % 7 - 3) * 12, y: destination.y + (Math.floor(seed / 7) % 5 - 2) * 10 };
      const path = this.host.prepare(e.id, to);
      if (!path?.length) { this.rest(e, now, ACTIVITY_CONFIG.retryMs); continue; }
      const length = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y), 0);
      e.distance += length; e.endpoint = path.at(-1)!; e.moving = true; e.phaseAt = now;
      e.until = now + length / (ACTIVITY_CONFIG.speed * ACTIVITY_CONFIG.pace) * 1000;
      e.path = path; e.trip++;
      this.host.rest(e.id, false);
      this.travel(e);
    }
  }
  /** Pair only neighbours that have actually arrived. Capacity keeps this search bounded. */
  private pairSparring(entries: Entry[], now: number): void {
    for (const e of entries) if (e.sparring) {
      const other = this.entries.get(e.sparring.partnerId);
      if (!canSpar(e.id) || !canSpar(other?.id ?? "") || other?.sparring?.id !== e.sparring.id || other.plan?.activity !== "sparring" || other.phase !== "working") this.rest(e, now);
    }
    const waiting = entries.filter((e) => canSpar(e.id) && e.plan?.activity === "sparring" && e.phase === "working" && !e.moving && !e.sparring && now < e.until)
      .sort((a, b) => hash(`${a.id}:${a.cycle}`) - hash(`${b.id}:${b.cycle}`));
    for (const a of waiting) {
      if (a.sparring) continue;
      const pa = this.host.position(a.id);
      if (!pa) continue;
      const b = waiting.find((e) => {
        if (e === a || e.sparring || e.plan!.target.id !== a.plan!.target.id) return false;
        const p = this.host.position(e.id);
        return p && Math.abs(p.x - pa.x) >= 24 && Math.abs(p.y - pa.y) <= 28 && Math.hypot(p.x - pa.x, p.y - pa.y) <= 96;
      });
      if (!b) continue;
      const pb = this.host.position(b.id)!;
      const id = `${a.id}:${a.cycle}:${b.id}:${b.cycle}:${now}`;
      const endsAt = now + duration(ACTIVITY_CONFIG.sparringMs, random(id));
      a.sparring = { id, partnerId: b.id, partnerPosition: pb, startedAt: now, endsAt, side: 0 };
      b.sparring = { id, partnerId: a.id, partnerPosition: pa, startedAt: now, endsAt, side: 1 };
      a.phaseAt = b.phaseAt = now; a.until = b.until = endsAt;
    }
  }
  private travel(e: Entry): void {
      const leg = e.leg, trip = e.trip;
      this.host.travel(e.id, e.path, () => {
        // A match, retirement or replacement cancels this exact entry and its callback.
        if (this.entries.get(e.id) !== e || !e.moving || e.leg !== leg || e.trip !== trip) return;
        e.moving = false;
        const position = this.host.position(e.id);
        if (!position || Math.hypot(position.x - e.endpoint!.x, position.y - e.endpoint!.y) > 6) {
          this.rest(e, this.now, ACTIVITY_CONFIG.retryMs); return;
        }
        if (leg === "home") this.rest(e, this.now);
        else {
          e.phase = "working"; e.phaseAt = this.now;
          e.until = this.now + duration(ACTIVITY_CONFIG.workMs[e.plan!.activity], random(`work:${e.id}:${e.cycle}:${leg}`));
        }
      });
  }
  private rest(e: Entry, now: number, ms = duration(ACTIVITY_CONFIG.restMs, random(`rest:${e.id}:${e.cycle}`))): void {
    delete e.sparring;
    e.plan = null; e.phase = "resting"; e.leg = "home"; e.phaseAt = now; e.until = now + ms; e.moving = false;
    e.path = [];
    this.host.rest(e.id, true);
  }
}

export function describeActivity(state: ActivityState): string {
  if (state.phase === "returning") return "Returning to rest";
  if (state.phase === "resting") return "Resting";
  const name = { farming: "Farming", gathering: "Gathering", delivery: "Delivery", exploration: "Exploring", sparring: "Friendly sparring", idle: "Resting" }[state.activity];
  if (state.phase === "traveling") return `${name} · traveling`;
  if (state.activity === "sparring" && !state.sparring) return "Warming up · waiting for a partner";
  return state.activity === "delivery" ? `Delivery · ${state.destinationId && state.route?.startsWith(state.destination) ? "collecting" : "unloading"}` : name;
}
