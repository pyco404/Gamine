import "./env.js";
import { connect, migrate } from "../src/db/client.js";
import { listen } from "../src/http/server.js";
import { assignMissingMarks, createAgent } from "../src/db/runner.js";
import { refreshTrueRatings } from "../src/db/rating.js";
import { agents, AUTOPLAY_INTERVAL_MS } from "../src/db/schema.js";
import { mulberry32, PRESET_NAMES } from "../src/index.js";
import { nameFactory } from "./names.js";

// Dev server. Usage: npm run serve [-- --port 8787 --migrate --roster 24 --memory]
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
// Matches are linked from share pages, so they must outlive the process.
// In-memory PGlite only on request, for a throwaway run.
if (!process.env["DATABASE_URL"] && !process.argv.includes("--memory")) {
  console.error("DATABASE_URL is not set. Point it at Postgres (see docker-compose.yml), or pass --memory for a throwaway in-memory run.");
  process.exit(1);
}
const { db } = await connect();
if (process.argv.includes("--migrate")) await migrate(db);

// The house roster: unowned preset agents, so a first player has someone to
// practise against and the feed shows the platform running. Only when the
// roster is empty.
const rosterSize = arg("--roster", 24);
if (rosterSize > 0 && (await db.select({ id: agents.id }).from(agents).limit(1)).length === 0) {
  const nextName = nameFactory(mulberry32(Date.now() % 1_000_000));
  for (let i = 0; i < rosterSize; i++) {
    await createAgent(db, { name: nextName(), presetName: PRESET_NAMES[i % PRESET_NAMES.length]! });
  }
  console.log(`Seeded a house roster of ${rosterSize} agents`);
}
// Every agent has its own emoji; agents from before marks existed get theirs now, oldest first.
const marked = await assignMissingMarks(db);
if (marked) console.log(`Gave ${marked} agents their marks`);
// Brings stored ratings up to date if the roster or the way ratings are computed changed.
const rerated = await refreshTrueRatings(db);
if (rerated) console.log(`Re-rated ${rerated} agents`);
// House exhibitions, when configured: house agents play each other so the feed
// shows the platform running.
const exhibitionMs = Number(process.env["HOUSE_EXHIBITION_MS"] ?? 0);
if (exhibitionMs > 0) {
  const { startHouseExhibitions } = await import("../src/db/house.js");
  startHouseExhibitions(db, {
    intervalMs: exhibitionMs,
    onError: (error) => console.error(`house: exhibition failed: ${String(error).slice(0, 160)}`),
  });
  console.log(`House exhibitions: about one every ${Math.round(exhibitionMs / 1000)}s`);
}

// Seasons: close each one at its boundary and settle the season's chip rate -
// the minimum's dollar peg (docs/holder-agents.md). The first pass is awaited
// here, before anything plays, so a boundary missed while the api was down is
// closed first. Then once a minute.
{
  const { startSeasons } = await import("../src/db/seasons.js");
  const { syncSeasonRate } = await import("../src/db/chip-rate.js");
  const first = await syncSeasonRate(db);
  console.log(`Chip rate: ${first.rate} base units a chip for season ${first.season} (${first.source})`);
  startSeasons(db, {
    onLog: (line) => console.log(line),
    onError: (error) => console.error(`season: ${String(error).slice(0, 220)}`),
  });
}
// Holder scores: each UTC day frozen once it is over (docs/holder-agents.md).
{
  const { startScores } = await import("../src/db/scores.js");
  startScores(db, {
    onLog: (line) => console.log(line),
    onError: (error) => console.error(`scores: ${String(error).slice(0, 160)}`),
  });
}
// Traits: counted from match logs in the background, never in the match path.
{
  const { startTraits } = await import("../src/character/trait-store.js");
  startTraits(db, {
    onLog: (line) => console.log(line),
    onError: (error) => console.error(`traits: ${String(error).slice(0, 160)}`),
  });
}
const autoplayMs = Number(process.env["AUTOPLAY_INTERVAL_MS"] ?? AUTOPLAY_INTERVAL_MS);

