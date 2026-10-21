import { negotiationAfter, playNegotiationMatch } from "./negotiation.js";
import { and, desc, eq, gt, gte, isNull, isNotNull, lte, or, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { liveHolderPricing } from "../holder-policy.js";
import type { Db } from "./client.js";
import { pickOpponent, runMatch } from "./runner.js";
import { balanceOf, inPlayOf, StakeError } from "./ledger.js";
import { chips, rateOf } from "../chips.js";
import { recordEvent } from "./events.js";
import { headlineFor } from "../transcript.js";
import {
  agents,
  matches,
  MIN_FUNDING_CHIPS,
  AUTOPLAY_INTERVAL_MS,
  AUTOPLAY_SELF_CLEARING,
  type AgentRow,
  type AutoplayStop,
} from "./schema.js";

/**
 * Autoplay: the server plays a player's agent on a timer.
 *
 * The owner turns it on and closes the tab. Nothing here needs the site open
 * and nothing is signed: a match moves no money (docs/holder-agents.md), so
 * there is nothing to guard but whether the agent is in play at all.
 *
 * Only player agents. House agents have their own loop in house.ts; an agent
 * with no owner is never selected here.
 */

/** A stop that clears itself when the cause goes away, versus one the owner must undo. */
export const isHold = (reason: AutoplayStop): boolean => AUTOPLAY_SELF_CLEARING[reason];

export type AutoplayCheck =
  | { play: true }
  | { play: false; reason: AutoplayStop; detail: string };

/**
 * Whether this agent may play right now, and if not, which kind of stop it is.
 * Retirement first: an agent that is both retired and out of play should be
 * told it is retired.
 */
export async function checkAgent(db: Db, row: AgentRow): Promise<AutoplayCheck> {
  if (row.retiredAt !== null) return { play: false, reason: "retired", detail: "the agent is retired" };
  // inPlaySql: the wallet holds the minimum, or the conviction amount it
  // qualified with, so a retune that raised the minimum stops nobody who has not sold.
  if (!(await inPlayOf(db, [row.id])).get(row.id)) {
    const balance = chips(await balanceOf(db, row.id), rateOf(row));
    return {
      play: false,
      reason: "insolvent",
      detail: liveHolderPricing() ? "the wallet needs fresh verified holdings worth at least $20 of its qualifying token" : `the wallet holds ${balance}, below the ${MIN_FUNDING_CHIPS} an agent needs to play`,
    };
  }
  return { play: true };
}

/**
 * Records a stop. A hold leaves autoplay on, because the thing in its way will
 * pass; a pause turns it off, because the owner has to decide what to do next.
 */
export async function stopAgent(db: Db, agentId: string, reason: AutoplayStop): Promise<void> {
  await db
    .update(agents)
    .set({
      autoplay: isHold(reason) ? undefined : false,
      autoplayStoppedReason: reason,
      autoplayStoppedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
  // A pause switches autoplay off, so it is recorded like the owner doing it.
  // A hold leaves it on and clears itself, so there is nothing to record.
  if (!isHold(reason)) await recordEvent(db, agentId, "autoplay-off", "autoplay", `paused: ${reason}`);
}

/**
 * The owner switches autoplay on or off. Recorded only where something
 * changed, so the record reads as what the owner did rather than how often
 * the panel was saved.
 */
export async function setAutoplay(db: Db, row: AgentRow, enabled: boolean): Promise<void> {
  await db
    .update(agents)
    .set({ autoplay: enabled, ...(enabled ? { autoplayStoppedReason: null, autoplayStoppedAt: null } : {}) })
    .where(eq(agents.id, row.id));
  if (enabled !== row.autoplay) await recordEvent(db, row.id, enabled ? "autoplay-on" : "autoplay-off", "owner", null);
}

/** Clears a stop once the agent has played again. */
async function clearStop(db: Db, agentId: string, playedAt: Date): Promise<void> {
  await db
    .update(agents)
    .set({
      autoplayStoppedReason: null,
      autoplayStoppedAt: null,
      autoplayWaitingSince: null,
      autoplayLastMatchAt: playedAt,
    })
    .where(eq(agents.id, agentId));
}

/**
 * Agents due a match: autoplay on, owned, and last played longer ago than the
 * interval. The interval is counted per agent from its own last match, so they
 * spread themselves out instead of all firing on one tick.
 */
export async function dueAgents(db: Db, intervalMs: number, now = new Date()): Promise<AgentRow[]> {
  const due = new Date(now.getTime() - intervalMs);
  return db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.autoplay, true),
        isNotNull(agents.ownerId),
        isNull(agents.retiredAt),
        or(isNull(agents.autoplayLastMatchAt), lte(agents.autoplayLastMatchAt, due)),
      ),
    )
    .orderBy(sql`${agents.autoplayLastMatchAt} asc nulls first`);
}

