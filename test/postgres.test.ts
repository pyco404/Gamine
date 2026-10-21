import { describe, expect, it } from "vitest";
import pg from "pg";
import { connect, migrate, type Db } from "../src/db/client.js";
import { balanceOf, balancesOf, inPlayOf } from "../src/db/ledger.js";
import { createAgent, leaderboard, pickOpponent, publicAgent, runMatch } from "../src/db/runner.js";
import { liveCounters } from "../src/db/feed.js";
import { faucetStatus } from "../src/db/faucet.js";
import { adoptSeasonRate, baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
import { seasonStatement } from "../src/db/statement.js";
import { holdingOf, readHolding } from "../src/db/holdings.js";
import { computeDay, dayOf, freezeEndedDays } from "../src/db/scores.js";
import { seasonAt } from "../src/season.js";
import { someWallet, createPlayer } from "./helpers.js";
import { health } from "../src/db/admin.js";
import { tickWorldActivities, readWorldActivities } from "../src/db/world-activities.js";
import { worldActivities } from "../src/db/schema.js";

/**
 * The suite runs on PGlite; production runs on node-postgres. They do not agree
 * about int8: PGlite hands back a number, node-postgres a string. Through a
 * typed column drizzle hides the difference, but not through a raw
 * `sum(...)::bigint` - so a balance that came back as "900000000" in production
 * would pass every other test in this repo.
 *
 * This file is the guard. It runs only against a real Postgres, named by
 * PG_URL, and `scripts/pg-test.sh` puts a throwaway one in front of it. Add a
 * case here whenever a query starts returning a bigint.
 *
 *   scripts/pg-test.sh
 *   PG_URL=postgres://... npx vitest run test/postgres.test.ts
 */

const URL = process.env["PG_URL"];

/** A database of its own per test, because these share one server. */
let n = 0;
async function fresh(): Promise<{ db: Db; close: () => Promise<void> }> {
  const base = new pg.Pool({ connectionString: URL });
  const name = `gamine_test_${process.pid}_${n++}`;
  await base.query(`drop database if exists ${name}`);
  await base.query(`create database ${name}`);
  await base.end();
  const { db, close } = await connect(new URL_(URL!, name).toString());
  await migrate(db);
  return { db, close };
}
/** The same server, a different database. */
class URL_ {
  constructor(
    private readonly base: string,
    private readonly name: string,
  ) {}
  toString() {
    const u = new globalThis.URL(this.base);
    u.pathname = `/${this.name}`;
    return u.toString();
  }
}

describe.skipIf(!URL)("against a real Postgres (npm run check runs these; a bare vitest run skips them)", () => {
  it("serializes cosmetic worker replicas and restores JSON journeys from the production driver", async () => {
    const { db, close } = await fresh();
    try {
      const a = await createAgent(db, { name: "Resident", presetName: "Anchor" });
      const now = Date.now();
      await tickWorldActivities(db, now);
      await Promise.all([tickWorldActivities(db, now + 20_000), tickWorldActivities(db, now + 20_000)]);
      const rows = await db.select().from(worldActivities);
      expect(rows).toHaveLength(1);
      const saved = rows[0]!.checkpoint;
      expect(saved.at).toBe(now + 20_000);
      expect(saved.entries.find((e) => e.id === a.id)!.cycle).toBeGreaterThan(0);
      const snapshot = (await readWorldActivities(db, now + 20_000)).activities.get(a.id)!;
      expect(Number.isFinite(snapshot.position.x)).toBe(true);
      await tickWorldActivities(db, now + 20_000);
      expect((await db.select().from(worldActivities))[0]!.checkpoint).toEqual(saved);
    } finally { await close(); }
  });
  it("keeps balances and eligibility independent for two token agents owned by the same wallet", async () => {
    const { db, close } = await fresh();
    try {
      const owner = someWallet();
      const mintA = someWallet(); const mintB = someWallet();
      for (const [mint, amount] of [[mintA, 3_000_000_000], [mintB, 4_000_000_000]] as const) {
        await readHolding(db, { mint, balanceOf: async () => amount, supply: async () => 10_000_000_000,
          quote: () => ({ minimum: 3_500_000_000, priceUsd: 20 / 3.5, decimals: 9, at: Date.now() }) }, owner);
      }
      const a = await createAgent(db, { name: "Token A", presetName: "Anchor", ownerId: owner, holderMint: mintA });
      const b = await createAgent(db, { name: "Token B", presetName: "Hammer", ownerId: owner, holderMint: mintB });
      expect(await balanceOf(db, a.id)).toBe(3_000_000_000);
      expect(await balanceOf(db, b.id)).toBe(4_000_000_000);
      const eligible = await inPlayOf(db, [a.id, b.id]);
      expect(eligible.get(a.id)).toBe(false); expect(eligible.get(b.id)).toBe(true);
    } finally { await close(); }
  });
  it("reads a holder agent's balance - its wallet's holding - as a number, in every path that reads balances", async () => {
    const { db, close } = await fresh();
    try {
      const owner = someWallet();
      const other = someWallet();
      // Past 2^31, so a 32-bit read would be wrong, and through raw SQL (balanceSql).
      const held = baseUnits(50_000, DEVNET_CHIP_RATE);
      const chain = {
        balanceOf: async (wallet: string) => (wallet === owner || wallet === other ? held : 0),
        supply: async () => baseUnits(1_000_000_000, DEVNET_CHIP_RATE),
      };
      await readHolding(db, chain, owner);
      await readHolding(db, chain, other);
      const agent = await createAgent(db, { name: "Holds", presetName: "Anchor", ownerId: owner });
      const rival = await createAgent(db, { name: "Rival", presetName: "Hammer", ownerId: other });

      expect(await balanceOf(db, agent.id)).toBe(held);
      expect((await balancesOf(db, [agent.id])).get(agent.id)).toBe(held);
      const view = await publicAgent(db, agent.id);
      expect(typeof view!.balance).toBe("number");
      expect(view!.balance).toBe(held);
      const holding = await holdingOf(db, owner);
      expect(holding!.amount).toBe(held);
      expect(typeof holding!.supply).toBe("number");
      // The matchmaker compares the same figure in SQL against the minimum.
      const pick = await pickOpponent(db, agent.id, { minCandidates: 1 });
      expect(pick.opponentId).toBe(rival.id);
    } finally {
      await close();
    }
  });

  it("scores and freezes a day through raw SQL, with the drivers' own types for counts and moments", async () => {
    const { db, close } = await fresh();
    try {
      const a = await createPlayer(db, { name: "Pa", presetName: "Anchor" });
      const b = await createPlayer(db, { name: "Pb", presetName: "Hammer" });
      await runMatch(db, a.id, b.id, { seed: 41 });
      const today = dayOf(new Date());
      const rows = await computeDay(db, today);
      expect(rows.map((r) => typeof r.rankedMatches)).toEqual(["number", "number"]);
      expect(rows.every((r) => r.rankedMatches === 1)).toBe(true);
      // The first ranked match's moment comes back as a Date here and a string
      // elsewhere; either way the run starts on today, which is not over.
      expect(await freezeEndedDays(db, new Date())).toBe(0);
      expect(await freezeEndedDays(db, new Date((today + 1) * 86_400_000 + 1))).toBe(1);
    } finally {
      await close();
    }
  });

  it("decides a holder is in play from its conviction amount, a bigint, against the minimum bound as a parameter", async () => {
    const { db, close } = await fresh();
    try {
      const owner = someWallet();
      const min = baseUnits(3_600, DEVNET_CHIP_RATE);
      const chain = { balanceOf: async () => min, supply: async () => baseUnits(1_000_000_000, DEVNET_CHIP_RATE) };
      const agent = await createAgent(db, { name: "Kept", presetName: "Anchor", ownerId: owner });
      await readHolding(db, chain, owner);
      expect((await inPlayOf(db, [agent.id])).get(agent.id)).toBe(true);
      const holding = await holdingOf(db, owner);
      expect(holding!.convictionAmount).toBe(min);
      expect(holding!.convictionSince).toBeInstanceOf(Date);
      // The minimum doubles; the wallet has not sold, and stays in play.
      adoptSeasonRate(2 * DEVNET_CHIP_RATE);
      try {
        expect((await inPlayOf(db, [agent.id])).get(agent.id)).toBe(true);
        expect((await publicAgent(db, agent.id))!.inPlay).toBe(true);
      } finally {
        adoptSeasonRate(DEVNET_CHIP_RATE);
      }
    } finally {
      await close();
    }
  });

  it("reads a wallet's holding past 2^31 as a number in the ladder and the matchmaker", async () => {
    const { db, close } = await fresh();
    const big = baseUnits(50_000, DEVNET_CHIP_RATE);
    expect(big).toBeGreaterThan(2_147_483_647);
    const agent = await createPlayer(db, { name: "Summed", presetName: "Hammer", holds: big });
    const other = await createPlayer(db, { name: "Opponent", presetName: "Bully", holds: big });
    expect((await balancesOf(db, [agent.id])).get(agent.id)).toBe(big);
    // Matchmaking compares the holding inside SQL against the minimum, so what
    // this proves is that the comparison does not overflow.
    expect((await pickOpponent(db, agent.id, { minCandidates: 1 })).opponentId).toBe(other.id);
    const view = await publicAgent(db, agent.id);
    expect(typeof view!.balance).toBe("number");
    expect(view!.balance).toBe(big);
    // And the ladder, whose figures come from bigint rating columns.
    await runMatch(db, agent.id, other.id, { seed: 2 });
    for (const row of await leaderboard(db, 10)) expect(typeof row.cumulativeNet).toBe("number");
    await close();
  });

  it("reads the live feed's staked total as a number", async () => {
    const { db, close } = await fresh();
    // Both owned: a match involving a house agent is an exhibition and stakes
    // nothing, so it would leave the counter this test is about at zero.
    const a = await createPlayer(db, { name: "Staker", presetName: "Anchor" });
    const b = await createPlayer(db, { name: "Caller", presetName: "Bully" });
    const played = await runMatch(db, a.id, b.id, { seed: 7 });
    const counters = await liveCounters(db, new Date());
    expect(typeof counters.totalStaked).toBe("number");
    expect(counters).toEqual({ matchesToday: 1, totalStaked: played.stake * 2, holders: 2 });
    await close();
  });

  it("reads a bigint column through drizzle as a number too", async () => {
    const { db, close } = await fresh();
    const wallet = someWallet();
    // faucet_grants.amount is a bigint the faucet reads back to decide a wait.
    const status = await faucetStatus(db, wallet, DEVNET_CHIP_RATE);
    expect(typeof status.amount).toBe("number");
    expect(status.available).toBe(true);
    await close();
  });

  it("reads a season statement's sums as numbers, not strings", async () => {
    const { db, close } = await fresh();
    const a = await createPlayer(db, { name: "Stmt-A", presetName: "Bully" });
    const b = await createPlayer(db, { name: "Stmt-B", presetName: "Mirage" });
    const key = seasonAt(new Date()).key;
    for (let i = 0; i < 3; i++) await runMatch(db, a.id, b.id, { seed: 4000 + i });
    const s = await seasonStatement(db, key);
    for (const v of Object.values(s.play)) expect(typeof v).toBe("number");
    expect(s.play.rankedMatches).toBe(3);
    expect(s.play.netAcrossAllSides).toBe(0);
    await close();
  });

  it("reads the admin page's counts and oldest reading as numbers and a date", async () => {
    const { db, close } = await fresh();
    try {
      const owner = someWallet();
      const chain = { balanceOf: async () => baseUnits(3_600, DEVNET_CHIP_RATE), supply: async () => baseUnits(1_000_000_000, DEVNET_CHIP_RATE) };
      await createAgent(db, { name: "Read", presetName: "Anchor", ownerId: owner });
      await readHolding(db, chain, owner);
      const h = await health(db);
      expect(h.holders).toBe(1);
      expect(h.holdings.wallets).toBe(1);
      expect(h.holdings.oldestReadAt).toBeInstanceOf(Date);
      expect(typeof h.holdings.oldestAgeMs).toBe("number");
      expect(h.holdings.stale).toBe(false);
      expect(typeof h.matches.today).toBe("number");
    } finally {
      await close();
    }
  });

  it("refuses an integer too large to read exactly, rather than losing its last digits", async () => {
    const parse = pg.types.getTypeParser(20);
    expect(parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parse("9223372036854775807")).toThrow(/without losing precision/);
  });
});
