import { eq, gt, isNull } from "drizzle-orm";
import type { Db } from "./client.js";
import { agents, matches, worldActivities } from "./schema.js";
import { activitySnapshot, noticeJobs, WorldSimulation, type WorldCheckpoint } from "../../web/lib/world/simulation.js";
import { ACTIVITY_DESTINATIONS } from "../../web/lib/world/activity-destinations.js";
import { worldNavigation } from "../world/navigation.js";
import { PLAY_MS } from "../http/live.js";

const ID = "gamine-world";
const POLL_MS = 2_000;
let navigation: { population: number; value: ReturnType<typeof worldNavigation> } | null = null;

/** Read-only snapshots shared by Field and Agent; this request cannot finish a job or award anything. */
export async function readWorldActivities(db: Db, now: number) {
  const [row] = await db.select().from(worldActivities).where(eq(worldActivities.id, ID));
  const checkpoint = row?.checkpoint;
  return { activities: new Map((checkpoint?.entries ?? []).map((e) => [e.id,
    activitySnapshot(e, checkpoint!.positions[e.id] ?? e.home, now)])),
    jobs: noticeJobs(now, ACTIVITY_DESTINATIONS).map((job) => ({ ...job, accepted: checkpoint?.claims[job.id]?.length ?? 0 })),
  };
}

/** A row lock serializes API replicas. One committed checkpoint includes journeys, completions and job claims. */
export async function tickWorldActivities(db: Db, now = Date.now()): Promise<void> {
  const empty: WorldCheckpoint = { version: 1, at: now - POLL_MS, entries: [], positions: {}, claims: {} };
  await db.insert(worldActivities).values({ id: ID, checkpoint: empty, updatedAt: new Date(now) }).onConflictDoNothing();
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(worldActivities).where(eq(worldActivities.id, ID)).for("update");
    if (!row || now - row.checkpoint.at < POLL_MS) return;
    const residents = await tx.select({ id: agents.id, ownerId: agents.ownerId }).from(agents).where(isNull(agents.retiredAt)).orderBy(agents.createdAt, agents.id);
    const population = Math.max(row.checkpoint.population ?? 0, residents.filter((r) => r.ownerId !== null).length);
    if (!navigation || navigation.population !== population) navigation = { population, value: worldNavigation(population) };
    const nav = navigation.value;
    const recent = await tx.select({ a: matches.agentA, b: matches.agentB }).from(matches).where(gt(matches.createdAt, new Date(now - PLAY_MS)));
    const interrupted = new Set(recent.flatMap((m) => [m.a, m.b]));
    const world = new WorldSimulation(ACTIVITY_DESTINATIONS, nav.route, row.checkpoint);
    const previous = new Map(row.checkpoint.entries.map((e) => [e.id, e.home]));
    const used = new Set([...previous.values()].map((p) => `${p.x},${p.y}`));
    let homeIndex = 0;
    world.sync(residents.map((r) => {
      let home = previous.get(r.id);
      if (!home || !nav.ground.walkable(home)) {
        while (homeIndex < nav.homes.length && used.has(`${nav.homes[homeIndex]!.x},${nav.homes[homeIndex]!.y}`)) homeIndex++;
        home = nav.home(r.id, homeIndex++); used.add(`${home.x},${home.y}`);
      }
      return { id: r.id, home, interrupted: interrupted.has(r.id) };
    }), row.checkpoint.at);
    // Bound outage recovery. Resume saved travel/work once; never loop through hours of fictitious completions.
    const start = Math.max(row.checkpoint.at, now - 60_000);
    for (let at = start + 1_000; at <= now; at += 1_000) world.tick(at);
    world.tick(now);
    await tx.update(worldActivities).set({ checkpoint: { ...world.save(), population }, updatedAt: new Date(now) }).where(eq(worldActivities.id, ID));
  });
}

/** Starts independently of viewers and never overlaps its own database pass. */
export async function startWorldActivities(db: Db, options: { onError?: (error: unknown) => void } = {}) {
  await tickWorldActivities(db);
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const next = () => { if (!stopped) timer = setTimeout(() => void once(), POLL_MS); };
  const once = async () => {
    try { await tickWorldActivities(db); } catch (error) { options.onError?.(error); }
    next();
  };
  next();
  return { stop: () => { stopped = true; if (timer) clearTimeout(timer); } };
}
