import type { PayoutPlan } from "./payout-plan";

export type PaymentTransaction = {
  prepared: string; signed: string | null; signature: string | null; lastValidBlockHeight: number;
  requestId?: string; minimumOutput?: string;
  outcome?: "failed" | "expired";
};
export type PayoutExecution = {
  planId: string; source: string; mint: string; decimals: number;
  status: "running" | "paused" | "completed";
  startedBy: string; startedAt: string; completedAt: string | null;
  error: string | null; nextAt: number; batch: number;
  failedAttempts?: { signature: string | null; outcome: "failed" | "expired"; batch: number; wallet: string | null }[];
  batches: {
    swap: PaymentTransaction | null; output: string | null;
    payments: { wallet: string; amount: string; confirmed: boolean }[];
    /** Winner payments sent together: each transaction carries up to TRANSFERS_PER_TX of them, one wallet approval. */
    transfers: { payments: number[]; tx: PaymentTransaction | null; confirmed: boolean }[];
    completedAt: string | null;
  }[];
};
/** Winner transfers per transaction: 8 measure 1,024 bytes of Solana's 1,232, with each recipient's token account created if missing. */
export const TRANSFERS_PER_TX = 8;

export type TransactionResult = { status: "pending" | "confirmed" | "failed" | "expired"; output?: string };
export interface PayoutAdapter {
  validate(plan: PayoutPlan): Promise<{ decimals: number }>;
  prepareSwap(plan: PayoutPlan, lamports: string, remaining: string): Promise<PaymentTransaction>;
  /** One transaction paying every listed winner. */
  prepareTransfer(plan: PayoutPlan, payments: { wallet: string; amount: string }[]): Promise<PaymentTransaction>;
  inspect(plan: PayoutPlan, tx: PaymentTransaction, swap: boolean): Promise<TransactionResult>;
  submit(tx: PaymentTransaction, swap: boolean): Promise<void>;
  /**
   * Proves a signed transfer pays exactly these winners and nothing else, by simulating it: a wallet
   * may have added instructions before signing (pump-verification.ts, verifySignedPayout).
   */
  verifyTransfer?(plan: PayoutPlan, tx: import("@solana/web3.js").VersionedTransaction, payments: { wallet: string; amount: string }[]): Promise<void>;
}

/** Cumulative integer allocation conserves every output unit, even for tiny batches. */
export function splitOutput(output: string, winners: PayoutPlan["winners"]) {
  const total = winners.reduce((sum, w) => sum + BigInt(w.lamports), 0n);
  if (total <= 0n || BigInt(output) <= 0n) throw new Error("Invalid payout allocation.");
  let cumulative = 0n; let assigned = 0n;
  return winners.map((winner) => {
    cumulative += BigInt(winner.lamports);
    const end = BigInt(output) * cumulative / total;
    const amount = end - assigned; assigned = end;
    return { wallet: winner.wallet, amount: amount.toString(), confirmed: amount === 0n };
  });
}

/** The payments still owed, grouped into transactions of up to TRANSFERS_PER_TX. */
export function groupTransfers(payments: PayoutExecution["batches"][number]["payments"]) {
  const owed = payments.flatMap((payment, i) => payment.confirmed ? [] : [i]);
  const transfers: PayoutExecution["batches"][number]["transfers"] = [];
  for (let i = 0; i < owed.length; i += TRANSFERS_PER_TX) transfers.push({ payments: owed.slice(i, i + TRANSFERS_PER_TX), tx: null, confirmed: false });
  return transfers;
}

