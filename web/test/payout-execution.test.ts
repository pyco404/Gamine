import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputeBudgetProgram, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { LaunchStore } from "../lib/launchpad-store";
import { PayoutStore } from "../lib/payout-store";
import { buildHeldPayoutPlan, buildPayoutPlan } from "../lib/payout-plan";
import { ExecutionStore } from "../lib/payout-execution-store";
import { advancePayout, awaitingSignature, groupTransfers, resumeExecution, splitOutput, TRANSFERS_PER_TX, type PayoutAdapter, type PaymentTransaction } from "../lib/payout-execution";
import { payoutStep, startExecution } from "../lib/payout-runner";
import { verifySwapOrder } from "../lib/payout-adapter";
import { verifySignedPayout } from "../lib/pump-verification";

afterEach(() => vi.restoreAllMocks());
function setup() {
  const source = Keypair.generate(); const launches = new LaunchStore(":memory:");
  const plans = new PayoutStore(launches.db); const store = new ExecutionStore(launches.db);
  const plan = buildPayoutPlan({ kind: "daily", period: "2026-10-05", budgetSol: "1", rewardPercent: "80", batchSol: "0.08", delaySeconds: 60, slippageBps: 50 },
    [1, 2].map(n => ({ agentId: `a${n}`, name: `Winner ${n}`, wallet: Keypair.generate().publicKey.toBase58(), share: 0.1 })), source.publicKey.toBase58(), "platform", "admin");
  plan.agpMint = Keypair.generate().publicKey.toBase58(); plans.insert(plan); const approved = plans.approve(plan.id, "admin");
  const tx = (): PaymentTransaction => {
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: source.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: source.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message());
    return { prepared: Buffer.from(transaction.serialize()).toString("base64"), signed: null, signature: null, lastValidBlockHeight: 100 };
  };
  const adapter: PayoutAdapter = { validate: vi.fn(async () => ({ decimals: 6 })), prepareSwap: vi.fn(async () => tx()), prepareTransfer: vi.fn(async () => tx()),
    inspect: vi.fn(async () => ({ status: "pending" as const })), submit: vi.fn(async () => {}) };
  const sign = (prepared: string) => { const t = VersionedTransaction.deserialize(Buffer.from(prepared, "base64")); t.sign([source]); return Buffer.from(t.serialize()).toString("base64"); };
  return { source, launches, plans, store, plan: approved, adapter, sign };
}

