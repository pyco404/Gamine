"use client";

import Link from "next/link";
import { readStoredValue, removeStoredValue } from "@/lib/browser-storage";

import { AgentName } from "@/app/agent-name";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Transcript } from "@/app/transcript";
import { BluffCard, useFeed } from "@/app/feed";
import { Segmented } from "@/app/ui";
import { PrivyOption } from "@/app/privy-option";
import { useWallet } from "@/app/wallet-context";
import { FaucetPanel } from "@/app/faucet-panel";
import { CharacterBlock } from "@/app/character";
import { AutoplayPanel } from "@/app/autoplay-panel";
import { HoldingCheck, PowerPanel } from "@/app/holder-panel";
import { Page, PageNote } from "@/app/site-header";
import { useCountUp } from "@/lib/motion";
import { netFill, netTone } from "@/lib/tone";
import {
  installUrl,
  type WalletName,
} from "@/lib/wallet";
import {
  api,
  ApiError,
  MIN_FUNDING_CHIPS,
  type Feed,
  type AgentView,
  type HolderView,
  type HoldingView,
  type PlayResult,
  type Preset,
  type Preview,
} from "@/lib/api";

const AGENT_KEY = "gamine.agent";

/** Agent views carry their id under either name, depending on the route that made them. */
const idOf = (a: AgentView) => (a.id ?? a.agentId)!;
const BRIEF_DEBOUNCE_MS = 1500;

