import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemInstruction, VersionedTransaction } from "@solana/web3.js";
import { solToLamports } from "../lib/launchpad-validation";
import { compileLaunch, launchInstructions } from "../lib/pump-transaction";
import { verifyFeeSharing, verifySignedLaunch } from "../lib/pump-verification";
import { LAUNCH_FEE_LAMPORTS, LAUNCH_FEE_RECIPIENT } from "../lib/launchpad-fees";
import { feeWallets } from "../lib/launchpad-config";
import { LaunchStore } from "../lib/launchpad-store";
import { pump } from "../lib/pump-sdk";
import type { LaunchForm } from "../lib/launchpad";
import { globalFixture, sharedTable } from "./pump-fixture";

async function fixture(initialBuySol = "0") {
  const user = Keypair.generate();
  const mint = Keypair.generate();
  const global = globalFixture();
  const form: LaunchForm = { name: "A".repeat(32), ticker: "ABCDEFGHIJ", description: "Test", image: "", links: {}, creator: user.publicKey.toBase58(), initialBuySol };
  const instructions = await launchInstructions({ form, mint: mint.publicKey, uri: "https://ipfs.io/ipfs/Qm" + "a".repeat(44), global, feeConfig: null });
  // A shared table is built for a different wallet/mint. A per-test table of
  // the real launch's dynamic PDAs would hide an oversized production packet.
  const table = await sharedTable(global);
  const transaction = compileLaunch({ instructions, user: user.publicKey, mint, blockhash: Keypair.generate().publicKey.toBase58(), lookupTable: table });
  return { user, mint, form, instructions, transaction, table };
}

describe("Pump launch transaction", () => {
  it.each(["0", "0.1"])("fits the network packet limit with a %s SOL buy and caps the platform fee", async (amount) => {
    const { instructions, transaction, user, mint } = await fixture(amount);
    expect(transaction.serialize().length).toBeLessThanOrEqual(1232);
    const transfer = SystemInstruction.decodeTransfer(instructions.at(-1)!);
    expect(transfer.fromPubkey.equals(user.publicKey)).toBe(true);
    expect(transfer.toPubkey.toBase58()).toBe(LAUNCH_FEE_RECIPIENT);
    expect(transfer.lamports).toBe(50_000_000n);
    expect(transfer.lamports).toBe(BigInt(LAUNCH_FEE_LAMPORTS));
    expect(instructions[3]!.programId.equals(pump.PUMP_FEE_PROGRAM_ID)).toBe(true);
    if (amount !== "0") {
      const buy = instructions.at(-2)!;
      expect(buy.programId.equals(pump.PUMP_PROGRAM_ID)).toBe(true);
      expect(buy.data.readBigUInt64LE(16)).toBe(100_000_000n);
      expect(buy.keys.some((key) => key.pubkey.equals(pump.creatorVaultPda(pump.feeSharingConfigPda(mint.publicKey))))).toBe(true);
    }
  });
  it("requires wallet and mint signatures and rejects changed instructions", async () => {
    const { transaction, user } = await fixture();
    const prepared = Buffer.from(transaction.serialize()).toString("base64");
    expect(() => verifySignedLaunch(prepared, prepared)).toThrow("signature");
    transaction.sign([user]);
    const signed = Buffer.from(transaction.serialize()).toString("base64");
    expect(verifySignedLaunch(prepared, signed).serialize()).toEqual(transaction.serialize());
    const changed = VersionedTransaction.deserialize(transaction.serialize());
    changed.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
    changed.sign([user]);
    expect(() => verifySignedLaunch(prepared, Buffer.from(changed.serialize()).toString("base64"))).toThrow("changed");
  });
  it("verifies the exact fee recipients and lock, irrespective of shareholder ordering", () => {
    const mint = Keypair.generate().publicKey;
    const config = { mint, version: 2, status: { active: {} }, admin: PublicKey.default, adminRevoked: true, shareholders: feeWallets.map((wallet) => ({ address: new PublicKey(wallet.address), shareBps: wallet.shareBps })).reverse() };
    expect(() => verifyFeeSharing(config, mint)).not.toThrow();
    expect(() => verifyFeeSharing({ ...config, adminRevoked: false }, mint)).toThrow("locked");
    expect(() => verifyFeeSharing({ ...config, shareholders: [{ address: Keypair.generate().publicKey, shareBps: 10_000 }] }, mint)).toThrow();
    expect(() => verifyFeeSharing(config, Keypair.generate().publicKey)).toThrow();
    expect(() => verifyFeeSharing({ ...config, status: { paused: {} } }, mint)).toThrow("not active");
  });
  it("keeps launch IDs and mint addresses unique in durable storage", async () => {
    const store = new LaunchStore(":memory:");
    const { form } = await fixture();
    const record = { id: crypto.randomUUID(), owner: form.creator, createdAt: Date.now(), form, mint: Keypair.generate().publicKey.toBase58(), uri: "ipfs://metadata", imageUrl: "ipfs://image", transaction: "prepared", lastValidBlockHeight: 100, signature: null, signed: null, confirmed: false, failure: null };
    store.reserve(record.id, record.owner);
    expect(() => store.reserve(record.id, record.owner)).toThrow("already");
    store.insert(record);
    expect(store.get(record.id)).toEqual(record);
    expect(() => store.insert(record)).toThrow();
    expect(() => store.insert({ ...record, id: crypto.randomUUID() })).toThrow();
    store.db.close();
  });
});

describe("Exact SOL amounts", () => {
  it.each([["", 0], ["0.1", 100_000_000], ["0.000000001", 1], ["1.123456789", 1_123_456_789]])("parses %s", (input, expected) => expect(solToLamports(String(input))).toBe(expected));
  it.each(["-1", "NaN", "1e9", "0.0000000001", "1.2.3", "99999999999999999999"])("rejects %s", (input) => expect(() => solToLamports(input)).toThrow());
});
