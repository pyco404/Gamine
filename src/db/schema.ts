import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { MatchLog, Seat } from "../types.js";
import type { Policy } from "../agents/policy.js";
import type { Deal, Stakes, TurnOrder } from "../round.js";
import type { Funding } from "../chips.js";
import type { WorldCheckpoint } from "../../web/lib/world/simulation.js";
import type { NegotiationLog } from "../negotiation/engine.js";

/** Cosmetic world state only; deliberately separate from match scores, holdings and payouts. */
export const worldActivities = pgTable("world_activities", {
  id: text("id").primaryKey(),
  checkpoint: jsonb("checkpoint").$type<WorldCheckpoint & { population?: number }>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * Everything needed to replay a match: the rules it was played under, plus the
 * preset version in force at the time. The version is provenance only - replay
 * uses each agent's stored table, so it survives a preset change.
 */
export type RulesConfig = { turnOrder: TurnOrder; deal: Deal; stakes: Stakes; presetVersion: string };

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Set for a roster agent built from a shipped preset. */
    presetName: text("preset_name"),
    /** Set for a player agent: what the model was told when its table was elicited. */
    brief: text("brief"),
    /**
     * The decision table this agent plays, for preset and player agents alike.
     * Filled once when the agent is created - never per match - and snapshotted
     * for presets too, so a stored transcript replays for good even if a preset
     * is retuned later.
     */
    policyTable: jsonb("policy_table").$type<Policy>(),
    /**
     * The stakes the table was built for. A table is priced: a pot-odds fold at
     * ante 4 is not the same decision at ante 8, so playing it at other stakes
     * would misrepresent the agent. The runner refuses rather than mispricing.
     */
    policyStakes: jsonb("policy_stakes").$type<Stakes>(),
    /** The agent's emoji: its identity at a glance, unique across all agents. See src/marks.ts. */
    mark: text("mark").unique(),
    /**
     * Which funding flow this agent was rented under. It decides which stake
     * token its vault holds, which program settles it, and so how many base
     * units one of its chips is worth (src/chips.ts).
     *
     * "seed" is every agent rented before deposits: its vault holds the frozen
     * program's 0-decimal mint, seeded rather than deposited, at one token to
     * the chip. "deposit" is the flow this default moves to once it is switched
     * on. An agent never changes flow - its vault is a token account for one
     * mint - so this is written when it is rented and never again.
     *
     * "holder" has no vault and no ledger: the agent is its owner's wallet
     * holding $GAMINE above the minimum (docs/holder-agents.md), read into
     * `holdings`. Nothing is rented, so a holder agent has no rental end.
     */
    funding: text("funding").$type<Funding>().notNull().default("seed"),
    /**
     * From before every match played at one scale, kept so old rows still
     * explain themselves. Nothing reads it to decide a match.
     */
    maxStake: integer("max_stake").notNull().default(60),
    /**
     * Exact expected net against the roster, from the calculator. Private: shown
     * to the agent's owner while writing a brief, never on the ladder and never
     * on someone else's agent. Null until computed.
     */
    trueRating: doublePrecision("true_rating"),
    /** Fingerprint of the roster trueRating was computed against; recompute when it changes. */
    trueRatingRoster: text("true_rating_roster"),
    /** The owner's wallet: a base58 Solana public key. */
    ownerId: text("owner_id"),
    /** Empty means the configured primary token (legacy $GAMINE/devnet agents). */
    holderMint: text("holder_mint").notNull().default(""),
    /**
     * Autoplay: the server plays this agent on a timer, with nothing to press
     * and nothing to sign. Off until the owner turns it on - a rental that
     * started playing by itself would be spending money nobody asked it to.
     * Only ever true for a player agent; house agents have their own
     * exhibition loop, which stakes nothing (see house.ts).
     */
    autoplay: boolean("autoplay").notNull().default(false),
    /**
     * The balance the owner will not play below. Autoplay stops before any
     * match that *could* breach it, so it is a floor and not a line the agent
     * is allowed to fall through. Null means no floor - it plays until it holds
     * less than the minimum to play.
     */
    autoplayFloor: integer("autoplay_floor"),
    /**
     * Why autoplay is not playing, or null when nothing is wrong. Two kinds,
     * and the panel must not confuse them: `withdrawal` is a *hold* that clears
     * itself when the withdrawal lands, and leaves `autoplay` true. The others
     * are *pauses*: they set `autoplay` false, and the owner turns it back on.
     */
    autoplayStoppedReason: text("autoplay_stopped_reason").$type<AutoplayStop>(),
    autoplayStoppedAt: timestamp("autoplay_stopped_at", { withTimezone: true }),
    /**
     * When this agent last played under autoplay. The interval is per agent and
     * counted from here, so agents do not all fire on the same tick.
     */
    autoplayLastMatchAt: timestamp("autoplay_last_match_at", { withTimezone: true }),
    /**
     * Set the first time a tick finds no opponent, cleared by the next match.
     * Waiting is not a pause: the agent keeps trying every interval and plays
     * the moment someone appears. This is only so the panel can say how long.
     */
    autoplayWaitingSince: timestamp("autoplay_waiting_since", { withTimezone: true }),
    /** When the owner last looked at this agent, for the "since you left" summary. */
    ownerLastSeenAt: timestamp("owner_last_seen_at", { withTimezone: true }),
    /**
     * The owner's daily loss budget, in base units, mirrored from the program's
     * LossBudget account. Null for an agent without one (house, seed, and
     * deposit agents rented before budgets). `lossBudget` is in force now;
     * `lossBudgetNext` applies from UTC day `lossBudgetNextFromDay` when that is
     * set - a cut, which waits for the next day so nothing already agreed is
     * stranded. The ledger stops pairing an agent before it reaches this, so
     * the program's check is never what stops it.
     */
    lossBudget: bigint("loss_budget", { mode: "number" }),
    lossBudgetNext: bigint("loss_budget_next", { mode: "number" }),
    lossBudgetNextFromDay: integer("loss_budget_next_from_day"),
    /**
     * Set when its owner asks for its money while matches are waiting for
     * their hour to be netted: the next pass settles this agent's matches
     * early (src/db/netting.ts), then clears it.
     */
    settleRequestedAt: timestamp("settle_requested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    /** Why it retired: ran out, withdrawn in full, or its rental lapsed. Null while it plays. */
    retiredReason: text("retired_reason").$type<RetiredReason>(),
    /**
     * When this rental ends: always a season boundary (src/season.ts). Checked
     * where a match is recorded, under the agent's lock, so no match plays past
     * it however late the boundary job runs. Past it and not yet retired, the
     * agent is *expired*: it cannot play, and its owner has the grace period to
     * renew. Null for house agents, which never expire.
     */
    rentalEndsAt: timestamp("rental_ends_at", { withTimezone: true }),
  },
  (t) => [
    index("agents_owner_idx").on(t.ownerId),
    uniqueIndex("agents_active_holder_token").on(t.ownerId, t.holderMint)
      .where(sql`${t.ownerId} is not null and ${t.funding} = 'holder' and ${t.retiredAt} is null`),
    index("agents_true_rating_idx").on(t.trueRating),
    // The scheduler's own query: who is due, oldest first.
    index("agents_autoplay_idx").on(t.autoplay, t.autoplayLastMatchAt),
  ],
);

/**
 * Why autoplay stopped. `withdrawal` is a hold and clears itself; the rest are
 * pauses and need the owner. `season` is the boundary: every player agent's
 * autoplay stops when a season ends, renewed or not.
 */
export type AutoplayStop = "floor" | "insolvent" | "retired" | "withdrawal" | "season" | "exit";

/** Whether a stop clears itself, or waits for the owner to switch autoplay back on. */
export const AUTOPLAY_SELF_CLEARING: Record<AutoplayStop, boolean> = {
  withdrawal: true,
  floor: false,
  // Holding too little clears itself: once the wallet holds the minimum again,
  // the agent is back in play with nothing for its owner to switch on.
  insolvent: true,
  retired: false,
  season: false,
  // An owner who asked to leave did not ask to start playing again thirty
  // minutes later. If they cancel and stay, they switch it back on themselves.
  exit: false,
};

/**
 * What happened to an agent's settings, and when: autoplay switched on or off,
 * the floor changed, the band changed. Nothing reads this to decide anything -
 * it is so a question like "why did this agent not play for three hours" has an
 * answer, which the agent's current row cannot give.
 */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    kind: text("kind").$type<AgentEventKind>().notNull(),
    /** Who did it: the owner, the scheduler pausing on its own, or the season boundary. */
    source: text("source").$type<AgentEventSource>().notNull(),
    /** Human-readable: "floor 80", "A -> C", "paused: floor". */
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_events_agent_idx").on(t.agentId, t.createdAt)],
);