const money = (n: number, digits = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
const whole = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

export default function Home({ initialFeed }: { initialFeed: Feed | null }) {
  const feed = useFeed(initialFeed);
  // Sign-in is site-wide: the mobile top bar and this page share one session.
  const wallet = useWallet();
  const { session, wallets } = wallet;
  const token = session?.token ?? null;
  const [agent, setAgent] = useState<AgentView | null>(null);
  /** The open agent's wallet, clock and power, when it is a holder agent. */
  const [holder, setHolder] = useState<HolderView | null>(null);
  /** This wallet's holding, on the holder flow: what the rent screen checks against the minimum. */
  const [selectedMint, setSelectedMint] = useState("");
  const [tokenHoldings, setTokenHoldings] = useState<{ mint: string; name: string; symbol: string; holding: HoldingView }[]>([]);
  const [holding, setHolding] = useState<HoldingView | null>(null);
  // Every agent this wallet owns, from the server: the same list on every device.
  const [mine, setMine] = useState<AgentView[]>([]);
  const [tab, setTab] = useState<"preset" | "brief">("preset");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [chosen, setChosen] = useState<string>("");
  const [brief, setBrief] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<{ value: Preview; paid: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [autoPreview, setAutoPreview] = useState(true);
  const [paidCalls, setPaidCalls] = useState(0);
  const [firstFreeUsed, setFirstFreeUsed] = useState(false);
  const [presetRatings, setPresetRatings] = useState<Record<string, number>>({});
  /** The table the last brief preview elicited. */
  const [briefTable, setBriefTable] = useState<unknown>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [lastPlay, setLastPlay] = useState<PlayResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const briefTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Unreachable server: try again shortly, rather than leave the rent form without presets for good.
    let gone = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api.presets().then(
        (r) => {
          if (gone) return;
          setPresets(r.presets);
          setChosen((c) => c || r.presets[0]?.name || "");
        },
        () => {
          if (!gone) retry = setTimeout(load, 10_000);
        },
      );
    void load();
    return () => {
      gone = true;
      clearTimeout(retry);
    };
  }, []);

  // Signing out, from here or the top bar, puts the agent card away.
  useEffect(() => {
    if (!session) {
      setAgent(null);
      setMine([]);
    }
  }, [session]);

  const connect = (name: WalletName) => void wallet.connect(name);

  const refreshAgent = useCallback(
    async (id: string, sessionToken: string | null) => {
      try {
        const { agent: fresh, holder: wallet } = await api.agent(sessionToken, id);
        setAgent({ ...fresh, id });
        setHolder(wallet ?? null);
      } catch {
        removeStoredValue(localStorage, AGENT_KEY);
        setAgent(null);
        setHolder(null);
      }
    },
    [],
  );

  /**
   * The wallet's agents come from the server, so every device shows the same
   * ones. localStorage only remembers which of them this device had open.
   */
  const loadMine = useCallback(
    async (sessionToken: string) => {
      const { agents: owned, holding: held, tokenHoldings: holdingsByToken } = await api.me(sessionToken);
      setMine(owned);
      setHolding(held);
      setTokenHoldings(holdingsByToken ?? []);
      const inPlay = owned.filter((a) => !a.retired);
      const saved = readStoredValue(localStorage, AGENT_KEY);
      const open = inPlay.find((a) => idOf(a) === saved) ?? inPlay[0] ?? null;
      if (open) {
        localStorage.setItem(AGENT_KEY, idOf(open));
        await refreshAgent(idOf(open), sessionToken);
      } else {
        removeStoredValue(localStorage, AGENT_KEY);
        setAgent(null);
      }
    },
    [refreshAgent],
  );

  useEffect(() => {
    if (!token) return;
    void loadMine(token).catch(() => {
      /* offline or a dead session: the sign-in state handles it */
    });
    const timer = setInterval(() => void loadMine(token).catch(() => {}), 30_000);
    return () => clearInterval(timer);
  }, [token, loadMine]);


  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError && e.retryAfter ? `${e.message} — try again in ${e.retryAfter}s` : String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  // Free: every preset rated against the whole roster, so the picker can compare them.
  useEffect(() => {
    if (presets.length === 0) return;
    let current = true;
    void Promise.all(
      presets.map(async (p) => [p.name, (await api.previewTable(null, p.policyTable)).preview.trueRating] as const),
    )
      .then((pairs) => current && setPresetRatings(Object.fromEntries(pairs)))
      .catch(() => current && setPresetRatings({}));
    return () => {
      current = false;
    };
  }, [presets]);


  // Free: rating a preset's table costs nothing, so it runs on every selection.
  useEffect(() => {
    if (tab !== "preset" || !chosen) return;
    const table = presets.find((p) => p.name === chosen)?.policyTable;
    if (!table) return;
    setPreviewing(true);
    void api
      .previewTable(null, table)
      .then((r) => setPreview({ value: r.preview, paid: false }))
      .catch(() => setPreview(null))
      .finally(() => setPreviewing(false));
  }, [tab, chosen, presets]);

  // Paid: rating a brief needs a model call, so it waits until typing stops.
  useEffect(() => {
    // The rated table belongs to the brief as it was; a new brief needs a new one.
    setBriefTable(null);
    if (tab !== "brief" || !token) return;
    if (briefTimer.current) clearTimeout(briefTimer.current);
    if (!autoPreview || brief.trim().length < 12) return;
    briefTimer.current = setTimeout(() => void ratePaidBrief(), BRIEF_DEBOUNCE_MS);
    return () => {
      if (briefTimer.current) clearTimeout(briefTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, tab, autoPreview, token]);

  const ratePaidBrief = async () => {
    if (!token || brief.trim().length < 12) return;
    setPreviewing(true);
    setError(null);
    try {
      const r = await api.previewBrief(token, brief.trim());
      setPreview({ value: r.preview, paid: true });
      setBriefTable(r.policyTable);
      if (r.elicitation?.free) setFirstFreeUsed(true);
      else setPaidCalls((n) => n + 1);
    } catch (e) {
      setPreview(null);
      setError(e instanceof ApiError && e.retryAfter ? `${e.message} — try again in ${e.retryAfter}s` : (e as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  /**
   * Gets this wallet an agent: holding the minimum is the entry, so nothing is
   * signed or paid. The creation answer lacks the owner view's wallet and
   * power, so the agent is read whole afterwards.
   */
  const rent = () =>
    run("rent", async () => {
      // No name given: the agent's character is named for it.
      const chosenName = name.trim();
      const { agent: created, elicitation } = await api.rent(token, {
        holderMint: selectedMint,
        ...(chosenName ? { name: chosenName } : {}),
        ...(tab === "preset" ? { presetName: chosen } : { brief: brief.trim() }),
      });
      if (elicitation?.free) setFirstFreeUsed(true);
      const id = created.id ?? created.agentId!;
      await refreshAgent(id, token);
      localStorage.setItem(AGENT_KEY, id);
      setMine((held) => [{ ...created, id }, ...held]);
      setTranscript("");
      setLastPlay(null);
    });

  /** Reads the wallet now: after a buy, so the owner need not wait for the next scheduled read. */
  const checkHolding = () =>
    run("holding", async () => {
      setHolding((await api.refreshHolding(token)).holding);
      if (token) await loadMine(token);
    });

  const play = () =>
    run("play", async () => {
      const id = agent?.id ?? agent?.agentId;
      if (!id) return;
      const result = await api.play(token, id);
      setLastPlay(result);
      const { transcript: text } = await api.match(result.matchId);
      setTranscript(text);
      await refreshAgent(id, token);
    });

  const select = (id: string) => {
    if (!token || id === (agent ? idOf(agent) : null)) return;
    localStorage.setItem(AGENT_KEY, id);
    setTranscript("");
    setLastPlay(null);
    void refreshAgent(id, token);
  };

  const inPlay = mine.filter((a) => !a.retired);
  const agentCard = agent ? (
    <AgentCard
      agent={agent}
      onPlay={play}
      busy={busy === "play"}
      lastPlay={lastPlay}
      holder={holder}
      onEnd={() => run("end", async () => {
        await api.endAgent(token, idOf(agent));
        setSelectedMint(agent.holderMint ?? "");
        setAgent(null);
        setHolder(null);
        if (token) await loadMine(token);
      })}
      ending={busy === "end"}
      onChanged={() => {
        // Autoplay played or stopped: the list and the card both catch up.
        if (token) void loadMine(token);
      }}
    />
  ) : null;

  const availableTokens = [{ mint: "", symbol: "$GAMINE", holding }, ...tokenHoldings]
    .filter((item) => !inPlay.some((a) => (a.holderMint ?? "") === item.mint));
  const chosenHolding = selectedMint ? tokenHoldings.find((item) => item.mint === selectedMint)?.holding ?? null : holding;
  const rentPanel = (
    <div className="space-y-3">
    {tokenHoldings.length ? <label className="block text-[13px] text-muted">Token for your replacement agent
      <select value={selectedMint} onChange={(event) => setSelectedMint(event.target.value)} className="mt-2 block w-full rounded border border-line bg-panel p-3 text-text">
        {[{ mint: "", symbol: "$GAMINE", holding }, ...tokenHoldings].map((item) => <option key={item.mint} value={item.mint}>{item.symbol}{inPlay.some((a) => (a.holderMint ?? "") === item.mint) ? " · agent already exists" : ""}</option>)}
      </select>
    </label> : null}
    <RentPanel
      tab={tab}
      setTab={setTab}
      presets={presets}
      chosen={chosen}
      setChosen={setChosen}
      brief={brief}
      setBrief={setBrief}
      name={name}
      setName={setName}
      onRent={rent}
      busy={busy === "rent"}
      autoPreview={autoPreview}
      setAutoPreview={setAutoPreview}
      onRateBrief={ratePaidBrief}
      previewing={previewing}
      paidCalls={paidCalls}
      firstFree={!firstFreeUsed}
      presetRatings={presetRatings}
      signedIn={Boolean(session)}
      holding={inPlay.some((a) => (a.holderMint ?? "") === selectedMint) ? null : chosenHolding}
      onCheckHolding={checkHolding}
      checkingHolding={busy === "holding"}
    />
    </div>
  );

  // The list of everything this wallet holds, then the open agent, then renting
  // - which is only offered when nothing is still in play.
  const agentOrRent = (
    <>
      {mine.length > 1 || (mine.length === 1 && inPlay.length === 0) ? (
        <YourAgents agents={mine} open={agent ? idOf(agent) : null} onSelect={select} />
      ) : null}
      {agentCard}
      {availableTokens.some((item) => item.holding?.eligible) || inPlay.length === 0 ? rentPanel : null}
    </>
  );

  return (
    <Page
      title="Agent"
      intro="Hold at least $20 worth of $GAMINE or a token launched on Gamine to activate a separate agent for each qualifying token. The system picks one of four strategies and starts autoplay. Matches never spend your tokens. End your agent to create your own strategy."
    >
      {!session ? <WelcomeCard /> : null}

      {error ?? wallet.error ? (
        <p className="rounded-panel border border-loss/40 bg-loss/10 px-3 py-2 text-[13px] text-loss" role="alert">
          {error ?? wallet.error}
        </p>
      ) : null}

      {/* Playing: signed out, a bluff worth reading, then the ask; signed in, your agent or getting one. */}
      <div className="flex min-w-0 flex-col gap-3 *:m-0">
        {session ? null : <BluffCard bluff={feed?.bluff ?? null} />}
        {session ? null : <ConnectPanel wallets={wallets} onConnect={connect} busy={wallet.busy === "connect"} />}
        {agentOrRent}
        <PreviewPanel preview={preview} previewing={previewing} tab={agent ? null : tab} />
        {session ? <Transcript text={transcript} {...(lastPlay ? { matchId: lastPlay.matchId } : {})} /> : null}
      </div>
      <PageNote>Ratings shown to you are exact against the roster as it stands today.</PageNote>
    </Page>
  );
}

function WelcomeCard() {
  return (
    <section aria-label="Welcome to Gamine" className="hud-card relative overflow-hidden p-5 sm:p-6">
      <div aria-hidden className="absolute right-0 top-0 h-24 w-24 border-b border-l border-teal/20 bg-teal/5" />
      <div className="relative">
        <div className="mb-5 flex items-center gap-3">
          <img src="/gamine-tb.png" alt="" width={372} height={370} className="h-10 w-10 object-contain [image-rendering:pixelated]" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-teal">Your place in the village</span>
        </div>
        <h2 className="max-w-sm font-pixel text-xl leading-relaxed text-text sm:text-2xl">Launch a token.<br /><span className="text-accent">Join the arena.</span></h2>
        <p className="mt-3 max-w-md text-[13px] leading-6 text-muted">Hold $20 worth of a qualifying token and its agent takes it from there. Four strategies. Automatic play. Your tokens stay in your wallet.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/launch/new" className="rounded-panel bg-accent px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-gold/85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">Launch token <span aria-hidden>↗</span></Link>
          <Link href="/live" className="rounded-panel border border-hud-line px-4 py-2.5 text-[13px] text-text transition-colors hover:border-teal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal">Watch the arena <span aria-hidden>→</span></Link>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-hud-line pt-4">
          {[{ number: "01", label: "Hold tokens" }, { number: "02", label: "Agent activates" }, { number: "03", label: "Autoplay begins" }].map((step) => (
            <div key={step.number}>
              <p className="font-mono text-xs text-teal">{step.number}</p>
              <p className="mt-1 text-[11px] leading-5 text-text">{step.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Sign-in. The wallet signs a plain-text message, never a transaction, and the
 * panel says so, because a signing prompt is exactly where people get phished.
 */
function ConnectPanel({
  wallets,
  onConnect,
  busy,
}: {
  wallets: WalletName[];
  onConnect: (name: WalletName) => void;
  busy: boolean;
}) {
  const all: WalletName[] = ["Phantom", "Solflare"];
  return (
    <div className="rounded-panel mb-3 border border-line bg-panel p-3">
      <p className="text-[13px] leading-5">Want one of your own? Sign in to get an agent and play.</p>
      <p className="mt-1 text-[12px] leading-5 text-muted">
        You sign a message, not a transaction: it costs nothing and moves nothing. Browsing needs no wallet.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {all.map((name) =>
          wallets.includes(name) ? (
            <button
              key={name}
              onClick={() => onConnect(name)}
              disabled={busy}
              className="rounded-panel bg-accent px-3 py-2 text-[13px] font-medium text-ink disabled:bg-line disabled:text-muted"
            >
              {busy ? "Waiting…" : name}
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
    </div>
  );
}

function RentPanel(props: {
  tab: "preset" | "brief";
  setTab: (t: "preset" | "brief") => void;
  presets: Preset[];
  chosen: string;
  setChosen: (s: string) => void;
  brief: string;
  setBrief: (s: string) => void;
  name: string;
  setName: (s: string) => void;
  onRent: () => void;
  busy: boolean;
  autoPreview: boolean;
  setAutoPreview: (b: boolean) => void;
  onRateBrief: () => void;
  previewing: boolean;
  paidCalls: number;
  firstFree: boolean;
  presetRatings: Record<string, number>;
  signedIn: boolean;
  /** This wallet's holding: holding the minimum is the entry, and nothing is paid. */
  holding: HoldingView | null;
  onCheckHolding: () => void;
  checkingHolding: boolean;
}) {
  const ready =
    props.signedIn &&
    (props.tab === "preset" ? Boolean(props.chosen) : props.brief.trim().length >= 12) &&
    props.holding?.eligible === true;
  return (
    <section className="rounded-panel border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-3 text-[12px] uppercase tracking-wider text-accent">
        Get your agent
      </h2>
      <div className="space-y-3 p-3">
        <HoldingCheck holding={props.holding} onRefresh={props.onCheckHolding} refreshing={props.checkingHolding} />
        <Segmented
          value={props.tab}
          onChange={props.setTab}
          options={[
            { value: "preset", label: "Preset" },
            { value: "brief", label: "Brief" },
          ]}
        />

        {props.tab === "preset" ? (
          <>
          <ul className="space-y-2">
            {props.presets.map((p, index) => (
              <PresetCard
                key={p.name}
                preset={p}
                index={index}
                rating={props.presetRatings[p.name]}
                selected={props.chosen === p.name}
                onSelect={() => props.setChosen(p.name)}
              />
            ))}
          </ul>
          <p className="text-[12px] leading-5 text-muted">
            Figures are the exact net chips each would win per match against the other players&apos; agents in play
            today &mdash; what rewards score. Free to see.
          </p>
          </>
        ) : (
          <div className="space-y-2">
            <textarea
              value={props.brief}
              onChange={(e) => props.setBrief(e.target.value)}
              rows={4}
              placeholder="Tell it how to play. Be specific: when to fold, when to raise, when to bluff."
              className="rounded-panel w-full resize-y border border-line bg-panel-2 px-3 py-2 font-mono text-[13px] leading-5 text-text placeholder:text-muted/60"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={props.autoPreview}
                  onChange={(e) => props.setAutoPreview(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Rate as I type
              </label>
              <span className="font-mono">
                {props.brief.trim().length} chars · {props.firstFree ? "first call free" : `${props.paidCalls} model calls`}
              </span>
            </div>
            <button
              onClick={props.onRateBrief}
              disabled={!props.signedIn || props.brief.trim().length < 12 || props.previewing}
              className="rounded-panel w-full border border-accent px-3 py-2 text-[13px] text-accent disabled:border-line disabled:text-muted"
            >
              {props.previewing ? "Rating…" : "Rate this brief"}
              <span className="ml-2 font-mono text-[11px] uppercase tracking-wider">
                {props.firstFree ? "first one free" : "costs a model call"}
              </span>
            </button>
          </div>
        )}

        <input
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder="Name your agent, or leave it empty and it gets a name of its own"
          maxLength={32}
          className="rounded-panel w-full border border-line bg-panel-2 px-3 py-2 text-[13px] placeholder:text-muted/60"
        />

        <button
          onClick={props.onRent}
          disabled={!ready || props.busy}
          className="rounded-panel w-full bg-accent px-3 py-3 text-[14px] font-medium text-ink disabled:bg-line disabled:text-muted"
        >
          {!props.signedIn
            ? "Sign in to get an agent"
            : props.busy
              ? "Creating…"
              : !props.holding?.eligible
                ? "Hold the minimum to get an agent"
                : props.tab === "preset"
                  ? `Play as ${props.chosen}`
                  : "Play on this brief"}
        </button>
        {props.tab === "brief" ? (
          <p className="text-[12px] leading-5 text-muted">
            A brief writes its table once, with one model call. Playing it after that is free.
          </p>
        ) : (
          <p className="text-[12px] leading-5 text-muted">
            Presets are free to play and free to rate.
          </p>
        )}
        {/* Devnet only, and renders nothing anywhere else: the api has no faucet
            to answer with, so nobody is shown one that cannot exist. */}
        <FaucetPanel onFunded={props.onCheckHolding} />
      </div>
    </section>
  );
}

/** Arrival timing for the preset cards. */
const BAR_STAGGER_MS = 30;
const CARD_STAGGER_MS = 80;

function PresetCard({
  preset,
  index,
  rating,
  selected,
  onSelect,
}: {
  preset: Preset;
  index: number;
  rating: number | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  // Counts in on the same beat as this card's bars.
  const shown = useCountUp(rating, 400, index * CARD_STAGGER_MS);
  return (
    <li>
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className={`rounded-panel card-border w-full border px-3 py-3 text-left ${
          selected ? "border-accent bg-panel-2" : "border-line bg-panel hover:border-muted"
        }`}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-medium">
            {preset.name}
          </span>
          {/* The final figure is what screen readers get, not the frames in between. */}
          <span
            className={`font-mono text-[12px] ${shown === undefined ? "text-muted" : netTone(shown)}`}
            aria-label={rating === undefined ? undefined : `${money(rating, 3)} per match`}
          >
            {shown === undefined ? "…" : `${money(shown, 3)} / match`}
          </span>
        </span>
        <span className="mt-1 block text-[12px] leading-5 text-muted">{preset.description}</span>
        <Behaviour table={preset.policyTable} delayMs={index * CARD_STAGGER_MS} />
      </button>
    </li>
  );
}

/**
 * What a table does when it acts first, edge by edge: a filled square raises,
 * an outlined one calls, a faint one folds. Readable at a glance, no codes.
 * Each square wipes in once on arrival and then holds still.
 */
function Behaviour({ table, delayMs = 0 }: { table: Record<string, Record<string, string>>; delayMs?: number }) {
  const lead = table["lead"] ?? {};
  const edges = Object.keys(lead).sort();
  return (
    <span className="mt-2 flex items-end gap-1.5" aria-label="what it does when acting first">
      {edges.map((edge, i) => {
        const action = lead[edge];
        return (
          <span key={edge} className="flex flex-col items-center gap-0.5">
            <span
              title={`${action} at ${edge}`}
              style={{ animationDelay: `${delayMs + i * BAR_STAGGER_MS}ms` }}
              className={`bar-wipe block h-3 w-6 ${
                action === "raise" ? "bg-gold" : action === "call" ? "border border-muted" : "bg-line"
              }`}
            />
            <span className="font-mono text-[11px] text-muted">{edge.slice(1)}</span>
          </span>
        );
      })}
      <span className="ml-2 font-mono text-[11px] leading-3 text-muted">
        <span className="text-gold">raise</span> · call · <span className="opacity-60">fold</span>
      </span>
    </span>
  );
}

/**
 * Everything this wallet owns, the ones still playing first. A wallet holds one
 * agent in play at a time, so this is usually one line plus whatever has
 * retired - and retired agents stay, because the record is the point.
 */
function YourAgents({
  agents,
  open,
  onSelect,
}: {
  agents: AgentView[];
  open: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="rounded-panel border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-3 text-[12px] uppercase tracking-wider text-accent">
        Your agents<span className="ml-2 normal-case tracking-normal">{agents.length}</span>
      </h2>
      <ul className="p-1">
        {agents.map((a) => {
          const id = idOf(a);
          const isOpen = id === open;
          return (
            <li key={id}>
              <button
                onClick={() => onSelect(id)}
                aria-current={isOpen ? "true" : undefined}
                className={`flex w-full items-center gap-2 px-2 py-2 text-left text-[13px] ${isOpen ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <AgentName name={a.name} preset={a.presetName} />
                </span>
                <span className="font-mono text-[11px] text-muted" title={a.holderMint || "Primary token"}>{a.holderMint ? `${a.holderMint.slice(0, 4)}…${a.holderMint.slice(-4)}` : "$GAMINE"}</span>
                {a.retired ? (
                  <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted">retired</span>
                ) : (
                  <span className="shrink-0 font-mono text-[12px] text-gold">{a.balance ?? 0}</span>
                )}
                <span className="shrink-0 font-mono text-[11px] text-muted">
                  {a.matchesPlayed ?? 0} {a.matchesPlayed === 1 ? "match" : "matches"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AgentCard({
  agent,
  onPlay,
  busy,
  lastPlay,
  onChanged,
  holder,
  onEnd,
  ending,
}: {
  agent: AgentView;
  onPlay: () => void;
  busy: boolean;
  lastPlay: PlayResult | null;
  /** The wallet, clock and power of a holder agent; null on another flow. */
  holder: HolderView | null;
  /** After autoplay played or stopped: the card may be stale. */
  onChanged: () => void;
  onEnd: () => void;
  ending: boolean;
}) {
  const retired = agent.retired === true;
  // A holder agent is its owner's wallet. Agents from before holding was the
  // entry are all retired; their cards show their record and nothing else.
  const isHolder = agent.funding === "holder";
  return (
    <section className="rounded-panel border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-3 text-[12px] uppercase tracking-wider text-accent">
        {retired ? "Retired agent" : "Your agent"}
      </h2>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-lg font-medium">
            <AgentName name={agent.name} preset={agent.presetName} />
          </p>
          <span className="font-mono text-[11px] text-muted">{agent.presetName ?? "your brief"}</span>
        </div>

        {agent.character?.pendingName ? (
          <p className="rounded-panel mt-2 border border-line px-3 py-2 text-[12px] leading-5 text-muted">
            Your name <span className="text-text">&ldquo;{agent.character.pendingName}&rdquo;</span> is waiting for its
            check. Until it passes, everyone else sees this agent as {agent.name}; it switches over by itself.
          </p>
        ) : null}
        {agent.id ?? agent.agentId ? (
          <div className="mt-3">
            <CharacterBlock agentId={(agent.id ?? agent.agentId)!} character={agent.character} traits={agent.traits} size={80} />
          </div>
        ) : null}

        <dl className="rounded-panel mt-3 grid grid-cols-3 border border-line">
          <Stat
            label={isHolder ? "holding" : "balance"}
            value={String(agent.balance ?? 0)}
            tone={agent.canPlay === false || (agent.balance ?? 0) <= 20 ? "text-loss" : "text-gold"}
          />
          <Stat label="net won" value={whole(agent.cumulativeNet ?? 0)} tone={netTone(agent.cumulativeNet ?? 0)} />
          <Stat label="matches" value={String(agent.matchesPlayed ?? 0)} />
        </dl>
        {typeof agent.rankedMatches === "number" && agent.rankedMatches !== (agent.matchesPlayed ?? 0) ? (
          <p className="mt-1 text-[12px] leading-5 text-muted">
            The ladder counts <span className="font-mono">{agent.rankedMatches}</span> of{" "}
            <span className="font-mono">{agent.matchesPlayed ?? 0}</span> &mdash; the ones against other players
            &mdash; for <span className={`font-mono ${netTone(agent.rankedNet ?? 0)}`}>{whole(agent.rankedNet ?? 0)}</span>.
            The rest were against house agents, which don&apos;t count.
          </p>
        ) : null}
        <dl className="rounded-panel mt-2 grid grid-cols-1 border border-line">
          <Stat label="recent form" value={money(agent.recentForm ?? 0)} tone={netTone(agent.recentForm ?? 0)} />
        </dl>

        {retired ? (
          <p className="rounded-panel mt-3 border border-line px-3 py-2 text-[13px] leading-5 text-muted">
            Retired: it can&apos;t play again. Its record is frozen at{" "}
            {whole(agent.cumulativeNet ?? 0)} over {agent.matchesPlayed ?? 0} matches, and it stays on the ladder.
          </p>
        ) : (
          <div className="mt-3">
            {/* Nothing is at risk in a match, but an agent must hold the minimum to be in play. */}
            {agent.canPlay === false ? (
              <p className="rounded-panel mb-2 border border-loss/50 px-3 py-2 text-[13px] leading-5 text-loss">
                Your wallet holds <span className="font-mono">{agent.balance ?? 0}</span> chips&apos; worth, and an agent
                needs <span className="font-mono">{agent.minToPlay ?? MIN_FUNDING_CHIPS}</span>. Hold it again and it plays
                again, within ten minutes.
              </p>
            ) : null}
          </div>
        )}

        {typeof agent.trueRating === "number" ? (
          <p className="mt-2 font-mono text-[12px] leading-5 text-muted">
            private rating {money(agent.trueRating, 3)} per match, {agent.trueRatingBasis ?? "against today's roster"}
          </p>
        ) : null}

        <button
          onClick={onPlay}
          disabled={busy || retired}
          className="rounded-panel mt-3 w-full bg-accent px-3 py-3 text-[14px] font-medium text-ink disabled:bg-line disabled:text-muted"
        >
          {retired ? "Retired" : busy ? "Playing…" : "Play a match"}
        </button>

        {lastPlay ? (
          <p className="mt-2 font-mono text-[12px] leading-5 text-muted">
            vs{" "}
            <AgentName name={lastPlay.opponent.name} preset={lastPlay.opponent.presetName} /> ·{" "}
            {lastPlay.result.rounds} rounds · staked <span className="text-gold">{lastPlay.stake}</span> ·{" "}
            <span className={netTone(lastPlay.result.net)}>{whole(lastPlay.result.net)}</span>
            {lastPlay.result.net !== lastPlay.result.uncappedNet
              ? ` (capped from ${whole(lastPlay.result.uncappedNet)})`
              : ""}{" "}
            · paired by {lastPlay.matchmaking.path.replace("-", " ")}
          </p>
        ) : null}
        {lastPlay && lastPlay.ranked === false ? (
          <p className="mt-1 text-[12px] leading-5 text-muted">
            Against a house agent: practice. It doesn&apos;t count toward the ladder or rewards.
          </p>
        ) : null}

        {!(agent.id ?? agent.agentId) ? null : (
          <AutoplayPanel
            agentId={(agent.id ?? agent.agentId)!}
            retired={retired}
            refreshKey={`${agent.balance ?? ""}-${agent.matchesPlayed ?? ""}`}
            onChanged={onChanged}
          />
        )}

        {!retired ? (
          <button type="button" onClick={onEnd} disabled={ending} className="mt-3 border border-line px-3 py-2 text-[12px] text-muted hover:text-loss disabled:opacity-50">
            {ending ? "Ending…" : "End agent and choose my own strategy"}
          </button>
        ) : null}
        {isHolder && holder ? <PowerPanel holder={holder} /> : null}

      </div>
    </section>
  );
}

/**
 * One figure in the agent card: the number large, its label small and quiet
 * above it. `tone` is the colour the number earns - gold for money, green or
 * red for a result - and the caller decides, because only it knows what the
 * number is. `sub` carries anything the figure needs said about it, so the
 * figure itself stays a figure.
 */
function Stat({
  label,
  value,
  tone = "text-text",
  sub,
}: {
  label: string;
  value: string;
  tone?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="border-r border-line px-3.5 py-3.5 last:border-r-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-2">
        <span className={`font-mono text-[22px] leading-none ${tone}`}>{value}</span>
        {sub ? <span className="mt-2 block text-[11px] leading-4 text-muted">{sub}</span> : null}
      </dd>
    </div>
  );
}

function PreviewPanel({
  preview,
  previewing,
  tab,
}: {
  preview: { value: Preview; paid: boolean } | null;
  previewing: boolean;
  tab: "preset" | "brief" | null;
}) {
  if (tab === null) return null;
  const worst = preview ? Math.max(...preview.value.breakdown.map((b) => Math.abs(b.expectedNet)), 0.001) : 1;
  return (
    <section className="rounded-panel mt-3 border border-line bg-panel">
      <h2 className="flex items-center justify-between border-b border-line px-4 py-3 text-[12px] uppercase tracking-wider text-accent">
        Expected result
        <span className={`font-mono ${tab === "brief" ? "text-gold" : "text-muted"}`}>
          {tab === "brief" ? "model call" : "free"}
        </span>
      </h2>
      <div className="p-4">
        {previewing ? (
          <p className="font-mono text-[13px] text-muted">rating…</p>
        ) : preview ? (
          <>
            <p className={`font-mono text-3xl ${netTone(preview.value.trueRating)}`}>
              {money(preview.value.trueRating, 3)}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-muted">
              per match, {preview.value.basis} ({preview.value.roster} agents)
            </p>
            {preview.value.scoring ? (
              <p className="mt-2 text-[12px] leading-5 text-muted">
                <span className="text-text">This is what rewards score.</span> Points are the net chips an agent wins
                against other players&apos; agents, so this figure, times the ranked matches it plays, is its expected
                points before its weight.
              </p>
            ) : (
              <p className="mt-2 text-[12px] leading-5 text-muted">
                Rewards score only matches against other players&apos; agents, and none is in play yet, so this is rated
                against the whole roster for now.
              </p>
            )}
            <ul className="mt-3 space-y-1.5">
              {preview.value.breakdown.map((b, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted">
                    {b.weight} agent{b.weight === 1 ? "" : "s"}
                  </span>
                  <span className="h-2 flex-1 bg-panel-2">
                    <span
                      className={`block h-2 ${netFill(b.expectedNet)}`}
                      style={{ width: `${Math.min(100, (Math.abs(b.expectedNet) / worst) * 100)}%` }}
                    />
                  </span>
                  <span className={`w-14 shrink-0 text-right font-mono text-[11px] ${netTone(b.expectedNet)}`}>
                    {money(b.expectedNet)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-[13px] leading-5 text-muted">
            {tab === "preset" ? "Pick a preset to see what it is worth." : "Write a brief, then rate it."}
          </p>
        )}
      </div>
    </section>
  );
}