const rpc = process.env["CHAIN_RPC_URL"];
// The token holders hold: $GAMINE on mainnet, the faucet's test token on devnet.
const mint = process.env["HOLDER_MINT"] ?? process.env["CHAIN_STAKE_MINT"];

// The devnet faucet, when there is a treasury to hand out from. It refuses any
// cluster but devnet, and says so rather than starting quietly: a faucet is
// only ever a devnet convenience, and the check is on the chain's own genesis
// hash rather than on a variable naming it. FAUCET_ENABLED=true is the only
// thing that turns it on; the devnet check applies on top and cannot be overridden.
let faucet: import("../src/db/faucet.js").FaucetChain | undefined;
if (rpc && mint && process.env["FAUCET_ENABLED"] === "true") {
  const { Connection, Keypair, PublicKey } = await import("@solana/web3.js");
  const { devnetFaucet, NotDevnetError } = await import("../src/chain/faucet.js");
  const { loadKeypair } = await import("../src/chain/common.js");
  const secret = process.env["CHAIN_TREASURY_SECRET"];
  const treasuryPath = process.env["CHAIN_TREASURY_KEYPAIR"] ?? ".keys/treasury.json";
  try {
    const treasury = secret ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[])) : loadKeypair(treasuryPath);
    faucet = await devnetFaucet(new Connection(rpc, "confirmed"), new PublicKey(mint), treasury);
    console.log(`Faucet: on, from treasury ${treasury.publicKey.toBase58()}`);
  } catch (error) {
    if (error instanceof NotDevnetError) console.log(`Faucet: off - ${error.message}`);
    else console.log(`Faucet: off - no treasury key (${String(error).slice(0, 120)})`);
  }
} else if (rpc && mint) {
  console.log("Faucet: off (set FAUCET_ENABLED=true to hand out test tokens)");
}

