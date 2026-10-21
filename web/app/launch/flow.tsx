"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWallet } from "@/app/wallet-context";
import { PrivyOption } from "@/app/privy-option";
import { installUrl, shortKey, type WalletName } from "@/lib/wallet";
import {
  checkForm,
  checkImage,
  launchpad,
  stageLabel,
  STAGES,
  type FormErrors,
  type LaunchForm,
  type LaunchpadConfig,
  type LaunchStatus,
  type Stage,
  type StageState,
} from "@/lib/launchpad";
import { Board, FeeSplitBar, MockNote, TokenCard } from "./parts";
import { useLaunchConfig } from "./use-config";
import { pendingPumpLaunch, resumePumpLaunch } from "@/lib/launchpad-client";
import { solToLamports } from "@/lib/launchpad-validation";

type Step = "connect" | "details" | "review" | "launch" | "done";
const STEPS: { step: Step; label: string }[] = [
  { step: "connect", label: "Connect" },
  { step: "details", label: "Details" },
  { step: "review", label: "Review" },
  { step: "launch", label: "Launch" },
  { step: "done", label: "Live" },
];

type Draft = Omit<LaunchForm, "creator">;
const EMPTY: Draft = { name: "", ticker: "", description: "", image: "", links: {}, initialBuySol: "" };

/** How often the tracker asks after a launch. */
const POLL_MS = 500;

/**
 * Launching a token, every step on screen: connect, fill in, review the fee
 * split and acknowledge it, launch and watch each stage, then share. Goes
 * through the launchpad adapter only; nothing here signs or sends anything.
 */