export type AgentEventKind =
  | "autoplay-on"
  | "autoplay-off"
  | "floor"
  /** From when an owner could move an agent between bands; none are written now. */
  | "band"
  | "renewed"
  /** Not renewed by the boundary: cannot play, can still be renewed for the grace period. */
  | "expired"
  /** The grace period passed: retired, balance still withdrawable. */
  | "lapsed"
  /** An exit was seen on chain: the agent stops playing until it resolves. */
  | "exit-requested"
  /** The owner took their money without this server co-signing. */
  | "exit-claimed"
  /** The exit went away before it was claimed: cancelled, and the agent is free. */
  | "exit-cancelled";

export type AgentEventSource = "owner" | "autoplay" | "season" | "exit";

/**
 * Why an agent stopped. "unpaid" is a rental whose transaction never landed:
 * the agent existed only so its vault address could be derived, was never
 * funded, and never played - so it is retired rather than left holding its
 * owner's one-agent slot for ever. "closed" is a house agent on the seed
 * program, retired when that program closed (docs/cutover.md): its balance
 * stays where it is, so a drain of its vault still reads as a shortfall.
 * "replaced" is every seed or deposit player agent, retired when holding
 * became the only way to an agent (drizzle/0032_holders_only.sql): its record
 * stays, and its vault, on a program no longer served, is left as it was.
 */
