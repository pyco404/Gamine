import BN from "bn.js";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, SystemProgram,
  TransactionMessage, VersionedTransaction, type Keypair, type TransactionInstruction,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { pump } from "./pump-sdk";
import { feeWallets } from "./launchpad-config";
import { LAUNCH_FEE_LAMPORTS, LAUNCH_FEE_RECIPIENT, feeWalletsReady } from "./launchpad-fees";
import type { LaunchForm } from "./launchpad";
import { solToLamports } from "./launchpad-validation";

type Global = import("@pump-fun/pump-sdk").Global;
type FeeConfig = import("@pump-fun/pump-sdk").FeeConfig;

export async function launchInstructions({
  form, mint, uri, global, feeConfig,
}: { form: LaunchForm; mint: PublicKey; uri: string; global: Global; feeConfig: FeeConfig | null }): Promise<TransactionInstruction[]> {
  if (!feeWalletsReady()) throw new Error("Configure distinct PUMP_PLATFORM_WALLET and PUMP_AGENT_REWARDS_WALLET addresses first.");
  const user = new PublicKey(form.creator);
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    await pump.PUMP_SDK.createV2Instruction({
      mint, user, creator: user, name: form.name.trim(), symbol: form.ticker, uri,
      mayhemMode: false, holderReward: false,
    }),
    await pump.PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null }),
    // SOL-only sharing omits the unused quote-token vault account of v2.
    // The SDK's SOL instruction also sets the final shares and revokes admin.
    await pump.PUMP_SDK.updateFeeShares({
      authority: user, mint, currentShareholders: [user],
      newShareholders: feeWallets.map(({ address, shareBps }) => ({ address: new PublicKey(address), shareBps })),
    }),
  ];
  const lamports = solToLamports(form.initialBuySol);
  if (lamports > 0) {
    // Buy only after the split is locked. The sharing PDA is now the creator.
    const curve = { ...pump.newBondingCurve(global, NATIVE_MINT), creator: pump.feeSharingConfigPda(mint), isMayhemMode: false };
    const amount = pump.getBuyTokenAmountFromSolAmount({
      global, feeConfig, mintSupply: global.tokenTotalSupply, bondingCurve: curve,
      amount: new BN(lamports), quoteMint: NATIVE_MINT,
    });
    if (amount.isZero()) throw new Error("The initial buy is too small to purchase tokens.");
    // The supported SOL-only buy uses fewer accounts than buy_v2, allowing
    // creation + locked sharing + the purchase to fit one atomic packet.
    const buybackFeeRecipient = global.buybackFeeRecipients.find((key) => !key.equals(PublicKey.default));
    if (!buybackFeeRecipient) throw new Error("Pump's buyback fee recipient is unavailable.");
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(user, getAssociatedTokenAddressSync(mint, user, true, TOKEN_2022_PROGRAM_ID), user, mint, TOKEN_2022_PROGRAM_ID),
      await pump.PUMP_SDK.getBuyInstructionRaw({
        mint, user, creator: curve.creator, amount, solAmount: new BN(lamports),
        // Fixed recipients read from Pump's live global account are in the
        // shared table. Random SDK defaults would add extra packet accounts.
        feeRecipient: global.feeRecipient, buybackFeeRecipient,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      }),
    );
  }
  instructions.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(LAUNCH_FEE_RECIPIENT), lamports: LAUNCH_FEE_LAMPORTS }));
  return instructions;
}

export function compileLaunch({ instructions, user, mint, blockhash, lookupTable }: {
  instructions: TransactionInstruction[]; user: PublicKey; mint: Keypair;
  blockhash: string; lookupTable: AddressLookupTableAccount;
}): VersionedTransaction {
  if (!lookupTable.isActive()) throw new Error("The Pump address lookup table is inactive.");
  const message = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions }).compileToV0Message([lookupTable]);
  const transaction = new VersionedTransaction(message);
  transaction.sign([mint]);
  if (transaction.serialize().length > 1232) throw new Error("The Pump address lookup table needs additional addresses before this launch can be prepared.");
  return transaction;
}

/** Accounts safe to share between launches. Dynamic mint/curve/creator accounts are deliberately excluded. */
export function commonLookupAddresses(instructions: TransactionInstruction[], user: PublicKey, mint: PublicKey, global?: Global): PublicKey[] {
  const sharing = pump.feeSharingConfigPda(mint);
  const dynamic = new Set([
    user, mint, pump.bondingCurvePda(mint), pump.bondingCurveV2Pda(mint), sharing,
    ...instructions.flatMap((instruction) => instruction.keys.filter((key) => key.isSigner).map((key) => key.pubkey)),
  ].map((key) => key.toBase58()));
  // Only include the fixed protocol accounts and known reward wallets. PDA
  // accounts specific to a mint must never be added to the shared table.
  const fixed = new Set([
    SystemProgram.programId, ComputeBudgetProgram.programId, TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID, NATIVE_MINT, new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    pump.PUMP_PROGRAM_ID, pump.PUMP_FEE_PROGRAM_ID, pump.PUMP_AMM_PROGRAM_ID, pump.MAYHEM_PROGRAM_ID,
    pump.GLOBAL_PDA, pump.GLOBAL_VOLUME_ACCUMULATOR_PDA, pump.PUMP_FEE_CONFIG_PDA,
    pump.getGlobalParamsPda(), pump.getSolVaultPda(),
    ...feeWallets.map((wallet) => new PublicKey(wallet.address)),
    ...instructions.flatMap((instruction) => instruction.keys.filter((key) => !key.isWritable && !key.isSigner).map((key) => key.pubkey)),
  ].map((key) => key.toBase58()));
  const addresses = new Map<string, PublicKey>();
  for (const instruction of instructions) for (const key of [...instruction.keys.map((key) => key.pubkey), instruction.programId]) {
    const address = key.toBase58();
    if (fixed.has(address) && !dynamic.has(address)) addresses.set(address, key);
  }
  if (global) for (const key of [global.feeRecipient, ...global.feeRecipients, ...global.reservedFeeRecipients, ...global.buybackFeeRecipients]) addresses.set(key.toBase58(), key);
  return [...addresses.values()];
}
