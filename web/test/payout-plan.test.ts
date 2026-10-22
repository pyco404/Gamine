import { describe, expect, it } from "vitest";
import { buildHeldPayoutPlan, buildPayoutPlan, percentBps, planDays, planPeriod, tokenUnits, type PayoutInput } from "../lib/payout-plan";
import { PayoutStore } from "../lib/payout-store";
import { ExecutionStore } from "../lib/payout-execution-store";
import { LaunchStore } from "../lib/launchpad-store";

const settings: PayoutInput = { kind: "daily", period: "2026-10-04", budgetSol: "10", rewardPercent: "90", batchSol: "0.25", delaySeconds: 60, slippageBps: 50 };
const winners = Array.from({ length: 10 }, (_, index) => ({ agentId: `agent-${index}`, name: `Winner ${index}`, wallet: `wallet-${index}`, share: 0.1 }));
const plan = (input = settings, recipients = winners) => buildPayoutPlan(input, recipients, "daily", "platform", "admin");

describe("SOL reward payout planning (no swaps or payments)", () => {
  it("pays 90% and retains 10% in the reward wallet while bounding every batch", () => {
    const result = plan();
    expect(result.allocatedLamports).toBe("9000000000");
    expect(result.platformLamports).toBe("0");
    expect(result.carryoverLamports).toBe("1000000000");
    expect(result.batchLamports).toHaveLength(36);
    expect(result.batchLamports.every((amount) => BigInt(amount) <= 250_000_000n)).toBe(true);
    expect(result.batchLamports.reduce((sum, amount) => sum + BigInt(amount), 0n)).toBe(9_000_000_000n);
    expect(result.approvedAt).toBeNull();
  });
  it("pays 8 SOL from a 10 SOL budget at 80% and retains 2 SOL", () => {
    const result = plan({ ...settings, rewardPercent: "80" });
    expect(result.allocatedLamports).toBe("8000000000");
    expect(result.carryoverLamports).toBe("2000000000");
    expect(result.platformLamports).toBe("0");
  });
  it("rejects approval of older plans that send reward SOL to the platform", () => {
    const launches = new LaunchStore(":memory:");
    const store = new PayoutStore(launches.db);
    const old = { ...plan(), platformLamports: "1000000000", carryoverLamports: "0" };
    store.insert(old);
    expect(() => store.approve(old.id, "operator")).toThrow("older plan");
    expect(store.get(old.id)?.status).toBe("draft");
    launches.db.close();
  });
  it("keeps capped rewards in the reward wallet instead of increasing the platform share", () => {
    const result = plan(settings, winners.slice(0, 1));
    expect(result.allocatedLamports).toBe("900000000");
    expect(result.platformLamports).toBe("0");
    expect(result.carryoverLamports).toBe("9100000000");
  });
  it("preserves every lamport with decimal percentages and a final short batch", () => {
    const result = plan({ ...settings, budgetSol: "0.000000019", rewardPercent: "90.25", batchSol: "0.000000003" });
    const total = BigInt(result.allocatedLamports) + BigInt(result.platformLamports) + BigInt(result.carryoverLamports);
    expect(total).toBe(19n);
    expect(result.batchLamports.at(-1)).toBe("1");
  });
  it.each(["-1", "101", "NaN", "90.001", "0"])("rejects invalid percentages: %s", (value) => expect(() => percentBps(value)).toThrow());
  it("rejects repeated receiving wallets, excessive shares and unbounded batch counts", () => {
    expect(() => plan(settings, [winners[0]!, winners[0]!])).toThrow("only once");
    expect(() => plan(settings, [{ ...winners[0]!, share: 0.5 }])).toThrow("capped");
    expect(() => plan({ ...settings, batchSol: "0.000000001" })).toThrow("100 batches");
    expect(() => plan({ ...settings, delaySeconds: 0 })).toThrow("Wait");
    expect(() => plan({ ...settings, slippageBps: 1000 })).toThrow("Slippage");
  });
  it("pays one wallet once per token, each agent under its own 10% cap", () => {
    const both = [{ ...winners[0]!, mint: "agp" }, { ...winners[0]!, agentId: "agent-dox", mint: "dox" }];
    const result = plan(settings, both);
    expect(result.winners.map((winner) => winner.lamports)).toEqual(["900000000", "900000000"]);
    expect(result.allocatedLamports).toBe("1800000000");
    expect(() => plan(settings, [both[0]!, both[0]!])).toThrow("once per token");
  });
  it("stores immutable approval details and prevents a second approved plan for the same period", () => {
    const launches = new LaunchStore(":memory:");
    const store = new PayoutStore(launches.db);
    const first = plan(); const second = plan();
    store.insert(first); store.insert(second);
    const approved = store.approve(first.id, "operator");
    expect(approved.approvedBy).toBe("operator");
    expect(store.approve(first.id, "another-operator")).toEqual(approved);
    expect(() => store.approve(second.id, "operator")).toThrow("already approved");
    expect(store.get(second.id)?.status).toBe("draft");
    expect(store.list()).toHaveLength(2);
    launches.db.close();
  });
});

