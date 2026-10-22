import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { pump } from "../lib/pump-sdk";
import { launchInstructions, commonLookupAddresses } from "../lib/pump-transaction";
import { LAUNCH_FEE_RECIPIENT } from "../lib/launchpad-fees";

if (process.argv.includes("--help")) {
  console.log("Usage: npm run pump:setup -- [--keypair /path/to/platform.json --send]\nWithout --send, prints the lookup addresses without submitting transactions. Requires PUMP_RPC_URL (mainnet).");
  process.exit(0);
}
const rpc = process.env.PUMP_RPC_URL;
if (!rpc) throw new Error("Set PUMP_RPC_URL in web/.env.local.");
const connection = new Connection(rpc, "confirmed");
if (await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("The lookup table must be on mainnet.");
const payer = new PublicKey(LAUNCH_FEE_RECIPIENT);
const mint = Keypair.generate().publicKey;
const online = new pump.OnlinePumpSdk(connection);
const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
const instructions = await launchInstructions({
  form: { creator: payer.toBase58(), name: "Setup", ticker: "SETUP", description: "", image: "", links: {}, initialBuySol: "0.1" },
  mint, uri: "https://ipfs.io/ipfs/setup", global, feeConfig,
});
const addresses = commonLookupAddresses(instructions, payer, mint, global);
if (!process.argv.includes("--send")) {
  console.log(JSON.stringify({ payer: payer.toBase58(), addresses: addresses.map((key) => key.toBase58()), note: "No transactions sent. To create the shared lookup table, rerun with --keypair /path/to/platform.json --send. The wallet pays account rent and network fees." }, null, 2));
  process.exit(0);
}
const keyIndex = process.argv.indexOf("--keypair");
if (keyIndex < 0 || !process.argv[keyIndex + 1]) throw new Error("Provide the platform keypair file using --keypair.");
const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.argv[keyIndex + 1]!, "utf8"))));
if (!signer.publicKey.equals(payer)) throw new Error("The keypair must match Gamine's platform wallet.");
const recentSlot = await connection.getSlot("finalized");
const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: payer, payer, recentSlot });
await sendAndConfirmTransaction(connection, new Transaction().add(create), [signer]);
// Preserve the public address before extending, so a partial setup can be
// recovered without paying to create another table.
mkdirSync(".data", { recursive: true });
writeFileSync(".data/pump-lookup-table.json", JSON.stringify({ address: table.toBase58(), addresses: addresses.map((key) => key.toBase58()) }, null, 2));
for (let at = 0; at < addresses.length; at += 20) {
  const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: payer, payer, addresses: addresses.slice(at, at + 20) });
  await sendAndConfirmTransaction(connection, new Transaction().add(extend), [signer]);
}
// Freezing makes the table's entries immutable.
await sendAndConfirmTransaction(connection, new Transaction().add(AddressLookupTableProgram.freezeLookupTable({ lookupTable: table, authority: payer })), [signer]);
console.log(`Lookup table created and frozen. Add PUMP_LOOKUP_TABLE=${table.toBase58()} to web/.env.local. No tokens were launched.`);
