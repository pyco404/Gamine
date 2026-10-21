"use client";

import { PlatformStats } from "../platform-stats";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { launchpad, usd, type LaunchSort, type TokenSummary } from "@/lib/launchpad";
import { formatDate, MockNote, TokenImage, VerificationBadge, WoodSign } from "@/app/launch/parts";

/** How many each spotlight section shows, and how many the full list adds at a time. */
const SPOTLIGHT = 5;
const PAGE = 20;
/** How long the search waits after the last keystroke before it asks. */
const SEARCH_MS = 250;

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m}m ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)}h ago`;
  if (m < 7 * 24 * 60) return `${Math.round(m / (24 * 60))}d ago`;
  return formatDate(iso);
};

type Order = {
  sort: LaunchSort;
  title: string;
  /** Its tab in the full list. */
  tab: string;
  /** What it ranks by, under its sign. */
  about: string;
  /** The figure a spotlight row shows on its right. */
  figure: (t: TokenSummary) => ReactNode;
};

function Progress({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-12 overflow-hidden rounded-[2px] border border-wood-dark bg-black/50">
        <span className="block h-full bg-live" style={{ width: `${value}%` }} />
      </span>
      <span className="w-8 text-right text-text">{value}%</span>
    </span>
  );
}

const ORDERS: Order[] = [
  { sort: "newest", title: "New launches", tab: "New", about: "Newest first, every launch.",
    figure: (t) => <span className="flex flex-col items-end leading-tight"><span className="text-accent">{usd(t.marketCapUsd)}</span><span className="text-[11px] text-muted">{ago(t.launchedAt)}</span></span> },
  { sort: "volume", title: "Hot", tab: "Hot", about: "Most traded in the last 24 hours.", figure: (t) => <span className="text-teal">{usd(t.volume24hUsd)}</span> },
  { sort: "marketCap", title: "Top market cap", tab: "Market cap", about: "Largest first.", figure: (t) => <span className="text-accent">{usd(t.marketCapUsd)}</span> },
  {
    sort: "graduating",
    title: "Graduating soon",
    tab: "Graduating",
    about: "Furthest along pump.fun's bonding curve.",
    figure: (t) => <Progress value={t.bondingProgress} />,
  },
  {
    sort: "agents",
    title: "Most agents",
    tab: "Agents",
    about: "Most agents in play in the village.",
    figure: (t) => <span className="text-live">{t.agentsInPlay.toLocaleString("en-US")}</span>,
  },
  {
    sort: "holders",
    title: "Most holders",
    tab: "Holders",
    about: "Most wallets holding the token.",
    figure: (t) => <span className="text-text">{t.holders?.toLocaleString("en-US") ?? "—"}</span>,
  },
];

/** A token's name and ticker, with its badge when it is not verified. */
function Name({ t, size = "text-[14px]" }: { t: TokenSummary; size?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={`block truncate font-pixel font-bold group-hover:text-accent ${size}`}>{t.name}</span>
      <span className="flex items-center gap-2 font-mono text-[11px] text-teal">
        ${t.ticker}
        {t.verification !== "verified" ? <VerificationBadge v={t.verification} /> : null}
      </span>
    </span>
  );
}

/** One spotlight: a wooden sign, its top few, and the way to the rest of them. */
function Spotlight({ order, onAll }: { order: Order; onAll: () => void }) {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    launchpad.listLaunches({ sort: order.sort, limit: SPOTLIGHT }).then(
      (p) => !gone && setTokens(p.tokens),
      (e: Error) => !gone && setError(e.message),
    );
    return () => {
      gone = true;
    };
  }, [order.sort]);

  return (
    <section className="rounded-panel mb-3 border border-line lg:mb-0 lg:flex lg:min-w-0 lg:flex-[1_1_18rem] lg:flex-col">
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div>
          <WoodSign small>{order.title}</WoodSign>
          <p className="mt-1.5 text-[12px] text-muted">{order.about}</p>
        </div>
        <button type="button" onClick={onAll} className="shrink-0 pt-1 text-[12px] text-accent hover:text-text">
          See all →
        </button>
      </div>
      <div className="p-3 pt-1 text-[13px]">
        {error ? (
          <p className="text-loss">Could not be read: {error}</p>
        ) : !tokens ? (
          <p className="text-muted">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-muted">Nothing here yet.</p>
        ) : (
          <ol className="divide-y divide-line">
            {tokens.map((t, i) => (
              <li key={t.mint}>
                <Link href={`/launch/${t.mint}`} className="group flex items-center gap-2.5 py-2">
                  <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted">{i + 1}</span>
                  <TokenImage src={t.image} size={32} />
                  <Name t={t} />
                  <span className="shrink-0 font-mono text-[12px]">{order.figure(t)}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** A row of the full list: every figure, in columns where there is room and under the name where there is not. */
function Row({ t, rank }: { t: TokenSummary; rank: number }) {
  const cells: { label: string; value: ReactNode; tone: string }[] = [
    { label: "Market cap", value: usd(t.marketCapUsd), tone: "text-accent" },
    { label: "24h vol", value: usd(t.volume24hUsd), tone: "text-teal" },
    { label: "Holders", value: t.holders?.toLocaleString("en-US") ?? "—", tone: "text-text" },
    { label: "Agents", value: t.agentsInPlay.toLocaleString("en-US"), tone: "text-live" },
    { label: "Curve", value: t.bondingProgress === null ? "—" : t.bondingProgress >= 100 ? "done" : `${t.bondingProgress}%`, tone: "text-text" },
  ];
  return (
    <li>
      <Link href={`/launch/${t.mint}`} className="group flex flex-col gap-1.5 py-2.5 @3xl:flex-row @3xl:items-center @3xl:gap-3">
        <span className="flex min-w-0 items-center gap-2.5 @3xl:w-64 @3xl:shrink-0">
          <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted">{rank}</span>
          <TokenImage src={t.image} size={36} />
          <Name t={t} size="text-[15px]" />
        </span>
        <span className="grid grid-cols-5 gap-1 pl-[4.25rem] font-mono text-[12px] @3xl:flex-1 @3xl:pl-0">
          {cells.map((c) => (
            <span key={c.label} className="min-w-0">
              <span className="block truncate text-[10px] uppercase tracking-wide text-muted @3xl:hidden">{c.label}</span>
              <span className={`block truncate ${c.tone}`}>{c.value}</span>
            </span>
          ))}
        </span>
        <span className="hidden w-20 shrink-0 text-right font-mono text-[11px] text-muted @3xl:block">{ago(t.launchedAt)}</span>
      </Link>
    </li>
  );
}

/** Every launch, in pages: one order at a time, narrowed by a search. */
function AllLaunches({ sort, onSort, search }: { sort: LaunchSort; onSort: (s: LaunchSort) => void; search: string }) {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The query a page of results belongs to, so an answer to an older one is dropped.
  const asked = useRef(0);

  const load = (offset: number) => {
    const ticket = ++asked.current;
    setLoading(true);
    setError(null);
    launchpad.listLaunches({ sort, search, offset, limit: PAGE }).then(
      (p) => {
        if (ticket !== asked.current) return;
        setTokens((was) => (offset === 0 ? p.tokens : [...was, ...p.tokens]));
        setTotal(p.total);
        setLoading(false);
      },
      (e: Error) => {
        if (ticket !== asked.current) return;
        setError(e.message);
        setLoading(false);
      },
    );
  };
  useEffect(() => {
    setTokens([]);
    setTotal(null);
    load(0);
  }, [sort, search]);

  return (
    <section id="all-launches" className="rounded-panel scroll-mt-2 border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <WoodSign>{search ? "Search" : "All launches"}</WoodSign>
        <span className="font-mono text-[12px] text-muted">
          {total === null ? "…" : `${total.toLocaleString("en-US")} ${total === 1 ? "token" : "tokens"}`}
        </span>
      </div>
      <div role="tablist" aria-label="Order" className="flex flex-wrap gap-1.5 px-3 pt-3">
        {ORDERS.map((o) => (
          <button
            key={o.sort}
            type="button"
            role="tab"
            aria-selected={sort === o.sort}
            onClick={() => onSort(o.sort)}
            className={`rounded-panel border px-2.5 py-1 text-[12px] ${
              sort === o.sort ? "border-accent bg-accent font-medium text-ink" : "border-line text-muted hover:text-text"
            }`}
          >
            {o.tab}
          </button>
        ))}
      </div>
      {sort !== "newest" ? (
        <p className="px-3 pt-2 text-[11px] text-muted">Ranked lists leave out tokens that are not verified or were removed from the game.</p>
      ) : null}
      <div className="p-3 pt-1 text-[13px]">
        <div className="hidden gap-3 border-b border-line py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted @3xl:flex">
          <span className="w-64 shrink-0 pl-9">Token</span>
          <span className="grid flex-1 grid-cols-5 gap-1">
            <span>Market cap</span>
            <span>24h vol</span>
            <span>Holders</span>
            <span>Agents</span>
            <span>Curve</span>
          </span>
          <span className="w-20 shrink-0 text-right">Launched</span>
        </div>
        {error ? <p className="py-2 text-loss">Could not be read: {error}</p> : null}
        {total === 0 ? <p className="py-2 text-muted">{search ? `Nothing matches “${search}”.` : "No launches yet."}</p> : null}
        <ol className="divide-y divide-line">
          {tokens.map((t, i) => (
            <Row key={t.mint} t={t} rank={i + 1} />
          ))}
        </ol>
        {total !== null && tokens.length < total ? (
          <button
            type="button"
            onClick={() => load(tokens.length)}
            disabled={loading}
            className="rounded-panel mt-2 w-full border border-line px-3 py-2 text-[13px] text-text hover:border-accent disabled:text-muted"
          >
            {loading ? "Loading…" : `Show ${Math.min(PAGE, total - tokens.length)} more · ${tokens.length} of ${total.toLocaleString("en-US")}`}
          </button>
        ) : loading && tokens.length === 0 ? (
          <p className="py-2 text-muted">Loading…</p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Every launch on Gamine. A search, then the spotlights - newest, most
 * traded, largest, nearest to graduating, most agents, most holders - side by
 * side in a wrapping row on a desktop and one under another on a phone or
 * tablet, then the whole list in pages, in any of those orders.
 */
export function Explore() {
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LaunchSort>("newest");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), SEARCH_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const seeAll = (s: LaunchSort) => {
    setSort(s);
    document.getElementById("all-launches")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-3">
      <PlatformStats />
      {launchpad.mock ? <MockNote /> : null}
      <div className="hud-card flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Search by name, $ticker or address"
          aria-label="Search launches"
          className="rounded-panel min-w-0 flex-1 border border-line bg-black/40 px-3 py-2 text-[14px] text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
        />
        <Link href="/launch/new" className="rounded-panel shrink-0 bg-accent px-4 py-2 text-center text-[13px] font-semibold text-ink hover:bg-accent/90">
          Launch a token
        </Link>
      </div>
      {search ? null : (
        <div className="block lg:flex lg:flex-wrap lg:gap-3">
          {ORDERS.map((o) => (
            <Spotlight key={o.sort} order={o} onAll={() => seeAll(o.sort)} />
          ))}
        </div>
      )}
      <AllLaunches sort={sort} onSort={setSort} search={search} />
    </div>
  );
}