export function LaunchFlow() {
  const { session, signTransaction } = useWallet();
  const { config, error: configError } = useLaunchConfig();
  const [step, setStep] = useState<Step>("connect");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [status, setStatus] = useState<LaunchStatus | null>(null);
  const [pending, setPending] = useState<ReturnType<typeof pendingPumpLaunch>>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  useEffect(() => { if (!launchpad.mock) setPending(pendingPumpLaunch()); }, [session]);

  // Signed in is step one done; signed out, back to it from anywhere short of a launch under way.
  useEffect(() => {
    if (session && step === "connect") setStep("details");
    if (!session && (step === "details" || step === "review")) setStep("connect");
  }, [session, step]);

  if (configError) return <Board sign="Launch a token">The launchpad could not be reached: {configError}</Board>;
  if (!config) return <Board sign="Launch a token">Loading…</Board>;

  const restart = () => {
    setLaunchId(null);
    setStatus(null);
    setStep("details");
  };

  return (
    <div className="space-y-3">
      {launchpad.mock ? <MockNote /> : null}
      {config.ready === false ? <Board sign="Launch setup">{config.unavailableReason}</Board> : null}
      {!config.agentsEnabled ? <p className="hud-card px-4 py-3 text-[12px] text-muted">Token launches are being integrated. Holder-agent activation will be available separately; launching currently creates the token and locks its creator fee split.</p> : null}
      {pending && step !== "launch" && step !== "done" ? (
        <Board sign="Resume previous launch">
          <p>A previous launch needs confirmation. Resume it before starting another to avoid a duplicate charge.</p>
          <button type="button" disabled={resuming} className="rounded-panel mt-3 bg-accent px-4 py-2 text-ink" onClick={async () => {
            setResuming(true); setResumeError(null);
            try { const resumed = await resumePumpLaunch(); if (resumed) { setDraft(pending.draft); setLaunchId(resumed.id); setStep("launch"); } }
            catch (error) { setResumeError((error as Error).message); }
            finally { setResuming(false); }
          }}>{resuming ? "Checking…" : "Resume launch"}</button>
          <button type="button" className="ml-3 text-accent underline" onClick={() => { setDraft(pending.draft); setLaunchId(pending.id); setStep("launch"); }}>Check status</button>
          {resumeError ? <p className="mt-2 text-loss">{resumeError}</p> : null}
        </Board>
      ) : null}
      <p className="hud-card px-4 py-3 text-[13px] leading-5">
        <span className="text-accent">Mandatory launch fee: {config.launchFeeLamports / 1_000_000_000} SOL per token.</span>{" "}
        This helps deter spam. Network costs and any optional initial token purchase are additional.
      </p>
      <p className="hud-card px-4 py-3 text-[13px] leading-5">
        <span className="text-accent">
          {config.launcherShare === 0
            ? "All of the token's creator fees go to Gamine's wallets. The launcher keeps none."
            : `${100 - config.launcherShare}% of the token's creator fees go to Gamine's wallets; the launcher keeps ${config.launcherShare}%.`}
        </span>{" "}
        {config.feeSplit.daily}% daily rewards, {config.feeSplit.weekly}% weekly rewards, {config.feeSplit.platform}% platform, locked at launch.
      </p>
      <Stepper current={step} />
      {step === "connect" ? <ConnectStep /> : null}
      {step === "details" ? <DetailsStep config={config} draft={draft} onChange={setDraft} onNext={() => setStep("review")} /> : null}
      {step === "review" && session ? (
        <ReviewStep
          config={config}
          draft={draft}
          onBack={() => setStep("details")}
          onLaunch={async (failAt) => {
            try {
              const { id } = await launchpad.createLaunch({ ...draft, creator: session.ownerId }, { failAt, signTransaction });
              setLaunchId(id);
              setStep("launch");
            } finally { if (!launchpad.mock) setPending(pendingPumpLaunch()); }
          }}
        />
      ) : null}
      {step === "launch" && launchId ? (
        <Tracker
          id={launchId}
          config={config}
          ticker={draft.ticker}
          onStatus={(s) => {
            setStatus(s);
            if (s.live || s.failure) setPending(null);
            if (s.live) setStep("done");
          }}
          onRestart={restart}
        />
      ) : null}
      {step === "done" && status?.mint ? (
        <>
          <StagesBoard status={status} config={config} />
          <Success mint={status.mint} draft={draft} agentsLive={status.stages.agentsLive === "done"} />
        </>
      ) : null}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const at = STEPS.findIndex((s) => s.step === current);
  return (
    <ol className="hud-card grid grid-cols-5 gap-1 p-2 text-center">
      {STEPS.map((s, i) => (
        <li key={s.step} aria-current={i === at ? "step" : undefined} className="min-w-0">
          <span
            className={`mx-auto flex h-7 w-7 items-center justify-center rounded-[3px] border-2 font-mono text-[13px] font-bold ${
              i < at ? "border-live bg-live/20 text-live" : i === at ? "border-wood-dark bg-wood text-[#f5ecd8]" : "border-line text-muted"
            }`}
          >
            {i < at ? "✓" : i + 1}
          </span>
          <span className={`mt-1 block truncate text-[11px] uppercase tracking-wide ${i === at ? "text-accent" : "text-muted"}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

// --- 1. Connect -------------------------------------------------------------

function ConnectStep() {
  const { wallets, busy, error, connect } = useWallet();
  const all: WalletName[] = ["Phantom", "Solflare"];
  return (
    <Board sign="Connect a wallet">
      <p>Sign in with the wallet that will launch the token.</p>
      <p className="mt-1 text-[12px] text-muted">Signing in is a message, not a transaction: it costs nothing and moves nothing.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {all.map((name) =>
          wallets.includes(name) ? (
            <button
              key={name}
              type="button"
              onClick={() => void connect(name)}
              disabled={busy === "connect"}
              className="rounded-panel bg-accent px-3 py-2 text-[13px] font-medium text-ink disabled:bg-line disabled:text-muted"
            >
              {busy === "connect" ? "Waiting…" : name}
            </button>
          ) : (
            <a
              key={name}
              href={installUrl(name)}
              target="_blank"
              rel="noreferrer"
              className="rounded-panel border border-line px-3 py-2 text-center text-[13px] text-muted"
            >
              Get {name}
            </a>
          ),
        )}
      </div>
      <PrivyOption label="No wallet? Sign in with email or X" />
      {error ? <p className="mt-2 text-loss">{error}</p> : null}
    </Board>
  );
}

// --- 2. Details -------------------------------------------------------------

const input =
  "rounded-panel w-full border border-line bg-black/40 px-3 py-2 text-[14px] text-text placeholder:text-muted/60 focus:border-accent focus:outline-none";

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | undefined; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-[12px] uppercase tracking-wide text-accent">
        {label}
        {hint ? <span className="normal-case tracking-normal text-muted">{hint}</span> : null}
      </span>
      <span className="mt-1 block">{children}</span>
      {error ? <span className="mt-1 block text-[12px] text-loss">{error}</span> : null}
    </label>
  );
}

function DetailsStep({
  config,
  draft,
  onChange,
  onNext,
}: {
  config: LaunchpadConfig;
  draft: Draft;
  onChange: (d: Draft) => void;
  onNext: () => void;
}) {
  const { session } = useWallet();
  const [tried, setTried] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const errors: FormErrors = checkForm(draft);
  const shown = (k: keyof FormErrors) => (tried ? errors[k] : undefined);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const setLink = (k: keyof Draft["links"], v: string) => set({ links: { ...draft.links, [k]: v.trim() || undefined } });

  const pick = (file: File | undefined) => {
    if (!file) return;
    const why = checkImage(file, config.maxImageBytes);
    setImageError(why);
    if (why) return set({ image: "" });
    const reader = new FileReader();
    reader.onload = () => set({ image: String(reader.result) });
    reader.onerror = () => setImageError("That image could not be read.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-[1fr_15rem]">
      <Board sign="The token">
        {session ? <p className="mb-3 text-[12px] text-muted">Launching from {shortKey(session.ownerId)}</p> : null}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (Object.keys(errors).length === 0 && !imageError) onNext();
          }}
        >
          <Field label="Name" error={shown("name")}>
            <input className={input} value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Doxie" />
          </Field>
          <Field label="Ticker" hint="2–10 letters or digits" error={shown("ticker")}>
            <input
              className={`${input} font-mono uppercase`}
              value={draft.ticker}
              maxLength={10}
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => set({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
              placeholder="DOX"
            />
          </Field>
          <Field label="Image" hint={`PNG, JPEG, GIF or WebP, up to ${(config.maxImageBytes / 1_000_000).toFixed(0)} MB`} error={imageError ?? shown("image")}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => pick(e.target.files?.[0])}
              className="block w-full text-[13px] text-muted file:mr-3 file:rounded-[3px] file:border-2 file:border-wood-dark file:bg-wood file:px-3 file:py-1.5 file:font-pixel file:text-[13px] file:font-bold file:text-[#f5ecd8]"
            />
          </Field>
          <Field label="Description" hint={`${draft.description.length}/500`} error={shown("description")}>
            <textarea className={`${input} min-h-20`} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-[12px] uppercase tracking-wide text-accent">Links · optional</legend>
            <Field label="X" error={shown("x")}>
              <input className={input} inputMode="url" value={draft.links.x ?? ""} onChange={(e) => setLink("x", e.target.value)} placeholder="https://x.com/…" />
            </Field>
            <Field label="Telegram" error={shown("telegram")}>
              <input className={input} inputMode="url" value={draft.links.telegram ?? ""} onChange={(e) => setLink("telegram", e.target.value)} placeholder="https://t.me/…" />
            </Field>
            <Field label="Website" error={shown("website")}>
              <input className={input} inputMode="url" value={draft.links.website ?? ""} onChange={(e) => setLink("website", e.target.value)} placeholder="https://…" />
            </Field>
          </fieldset>
          <Field label="Initial token purchase (SOL)" hint="Optional · 0 to skip" error={shown("initialBuySol")}>
            <input className={`${input} font-mono`} inputMode="decimal" value={draft.initialBuySol} onChange={(e) => set({ initialBuySol: e.target.value })} placeholder="0" />
          </Field>
          <p className="text-[12px] text-muted">Purchased tokens go to your wallet. This amount is additional to the mandatory {config.launchFeeLamports / 1_000_000_000} SOL platform fee and network costs.</p>
          <button type="submit" className="rounded-panel w-full bg-accent px-4 py-2.5 text-[14px] font-semibold text-ink hover:bg-accent/90">
            Review the launch
          </button>
          {tried && Object.keys(errors).length > 0 ? <p className="text-[12px] text-loss">Fix the fields marked above to continue.</p> : null}
        </form>
      </Board>
      <div className="space-y-2">
        <p className="hud-card px-3 py-2 text-[12px] uppercase tracking-wide text-accent">Preview</p>
        <TokenCard name={draft.name.trim()} ticker={draft.ticker} image={draft.image} description={draft.description.trim()} />
      </div>
    </div>
  );
}

// --- 3. Review --------------------------------------------------------------

function ReviewStep({
  config,
  draft,
  onBack,
  onLaunch,
}: {
  config: LaunchpadConfig;
  draft: Draft;
  onBack: () => void;
  onLaunch: (failAt: Stage | null) => Promise<void>;
}) {
  const [agreed, setAgreed] = useState(false);
  const [failAt, setFailAt] = useState<Stage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { feeSplit: s, launcherShare } = config;
  const t = `$${draft.ticker}`;
  const splitText = `${s.daily}/${s.weekly}/${s.platform}`;

  return (
    <div className="space-y-3">
      <TokenCard name={draft.name.trim()} ticker={draft.ticker} image={draft.image} description={draft.description.trim()} />

      <Board sign="Launch costs">
        <p><span className="text-accent">Platform launch fee: {config.launchFeeLamports / 1_000_000_000} SOL.</span> Required for every token launched here to help deter spam.</p>
        <p className="mt-2">Network costs and any optional initial token purchase are additional. The launch fee does not buy tokens.</p>
        <p className="mt-2">Initial buy: {solToLamports(draft.initialBuySol) / 1_000_000_000} SOL. Platform fee + initial buy: {(config.launchFeeLamports + solToLamports(draft.initialBuySol)) / 1_000_000_000} SOL, plus account rent and network fees.</p>
        {!launchpad.mock ? <p className="mt-2 text-[12px] text-muted">Creation, the locked fee split, your optional buy and the platform fee share one transaction. If the transaction fails, the platform fee and purchase are not charged; network fees may still apply.</p> : null}
        <p className="mt-2 text-[12px] text-muted">
          Paid to Gamine&apos;s platform wallet:{" "}
          <a href={`https://solscan.io/account/${config.launchFeeRecipient}`} target="_blank" rel="noreferrer" className="text-accent underline" title={config.launchFeeRecipient}>
            {shortKey(config.launchFeeRecipient)}
          </a>
        </p>
        {launchpad.mock ? <p className="mt-2 text-[12px] text-muted">Preview only: no SOL is charged.</p> : null}
      </Board>

      <Board sign="Where the creator fees go">
        <FeeSplitBar split={s} launcherShare={launcherShare} />
        <ul className="mt-3 space-y-2">
          <li>
            <span className="text-accent">What you give up.</span>{" "}
            {launcherShare === 0
              ? `All of ${t}'s pump.fun creator fees. They go to Gamine's three wallets: ${s.daily}% to the daily reward wallet, ${s.weekly}% to the weekly reward wallet, ${s.platform}% to the platform. You keep none of them.`
              : `${100 - launcherShare}% of ${t}'s pump.fun creator fees: ${s.daily}% to the daily reward wallet, ${s.weekly}% to the weekly reward wallet, ${s.platform}% to the platform. The launcher's share is ${launcherShare}%.`}
          </li>
          <li>
            <span className="text-accent">{config.agentsEnabled ? "What holders get." : "Planned holder agents."}</span> {config.agentsEnabled ? "Every" : "Once holder-agent activation is available, every"} wallet holding at least ${config.minimumUsd} of {t} gets an agent in
            the village, one per wallet, with its own conviction clock. {t}&apos;s agents play Bluff &amp; Fold against every other agent
            there, $GAMINE agents and other launches&apos; agents included. Strategy alone decides each match; holding never does.
          </li>
          <li>
            <span className="text-accent">How results count.</span> Winners share one pool across every token, paid in $GAMINE. A {t} agent&apos;s
            score is points × weight × {config.launchMultiplier.toFixed(1)}; a $GAMINE agent&apos;s is × {config.agpMultiplier.toFixed(1)}.
            {config.perTokenCap !== null ? ` No one token's agents take more than ${config.perTokenCap}% of a payout.` : ""}
          </li>
          <li>
            <span className="text-accent">Locked at launch.</span> The split is set once on pump.fun and cannot be changed afterwards. If it is
            ever found changed, {t} is removed from the game and its agents leave the village.
          </li>
        </ul>
      </Board>

      <Board sign="Launch">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            I agree to the mandatory {config.launchFeeLamports / 1_000_000_000} SOL launch fee, plus network costs and any initial token purchase.{" "}
            I understand that {launcherShare === 0 ? "all" : `${100 - launcherShare}%`} of {t}&apos;s creator fees go to Gamine&apos;s wallets,
            split {splitText}, {launcherShare === 0 ? "that I keep none of them, " : ""}and that the split cannot be changed after launch.
          </span>
        </label>

        {launchpad.mock ? (
          <label className="rounded-panel mt-3 flex flex-wrap items-center gap-2 border border-dashed border-accent/60 px-3 py-2 text-[12px] text-accent">
            Mock: fail at
            <select
              value={failAt ?? ""}
              onChange={(e) => setFailAt((e.target.value || null) as Stage | null)}
              className="rounded-panel border border-line bg-black/60 px-2 py-1 text-text"
            >
              <option value="">no stage (succeed)</option>
              {STAGES.map((st) => (
                <option key={st} value={st}>
                  {stageLabel(st, s)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={onBack} className="rounded-panel border border-line px-4 py-2.5 text-[13px] text-muted hover:text-text">
            Back
          </button>
          <button
            type="button"
            disabled={!agreed || sending || config.ready === false}
            onClick={() => {
              setSending(true);
              setError(null);
              onLaunch(failAt).catch((e: Error) => {
                setError(e.message);
                setSending(false);
              });
            }}
            className="rounded-panel bg-accent px-4 py-2.5 text-[14px] font-semibold text-ink hover:bg-accent/90 disabled:bg-line disabled:text-muted"
          >
            {sending ? "Starting…" : `Launch ${t}`}
          </button>
        </div>
        {error ? <p className="mt-2 text-loss">{error}</p> : null}
      </Board>
    </div>
  );
}

// --- 4. The tracker ---------------------------------------------------------

const MARK: Record<StageState, { icon: string; tone: string; word: string }> = {
  pending: { icon: "○", tone: "border-line text-muted", word: "Waiting" },
  "in-progress": { icon: "…", tone: "border-accent text-accent live-blink", word: "In progress" },
  done: { icon: "✓", tone: "border-live bg-live/15 text-live", word: "Done" },
  failed: { icon: "✗", tone: "border-loss bg-loss/15 text-loss", word: "Failed" },
};

function StagesBoard({ status, config }: { status: LaunchStatus; config: LaunchpadConfig }) {
  return (
    <Board sign="Launch status">
      <ol className="space-y-2" aria-live="polite">
        {STAGES.map((stage) => {
          const state = status.stages[stage];
          const m = MARK[state];
          return (
            <li key={stage} className="flex items-center gap-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border-2 font-mono text-[14px] font-bold ${m.tone}`}>
                {m.icon}
              </span>
              <span className={`min-w-0 flex-1 ${state === "pending" ? "text-muted" : "text-text"}`}>{stageLabel(stage, config.feeSplit)}</span>
              <span className={`shrink-0 font-mono text-[11px] uppercase tracking-wider ${state === "failed" ? "text-loss" : state === "done" ? "text-live" : "text-muted"}`}>
                {m.word}
              </span>
            </li>
          );
        })}
      </ol>
      {status.failure ? (
        <p className="rounded-panel mt-3 border border-loss/60 bg-loss/10 px-3 py-2 text-loss" role="alert">
          {status.failure.message}
        </p>
      ) : null}
      <p className="mt-3 text-[12px] text-muted">{config.agentsEnabled ? "Agents go live only once the token is verified on chain." : "Holder-agent activation is not connected yet. Token creation and fee verification can complete independently."}</p>
    </Board>
  );
}

function Tracker({
  id,
  config,
  ticker,
  onStatus,
  onRestart,
}: {
  id: string;
  config: LaunchpadConfig;
  ticker: string;
  onStatus: (s: LaunchStatus) => void;
  onRestart: () => void;
}) {
  const [status, setStatus] = useState<LaunchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useRef(onStatus);
  report.current = onStatus;

  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout>;
    const ask = () =>
      launchpad.getLaunchStatus(id).then(
        (s) => {
          if (gone) return;
          setStatus(s);
          report.current(s);
          if (!s.live && !s.failure) timer = setTimeout(ask, POLL_MS);
        },
        (e: Error) => {
          if (gone) return;
          setError(e.message);
          timer = setTimeout(ask, POLL_MS * 4);
        },
      );
    void ask();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (!status) return <Board sign="Launch status">{error ? `The launch status could not be read: ${error}` : `Starting $${ticker}…`}</Board>;
  return (
    <div className="space-y-3">
      <StagesBoard status={status} config={config} />
      {status.failure ? (
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
          {status.mint ? (
            <Link href={`/launch/${status.mint}`} className="rounded-panel border border-line px-4 py-2.5 text-center text-[13px] text-text hover:border-accent">
              See ${ticker}&apos;s page
            </Link>
          ) : null}
          <button type="button" onClick={onRestart} className="rounded-panel bg-accent px-4 py-2.5 text-[14px] font-semibold text-ink hover:bg-accent/90">
            Start again
          </button>
        </div>
      ) : null}
    </div>
  );
}

// --- 5. Success -------------------------------------------------------------

function Success({ mint, draft, agentsLive }: { mint: string; draft: Draft; agentsLive: boolean }) {
  const [copied, setCopied] = useState(false);
  const page = `/launch/${mint}`;
  const url = typeof window === "undefined" ? page : `${window.location.origin}${page}`;
  const text = `$${draft.ticker} launched on Gamine.${agentsLive ? " Qualifying holders get an agent in the village, playing Bluff & Fold." : ""}`;
  return (
    <Board sign="Live">
      <p>${draft.ticker} is on pump.fun and verified on chain. {agentsLive ? "Its agents are in the village." : "Its creator fee split is locked. Holder-agent activation is pending."}</p>
      <div className="mt-3">
        <TokenCard
          name={draft.name.trim()}
          ticker={draft.ticker}
          image={draft.image}
          description={draft.description.trim()}
          footer={<p className="text-[12px] text-muted">{agentsLive ? `Hold $${draft.ticker}, get an agent. Gamine.` : "Launched through Gamine."}</p>}
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 @md:grid-cols-2">
        <Link href={page} className="rounded-panel bg-accent px-4 py-2.5 text-center text-[14px] font-semibold text-ink hover:bg-accent/90">
          ${draft.ticker}&apos;s page
        </Link>
        <a
          href={`https://pump.fun/coin/${mint}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-panel border border-line px-4 py-2.5 text-center text-[13px] text-text hover:border-accent"
        >
          On pump.fun ↗
        </a>
        <a
          href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-panel border border-line px-4 py-2.5 text-center text-[13px] text-text hover:border-accent"
        >
          Share on X ↗
        </a>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(url).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
          className="rounded-panel border border-line px-4 py-2.5 text-[13px] text-text hover:border-accent"
        >
          {copied ? "Link copied" : "Copy the link"}
        </button>
      </div>
    </Board>
  );
}
