import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { policyAgent, type Policy } from "../agents/policy.js";
import { seatAveragedNet } from "../exact.js";
import { GAMINE_RULES } from "../round.js";
import type { Agent } from "../types.js";
import type { Db } from "./client.js";
import { agents, matches } from "./schema.js";


/**
 * Exact ratings. A decision table's expected net against the roster is
 * computable without playing anything, so this is a private tool for writing a
 * brief - never the ladder. The ladder ranks what agents actually won.
 */

export type RosterProfile = {
  /** Who was counted: other players' agents only, or the whole roster, house included. */
  scope: "players" | "everyone";
  /** Distinct tables on the roster, with how many agents play each. */
  entries: { table: Policy; weight: number }[];
  /** Changes whenever the mix changes; recompute ratings when it does. */
  fingerprint: string;
  agentCount: number;
  /** Who was counted, so an agent left out as idle is not also subtracted from it. */
  members: Set<string>;
};

const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

/**
 * How long a player's agent may go without a staked match and still count as
 * part of the roster a rating is measured against.
 */
export const ROSTER_ACTIVE_DAYS = 7;

/**
 * Groups the active roster by distinct table, so a rating costs one
 * evaluation per distinct opponent. The whole roster: every agent can be
 * matched against every other.
 *
 * "Active" also leaves out player agents that have sat idle for
 * ROSTER_ACTIVE_DAYS - rented, never switched on, never played - because a
 * pile of dormant rentals of one preset would otherwise decide every figure
 * on the rent screen. They stay matchable; this is only about what a rating
 * is measured against. House agents always count: they are always in play.
 */
export async function rosterProfile(db: Db, now = new Date(), options: { playersOnly?: boolean } = {}): Promise<RosterProfile> {
  const since = new Date(now.getTime() - ROSTER_ACTIVE_DAYS * 24 * 60 * 60 * 1000);
  const active = or(
    isNull(agents.ownerId),
    gt(agents.createdAt, since),
    sql`exists (select 1 from ${matches} where (${matches.agentA} = ${agents.id} or ${matches.agentB} = ${agents.id}) and ${matches.exhibition} = false and ${matches.createdAt} > ${since.toISOString()})`,
  );
  const rows = await db
    .select({ id: agents.id, table: agents.policyTable })
    .from(agents)
    // Expired agents are left out too: they cannot be matched until renewed.
    .where(and(isNull(agents.retiredAt), active, options.playersOnly ? isNotNull(agents.ownerId) : undefined));

  const members = new Set<string>();
  const byTable = new Map<string, { table: Policy; weight: number }>();
  for (const r of rows) {
    if (r.table === null) continue;
    members.add(r.id);
    const key = canonical(r.table);
    const entry = byTable.get(key);
    if (entry) entry.weight++;
    else byTable.set(key, { table: r.table, weight: 1 });
  }
  const entries = [...byTable.values()].sort((a, b) => JSON.stringify(a.table).localeCompare(JSON.stringify(b.table)));
  const agentCount = entries.reduce((s, e) => s + e.weight, 0);
  const scope = options.playersOnly ? "players" : "everyone";
  return {
    scope,
    entries,
    agentCount,
    members,
    // The prefix versions how ratings are computed: bump it and every stored rating goes stale.
    fingerprint: hash(`v4-one-roster|${scope}|${entries.map((e) => `${e.weight}:${JSON.stringify(e.table)}`).join("|")}`),
  };
}

/** Exact expected net per match against the roster as a whole. No sampling. */
export function trueRatingAgainst(agent: Agent, profile: RosterProfile): number {
  if (profile.agentCount === 0) return 0;
  let total = 0;
  for (const { table, weight } of profile.entries) {
    total += weight * seatAveragedNet(agent, policyAgent(table), GAMINE_RULES);
  }
  return total / profile.agentCount;
}

/** Key order can differ between a table as written and as stored, so compare canonically. */
const canonical = (value: unknown): string =>
  value !== null && typeof value === "object"
    ? `{${Object.keys(value)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
        .join(",")}}`
    : JSON.stringify(value);

/**
 * The roster as one of its own agents faces it: everyone but itself. Other
 * agents playing the same table still count; they are real opponents. This is
 * what makes an agent's rating after renting equal the preview it was rented
 * on, since the preview rated a table that was not yet on the roster.
 */
export function rosterWithout(profile: RosterProfile, table: Policy): RosterProfile {
  const key = canonical(table);
  const index = profile.entries.findIndex((e) => canonical(e.table) === key);
  if (index < 0) return profile;
  const entries = profile.entries
    .map((e, i) => (i === index ? { ...e, weight: e.weight - 1 } : e))
    .filter((e) => e.weight > 0);
  return { ...profile, entries, agentCount: profile.agentCount - 1 };
}

/**
 * What a player sees while writing a brief, before staking anything. The figure
 * is exact, but it is exact about today's roster: it is not a promise about
 * future opponents, who will include agents written after this was computed.
 */
/**
 * The roster rewards score against: other players' agents, since a match
 * against a house agent never scores (docs/no-loss-rewards.md). While no
 * player's agent is in play there is nothing to score against yet, so it falls
 * back to the whole roster, and says so.
 */
export async function scoringProfile(db: Db, now = new Date()): Promise<RosterProfile> {
  const players = await rosterProfile(db, now, { playersOnly: true });
  return players.agentCount > 0 ? players : rosterProfile(db, now);
}

/**
 * What a table is worth against a roster today, in chips per match, computed
 * at GAMINE_RULES - the one scale every match is played at. Against the
 * scoring roster this is the score's own unit: rewards pay on net chips won
 * against other players' agents, and this is that, expected per match.
 */
export function previewPolicy(table: Policy, profile: RosterProfile) {
  const agent = policyAgent(table);
  const rating = trueRatingAgainst(agent, profile);
  return {
    trueRating: rating,
    basis:
      profile.scope === "players"
        ? "against the other players' agents in play today"
        : "against the whole roster, as no other player's agent is in play yet",
    /** Whether this is the figure rewards score: net per match against other players' agents. */
    scoring: profile.scope === "players",
    roster: profile.agentCount,
    rosterFingerprint: profile.fingerprint,
    /** Per distinct opponent, so a brief can be aimed at what is actually out there. */
    breakdown: profile.entries.map((e) => {
      const net = seatAveragedNet(agent, policyAgent(e.table), GAMINE_RULES);
      return { weight: e.weight, expectedNet: net };
    }),
  };
}

/**
 * Recomputes true ratings for agents whose stored rating predates the current
 * roster. Cheap: one exact evaluation per distinct table on the roster.
 */
export async function refreshTrueRatings(db: Db, options: { force?: boolean } = {}): Promise<number> {
  const profile = await rosterProfile(db);
  const rows = await db
    .select({ id: agents.id, table: agents.policyTable, roster: agents.trueRatingRoster })
    .from(agents)
    .where(isNull(agents.retiredAt));

  let updated = 0;
  for (const row of rows) {
    if (row.table === null) continue;
    if (!options.force && row.roster === profile.fingerprint) continue;
    // Everyone but itself - unless it was left out as idle, in which case it is not there to remove.
    const opponents = profile.members.has(row.id) ? rosterWithout(profile, row.table) : profile;
    const rating = trueRatingAgainst(policyAgent(row.table), opponents);
    await db
      .update(agents)
      .set({ trueRating: rating, trueRatingRoster: profile.fingerprint })
      .where(eq(agents.id, row.id));
    updated++;
  }
  return updated;
}