describe("held $GAMINE payout planning (no swap)", () => {
  const held = (budgetAgp: string, recipients = winners, rewardPercent = "90") =>
    buildHeldPayoutPlan({ kind: "daily", period: "2026-10-04", budgetAgp, rewardPercent }, 6, recipients, "daily", "platform", "admin");
  it("pays $GAMINE base units from the wallet in one batch, retaining the rest as $GAMINE", () => {
    const result = held("1,000,000");
    expect(result.funding).toBe("held"); expect(result.decimals).toBe(6);
    expect(result.budgetLamports).toBe("1000000000000");
    expect(result.allocatedLamports).toBe("900000000000");
    expect(result.carryoverLamports).toBe("100000000000");
    expect(result.batchLamports).toEqual(["900000000000"]);
    expect(result.winners.every((winner) => winner.lamports === "90000000000")).toBe(true);
    expect(result.platformLamports).toBe("0");
  });
  it("keeps the 10% cap: one winner gets a tenth of the reward and the rest stays held", () => {
    const result = held("1000", winners.slice(0, 1), "100");
    expect(result.allocatedLamports).toBe("100000000");
    expect(result.carryoverLamports).toBe("900000000");
  });
  it("reads amounts exactly in the mint's decimals", () => {
    expect(tokenUnits("1.5", 6)).toBe(1_500_000n);
    expect(tokenUnits("0.000001", 6)).toBe(1n);
    expect(() => tokenUnits("0.0000001", 6)).toThrow("decimal places");
    expect(() => tokenUnits("-1", 6)).toThrow();
    expect(() => held("0")).toThrow("greater than zero");
  });
  it("takes the payout's cap: shares filled to the whole amount pay it out in full", () => {
    const five = winners.slice(0, 5).map((winner) => ({ ...winner, share: 0.2 }));
    const result = buildHeldPayoutPlan({ kind: "daily", period: "2026-10-04", budgetAgp: "2500000", rewardPercent: "100" }, 6, five, "daily", "platform", "admin", 2_000);
    expect(result.capBps).toBe(2_000);
    expect(result.winners.every((winner) => winner.lamports === "500000000000")).toBe(true);
    expect(result.carryoverLamports).toBe("0");
    expect(() => buildHeldPayoutPlan({ kind: "daily", period: "2026-10-04", budgetAgp: "1", rewardPercent: "100" }, 6, five, "daily", "platform", "admin")).toThrow("capped at 10%");
  });
  it("older plans without a funding field remain swap plans", () => {
    const { funding: _, ...old } = plan();
    expect(old.batchLamports.length).toBeGreaterThan(1);
    expect((old as { funding?: string }).funding).toBeUndefined();
  });
});

describe("daily catch-up payouts", () => {
  const daily = (period: string, periodEnd?: string) => ({ ...buildHeldPayoutPlan({ kind: "daily", period, budgetAgp: "1000", rewardPercent: "100" }, 6, winners, "daily", "platform", "admin"), ...(periodEnd ? { periodEnd } : {}) });
  it("covers every day from its first through its last", () => {
    expect(planDays(daily("2026-10-09", "2026-10-11"))).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(planDays(daily("2026-10-12"))).toEqual(["2026-10-12"]);
    expect(planPeriod(daily("2026-10-09", "2026-10-11"))).toBe("2026-10-09 to 2026-10-11");
  });
  it("pays each day once: a catch-up and a single day may not both be approved for it", () => {
    const launches = new LaunchStore(":memory:");
    const store = new PayoutStore(launches.db);
    const catchUp = daily("2026-10-09", "2026-10-11"), inside = daily("2026-10-10"), after = daily("2026-10-12");
    for (const p of [catchUp, inside, after]) store.insert(p);
    store.approve(catchUp.id, "operator");
    expect(() => store.approve(inside.id, "operator")).toThrow("2026-10-09 to 2026-10-11");
    expect(store.approve(after.id, "operator").status).toBe("approved");
    const overlapping = daily("2026-10-11", "2026-10-13"); store.insert(overlapping);
    expect(() => store.approve(overlapping.id, "operator")).toThrow("overlaps");
    launches.db.close();
  });
  it("cancels an approval that has not started, freeing its days; never one already paying", () => {
    const launches = new LaunchStore(":memory:");
    const store = new PayoutStore(launches.db);
    const first = daily("2026-10-09", "2026-10-11"), replacement = daily("2026-10-09", "2026-10-11");
    store.insert(first); store.insert(replacement);
    store.approve(first.id, "operator");
    expect(() => store.approve(replacement.id, "operator")).toThrow("already approved");
    expect(store.cancel(first.id, "operator").status).toBe("cancelled");
    expect(() => store.approve(first.id, "operator")).toThrow("cancelled");
    expect(store.approve(replacement.id, "operator").status).toBe("approved");
    // Once a payout has started, transfers may be on chain: it can only be paused.
    new ExecutionStore(launches.db).insert({ planId: replacement.id, source: "daily", mint: "m", decimals: 6, status: "running", startedBy: "operator",
      startedAt: "", completedAt: null, error: null, nextAt: 0, batch: 0, batches: [] });
    expect(() => store.cancel(replacement.id, "operator")).toThrow("already started");
    launches.db.close();
  });
  it("deletes drafts only: approved and cancelled plans stay on record", () => {
    const launches = new LaunchStore(":memory:");
    const store = new PayoutStore(launches.db);
    const kept = daily("2026-10-12"), dropped = daily("2026-10-12");
    store.insert(kept); store.insert(dropped);
    store.approve(kept.id, "operator");
    store.remove(dropped.id);
    expect(store.get(dropped.id)).toBeNull();
    expect(() => store.remove(kept.id)).toThrow("Only a draft");
    expect(store.get(kept.id)?.status).toBe("approved");
    launches.db.close();
  });
});