export type TickResult = {
  played: string[];
  waiting: string[];
  stopped: { agentId: string; reason: AutoplayStop }[];
};

/** How an agent reads in a log line: its name and enough of its id to find it. */
const who = (row: AgentRow) => `${row.name} (${row.id.slice(0, 8)})`;
const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`;

/**
 * One pass: every agent that is due gets one match, or one reason why not.
 *
 * Agents are played one at a time rather than in parallel. Two autoplayers
 * picking an opponent at the same instant would each see the other's outflow
 * as unspent, which is exactly the pile-up the budget exists to prevent.
 */
export async function tick(
  db: Db,
  options: {
    intervalMs?: number;
    now?: Date;
    onMatch?: ((matchId: string) => void) | undefined;
    onError?: ((e: unknown) => void) | undefined;
    /**
     * One line per thing worth knowing afterwards: a wait starting or ending,
     * a stop, and a summary of any tick that played or stopped something. A
     * waiting agent retries on every poll, so each wait is logged once, when
     * it starts - not on every retry.
     */
    onLog?: ((line: string) => void) | undefined;
    /** Play Negotiation's exhibition alongside (default on). */
    negotiation?: boolean;
  } = {},
): Promise<TickResult> {
  const intervalMs = options.intervalMs ?? AUTOPLAY_INTERVAL_MS;
  const result: TickResult = { played: [], waiting: [], stopped: [] };
  const log = options.onLog ?? (() => {});
  const plays: string[] = [];

  for (const row of await dueAgents(db, intervalMs, options.now)) {
    try {
      const check = await checkAgent(db, row);
      if (!check.play) {
        await stopAgent(db, row.id, check.reason);
        result.stopped.push({ agentId: row.id, reason: check.reason });
        log(`autoplay: ${who(row)} ${isHold(check.reason) ? "held" : "paused"} (${check.reason}): ${check.detail}`);
        continue;
      }
      const pick = await pickOpponent(db, row.id, { spread: true });
      const { match, settled } = await runMatch(db, row.id, pick.opponentId);
      // Negotiation's exhibition (docs/negotiation.md): the same pair, about one match in three, on
      // top of the Bluff & Fold match. It must never cost the Bluff & Fold match, so a failure is reported, not thrown.
      const negotiation = options.negotiation !== false ? negotiationAfter(match.seed) : null;
      if (negotiation !== null) await playNegotiationMatch(db, row.id, pick.opponentId, negotiation).catch((e) => options.onError?.(e));
      const playedAt = new Date();
      await clearStop(db, row.id, playedAt);
      if (row.autoplayWaitingSince) {
        log(`autoplay: ${who(row)} stopped waiting after ${minutes(playedAt.getTime() - row.autoplayWaitingSince.getTime())}`);
      }
      result.played.push(row.id);
      plays.push(`${who(row)} ${settled.A >= 0 ? "+" : ""}${settled.A}`);
      options.onMatch?.(match.id);
    } catch (error) {
      // No opponent, or a vault with no room left in its window. Neither is a
      // fault and neither is a reason to pause: the agent keeps its place and
      // plays as soon as the queue can serve it.
      if (error instanceof StakeError) {
        await db
          .update(agents)
          .set({ autoplayWaitingSince: row.autoplayWaitingSince ?? new Date() })
          .where(eq(agents.id, row.id));
        if (!row.autoplayWaitingSince) log(`autoplay: ${who(row)} waiting: ${error.message}`);
        result.waiting.push(row.id);
        continue;
      }
      options.onError?.(error);
    }
  }
  if (result.played.length || result.stopped.length) {
    log(
      `autoplay: tick played ${result.played.length}, stopped ${result.stopped.length}, waiting ${result.waiting.length}` +
        (plays.length ? ` - ${plays.join("; ")}` : ""),
    );
  }
  return result;
}

/**
 * Runs `tick` forever. The poll is much shorter than the interval because the
 * interval is per agent: the loop is only asking who has come due since last
 * time, and a short poll keeps an agent from waiting most of another interval
 * past its turn.
 */
export function startAutoplay(
  db: Db,
  options: {
    intervalMs?: number;
    pollMs?: number;
    onMatch?: (matchId: string) => void;
    onError?: (error: unknown) => void;
    onLog?: (line: string) => void;
  } = {},
): { stop: () => void } {
  const intervalMs = options.intervalMs ?? AUTOPLAY_INTERVAL_MS;
  const pollMs = options.pollMs ?? Math.max(1_000, Math.min(15_000, Math.round(intervalMs / 20)));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const next = () => {
    if (stopped) return;
    // Jittered so a restart does not line every agent up on the same second.
    timer = setTimeout(() => void once(), pollMs + randomInt(Math.max(1, Math.round(pollMs / 4))));
  };
  const once = async () => {
    try {
      await tick(db, { intervalMs, onMatch: options.onMatch, onError: options.onError, onLog: options.onLog });
    } catch (error) {
      options.onError?.(error);
    }
    next();
  };
  next();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// What the owner's panel shows.
// ---------------------------------------------------------------------------

/**
 * The panel's state, as one word. `held` and `paused` are deliberately
 * different words, because they ask different things of the owner: a hold
 * needs nothing, a pause needs them.
 */
export type AutoplayState = "off" | "on" | "waiting" | "held" | "paused";

export type AutoplayStatus = {
  enabled: boolean;
  state: AutoplayState;
  /** The headline, with the numbers: "Held: your wallet holds 1,800, below the 3,600 an agent needs." */
  message: string | null;
  /** What, if anything, the owner has to do about it. */
  action: string | null;
  stop: { reason: AutoplayStop; hold: boolean } | null;
  lastMatchAt: Date | null;
  /** When the next match is due; null when it is not going to play on a timer. */
  nextMatchAt: Date | null;
  /** Set while there is nobody to play. */
  waitingSince: Date | null;
  /** Staked matches since midnight UTC, and their net. Money, not normalised. */
  today: { matches: number; net: number };
  intervalMs: number;
};

/**
 * The words for a stop, with its numbers filled in from the agent as it
 * stands. Withdrawal, floor, season and exit stops are from the models before
 * holding was the entry: none is made any more, but rows from then still say
 * so, and the panel must still have words for them.
 */
function describeStop(reason: AutoplayStop, balance: number): { message: string; action: string } {
  switch (reason) {
    case "insolvent":
      if (liveHolderPricing()) return {
        message: "Held: your wallet needs fresh verified holdings worth at least $20 of its qualifying token.",
        action: "Autoplay resumes after the next wallet check confirms eligibility. No tokens are spent.",
      };
      return {
        message: `Held: your wallet holds ${balance}, below the ${MIN_FUNDING_CHIPS} an agent needs to play.`,
        action: `Nothing to switch on: hold ${MIN_FUNDING_CHIPS} chips' worth of $GAMINE again and it plays again, within ten minutes.`,
      };
    case "retired":
      return {
        message: "Paused: this agent is retired.",
        action: "A retired agent can't play again.",
      };
    case "withdrawal":
    case "floor":
    case "season":
    case "exit":
      return {
        message: "Paused, from before holding was the entry.",
        action: "Switch it back on to play.",
      };
  }
}

