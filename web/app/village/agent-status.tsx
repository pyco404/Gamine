"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWallet } from "@/app/wallet-context";
import type { WorldView } from "./game/presentation";
import type { VillageHandle } from "./game";

export type AgentAccount = Awaited<ReturnType<typeof api.me>>;
type Detail = Awaited<ReturnType<typeof api.agent>>;

/** Owner data is private API data, separate from the public world feed. */
export function AgentStatus({ account, accountError, view, village }: {
  account: AgentAccount | null; accountError: boolean; view: WorldView | null;
  village: React.RefObject<VillageHandle | null>;
}) {
  const { session } = useWallet();
  const id = view?.selected?.id ?? null;
  const owned = account?.agents.filter((a) => !a.retired) ?? [];
  const agent = owned.find((a) => (a.id ?? a.agentId) === id);
  const [read, setRead] = useState<{ id: string; token: string; data: Detail | null; failed: boolean } | null>(null);
  const token = session?.token;
  const ownId = agent ? id : null;
  useEffect(() => {
    if (!token || !ownId) return;
    let gone = false;
    const load = async () => {
      try {
        const data = await api.agent(token, ownId);
        if (!gone) setRead({ id: ownId, token, data, failed: false });
      } catch {
        // Do not keep displaying stale power as if a failed reading were current.
        if (!gone) setRead({ id: ownId, token, data: null, failed: true });
      }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => { gone = true; clearInterval(timer); };
  }, [ownId, token]);
  const current = read?.id === ownId && read?.token === token ? read : null;
  const detail = current?.data;
  const holder = detail?.holder;
  const mint = detail?.agent.qualifyingTokenMint ?? agent?.qualifyingTokenMint ?? agent?.holderMint ?? holder?.holding.mint;
  const community = account?.tokenHoldings?.find((t) => t.mint === mint);
  const symbol = community?.symbol ?? (agent?.holderMint ? `${agent.holderMint.slice(0, 4)}…${agent.holderMint.slice(-4)}` : "$GAMINE");
  const waiting = !session ? "Sign in with your wallet to locate your agent." : accountError ? "Could not read your agents. Retrying…" : !account ? "Locating your agents…" : !owned.length ? "No agent yet. Buy and hold at least $20 of a qualifying token to activate one." : !agent ? "Waiting for your agent to appear in the field…" : null;
  const missing = current?.failed ? "Unavailable" : !current ? "Loading…" : "Unavailable";
  return <aside aria-label="Your agent status" className="pointer-events-auto absolute left-3 top-16 z-10 w-[240px] max-w-[calc(100vw-1.5rem)] rounded-panel border border-hud-line bg-hud p-3 text-xs text-text shadow-[0_4px_16px_rgb(0_0_0/0.35)] md:left-4 md:top-[4.5rem]">
    <p className="text-[10px] uppercase tracking-widest text-muted">Your agent · autonomous</p>
    {waiting ? <p role="status" className="mt-2 leading-5">{waiting}</p> : <>
      <Link href={`/a/${id}`} className="mt-1 block truncate text-sm text-accent" title={agent!.name}>{agent!.name}</Link>
      {owned.length > 1 ? <label className="mt-2 block text-muted">Observe
        <select aria-label="Choose your agent" value={id ?? ""} onChange={(e) => village.current?.select(e.target.value, true)} className="mt-1 w-full rounded border border-hud-line bg-ink px-1 py-1 text-text">
          {owned.map((a) => <option key={a.id ?? a.agentId} value={a.id ?? a.agentId}>{a.name}</option>)}
        </select>
      </label> : null}
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-muted">Token</dt><dd className="truncate" title={community?.name ?? mint}>{mint ? <a className="text-accent" href={`https://solscan.io/token/${encodeURIComponent(mint)}${detail?.agent.solanaCluster === "devnet" ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer">{symbol}</a> : symbol}</dd>
        <dt className="text-muted">Power</dt><dd title="Reward score multiplier; does not affect match outcomes">{holder ? `×${holder.power.weight.toFixed(2)}` : missing}</dd>
        <dt className="text-muted">Conviction</dt><dd>{holder ? `${holder.power.convictionDays} / ${holder.power.convictionCapDays} days` : missing}</dd>
        <dt className="text-muted">Activity</dt><dd>{view?.selected?.activity ?? "Locating…"}</dd>
        <dt className="text-muted">Destination</dt><dd className="truncate" title={view?.selected?.destination}>{view?.selected?.destination ?? "Locating…"}</dd>
      </dl>
      {view?.selected?.activityState?.job ? <p className="mt-2 text-[11px] text-emerald-300">Town errand: {view.selected.activityState.job.title}</p> : null}
      {view?.selected?.activityState ? <div className="mt-2">
        <div className="mb-1 flex justify-between text-[10px] text-muted"><span>{view.selected.activityState.phase === "working" ? "Activity progress" : view.selected.activityState.phase === "resting" ? "Rest" : "Journey progress"}</span><span>{Math.round(view.selected.activityState.progress * 100)}%</span></div>
        <progress aria-label="Activity progress" value={view.selected.activityState.progress} max={1} className="block h-1.5 w-full accent-emerald-400" />
      </div> : null}
      {!view?.following ? <p role="status" className="mt-2 text-muted">Locating your agent…</p> : null}
    </>}
    <Link href="/agents" className="mt-2 inline-block border-t border-hud-line pt-2 text-accent">Manage agents</Link>
  </aside>;
}
