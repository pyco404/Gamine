"use client";
import { useEffect, useState } from "react";
import { usd } from "@/lib/launchpad";
import type { PlatformTotals } from "@/lib/platform-stats";
export function PlatformStats() {
  const [stats, setStats] = useState<PlatformTotals | null>(null);
  useEffect(() => {
    let gone = false;
    const read = async () => { try { const res = await fetch("/api/platform/stats", { cache: "no-store" }); if (res.ok && !gone) setStats(await res.json()); } catch {} };
    void read(); const timer = setInterval(() => void read(), 60_000);
    return () => { gone = true; clearInterval(timer); };
  }, []);
  const cells = [
    ["Active tokens", stats?.activeTokens?.toLocaleString() ?? "—"],
    ["Active agents", stats?.activeAgents?.toLocaleString() ?? "—"],
    ["Total volume (24h)", usd(stats?.volume24hUsd ?? null)],
    ["Reward pool (SOL)", stats?.rewardPoolSol?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "—"],
    ["Reward pool ($GAMINE)", stats?.rewardPoolAgp?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "—"],
    ["Total payouts ($GAMINE)", stats?.totalPaidAgp?.toLocaleString() ?? "—"],
  ];
  return <section className="hud-card px-4 py-3" aria-label="Platform totals"><div className="grid grid-cols-2 gap-3 @xl:grid-cols-3">{cells.map(([label, value]) => <div key={label}><p className="text-[11px] text-muted">{label}</p><p className="font-mono text-[17px] text-accent">{value}</p></div>)}</div><p className="mt-2 text-[11px] text-muted">Inactive tokens are excluded. Reward pool shows the shared agent reward wallet's current balance. Total payouts count confirmed transfers to winners.</p></section>;
}