/** Net for this agent over a set of its matches, as money: its own side of each. */
const netFor = (agentId: string) =>
  sql<number>`coalesce(sum(case when ${matches.agentA} = ${agentId} then ${matches.netA} else ${matches.netB} end), 0)::int`;

/**
 * Everything the owner's autoplay panel needs, computed from the agent as it
 * stands. An agent that is on is checked live rather than trusted to its
 * stored reason: a withdrawal may have landed since the last tick, and the
 * panel should say what is true now, not what was true ten minutes ago.
 */
export async function autoplayStatus(
  db: Db,
  row: AgentRow,
  options: { intervalMs?: number; now?: Date } = {},
): Promise<AutoplayStatus> {
  const intervalMs = options.intervalMs ?? AUTOPLAY_INTERVAL_MS;
  const now = options.now ?? new Date();
  // Chips: this is what the owner's panel says.
  const balance = chips(await balanceOf(db, row.id), rateOf(row));

  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [today] = await db
    .select({ n: sql<number>`count(*)::int`, net: netFor(row.id) })
    .from(matches)
    .where(
      and(
        or(eq(matches.agentA, row.id), eq(matches.agentB, row.id)),
        eq(matches.exhibition, false),
        gte(matches.createdAt, midnight),
      ),
    );

  let state: AutoplayState;
  let stop: AutoplayStatus["stop"] = null;
  if (row.autoplay) {
    const check = await checkAgent(db, row);
    if (!check.play) {
      stop = { reason: check.reason, hold: isHold(check.reason) };
      state = stop.hold ? "held" : "paused";
    } else {
      state = row.autoplayWaitingSince ? "waiting" : "on";
    }
  } else if (row.autoplayStoppedReason && !isHold(row.autoplayStoppedReason)) {
    stop = { reason: row.autoplayStoppedReason, hold: false };
    state = "paused";
  } else {
    state = "off";
  }

  const words = stop ? describeStop(stop.reason, balance) : null;
  // A countdown only means something while the timer is actually running. A
  // waiting agent retries on every poll so that it plays the moment an
  // opponent appears, which is sooner than any countdown would claim.
  const nextMatchAt =
    state === "on"
      ? new Date(Math.max(now.getTime(), (row.autoplayLastMatchAt?.getTime() ?? 0) + intervalMs))
      : null;

  return {
    enabled: row.autoplay,
    state,
    message: words?.message ?? null,
    action: words?.action ?? null,
    stop,
    lastMatchAt: row.autoplayLastMatchAt,
    nextMatchAt,
    waitingSince: state === "waiting" ? row.autoplayWaitingSince : null,
    today: { matches: Number(today?.n ?? 0), net: Number(today?.net ?? 0) },
    intervalMs,
  };
}