export type RetiredReason = "broke" | "withdrawn" | "lapsed" | "unpaid" | "closed" | "replaced" | "owner" | "no-holdings";

/**
 * An agent's character: its portrait, its name's origin, its bio. Kept in a
 * table of its own, apart from `agents`, on purpose - everything that plays or
 * pays reads `agents`, `matches`, `ledger` and `ratings`, and none of it reads
 * this. A character is identity and presentation only; it cannot reach a match.
 *
 * The portrait is stored, not re-rendered: a later change to the generator does
 * not change an existing face, and a face drawn from the table at rent time
 * survives a new brief.
 */
export const characters = pgTable(
  "characters",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id),
    /** Whether the owner chose the name or it was generated for them. */
    nameSource: text("name_source").$type<"owner" | "generated">().notNull(),
    /** "the Quiet Anvil": shown with the name on the agent page, not in a ladder row. */
    epithet: text("epithet").notNull(),
    bio: text("bio").notNull(),
    bioSource: text("bio_source").$type<"template" | "model">().notNull(),
    portraitVersion: integer("portrait_version").notNull(),
    portraitSvg: text("portrait_svg").notNull(),
    /** The simplified drawing for 24-32 px. */
    portraitSmallSvg: text("portrait_small_svg").notNull(),
    /** Every choice that made the face: unique, so no two agents share one. */
    fingerprint: text("fingerprint").notNull().unique(),
    /** Character type and colour scheme, kept distinct between agents where possible. */
    lookKey: text("look_key").notNull(),
    /** "fox", "porcelain", "visor": what the character is. */
    characterType: text("character_type").notNull(),
    /**
     * `flagged` when a name or bio failed the check and waits for a person to
     * decide; `pending` while a chosen name waits for a check that could not
     * be made when it was given.
     */
    moderation: text("moderation").$type<"ok" | "flagged" | "pending">().notNull().default("ok"),
    moderationNote: text("moderation_note"),
    /**
     * A name the owner chose that has not been checked yet, because the check
     * could not be reached. Until it passes, the agent goes by its generated
     * name in public and only its owner sees this one.
     */
    pendingName: text("pending_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("characters_look_idx").on(t.lookKey)],
);

/**
 * Traits measured from an agent's play, as raw counts (src/character/traits.ts):
 * rates are derived on read. Kept current by a background pass over new
 * matches, never inside the match transaction. Presentation only - nothing
 * that plays or pays reads it.
 */
export const agentTraits = pgTable("agent_traits", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agents.id),
  decisions: integer("decisions").notNull().default(0),
  folds: integer("folds").notNull().default(0),
  raiseChances: integer("raise_chances").notNull().default(0),
  raises: integer("raises").notNull().default(0),
  weakChances: integer("weak_chances").notNull().default(0),
  bluffs: integer("bluffs").notNull().default(0),
  pressured: integer("pressured").notNull().default(0),
  pressuredFolds: integer("pressured_folds").notNull().default(0),
  pressuredRaiseChances: integer("pressured_raise_chances").notNull().default(0),
  pressuredRaises: integer("pressured_raises").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * How far the traits pass has read: the last match seq counted. One row. Moved
 * in the same transaction as the counts it covers, so a match is counted once.
 */
export const traitProgress = pgTable("trait_progress", {
  id: integer("id").primaryKey(),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
});

/**
 * One row per season. The season itself is arithmetic (src/season.ts); this
 * row is its state, and the lock the boundary job takes so that closing a
 * season happens exactly once.
 */
