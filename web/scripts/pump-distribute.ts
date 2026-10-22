import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
// pump.fun's program now sweeps the curve's creator bucket before a distribution; only SDK 4 builds
// that. The launch path stays on the SDK it was tested with (lib/pump-sdk.ts); these scripts alone use 4.
import { createRequire } from "node:module";
// Loaded as CommonJS: its ESM build's anchor import does not resolve under this project's loader.
const pump4 = createRequire(import.meta.url)("pump-sdk-v4") as typeof import("pump-sdk-v4");
import { DAILY_REWARDS_WALLET, WEEKLY_REWARDS_WALLET, LAUNCH_FEE_RECIPIENT } from "../lib/launchpad-fees";

const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const sol = (lamports: number | bigint) => (Number(lamports) / 1e9).toFixed(6);
export const FEE_WALLETS = { daily: DAILY_REWARDS_WALLET, weekly: WEEKLY_REWARDS_WALLET, platform: LAUNCH_FEE_RECIPIENT };

/** A mainnet connection from PUMP_RPC_URL; distribution is refused anywhere else. */
export async function mainnet(): Promise<Connection> {
  const rpc = process.env.PUMP_RPC_URL;
  if (!rpc) throw new Error("Set PUMP_RPC_URL in web/.env.local.");
  const connection = new Connection(rpc, "confirmed");
  if (await connection.getGenesisHash() !== MAINNET) throw new Error("Distribution is on mainnet only.");
  return connection;
}

export async function feeWalletBalances(connection: Connection) {
  return Object.fromEntries(await Promise.all(Object.entries(FEE_WALLETS).map(async ([k, w]) => [k, sol(await connection.getBalance(new PublicKey(w)))])));
}

export type Distribution =
  | { status: "below-minimum"; waitingSol: string; minimumSol: string }
  | { status: "simulated"; waitingSol: string }
  | { status: "sent"; waitingSol: string; signature: string };

/**
 * Pays one token's accumulated pump.fun creator fees out to its locked fee split (15% daily, 50%
 * weekly, 35% platform for Gamine launches). Anyone may send it; the signer pays only the network
 * fee. It always simulates first, and sends only with `send` and a signer: a failing simulation
 * throws and nothing is sent.
 */
export async function distribute(connection: Connection, mint: PublicKey, signer: Keypair | null, send: boolean, minSol = 0): Promise<Distribution> {
  const payer = signer?.publicKey ?? new PublicKey(LAUNCH_FEE_RECIPIENT);
  const online = new pump4.OnlinePumpSdk(connection);
  const waiting = await online.getMinimumDistributableFee(mint, payer);
  const waitingSol = sol(BigInt(waiting.distributableFees.toString()));
  // Below pump.fun's own minimum, or below the caller's (not worth a network fee), it is left to accumulate.
  const minimum = BigInt(waiting.minimumRequired.toString()) > BigInt(Math.round(minSol * 1e9)) ? BigInt(waiting.minimumRequired.toString()) : BigInt(Math.round(minSol * 1e9));
  if (!waiting.canDistribute || BigInt(waiting.distributableFees.toString()) < minimum) return { status: "below-minimum", waitingSol, minimumSol: sol(minimum) };
  const { instructions } = await online.buildDistributeCreatorFeesInstructions(mint, { payer });
  const latest = await connection.getLatestBlockhash();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
  const simulation = await connection.simulateTransaction(tx, { sigVerify: false });
  if (simulation.value.err) {
    throw new Error(`The distribution would fail: ${JSON.stringify(simulation.value.err)}. Nothing was sent.\n${(simulation.value.logs ?? []).slice(-8).join("\n")}`);
  }
  if (!send || !signer) return { status: "simulated", waitingSol };
  tx.sign([signer]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  return { status: "sent", waitingSol, signature };
}
