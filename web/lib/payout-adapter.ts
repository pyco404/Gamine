import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { AccountLayout, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ExtensionType, getExtensionTypes,
  unpackMint, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { solToLamports } from "./launchpad-validation";
import { AGENT_REWARDS_WALLET, feeWalletsReady } from "./launchpad-fees";
import type { PayoutPlan } from "./payout-plan";
import type { PaymentTransaction, PayoutAdapter, TransactionResult } from "./payout-execution";

const SOL = "So11111111111111111111111111111111111111112";
const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const JUPITER = "https://api.jup.ag/swap/v2";
const integer = (value: unknown) => typeof value === "string" && /^\d+$/.test(value);
/**
 * Paying $GAMINE already held in a reward wallet needs only these; swapping SOL into $GAMINE during a
 * payout also needs JUPITER_API_KEY (`swaps`).
 */
export function executionConfig() {
  const missing = ["PUMP_RPC_URL", "PAYOUT_AGP_MINT"].filter(name => !process.env[name]);
  if (!feeWalletsReady()) missing.push("valid, distinct PUMP_PLATFORM_WALLET and PUMP_AGENT_REWARDS_WALLET");
  if (process.env.PAYOUT_EXECUTION_ENABLED !== "true") missing.push("PAYOUT_EXECUTION_ENABLED=true");
  if (process.env.NODE_ENV === "production" && (!process.env.PUMP_LAUNCH_DB_PATH || process.env.PUMP_LAUNCH_DB_PATH === ":memory:")) missing.push("persistent PUMP_LAUNCH_DB_PATH");
  return { ready: !missing.length, missing, swaps: !!process.env.JUPITER_API_KEY };
}
/** The $GAMINE mint's decimals, to plan a held payout in its base units. */
export async function agpDecimals(): Promise<number> {
  if (!process.env.PUMP_RPC_URL || !process.env.PAYOUT_AGP_MINT) throw new Error("Payout needs PUMP_RPC_URL and PAYOUT_AGP_MINT to plan held $GAMINE.");
  const connection = new Connection(process.env.PUMP_RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) });
  const mint = new PublicKey(process.env.PAYOUT_AGP_MINT); const account = await connection.getAccountInfo(mint);
  if (!account || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner.toBase58())) throw new Error("Payout mint is not a token mint.");
  return unpackMint(mint, account, account.owner).decimals;
}
const SWAPS_OFF = "Payout swaps need JUPITER_API_KEY. Buy $GAMINE into the reward wallet and pay it as held $GAMINE instead.";

export function verifySwapOrder(order: Record<string, unknown>, plan: PayoutPlan, amount: string, maxImpactBps: number) {
  const impact = typeof order.priceImpact === "number" ? order.priceImpact / 100
    : typeof order.priceImpactPct === "string" ? Number(order.priceImpactPct) : NaN;
  if (order.inputMint !== SOL || order.outputMint !== plan.agpMint || order.inAmount !== amount || order.taker !== plan.source
    || order.swapMode !== "ExactIn" || order.slippageBps !== plan.slippageBps || order.router === "jupiterz"
    || !Number.isFinite(impact) || Math.abs(impact) * 10_000 > maxImpactBps
    || !integer(order.outAmount) || !integer(order.otherAmountThreshold) || BigInt(order.otherAmountThreshold as string) <= 0n
    || BigInt(order.otherAmountThreshold as string) > BigInt(order.outAmount as string)
    || BigInt(order.otherAmountThreshold as string) < BigInt(order.outAmount as string) * BigInt(10_000 - plan.slippageBps) / 10_000n
    || typeof order.transaction !== "string" || !order.transaction || typeof order.requestId !== "string" || !order.requestId
    || !Number.isSafeInteger(Number(order.lastValidBlockHeight)) || Number(order.lastValidBlockHeight) <= 0) {
    throw new Error("The swap quote exceeds the approved limits or cannot be verified.");
  }
}