export const seasons = pgTable("seasons", {
  /** The Monday it starts on, YYYY-MM-DD. */
  key: text("key").primaryKey(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status").$type<"open" | "closed">().notNull().default("open"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  /**
   * $GAMINE base units per chip for this season. Null on devnet, where there is
   * no rate; on mainnet the boundary sets it (see onSeasonBoundary).
   */
  chipRate: bigint("chip_rate", { mode: "number" }),
});

/**
 * Final placement, frozen when a season closes: what rewards will pay on. The
 * same figures as the ladder's season view at the boundary, and never
 * recomputed afterwards - a later change to how ratings count must not move a
 * placement that has closed.
 */
export const seasonStandings = pgTable(
  "season_standings",
  {
    season: text("season")
      .notNull()
      .references(() => seasons.key),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    /** 1 is first, by ranked net won: the ladder's order. */
    rank: integer("rank").notNull(),
    /**
     * 1 is first, by ranked net per chip staked: the order prizes pay in.
     * Null for an agent short of the minimum match count, and for any season
     * closed before placement existed.
     */
    prizeRank: integer("prize_rank"),
    rankedMatches: integer("ranked_matches").notNull(),
    /** Ranked net won, as the ladder ranks. Seasons closed while bands existed hold it normalised onto band B's scale. */
    rankedNet: bigint("ranked_net", { mode: "number" }).notNull(),
    rankedStaked: bigint("ranked_staked", { mode: "number" }).notNull(),
    /** The chips those ranked matches actually moved: the per-chip numerator. */
    rankedNetReal: bigint("ranked_net_real", { mode: "number" }).notNull(),
    /** Every staked match in the season, house included, in real money. */
    totalMatches: integer("total_matches").notNull(),
    totalNet: bigint("total_net", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.season, t.agentId] }), index("season_standings_prize_idx").on(t.season, t.prizeRank)],
);

/**
 * An exit the server does not co-sign, as this server knows it.
 *
 * One row per agent, like the Exit PDA it mirrors. The chain is authoritative
 * for what happened; this is only the record of what the ledger has absorbed,
 * and a new exit replaces the old row as a new PDA replaces the old account.
 */
export const exits = pgTable("exits", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agents.id),
  requestedSlot: bigint("requested_slot", { mode: "number" }).notNull(),
  unlockSlot: bigint("unlock_slot", { mode: "number" }).notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  /** Null until the chain says it was claimed. */
  claimedSlot: bigint("claimed_slot", { mode: "number" }),
  claimedAmount: bigint("claimed_amount", { mode: "number" }),
  /**
   * When the ledger absorbed this claim. Null while the vault is legitimately
   * ahead of the ledger, which the reconciler explains rather than alarms on.
   */
  ingestedAt: timestamp("ingested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Negotiation matches (docs/negotiation.md), kept apart from Bluff & Fold's: nothing here touches the
 * ledger, the ladder or the scores while the game is an exhibition. `scored` marks the matches that
 * count once scoring is switched on. The log is the public transcript; the bottom lines in it are
 * private only while a match is played, and it is stored once played.
 */
export const negotiationMatches = pgTable(
  "negotiation_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
    agentA: uuid("agent_a").notNull().references(() => agents.id),
    agentB: uuid("agent_b").notNull().references(() => agents.id),
    presetA: text("preset_a").notNull(),
    presetB: text("preset_b").notNull(),
    /** uint32, as a Bluff & Fold match's. */
    seed: bigint("seed", { mode: "number" }).notNull(),
    netA: integer("net_a").notNull(),
    netB: integer("net_b").notNull(),
    scored: boolean("scored").notNull().default(false),
    log: jsonb("log").$type<NegotiationLog>().notNull(),
  },
  (t) => [index("negotiation_matches_seq").on(t.seq), index("negotiation_matches_agent_a").on(t.agentA), index("negotiation_matches_agent_b").on(t.agentB)],
);
export type NegotiationMatchRow = typeof negotiationMatches.$inferSelect;

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic, so "the last N matches" is deterministic even within one timestamp. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    agentA: uuid("agent_a")
      .notNull()
      .references(() => agents.id),
    agentB: uuid("agent_b")
      .notNull()
      .references(() => agents.id),
    /** uint32; wider than a Postgres integer, so bigint. */
    seed: bigint("seed", { mode: "number" }).notNull(),
    rulesConfig: jsonb("rules_config").$type<RulesConfig>().notNull(),
    winner: text("winner").$type<Seat>(),
    netA: integer("net_a").notNull(),
    netB: integer("net_b").notNull(),
    /** The widest net the match could produce, in chips (WORST_MATCH). It moves no money. */
    stake: integer("stake").notNull().default(0),
    /**
     * Whether this match counts toward the ladder: true only when both agents
     * were player-rented. A match against a house agent settles for money and
     * moves balances like any other, but earns no ranking - the house presets
     * are fixed and their weaknesses are exactly computable (src/exact.ts), so
     * counting them would let an owner farm the reward pool off our own bots.
     *
     * Recorded per match rather than joined from ownership at read time. An
     * agent changes hands at auction, and a result must stay readable as the
     * match it was: deriving this later would rewrite history every time an
     * agent was sold.
     */
    ranked: boolean("ranked").notNull().default(false),
    /** The full match log. This is the public transcript. */
    log: jsonb("log").$type<MatchLog>().notNull(),
    /**
     * House agents playing each other to keep the platform moving. Recorded and
     * shown like any match, but nothing is staked: no ledger rows, no chain
     * settlement, and no effect on ratings, records or the ladder.
     */
    exhibition: boolean("exhibition").notNull().default(false),
    /**
     * The season it was played in, from the moment it was recorded. Null for
     * matches from before seasons, which count only all-time. Not a foreign
     * key: a season is arithmetic (src/season.ts), and a match at 00:00:05 on
     * Monday belongs to the new season before its row has been written.
     */
    season: text("season"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("matches_season_idx").on(t.season, t.ranked),
    index("matches_agent_a_idx").on(t.agentA, t.createdAt),
    index("matches_agent_b_idx").on(t.agentB, t.createdAt),
    index("matches_created_idx").on(t.createdAt),
    index("matches_seq_idx").on(t.seq),
  ],
);

