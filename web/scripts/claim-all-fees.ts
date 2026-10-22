import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AGP_MINT } from "../lib/agp";
import { distribute, feeWalletBalances, mainnet, type Distribution } from "./pump-distribute";

/**
 * Pays out the creator fees of every token launched on Gamine except $GAMINE, each to its locked
 * split (15% daily, 50% weekly, 35% platform). The token list comes from the site's confirmed-launch
 * catalog and is kept in web/.data/launched-tokens.json: tokens are added as they launch and never
 * dropped, so an archived launch is still swept. Without --send it reports and simulates only; one
 * token failing never stops the rest. The signer pays only network fees.
 *
 *   npm run pump:claim-all                                         report and simulate
 *   npm run pump:claim-all -- --keypair /path/to/wallet.json --send
 *
 * A token with less than --min-sol waiting (default 0.001) is left to accumulate: below that, the
 * network fee is a real part of what would be swept.
 */
if (process.argv.includes("--help")) {
  console.log("Usage: npm run pump:claim-all -- [--keypair /path/to/wallet.json --send] [--min-sol 0.001] [--site https://trygamine.xyz]\nEvery launched token except $GAMINE. Without --send, reports and simulates only. Requires PUMP_RPC_URL (mainnet).");
  process.exit(0);
}
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const site = (arg("--site") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://trygamine.xyz").replace(/\/$/, "");
const file = resolve(import.meta.dirname, "../.data/launched-tokens.json");

type Token = { mint: string; symbol: string; name: string; firstSeen: string };
type Store = { site: string; updatedAt: string; tokens: Token[] };

/** Every confirmed launch the site lists, page by page. */
async function catalog(): Promise<Omit<Token, "firstSeen">[]> {
  const out: Omit<Token, "firstSeen">[] = [];
  let offset = 0;
  for (let page = 0; page < 1000; page++) {
    const response = await fetch(`${site}/api/launchpad/holder-tokens?offset=${offset}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${site} did not list its launches (${response.status}).`);
    const body = await response.json() as { network?: string; tokens?: { mint: string; symbol: string; name: string }[]; nextOffset?: number | null };
    if (body.network !== "mainnet-beta" || !Array.isArray(body.tokens)) throw new Error("The launch list is not a mainnet catalog.");
    for (const t of body.tokens) out.push({ mint: new PublicKey(t.mint).toBase58(), symbol: String(t.symbol), name: String(t.name) });
    if (body.nextOffset === null || body.nextOffset === undefined) return out;
    if (body.nextOffset <= offset) throw new Error("The launch list's pages do not advance.");
    offset = body.nextOffset;
  }
  throw new Error("The launch list has too many pages.");
}

/** The stored list, with the site's current launches merged in. A token is never removed. */
async function tokens(): Promise<Token[]> {
  let stored: Store = { site, updatedAt: "", tokens: [] };
  try { stored = JSON.parse(readFileSync(file, "utf8")) as Store; } catch { /* First run. */ }
  const known = new Map(stored.tokens.map((t) => [t.mint, t]));
  try {
    const now = new Date().toISOString();
    for (const t of await catalog()) known.set(t.mint, { ...t, firstSeen: known.get(t.mint)?.firstSeen ?? now });
    stored = { site, updatedAt: now, tokens: [...known.values()].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen)) };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(stored, null, 2) + "\n");
    console.log(`Launch list: ${stored.tokens.length} tokens, saved to ${file}`);
  } catch (error) {
    if (!stored.tokens.length) throw error;
    console.log(`Could not refresh the launch list (${(error as Error).message}); using the ${stored.tokens.length} tokens saved ${stored.updatedAt}.`);
  }
  return stored.tokens;
}

const connection = await mainnet();
const keyPath = arg("--keypair");
const signer = keyPath ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8")) as number[])) : null;
const send = process.argv.includes("--send");
const minSol = Number(arg("--min-sol") ?? 0.001);
if (!Number.isFinite(minSol) || minSol < 0) throw new Error("--min-sol must be a number of SOL, 0 or more.");
if (send && !signer) throw new Error("--send needs --keypair /path/to/wallet.json (it pays only network fees).");
const skip = new Set([AGP_MINT, process.env.PAYOUT_AGP_MINT].filter(Boolean));
const list = (await tokens()).filter((t) => !skip.has(t.mint));
console.log(`Fee wallets before: ${JSON.stringify(await feeWalletBalances(connection))}`);
console.log(`${list.length} tokens to check (every launch except $GAMINE)${send ? "" : "; simulating only, nothing will be sent"}.\n`);

const rows: { token: string; mint: string; result: Distribution | { status: "error"; why: string } }[] = [];
for (const t of list) {
  let result: Distribution | { status: "error"; why: string };
  try { result = await distribute(connection, new PublicKey(t.mint), signer, send, minSol); }
  catch (error) { result = { status: "error", why: (error as Error).message.split("\n")[0]!.slice(0, 160) }; }
  rows.push({ token: `$${t.symbol}`, mint: t.mint, result });
  const r = result;
  console.log(`$${t.symbol.padEnd(8)} ${t.mint}  ${r.status === "sent" ? `paid out ${r.waitingSol} SOL  https://solscan.io/tx/${r.signature}`
    : r.status === "simulated" ? `${r.waitingSol} SOL waiting, simulation passed`
    : r.status === "below-minimum" ? `${r.waitingSol} SOL waiting, under the ${r.minimumSol} SOL minimum`
    : `error: ${r.why}`}`);
}

const sent = rows.filter((r) => r.result.status === "sent").length, ready = rows.filter((r) => r.result.status === "simulated").length;
const errors = rows.filter((r) => r.result.status === "error").length;
console.log(`\n${send ? `Paid out ${sent}` : `${ready} ready to pay out`}, ${rows.filter((r) => r.result.status === "below-minimum").length} under the minimum, ${errors} errors.`);
if (send) console.log(`Fee wallets after: ${JSON.stringify(await feeWalletBalances(connection))}`);
else if (ready) console.log("To pay them out: npm run pump:claim-all -- --keypair /path/to/wallet.json --send");
if (errors) process.exitCode = 1;
