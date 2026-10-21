import { Connection, PublicKey } from "@solana/web3.js";
import { launchStore } from "@/lib/launchpad-store";
import { MarketStore } from "@/lib/token-market";
import { DAILY_REWARDS_WALLET, WEEKLY_REWARDS_WALLET } from "@/lib/launchpad-fees";
import type { PlatformTotals } from "@/lib/platform-stats";
import { ExecutionStore } from "@/lib/payout-execution-store";
import { AGP_MINT } from "@/lib/agp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let cached: { at: number; value: PlatformTotals } | null = null;
let pending: Promise<PlatformTotals> | null = null;
async function totals(): Promise<PlatformTotals> {
  const market = new MarketStore();
  const active = launchStore().list().filter((l) => l.confirmed && market.visible(l.mint));
  const readings = active.map((l) => market.get(l.mint));
  const complete = readings.every((r) => r?.health === "ok" && r.volume24hUsd !== null && r.observedAt !== null && Date.now() - r.observedAt < 15 * 60_000);
  let activeAgents: number | null = null, rewardPoolSol: number | null = null, rewardPoolAgp: number | null = null;
  const backend = process.env.LAUNCHPAD_AUTH_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  await Promise.allSettled([
    (async () => { const res = await fetch(`${backend}/stats`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }); if (res.ok) { const body = await res.json(); if (Number.isSafeInteger(body.activeAgents) && body.activeAgents >= 0) activeAgents = body.activeAgents; } })(),
    (async () => {
      if (!process.env.PUMP_RPC_URL) return;
      const rpc = new Connection(process.env.PUMP_RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true });
      if (await rpc.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") return;
      const wallets = [new PublicKey(DAILY_REWARDS_WALLET), new PublicKey(WEEKLY_REWARDS_WALLET)];
      const accounts = await rpc.getMultipleAccountsInfo(wallets);
      rewardPoolSol = accounts.reduce((sum, a) => sum + (a?.lamports ?? 0), 0) / 1e9;
      // The $GAMINE bought into the reward wallets for payouts, across every account each holds for the mint.
      const mint = new PublicKey(process.env.PAYOUT_AGP_MINT || AGP_MINT);
      const held = await Promise.all(wallets.map((owner) => rpc.getParsedTokenAccountsByOwner(owner, { mint })));
      rewardPoolAgp = held.flatMap((r) => r.value).reduce((sum, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
    })(),
  ]);
  const totalPaidAgp = process.env.PAYOUT_AGP_MINT ? new ExecutionStore().paidAgp(process.env.PAYOUT_AGP_MINT) : null;
  return { activeTokens: active.length, activeAgents, volume24hUsd: complete ? readings.reduce((sum, r) => sum + r!.volume24hUsd!, 0) : null, rewardPoolSol, rewardPoolAgp, totalPaidAgp, at: new Date().toISOString() };
}
export async function GET() {
  try {
    if (!cached || Date.now() - cached.at > 60_000) {
      pending ??= totals();
      try { cached = { at: Date.now(), value: await pending }; } finally { pending = null; }
    }
    return Response.json(cached.value, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "Platform statistics unavailable" }, { status: 503 }); }
}
