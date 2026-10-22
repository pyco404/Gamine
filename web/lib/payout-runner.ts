import bs58 from "bs58";
import { PayoutStore } from "./payout-store";
import { ExecutionStore } from "./payout-execution-store";
import { advancePayout, awaitingSignature, executionView, groupTransfers, splitOutput, type PayoutAdapter, type PayoutExecution } from "./payout-execution";
import { executionConfig, walletPayoutAdapter } from "./payout-adapter";
import { verifySignedLaunch, verifySignedPayout } from "./pump-verification";

export async function startExecution(id: string, owner: string, adapter: PayoutAdapter = walletPayoutAdapter(), store = new ExecutionStore()) {
  const plan = new PayoutStore(store.db).get(id);
  if (!plan || plan.status !== "approved" || !plan.agpMint) throw new Error("Approve a payout plan first.");
  const existing = store.get(id);
  if (existing) return executionView(existing);
  const { decimals } = await adapter.validate(plan);
  const run: PayoutExecution = { planId: id, source: plan.source, mint: plan.agpMint, decimals,
    status: "running", startedBy: owner, startedAt: new Date().toISOString(), completedAt: null,
    error: null, nextAt: 0, batch: 0,
    // $GAMINE already held needs no swap: its one batch is the allocation itself, split as approved.
    batches: plan.funding === "held"
      ? [(() => { const payments = splitOutput(plan.allocatedLamports, plan.winners); return { swap: null, output: plan.allocatedLamports, payments, transfers: groupTransfers(payments), completedAt: null }; })()]
      : plan.batchLamports.map(() => ({ swap: null, output: null, payments: [], transfers: [], completedAt: null })) };
  // Unique source and plan constraints prevent concurrent spending plans.
  try { store.insert(run); }
  catch { const same = store.get(id); if (same) return executionView(same); throw new Error("This reward wallet already has an unfinished payout. Finish or resume it first."); }
  return executionView(run);
}

export async function payoutStep(id: string, allowPrepare = false, signed?: string, adapter: PayoutAdapter = walletPayoutAdapter(), store = new ExecutionStore()) {
  const lease = store.claim(id);
  if (!lease) throw new Error("A payout step is already running, or this payout is paused.");
  try {
    const plan = new PayoutStore(store.db).get(id)!;
    const run = store.get(id)!;
    if (!plan || plan.agpMint !== run.mint || plan.source !== run.source) throw new Error("Payout plan identity changed.");
    if (signed) {
      const pending = awaitingSignature(run);
      if (!pending) throw new Error("No payout transaction is waiting for a signature. Refresh progress.");
      // A swap is submitted to Jupiter exactly as it built it; a transfer may carry what the wallet added, proved by simulation.
      const tx = pending.swap ? verifySignedLaunch(pending.tx.prepared, signed) : verifySignedPayout(pending.tx.prepared, signed);
      if (tx.message.header.numRequiredSignatures !== 1 || tx.message.staticAccountKeys[0]!.toBase58() !== run.source) throw new Error("Only the reward wallet may sign this payout.");
      if (!pending.swap && "payments" in pending && adapter.verifyTransfer) await adapter.verifyTransfer(plan, tx, pending.payments!);
      pending.tx.signed = signed; pending.tx.signature = bs58.encode(tx.signatures[0]!);
      store.save(run, lease);
      // No external submission can happen until the signature and bytes are durable.
      try { await adapter.submit(pending.tx, pending.swap); }
      catch { run.error = "Submission is pending verification. The original transaction is saved; check progress or resume without signing another payment."; store.save(run, lease); }
    } else {
      // An unsigned transaction is safe to rebuild only after its blockhash expires.
      const pending = awaitingSignature(run);
      if (pending && allowPrepare && "connection" in adapter) {
        const rpc = adapter as ReturnType<typeof walletPayoutAdapter>;
        if (await rpc.connection.getBlockHeight("confirmed") > pending.tx.lastValidBlockHeight) {
          const batch = run.batches[run.batch]!;
          if (pending.swap) batch.swap = null;
          else batch.transfers.find(t => t.tx === pending.tx)!.tx = null;
          store.save(run, lease);
        }
      }
      await advancePayout(plan, run, adapter, value => store.save(value, lease), Date.now(), undefined, allowPrepare);
    }
    const next = awaitingSignature(run);
    return { execution: executionView(run), transaction: next ? { prepared: next.tx.prepared, swap: next.swap, source: run.source } : null };
  } catch (error) {
    // Never expose provider bodies, RPC URLs, signed bytes or credentials in errors.
    const run = store.get(id);
    if (run && !signed) { run.status = "paused"; run.error = error instanceof Error && error.message.startsWith("Payout") ? error.message : "Payout step could not be verified. Review the configuration, wallet balance and transaction history, then resume."; store.save(run, lease); }
    throw error;
  } finally { store.release(id, lease); }
}

let started = false; let busy = false;
export function startPayoutWorker() {
  if (started || !executionConfig().ready) return;
  started = true;
  const pass = async () => {
    if (busy || !executionConfig().ready) return;
    busy = true;
    try {
      const store = new ExecutionStore();
      for (const id of store.due()) {
        try { await payoutStep(id, false, undefined, walletPayoutAdapter(), store); }
        catch { /* Durable state retains every transaction; admins can resume. */ }
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => void pass().catch(() => console.error("Payout confirmation worker unavailable")), 5_000);
  timer.unref();
}
