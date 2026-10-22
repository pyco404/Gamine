import { readStoredValue } from "./browser-storage";
import { FAILURE, STAGES, type Stage, type StageState } from "./launchpad-stages";
import { LAUNCH_FEE_LAMPORTS, LAUNCH_FEE_RECIPIENT } from "./launchpad-fees";
import type {
  LaunchForm,
  LaunchOptions,
  Launchpad,
  LaunchpadConfig,
  LaunchQuery,
  LaunchSort,
  LaunchStatus,
  TokenAgent,
  TokenDetail,
  TokenSummary,
  Verification,
} from "./launchpad";

/**
 * The launchpad with no backend: it lives in the browser, sends nothing and
 * signs nothing. A launch walks through every stage on a timer, and can be
 * told to fail at any one, so each state of the tracker can be seen. A few
 * made-up tokens stand in the list from the start, one in each standing.
 *
 * Launches made here are kept in sessionStorage, so a token's page survives a
 * reload in the same tab. Nothing leaves the browser.
 */

const CONFIG: LaunchpadConfig = {
  agentsEnabled: true,
  launchFeeLamports: LAUNCH_FEE_LAMPORTS,
  launchFeeRecipient: LAUNCH_FEE_RECIPIENT,
  minimumUsd: 20,
  feeSplit: { daily: 15, weekly: 50, platform: 35 },
  launcherShare: 0,
  perTokenCap: null,
  agpMultiplier: 1.3,
  launchMultiplier: 1.0,
  maxImageBytes: 2_000_000,
};

/** How long each stage takes, in order. */
const STAGE_MS = [1600, 2000, 1400, 2400, 1600];
/** Every call waits this long, as a network would. */
const LATENCY_MS = 150;

const wait = (ms = LATENCY_MS) => new Promise((r) => setTimeout(r, ms));

type Launch = { id: string; form: LaunchForm; mint: string; createdAt: number; failAt: Stage | null };

const KEY = "gamine.launchpad.mock";
let launches: Launch[] | null = null;

function store(): Launch[] {
  if (launches) return launches;
  launches = [];
  try {
    const saved = typeof sessionStorage === "undefined" ? null : readStoredValue(sessionStorage, KEY);
    if (saved) launches = JSON.parse(saved) as Launch[];
  } catch {
    // Nothing kept: start empty.
  }
  return launches;
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(store()));
  } catch {
    // Too big or no storage: kept for this page's life only.
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function fakeMint(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(44));
  return Array.from(bytes, (b) => BASE58[b % 58]).join("");
}

