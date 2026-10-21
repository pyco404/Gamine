import type { HolderCatalog } from "../db/holder-catalog.js";
import { readWorldActivities } from "../db/world-activities.js";
import { activateHolder, endHolder } from "../db/holder-activation.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { and, eq, inArray, isNull, sql, isNotNull } from "drizzle-orm";
import { elicitPolicy } from "../agents/llm.js";
import { validatePolicy, type Policy } from "../agents/policy.js";
import { headlineFor, renderTranscript } from "../transcript.js";
import { PRESET_DESCRIPTIONS, PRESET_NAMES, type PresetName } from "../presets.js";
import type { Db } from "../db/client.js";
import { agents, matches, AUTOPLAY_INTERVAL_MS } from "../db/schema.js";
import { inPlaySql, isFirstElicitationFree, recordElicitation, StakeError } from "../db/ledger.js";
import {
  activeAgentsOf,
  agentsOf,
  createAgent,
  snapshotPreset,
  leaderboard,
  ownerAgent,
  pickOpponent,
  publicAgent,
  roster,
  runMatch,
  type LadderTab,
  field,
} from "../db/runner.js";
import { autoplayStatus, markSeen, setAutoplay, sinceYouLeft } from "../db/autoplay.js";
import { dayFromDate, dayOf, dayScores, seasonScores } from "../db/scores.js";
import { negotiationById, negotiationFeed, negotiationsBefore } from "../db/negotiation.js";
import { seasonStatement } from "../db/statement.js";
import { characterOf, createCharacter, isDefaultName, NO_MODEL, ownerCharacter, portraitSvg, publicCharacter, type CharacterDeps } from "../character/store.js";
import { moderate, type Verdict } from "../character/moderation.js";
import { traitsOf } from "../character/trait-store.js";
import { dayStart, seasonAt, seasonByKey } from "../season.js";
import { previewPolicy, refreshTrueRatings, scoringProfile } from "../db/rating.js";
import { agentRecord, latestBluff, matchActivity, recentMatches } from "../db/feed.js";

import { RateLimiter, type RateLimitRule } from "./rate-limit.js";
import { LiveStream, resumeFrom, type LiveOptions } from "./live.js";
import { rateOf, seasonRate, type Funding } from "../chips.js";
import { faucetStatus, grantFaucet, FaucetError, type FaucetChain } from "../db/faucet.js";
import { holdingMinimum, holdingOf, holdingView, keeps, readHolding, type Holding, type HoldingsChain } from "../db/holdings.js";
import { conviction, CONVICTION_CAP_DAYS, filledShares, position, power, weight } from "../score.js";
import { chips as toChips } from "../chips.js";
import { AuthError, isPublicKey, issueNonce, ownerForToken, revokeSession, verifySignIn } from "../auth/wallet.js";

/**
 * Thin HTTP layer over the runner.
 *
 * Identity is a Solana wallet. A caller asks for a nonce, signs the returned
 * message with its wallet, and exchanges the signature for a session token
 * sent as "Authorization: Bearer <token>". The owner of everything below is
 * the wallet public key behind that session - never a value the caller simply
 * asserts.
 */
export type Elicit = (input: { brief: string }) => Promise<{ table: Policy | null; reason?: string }>;

