/**
 * The launchpad: a frontend over pump.fun's launch flow (docs/holder-agents.md,
 * Launchpad). A token launched here lives on pump.fun like any other; what
 * Gamine adds is agents for its holders, in the shared village, and its
 * creator fees sent to the three Gamine wallets.
 *
 * Everything the pages need goes through the Launchpad interface below.
 * NEXT_PUBLIC_LAUNCHPAD_MODE=pump selects the wallet-signed mainnet adapter;
 * otherwise launchpad-mock.ts supplies an explicit preview. The stages live
 * in launchpad-stages.ts. Behind
 * NEXT_PUBLIC_LAUNCHPAD=1: with the flag off, the pages, the nav entry and the
 * village's Launch Pad are all gone.
 */

import { mockLaunchpad } from "./launchpad-mock";
import { pumpLaunchpad } from "./launchpad-client";
import { solToLamports } from "./launchpad-validation";

export const LAUNCHPAD = process.env.NEXT_PUBLIC_LAUNCHPAD === "1";

export { FAILURE, STAGES, type Stage, type StageState } from "./launchpad-stages";
import type { Stage, StageState } from "./launchpad-stages";

/** Shares of a token's creator fees, in percent. */
export type FeeSplit = { daily: number; weekly: number; platform: number };

/**
 * The settings the pages read and never hard-code: none of them is decided
 * for good, so whatever comes back is what is shown.
 */
export type LaunchpadConfig = {
  /** Whether launch-token holder agents are connected to the game yet. */
  agentsEnabled: boolean;
  /** Real launches are disabled until server configuration is complete. */
  ready?: boolean;
  unavailableReason?: string | null;
  /** Mandatory platform launch fee in integer lamports; enforced by the real launch transaction. */
  launchFeeLamports: number;
  /** The platform wallet receiving the launch fee. */
  launchFeeRecipient: string;
  /** A wallet holding at least this many dollars of a token has an agent for it. */
  minimumUsd: number;
  /** Where every token's creator fees go. */
  feeSplit: FeeSplit;
  /** The launcher's share of creator fees, in percent. 0 today; shown on the review screen if it ever is not. */
  launcherShare: number;
  /** The most of one payout a single token's agents may take, in percent; null for no cap. */
  perTokenCap: number | null;
  /** What a point is multiplied by, for $GAMINE agents and for launch-token agents. */
  agpMultiplier: number;
  launchMultiplier: number;
  /** The largest token image accepted, in bytes. */
  maxImageBytes: number;
};

export type LaunchLinks = { x?: string; telegram?: string; website?: string };

export type LaunchForm = {
  name: string;
  ticker: string;
  description: string;
  /** The image as a data URL, read in the browser. */
  image: string;
  links: LaunchLinks;
  /** The signed-in wallet launching it. */
  creator: string;
  /** Optional purchase budget, in SOL as exact decimal text. */
  initialBuySol: string;
};

/** How the mock is told to fail, so every state of the tracker can be seen. Ignored by a real backend. */
export type LaunchOptions = {
  failAt?: Stage | null;
  signTransaction?: (prepared: string) => Promise<string>;
};

export type LaunchStatus = {
  id: string;
  /** Known once the token exists on pump.fun. */
  mint: string | null;
  stages: Record<Stage, StageState>;
  /** The stage that failed, and what went wrong, in a sentence. */
  failure: { stage: Stage; message: string } | null;
  /** Token launch confirmed. Holder-agent activation may still be pending. */
  live: boolean;
};

/**
 * A token's standing in the game. `removed` is a token whose fee split was
 * found changed after launch: it is out of the game, and says why.
 */
export type Verification = "pending" | "verified" | "failed" | "removed";

export type TokenSummary = {
  mint: string;
  name: string;
  ticker: string;
  image: string;
  holders: number | null;
  agentsInPlay: number;
  verification: Verification;
  launchedAt: string;
  /** Market figures, as pump.fun reports them, in dollars. */
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  /** How far along pump.fun's bonding curve, 0 to 100; 100 once it has graduated. */
  bondingProgress: number | null;
};

export type TokenAgent = { agentId: string; name: string; rank: number; matches: number; net: number };