/** Wallet-signed transactions only. No private keys or server signer. */
export function walletPayoutAdapter(): PayoutAdapter & { connection: Connection } {
  if (!executionConfig().ready) throw new Error("Payout execution is not configured.");
  const connection = new Connection(process.env.PUMP_RPC_URL!, { commitment: "finalized", disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) });
  const reserve = BigInt(solToLamports(process.env.PAYOUT_FEE_RESERVE_SOL ?? "0.05"));
  const maxFee = BigInt(solToLamports(process.env.PAYOUT_MAX_TX_COST_SOL ?? "0.01"));
  const impactBps = Number(process.env.PAYOUT_MAX_PRICE_IMPACT_BPS ?? "200");
  if (reserve <= 0n || maxFee <= 0n || !Number.isInteger(impactBps) || impactBps < 1 || impactBps > 500) throw new Error("Invalid payout execution limits.");
  let verifiedNetwork = false;
  async function network() {
    if (!verifiedNetwork) {
      if (await connection.getGenesisHash() !== MAINNET) throw new Error("Payouts require a mainnet RPC.");
      verifiedNetwork = true;
    }
  }
  async function mintInfo(plan: PayoutPlan) {
    await network();
    if (plan.status !== "approved" || !plan.agpMint || plan.agpMint !== process.env.PAYOUT_AGP_MINT || BigInt(plan.platformLamports) !== 0n
      || plan.source !== AGENT_REWARDS_WALLET) throw new Error("Payout plan no longer matches the configured reward wallet or mint.");
    const mint = new PublicKey(plan.agpMint); const account = await connection.getAccountInfo(mint);
    if (!account || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner.toBase58())) throw new Error("Invalid payout token mint.");
    const info = unpackMint(mint, account, account.owner);
    if (!info.isInitialized || info.decimals > 9 || getExtensionTypes(info.tlvData).some(type => ![ExtensionType.MetadataPointer, ExtensionType.TokenMetadata].includes(type))) {
      throw new Error("Payouts support standard tokens without transfer fees, transfer hooks or confidential transfers.");
    }
    return { mint, program: account.owner, decimals: info.decimals };
  }
  async function enough(source: string, required: bigint) {
    const balance = BigInt(await connection.getBalance(new PublicKey(source)));
    if (balance < required + reserve) throw new Error("The reward wallet needs the remaining payout allocation, retained SOL and fee reserve.");
  }
  /** The reward wallet's $GAMINE, in base units. */
  async function held(plan: PayoutPlan, info: Awaited<ReturnType<typeof mintInfo>>) {
    const account = await connection.getAccountInfo(getAssociatedTokenAddressSync(info.mint, new PublicKey(plan.source), false, info.program));
    return account ? AccountLayout.decode(account.data).amount : 0n;
  }
  /** `recipients`: the SOL cost limit is per transfer, so a transaction paying eight may cost up to eight times one. */
  async function simulate(tx: VersionedTransaction, source: string, ata?: PublicKey, input?: bigint, output?: bigint, recipients = 1) {
    if (tx.message.header.numRequiredSignatures !== 1 || tx.message.staticAccountKeys[0]!.toBase58() !== source) throw new Error("The payout requires exactly the reward wallet's signature.");
    const addresses = [source, ...(ata ? [ata.toBase58()] : [])];
    const before = await connection.getMultipleAccountsInfo(addresses.map(a => new PublicKey(a)));
    const result = await connection.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed", accounts: { encoding: "base64", addresses } });
    if (result.value.err || !result.value.accounts?.[0]) throw new Error("The payout transaction failed simulation.");
    const cost = BigInt(before[0]?.lamports ?? 0) - BigInt(result.value.accounts[0].lamports);
    if (cost < 0n || cost > (input ?? 0n) + maxFee * BigInt(recipients)) throw new Error("The transaction's SOL cost exceeds the payout limit.");
    if (ata && output !== undefined) {
      const after = result.value.accounts[1];
      if (!after) throw new Error("The swap output account could not be verified.");
      const old = before[1] ? AccountLayout.decode(before[1].data).amount : 0n;
      const received = AccountLayout.decode(Buffer.from(after.data[0], "base64")).amount - old;
      if (received < output) throw new Error("The simulated swap output is below the approved minimum.");
    }
  }
  const prepared = (tx: VersionedTransaction, height: number): PaymentTransaction => ({
    prepared: Buffer.from(tx.serialize()).toString("base64"), signed: null, signature: null, lastValidBlockHeight: height,
  });
  return {
    connection,
    async validate(plan) {
      const info = await mintInfo(plan);
      if (plan.funding === "held") {
        // Amounts were planned in this mint's units; network fees and recipients' token accounts take SOL.
        if (plan.decimals !== info.decimals) throw new Error("Payout plan decimals no longer match the $GAMINE mint.");
        if (await held(plan, info) < BigInt(plan.allocatedLamports)) throw new Error("Payout wallet holds less $GAMINE than this plan pays. Buy more into the reward wallet, or preview a smaller payout.");
        await enough(plan.source, 0n);
      } else {
        if (!process.env.JUPITER_API_KEY) throw new Error(SWAPS_OFF);
        await enough(plan.source, BigInt(plan.budgetLamports));
      }
      return { decimals: info.decimals };
    },
    async prepareSwap(plan, lamports, remaining) {
      if (plan.funding === "held" || !process.env.JUPITER_API_KEY) throw new Error(SWAPS_OFF);
      const info = await mintInfo(plan);
      // Preserve all carryover, including the selected unpaid percentage and capped shares.
      await enough(plan.source, BigInt(remaining) + BigInt(plan.carryoverLamports));
      const params = new URLSearchParams({ inputMint: SOL, outputMint: plan.agpMint!, amount: lamports, taker: plan.source,
        slippageBps: String(plan.slippageBps), swapMode: "ExactIn", excludeRouters: "jupiterz" });
      const res = await fetch(`${JUPITER}/order?${params}`, { headers: { "x-api-key": process.env.JUPITER_API_KEY! }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!res.ok) throw new Error("Jupiter could not prepare this swap. Retry with a smaller batch if liquidity is limited.");
      const order = await res.json() as Record<string, unknown>;
      verifySwapOrder(order, plan, lamports, impactBps);
      const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction as string, "base64"));
      await simulate(tx, plan.source, getAssociatedTokenAddressSync(info.mint, new PublicKey(plan.source), false, info.program), BigInt(lamports), BigInt(order.otherAmountThreshold as string));
      return { ...prepared(tx, Number(order.lastValidBlockHeight)), requestId: order.requestId as string, minimumOutput: order.otherAmountThreshold as string };
    },
    async prepareTransfer(plan, payments) {
      if (!payments.length) throw new Error("Payout transfer has no recipients.");
      const info = await mintInfo(plan); const source = new PublicKey(plan.source);
      const from = getAssociatedTokenAddressSync(info.mint, source, false, info.program);
      // Each recipient's token account is created only if missing (idempotent), then paid.
      const instructions = payments.flatMap(({ wallet, amount }) => {
        const recipient = new PublicKey(wallet); const to = getAssociatedTokenAddressSync(info.mint, recipient, false, info.program);
        return [createAssociatedTokenAccountIdempotentInstruction(source, to, recipient, info.mint, info.program),
          createTransferCheckedInstruction(from, info.mint, to, source, BigInt(amount), info.decimals, [], info.program)];
      });
      const block = await connection.getLatestBlockhash("confirmed");
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: source, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
      // A held payout's carryover is $GAMINE, not SOL; the wallet needs only its fee reserve.
      await enough(plan.source, plan.funding === "held" ? 0n : BigInt(plan.carryoverLamports));
      await simulate(tx, plan.source, undefined, undefined, undefined, payments.length);
      return prepared(tx, block.lastValidBlockHeight);
    },
    async verifyTransfer(plan, tx, payments) {
      const info = await mintInfo(plan); const source = new PublicKey(plan.source);
      const from = getAssociatedTokenAddressSync(info.mint, source, false, info.program);
      const to = payments.map(({ wallet }) => getAssociatedTokenAddressSync(info.mint, new PublicKey(wallet), false, info.program));
      const addresses = [source, from, ...to];
      const before = await connection.getMultipleAccountsInfo(addresses);
      const result = await connection.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed", accounts: { encoding: "base64", addresses: addresses.map(a => a.toBase58()) } });
      if (result.value.err || !result.value.accounts) throw new Error("Payout transfer failed simulation. Approve it again.");
      const after = result.value.accounts;
      const tokens = (i: number, data: Buffer | null | undefined) => data ? AccountLayout.decode(data).amount : 0n;
      const paid = (i: number) => tokens(i, after[i] ? Buffer.from(after[i]!.data[0], "base64") : null) - tokens(i, before[i]?.data);
      // Exactly the planned amounts move: out of the reward wallet, into each winner's account, and nowhere else.
      const total = payments.reduce((sum, p) => sum + BigInt(p.amount), 0n);
      if (-paid(1) !== total || payments.some((p, i) => paid(i + 2) !== BigInt(p.amount))) throw new Error("Payout transfer does not pay exactly the planned winners. Approve it again.");
      const cost = BigInt(before[0]?.lamports ?? 0) - BigInt(after[0]?.lamports ?? 0);
      if (cost < 0n || cost > maxFee * BigInt(payments.length)) throw new Error("Payout transfer costs more SOL than the payout limit.");
    },
    async inspect(plan, tx, swap): Promise<TransactionResult> {
      await network();
      if (!tx.signature) return { status: "pending" };
      const status = (await connection.getSignatureStatuses([tx.signature], { searchTransactionHistory: true })).value[0];
      if (status?.confirmationStatus === "finalized") {
        if (status.err) return { status: "failed" };
        const receipt = await connection.getTransaction(tx.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
        if (!receipt?.meta || receipt.meta.err) throw new Error("The finalized payout receipt is unavailable.");
        const actual = VersionedTransaction.deserialize(Buffer.from(tx.signed!, "base64"));
        if (!Buffer.from(actual.message.serialize()).equals(Buffer.from(receipt.transaction.message.serialize()))) throw new Error("The payout receipt does not match its signed transaction.");
        if (!swap) return { status: "confirmed" };
        const amount = (balances: typeof receipt.meta.preTokenBalances) => (balances ?? [])
          .filter(b => b.owner === plan.source && b.mint === plan.agpMint).reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
        const output = amount(receipt.meta.postTokenBalances) - amount(receipt.meta.preTokenBalances);
        if (output <= 0n || output < BigInt(tx.minimumOutput!)) throw new Error("The confirmed swap output is below its minimum.");
        return { status: "confirmed", output: output.toString() };
      }
      if (!status && await connection.getBlockHeight("finalized") > tx.lastValidBlockHeight) return { status: "expired" };
      return { status: "pending" };
    },
    async submit(tx, swap) {
      if (!tx.signed || !tx.signature) throw new Error("Approve this transaction in the reward wallet first.");
      await network();
      if (await connection.getBlockHeight("confirmed") > tx.lastValidBlockHeight) return;
      if (swap) {
        const res = await fetch(`${JUPITER}/execute`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.JUPITER_API_KEY! },
          body: JSON.stringify({ signedTransaction: tx.signed, requestId: tx.requestId, lastValidBlockHeight: tx.lastValidBlockHeight }), signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error("Swap submission is uncertain. Check the saved transaction before retrying.");
        // API success is never completion; inspect the original signature on-chain.
      } else await connection.sendRawTransaction(Buffer.from(tx.signed, "base64"), { skipPreflight: false, maxRetries: 0 });
    },
  };
}
