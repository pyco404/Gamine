import { describe, expect, it } from "vitest";
import { ActivitySimulation, ACTIVITY_CONFIG, ACTIVITY_TYPES, activityPreferences, chooseActivity, describeActivity,
  type ActivityDestination, type ActivityHost } from "../web/app/village/game/activities.js";
import { ACTIVITY_DESTINATIONS } from "../web/app/village/game/activity-destinations.js";
import { Ground } from "../web/app/village/game/ground.js";
import { clearRoute } from "../web/app/village/game/population.js";
import { lakeTerrain, WORLD } from "../web/app/village/game/world.js";
import { waterTerrain } from "../web/app/village/game/river.js";
import { GARDEN_PONDS } from "../web/app/village/game/landmarks.js";
import { MOUNTAIN_BOXES } from "../web/app/village/game/landscape.js";
import { SITES, RESERVED } from "../web/app/village/game/town.js";
import type { Point } from "../web/app/village/game/roads.js";

import { canSpar, lookOf } from "../web/lib/world/character.js";

const farm: ActivityDestination = { id: "farm", name: "Farm", x: 100, y: 200, capabilities: ["farm"], capacity: 2000 };
const source: ActivityDestination = { id: "market", name: "Bazaar", x: 50, y: 100, capabilities: ["delivery-source"], capacity: 2000 };
const target: ActivityDestination = { id: "treasury", name: "Treasury", x: 500, y: 100, capabilities: ["delivery-target"], capacity: 2000 };

function harness(destinations: ActivityDestination[] = [farm]) {
  const positions = new Map<string, Point>();
  const trips: { id: string; path: Point[]; arrived: () => void }[] = [];
  let preparations = 0, unreachable = false;
  const host: ActivityHost = {
    position: (id) => positions.get(id) ?? null,
    prepare: (id, to) => { preparations++; return unreachable ? null : [positions.get(id)!, to]; },
    travel: (id, path, arrived) => { trips.push({ id, path, arrived }); },
    rest: () => {},
  };
  const sim = new ActivitySimulation(destinations, host);
  const add = (id: string) => { positions.set(id, { x: 0, y: 0 }); sim.add(id, { x: 0, y: 0 }, 0); };
  const arrive = () => { const trip = trips.shift()!; positions.set(trip.id, trip.path.at(-1)!); trip.arrived(); return trip; };
  return { sim, add, arrive, trips, positions, preparations: () => preparations, unreachable: () => { unreachable = true; } };
}