/**
 * Every movement of money. Balances are the sum of an agent's rows rather than
 * a column that is incremented: the same reasoning as ratings, so a balance
 * cannot drift away from the events that produced it.
 */
export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic, so a balance at a point in time is well defined. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    /**
     * Signed base units of the agent's stake token; positive is money in.
     * Never chips - see src/chips.ts for why no chip figure is ever stored.
     * Wide because six decimals put a 900-chip balance at 9e8, and a 32-bit
     * column tops out at about 2,147 chips.
     */
    amount: bigint("amount", { mode: "number" }).notNull(),
    reason: text("reason").$type<LedgerReason>().notNull(),
    /** Set for settlements. */
    matchId: uuid("match_id").references(() => matches.id),
    /** Set for withdrawals, and for reversing one that never landed. */
    withdrawalId: uuid("withdrawal_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_agent_idx").on(t.agentId, t.seq), index("ledger_match_idx").on(t.matchId)],
);

export type LedgerReason =
  | "rental-seed"
  /** The owner's own money, moved into the vault: at rent time, or a top-up. */
  | "deposit"
  | "match-settlement"
  | "adjustment"
  /** Money out of an agent's vault to its owner. */
  | "withdrawal"
  /** A withdrawal that could never land on chain, put back. */
  | "withdrawal-reversed"
  /**
   * An exit the owner took themselves, read back off the chain. The only
   * reason the ledger ever follows the chain rather than leading it.
   */
  | "exit";

/** One row per model call, so the first elicitation for an owner can be free. */
export const elicitations = pgTable(
  "elicitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The owner's wallet public key. */
    ownerId: text("owner_id").notNull(),
    /** "preview" rates a brief; "rent" writes an agent's table. */
    kind: text("kind").$type<"preview" | "rent">().notNull(),
    /** True when it did not count against the owner's allowance. */
    free: boolean("free").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("elicitations_owner_idx").on(t.ownerId, t.createdAt)],
);

/**
 * Single-use sign-in challenges. A nonce is bound to one public key, expires
 * quickly, and is burnt on first use, so a captured signature cannot be
 * replayed.
 */
export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  publicKey: text("public_key").notNull(),
  /** The exact text the wallet is asked to sign. Verified byte for byte. */
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/**
 * Sessions after a verified signature. Only a hash of the token is stored, so
 * a read of this table does not hand out working sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    ownerId: text("owner_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_owner_idx").on(t.ownerId)],
);

/**
 * The outbox between the ledger and the chain. Renting and settling write a
 * row here in the same transaction as the ledger movement; a worker submits
 * them to the settlement program in order. A slow or failing chain therefore
 * never blocks or undoes a match - the ledger is authoritative, and the chain
 * catches up and records it.
 */
