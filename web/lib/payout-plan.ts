import { solToLamports } from "./launchpad-validation";

export type PayoutInput = {
  kind: "daily" | "weekly"; period: string; budgetSol: string;
  rewardPercent: string; batchSol: string; delaySeconds: number; slippageBps: number;
};
/** $GAMINE the operator already bought into the reward wallet, paid out as it is: no swap. */
export type HeldPayoutInput = { kind: "daily" | "weekly"; period: string; budgetAgp: string; rewardPercent: string };
/** One agent: a wallet holding one token. A wallet with agents for several tokens is several winners. */
export type PayoutWinner = { agentId: string; name: string; wallet: string; mint?: string; share: number };
export type PayoutPlan = {
  id: string; kind: PayoutInput["kind"]; period: string; source: string; platform: string;
  budgetLamports: string; rewardBps: number; platformLamports: string;
  allocatedLamports: string; carryoverLamports: string; batchLamports: string[];
  delaySeconds: number; slippageBps: number; createdBy: string; createdAt: string;
  approvedBy: string | null; approvedAt: string | null;
  /** A cancelled plan was approved and then withdrawn before anything was sent; it can never be approved again. */
  status: "draft" | "approved" | "cancelled"; winners: (PayoutWinner & { lamports: string })[];
  cancelledBy?: string; cancelledAt?: string;
  agpMint: string | null;
  /**
   * "swap" (the default, and every older plan) spends SOL: amounts are lamports, swapped into $GAMINE
   * batch by batch. "held" pays $GAMINE already in the reward wallet: every amount field - budget,
   * allocation, carryover, batch, each winner's `lamports` - is in $GAMINE base units of `decimals`.
   */
  funding?: "swap" | "held";
  decimals?: number;
  /** Checked at preview: winners whose agent ended (sold to zero), under this score, or holding under $20 now were dropped and their shares re-shared. */
  minScore?: number;
  dropped?: PayoutDropped[];
  /** A daily catch-up's last day: the plan pays every frozen day from `period` through this one. */
  periodEnd?: string;
  /** The most one winner may take, in basis points; 1,000 (10%) on plans from before it was set per payout. */
  capBps?: number;
};
/** Every UTC day a daily plan pays, as YYYY-MM-DD: its one day, or each day of a catch-up. */
export function planDays(plan: Pick<PayoutPlan, "period" | "periodEnd">): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${plan.period}T00:00:00Z`); t <= Date.parse(`${plan.periodEnd ?? plan.period}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}
/** "2026-10-09" or "2026-10-09 to 2026-10-11". */
export const planPeriod = (plan: Pick<PayoutPlan, "period" | "periodEnd">) => plan.periodEnd && plan.periodEnd !== plan.period ? `${plan.period} to ${plan.periodEnd}` : plan.period;
export type PayoutDropped = { agentId: string; name: string; wallet: string; mint: string; score: number; reason: "reward wallet" | "agent ended" | "below minimum score" | "holds under $20" };

export function percentBps(value: string): number {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) throw new Error("Reward percentage must be between 0 and 100, with up to two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps <= 0 || bps > 10_000) throw new Error("Reward percentage must be greater than 0 and no more than 100.");
  return bps;
}

/** Whole-unit integer accounting for an amount in any unit: each winner's capped share of the reward. */
function allocate(reward: bigint, winners: PayoutWinner[], capBps = 1_000) {
  const cap = capBps / 10_000;
  const seen = new Set<string>();
  let totalShare = 0;
  const recipients = winners.map((winner) => {
    const key = `${winner.wallet}:${winner.mint ?? ""}`;
    if (seen.has(key)) throw new Error("A payout wallet may appear only once per token.");
    seen.add(key);
    if (!Number.isFinite(winner.share) || winner.share < 0 || winner.share > cap + 1e-12) throw new Error(`Invalid winner share; each winner is capped at ${capBps / 100}%.`);
    const share = Math.floor(Math.min(cap, winner.share) * 1_000_000_000);
    totalShare += share;
    return { ...winner, lamports: (reward * BigInt(share) / 1_000_000_000n).toString() };
  }).filter((winner) => BigInt(winner.lamports) > 0n);
  // Shares filled to the whole reward can round a hair over it; integer floors keep the total within it.
  if (totalShare > 1_000_000_100) throw new Error("Winner shares exceed the reward allocation.");
  const allocated = recipients.reduce((sum, winner) => sum + BigInt(winner.lamports), 0n);
  if (allocated <= 0n) throw new Error("There are no eligible winners with a payable reward.");
  return { recipients, allocated };
}

