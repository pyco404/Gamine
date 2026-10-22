import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AGP_MINT } from "../lib/agp";
import { distribute, feeWalletBalances, mainnet } from "./pump-distribute";

/**
 * Pays one token's accumulated pump.fun creator fees out to its locked fee split (scripts/pump-distribute.ts).
 * Without --send it reports what is waiting and simulates the payout. For every launch at once, see
 * scripts/claim-all-fees.ts.
 */
if (process.argv.includes("--help")) {
  console.log("Usage: npm run pump:distribute -- [--mint <address>] [--keypair /path/to/wallet.json --send]\nDefaults to $GAMINE. Without --send, reports and simulates only. Requires PUMP_RPC_URL (mainnet).");
  process.exit(0);
}
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const connection = await mainnet();
const mint = new PublicKey(arg("--mint") ?? AGP_MINT);
const keyPath = arg("--keypair");
const signer = keyPath ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8")) as number[])) : null;

console.log(JSON.stringify({ mint: mint.toBase58(), wallets: await feeWalletBalances(connection) }, null, 2));
const result = await distribute(connection, mint, signer, process.argv.includes("--send"));
if (result.status === "below-minimum") console.log(`${result.waitingSol} SOL waiting; ${result.minimumSol} SOL is the least that can be distributed. Not enough has accumulated yet.`);
else if (result.status === "simulated") console.log(`${result.waitingSol} SOL waiting. Simulation passed. Nothing was sent. To pay it out, rerun with --keypair /path/to/wallet.json --send (the wallet pays only the network fee).`);
else console.log(JSON.stringify({ distributed: true, waitingSol: result.waitingSol, signature: result.signature, explorer: `https://solscan.io/tx/${result.signature}`, wallets: await feeWalletBalances(connection) }, null, 2));
