"use client";

import { useEffect, useState } from "react";
import { launchpad, usd, type TokenDetail } from "@/lib/launchpad";
import { netTone } from "@/lib/tone";
import { CopyButton } from "@/app/copy-button";
import { Board, FeeSplitBar, formatDate, MockNote, TokenImage, VerificationBadge } from "./parts";

const VERIFY_LINE: Record<TokenDetail["verification"], string> = {
  verified: "The creator fee split and its locked authority were checked on chain.",
  pending: "The launch is still being checked on chain. Its agents appear once it is verified.",
  failed: "The on-chain check did not pass. This token is not in the game, and its holders have no agents.",
  removed: "This token was removed from the game.",
};

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

/** A launched token: what it is, its standing in the game, and its agents on the ladder. */
export function TokenView({ mint }: { mint: string }) {
  const [token, setToken] = useState<TokenDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout>;
    // A token still being verified is read again until it settles.
    const read = () =>
      launchpad.getToken(mint).then(
        (t) => {
          if (gone) return;
          setToken(t);
          if (t?.verification === "pending") timer = setTimeout(read, 1000);
        },
        (e: Error) => !gone && setError(e.message),
      );
    void read();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [mint]);

  if (error) return <Board sign="Token">This token could not be read: {error}</Board>;
  if (token === undefined) return <Board sign="Token">Loading…</Board>;
  if (token === null) return <Board sign="Token">No token launched here has that address.</Board>;

  const t = `$${token.ticker}`;
  const out = token.verification === "removed" || token.verification === "failed";
  return (
    <div className="space-y-3">
      {launchpad.mock ? <MockNote /> : null}

      {token.verification === "removed" ? (
        <p className="rounded-panel border border-loss bg-loss/10 px-4 py-3 text-[13px] leading-5 text-loss" role="alert">
          <span className="font-pixel text-[16px] font-bold">Removed from the game.</span> {token.removedReason}
        </p>
      ) : null}

      <section className="rounded-panel border border-line p-3 @3xl:p-4">
        <div className="flex items-center gap-3">
          <TokenImage src={token.image} size={72} />
          <div className="min-w-0 flex-1">
            <h2 className="pixel-outline truncate font-pixel text-[24px] font-bold leading-8 text-[#f5ecd8]">{token.name}</h2>
            <p className="font-mono text-[14px] text-teal">{t}</p>
            <p className="mt-0.5 text-[12px] text-muted">Launched {formatDate(token.launchedAt)}</p>
          </div>
        </div>
        {token.description ? <p className="mt-3 text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">{token.description}</p> : null}
        <div className="mt-3 grid grid-cols-2 divide-x divide-line rounded-panel border border-line">
          <div className="py-2 text-center">
            <p className="font-mono text-[22px] text-text">{token.holders?.toLocaleString("en-US") ?? "—"}</p>
            <p className="text-[12px] text-muted">Holders</p>
          </div>
          <div className="py-2 text-center">
            <p className={`font-mono text-[22px] ${out ? "text-muted" : "text-live"}`}>{token.agentsInPlay.toLocaleString("en-US")}</p>
            <p className="text-[12px] text-muted">Agents in play</p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 divide-x divide-line rounded-panel border border-line">
          <div className="py-2 text-center">
            <p className="font-mono text-[16px] text-accent">{usd(token.marketCapUsd)}</p>
            <p className="text-[11px] text-muted">Market cap</p>
          </div>
          <div className="py-2 text-center">
            <p className="font-mono text-[16px] text-teal">{usd(token.volume24hUsd)}</p>
            <p className="text-[11px] text-muted">24h volume</p>
          </div>
          <div className="py-2 text-center">
            <p className="font-mono text-[16px] text-text">{token.bondingProgress === null ? "—" : token.bondingProgress >= 100 ? "Graduated" : `${token.bondingProgress}%`}</p>
            <p className="text-[11px] text-muted">Bonding curve</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
          <a href={token.pumpUrl} target="_blank" rel="noreferrer" className="rounded-panel border border-line px-3 py-1.5 hover:border-accent">
            pump.fun ↗
          </a>
          {token.links.x ? (
            <a href={token.links.x} target="_blank" rel="noreferrer" className="rounded-panel border border-line px-3 py-1.5 hover:border-accent">
              X ↗
            </a>
          ) : null}
          {token.links.telegram ? (
            <a href={token.links.telegram} target="_blank" rel="noreferrer" className="rounded-panel border border-line px-3 py-1.5 hover:border-accent">
              Telegram ↗
            </a>
          ) : null}
          {token.links.website ? (
            <a href={token.links.website} target="_blank" rel="noreferrer" className="rounded-panel border border-line px-3 py-1.5 hover:border-accent">
              Website ↗
            </a>
          ) : null}
        </div>
      </section>

      <Board sign="Verification" action={<VerificationBadge v={token.verification} />}>
        <p>{VERIFY_LINE[token.verification]}</p>
        <p className="mt-2 break-all font-mono text-[11px] text-muted">{token.mint}</p>
        <div className="mt-2"><CopyButton value={token.mint} label="Copy token mint" /></div>
        <a href={token.verifyUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-accent hover:text-text">
          Check it on chain ↗
        </a>
      </Board>

      <Board sign="Creator fees">
        <FeeSplitBar split={token.feeSplit} launcherShare={token.launcherShare} />
        <p className="mt-2 text-muted">
          {token.launcherShare === 0 ? "All of " : `${100 - token.launcherShare}% of `}
          {t}&apos;s creator fees go to Gamine&apos;s wallets. The split was set at launch and cannot be changed.
        </p>
      </Board>

      <Board sign="On the ladder">
        {token.agents.length === 0 ? (
          <p className="text-muted">{out ? `${t} has no agents in the village.` : `No ${t} agents on the ladder yet.`}</p>
        ) : (
          <ol className="-my-1 divide-y divide-line">
            {token.agents.map((a) => (
              <li key={a.agentId} className="flex items-baseline gap-3 py-2">
                <span className="w-10 shrink-0 font-mono text-[12px] text-muted">#{a.rank}</span>
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="shrink-0 font-mono text-[12px] text-muted">{a.matches} matches</span>
                <span className={`w-14 shrink-0 text-right font-mono text-[12px] ${netTone(a.net)}`}>{signed(a.net)}</span>
              </li>
            ))}
          </ol>
        )}
      </Board>
    </div>
  );
}
