import { describe, expect, it } from "vitest";
import { readStoredValue, removeStoredValue } from "../lib/browser-storage";
import { LaunchStore } from "../lib/launchpad-store";
import { PayoutStore } from "../lib/payout-store";
import { buildPayoutPlan } from "../lib/payout-plan";

function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null };
}

describe("Branding changes preserve existing state", () => {
  it.each(["agenticpad", "agentclash"])("moves an existing signed pending launch from %s without altering its bytes", (brand) => {
    const saved = storage();
    const pending = JSON.stringify({ id: "same-launch", signed: "same-signed-transaction" });
    saved.setItem(`${brand}.pump.pending`, pending);
    expect(readStoredValue(saved, "gamine.pump.pending")).toBe(pending);
    expect(saved.getItem("gamine.pump.pending")).toBe(pending);
    expect(saved.getItem(`${brand}.pump.pending`)).toBeNull();
  });
  it("prefers current state and signing out also clears the old session", () => {
    const saved = storage();
    saved.setItem("gamine.session", "current"); saved.setItem("oxude.session", "old");
    expect(readStoredValue(saved, "gamine.session")).toBe("current");
    removeStoredValue(saved, "gamine.session");
    expect(readStoredValue(saved, "gamine.session")).toBeNull();
  });
  it("keeps the old pending transaction recoverable when storage is full", () => {
    const saved = storage(); saved.setItem("agentclash.pump.pending", "signed");
    saved.setItem = () => { throw new Error("full"); };
    expect(readStoredValue(saved, "gamine.pump.pending")).toBe("signed");
    expect(saved.getItem("agentclash.pump.pending")).toBe("signed");
    removeStoredValue(saved, "gamine.pump.pending");
    expect(readStoredValue(saved, "gamine.pump.pending")).toBeNull();
  });
  it("loads the mint from an older saved payout plan", () => {
    const launches = new LaunchStore(":memory:"); const payouts = new PayoutStore(launches.db);
    const plan = buildPayoutPlan({ kind: "daily", period: "2026-10-04", budgetSol: "1", rewardPercent: "90", batchSol: "0.1", delaySeconds: 60, slippageBps: 50 }, [{ wallet: "winner", agentId: "agent", name: "Winner", share: 0.1 }], "daily", "platform", "admin");
    const { agpMint: _unused, ...rest } = plan;
    payouts.db.prepare("INSERT INTO payout_plans(id, kind, period, status, data) VALUES (?, ?, ?, ?, ?)").run(plan.id, plan.kind, plan.period, plan.status, JSON.stringify({ ...rest, clashMint: "original-mint" }));
    expect(payouts.get(plan.id)?.agpMint).toBe("original-mint");
    expect(payouts.list()[0]?.agpMint).toBe("original-mint");
    launches.db.close();
  });
});
