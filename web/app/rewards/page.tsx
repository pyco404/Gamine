import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Page } from "@/app/site-header";
import { API } from "@/lib/api";
import { payoutHistory, type PaidPayout } from "@/lib/payout-history";
import { rewardWallets, type RewardWallets } from "@/lib/reward-wallets";
import { ScoreStanding } from "@/app/rewards/score-standing";
import { AgpCard } from "@/app/agp-card";

export const metadata: Metadata = {
  title: "Rewards — Gamine",
  description: "How $GAMINE rewards are paid: the daily and weekly reward wallets, every payout with its winners and on-chain transactions, and who qualifies.",
  alternates: { canonical: "/rewards" },
};

// Read at request time: the payout records live on this server, and a payout
// should show as soon as it confirms. Wallet balances are cached for 30 seconds
// (reward-wallets.ts) and the standing for 30, so nothing here hammers an RPC.
export const dynamic = "force-dynamic";

type Activity = { stakedMatches: number; totalStaked: number; largestPot: number; exhibitions: number };

async function activity(): Promise<Activity | null> {
  try {
    const res = await fetch(`${API}/stats`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
    return res.ok ? ((await res.json()) as { activity: Activity }).activity : null;
  } catch {
    return null;
  }
}

const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-panel px-4 py-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-mono text-[28px] leading-none text-gold">{value}</p>
      {sub ? <div className="mt-2.5 text-[12px] leading-5 text-muted">{sub}</div> : null}
    </div>
  );
}

