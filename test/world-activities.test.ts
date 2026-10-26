import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { WorldSimulation, motionPosition, noticeJobs, JOB_WINDOW_MS, activitySnapshot } from "../web/lib/world/simulation.js";
import { type ActivityDestination, type Point } from "../web/lib/world/activities.js";
import { connect, migrate } from "../src/db/client.js";
import { agents, dailyScores, matches, worldActivities } from "../src/db/schema.js";
import { tickWorldActivities, readWorldActivities } from "../src/db/world-activities.js";
import { createAgent, field } from "../src/db/runner.js";
import { worldNavigation } from "../src/world/navigation.js";
import { ACTIVITY_DESTINATIONS } from "../web/app/village/game/activity-destinations.js";

import { canSpar } from "../web/lib/world/character.js";

const farm: ActivityDestination = { id: "farm", name: "Farm", x: 160, y: 0, capabilities: ["farm"], capacity: 2000 };
const route = (from: Point, to: Point) => [from, to];
const resident = (id = "a") => ({ id, home: { x: 0, y: 0 } });

describe("persisted cosmetic activities", () => {
  it("pairs nearby sparring partners after arrival, resumes a bout, and completes it once without rewards", () => {
    const green: ActivityDestination = { id: "green", name: "Practice green", x: 100, y: 100, capabilities: ["spar"], capacity: 24 };
    let world = new WorldSimulation([green], route);
    world.sync(Array.from({ length: 24 }, (_, i) => resident(`spar-${i}`)), 0);
    let at = 0;
    while (at < 60_000 && !world.save().entries.some((e) => e.sparring)) { at += 1000; world.tick(at); }
    const saved = world.save(), a = saved.entries.find((e) => e.sparring)!;
    expect(a?.phase).toBe("working"); expect(a?.moving).toBe(false);
    const b = saved.entries.find((e) => e.id === a.sparring!.partnerId)!;
    expect(b.sparring).toMatchObject({ id: a.sparring!.id, partnerId: a.id, endsAt: a.until });
    expect(Math.hypot(saved.positions[a.id]!.x - saved.positions[b.id]!.x, saved.positions[a.id]!.y - saved.positions[b.id]!.y)).toBeLessThanOrEqual(96);
    world = new WorldSimulation([green], route, JSON.parse(JSON.stringify(saved)));
    expect(activitySnapshot(world.save().entries.find((e) => e.id === a.id)!, world.position(a.id)!, at).state.sparring).toEqual(a.sparring);
    world.tick(a.until + 1000); world.tick(a.until + 1000);
    for (const [id, partnerId] of [[a.id, b.id], [b.id, a.id]]) {
      const completed = world.simulation.recent(id!).filter((r) => r.partnerId === partnerId);
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ activity: "sparring", partnerId, success: true });
      for (const key of ["winner", "score", "damage", "xp", "reward", "payout"]) expect(completed[0]).not.toHaveProperty(key);
    }
    // Interrupting one partner for a real match cancels both sides of an unfinished bout.
    world = new WorldSimulation([green], route, saved);
    world.sync(saved.entries.map((e) => ({ id: e.id, home: e.home, interrupted: e.id === a.id })), at);
    expect(world.simulation.has(a.id)).toBe(false);
    expect(world.simulation.state(b.id, at)?.sparring).toBeUndefined();
    expect(world.simulation.recent(b.id)).toHaveLength(0);
  });

  it("pairs only armed idle residents and resumes their town routines after an interrupted game", () => {
    const green: ActivityDestination = { id: "green", name: "Practice green", x: 100, y: 100, capabilities: ["spar"], capacity: 24 };
    const people = Array.from({ length: 36 }, (_, i) => resident(`resident-${i}`));
    const world = new WorldSimulation([green], route);
    world.sync(people, 0);
    let at = 0;
    while (at < 60_000 && !world.save().entries.some((e) => e.sparring)) { at += 1000; world.tick(at); }
    const saved = world.save(), fighter = saved.entries.find((e) => e.sparring)!;
    expect(fighter).toBeDefined();
    for (const e of saved.entries) {
      if (e.sparring) { expect(canSpar(e.id)).toBe(true); expect(canSpar(e.sparring.partnerId)).toBe(true); }
      if (!canSpar(e.id)) expect(e.plan?.activity).not.toBe("sparring");
    }
    const partner = fighter.sparring!.partnerId;
    world.sync(people.map((r) => ({ ...r, interrupted: r.id === fighter.id })), at);
    expect(world.simulation.has(fighter.id)).toBe(false);
    expect(world.simulation.state(partner, at)?.sparring).toBeUndefined();
    for (let next = at + 1000; next <= at + 30_000; next += 1000) world.tick(next);
    expect(world.save().entries.some((e) => e.sparring?.partnerId === fighter.id)).toBe(false);
    world.sync(people, at + 31_000);
    expect(world.simulation.has(fighter.id)).toBe(true);
    expect(world.simulation.state(fighter.id, at + 31_000)?.phase).toBe("resting");
  });

  it("does not fabricate a fight when a lone agent cannot find a partner", () => {
    const green: ActivityDestination = { id: "green", name: "Practice green", x: 100, y: 100, capabilities: ["spar"], capacity: 24 };
    const world = new WorldSimulation([green], route);
    world.sync([resident()], 0);
    for (let at = 1000; at <= 240_000; at += 1000) world.tick(at);
    expect(world.simulation.recent("a")).toHaveLength(0);
  });

  it("interpolates along each bend, clamps stale feeds, and never cuts a corner", () => {
    const motion = { path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], startedAt: 1000, endsAt: 3000 };
    expect(motionPosition(motion, 500)).toEqual({ x: 0, y: 0 });
    expect(motionPosition(motion, 1500)).toEqual({ x: 50, y: 0 });
    expect(motionPosition(motion, 2500)).toEqual({ x: 100, y: 50 });
    expect(motionPosition(motion, 9000)).toEqual({ x: 100, y: 100 });
  });

  it("resumes a saved journey, work and rest with one completion after reconstructing the worker", () => {
    let world = new WorldSimulation([farm], route);
    world.sync([resident()], 0); world.tick(20_000);
    const moving = world.save();
    expect(moving.entries[0]?.moving).toBe(true);
    const mid = moving.entries[0]!.until - 500;
    world.tick(mid);
    const before = world.position("a");
    world = new WorldSimulation([farm], route, JSON.parse(JSON.stringify(world.save())));
    expect(world.position("a")).toEqual(before);
    world.tick(moving.entries[0]!.until + 1);
    const working = world.save();
    expect(working.entries[0]?.phase).toBe("working");
    world = new WorldSimulation([farm], route, JSON.parse(JSON.stringify(working)));
    world.tick(working.entries[0]!.until + 1);
    expect(world.simulation.recent("a")).toHaveLength(1);
    const returning = world.save();
    world = new WorldSimulation([farm], route, returning);
    world.tick(returning.entries[0]!.until + 1);
    const resting = world.save();
    expect(resting.entries[0]?.phase).toBe("resting");
    world = new WorldSimulation([farm], route, JSON.parse(JSON.stringify(resting)));
    world.tick(resting.at + 1);
    expect(world.simulation.recent("a")).toHaveLength(1);
    expect(world.simulation.state("a", resting.at)?.phase).toBe("resting");
    const result = world.simulation.recent("a")[0]!;
    for (const forbidden of ["xp", "resources", "reputation", "rewardPoints", "score", "reward", "payout"]) expect(result).not.toHaveProperty(forbidden);
  });

  it("limits and persists autonomous job claims, expires work and rejects duplicate acceptance", () => {
    let world = new WorldSimulation([farm], route);
    const people = Array.from({ length: 300 }, (_, i) => resident(`a${i}`));
    world.sync(people, 0);
    for (let now = 20_000; now <= 60_000; now += 1000) world.tick(now);
    const saved = world.save();
    const job = noticeJobs(60_000, [farm])[0]!;
    expect(saved.claims[job.id]).toHaveLength(job.capacity);
    expect(new Set(saved.claims[job.id]).size).toBe(job.capacity);
    world = new WorldSimulation([farm], route, JSON.parse(JSON.stringify(saved)));
    world.tick(61_000);
    expect(world.save().claims[job.id]).toEqual(saved.claims[job.id]);
    const expiry = { ...saved, at: job.expiresAt - 1000 };
    for (const e of expiry.entries) if (e.plan?.job) {
      e.moving = false; e.phase = "working"; e.until = job.expiresAt + 20_000;
    }
    world = new WorldSimulation([farm], route, expiry); world.tick(job.expiresAt);
    for (const e of world.save().entries) {
      expect(e.plan?.job?.id).not.toBe(job.id);
      expect(e.recent.some((r) => r.jobId === job.id && r.completedAt >= job.expiresAt)).toBe(false);
    }
    expect(world.save().claims[job.id]).toBeUndefined();
    expect(noticeJobs(JOB_WINDOW_MS, [farm])[0]!.id).not.toBe(job.id);
  });

  it("cancels match/retired agents while other token agents keep their own progress", () => {
    const world = new WorldSimulation([farm], route);
    world.sync([resident("token-a"), resident("token-b")], 0); world.tick(20_000);
    const before = world.simulation.state("token-b", 20_000);
    world.sync([{ ...resident("token-a"), interrupted: true }, resident("token-b")], 20_000);
    expect(world.simulation.has("token-a")).toBe(false);
    expect(world.simulation.state("token-b", 20_000)).toEqual(before);
    world.sync([], 21_000); world.tick(100_000);
    expect(world.save().entries).toHaveLength(0);
  });

  it("retains the fair route cursor across checkpoints for 1,000 residents", () => {
    let world = new WorldSimulation([farm], route);
    world.sync(Array.from({ length: 1000 }, (_, i) => resident(`a${i}`)), 0);
    let total = 0;
    for (let now = 20_000; now <= 200_000; now += 1000) {
      let routes = 0;
      world = new WorldSimulation([farm], (from, to) => { routes++; return route(from, to); }, world.save());
      world.tick(now); expect(routes).toBeLessThanOrEqual(8); total += routes;
    }
    expect(world.save().entries).toHaveLength(1000);
    expect(total).toBeGreaterThanOrEqual(1000);
    expect(world.save().entries.filter((e) => e.cycle > 0)).toHaveLength(1000);
  });

  it("uses real map routing through dry ground and reachable work sites", () => {
    const nav = worldNavigation(1000);
    for (const d of ACTIVITY_DESTINATIONS) {
      const path = nav.route({ x: 1400, y: 1100 }, d);
      expect(path, d.name).not.toBeNull();
      for (let i = 1; i < path!.length; i++) {
        const motion = { path: [path![i - 1]!, path![i]!], startedAt: 0, endsAt: 100 };
        for (let t = 0; t <= 100; t += 5) expect(nav.ground.walkable(motionPosition(motion, t)), d.name).toBe(true);
      }
    }
  });

  it("writes and restores database checkpoints without browsers, and read-only snapshots never mutate them", async () => {
    const { db, close } = await connect();
    try {
      await migrate(db);
      const a = await createAgent(db, { name: "Town resident", presetName: "Anchor" });
      const start = Date.now();
      await tickWorldActivities(db, start);
      await tickWorldActivities(db, start + 20_000);
      const first = (await db.select().from(worldActivities))[0]!.checkpoint;
      const before = first.entries.find((e) => e.id === a.id)!;
      expect(before.cycle).toBeGreaterThan(0);
      const snapshots = await readWorldActivities(db, start + 20_000);
      expect(snapshots.activities.get(a.id)).toEqual(activitySnapshot(before, first.positions[a.id]!, start + 20_000));
      expect((await db.select().from(worldActivities))[0]!.checkpoint).toEqual(first);
      await tickWorldActivities(db, start + 20_000); // Repeat/second replica at the same instant.
      expect((await db.select().from(worldActivities))[0]!.checkpoint).toEqual(first);
      await tickWorldActivities(db, start + 10 * 60_000); // Bounded outage recovery.
      const after = (await db.select().from(worldActivities))[0]!.checkpoint;
      expect(after.at).toBe(start + 10 * 60_000);
      expect(after.entries.find((e) => e.id === a.id)!.recent.length).toBeLessThanOrEqual(4);
      expect(await db.select().from(matches)).toHaveLength(0);
      expect(await db.select().from(dailyScores)).toHaveLength(0);
      const roster = await field(db);
      expect(roster[0]!.id).toBe(a.id);
      expect(roster[0]!.house).toBe(true);
      expect(snapshots.activities.get(a.id)?.state).toBeDefined(); // House residents use the same loop and board.
      await db.update(agents).set({ retiredAt: new Date(start + 11 * 60_000) }).where(eq(agents.id, a.id));
      await tickWorldActivities(db, start + 11 * 60_000);
      expect((await readWorldActivities(db, start + 11 * 60_000)).activities.has(a.id)).toBe(false);
    } finally { await close(); }
  });
});