describe("wallet-approved payout execution (no real funds)", () => {
  it("never submits without a wallet signature and saves signed bytes before uncertain submission", async () => {
    const s = setup();
    try {
      await startExecution(s.plan.id, "admin", s.adapter, s.store);
      const step = await payoutStep(s.plan.id, true, undefined, s.adapter, s.store);
      expect(step.transaction).not.toBeNull(); expect(s.adapter.submit).not.toHaveBeenCalled();
      s.adapter.submit = vi.fn(async tx => {
        expect(s.store.get(s.plan.id)!.batches[0]!.swap?.signed).toBe(tx.signed);
        expect(s.store.get(s.plan.id)!.batches[0]!.swap?.signature).toBe(tx.signature);
        throw new Error("network timeout");
      });
      const signed = s.sign(step.transaction!.prepared);
      await payoutStep(s.plan.id, false, signed, s.adapter, s.store);
      // A restart checks/rebroadcasts the same bytes, never prepares a replacement buy.
      s.adapter.submit = vi.fn(async () => {});
      await payoutStep(s.plan.id, false, undefined, s.adapter, new ExecutionStore(s.launches.db));
      expect(s.adapter.prepareSwap).toHaveBeenCalledTimes(1);
      expect(s.adapter.submit).toHaveBeenCalledWith(expect.objectContaining({ signed }), true);
      expect(s.store.paidUnits(s.plan.agpMint!)).toBe(0n);
      expect(JSON.stringify(s.store.views())).not.toContain(signed);
    } finally { s.launches.db.close(); }
  });
  it("rejects changed transactions and signatures from another wallet without broadcasting", async () => {
    const s = setup();
    try {
      await startExecution(s.plan.id, "admin", s.adapter, s.store);
      const step = await payoutStep(s.plan.id, true, undefined, s.adapter, s.store);
      const wrong = VersionedTransaction.deserialize(Buffer.from(step.transaction!.prepared, "base64"));
      wrong.message.recentBlockhash = Keypair.generate().publicKey.toBase58(); wrong.sign([s.source]);
      await expect(payoutStep(s.plan.id, false, Buffer.from(wrong.serialize()).toString("base64"), s.adapter, s.store)).rejects.toThrow("changed");
      const unsigned = VersionedTransaction.deserialize(Buffer.from(step.transaction!.prepared, "base64"));
      unsigned.signatures[0] = Keypair.generate().secretKey;
      await expect(payoutStep(s.plan.id, false, Buffer.from(unsigned.serialize()).toString("base64"), s.adapter, s.store)).rejects.toThrow("signature");
      expect(s.adapter.submit).not.toHaveBeenCalled();
    } finally { s.launches.db.close(); }
  });
  it("confirms actual output, pays each winner, and delays the next batch until all transfers finish", async () => {
    const s = setup();
    try {
      await startExecution(s.plan.id, "admin", s.adapter, s.store);
      let step = await payoutStep(s.plan.id, true, undefined, s.adapter, s.store);
      await payoutStep(s.plan.id, false, s.sign(step.transaction!.prepared), s.adapter, s.store);
      s.adapter.inspect = vi.fn(async (_plan, _tx, swap) => ({ status: "confirmed" as const, ...(swap ? { output: "101" } : {}) }));
      await payoutStep(s.plan.id, false, undefined, s.adapter, s.store);
      expect(s.store.get(s.plan.id)!.batches[0]!.payments.map(p => p.amount)).toEqual(["50", "51"]);
      expect(s.store.paidUnits(s.plan.agpMint!)).toBe(0n);
      // Both winners in one transaction: one wallet approval.
      step = await payoutStep(s.plan.id, true, undefined, s.adapter, s.store);
      expect(s.adapter.prepareTransfer).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ amount: "50" }), expect.objectContaining({ amount: "51" })]);
      await payoutStep(s.plan.id, false, s.sign(step.transaction!.prepared), s.adapter, s.store);
      await payoutStep(s.plan.id, false, undefined, s.adapter, s.store);
      expect(s.store.paidUnits(s.plan.agpMint!)).toBe(101n);
      await payoutStep(s.plan.id, false, undefined, s.adapter, s.store);
      const run = s.store.get(s.plan.id)!;
      expect(run.batch).toBe(1); expect(run.nextAt).toBeGreaterThanOrEqual(Date.now() + 59_000);
      await payoutStep(s.plan.id, true, undefined, s.adapter, s.store);
      expect(s.adapter.prepareSwap).toHaveBeenCalledTimes(1);
      run.nextAt = 0; const lease = s.store.claim(s.plan.id)!; s.store.save(run, lease); s.store.release(s.plan.id, lease);
      await payoutStep(s.plan.id, true, undefined, s.adapter, s.store);
      expect(s.adapter.prepareSwap).toHaveBeenCalledTimes(2);
      expect(s.plan.platformLamports).toBe("0"); expect(s.plan.carryoverLamports).toBe("840000000");
    } finally { s.launches.db.close(); }
  });
  it("resumes a failed transfer without repeating the confirmed swap", async () => {
    const s = setup();
    try {
      await startExecution(s.plan.id, "admin", s.adapter, s.store);
      let run = s.store.get(s.plan.id)!;
      run.batches[0]!.output = "100"; run.batches[0]!.swap = { prepared: "p", signed: "saved-swap", signature: "swap", lastValidBlockHeight: 1 };
      run.batches[0]!.payments = [{ wallet: s.plan.winners[0]!.wallet, amount: "100", confirmed: false }];
      run.batches[0]!.transfers = [{ payments: [0], confirmed: false, tx: { prepared: "p", signed: "saved-transfer", signature: "transfer", lastValidBlockHeight: 1 } }];
      s.adapter.inspect = vi.fn(async () => ({ status: "expired" as const }));
      await advancePayout(s.plan, run, s.adapter, () => {});
      expect(run.status).toBe("paused"); resumeExecution(run);
      expect(run.batches[0]!.swap?.signed).toBe("saved-swap"); expect(run.batches[0]!.transfers[0]!.tx).toBeNull();
      await advancePayout(s.plan, run, s.adapter, () => {}, Date.now(), undefined, true);
      expect(s.adapter.prepareSwap).not.toHaveBeenCalled(); expect(s.adapter.prepareTransfer).toHaveBeenCalledOnce();
    } finally { s.launches.db.close(); }
  });
  it("prevents simultaneous plans spending one wallet and fences concurrent workers", async () => {
    const s = setup();
    try {
      await startExecution(s.plan.id, "admin", s.adapter, s.store);
      const second = { ...s.plan, id: crypto.randomUUID(), period: "2026-10-04" }; s.plans.insert(second);
      await expect(startExecution(second.id, "admin", s.adapter, s.store)).rejects.toThrow("unfinished payout");
      const lease = s.store.claim(s.plan.id)!; expect(s.store.claim(s.plan.id)).toBeNull();
      expect(() => s.store.control(s.plan.id, "pause")).toThrow("in progress");
      expect(() => s.store.save(s.store.get(s.plan.id)!, "wrong-worker")).toThrow("lease");
      s.store.release(s.plan.id, lease); expect(s.store.control(s.plan.id, "pause").status).toBe("paused");
      expect(s.store.claim(s.plan.id)).toBeNull(); expect(s.store.control(s.plan.id, "resume").status).toBe("running");
    } finally { s.launches.db.close(); }
  });
  it("conserves small output allocations", () => {
    const s = setup();
    try { for (let amount = 1; amount < 30; amount++) expect(splitOutput(String(amount), s.plan.winners).reduce((sum, p) => sum + BigInt(p.amount), 0n)).toBe(BigInt(amount)); }
    finally { s.launches.db.close(); }
  });
  it("rejects quotes with another mint, amount, taker, slippage or excessive impact", () => {
    const s = setup();
    try {
      const quote = { inputMint: "So11111111111111111111111111111111111111112", outputMint: s.plan.agpMint, inAmount: "80000000", taker: s.plan.source,
        swapMode: "ExactIn", slippageBps: 50, router: "metis", priceImpact: -1, outAmount: "1000", otherAmountThreshold: "995", transaction: "tx", requestId: "request", lastValidBlockHeight: "100" };
      expect(() => verifySwapOrder(quote, s.plan, "80000000", 200)).not.toThrow();
      for (const patch of [{ outputMint: "other" }, { inAmount: "90000000" }, { taker: "other" }, { slippageBps: 500 }, { priceImpact: -3 }, { otherAmountThreshold: "994" }, { router: "jupiterz" }])
        expect(() => verifySwapOrder({ ...quote, ...patch }, s.plan, "80000000", 200)).toThrow("limits");
    } finally { s.launches.db.close(); }
  });
  it("pays held $GAMINE to each winner without ever preparing a swap", async () => {
    const s = setup();
    try {
      const held = buildHeldPayoutPlan({ kind: "weekly", period: "2026-10-05", budgetAgp: "1000", rewardPercent: "50" }, 6,
        s.plan.winners.map(({ lamports: _, ...winner }) => winner), s.plan.source, "platform", "admin");
      held.agpMint = s.plan.agpMint; s.plans.insert(held); s.plans.approve(held.id, "admin");
      // The same reward wallet: let the earlier swap plan finish first.
      s.launches.db.prepare("DELETE FROM payout_execution").run();
      const run = await startExecution(held.id, "admin", s.adapter, s.store);
      expect(run.batches).toHaveLength(1);
      expect(run.batches[0]!.payments.map((p) => p.amount)).toEqual(["50000000", "50000000"]);
      s.adapter.inspect = vi.fn(async () => ({ status: "confirmed" as const }));
      const step = await payoutStep(held.id, true, undefined, s.adapter, s.store);
      expect(step.transaction?.swap).toBe(false);
      await payoutStep(held.id, false, s.sign(step.transaction!.prepared), s.adapter, s.store);
      await payoutStep(held.id, false, undefined, s.adapter, s.store);
      await payoutStep(held.id, false, undefined, s.adapter, s.store);
      expect(s.store.get(held.id)!.status).toBe("completed");
      expect(s.store.paidUnits(s.plan.agpMint!)).toBe(100_000_000n);
      expect(s.adapter.prepareSwap).not.toHaveBeenCalled();
      expect(s.adapter.prepareTransfer).toHaveBeenCalledTimes(1);
    } finally { s.launches.db.close(); }
  });
  it("groups owed payments into transactions of eight, skipping zero amounts", () => {
    const payments = Array.from({ length: 21 }, (_, i) => ({ wallet: `w${i}`, amount: i === 5 ? "0" : "1", confirmed: i === 5 }));
    const transfers = groupTransfers(payments);
    expect(TRANSFERS_PER_TX).toBe(8);
    expect(transfers.map(t => t.payments.length)).toEqual([8, 8, 4]);
    expect(transfers.flatMap(t => t.payments)).not.toContain(5);
  });
  it("accepts a transfer the wallet added a priority fee to, and proves it by simulation before sending", async () => {
    const s = setup();
    try {
      const held = buildHeldPayoutPlan({ kind: "daily", period: "2026-10-06", budgetAgp: "1000", rewardPercent: "50" }, 6,
        s.plan.winners.map(({ lamports: _, ...winner }) => winner), s.plan.source, "platform", "admin");
      held.agpMint = s.plan.agpMint; s.plans.insert(held); s.plans.approve(held.id, "admin");
      s.launches.db.prepare("DELETE FROM payout_execution").run();
      await startExecution(held.id, "admin", s.adapter, s.store);
      const step = await payoutStep(held.id, true, undefined, s.adapter, s.store);
      // What Phantom does: decompile, put a compute-budget instruction first, recompile, sign.
      const prepared = VersionedTransaction.deserialize(Buffer.from(step.transaction!.prepared, "base64"));
      const message = TransactionMessage.decompile(prepared.message);
      const added = new VersionedTransaction(new TransactionMessage({ payerKey: s.source.publicKey, recentBlockhash: message.recentBlockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), ...message.instructions] }).compileToV0Message());
      added.sign([s.source]);
      const signed = Buffer.from(added.serialize()).toString("base64");
      s.adapter.verifyTransfer = vi.fn(async () => {});
      await payoutStep(held.id, false, signed, s.adapter, s.store);
      expect(s.adapter.verifyTransfer).toHaveBeenCalledWith(expect.anything(), expect.anything(), [expect.objectContaining({ amount: "50000000" }), expect.objectContaining({ amount: "50000000" })]);
      expect(s.store.get(held.id)!.batches[0]!.transfers[0]!.tx!.signed).toBe(signed);
      expect(s.adapter.submit).toHaveBeenCalledWith(expect.objectContaining({ signed }), false);
    } finally { s.launches.db.close(); }
  });
  it("refuses a signed transfer with another blockhash, or one missing a prepared instruction", () => {
    const payer = Keypair.generate(), to = Keypair.generate().publicKey, blockhash = Keypair.generate().publicKey.toBase58();
    const build = (instructions: Parameters<typeof SystemProgram.transfer>[0][], hash = blockhash, extra = false) => {
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: hash,
        instructions: [...(extra ? [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })] : []), ...instructions.map((i) => SystemProgram.transfer(i))] }).compileToV0Message());
      tx.sign([payer]); return Buffer.from(tx.serialize()).toString("base64");
    };
    const pay = (lamports: number) => ({ fromPubkey: payer.publicKey, toPubkey: to, lamports });
    const prepared = build([pay(1), pay(2)]);
    expect(() => verifySignedPayout(prepared, prepared)).not.toThrow();
    expect(() => verifySignedPayout(prepared, build([pay(1), pay(2)], blockhash, true))).not.toThrow();
    expect(() => verifySignedPayout(prepared, build([pay(1), pay(2)], Keypair.generate().publicKey.toBase58(), true))).toThrow("changed");
    expect(() => verifySignedPayout(prepared, build([pay(1)], blockhash, true))).toThrow("changed");
    expect(() => verifySignedPayout(prepared, build([pay(1), pay(3)], blockhash, true))).toThrow("changed");
  });
});