/** A flat pixel tile with the ticker's first letter: the made-up tokens' images. */
function tile(letter: string, fill: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'><rect width='16' height='16' fill='${fill}'/><rect x='1' y='1' width='14' height='14' fill='none' stroke='#000' stroke-opacity='.35'/><text x='8' y='12' font-family='monospace' font-size='10' font-weight='bold' text-anchor='middle' fill='#f5ecd8'>${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const NAMES = ["Mossback", "Quill", "Ember", "Rook", "Tansy", "Bramble", "Wick", "Juniper", "Flint", "Pike", "Sorrel", "Hazel"];
function agentsFor(ticker: string, count: number): TokenAgent[] {
  const shown = Math.min(count, 10);
  return Array.from({ length: shown }, (_, i) => ({
    agentId: `${ticker.toLowerCase()}-${i + 1}`,
    name: `${NAMES[(i * 5 + ticker.length) % NAMES.length]} ${ticker}`,
    rank: 3 + i * 4 + (ticker.charCodeAt(0) % 3),
    matches: 40 - i * 3,
    net: 180 - i * 37,
  }));
}

const DAY = 86_400_000;
type Seed = Omit<TokenDetail, "feeSplit" | "launcherShare" | "verifyUrl" | "pumpUrl" | "agents">;
const SEEDS: Seed[] = [
  {
    mint: "DoXe7pRk2vQh9mWs4TzLc8NfYb3JgUa6KdEr5HnPq1Mx",
    name: "Doxie",
    ticker: "DOX",
    image: tile("D", "#2f8f52"),
    holders: 214,
    agentsInPlay: 61,
    verification: "verified",
    launchedAt: new Date(Date.now() - 4 * DAY).toISOString(),
    description: "A dog that reads the room.",
    links: { x: "https://x.com/example" },
    marketCapUsd: 412_000,
    volume24hUsd: 96_400,
    bondingProgress: 100,
    removedReason: null,
  },
  {
    mint: "ZiPq4Lm8Wc2Rt7Yh5NbKd9GsEa3Fv6Ju1Xo8Pe2Tz4Qw",
    name: "Zipline",
    ticker: "ZIP",
    image: tile("Z", "#3a8f96"),
    holders: 88,
    agentsInPlay: 23,
    verification: "verified",
    launchedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    description: "Fast in, fast out.",
    links: { website: "https://example.com" },
    marketCapUsd: 58_300,
    volume24hUsd: 131_000,
    bondingProgress: 81,
    removedReason: null,
  },
  {
    mint: "MoTh3Kd7Ns1Vb5Qw9Ra2Ye6Uc4Lp8Hj3Gf7Dx5Zm1Tk9B",
    name: "Moth",
    ticker: "MOTH",
    image: tile("M", "#5c4a22"),
    holders: 12,
    agentsInPlay: 0,
    verification: "failed",
    launchedAt: new Date(Date.now() - 1 * DAY).toISOString(),
    description: "Drawn to the light.",
    links: {},
    marketCapUsd: 6_100,
    volume24hUsd: 2_300,
    bondingProgress: 9,
    removedReason: null,
  },
  {
    mint: "GLoB9Xs2Pd6Hq4Wn8Ke3Rv7Ty1Jc5Mb9Fa2Lu6Zo4Ni8E",
    name: "Globule",
    ticker: "GLOB",
    image: tile("G", "#7a3b5e"),
    holders: 140,
    agentsInPlay: 0,
    verification: "removed",
    launchedAt: new Date(Date.now() - 6 * DAY).toISOString(),
    description: "Round and getting rounder.",
    links: {},
    marketCapUsd: 210_000,
    volume24hUsd: 44_000,
    bondingProgress: 100,
    removedReason:
      "Its fee split was found changed on pump.fun after launch: creator fees no longer go to the three Gamine wallets. Its agents left the village.",
  },
  // More made-up tokens, so every ordering on the explore page has something to rank.
  ...(
    [
      ["Fernhollow", "FERN", "#3f8a6f", 512, 140, 1_250_000, 310_000, 100, 9],
      ["Cobble", "COB", "#6b6f7a", 61, 18, 21_400, 8_900, 34, 0.2],
      ["Lanternfly", "LANT", "#b07a2a", 302, 77, 96_000, 188_000, 93, 1.5],
      ["Puddle", "PUD", "#4a6fa5", 27, 9, 7_800, 1_100, 12, 0.05],
      ["Thistle", "THIS", "#8f7bd8", 158, 44, 39_000, 61_500, 64, 3],
      ["Mallow", "MALL", "#c95b8c", 840, 211, 2_700_000, 520_000, 100, 12],
      ["Kettle", "KTL", "#d4745a", 95, 31, 44_700, 12_200, 72, 5],
      ["Sprig", "SPRG", "#5dcd50", 14, 3, 4_900, 650, 6, 0.01],
    ] as const
  ).map(
    ([name, ticker, fill, holders, agentsInPlay, marketCapUsd, volume24hUsd, bondingProgress, days]): Seed => ({
      mint: `${ticker}${"x".repeat(44 - ticker.length)}`.replace(/x/g, (_, i: number) => BASE58[(i * 7 + ticker.charCodeAt(0)) % 58]!),
      name,
      ticker,
      image: tile(ticker[0]!, fill),
      holders,
      agentsInPlay,
      verification: "verified",
      launchedAt: new Date(Date.now() - days * DAY).toISOString(),
      description: "",
      links: {},
      marketCapUsd,
      volume24hUsd,
      bondingProgress,
      removedReason: null,
    }),
  ),
  // And a crowd, so the explore page has hundreds to page through, as it will.
  ...crowd(240),
];

/** Made-up tokens in number: names from two lists, figures spread wide, the same on every load. */
function crowd(count: number): Seed[] {
  const first = ["Moss", "Ember", "Quill", "Brook", "Cinder", "Fable", "Gloam", "Hollow", "Juniper", "Kestrel", "Lumen", "Marble", "Nettle", "Oaken", "Pebble", "Quartz", "Rook", "Saffron", "Tinder", "Umber", "Vesper", "Willow", "Yarrow", "Zephyr"];
  const second = ["", "cap", "fly", "kin", "paw", "bell", "drop", "top", "wick", "moon"];
  const fills = ["#2f8f52", "#3a8f96", "#5c4a22", "#7a3b5e", "#4a6fa5", "#8f7bd8", "#b07a2a", "#c95b8c", "#d4745a", "#3f8a6f"];
  const rand = rngOf(20261005);
  const out: Seed[] = [];
  for (let i = 0; i < count; i++) {
    const a = first[i % first.length]!;
    const b = second[Math.floor(i / first.length) % second.length]!;
    const name = b ? `${a}${b}` : a;
    // Three letters of each half, so no two names share a ticker.
    const ticker = `${a.slice(0, 3)}${b.slice(0, 2)}`.toUpperCase() + (Math.floor(i / (first.length * second.length)) || "");
    // Most stay small; a few grow large, as launches do.
    const size = rand() ** 4;
    const marketCapUsd = Math.round(3_000 + size * 3_000_000);
    const graduated = marketCapUsd > 69_000;
    const roll = rand();
    const verification: Verification = roll < 0.04 ? "failed" : roll < 0.06 ? "removed" : "verified";
    const holders = Math.round(5 + size * 900 + rand() * 30);
    out.push({
      mint: Array.from({ length: 44 }, () => BASE58[Math.floor(rand() * 58)]).join(""),
      name,
      ticker,
      image: tile(ticker[0]!, fills[i % fills.length]!),
      holders,
      agentsInPlay: verification === "verified" ? Math.round(holders * (0.15 + rand() * 0.2)) : 0,
      verification,
      launchedAt: new Date(Date.now() - (rand() * 30 + 0.02) * DAY).toISOString(),
      description: "",
      links: {},
      marketCapUsd,
      volume24hUsd: Math.round(marketCapUsd * rand() * 0.6),
      bondingProgress: graduated ? 100 : Math.max(1, Math.round((marketCapUsd / 69_000) * 100)),
      removedReason: verification === "removed" ? "Its fee split was found changed on pump.fun after launch. Its agents left the village." : null,
    });
  }
  return out;
}

/** A deterministic random stream, so the crowd is the same on every load. */
function rngOf(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each stage's state at `elapsed` ms into a launch that fails at `failAt`, or nowhere. */
function stagesAt(elapsed: number, failAt: Stage | null): { stages: Record<Stage, StageState>; failed: Stage | null } {
  const stages = {} as Record<Stage, StageState>;
  let t = 0;
  let stopped = false;
  let failed: Stage | null = null;
  STAGES.forEach((stage, i) => {
    const start = t;
    t += STAGE_MS[i]!;
    if (stopped || elapsed < start) {
      stages[stage] = "pending";
      return;
    }
    if (elapsed < t) {
      stages[stage] = "in-progress";
      stopped = true;
      return;
    }
    if (stage === failAt) {
      stages[stage] = "failed";
      failed = stage;
      stopped = true;
      return;
    }
    stages[stage] = "done";
  });
  return { stages, failed };
}

function statusOf(l: Launch): LaunchStatus {
  const { stages, failed } = stagesAt(Date.now() - l.createdAt, l.failAt);
  return {
    id: l.id,
    mint: stages.created === "done" ? l.mint : null,
    stages,
    failure: failed ? { stage: failed, message: FAILURE[failed] } : null,
    live: stages.agentsLive === "done",
  };
}

/** A launch as a token, once it exists on pump.fun; null before. */
function tokenOf(l: Launch): TokenDetail | null {
  const s = statusOf(l);
  if (s.stages.created !== "done") return null;
  const verification: Verification =
    s.stages.verified === "done" ? "verified" : s.failure && s.failure.stage !== "agentsLive" ? "failed" : "pending";
  // The launcher is the first holder; their agent is the first in play.
  const agents = s.live ? 1 : 0;
  return finish({
    mint: l.mint,
    name: l.form.name.trim(),
    ticker: l.form.ticker,
    image: l.form.image,
    holders: 1,
    agentsInPlay: agents,
    verification,
    launchedAt: new Date(l.createdAt).toISOString(),
    // A fresh pump.fun token: its first buy, and nothing traded yet.
    marketCapUsd: 4_200,
    volume24hUsd: 0,
    bondingProgress: 1,
    description: l.form.description,
    links: l.form.links,
    removedReason: null,
  }, agents);
}

function finish(seed: Seed, agents = seed.agentsInPlay): TokenDetail {
  return {
    ...seed,
    feeSplit: CONFIG.feeSplit,
    launcherShare: CONFIG.launcherShare,
    verifyUrl: `https://solscan.io/token/${seed.mint}`,
    pumpUrl: `https://pump.fun/coin/${seed.mint}`,
    agents: seed.verification === "verified" ? agentsFor(seed.ticker, agents) : [],
  };
}

function allTokens(): TokenDetail[] {
  const made = store().map(tokenOf).filter((t): t is TokenDetail => t !== null);
  return [...made, ...SEEDS.map((s) => finish(s))];
}

const summary = (t: TokenDetail): TokenSummary => ({
  mint: t.mint,
  name: t.name,
  ticker: t.ticker,
  image: t.image,
  holders: t.holders,
  agentsInPlay: t.agentsInPlay,
  verification: t.verification,
  launchedAt: t.launchedAt,
  marketCapUsd: t.marketCapUsd,
  volume24hUsd: t.volume24hUsd,
  bondingProgress: t.bondingProgress,
});

/** Each ranked order, largest first; ties go to the newer token. */
const RANK: Record<Exclude<LaunchSort, "newest">, (t: TokenSummary) => number> = {
  agents: (t) => t.agentsInPlay,
  volume: (t) => t.volume24hUsd ?? 0,
  marketCap: (t) => t.marketCapUsd ?? 0,
  holders: (t) => t.holders ?? 0,
  graduating: (t) => t.bondingProgress ?? 0,
};

export const mockLaunchpad: Launchpad = {
  mock: true,

  async getConfig() {
    await wait();
    return CONFIG;
  },

  async createLaunch(form: LaunchForm, options: LaunchOptions = {}) {
    await wait(400);
    const launch: Launch = {
      id: `mock-${Date.now().toString(36)}`,
      form,
      mint: fakeMint(),
      createdAt: Date.now(),
      failAt: options.failAt ?? null,
    };
    store().unshift(launch);
    save();
    return { id: launch.id };
  },

  async getLaunchStatus(id: string) {
    await wait();
    const l = store().find((x) => x.id === id);
    if (!l) throw new Error("No launch with that id.");
    return statusOf(l);
  },

  async listLaunches({ sort, search = "", offset = 0, limit = 20 }: LaunchQuery) {
    await wait();
    const q = search.trim().replace(/^\$/, "").toLowerCase();
    let list = allTokens().map(summary);
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q) || t.mint.toLowerCase().startsWith(q));
    const newest = (a: TokenSummary, b: TokenSummary) => b.launchedAt.localeCompare(a.launchedAt);
    if (sort === "newest") list.sort(newest);
    else {
      const by = RANK[sort];
      list = list
        .filter((t) => t.verification === "verified" || t.verification === "pending")
        // Graduating soon is the curve still to finish: a graduated token has left it.
        .filter((t) => sort !== "graduating" || (t.bondingProgress !== null && t.bondingProgress < 100))
        .sort((a, b) => by(b) - by(a) || newest(a, b));
    }
    return { tokens: list.slice(offset, offset + limit), total: list.length };
  },

  async getToken(mint: string) {
    await wait();
    return allTokens().find((t) => t.mint === mint) ?? null;
  },
};