// Holder agents (docs/holder-agents.md): a wallet holding the token above the
// minimum has an agent, with nothing rented or deposited. FUNDING_MODE=holder
// puts every new agent on this flow; HOLDER_WALLETS is a comma-separated
// allowlist for trying it first.
let holderFlow: import("../src/http/server.js").AppOptions["holder"];
if (rpc && mint) {
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const { rpcHoldings } = await import("../src/chain/holdings.js");
  const { startHoldings } = await import("../src/db/holdings.js");
  const mode = process.env["FUNDING_MODE"] === "holder";
  const allowed = new Set(
    (process.env["HOLDER_WALLETS"] ?? "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean),
  );
  if (mode || allowed.size) {
    const connection = new Connection(rpc, "confirmed");
    const genesis = await connection.getGenesisHash();
    const mainnet = genesis === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    const { DEVNET_GENESIS } = await import("../src/chain/faucet.js");
    const { useLiveHolderPricing } = await import("../src/holder-policy.js");
    useLiveHolderPricing(mainnet);
    const discoveryRpc = process.env["HOLDER_DISCOVERY_RPC_URL"] ?? process.env["CHAIN_RPC_URL_HELIUS"] ?? (mainnet && rpc.includes("helius") ? rpc : undefined);
    if (discoveryRpc && mode && await new Connection(discoveryRpc).getGenesisHash() !== await connection.getGenesisHash()) {
      throw new Error("Holder discovery and balance RPC must use the same Solana network");
    }
    const holdingsChain = rpcHoldings(connection, new PublicKey(mint), {
      livePricing: mainnet,
      ...(discoveryRpc && mode ? { discoveryRpc } : {}),
    });
    const catalog = mainnet ? await import("../src/db/holder-catalog.js").then(({ startHolderCatalog }) => startHolderCatalog(db, {
      url: process.env["HOLDER_LAUNCHPAD_URL"] ?? "https://trygamine.xyz",
      primaryMint: mint,
      chainFor: (tokenMint) => rpcHoldings(connection, new PublicKey(tokenMint), {
        livePricing: true, tokenScoped: true, ...(discoveryRpc && mode ? { discoveryRpc } : {}),
      }),
      ...(Number(process.env["HOLDINGS_INTERVAL_MS"]) > 0 ? { intervalMs: Number(process.env["HOLDINGS_INTERVAL_MS"]) } : {}),
      onError: () => console.error("holder catalog: a token or catalog could not be verified; retrying next pass"),
    })) : undefined;
    holderFlow = { chain: holdingsChain, primaryMint: mint, solanaCluster: mainnet ? "mainnet-beta" : genesis === DEVNET_GENESIS ? "devnet" : null, ...(catalog ? { catalog } : {}), allow: (ownerId) => mode || allowed.has(ownerId) };
    startHoldings(db, holdingsChain, {
      ...(Number(process.env["HOLDINGS_INTERVAL_MS"]) > 0 ? { intervalMs: Number(process.env["HOLDINGS_INTERVAL_MS"]) } : {}),
      onLog: (line) => console.log(line),
      onError: (error) => console.error(`holdings: ${String(error).slice(0, 160)}`),
    });
    console.log(`Holders: on for ${mode ? "every new agent" : `${allowed.size} allowlisted wallet(s)`}, token ${mint}`);
  } else {
    console.log("Holders: off (set FUNDING_MODE=holder or HOLDER_WALLETS to turn them on)");
  }
}

// Autoplay: agents play on a timer, without their owners present. On by
// default for newly activated holders;
// AUTOPLAY_INTERVAL_MS=0 turns the loop off entirely.
if (autoplayMs > 0) {
  const { startAutoplay } = await import("../src/db/autoplay.js");
  startAutoplay(db, {
    intervalMs: autoplayMs,
    onError: (error) => console.error(`autoplay: ${String(error).slice(0, 160)}`),
    onLog: (line) => console.log(line),
  });
  const every = autoplayMs < 60_000 ? `${Math.round(autoplayMs / 1000)} seconds` : `${autoplayMs / 60_000} minutes`;
  console.log(`Autoplay: one match per agent every ${every}`);
} else {
  console.log("Autoplay: off (AUTOPLAY_INTERVAL_MS=0)");
}


// Cosmetic world routines run with no viewers. Only Bluff & Fold earns rewards.
{
  const { startWorldActivities } = await import("../src/db/world-activities.js");
  await startWorldActivities(db, { onError: (error) => console.error(`world activities: ${String(error).slice(0, 160)}`) });
  console.log("World activities: persistent cosmetic routines on");
}

// Characters check chosen names and write bios for brief-written agents with
// a small model, when there is a key to call one with.
const characterModel = process.env["ANTHROPIC_API_KEY"]
  ? await import("../src/character/model.js").then(({ textCheck, bioWriter }) => ({ check: textCheck(), writeBio: bioWriter() }))
  : undefined;

/** What /admin reports: holdings and scores, read fresh each request (src/db/admin.ts). */
const health = async () => (await import("../src/db/admin.js")).health(db);

// A host sets PORT and needs every interface; locally, loopback only.
const { url } = await listen({
  db,
  port: Number(process.env["PORT"] ?? arg("--port", 8787)),
  host: process.env["HOST"],
  ...(faucet ? { faucet } : {}),
  ...(holderFlow ? { holder: holderFlow } : {}),
  ...(characterModel ? { character: characterModel } : {}),
  health,
});
// Chosen names that could not be checked at creation: checked again until the model answers.
if (characterModel) {
  const { startNameChecks } = await import("../src/character/store.js");
  startNameChecks(db, characterModel.check, {
    onLog: (line) => console.log(line),
    onError: (error) => console.error(`names: ${String(error).slice(0, 160)}`),
  });
}

console.log(`Gamine on ${url}`);
console.log(process.env["ANTHROPIC_API_KEY"] ? "Briefs: on" : "Briefs: off, no ANTHROPIC_API_KEY in the environment or .env; presets only");
console.log(`  POST ${url}/agents         wallet session required; {name, presetName} or {name, brief}`);
console.log(`  GET  ${url}/agents/:id     public, or the owner view for its signed-in owner`);
console.log(`  POST ${url}/agents/:id/play`);
console.log(`  GET  ${url}/matches/:id    includes the rendered transcript`);
console.log(`  GET  ${url}/ladder?sort=winnings|per-match`);
console.log(`  POST ${url}/preview        {brief} or {policyTable}`);