export type TokenDetail = TokenSummary & {
  description: string;
  links: LaunchLinks;
  feeSplit: FeeSplit;
  launcherShare: number;
  /** Where anyone can check the split and the authority for themselves. */
  verifyUrl: string;
  pumpUrl: string;
  /** Why the token is out of the game, when it is. */
  removedReason: string | null;
  /** The token's agents, as they stand on the ladder. Empty until its agents are live. */
  agents: TokenAgent[];
};

/**
 * The orders a list of launches comes in. Every order but "newest" ranks only
 * tokens still in the game: one not verified, or removed, is listed by date
 * and never ranked.
 */
export type LaunchSort = "newest" | "agents" | "volume" | "marketCap" | "holders" | "graduating";

/** A page of launches: in one order, matching a search, from an offset. There will be many, so they are never fetched whole. */
export type LaunchQuery = {
  sort: LaunchSort;
  /** Matches a name, a ticker (with or without its $) or the start of a mint. */
  search?: string;
  offset?: number;
  /** 20 when not given. */
  limit?: number;
};
export type LaunchPage = { tokens: TokenSummary[]; total: number };

export interface Launchpad {
  /** True for the mock: the pages say so, and offer its failure switch. */
  readonly mock: boolean;
  getConfig(): Promise<LaunchpadConfig>;
  /** Starts a launch; returns its id, to follow with getLaunchStatus. */
  createLaunch(form: LaunchForm, options?: LaunchOptions): Promise<{ id: string }>;
  getLaunchStatus(id: string): Promise<LaunchStatus>;
  listLaunches(query: LaunchQuery): Promise<LaunchPage>;
  getToken(mint: string): Promise<TokenDetail | null>;
}

/** The launchpad the pages use: explicit mainnet mode, otherwise preview. */
export const launchpad: Launchpad = process.env.NEXT_PUBLIC_LAUNCHPAD_MODE === "pump" ? pumpLaunchpad : mockLaunchpad;

/** A dollar figure, short: $950, $12.4K, $3.1M. */
export function usd(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

// --- What the pages say about each stage ------------------------------------

export function stageLabel(stage: Stage, split: FeeSplit): string {
  switch (stage) {
    case "created":
      return "Token created on pump.fun";
    case "feeSplit":
      return `Fee split set (${split.daily}/${split.weekly}/${split.platform})`;
    case "authorityLocked":
      return "Creator fee split locked";
    case "verified":
      return "Verified on chain";
    case "agentsLive":
      return "Agents live";
  }
}

// --- Checking the form ------------------------------------------------------

export const TICKER = /^[A-Z][A-Z0-9]{1,9}$/;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type FormErrors = Partial<Record<"name" | "ticker" | "description" | "image" | "x" | "telegram" | "website" | "initialBuySol", string>>;

const onHost = (value: string, hosts: string[]) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (hosts.length === 0 || hosts.includes(url.hostname.replace(/^www\./, "")));
  } catch {
    return false;
  }
};

/** What is wrong with a launch form, field by field; empty when it can go to review. */
export function checkForm(form: Omit<LaunchForm, "creator">): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Give the token a name.";
  else if (new TextEncoder().encode(name).length > 32) errors.name = "Use a shorter token name (up to 32 letters; some characters take more space).";
  if (!TICKER.test(form.ticker)) errors.ticker = "2 to 10 letters or digits, starting with a letter.";
  if (form.description.length > 500) errors.description = "500 characters at most.";
  if (!form.image) errors.image = "Add an image.";
  try { solToLamports(form.initialBuySol); } catch (error) { errors.initialBuySol = (error as Error).message; }
  if (form.links.x && !onHost(form.links.x, ["x.com", "twitter.com"])) errors.x = "An https link on x.com.";
  if (form.links.telegram && !onHost(form.links.telegram, ["t.me"])) errors.telegram = "An https link on t.me.";
  if (form.links.website && !onHost(form.links.website, [])) errors.website = "An https link.";
  return errors;
}

/** Why an image file can't be used, or null if it can. */
export function checkImage(file: { type: string; size: number }, maxBytes: number): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "PNG, JPEG, GIF or WebP.";
  if (file.size > maxBytes) return `${(maxBytes / 1_000_000).toFixed(0)} MB at most; this one is ${(file.size / 1_000_000).toFixed(1)} MB.`;
  return null;
}