export type AppOptions = {
  db: Db;
  /** Defaults to one model call per request. Injected in tests so they never spend money. */
  elicit?: Elicit;
  /** Applies to the endpoints that can reach a model. Default 5 a minute. */
  rateLimit?: RateLimitRule;
  /** Applies to playing matches: no model call, but it writes rows. Default 30 a minute. */
  playRateLimit?: RateLimitRule;
  /** The domain named in the sign-in message. Defaults to AUTH_DOMAIN or localhost:3000. */
  authDomain?: string;
  /** Applies to nonce requests, which anyone can make. Default 20 a minute. */
  nonceRateLimit?: RateLimitRule;
  /**
   * Faucet grants per wallet, on top of the one-a-day rule in the ledger.
   * Default 3 an hour.
   */
  faucetRateLimit?: RateLimitRule;
  /** Renting and topping up per wallet. Default 5 an hour. */
  rentRateLimit?: RateLimitRule;
  /**
   * The same per address. Looser than the per-wallet rules on purpose: an
   * address is a poor proxy for a person, because a household, an office or a
   * mobile network share one, so a limit tight enough to stop a script would
   * also turn away the third real person behind a router. Wallets are the other
   * way round - one person can make any number - which is why neither key works
   * alone. Default 20 rentals and 12 faucet grants an hour.
   */
  rentAddressRateLimit?: RateLimitRule;
  faucetAddressRateLimit?: RateLimitRule;
  /**
   * Browser origins allowed to call this API. The web app runs on its own
   * origin, so without this every request from it fails before it is sent.
   * Defaults to CORS_ORIGIN or localhost:3000.
   */
  corsOrigin?: string;
  now?: () => number;
  /**
   * Wallets that may read /admin. Defaults to ADMIN_WALLETS, and to nothing at
   * all when that is unset - a deployment that forgets it gets no admin page,
   * not an open one.
   */
  adminWallets?: string[];
  /**
   * What /admin reports. Built in scripts/serve.ts, where the holdings reader
   * and the loops live. Without it /admin answers 503 for an allowed wallet.
   */
  health?: () => Promise<unknown>;
  /**
   * The devnet faucet. Absent on every other cluster, and not by configuration:
   * what builds it refuses any chain but devnet (src/chain/faucet.ts). Without
   * it the faucet endpoints answer 503.
   */
  faucet?: FaucetChain;
  /**
   * Holder agents (docs/holder-agents.md): a wallet holding the token above
   * the minimum has an agent, with nothing rented or deposited. When set and
   * `allow` says yes, a new agent takes this flow ahead of the other two, and
   * the wallet's holding is read fresh before it is created.
   */
  holder?: {
    chain: HoldingsChain;
    catalog?: HolderCatalog;
    /** Public explorer identity; the primary token uses an empty database scope. */
    primaryMint?: string;
    solanaCluster?: "mainnet-beta" | "devnet" | null;
    /** Whose new agents take this flow. */
    allow: (ownerId: string) => boolean;
  };
  /**
   * How often autoplay plays one agent, so the panel's countdown matches the
   * loop that is actually running. Defaults to AUTOPLAY_INTERVAL_MS from the
   * environment, which is what scripts/serve.ts starts the loop with.
   */
  autoplayIntervalMs?: number;
  /**
   * The model calls characters use: checking a chosen name, writing a bio for
   * a brief-written agent. Without them, templates and the local rules only -
   * which is the default, so tests never reach a model.
   */
  character?: CharacterDeps;
  /** The live stream's pacing and limits. Tests shorten the poll. */
  live?: LiveOptions;
  /** How long one read of /field is served to everyone. Default 2 s; tests set 0. */
  fieldCacheMs?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 64 * 1024;

const defaultElicit: Elicit = async ({ brief }) => {
  const { log } = await elicitPolicy({ brief });
  return log.policy ? { table: log.policy } : { table: null, reason: log.fallback?.reason ?? "no table returned" };
};

/** A response that is not JSON: a portrait, served as the image it is. */
class Raw {
  constructor(
    readonly body: string,
    readonly contentType: string,
    readonly headers: Record<string, string> = {},
  ) {}
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function createApp(options: AppOptions): Server {
  const { db } = options;
  const autoplayIntervalMs =
    options.autoplayIntervalMs ?? (Number(process.env["AUTOPLAY_INTERVAL_MS"]) || AUTOPLAY_INTERVAL_MS);
  const elicit = options.elicit ?? defaultElicit;
  // No model unless one is given: scripts/serve.ts passes Haiku when a key is set.
  const characterDeps = options.character ?? NO_MODEL;
  const limiter = new RateLimiter(options.rateLimit ?? { limit: 5, windowMs: 60_000 }, options.now);
  // Playing costs no money but writes a match row and rewrites two ratings;
  // unbounded, it is a cheap way to bloat the transcript table.
  const playLimiter = new RateLimiter(options.playRateLimit ?? { limit: 30, windowMs: 60_000 }, options.now);
  const nonceLimiter = new RateLimiter(options.nonceRateLimit ?? { limit: 20, windowMs: 60_000 }, options.now);
  const faucetLimiter = new RateLimiter(options.faucetRateLimit ?? { limit: 3, windowMs: 3_600_000 }, options.now);
  const rentLimiter = new RateLimiter(options.rentRateLimit ?? { limit: 5, windowMs: 3_600_000 }, options.now);
  const faucetByAddress = new RateLimiter(options.faucetAddressRateLimit ?? { limit: 12, windowMs: 3_600_000 }, options.now);
  const rentByAddress = new RateLimiter(options.rentAddressRateLimit ?? { limit: 20, windowMs: 3_600_000 }, options.now);

  /**
   * Charges an attempt against the wallet *and* the address it came from.
   *
   * The older limiter keys on one or the other - the wallet when signed in,
   * otherwise the address - which leaves a gap either way: one wallet behind
   * many addresses, or one address cycling through wallets, which costs nothing
   * to make. Both buckets have to have room, and a request refused by the
   * second does not spend the first.
   */
  function spendBoth(
    perWallet: RateLimiter,
    perAddress: RateLimiter,
    ownerId: string,
    clientKey: string,
    what: string,
  ): void {
    const byWallet = perWallet.take(ownerId);
    if (!byWallet.ok) {
      throw new HttpError(429, `too many ${what} from this wallet; try again in ${byWallet.retryAfterSeconds}s`, {
        retryAfter: byWallet.retryAfterSeconds,
      });
    }
    const byAddress = perAddress.take(clientKey);
    if (!byAddress.ok) {
      // Give the wallet its attempt back: it did nothing wrong, and it should
      // not lose an hour's allowance to whoever else is behind this address.
      perWallet.refund(ownerId);
      throw new HttpError(429, `too many ${what} from this connection; try again in ${byAddress.retryAfterSeconds}s`, {
        retryAfter: byAddress.retryAfterSeconds,
      });
    }
  }
  const authDomain = options.authDomain ?? process.env["AUTH_DOMAIN"] ?? "localhost:3000";
  // The table a player was shown when they rated a brief is the table they rent,
  // with no second model call: the model is not deterministic, so asking again
  // could hand them a different agent from the one they just saw rated. Keyed by
  // owner and exact brief; tables still only ever come from the model.
  const rated = new Map<string, { table: Policy; at: number }>();
  const RATED_TTL_MS = 60 * 60_000;
  const ratedKey = (ownerId: string, brief: string) => `${ownerId}\n${brief}`;
  const now = options.now ?? Date.now;
  const takeRated = (ownerId: string, brief: string): Policy | undefined => {
    const hit = rated.get(ratedKey(ownerId, brief));
    return hit && now() - hit.at < RATED_TTL_MS ? hit.table : undefined;
  };
  const remember = (ownerId: string, brief: string, table: Policy) => {
    if (rated.size >= 5_000) rated.delete(rated.keys().next().value!);
    rated.set(ratedKey(ownerId, brief), { table, at: now() });
  };

  const routes: [string, RegExp, (ctx: Ctx) => Promise<unknown>][] = [
    ["POST", /^\/auth\/nonce$/, postNonce],
    ["POST", /^\/auth\/verify$/, postVerify],
    ["POST", /^\/auth\/logout$/, postLogout],
    ["GET", /^\/auth\/me$/, getMe],
    ["POST", /^\/agents$/, postAgent],
    ["GET", /^\/agents\/([^/]+)$/, getAgent],
    ["POST", /^\/agents\/([^/]+)\/play$/, postPlay],
    ["POST", /^\/agents\/([^/]+)\/autoplay$/, postAutoplay],
    ["POST", /^\/agents\/([^/]+)\/end$/, postEndAgent],
    ["POST", /^\/agents\/([^/]+)\/seen$/, postSeen],
    ["GET", /^\/agents\/([^/]+)\/portrait\.svg$/, getPortrait],
    ["GET", /^\/matches$/, getFeed],
    ["GET", /^\/matches\/([^/]+)$/, getMatch],
    ["GET", /^\/negotiations$/, getNegotiations],
    ["GET", /^\/negotiations\/([^/]+)$/, getNegotiation],
    ["GET", /^\/agents\/([^/]+)\/matches$/, getAgentMatches],
    ["GET", /^\/ladder$/, getLadder],
    ["GET", /^\/stats$/, getStats],
    ["GET", /^\/presets$/, getPresets],
    ["GET", /^\/roster$/, getRoster],
    ["GET", /^\/field$/, getField],
    ["GET", /^\/world\/jobs$/, async () => ({ jobs: (await readWorldActivities(db, (options.now ?? Date.now)())).jobs })],
    ["GET", /^\/season$/, getSeason],
    ["GET", /^\/scores$/, getScores],
    ["GET", /^\/statement$/, getStatement],
    ["GET", /^\/admin$/, getAdmin],
    ["GET", /^\/admin\/payout-recipients$/, getPayoutRecipients],
    ["GET", /^\/holding$/, getHolding],
    ["POST", /^\/holding$/, postHolding],
    ["GET", /^\/faucet$/, getFaucet],
    ["POST", /^\/faucet$/, postFaucet],
    ["POST", /^\/preview$/, postPreview],
  ];

  type Ctx = {
    params: string[];
    query: URLSearchParams;
    body: Record<string, unknown>;
    /** The wallet behind the caller's session, or null when signed out. */
    ownerId: string | null;
    /** The raw session token, for logout. */
    token: string | null;
    clientKey: string;
    /** Throws 401 unless the caller has a live session. */
    requireOwner: () => string;
    /**
     * Charges a model call against the caller's allowance, unless this is the
     * owner's first: nobody should have to spend one before seeing a transcript.
     */
    spend: (kind: "preview" | "rent") => Promise<boolean>;
    /** Throws 429 when the caller has played too many matches this minute. */
    spendPlay: () => void;
    refund: () => void;
  };

  async function postNonce(ctx: Ctx) {
    const result = nonceLimiter.take(ctx.clientKey);
    if (!result.ok) {
      throw new HttpError(429, "too many sign-in attempts", { retryAfterSeconds: result.retryAfterSeconds });
    }
    const publicKey = ctx.body["publicKey"];
    if (!isPublicKey(publicKey)) throw new HttpError(400, "publicKey must be a base58 Solana public key");
    const issued = await issueNonce(db, publicKey, authDomain);
    return { nonce: issued.nonce, message: issued.message, expiresAt: issued.expiresAt };
  }

  async function postVerify(ctx: Ctx) {
    const { publicKey, nonce, signature } = ctx.body;
    if (typeof publicKey !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
      throw new HttpError(400, "publicKey, nonce and signature are required");
    }
    try {
      const session = await verifySignIn(db, { publicKey, nonce, signature });
      return { token: session.token, ownerId: session.ownerId, expiresAt: session.expiresAt };
    } catch (error) {
      // One status for every failure: the caller learns it did not verify, not why.
      if (error instanceof AuthError) throw new HttpError(401, "sign-in failed", { reason: error.message });
      throw error;
    }
  }

  async function postLogout(ctx: Ctx) {
    ctx.requireOwner();
    await revokeSession(db, ctx.token!);
    return { signedOut: true };
  }

  async function getMe(ctx: Ctx) {
    const ownerId = ctx.requireOwner();
    if (options.holder?.allow(ownerId)) {
      const last = await holdingOf(db, ownerId);
      if (!last || Date.now() - last.readAt.getTime() > 60_000) {
        ctx.spendPlay();
        try { await readHolding(db, options.holder.chain, ownerId); }
        catch { /* Preserve the last verified reading during an RPC outage. */ }
      }
      await activateHolder(db, ownerId);
      await options.holder.catalog?.refreshWallet(ownerId);
    }
    const tokenHoldings = options.holder?.allow(ownerId) && options.holder.catalog
      ? await Promise.all((await options.holder.catalog.tokens()).map(async (token) => ({
        ...token, holding: holdingView(await holdingOf(db, ownerId, token.mint)),
      }))) : [];
    // Every agent this wallet owns, so a second device shows the same ones as the first.
    return {
      ownerId,
      agents: await agentsOf(db, ownerId),
      tokenHoldings,
      /** This wallet's last reading against the minimum; null where the server reads no holdings. */
      holding: options.holder?.allow(ownerId) ? holdingView(await holdingOf(db, ownerId)) : null,
    };
  }

  async function postAgent(ctx: Ctx) {
    const ownerId = ctx.requireOwner();
    // Before anything is created or any model is called: creating an agent writes rows.
    spendBoth(rentLimiter, rentByAddress, ownerId, ctx.clientKey, "rentals");
    const presetName = ctx.body["presetName"] as PresetName | undefined;
    const brief = typeof ctx.body["brief"] === "string" ? ctx.body["brief"].trim() : "";
    if (!presetName && !brief) throw new HttpError(400, "presetName or brief is required");
    if (presetName && !PRESET_NAMES.includes(presetName)) {
      throw new HttpError(400, `unknown preset ${presetName}`, { known: PRESET_NAMES });
    }
    // A name is optional: without one - or with one the rent screen filled in -
    // the agent's character is named for it. A name the owner chose is checked
    // before anything is spent on a model call for the brief.
    const given = String(ctx.body["name"] ?? "").trim();
    const chosenName = given && !isDefaultName(given) ? given : null;
    let nameVerdict: Verdict | undefined;
    if (chosenName) {
      nameVerdict = await moderate(chosenName, "name", characterDeps.check);
      if (!nameVerdict.ok) throw new HttpError(400, nameVerdict.reason ?? "that name can't be used");
    }
    const name = chosenName ?? "New agent";

    // Holding is the agent: the wallet must hold the minimum, read now rather
    // than trusted to an old reading - and before any model call is spent on a
    // brief for an agent the wallet cannot have.
    const holder = options.holder?.allow(ownerId) ? options.holder : undefined;
    if (!holder) {
      throw new HttpError(
        options.holder ? 403 : 503,
        options.holder ? "agents aren't open to this wallet yet" : "this server reads no wallets, so it can't give anyone an agent",
      );
    }
    const holderMint = typeof ctx.body["holderMint"] === "string" ? ctx.body["holderMint"] : "";
    const selectedChain = holderMint ? await holder.catalog?.chain(holderMint) : holder.chain;
    if (!selectedChain) throw new HttpError(400, "this token is not a confirmed Gamine launch");
    {
      let holding;
      try {
        holding = await readHolding(db, selectedChain, ownerId);
      } catch (error) {
        console.error(`holdings: could not read ${ownerId}: ${String(error).slice(0, 160)}`);
        throw new HttpError(503, "couldn't verify this token's wallet balance right now; try again in a moment");
      }
      if (!keeps(holding)) {
        const view = holdingView(holding);
        throw new HttpError(
          403,
          `an agent needs at least $20 of this qualifying token; the verified holding is below its minimum`,
          { holding: view },
        );
      }
    }

    let table: Policy | undefined;
    let freeCall = false;
    let reused = false;
    if (!presetName && (table = takeRated(ownerId, brief))) {
      reused = true;
    } else if (!presetName) {
      freeCall = await ctx.spend("rent");
      const result = await elicit({ brief });
      if (!result.table) {
        // The model could not be reached or answered unusably: no agent, no charge.
        throw new HttpError(503, "could not elicit a table for that brief", { reason: result.reason });
      }
      table = validatePolicy(result.table);
    }

    // One agent in play per wallet/token pair. The check and the creation share a
    // transaction and a lock on this wallet, so asking from two devices at once
    // still leaves one agent for this token, not two.
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`);
      const active = await activeAgentsOf(tx as unknown as Db, ownerId, holderMint);
      if (active.length > 0) {
        const held = active.map((a) => a.name).join(", ");
        throw new HttpError(409, `you already have an agent in play: ${held}. A wallet holds one agent per qualifying token.`, {
          agents: active.map((a) => ({ id: a.id, name: a.name })),
        });
      }
      const t = tx as unknown as Db;
      const wanted = {
        autoplay: true,
        holderMint,
        name,
        ownerId,
        ...(presetName ? { presetName } : {}),
        ...(brief ? { brief } : {}),
        ...(table ? { policyTable: table } : {}),
      };
      return createAgent(t, wanted);
    });
    await refreshTrueRatings(db);
    // Its character: a face, a name unless the owner gave one, an epithet and a
    // bio. A failure here leaves a working agent without one, which the
    // portrait endpoint and the backfill both cover.
    const character = await createCharacter(db, row.id, { deps: characterDeps, ...(nameVerdict ? { nameVerdict } : {}) }).catch((error: unknown) => {
      console.error(`character: could not create one for ${row.id}: ${String(error).slice(0, 160)}`);
      return null;
    });
    const view = await publicAgent(db, row.id);
    const [fresh] = await db.select().from(agents).where(eq(agents.id, row.id)).limit(1);
    return {
      agent: {
        ...inChips(view!),
        character: character ? ownerCharacter(character) : null,
        id: fresh!.id,
        brief: fresh!.brief,
        ownerId: fresh!.ownerId,
        createdAt: fresh!.createdAt,
        trueRating: fresh!.trueRating,
        trueRatingBasis: "against the roster as it stands today",
        ...playStatus(view!),
      },
      elicitation: presetName ? null : { free: freeCall, reusedRatedTable: reused },
    };
  }

  /**
   * An agent view with its money in chips.
   *
   * The ledger holds base units, because it has to reconcile with a vault
   * (src/chips.ts). Everything a player reads is chips: the stakes, the floor
   * they set, the figure on the card. That conversion has to happen
   * somewhere, and the api boundary is the only place it can happen once - a
   * deposit-funded balance of 900 chips is 900,000,000 base units, so a view
   * that forgets is not slightly wrong, it is wrong by a factor of a million.
   */
  function inChips<T extends { balance: number; funding: Funding }>(row: T): T & { balanceBaseUnits: number } {
    return { ...row, balance: toChips(row.balance, rateOf(row)), balanceBaseUnits: row.balance };
  }

  /**
   * A holder's wallet against the minimum, its conviction clock, and the power
   * and weight those earn now. Power weights the reward and never a match: this
   * is what a day's score would be multiplied by if the day ended now.
   */
  function holderView(holding: Holding | null) {
    const view = holdingView(holding);
    const shareOfSupply = holding && holding.supply > 0 ? holding.amount / holding.supply : 0;
    const p = power({ convictionDays: view.conviction.days, shareOfSupply });
    return {
      holding: view,
      power: {
        convictionDays: view.conviction.days,
        convictionCapDays: CONVICTION_CAP_DAYS,
        conviction: conviction(view.conviction.days),
        shareOfSupply,
        position: position(shareOfSupply),
        power: p,
        weight: weight(p),
      },
    };
  }

  /** Whether an agent holds enough to play, and what that is, for the agent panel. */
  function playStatus(row: { house?: boolean; inPlay: boolean }) {
    return {
      /** The least it must hold to play, in chips. */
      minToPlay: toChips(holdingMinimum(), seasonRate()),
      // A house agent holds nothing and is never asked to. A player's is
      // inPlaySql: it knows the conviction amount, which the balance alone does not.
      canPlay: row.house === true || row.inPlay,
    };
  }

  /**
   * An agent's face, as SVG. `?size=small` is the simplified drawing for 24-32
   * px. Public: it is on the ladder and in the feed. Cached for a day - a face
   * is stored once and does not change, but one drawn for an agent that has no
   * character yet will be replaced by the stored one after the backfill.
   */
  /** Recent Negotiation matches (docs/negotiation.md), newest first: `agent` narrows to one agent's, `before` pages by seq. */
  async function getNegotiations(ctx: Ctx) {
    const limit = Number(ctx.query.get("limit") ?? 20);
    const agent = ctx.query.get("agent");
    const before = ctx.query.get("before");
    if (before !== null) {
      const seq = Number(before);
      if (!Number.isSafeInteger(seq) || seq <= 0) throw new HttpError(400, "before must be a positive whole number");
      return { matches: await negotiationsBefore(db, seq, limit) };
    }
    return { matches: await negotiationFeed(db, { limit: Number.isFinite(limit) ? limit : 20, ...(agent ? { agentId: requireUuid(agent) } : {}) }) };
  }

  async function getNegotiation(ctx: Ctx) {
    const match = await negotiationById(db, requireUuid(ctx.params[0]));
    if (!match) throw new HttpError(404, "no such negotiation");
    return { match };
  }

  async function getPortrait(ctx: Ctx) {
    const id = requireUuid(ctx.params[0]);
    const [agent] = await db.select({ id: agents.id, policyTable: agents.policyTable }).from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) throw new HttpError(404, "no such agent");
    const svg = await portraitSvg(db, agent, ctx.query.get("size") === "small");
    if (!svg) throw new HttpError(404, "this agent has no portrait");
    return new Raw(svg, "image/svg+xml; charset=utf-8", {
      "cache-control": "public, max-age=86400",
      // An SVG opened directly is a document: it may run nothing and load nothing.
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    });
  }

  async function getAgent(ctx: Ctx) {
    const id = requireUuid(ctx.params[0]);
    const row = await publicAgent(db, id);
    if (!row) throw new HttpError(404, "no such agent");
    const found = await characterOf(db, id);
    const character = found ? publicCharacter(found) : null;
    // A chosen name still waiting for its check is its owner's to see, and no one else's.
    const ownCharacter = found ? ownerCharacter(found) : null;
    // Measured from its play; "not enough hands yet" until there are.
    const traits = await traitsOf(db, id);
    const [owned] = await db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, id)).limit(1);
    const ownership = {
      ownerWallet: owned?.ownerId && isPublicKey(owned.ownerId) ? owned.ownerId : null,
      qualifyingTokenMint: !row.house && row.funding === "holder" ? row.holderMint || options.holder?.primaryMint || null : null,
      solanaCluster: options.holder?.solanaCluster ?? null,
    };
    if (ctx.ownerId && owned?.ownerId === ctx.ownerId) {
      const own = await ownerAgent(db, id, ctx.ownerId);
      const [full] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      return {
        agent: {
          ...inChips(row),
          ...ownership,
          brief: own!.brief,
          policyTable: own!.policyTable,
          trueRating: own!.trueRating,
          trueRatingBasis: "against the roster as it stands today",
          ...playStatus(row),
          character: ownCharacter,
          traits,
        },
        // Private to the owner: whether it is playing, and what it did while they were away.
        autoplay: await autoplayStatus(db, full!, { intervalMs: autoplayIntervalMs }),
        // A holder agent's wallet and the power it earns (docs/holder-agents.md);
        // null for an agent on another flow.
        holder: full!.funding === "holder" && full!.ownerId ? holderView(await holdingOf(db, full!.ownerId, full!.holderMint)) : null,
        sinceYouLeft: await sinceYouLeft(db, full!),
        view: "owner",
      };
    }
    return { agent: { ...inChips(row), ...ownership, ...playStatus(row), character, traits }, view: "public" };
  }

  async function postPlay(ctx: Ctx) {
    const id = requireUuid(ctx.params[0]);
    const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!row) throw new HttpError(404, "no such agent");
    if (row.ownerId !== null && row.ownerId !== ctx.ownerId) throw new HttpError(403, "that agent belongs to someone else");
    if (row.retiredAt !== null) throw new HttpError(409, "that agent is retired");
    ctx.spendPlay();

    let pick;
    let played;
    try {
      // Pressing play may practise against a house agent: that match is an
      // exhibition, stakes nothing and counts for nothing, and trying an agent
      // out is what this button is for. Autoplay asks for players only.
      pick = await pickOpponent(db, id, { allowHouse: true });
      played = await runMatch(db, id, pick.opponentId);
    } catch (error) {
      // Cannot cover a stake, or the opponent pool is empty: not a server fault.
      if (error instanceof StakeError) throw new HttpError(409, error.message);
      if (error instanceof Error && /no preset agent available/.test(error.message)) {
        throw new HttpError(409, "no opponent could cover a stake right now");
      }
      throw error;
    }
    const { match, log, stake, settled, retired } = played;
    const [opponent] = await db
      .select({ name: agents.name, presetName: agents.presetName, mark: agents.mark })
      .from(agents)
      .where(eq(agents.id, pick.opponentId))
      .limit(1);
    const after = await publicAgent(db, id);
    return {
      matchId: match.id,
      opponent: { id: pick.opponentId, name: opponent?.name, presetName: opponent?.presetName ?? null, mark: opponent?.mark ?? null },
      matchmaking: { path: pick.path, candidates: pick.candidates, ratingGap: pick.ratingGap },
      stake,
      result: {
        winner: log.winner,
        net: settled.A,
        opponentNet: settled.B,
        rounds: log.rounds.length,
        /** What the play was worth before the stake capped it. */
        uncappedNet: log.nets.A,
      },
      balance: after ? toChips(after.balance, rateOf(after)) : 0,
      retired: retired.includes(id),
      /**
       * Whether this counts toward the ladder. False means the opponent was a
       * house agent: the money moved all the same, but it earns no ranking.
       */
      ranked: match.ranked,
    };
  }

  /**
   * Turn autoplay on or off, and set the balance floor.
   *
   * Turning it on clears whatever stopped it last: the owner has seen the
   * reason and decided to carry on. Autoplay is checked again on the next tick
   * anyway, so an agent that still cannot play stops again immediately, with a
   * current reason rather than a stale one.
   */
  async function postEndAgent(ctx: Ctx) {
    const owner = ctx.requireOwner();
    const id = requireUuid(ctx.params[0]);
    ctx.spendPlay();
    if (!await endHolder(db, owner, id)) throw new HttpError(404, "no such agent");
    return { ended: true };
  }

  async function postAutoplay(ctx: Ctx) {
    const ownerId = ctx.requireOwner();
    const id = requireUuid(ctx.params[0]);
    const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!row) throw new HttpError(404, "no such agent");
    if (row.ownerId !== ownerId) throw new HttpError(403, "that agent belongs to someone else");
    if (row.retiredAt !== null) throw new HttpError(409, "that agent is retired");

    const enabled = ctx.body["enabled"];
    if (typeof enabled !== "boolean") throw new HttpError(400, "enabled must be true or false");

    await setAutoplay(db, row, enabled);

    const [updated] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    // The same block the panel reads, so turning it on shows at once whether
    // it can actually play - not a success that the next tick contradicts.
    return { autoplay: await autoplayStatus(db, updated!, { intervalMs: autoplayIntervalMs }) };
  }

  /**
   * Holder scores (docs/holder-agents.md, Scoring). `?day=YYYY-MM-DD` for one
   * UTC day, `?season=` a Monday for a season; with neither, today and this
   * season. Each table says whether it is frozen or still moving.
   */
  async function getScores(ctx: Ctx) {
    const now = new Date();
    const day = ctx.query.get("day");
    const key = ctx.query.get("season");
    if (day) {
      let d: number;
      try {
        d = dayFromDate(day);
      } catch {
        throw new HttpError(400, "day must be a date, as YYYY-MM-DD");
      }
      if (d > dayOf(now)) throw new HttpError(400, "that day hasn't started yet");
      return { day: await dayScores(db, d) };
    }
    if (key) {
      try {
        seasonByKey(key);
      } catch {
        throw new HttpError(400, "season must be a Monday, as YYYY-MM-DD");
      }
      return { season: await seasonScores(db, key, now) };
    }
    return { day: await dayScores(db, dayOf(now)), season: await seasonScores(db, seasonAt(now).key, now) };
  }

  /**
   * Operational health, for the wallets in `adminWallets`.
   *
   * A reader, not a measurer: src/db/admin.ts reads the wallet readings and the
   * score freeze from where they already live. The only thing this decides is
   * who may see it.
   *
   * Signed out, or signed in as anyone else, it is a 404 rather than a 403:
   * there is no reason to confirm to a stranger that the page exists.
   */
  async function getAdmin(ctx: Ctx) {
    const wallet = ctx.requireOwner();
    if (!adminWallets.has(wallet)) throw new HttpError(404, "not found");
    if (!options.health) {
      throw new HttpError(503, "this server has no chain configured, so there is no health to report");
    }
    return options.health();
  }

  /**
   * Who a frozen period pays, checked at payout. Scores are frozen with the day,
   * but only an agent still in play is paid: a wallet that sold to zero ended
   * that agent, and a rebuy starts a new one that earns from then on, so its
   * old scores are forfeit (decided 2026-10-12, after wallets cycling buy and
   * sell collected agents). Its wallet must also hold the token worth $20 now
   * (docs/holder-agents.md, decision 3), read fresh on chain at the verified
   * price. `minScore` drops lower scores, and `exclude` the reward wallets
   * themselves, which hold $GAMINE and so have agents but must not pay themselves.
   * `cap` is the most one wallet's agent may take (default 10%); what it holds
   * back is handed on to the others by score, so the payout pays out in full
   * whenever there are enough winners. Shares are
   * then worked out again over the winners left, the same way as when frozen -
   * proportional to score, none above 10% - so a dropped winner's share goes to
   * those still holding, and what the cap holds back stays in the wallet.
   * Who was dropped, and why, is returned beside the winners.
   */
  async function getPayoutRecipients(ctx: Ctx) {
    if (!adminWallets.has(ctx.requireOwner())) throw new HttpError(404, "not found");
    const minScore = Number(ctx.query.get("minScore") ?? 0);
    if (!Number.isFinite(minScore) || minScore < 0) throw new HttpError(400, "minScore must be a number, 0 or more");
    const cap = Number(ctx.query.get("cap") ?? 0.1);
    if (!Number.isFinite(cap) || cap < 0.01 || cap > 1) throw new HttpError(400, "cap must be a fraction from 0.01 to 1");
    // A catch-up pays a run of frozen days at once (`from`..`to`): each agent's
    // score is the sum of its scores on the days it qualified, and the checks
    // below apply to that total.
    let scored: { agentId: string; name: string; score: number }[];
    if (ctx.query.get("from") || ctx.query.get("to")) {
      let from: number, to: number;
      try { from = dayFromDate(ctx.query.get("from") ?? ""); to = dayFromDate(ctx.query.get("to") ?? ""); }
      catch { throw new HttpError(400, "from and to must be dates, as YYYY-MM-DD"); }
      if (to < from || to - from > 30) throw new HttpError(400, "a catch-up covers 1 to 31 days, from before to");
      const totals = new Map<string, { agentId: string; name: string; score: number }>();
      for (let d = from; d <= to; d++) {
        const table = await dayScores(db, d);
        if (!table.frozen) throw new HttpError(409, "payouts require frozen scores");
        for (const row of table.rows) {
          if (!row.qualified || !(row.share > 0)) continue;
          const total = totals.get(row.agentId) ?? { agentId: row.agentId, name: row.name, score: 0 };
          total.score += row.score;
          totals.set(row.agentId, total);
        }
      }
      scored = [...totals.values()];
    } else {
      const tables = await getScores(ctx);
      const table = "day" in tables ? tables.day : tables.season;
      if (!table || !table.frozen) throw new HttpError(409, "payouts require frozen scores");
      scored = table.rows.filter((row) => row.qualified && row.share > 0);
    }
    const excluded = new Set((ctx.query.get("exclude") ?? "").split(",").filter(Boolean));
    const owners = scored.length ? await db.select({ id: agents.id, wallet: agents.ownerId, mint: agents.holderMint, retiredAt: agents.retiredAt }).from(agents)
      .where(inArray(agents.id, scored.map((row) => row.agentId))) : [];
    const recipients = new Map(owners.map((row) => [row.id, row]));
    const rows = scored.map((row) => {
      const owner = recipients.get(row.agentId);
      if (!owner?.wallet || !isPublicKey(owner.wallet)) throw new HttpError(409, "a winner has no valid receiving wallet");
      return { agentId: row.agentId, name: row.name, score: row.score, wallet: owner.wallet, mint: owner.mint || options.holder?.primaryMint || "", scope: owner.mint ?? "", ended: owner.retiredAt !== null };
    });
    const dropped: { agentId: string; name: string; wallet: string; mint: string; score: number; reason: "reward wallet" | "agent ended" | "below minimum score" | "holds under $20" }[] = [];
    const eligible: typeof rows = [];
    // One fresh read per wallet and token, however many of its agents won.
    const holds = new Map<string, Promise<boolean>>();
    const holdsNow = (wallet: string, scope: string) => {
      const key = `${wallet}:${scope}`;
      if (!holds.has(key)) holds.set(key, (async () => {
        const holder = options.holder;
        if (!holder) return true; // A server that reads no wallets (tests, local play) cannot check, and pays as frozen.
        const chain = scope && scope !== holder.primaryMint ? await holder.catalog?.chain(scope) : holder.chain;
        if (!chain) throw new HttpError(503, "a winner's token can't be read; try again shortly");
        try { return keeps(await readHolding(db, chain, wallet)); }
        catch { throw new HttpError(503, "a winner's holding couldn't be read; try again shortly"); }
      })());
      return holds.get(key)!;
    };
    // Read the remaining wallets four at a time rather than one by one: a catch-up can name dozens.
    const toRead = rows.filter((row) => !excluded.has(row.wallet) && !row.ended && row.score >= minScore);
    for (let i = 0; i < toRead.length; i += 4) await Promise.all(toRead.slice(i, i + 4).map((row) => holdsNow(row.wallet, row.scope)));
    for (const row of rows) {
      if (excluded.has(row.wallet)) dropped.push({ ...row, reason: "reward wallet" });
      else if (row.ended) dropped.push({ ...row, reason: "agent ended" });
      else if (row.score < minScore) dropped.push({ ...row, reason: "below minimum score" });
      else if (!await holdsNow(row.wallet, row.scope)) dropped.push({ ...row, reason: "holds under $20" });
      else eligible.push(row);
    }
    const fractions = filledShares(eligible, cap);
    // The cap is per agent, and an agent is one wallet holding one token: a
    // wallet with agents for several tokens takes a capped share for each.
    // Only a replacement for the same token merges, so ending an agent and
    // creating another never opens a second slot or bypasses the 10% cap.
    const grouped = new Map<string, { agentId: string; name: string; share: number; wallet: string; mint: string; agentIds?: string[] }>();
    eligible.forEach((row, i) => {
      const winner = { agentId: row.agentId, name: row.name, share: fractions[i]!, wallet: row.wallet, mint: row.mint };
      const key = `${winner.wallet}:${winner.mint}`;
      const previous = grouped.get(key);
      if (previous) {
        previous.share = Math.min(cap, previous.share + winner.share);
        previous.agentIds = [...(previous.agentIds ?? [previous.agentId]), winner.agentId];
      } else grouped.set(key, winner);
    });
    return { frozen: true, minScore, cap, winners: [...grouped.values()].filter((w) => w.share > 0),
      dropped: dropped.map(({ agentId, name, wallet, mint, score, reason }) => ({ agentId, name, wallet, mint, score, reason })) };
  }

  /**
   * A season's statement: what the season did, and the scores it would pay
   * on. Nothing is paid yet; the scores say who would be, and what share.
   */
  async function getStatement(ctx: Ctx) {
    const now = new Date();
    let season;
    try {
      season = ctx.query.get("season") ? seasonByKey(ctx.query.get("season")!) : seasonAt(now);
    } catch {
      throw new HttpError(400, "season must be a Monday, as YYYY-MM-DD");
    }
    return { statement: await seasonStatement(db, season.key) };
  }

  /**
   * Everyone on the field, for the live board. Polled by every open board, so
   * one read is shared for a moment rather than made per watcher. Who is in a
   * match is not here: the live stream says that, the moment it happens.
   */
  const fieldCacheMs = options.fieldCacheMs ?? 2000;
  let fieldCache: { at: number; value: Promise<{ agents: Awaited<ReturnType<typeof field>>; at: string }> } | null = null;
  async function getField() {
    const now = (options.now ?? Date.now)();
    if (!fieldCache || now - fieldCache.at >= fieldCacheMs) {
      const value = Promise.all([field(db, new Date(now)), readWorldActivities(db, now)]).then(([agents, world]) => ({
        agents: agents.map((agent) => ({ ...agent, worldActivity: agent.retiredAt ? null : world.activities.get(agent.id) ?? null })),
        at: new Date(now).toISOString(),
      }));
      fieldCache = { at: now, value };
      // A failed read is not served to the next caller.
      value.catch(() => {
        if (fieldCache?.value === value) fieldCache = null;
      });
    }
    return fieldCache.value;
  }

  async function getSeason() {
    const season = seasonAt(new Date());
    return { season: { key: season.key, number: season.number, startsAt: season.start, endsAt: season.end } };
  }

  async function postSeen(ctx: Ctx) {
    const ownerId = ctx.requireOwner();
    const id = requireUuid(ctx.params[0]);
    const [row] = await db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, id)).limit(1);
    if (!row) throw new HttpError(404, "no such agent");
    if (row.ownerId !== ownerId) throw new HttpError(403, "that agent belongs to someone else");
    await markSeen(db, id);
    return { ok: true };
  }

  async function getMatch(ctx: Ctx) {
    const id = requireUuid(ctx.params[0]);
    const [row] = await db.select().from(matches).where(eq(matches.id, id)).limit(1);
    if (!row) throw new HttpError(404, "no such match");
    const sides = await Promise.all(
      [row.agentA, row.agentB].map(async (agentId) => {
        const [a] = await db
          .select({ name: agents.name, presetName: agents.presetName, mark: agents.mark })
          .from(agents)
          .where(eq(agents.id, agentId))
          .limit(1);
        return { name: a?.name ?? "unknown", presetName: a?.presetName ?? null, mark: a?.mark ?? null };
      }),
    );
    const names = sides.map((x) => x.name);
    const displayNames = { A: names[0]!, B: names[1]! };
    return {
      match: {
        id: row.id,
        agentA: { id: row.agentA, name: names[0], presetName: sides[0]!.presetName, mark: sides[0]!.mark },
        agentB: { id: row.agentB, name: names[1], presetName: sides[1]!.presetName, mark: sides[1]!.mark },
        seed: row.seed,
        rules: row.rulesConfig,
        winner: row.winner,
        netA: row.netA,
        netB: row.netB,
        stake: row.stake,
        createdAt: row.createdAt,
        /** House agents playing each other: nothing was staked or settled. */
        exhibition: row.exhibition,
        /** Player against player: counts toward the ladder. Staked but unranked means a house opponent. */
        ranked: row.ranked,
      },
      /** Everything a shared card needs, without parsing the transcript. */
      summary: {
        names: displayNames,
        /** Which preset each side plays; null for a custom brief. */
        presets: { A: sides[0]!.presetName, B: sides[1]!.presetName },
        /** Each side's emoji, its identity. */
        marks: { A: sides[0]!.mark, B: sides[1]!.mark },
        netA: row.netA,
        netB: row.netB,
        winner: row.winner,
        winnerName: row.winner === null ? null : displayNames[row.winner],
        rounds: row.log.rounds.length,
        stake: row.stake,
        headline: headlineFor(row.log, displayNames),
      },
      transcript: renderTranscript(row.log, displayNames),
      log: row.log,
    };
  }

  // The bluff reads up to 100 match logs; every visitor polls the feed, so keep it briefly.
  let bluffCache: { at: number; value: Awaited<ReturnType<typeof latestBluff>> } | null = null;
  const BLUFF_TTL_MS = 15_000;

  /** Public: recent matches across the platform, newest first, and the latest bluff that worked. */
  async function getFeed(ctx: Ctx) {
    const limit = Number(ctx.query.get("limit") ?? 20) || 20;
    const beforeParam = ctx.query.get("before");
    const before = beforeParam === null ? undefined : Number(beforeParam);
    if (before !== undefined && !Number.isSafeInteger(before)) throw new HttpError(400, "before must be a match seq");
    // Staked-only by default, which is the conservative answer for anything
    // that has not thought about it. It made more sense when an exhibition was
    // only ever house filler; now that a house match is an exhibition, most of
    // what is played is one, and the site asks for everything and marks each
    // row. `?staked=false` asks for everything.
    const stakedOnly = (ctx.query.get("staked") ?? "true") !== "false";
    const t = (options.now ?? Date.now)();
    if (!bluffCache || t - bluffCache.at > BLUFF_TTL_MS) bluffCache = { at: t, value: await latestBluff(db) };
    return {
      matches: await recentMatches(db, { limit, stakedOnly, ...(before !== undefined ? { before } : {}) }),
      bluff: bluffCache.value,
    };
  }

  /** Public: one agent's recent matches, newest first. */
  async function getAgentMatches(ctx: Ctx) {
    const id = requireUuid(ctx.params[0]);
    if (!(await publicAgent(db, id))) throw new HttpError(404, "no such agent");
    const limit = Number(ctx.query.get("limit") ?? 20) || 20;
    return { record: await agentRecord(db, id), matches: await recentMatches(db, { limit, agentId: id }) };
  }

  /** Public: platform-wide match activity. */
  async function getStats() {
    const inPlay = and(isNull(agents.retiredAt), eq(agents.autoplay, true), inPlaySql());
    const [active] = await db.select({ n: sql<number>`count(*)::int` }).from(agents).where(inPlay);
    // Agents in play per qualifying launch token, for the launchpad's listings ("" is the primary token).
    const byMint = await db.select({ mint: agents.holderMint, n: sql<number>`count(*)::int` }).from(agents)
      .where(and(inPlay, isNotNull(agents.holderMint))).groupBy(agents.holderMint);
    const agentsByMint = Object.fromEntries(byMint.filter((r) => r.mint).map((r) => [r.mint!, Number(r.n)]));
    return { activity: await matchActivity(db), activeAgents: Number(active?.n ?? 0), agentsByMint };
  }

  /** This wallet's last holding reading against the minimum. 404 off the holder flow. */
  async function getHolding(ctx: Ctx) {
    const ownerId = ctx.requireOwner();
    if (!options.holder?.allow(ownerId)) throw new HttpError(404, "this server doesn't run holder agents for this wallet");
    return { holding: holdingView(await holdingOf(db, ownerId)) };
  }

  /**
   * Reads this wallet's holding now: after a buy, so the owner need not wait
   * for the next scheduled read to see it count. Charged like playing a match:
   * it costs no money, but it is an RPC call per request.
   */
  async function postHolding(ctx: Ctx) {
    const ownerId = ctx.requireOwner();
    const holder = options.holder;
    if (!holder?.allow(ownerId)) throw new HttpError(404, "this server doesn't run holder agents for this wallet");
    ctx.spendPlay();
    try {
      const holding = await readHolding(db, holder.chain, ownerId);
      await activateHolder(db, ownerId);
      await holder.catalog?.refreshWallet(ownerId);
      return { holding: holdingView(holding) };
    } catch (error) {
      await holder.catalog?.refreshWallet(ownerId);
      console.error(`holdings: could not read ${ownerId}: ${String(error).slice(0, 160)}`);
      throw new HttpError(503, "couldn't verify this token's wallet balance right now; try again in a moment");
    }
  }

  /** Devnet only: whether this wallet can be given test tokens, and when it can next ask. */
  async function getFaucet(ctx: Ctx) {
    const wallet = ctx.requireOwner();
    if (!options.faucet) throw new HttpError(503, "there is no faucet on this network");
    return { faucet: await faucetStatus(db, wallet, seasonRate()) };
  }

  /** Devnet only: hands this wallet one grant of stake tokens. */
  async function postFaucet(ctx: Ctx) {
    const wallet = ctx.requireOwner();
    const faucet = options.faucet;
    if (!faucet) throw new HttpError(503, "there is no faucet on this network");
    spendBoth(faucetLimiter, faucetByAddress, wallet, ctx.clientKey, "faucet requests");
    try {
      return { grant: await grantFaucet(db, faucet, wallet, seasonRate()) };
    } catch (error) {
      if (error instanceof FaucetError) throw new HttpError(error.status, error.message);
      throw error;
    }
  }

  async function getLadder(ctx: Ctx) {
    const sort = (ctx.query.get("sort") ?? "winnings") as LadderTab;
    if (sort !== "winnings" && sort !== "per-match") {
      throw new HttpError(400, "sort must be winnings or per-match");
    }
    const limit = Math.min(Number(ctx.query.get("limit") ?? 50) || 50, 200);
    // All time unless asked: the web release before seasons calls without a period.
    const period = ctx.query.get("period") ?? "all";
    const now = new Date();
    if (period === "all") return { sort, period, rows: await leaderboard(db, limit, sort) };
    if (period === "day") {
      const since = dayStart(now);
      return { sort, period, since, rows: await leaderboard(db, limit, sort, { period: "day", since }) };
    }
    if (period === "season") {
      let season;
      try {
        season = ctx.query.get("season") ? seasonByKey(ctx.query.get("season")!) : seasonAt(now);
      } catch {
        throw new HttpError(400, "season must be a Monday, as YYYY-MM-DD");
      }
      return {
        sort,
        period,
        season: { key: season.key, number: season.number, startsAt: season.start, endsAt: season.end, current: season.key === seasonAt(now).key },
        rows: await leaderboard(db, limit, sort, { period: "season", season: season.key }),
      };
    }
    throw new HttpError(400, "period must be all, season or day");
  }

  /** Public and free: the shipped tables, so the UI can rate them without a model call. */
  async function getPresets() {
    return {
      presets: PRESET_NAMES.map((name) => ({
        name,
        description: PRESET_DESCRIPTIONS[name],
        policyTable: snapshotPreset(name),
      })),
      free: true,
    };
  }

  /** Who is out there to play. Public: the ladder shows this anyway. */
  async function getRoster() {
    return { agents: await roster(db) };
  }

  async function postPreview(ctx: Ctx) {
    const brief = typeof ctx.body["brief"] === "string" ? ctx.body["brief"].trim() : "";
    const supplied = ctx.body["policyTable"];
    if (!brief && !supplied) throw new HttpError(400, "brief or policyTable is required");

    let table: Policy;
    let freeCall = false;
    if (supplied) {
      table = validatePolicy(supplied);
    } else {
      // Only the brief path reaches a model, so only it needs a wallet.
      const ownerId = ctx.requireOwner();
      freeCall = await ctx.spend("preview");
      const result = await elicit({ brief });
      if (!result.table) throw new HttpError(503, "could not elicit a table for that brief", { reason: result.reason });
      table = validatePolicy(result.table);
      remember(ownerId, brief, table);
    }
    const preview = previewPolicy(table, await scoringProfile(db));
    return { preview, policyTable: table, elicitation: supplied ? null : { free: freeCall } };
  }

  function requireUuid(value: string | undefined): string {
    if (!value || !UUID.test(value)) throw new HttpError(400, "malformed id");
    return value;
  }

  const corsOrigin = options.corsOrigin ?? process.env["CORS_ORIGIN"] ?? "http://localhost:3000";
  /**
   * Wallets allowed to read /admin. Empty by default and empty unless someone
   * says otherwise, so a deployment that forgets to set it has no admin page
   * rather than an open one.
   */
  const adminWallets = new Set(
    (options.adminWallets ?? (process.env["ADMIN_WALLETS"] ?? "").split(","))
      .map((w) => w.trim())
      .filter((w) => w.length > 0),
  );
  const corsHeaders = {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-expose-headers": "retry-after",
    "access-control-max-age": "600",
    vary: "origin",
  };

  const live = new LiveStream(db, {
    onError: (error) => console.error(`live: ${String(error).slice(0, 160)}`),
    ...options.live,
  });

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    // The live stream holds its response open, so it is answered here rather
    // than as a route that returns one payload. Public: it carries only what the feed does.
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/live") {
      void live.open(req, res, clientAddress(req), resumeFrom(req, url.searchParams), corsHeaders);
      return;
    }
    void handle(req, res).catch((error: unknown) => {
      send(res, 500, { error: error instanceof Error ? error.message : "unknown error" }, corsHeaders);
    });
  });
  // Open streams never finish on their own, so closing the server ends them first.
  const closeServer = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    live.close();
    return closeServer(callback);
  }) as typeof server.close;
  return server;

  function reply(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
    send(res, status, payload, { ...corsHeaders, ...headers });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
    if (!route) return reply(res, 404, { error: "no such route" });

    // A session token, if any. A stale or unknown token is treated as signed
    // out rather than rejected, so public reads keep working; anything that
    // needs an owner refuses with 401.
    const auth = req.headers["authorization"];
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const ownerId = await ownerForToken(db, token);

    let body: Record<string, unknown> = {};
    try {
      body = await readJson(req);
    } catch (error) {
      return reply(res, 400, { error: error instanceof Error ? error.message : "bad body" });
    }

    // Charged against the wallet, or the connection when there is none.
    const clientKey = clientAddress(req);
    const limitKey = ownerId ?? clientKey;
    let spent = false;
    const ctx: Ctx = {
      params: url.pathname.match(route[1])!.slice(1),
      query: url.searchParams,
      body,
      ownerId,
      token,
      clientKey,
      requireOwner: () => {
        if (!ownerId) throw new HttpError(401, "sign in with your wallet first");
        return ownerId;
      },
      spend: async (kind) => {
        // The owner's first model call is on the house.
        const free = ownerId ? await isFirstElicitationFree(db, ownerId) : false;
        if (!free) {
          const result = limiter.take(limitKey);
          spent = true;
          if (!result.ok) {
            throw new HttpError(429, "rate limit reached for model-backed requests", {
              retryAfterSeconds: result.retryAfterSeconds,
            });
          }
        }
        if (ownerId) await recordElicitation(db, { ownerId, kind, free });
        return free;
      },
      spendPlay: () => {
        const result = playLimiter.take(limitKey);
        if (!result.ok) {
          throw new HttpError(429, "rate limit reached for playing matches", {
            retryAfterSeconds: result.retryAfterSeconds,
          });
        }
      },
      refund: () => limiter.refund(limitKey),
    };

    try {
      const payload = await route[2](ctx);
      if (payload instanceof Raw) {
        res.writeHead(200, { ...corsHeaders, "content-type": payload.contentType, ...payload.headers });
        res.end(payload.body);
        return;
      }
      reply(res, req.method === "POST" ? 201 : 200, payload as Record<string, unknown>);
    } catch (error) {
      if (error instanceof HttpError) {
        // A request that failed before the model answered should not cost an allowance slot.
        if (spent && error.status >= 500) ctx.refund();
        const headers = error.status === 429 ? { "retry-after": String(error.extra["retryAfterSeconds"] ?? 60) } : {};
        return reply(res, error.status, { error: error.message, ...error.extra }, headers);
      }
      throw error;
    }
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method !== "POST") return {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("body must be a JSON object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("body must be valid JSON");
  }
}

function send(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(payload));
}

/**
 * The caller's address, for per-IP rate limits. Behind a hosting proxy every
 * request arrives from the proxy, so with TRUST_PROXY set the address is the
 * last X-Forwarded-For entry: the one the proxy appended, which the client
 * cannot forge. Without it the header is ignored, since anyone can send it.
 */
export function clientAddress(req: IncomingMessage): string {
  if (process.env["TRUST_PROXY"]) {
    const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }
  return req.socket.remoteAddress ?? "anonymous";
}

/** Starts the app on a port and reports where it landed. */
export async function listen(
  options: AppOptions & { port?: number; host?: string | undefined },
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createApp(options);
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