export const chainOps = pgTable(
  "chain_ops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Submission order: a vault must open before its first settlement. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    /** register_owner: only in history; owners are now recorded as their vault opens. */
    /**
     * net: one agent's net for one cut of netted matches (src/db/netting.ts).
     * It pays into clearing when `fromAgent` is set, and is paid out of it when
     * `toAgent` is; `agentId` is the agent either way.
     */
    kind: text("kind").$type<"open_vault" | "settle" | "register_owner" | "withdraw" | "net">().notNull(),
    agentId: uuid("agent_id").references(() => agents.id),
    matchId: uuid("match_id").references(() => matches.id),
    fromAgent: uuid("from_agent").references(() => agents.id),
    toAgent: uuid("to_agent").references(() => agents.id),
    /** Base units, as the program takes them. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** open_vault (and, historically, register_owner): the owner's wallet; null for a house agent. */
    owner: text("owner"),
    /** open_vault: the salt that, hashed with the owner, gives the agent's id (src/agent-id.ts). */
    salt: text("salt"),
    /** withdraw: which withdrawal, whose signed transaction the op sends. */
    withdrawalId: uuid("withdrawal_id"),
    /**
     * netted: a netted match that a cut has taken. Done as a row - its agents'
     * net ops are what is still to land.
     */
    status: text("status").$type<"pending" | "confirmed" | "failed" | "netted">().notNull().default("pending"),
    /** settle: this match settles through its agents' hourly nets, and is never sent alone. */
    netted: boolean("netted").notNull().default(false),
    /** A netted settle row, the cut that took it; a net op, the cut it belongs to. */
    cut: uuid("cut"),
    /** net: the agent's settlement number on chain, one more than its last. */
    batch: bigint("batch", { mode: "number" }),
    /** net: the UTC day its matches were played, which a loss budget charges. */
    day: integer("day"),
    signature: text("signature"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chain_ops_status_idx").on(t.status, t.seq),
    index("chain_ops_match_idx").on(t.matchId),
    index("chain_ops_cut_idx").on(t.cut),
  ],
);

/**
 * A withdrawal from an agent's vault to its owner. Prepared by the server
 * (which co-signs), signed by the owner, then recorded in the ledger and the
 * outbox together and sent. "expired" means it could never land any more and
 * the ledger was put back.
 */
export const withdrawals = pgTable(
  "withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    ownerId: text("owner_id").notNull(),
    /** Base units out of the vault. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** Base units the vault holds afterwards; the program checks this against the vault. */
    remaining: bigint("remaining", { mode: "number" }).notNull(),
    /** Taking the lot retires the agent. */
    retire: boolean("retire").notNull(),
    status: text("status").$type<WithdrawalStatus>().notNull().default("prepared"),
    /** The transaction as prepared, settler-signed, base64; the owner must sign exactly this. */
    preparedTx: text("prepared_tx").notNull(),
    /** The same, with the owner's signature. */
    signedTx: text("signed_tx"),
    lastValidBlockHeight: bigint("last_valid_block_height", { mode: "number" }).notNull(),
    signature: text("signature"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("withdrawals_agent_idx").on(t.agentId, t.status)],
);

export type WithdrawalStatus = "prepared" | "submitted" | "confirmed" | "expired";

/**
 * A deposit-funded rental: the fee and the first deposit, as one transaction
 * the owner signs.
 *
 * The agent row exists from the moment this is prepared, because its id is what
 * the vault address derives from, so the transaction cannot be built without
 * it. Until the transaction lands that agent has no balance and no vault: it
 * holds its owner's one-agent slot and nothing else. If the transaction never
 * lands, the sweep retires it and the slot comes back.
 *
 * Shaped like `withdrawals` because it is the same problem in the other
 * direction: something the server builds, the owner signs, and only then is
 * recorded.
 */