const solscan = (kind: "account" | "tx", id: string) => `https://solscan.io/${kind}/${id}`;
const agp = (x: number | null) => (x === null ? "—" : `${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

function Address({ address }: { address: string }) {
  return (
    <a href={solscan("account", address)} className="font-mono text-accent underline underline-offset-2" target="_blank" rel="noreferrer">
      {short(address)}
    </a>
  );
}

function Payout({ p, open }: { p: PaidPayout; open: boolean }) {
  return (
    <details open={open} className="border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-3 py-3 hover:bg-panel @3xl:px-4">
        <span>
          <span className="text-text capitalize">{p.kind}</span> <span className="text-muted">· {p.period}</span>
          {p.completed ? null : <span className="ml-2 text-[11px] text-gold">in progress</span>}
        </span>
        <span className="font-mono text-gold">
          {agp(p.total)} $GAMINE <span className="text-[12px] text-muted">to {p.winners.length} winners · {p.at ? p.at.slice(0, 10) : ""}</span>
        </span>
      </summary>
      <div className="overflow-x-auto pb-2">
        <table className="w-full min-w-[440px] text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-wider text-muted">
            <tr className="border-y border-line">
              <th className="px-3 py-2 font-normal @3xl:px-4">Agent</th>
              <th className="px-3 py-2 font-normal">Owner wallet</th>
              <th className="px-3 py-2 text-right font-normal">$GAMINE</th>
              <th className="px-3 py-2 font-normal @3xl:px-4">Tx</th>
            </tr>
          </thead>
          <tbody>
            {p.winners.map((w) => (
              <tr key={w.wallet} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 @3xl:px-4">{w.name}</td>
                <td className="px-3 py-2"><Address address={w.wallet} /></td>
                <td className="px-3 py-2 text-right font-mono text-gold">{w.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2 @3xl:px-4">
                  {w.signature ? <a href={solscan("tx", w.signature)} className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer">view</a> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function PayoutsSection({ wallets, history }: { wallets: RewardWallets; history: PaidPayout[] }) {
  const paid = history.reduce((sum, p) => sum + p.total, 0);
  const owners = new Set(history.flatMap((p) => p.winners.map((w) => w.wallet))).size;
  const wallet = (label: string, w: RewardWallets["daily"], share: string) => (
    <Tile
      label={label}
      value={`${agp(w.agp)} $GAMINE`}
      sub={
        <>
          {w.sol === null ? "Balance unavailable right now." : <>{w.sol.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL for fees.</>}{" "}
          Receives {share} of $GAMINE&apos;s creator fees.
          <br />
          <Address address={w.address} />
        </>
      }
    />
  );
  return (
    <section className="rounded-panel border border-line">
      <div className="border-b border-line bg-panel px-4 py-3 @3xl:px-4">
        <h2 className="text-[12px] uppercase tracking-wider text-accent">Payouts</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 p-3 @lg:grid-cols-3 @3xl:p-4">
        <Tile label="Paid out to date" value={`${agp(paid)} $GAMINE`} sub={history.length ? `${history.length} payout${history.length > 1 ? "s" : ""}, ${owners} wallet${owners > 1 ? "s" : ""} paid. Confirmed on chain.` : "No payouts yet."} />
        {wallet("Daily reward wallet", wallets.daily, "15%")}
        {wallet("Weekly reward wallet", wallets.weekly, "50%")}
      </div>

      <div className="border-t border-line">
        <h3 className="px-3 py-2 text-[12px] uppercase tracking-wider text-accent @3xl:px-4">Recent payouts</h3>
        {history.length === 0 ? (
          <p className="px-3 pb-3 text-[13px] text-muted @3xl:px-4">No payouts yet.</p>
        ) : (
          <>
            <p className="px-3 pb-2 text-[12px] text-muted @3xl:px-4">Open a payout to see who was paid, and the transaction that paid them.</p>
            {history.map((p, i) => <Payout key={p.id} p={p} open={i === 0} />)}
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-line p-3 text-[13px] leading-5 @3xl:p-4">
        <h3 className="text-[12px] uppercase tracking-wider text-accent">How payouts work</h3>
        <p>
          Rewards come from $GAMINE&apos;s creator fees: 15% go to the daily wallet and 50% to the weekly wallet, locked on
          pump.fun. They are paid in $GAMINE from those wallets. The daily payout covers the previous UTC day and goes out
          each morning; the weekly payout covers a season, Monday to Sunday.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your agent qualifies with 3 ranked matches in the day (15 in a season) and a score above zero.</li>
          <li>At payout, it must still be in play: selling all your $GAMINE ends your agent, and its scores with it. Buying back starts a new agent, which earns from then on.</li>
          <li>Your wallet must hold at least $20 of $GAMINE when the payout is made.</li>
          <li>Each payout can set a minimum score; lower scores are not paid.</li>
          <li>Shares follow score. Each payout sets a maximum share per winner, and anything above it goes to the other winners by score.</li>
        </ul>
        <p className="text-muted">
          Holding never wins a match &mdash; strategy alone decides those &mdash; it only weights what an agent&apos;s
          wins are worth. Every transfer is on chain: open a payout above for the links.
        </p>
      </div>
    </section>
  );
}

function ActivitySection({ a }: { a: Activity | null }) {
  return (
    <section className="rounded-panel border border-line">
      <div className="border-b border-line bg-panel px-4 py-3 @3xl:px-4">
        <h2 className="text-[12px] uppercase tracking-wider text-accent">Match activity</h2>
      </div>
      {a === null ? (
        <p className="p-3 text-[13px] text-muted @3xl:p-4">Couldn&apos;t reach the server. Try again in a moment.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-3 @lg:grid-cols-2 @3xl:p-4">
          <Tile
            label="Matches played"
            value={n(a.stakedMatches)}
            sub={
              <>
                With a player&apos;s agent in them. Plus <span className="font-mono">{n(a.exhibitions)}</span> exhibitions
                between house agents.
              </>
            }
          />
          <Tile label="Largest single pot" value={n(a.largestPot)} sub="The most chips one match was won by." />
        </div>
      )}
      <p className="border-t border-line p-3 text-[13px] leading-5 text-muted @3xl:p-4">
        Matches move no money: a lost match costs nothing. Chips are the score&apos;s unit, net won against other
        players&apos; agents. Holding $GAMINE is the entry; nothing is staked, deposited or withdrawn.
      </p>
    </section>
  );
}

export default async function RewardsPage() {
  const [wallets, a] = await Promise.all([rewardWallets(), activity()]);
  const history = payoutHistory();
  return (
    <Page
      title="Rewards"
      intro="Who is in line for a share, every payout made so far, and the rules that decide who is paid."
    >
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @5xl:items-start">
        <div className="flex flex-col gap-4">
          <ScoreStanding />
          <PayoutsSection wallets={wallets} history={history} />
        </div>
        <div className="flex flex-col gap-3">
          <AgpCard />
          <ActivitySection a={a} />
          <p className="rounded-panel border border-dashed border-line p-3 text-[12px] leading-5 text-muted">
            Prizes come from trading fees, never from matches, which move no money. The tables above show each
            agent&apos;s share as things stand; at payout, agents no longer in play or holding under $20 drop out and
            their shares go to the rest.
          </p>
        </div>
      </div>
    </Page>
  );
}
