"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { planDays, planPeriod, type HeldPayoutInput, type PayoutInput, type PayoutPlan } from "@/lib/payout-plan";
import type { PayoutExecutionView } from "@/lib/payout-execution";
import { useWallet } from "@/app/wallet-context";
import { signTransactionWith, type WalletName } from "@/lib/wallet";
import { CopyButton } from "@/app/copy-button";

type Balance = { sol: number; agp: number | null } | null;
type Overview = {
  plans: PayoutPlan[]; agpMint: string | null; executionConnected: boolean; swapsConnected: boolean; executionMissing: string[];
  executions: PayoutExecutionView[]; balances?: { daily: Balance; weekly: Balance }; nextDaily?: string | null;
};
const units = (value: string, decimals: number) => {
  const n = BigInt(value), scale = 10n ** BigInt(decimals);
  const fraction = decimals ? (n % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${(n / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
};
const sol = (value: string) => units(value, 9);
/** A plan's amount in its own unit: SOL for a swap plan, $GAMINE for a held one. */
const amount = (plan: PayoutPlan, value: string) => plan.funding === "held" ? `${units(value, plan.decimals ?? 0)} $GAMINE` : `${sol(value)} SOL`;
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
const today = () => new Date().toISOString().slice(0, 10);
/** Above the payout's fee reserve, with room for a few transactions. */
const LOW_SOL = 0.06;

// Every control that does something looks like a button; links look like links.
const primary = "rounded-panel bg-accent px-4 py-2 font-medium text-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const secondary = "rounded-panel border border-line bg-panel-2 px-4 py-2 text-text hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";
const danger = "rounded-panel border border-loss/60 bg-panel-2 px-4 py-2 text-loss hover:border-loss disabled:cursor-not-allowed disabled:opacity-40";
const link = "text-accent underline underline-offset-2 hover:brightness-125";
const control = "mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-text";

/** Where a plan stands, in words and a colour: drafts are never paid; an approved plan is paid once started. */
function standing(plan: PayoutPlan, run?: PayoutExecutionView) {
  if (plan.status === "cancelled") return { label: "Cancelled", tone: "border-loss/60 text-loss" };
  if (plan.status === "draft") return { label: "Draft · not paid", tone: "border-line text-muted" };
  if (run?.status === "completed") return { label: "Paid", tone: "border-live/60 text-live" };
  if (run?.status === "paused") return { label: "Paused", tone: "border-gold/60 text-gold" };
  if (run) return { label: "Paying", tone: "border-accent text-accent" };
  return { label: "Approved · not started", tone: "border-gold/60 text-gold" };
}
function Badge({ plan, run }: { plan: PayoutPlan; run?: PayoutExecutionView }) {
  const { label, tone } = standing(plan, run);
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>{label}</span>;
}

export function PayoutPanel({ token }: { token: string }) {
  const { session, signTransaction } = useWallet();
  const [signer, setSigner] = useState<WalletName>("Phantom");
  const [input, setInput] = useState<PayoutInput>({ kind: "daily", period: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), budgetSol: "", rewardPercent: "100", batchSol: "0.25", delaySeconds: 60, slippageBps: 50 });
  const [funding, setFunding] = useState<"held" | "swap">("held");
  const [budgetAgp, setBudgetAgp] = useState("");
  const [minScore, setMinScore] = useState("15");
  const [periodEnd, setPeriodEnd] = useState("");
  const [capPercent, setCapPercent] = useState("10");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PayoutPlan | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  const opened = useRef(false);
  const planRef = useRef<HTMLDivElement>(null);

  const call = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`/api/admin/payouts/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Payout request failed.");
    return value as T;
  }, [token]);
  const load = useCallback(async () => { setOverview(await call<Overview>("plans")); }, [call]);
  useEffect(() => { setOverview(null); void load().catch((e) => setFormError(e.message)); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load().catch(() => {}), 5_000);
    return () => clearInterval(timer);
  }, [load]);

  const runOf = (id: string) => overview?.executions?.find((run) => run.planId === id);
  const ready = (overview?.plans ?? []).filter((p) => p.status === "approved" && runOf(p.id)?.status !== "completed");
  // The plan on screen, always as the server last reported it.
  const plan = (planId && overview?.plans.find((p) => p.id === planId)) || (draft?.id === planId ? draft : null);
  const execution = plan ? runOf(plan.id) : undefined;

  useEffect(() => {
    if (!overview) return;
    // Start the form at the next unpaid day, and open a payout that is waiting to be paid.
    if (!touched.current && overview.nextDaily) setInput((old) => ({ ...old, period: overview.nextDaily! }));
    if (!opened.current) { opened.current = true; if (ready[0]) setPlanId(ready[0].id); }
  }, [overview]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(id: string) { setPlanId(id); setPlanError(null); setTimeout(() => planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
  function edited() { touched.current = true; setDraft(null); setFormError(null); }
  function change<K extends keyof PayoutInput>(key: K, value: PayoutInput[K]) { edited(); setInput((old) => ({ ...old, [key]: value })); }

  async function preview() {
    setBusy(true); setFormError(null);
    try {
      const held: HeldPayoutInput & { funding: "held" } = { funding: "held", kind: input.kind, period: input.period, budgetAgp, rewardPercent: input.rewardPercent };
      const result = await call<PayoutPlan>("preview", { ...(funding === "held" ? held : input), minScore, capPercent, ...(input.kind === "daily" && periodEnd ? { periodEnd } : {}) });
      setDraft(result); await load(); open(result.id);
    } catch (e) { setFormError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function planAction(action: "approve" | "cancel" | "start" | "pause" | "resume" | "prepare") {
    if (!plan || !session) return;
    setBusy(true); setPlanError(null);
    try {
      const result = await call<{ transaction?: { prepared: string; source: string } | null }>(`${plan.id}/${action}`, {});
      if (action === "prepare" && result.transaction) {
        // The operator session authorizes the API; only the reward wallet signs spending.
        const signed = session.wallet === "Privy" && session.ownerId === result.transaction.source
          ? await signTransaction(result.transaction.prepared)
          : await signTransactionWith({ ...session, wallet: signer, ownerId: result.transaction.source }, result.transaction.prepared);
        await call(`${plan.id}/submit`, { signed });
      }
      await load();
    } catch (e) { setPlanError((e as Error).message); }
    finally { setBusy(false); }
  }

  const kindBalance = overview?.balances?.[input.kind] ?? null;
  const backwards = input.kind === "daily" && !!periodEnd && periodEnd < input.period;
  const notOver = input.kind === "daily" && (input.period >= today() || (!!periodEnd && periodEnd >= today()));
  const wanted = Number(budgetAgp.replaceAll(",", ""));
  const overBalance = funding === "held" && kindBalance?.agp != null && wanted > kindBalance.agp;
  // An approved plan already paying any of a draft's days: a day is paid once (payout-store.ts), so that draft can never be approved.
  const clashOf = (draft: PayoutPlan) => draft.status !== "draft" ? undefined : (overview?.plans ?? []).find((other) => other.id !== draft.id && other.status === "approved" && other.kind === draft.kind
    && (draft.kind === "daily" ? planDays(other).some((day) => planDays(draft).includes(day)) : other.period === draft.period));
  const clash = plan ? clashOf(plan) : undefined;
  const stale = (overview?.plans ?? []).filter((item) => clashOf(item));
  const listed = (overview?.plans ?? []).filter((item) => !clashOf(item));
  async function remove(ids: string[]) {
    if (!confirm(ids.length > 1 ? `Delete these ${ids.length} drafts? They were never paid.` : "Delete this draft? It was never paid.")) return;
    setBusy(true); setPlanError(null);
    try {
      for (const id of ids) await call(`${id}/delete`, {});
      if (planId && ids.includes(planId)) setPlanId(null);
      await load();
    } catch (e) { setPlanError((e as Error).message); }
    finally { setBusy(false); }
  }
  const row = (item: PayoutPlan) => <li key={item.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-panel border px-3 py-2 ${item.id === planId ? "border-accent bg-panel-2" : "border-line bg-panel-2/60"}`}>
    <button type="button" onClick={() => open(item.id)} className="text-left hover:text-accent"><span className="text-text">{item.kind} · {planPeriod(item)}</span> <span className="text-muted">· {amount(item, item.allocatedLamports)} to {item.winners.length} winners · {new Date(item.createdAt).toLocaleString()}</span></button>
    <span className="flex items-center gap-2"><Badge plan={item} run={runOf(item.id)} />
      <button type="button" onClick={() => open(item.id)} className={`${secondary} px-3 py-1`}>Open →</button>
      {item.status === "draft" ? <button type="button" disabled={busy} onClick={() => void remove([item.id])} className={`${danger} px-3 py-1`}>Delete</button> : null}</span>
  </li>;

  return <section className="rounded-panel border border-line bg-panel p-4 text-[13px]">
    <h2 className="text-accent uppercase tracking-wider">Reward payouts</h2>
    <ol className="mt-3 grid gap-2 sm:grid-cols-3">
      {["Fill in the payout and press Preview", "Check who is paid, then Approve", "Start, then approve each transfer in the reward wallet"].map((text, i) =>
        <li key={i} className="rounded border border-line bg-panel-2 px-3 py-2"><span className="mr-2 font-mono text-accent">{i + 1}</span>{text}</li>)}
    </ol>
    {overview && !overview.executionConnected ? <p className="mt-3 text-gold">Payout execution needs configuration: {overview.executionMissing.join(", ")}.</p> : null}

    {ready.length ? <div className="mt-4 space-y-2">
      {ready.map((p) => <div key={p.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-panel border-2 px-3 py-3 ${p.id === planId ? "border-accent" : "border-gold/60"}`}>
        <div><p className="font-medium text-text">Ready to pay: {p.kind} · {planPeriod(p)}</p><p className="text-muted">{amount(p, p.allocatedLamports)} to {p.winners.length} winners · <Badge plan={p} run={runOf(p.id)} /></p></div>
        <button className={primary} onClick={() => open(p.id)}>{p.id === planId ? "Open below ↓" : "Open and pay →"}</button>
      </div>)}
    </div> : null}

    <h3 className="mt-6 text-[14px] font-medium text-text"><span className="mr-2 font-mono text-accent">1</span>New payout plan</h3>
    <div className="mt-2 grid gap-3 sm:grid-cols-2">
      <label className="sm:col-span-2">Funding<select className={control} value={funding} onChange={(e) => { edited(); setFunding(e.target.value as "held" | "swap"); }}>
        <option value="held">$GAMINE already in the reward wallet</option>
        <option value="swap" disabled={!overview?.swapsConnected}>Swap SOL into $GAMINE during the payout{overview?.swapsConnected ? "" : " (needs JUPITER_API_KEY)"}</option>
      </select></label>
      <label>Reward wallet<select className={control} value={input.kind} onChange={(e) => change("kind", e.target.value as PayoutInput["kind"])}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
        <span className={kindBalance && kindBalance.sol < LOW_SOL ? "text-loss" : "text-muted"}>{kindBalance ? `Holds ${kindBalance.agp?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "?"} $GAMINE · ${kindBalance.sol.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL${kindBalance.sol < LOW_SOL ? ` — add SOL: payouts keep ${LOW_SOL} for fees` : ""}` : "Balance loading…"}</span></label>
      <label>{input.kind === "daily" ? "First day (UTC)" : "Week starting (Monday, UTC)"}<input type="date" className={control} value={input.period} onChange={(e) => change("period", e.target.value)} />
        <span className="text-muted">{input.kind === "daily" ? (overview?.nextDaily ? `Next unpaid day: ${overview.nextDaily}.` : "A day can be paid once it is over in UTC.") : "The Monday that started the completed week."}</span></label>
      {input.kind === "daily" ? <label>Last day (UTC, optional)<input type="date" className={control} value={periodEnd} onChange={(e) => { edited(); setPeriodEnd(e.target.value); }} />
        <span className="text-muted">Only to pay several days at once (each agent&apos;s scores are added up). Leave empty for one day.</span>
        {periodEnd ? <button type="button" className={`${link} ml-1`} onClick={() => { edited(); setPeriodEnd(""); }}>Clear</button> : null}</label> : null}
      {funding === "held"
        ? <label>$GAMINE to pay out<input className={control} inputMode="decimal" value={budgetAgp} onChange={(e) => { edited(); setBudgetAgp(e.target.value); }} placeholder="1000000" />
          <span className="text-muted">At most what the wallet holds.</span>
          {kindBalance?.agp ? <button type="button" className={`${link} ml-1`} onClick={() => { edited(); setBudgetAgp(String(Math.floor(kindBalance.agp!))); }}>Use all {Math.floor(kindBalance.agp).toLocaleString("en-US")}</button> : null}</label>
        : <label>SOL budget (excluding network fees)<input className={control} inputMode="decimal" value={input.budgetSol} onChange={(e) => change("budgetSol", e.target.value)} placeholder="10" /></label>}
      <label>Minimum score<input className={control} inputMode="decimal" value={minScore} onChange={(e) => { edited(); setMinScore(e.target.value); }} /><span className="text-muted">Lower scores are not paid. Only agents still in play and holding $20 of their token are paid; dropped shares go to the rest.</span></label>
      <label>Maximum share per winner (%)<input className={control} inputMode="decimal" value={capPercent} onChange={(e) => { edited(); setCapPercent(e.target.value); }} /><span className="text-muted">What the cap holds back goes to the others by score: the whole amount is paid once winners × cap reach 100%.</span></label>
      <label>Payout percentage<input className={control} inputMode="decimal" value={input.rewardPercent} onChange={(e) => change("rewardPercent", e.target.value)} /><span className="text-muted">The rest stays in the reward wallet. The platform takes no cut.</span></label>
      {funding === "swap" ? <>
        <label>Maximum SOL per swap batch<input className={control} inputMode="decimal" value={input.batchSol} onChange={(e) => change("batchSol", e.target.value)} /></label>
        <label>Minimum delay between batches (seconds)<input type="number" min={30} className={control} value={input.delaySeconds} onChange={(e) => change("delaySeconds", Number(e.target.value))} /></label>
        <label>Maximum slippage (basis points)<input type="number" min={1} max={500} className={control} value={input.slippageBps} onChange={(e) => change("slippageBps", Number(e.target.value))} /><span className="text-muted">50 basis points = 0.5%.</span></label>
      </> : null}
    </div>
    {backwards ? <p className="mt-3 text-loss">The last day is before the first day. <button type="button" className={link} onClick={() => { edited(); const first = input.period; setInput((old) => ({ ...old, period: periodEnd })); setPeriodEnd(first); }}>Swap them</button></p> : null}
    {notOver && !backwards ? <p className="mt-3 text-gold">That day is not over yet in UTC, so its scores are not frozen: preview will refuse it.</p> : null}
    {overBalance ? <p className="mt-3 text-gold">That is more $GAMINE than the {input.kind} wallet holds.</p> : null}
    <button disabled={busy || backwards} onClick={() => void preview()} className={`mt-4 ${primary}`}>{busy && !plan ? "Reading every winner's wallet… (up to a minute)" : "Preview payout plan"}</button>
    {formError ? <p className="mt-3 rounded border border-loss/60 px-3 py-2 text-loss" role="alert">{formError}</p> : null}

    {plan ? <div ref={planRef} className="mt-6 rounded-panel border border-accent/60 bg-panel-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-medium text-text"><span className="mr-2 font-mono text-accent">{plan.status === "draft" ? 2 : 3}</span>{plan.kind} · {planPeriod(plan)}</h3>
        <span className="flex items-center gap-3"><Badge plan={plan} run={execution} /><button type="button" className={link} onClick={() => { setPlanId(null); setPlanError(null); }}>Close</button></span>
      </div>
      <p className="mt-2">{plan.funding === "held" ? "Paid to winners" : "Swap allocation"}: <strong>{amount(plan, plan.allocatedLamports)}</strong> · Stays in the reward wallet: {amount(plan, plan.carryoverLamports)}</p>
      <p className="mt-1 text-muted">Minimum score {plan.minScore ?? 0} · Maximum share {(plan.capBps ?? 1_000) / 100}% · {plan.funding === "held" ? `${Math.ceil(plan.winners.length / 8)} wallet approvals (up to 8 winners each)` : `${plan.batchLamports.length} swap batches`}</p>
      {plan.dropped?.length ? <details className="mt-2"><summary className={`cursor-pointer ${link}`}>Show the {plan.dropped.length} winning agents not paid ({(["agent ended", "holds under $20", "below minimum score", "reward wallet"] as const).map(reason => [reason, plan.dropped!.filter(d => d.reason === reason).length] as const).filter(([, n]) => n).map(([reason, n]) => `${n} ${reason}`).join(", ")})</summary>
        <ul className="mt-1 text-muted">{plan.dropped.map(d => <li key={d.agentId} className="font-mono">{short(d.wallet)} · score {Math.round(d.score)} · {d.reason}</li>)}</ul></details> : null}
      {BigInt(plan.platformLamports) > 0n ? <p className="mt-2 text-gold">This older plan includes a platform cut. Preview a new plan before approval.</p> : null}
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr className="text-muted"><th className="py-1">Winner</th><th>Wallet</th><th>{plan.funding === "held" ? "$GAMINE" : "SOL allocation"}</th></tr></thead><tbody>{plan.winners.map((winner) => <tr key={winner.agentId} className="border-t border-line"><td className="py-2">{winner.name}</td><td className="font-mono">{short(winner.wallet)} <CopyButton value={winner.wallet} label="Copy" /></td><td>{amount(plan, winner.lamports)}</td></tr>)}</tbody></table></div>

      {plan.status === "draft" ? <div className="mt-4">
        {clash ? <p className="mb-2 text-gold">{planPeriod(clash)} is already approved, so these days cannot be approved again. <button type="button" className={link} onClick={() => open(clash.id)}>Open the approved plan</button>{runOf(clash.id) ? null : " (you can cancel it there if it has not started)"}.</p> : null}
        <span className="flex flex-wrap gap-3">
          <button disabled={busy || !plan.agpMint || BigInt(plan.platformLamports) > 0n || !!clash} onClick={() => void planAction("approve")} className={primary}>Approve this plan</button>
          <button disabled={busy} onClick={() => void remove([plan.id])} className={danger}>Delete draft</button>
        </span>
        <p className="mt-2 text-muted">Approving sends nothing. Drafts you do not approve are never paid.</p>
      </div> : null}
      {plan.status === "cancelled" ? <p className="mt-4 text-muted">This approval was cancelled before anything was sent. Preview a new plan to pay these days.</p> : null}
      {plan.status === "approved" && !execution ? <div className="mt-4 flex flex-wrap gap-3">
        <button disabled={busy || !overview?.executionConnected || (plan.funding !== "held" && !overview?.swapsConnected)} onClick={() => void planAction("start")} className={primary}>Start payout</button>
        <button disabled={busy} onClick={() => { if (confirm("Cancel this approval? Nothing has been sent; you can preview and approve a new plan for these days.")) void planAction("cancel"); }} className={danger}>Cancel approval</button>
      </div> : null}

      {execution ? <PayoutProgress plan={plan} execution={execution} signer={signer} setSigner={setSigner} busy={busy} act={(a) => void planAction(a)} /> : null}
      {planError ? <p className="mt-3 rounded border border-loss/60 px-3 py-2 text-loss" role="alert">{planError}</p> : null}
    </div> : null}

    {overview?.plans.length ? <div className="mt-6 border-t border-line pt-3">
      <h3 className="text-[14px] font-medium text-text">All plans</h3>
      <p className="text-muted">Open a plan to see its winners. Drafts are never paid; delete the ones you don&apos;t need.</p>
      <ul className="mt-2 space-y-2">{listed.map(row)}</ul>
      {stale.length ? <details className="mt-3">
        <summary className={`cursor-pointer ${link}`}>Show {stale.length} old draft{stale.length > 1 ? "s" : ""} (their days are already paid or approved)</summary>
        <ul className="mt-2 space-y-2">{stale.map(row)}</ul>
        <button type="button" disabled={busy} onClick={() => void remove(stale.map((item) => item.id))} className={`mt-2 ${danger}`}>Delete all {stale.length} old drafts</button>
      </details> : null}
      {planError && !plan ? <p className="mt-3 rounded border border-loss/60 px-3 py-2 text-loss" role="alert">{planError}</p> : null}
    </div> : null}
  </section>;
}

/** Step 3: one obvious next action at a time, with the signing account spelled out. */
function PayoutProgress({ plan, execution, signer, setSigner, busy, act }: {
  plan: PayoutPlan; execution: PayoutExecutionView; signer: WalletName; setSigner: (w: WalletName) => void; busy: boolean;
  act: (action: "pause" | "resume" | "prepare") => void;
}) {
  const batch = execution.batches[Math.min(execution.batch, execution.batches.length - 1)]!;
  const transfers = batch.transfers;
  const current = transfers.find((t) => !t.confirmed);
  const index = current ? transfers.indexOf(current) + 1 : transfers.length;
  const waitingFor = batch.output !== null && current?.tx?.signature ? index : null;
  const later = execution.nextAt > Date.now();
  const winners = batch.payments.length;
  return <div className="mt-4 border-t border-line pt-3">
    {execution.status !== "completed" ? <ol className="space-y-1">
      <li><span className="mr-2 font-mono text-accent">a</span>In {signer}, select the {plan.kind} reward wallet <span className="font-mono">{short(plan.source)}</span> <CopyButton value={plan.source} label="Copy address" />. Your admin sign-in stays as it is.</li>
      <li><span className="mr-2 font-mono text-accent">b</span>Press the button below and approve in {signer}. If {signer} asks to connect {short(plan.source)}, approve that too.</li>
    </ol> : null}
    {execution.status !== "completed" ? <label className="mt-2 block max-w-xs">Signing wallet extension<select className={control} value={signer} onChange={(e) => setSigner(e.target.value as WalletName)}><option>Phantom</option><option>Solflare</option></select></label> : null}
    {execution.error ? <p className="mt-3 text-loss">{execution.error}</p> : null}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {execution.status === "completed" ? <p className="text-[14px] text-live">All {winners} winners paid ✓</p>
        : execution.status === "paused" ? <button disabled={busy} onClick={() => act("resume")} className={primary}>Resume payout</button>
        : waitingFor ? <><button disabled className={primary}>Waiting for transfer {waitingFor} of {transfers.length} to confirm…</button><button disabled={busy} onClick={() => act("prepare")} className={secondary}>Check now</button></>
        : later ? <button disabled className={primary}>Next batch after {new Date(execution.nextAt).toLocaleTimeString()}</button>
        : <button disabled={busy} onClick={() => act("prepare")} className={primary}>{busy ? `Waiting for ${signer}…` : batch.output === null ? `Approve the next swap in ${signer}` : `Approve transfer ${index} of ${transfers.length} in ${signer}`}</button>}
      {execution.status === "running" ? <button disabled={busy} onClick={() => act("pause")} className={secondary}>Pause</button> : null}
    </div>
    {waitingFor ? <p className="mt-2 text-muted">Confirmation takes about 15–30 seconds; this updates by itself.</p> : null}
    <ul className="mt-3 space-y-1">
      {batch.swap?.signature ? <li><a target="_blank" rel="noreferrer" className={link} href={`https://solscan.io/tx/${batch.swap.signature}`}>Swap transaction ↗</a></li> : null}
      {transfers.map((t, i) => <li key={i} className="flex flex-wrap items-center gap-2">
        <span className={t.confirmed ? "text-live" : "text-muted"}>{t.confirmed ? "✓" : "○"} Transfer {i + 1} of {transfers.length} · {t.payments.length} winners · {t.confirmed ? "paid" : t.tx?.signature ? "sent, confirming" : "waiting for approval"}</span>
        {t.tx?.signature ? <a target="_blank" rel="noreferrer" className={link} href={`https://solscan.io/tx/${t.tx.signature}`}>View on Solscan ↗</a> : null}
      </li>)}
    </ul>
    {execution.failedAttempts?.length ? <details className="mt-3"><summary className={`cursor-pointer ${link}`}>Show {execution.failedAttempts.length} failed or expired attempts</summary>
      <ul className="mt-1 text-muted">{execution.failedAttempts.map((attempt, i) => <li key={i}>{attempt.signature ? <a className={link} href={`https://solscan.io/tx/${attempt.signature}`} target="_blank" rel="noreferrer">{attempt.outcome} ↗</a> : attempt.outcome}</li>)}</ul></details> : null}
  </div>;
}