export const rentals = pgTable(
  "rentals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    ownerId: text("owner_id").notNull(),
    /** Base units burned for the rental. Never enters the vault, so never the ledger. */
    fee: bigint("fee", { mode: "number" }).notNull(),
    /** Base units moved from the owner's wallet into the new vault. */
    deposit: bigint("deposit", { mode: "number" }).notNull(),
    /** The salt the agent's id derives from, needed to build the transaction. */
    salt: text("salt").notNull(),
    status: text("status").$type<RentalPaymentStatus>().notNull().default("prepared"),
    /** The transaction as prepared, settler-signed, base64; the owner must sign exactly this. */
    preparedTx: text("prepared_tx").notNull(),
    signedTx: text("signed_tx"),
    lastValidBlockHeight: bigint("last_valid_block_height", { mode: "number" }).notNull(),
    signature: text("signature"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rentals_agent_idx").on(t.agentId, t.status), index("rentals_status_idx").on(t.status)],
);

export type RentalPaymentStatus = "prepared" | "submitted" | "confirmed" | "expired";

/**
 * A top-up: the owner's own money moved into an agent's vault after it was
 * rented. This is what revives an agent that played itself down to nothing,
 * which the seed flow had no answer for at all.
 *
 * Only a record of the transaction, not of the money - the ledger row is
 * written when it lands. A deposit that arrives without going through here is
 * still the agent's money, and the reconciler credits it.
 */
export const deposits = pgTable(
  "deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    ownerId: text("owner_id").notNull(),
    /** Base units moved from the owner's wallet into the vault. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: text("status").$type<RentalPaymentStatus>().notNull().default("prepared"),
    preparedTx: text("prepared_tx").notNull(),
    signedTx: text("signed_tx"),
    lastValidBlockHeight: bigint("last_valid_block_height", { mode: "number" }).notNull(),
    signature: text("signature"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deposits_agent_idx").on(t.agentId, t.status), index("deposits_status_idx").on(t.status)],
);

export const ratings = pgTable("ratings", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agents.id),
  /**
   * Every staked match, house opponents included: what this agent's money
   * actually did. Shown on its own panel and beside the ladder's figure, so an
   * owner can see that winnings against the house were not taken away - they
   * were never ranked.
   */
  matchesPlayed: integer("matches_played").notNull().default(0),
  /**
   * All-time net won across every staked match, in real money: the chips the
   * agent actually won or lost in its matches.
   */
  cumulativeNet: bigint("cumulative_net", { mode: "number" }).notNull().default(0),
  /**
   * The same two figures over player-versus-player matches only. **These are
   * what the ladder ranks on**, and what a minimum match count counts. House
   * matches are excluded because a fixed preset's weaknesses are exactly
   * computable, so beating them is not evidence of anything a prize should pay
   * for.
   */
  rankedMatches: integer("ranked_matches").notNull().default(0),
  rankedNet: bigint("ranked_net", { mode: "number" }).notNull().default(0),
  /** Total staked across ranked matches, for net-per-chip-staked ranking. */
  rankedStaked: bigint("ranked_staked", { mode: "number" }).notNull().default(0),
  /**
   * Mean net over the agent's last RATING_WINDOW matches. Displayed as recent
   * form, never as a ranking: with ~23 chips of per-match variance its own
   * spread is about +/-5.6, far wider than the gaps between agents.
   */
  rollingNet50: doublePrecision("rolling_net_50").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Matches counted by the displayed recent-form figure. */
export const RATING_WINDOW = 50;

/**
 * The least an agent must hold to be in play, in chips: $20 of $GAMINE at the
 * peg of 900 chips to $5 (docs/economy.md, the chip rate). Nothing is staked,
 * so it is never spent (docs/no-loss-rewards.md): it is what a rental must be
 * funded with, what a withdrawal must leave to keep playing, and the $20 the
 * reward weight is measured against.
 *
 * For a holder agent it is the dollar-pegged minimum a wallet must hold to
 * have an agent at all (docs/holder-agents.md, decision 3). In chips, so the
 * season's rate turns it into tokens and it holds its dollar value as the
 * rate is retuned at each boundary.
 */
export const MIN_FUNDING_CHIPS = 3_600;

/**
 * How often autoplay plays one agent. Ten minutes is the figure every survival
 * number is measured at (src/survival.ts), so changing it invalidates the
 * table the rent screen quotes. Overridable for testing on devnet through
 * AUTOPLAY_INTERVAL_MS.
 */
export const AUTOPLAY_INTERVAL_MS = 10 * 60 * 1000;

/** Each owner's first elicitation costs them nothing. */
export const FREE_ELICITATIONS = 1;

/**
 * Devnet only: stake tokens handed out so somebody can try the game without
 * buying anything. There is no equivalent on mainnet, where the supply is
 * fixed and every token has an owner.
 *
 * A row is written before the transfer and marked failed if it never lands, so
 * a grant that did not arrive does not use up a wallet's turn. A row that is
 * still pending counts against the wait, which is what stops two requests
 * arriving together from paying out twice.
 */
export const faucetGrants = pgTable(
  "faucet_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The wallet that asked, which is the only one it can pay. */
    wallet: text("wallet").notNull(),
    /** Base units sent. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: text("status").$type<"pending" | "sent" | "failed">().notNull().default("pending"),
    signature: text("signature"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("faucet_grants_wallet_idx").on(t.wallet, t.createdAt)],
);

/**
 * What each wallet holds of the token, as last read off chain
 * (src/db/holdings.ts). A holder agent's balance is this row, not a sum of
 * ledger movements: the tokens never leave the owner's wallet, so there is no
 * movement to record, only a reading to take.
 *
 * One row per wallet, overwritten by each read. It is a snapshot, so a sell
 * and a rebuy between two reads is not seen - the gap docs/economy.md's
 * roadmap states for conviction, which will run on these readings.
 */
export const holdings = pgTable("holdings", {
  /** The owner's wallet: a base58 Solana public key, as `agents.ownerId`. */
  wallet: text("wallet").notNull(),
  mint: text("mint").notNull().default(""),
  minimum: bigint("minimum", { mode: "number" }),
  priceUsd: doublePrecision("price_usd"),
  decimals: integer("decimals"),
  priceAt: timestamp("price_at", { withTimezone: true }),
  /** Base units of the token across every account the wallet owns for it. */
  amount: bigint("amount", { mode: "number" }).notNull(),
  /** The token's total supply in base units at the same read: what position divides by. */
  supply: bigint("supply", { mode: "number" }).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
  /**
   * Conviction (docs/holder-agents.md): the minimum in base units at the
   * reading where this wallet qualified, and when that was. The clock runs
   * while the wallet holds at least this amount, whatever the minimum is
   * retuned to; a reading below it resets both. Null while there is no clock.
   */
  convictionAmount: bigint("conviction_amount", { mode: "number" }),
  convictionSince: timestamp("conviction_since", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.wallet, t.mint] })]);

/**
 * A UTC day whose scores are frozen (src/db/scores.ts). One row per day, the
 * lock that makes freezing happen once, and the parameters the day was scored
 * with - so a day's qualifying bar can be read afterwards whatever the
 * parameters are set to later.
 */
export const scoreDays = pgTable("score_days", {
  /** The UTC day: unix days, as utcDay counts them. */
  day: integer("day").primaryKey(),
  opponentCap: integer("opponent_cap").notNull(),
  minDailyMatches: integer("min_daily_matches").notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
});

/**
 * One agent's score for one UTC day, frozen once the day is over and never
 * recomputed (docs/holder-agents.md, Scoring). The power inputs are stored
 * beside the score, so anyone can check the weight against what it was made of.
 */
export const dailyScores = pgTable(
  "daily_scores",
  {
    day: integer("day")
      .notNull()
      .references(() => scoreDays.day),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    rankedMatches: integer("ranked_matches").notNull(),
    /** Net chips, capped per opponent and floored at zero. */
    points: integer("points").notNull(),
    /** Whether it met the day's minimum of ranked matches, and so would be paid for the day. */
    qualified: boolean("qualified").notNull(),
    convictionDays: integer("conviction_days").notNull(),
    /** The fraction of supply its owner's wallet held at the reading used. */
    shareOfSupply: doublePrecision("share_of_supply").notNull(),
    power: doublePrecision("power").notNull(),
    weight: doublePrecision("weight").notNull(),
    score: doublePrecision("score").notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.agentId] })],
);