/** Integer SOL accounting; a capped or rounded share stays in the reward wallet. */
export function buildPayoutPlan(input: PayoutInput, winners: PayoutWinner[], source: string, platform: string, owner: string, capBps = 1_000): PayoutPlan {
  const budget = BigInt(solToLamports(input.budgetSol));
  const batch = BigInt(solToLamports(input.batchSol));
  if (budget <= 0n || batch <= 0n) throw new Error("Budget and batch size must be greater than zero.");
  const rewardBps = percentBps(input.rewardPercent);
  if (!Number.isInteger(input.delaySeconds) || input.delaySeconds < 30 || input.delaySeconds > 86_400) throw new Error("Wait between 30 and 86400 seconds between batches.");
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 500) throw new Error("Slippage must be between 1 and 500 basis points.");
  const { recipients, allocated } = allocate(budget * BigInt(rewardBps) / 10_000n, winners, capBps);
  const count = (allocated + batch - 1n) / batch;
  if (count > 100n) throw new Error("Use a larger batch size; a payout may contain at most 100 batches.");
  const batches: string[] = [];
  for (let left = allocated; left > 0n; left -= batch) batches.push((left < batch ? left : batch).toString());
  return {
    id: crypto.randomUUID(), kind: input.kind, period: input.period, source, platform,
    budgetLamports: budget.toString(), rewardBps,
    platformLamports: "0", allocatedLamports: allocated.toString(),
    carryoverLamports: (budget - allocated).toString(), batchLamports: batches,
    delaySeconds: input.delaySeconds, slippageBps: input.slippageBps,
    createdBy: owner, createdAt: new Date().toISOString(), approvedBy: null, approvedAt: null,
    status: "draft", winners: recipients, agpMint: null, funding: "swap", capBps,
  };
}

/** A token amount ("1250000.5") in base units of `decimals`. */
export function tokenUnits(value: string, decimals: number): bigint {
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(value.trim().replaceAll(",", ""));
  if (!match || (match[2]?.length ?? 0) > decimals) throw new Error(`Enter an $GAMINE amount with up to ${decimals} decimal places.`);
  return BigInt(match[1]!) * 10n ** BigInt(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
}

/**
 * Pays $GAMINE already bought into the reward wallet. No swap, so no batching against price impact:
 * one batch of winner transfers, each still signed by the reward wallet. The shares come from the API
 * under the payout's cap; whatever is rounded or not allocated stays in the wallet as $GAMINE.
 */
export function buildHeldPayoutPlan(input: HeldPayoutInput, decimals: number, winners: PayoutWinner[], source: string, platform: string, owner: string, capBps = 1_000): PayoutPlan {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) throw new Error("Invalid $GAMINE decimals.");
  const budget = tokenUnits(input.budgetAgp, decimals);
  if (budget <= 0n) throw new Error("The $GAMINE amount must be greater than zero.");
  const rewardBps = percentBps(input.rewardPercent);
  const { recipients, allocated } = allocate(budget * BigInt(rewardBps) / 10_000n, winners, capBps);
  return {
    id: crypto.randomUUID(), kind: input.kind, period: input.period, source, platform,
    budgetLamports: budget.toString(), rewardBps,
    platformLamports: "0", allocatedLamports: allocated.toString(),
    carryoverLamports: (budget - allocated).toString(), batchLamports: [allocated.toString()],
    delaySeconds: 0, slippageBps: 0,
    createdBy: owner, createdAt: new Date().toISOString(), approvedBy: null, approvedAt: null,
    status: "draft", winners: recipients, agpMint: null, funding: "held", decimals, capBps,
  };
}