/** One durable step. Always persist signed bytes BEFORE any external submission. */
export async function advancePayout(plan: PayoutPlan, run: PayoutExecution, adapter: PayoutAdapter,
  save: (run: PayoutExecution) => void, now = Date.now(), jitter = () => Math.floor(Math.random() * 15_001), allowPrepare = false) {
  if (run.status !== "running" || now < run.nextAt) return;
  const batch = run.batches[run.batch];
  if (!batch) throw new Error("Invalid payout batch.");
  // A held-$GAMINE payout starts with its output known (startExecution), so it never swaps.
  if (batch.output === null && !batch.swap) {
    if (!allowPrepare) return;
    batch.swap = await adapter.prepareSwap(plan, plan.batchLamports[run.batch]!, plan.batchLamports.slice(run.batch).reduce((sum, n) => sum + BigInt(n), 0n).toString());
    save(run);
    return;
  }
  if (batch.output === null) {
    const swap = batch.swap!;
    if (!swap.signed) return;
    const result = await adapter.inspect(plan, swap, true);
    if (result.status === "pending") { await adapter.submit(swap, true); return; }
    if (result.status !== "confirmed") {
      swap.outcome = result.status;
      (run.failedAttempts ??= []).push({ signature: swap.signature, outcome: result.status, batch: run.batch, wallet: null });
      run.status = "paused"; run.error = "Swap failed or expired without confirmation. Review and resume to retry this batch.";
      save(run); return;
    }
    if (!result.output || BigInt(result.output) <= 0n) throw new Error("Confirmed swap output could not be verified.");
    batch.output = result.output; batch.payments = splitOutput(result.output, plan.winners); batch.transfers = groupTransfers(batch.payments); save(run); return;
  }
  const transfer = batch.transfers.find(t => !t.confirmed);
  if (transfer) {
    const payments = transfer.payments.map(i => batch.payments[i]!);
    if (!transfer.tx) {
      if (!allowPrepare) return;
      transfer.tx = await adapter.prepareTransfer(plan, payments.map(({ wallet, amount }) => ({ wallet, amount })));
      save(run); return;
    }
    if (!transfer.tx.signed) return;
    const result = await adapter.inspect(plan, transfer.tx, false);
    if (result.status === "pending") { await adapter.submit(transfer.tx, false); return; }
    if (result.status !== "confirmed") {
      transfer.tx.outcome = result.status;
      (run.failedAttempts ??= []).push({ signature: transfer.tx.signature, outcome: result.status, batch: run.batch, wallet: payments.map(p => p.wallet).join(", ") });
      run.status = "paused"; run.error = "A transfer failed or expired. Review and resume; nothing it carried was paid, and the confirmed swap will not be repeated.";
      save(run); return;
    }
    // One transaction: its transfers all landed together, or none did.
    transfer.confirmed = true; for (const payment of payments) payment.confirmed = true;
    save(run); return;
  }
  batch.completedAt = new Date(now).toISOString();
  if (run.batch + 1 === run.batches.length) {
    run.status = "completed"; run.completedAt = new Date(now).toISOString();
  } else { run.batch++; run.nextAt = now + plan.delaySeconds * 1000 + jitter(); }
  save(run);
}

export function awaitingSignature(run: PayoutExecution) {
  const batch = run.batches[run.batch];
  if (!batch || run.status !== "running") return null;
  if (batch.output === null) return batch.swap && !batch.swap.signed ? { tx: batch.swap, swap: true } : null;
  const transfer = batch.transfers.find(t => !t.confirmed);
  return transfer?.tx && !transfer.tx.signed ? { tx: transfer.tx, swap: false, payments: transfer.payments.map(i => batch.payments[i]!) } : null;
}

/** Only proven on-chain failures/expiry may receive new transaction bytes. */
export function resumeExecution(run: PayoutExecution) {
  if (run.status === "completed") return;
  const batch = run.batches[run.batch]!;
  if (!batch.output && batch.swap?.outcome) batch.swap = null;
  for (const transfer of batch.transfers) if (!transfer.confirmed && transfer.tx?.outcome) transfer.tx = null;
  run.status = "running"; run.error = null;
}

/** Signed bytes stay server-side; the admin sees progress and public signatures. */
export function executionView(run: PayoutExecution) {
  const publicTx = (tx: PaymentTransaction | null) => tx ? { signature: tx.signature, outcome: tx.outcome ?? null } : null;
  return { ...run, batches: run.batches.map(batch => ({ ...batch, swap: publicTx(batch.swap),
    transfers: batch.transfers.map(transfer => ({ ...transfer, tx: publicTx(transfer.tx) })) })) };
}
export type PayoutExecutionView = ReturnType<typeof executionView>;