/**
 * What one grant hands out, in chips. Enough to rent at the 200-chip fee and
 * still fund an agent with the 3,600-chip minimum (MIN_FUNDING_CHIPS).
 */
export const FAUCET_GRANT_CHIPS = 4_000;
/** How long a wallet waits between grants. */
export const FAUCET_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The widest net a match can produce, in chips: two rounds at the raised bet.
 * A match is first to two rounds, so the winner can never take a third, and a
 * round is never worth more than the raised bet - enumerating every draw and
 * flip for the four presets confirms it, and no decision table can beat it.
 *
 * Every match plays at one scale, the engine's own stakes (GAMINE_RULES:
 * ante 4, bet 10, raised 20). Bands, which multiplied every amount to set what
 * a match could move, are gone (drizzle/0028_no_bands.sql): with nothing
 * staked they had no job, and a chip is a chip everywhere. This moves no
 * money; it is what a match row records the match was played at.
 */
export const WORST_MATCH = 40;

export type AgentRow = typeof agents.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type RatingRow = typeof ratings.$inferSelect;
export type LedgerRow = typeof ledger.$inferSelect;
export type ChainOpRow = typeof chainOps.$inferSelect;

/** Ending an automatic agent opts out of automatic recreation across devices. */
export const holderPreferences = pgTable("holder_preferences", {
  wallet: text("wallet").notNull(),
  mint: text("mint").notNull().default(""),
  automatic: boolean("automatic").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.wallet, t.mint] })]);

/** Confirmed launch mints, imported only from the operator-configured web service. */
export const holderTokens = pgTable("holder_tokens", {
  mint: text("mint").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
});