describe("autonomous activities", () => {
  it("uses reproducible varied preferences and selects only supported capabilities", () => {
    const observed = new Set<string>(), preferences = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = `agent-${i}`, from = { x: 1400, y: 1000 };
      const a = chooseActivity(id, 1, from, ACTIVITY_DESTINATIONS)!;
      expect(a).toEqual(chooseActivity(id, 1, from, ACTIVITY_DESTINATIONS));
      preferences.add(JSON.stringify(activityPreferences(id)));
      observed.add(a.activity);
      expect(a.target.capabilities).toContain(a.activity === "delivery" ? "delivery-target" :
        a.activity === "farming" ? "farm" : a.activity === "gathering" ? "gather" : a.activity === "sparring" ? "spar" : "explore");
      if (a.source) { expect(a.source.capabilities).toContain("delivery-source"); expect(a.source.id).not.toBe(a.target.id); }
    }
    expect(observed).toEqual(new Set(ACTIVITY_TYPES));
    expect(preferences.size).toBeGreaterThan(100);
    expect(chooseActivity("a", 0, { x: 0, y: 0 }, [])).toBeNull();
    const same = { ...source, capabilities: ["delivery-source", "delivery-target"] as const };
    expect(chooseActivity("a", 0, same, [same])).toBeNull();
    // An invalid source must not be selected just because another source is valid.
    const validSource = { ...source, id: "other-source" };
    for (let i = 0; i < 40; i++) expect(chooseActivity(String(i), 0, same, [same, validSource])?.source?.id).toBe("other-source");
  });

  it("only sends armed characters to practice and keeps other town activities available", () => {
    const green: ActivityDestination = { id: "green", name: "Green", x: 0, y: 0, capabilities: ["spar"], capacity: 24 };
    let armed = 0, workers = 0, practice = 0;
    for (let i = 0; i < 300; i++) {
      const id = `resident-${i}`;
      expect(canSpar(id)).toBe(lookOf(id).unit !== "pawn");
      if (canSpar(id)) {
        armed++;
        expect(chooseActivity(id, 1, green, [green])?.activity).toBe("sparring");
        if (chooseActivity(id, 1, green, [green, farm])?.activity === "sparring") practice++;
      } else {
        workers++;
        expect(chooseActivity(id, 1, green, [green])).toBeNull();
        expect(chooseActivity(id, 1, green, [green, farm])?.activity).toBe("farming");
      }
    }
    expect(armed).toBeGreaterThan(0); expect(workers).toBeGreaterThan(0);
    expect(practice).toBeGreaterThan(armed * .6);
    expect(practice).toBeLessThan(armed);
  });

  it("travels, performs timed work, completes once, returns and rests before choosing again", () => {
    const h = harness(); h.add("a");
    expect(h.sim.state("a", 0)?.phase).toBe("resting");
    h.sim.tick(20_000);
    expect(h.sim.state("a", 20_000)?.phase).toBe("traveling");
    h.sim.tick(100_000); // Passing time alone never proves arrival.
    expect(h.sim.state("a", 100_000)?.phase).toBe("traveling");
    expect(h.sim.recent("a")).toHaveLength(0);
    const old = h.arrive();
    const work = h.sim.state("a", 100_000)!;
    expect(work.phase).toBe("working"); expect(work.progress).toBe(0);
    h.sim.tick(work.completesAt! - 1); expect(h.sim.recent("a")).toHaveLength(0);
    h.sim.tick(work.completesAt! + 250);
    expect(h.sim.recent("a")).toHaveLength(1);
    expect(h.sim.recent("a")[0]).toMatchObject({ activity: "farming", destinationId: "farm", success: true });
    expect(h.sim.recent("a")[0]!.distance).toBeGreaterThan(0);
    expect(h.sim.state("a", work.completesAt! + 250)?.phase).toBe("returning");
    old.arrived(); expect(h.sim.state("a", work.completesAt! + 250)?.phase).toBe("returning");
    h.arrive();
    expect(h.sim.state("a", work.completesAt! + 250)?.phase).toBe("resting");
    expect(h.sim.recent("a")).toHaveLength(1);
    const next = h.sim.state("a", work.completesAt! + 250)!.completesAt!;
    h.sim.tick(next + 250); expect(h.trips).toHaveLength(1);
    old.arrived(); // Duplicate callback from a prior cycle cannot finish this journey.
    expect(h.sim.state("a", next + 250)?.phase).toBe("traveling");
  });

  it("collects a delivery at its source and unloads at a distinct target before completing", () => {
    const h = harness([source, target]); h.add("a"); h.sim.tick(20_000);
    expect(h.sim.state("a", 20_000)?.destinationId).toBe("market");
    expect(h.sim.state("a", 20_000)?.route).toBe("Bazaar → Treasury");
    h.arrive(); expect(describeActivity(h.sim.state("a", 20_000)!)).toContain("collecting");
    h.sim.tick(h.sim.state("a", 20_000)!.completesAt! + 250);
    expect(h.sim.state("a", 30_000)?.destinationId).toBe("treasury");
    expect(h.sim.recent("a")).toHaveLength(0);
    h.arrive(); expect(describeActivity(h.sim.state("a", 30_000)!)).toContain("unloading");
    h.sim.tick(h.sim.state("a", 30_000)!.completesAt! + 250);
    expect(h.sim.recent("a")).toHaveLength(1);
    expect(h.sim.recent("a")[0]).toMatchObject({ sourceId: "market", destinationId: "treasury", activity: "delivery" });
  });

  it("rejects unreachable destinations and false arrival without fabricating completions", () => {
    const h = harness(); h.add("a"); h.unreachable(); h.sim.tick(20_000);
    expect(h.trips).toHaveLength(0); expect(h.sim.state("a", 20_000)?.phase).toBe("resting");
    expect(h.sim.recent("a")).toHaveLength(0);
    const bad = harness(); bad.add("b"); bad.sim.tick(20_000); bad.trips[0]!.arrived();
    expect(bad.sim.state("b", 20_000)?.phase).toBe("resting"); expect(bad.sim.recent("b")).toHaveLength(0);
  });

  it.each(["gathering", "exploration"] as const)("completes %s and keeps only four recent structured results", (activity) => {
    const h = harness([{ ...farm, capabilities: [activity === "gathering" ? "gather" : "explore"] }]);
    h.add("a"); let now = 20_000;
    for (let cycle = 0; cycle < 8; cycle++) {
      h.sim.tick(now); h.arrive();
      const work = h.sim.state("a", now)!;
      expect(work.activity).toBe(activity); expect(work.phase).toBe("working");
      const midpoint = (work.completesAt! + work.startedAt) / 2;
      expect(h.sim.state("a", midpoint)?.progress).toBeCloseTo(0.5);
      now = work.completesAt! + 250; h.sim.tick(now); h.arrive();
      now = h.sim.state("a", now)!.completesAt! + 250;
    }
    expect(h.sim.recent("a")).toHaveLength(4);
    expect(new Set(h.sim.recent("a").map((r) => r.id)).size).toBe(4);
    expect(h.sim.recent("a").every((r) => r.activity === activity && r.completedAt > r.startedAt)).toBe(true);
  });

  it("releases site capacity on interruption and waits for the centralized tick interval", () => {
    const h = harness([{ ...farm, capacity: 1 }]); h.add("a"); h.add("b"); h.sim.tick(20_000);
    expect(h.trips).toHaveLength(1); h.sim.remove(h.trips[0]!.id);
    const waiting = h.sim.has("a") ? "a" : "b";
    const retry = h.sim.state(waiting, 20_000)!.completesAt!;
    h.sim.tick(retry); expect(h.trips).toHaveLength(2);
    h.add("c"); const before = h.preparations();
    h.sim.tick(retry + 1); expect(h.preparations()).toBe(before);
  });

  it("preserves work across feed refreshes and cancels it for a match or retirement", () => {
    const h = harness(); h.add("a"); h.sim.tick(20_000); h.arrive();
    const before = h.sim.state("a", 20_000);
    h.sim.add("a", { x: 300, y: 400 }, 21_000);
    expect(h.sim.state("a", 20_000)).toEqual(before);
    const stale = harness(); stale.add("a"); stale.sim.tick(20_000); const trip = stale.trips[0]!;
    stale.sim.remove("a"); stale.sim.add("a", { x: 10, y: 20 }, 21_000);
    trip.arrived(); expect(stale.sim.state("a", 21_000)?.phase).toBe("resting");
    expect(stale.sim.recent("a")).toHaveLength(0);
    h.sim.remove("a"); h.sim.tick(100_000); expect(h.sim.state("a", 100_000)).toBeNull();
  });

  it("bounds routing for 1,000 agents, makes progress fairly, and limits crowded work sites", () => {
    const h = harness(); for (let i = 0; i < 1000; i++) h.add(`a${i}`);
    for (let i = 0; i < 125; i++) {
      const before = h.preparations(), now = 20_000 + i * ACTIVITY_CONFIG.tickMs;
      h.sim.tick(now); expect(h.preparations() - before).toBeLessThanOrEqual(ACTIVITY_CONFIG.routesPerTick);
    }
    expect(h.preparations()).toBe(1000); expect(h.trips).toHaveLength(1000);
    const limited = harness([{ ...farm, capacity: 2 }]); for (let i = 0; i < 1000; i++) limited.add(`a${i}`);
    limited.sim.tick(20_000); expect(limited.trips).toHaveLength(2);
    expect(limited.sim.state("a999", 20_000)?.phase).toBe("resting");
  });

  it("keeps structured destinations on reachable dry land outside the fighting floor", () => {
    const ground = new Ground({
      world: { x0: WORLD.x0, y0: WORLD.y0, width: WORLD.x1 - WORLD.x0, height: WORLD.y1 - WORLD.y0 },
      base: "terrain-grass", terrain: [...lakeTerrain(), ...waterTerrain()], paths: [], decorations: [], buildings: [],
      spawn: { x: 1400, y: 1100 }, heroScale: 1, textures: [], animations: [],
    }, [], [...Object.values(SITES).flatMap((s) => s.blocks ?? []), ...GARDEN_PONDS, ...MOUNTAIN_BOXES], RESERVED);
    for (const d of ACTIVITY_DESTINATIONS) {
      const route = ground.route({ x: 1400, y: 1100 }, d), end = route.at(-1)!;
      expect(Math.hypot(end.x - d.x, end.y - d.y), d.name).toBeLessThanOrEqual(96);
      expect(ground.inWater(end), d.name).toBe(false);
      expect(clearRoute(route, (p) => ground.walkable(p)), d.name).toBe(true);
      expect(RESERVED.some((b) => end.x >= b.x0 && end.x <= b.x1 && end.y >= b.y0 && end.y <= b.y1), d.name).toBe(false);
    }
  });
});
