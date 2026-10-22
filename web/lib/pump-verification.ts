import { createPublicKey, verify } from "node:crypto";
import { PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import type { SharingConfig } from "@pump-fun/pump-sdk";
import { feeWallets } from "./launchpad-config";

/** Wallet approval must preserve every instruction, account and spending cap. */
export function verifySignedLaunch(prepared: string, signed: string): VersionedTransaction {
  const expected = VersionedTransaction.deserialize(Buffer.from(prepared, "base64"));
  const actual = VersionedTransaction.deserialize(Buffer.from(signed, "base64"));
  const message = Buffer.from(actual.message.serialize());
  if (!message.equals(Buffer.from(expected.message.serialize()))) throw new Error("The signed launch transaction was changed.");
  for (let i = 0; i < actual.message.header.numRequiredSignatures; i++) {
    const key = actual.message.staticAccountKeys[i]!;
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.toBuffer()]), format: "der", type: "spki" });
    if (!verify(null, message, publicKey, actual.signatures[i]!)) throw new Error("The launch transaction is missing a valid signature.");
  }
  return actual;
}

/**
 * A payout transfer as the reward wallet signed it. Phantom adds its own instructions before signing
 * (a priority fee, balance assertions), so the bytes may differ from those prepared; what may not
 * differ is the signer, the blockhash (expiry is accounted from it, so a payment is never prepared
 * twice) and every prepared instruction, unchanged and in order. What the additions actually do is
 * proved separately by simulating the signed transaction (payout-adapter.ts, verifyTransfer).
 */
export function verifySignedPayout(prepared: string, signed: string): VersionedTransaction {
  const expected = VersionedTransaction.deserialize(Buffer.from(prepared, "base64"));
  const actual = VersionedTransaction.deserialize(Buffer.from(signed, "base64"));
  const message = Buffer.from(actual.message.serialize());
  if (!message.equals(Buffer.from(expected.message.serialize()))) {
    const same = (a: TransactionInstruction, b: TransactionInstruction) => a.programId.equals(b.programId) && a.data.equals(b.data)
      && a.keys.length === b.keys.length && a.keys.every((k, i) => k.pubkey.equals(b.keys[i]!.pubkey) && k.isSigner === b.keys[i]!.isSigner && k.isWritable === b.keys[i]!.isWritable);
    if (actual.message.recentBlockhash !== expected.message.recentBlockhash || actual.message.header.numRequiredSignatures !== 1
      || !actual.message.staticAccountKeys[0]!.equals(expected.message.staticAccountKeys[0]!) || actual.message.addressTableLookups.length) {
      throw new Error("Payout transfer was changed beyond what a wallet may add. Approve it again.");
    }
    const ours = TransactionMessage.decompile(expected.message).instructions;
    const theirs = TransactionMessage.decompile(actual.message).instructions;
    let next = 0;
    for (const instruction of theirs) if (next < ours.length && same(instruction, ours[next]!)) next++;
    if (next !== ours.length) throw new Error("Payout transfer was changed beyond what a wallet may add. Approve it again.");
  }
  const key = actual.message.staticAccountKeys[0]!;
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.toBuffer()]), format: "der", type: "spki" });
  if (!verify(null, message, publicKey, actual.signatures[0]!)) throw new Error("Payout transfer is missing the reward wallet's signature.");
  return actual;
}

export function verifyFeeSharing(config: SharingConfig & { status?: Record<string, unknown> }, mint: PublicKey): void {
  // SDK 2.0's public type omits the status that its IDL actually decodes.
  const status = config.status;
  if (config.version !== 2 || !status || !Object.hasOwn(status, "active")) throw new Error("The creator fee configuration is not active.");
  if (!config.mint.equals(mint) || !config.adminRevoked || config.shareholders.length !== feeWallets.length) throw new Error("The creator fee split is not locked as required.");
  for (const wallet of feeWallets) {
    if (!config.shareholders.some((share) => share.address.toBase58() === wallet.address && share.shareBps === wallet.shareBps)) throw new Error("The creator fee recipients or percentages do not match Gamine.");
  }
}