export type SinceYouLeft = {
  since: Date;
  matches: number;
  net: number;
  /** The biggest single win in the period, told by its headline. Null if it won nothing. */
  bestHand: { matchId: string; net: number; headline: string | null; createdAt: Date } | null;
};

/**
 * What happened while the owner was away: every staked match since they last
 * dismissed this, the net, and the best of them.
 *
 * Measured from `owner_last_seen_at`, which only moves when the owner says so
 * (markSeen), not whenever the panel loads. The panel refreshes itself to keep
 * its countdown current, and a summary that reset on every refresh would be
 * gone before anyone read it.
 */
export async function sinceYouLeft(db: Db, row: AgentRow): Promise<SinceYouLeft | null> {
  const since = row.ownerLastSeenAt;
  if (!since) return null;
  const mine = and(
    or(eq(matches.agentA, row.id), eq(matches.agentB, row.id)),
    eq(matches.exhibition, false),
    gt(matches.createdAt, since),
  );
  const [totals] = await db
    .select({ n: sql<number>`count(*)::int`, net: netFor(row.id) })
    .from(matches)
    .where(mine);
  const n = Number(totals?.n ?? 0);
  if (n === 0) return { since, matches: 0, net: 0, bestHand: null };

  const myNet = sql<number>`case when ${matches.agentA} = ${row.id} then ${matches.netA} else ${matches.netB} end`;
  const [best] = await db
    .select({ id: matches.id, net: myNet, log: matches.log, createdAt: matches.createdAt, a: matches.agentA, b: matches.agentB })
    .from(matches)
    .where(and(mine, sql`${myNet} > 0`))
    .orderBy(desc(myNet), desc(matches.seq))
    .limit(1);

  let bestHand: SinceYouLeft["bestHand"] = null;
  if (best) {
    const [a, b] = await Promise.all([
      db.select({ name: agents.name }).from(agents).where(eq(agents.id, best.a)).limit(1),
      db.select({ name: agents.name }).from(agents).where(eq(agents.id, best.b)).limit(1),
    ]);
    bestHand = {
      matchId: best.id,
      net: Number(best.net),
      headline: headlineFor(best.log, { A: a[0]?.name ?? "A", B: b[0]?.name ?? "B" }),
      createdAt: best.createdAt,
    };
  }
  return { since, matches: n, net: Number(totals?.net ?? 0), bestHand };
}

/** The owner has read the summary: start the next one from now. */
export async function markSeen(db: Db, agentId: string, now = new Date()): Promise<void> {
  await db.update(agents).set({ ownerLastSeenAt: now }).where(eq(agents.id, agentId));
}
