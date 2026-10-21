"use client";

import type { HolderView, HoldingView } from "@/lib/api";
import { localMoment } from "@/lib/time";

/**
 * Holder agents (docs/holder-agents.md): the wallet holds $GAMINE above the
 * minimum, and that is the agent. Nothing is rented, deposited or withdrawn,
 * so these panels replace the money panels for a holder: the first says
 * whether this wallet holds enough, the second what its holding earns.
 */

const chips = (n: number) => n.toLocaleString("en-US");

/** The rent screen's question, on the holder flow: does this wallet hold enough? */
export function HoldingCheck({
  holding,
  onRefresh,
  refreshing,
}: {
  holding: HoldingView | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const read = holding?.readAt ?? null;
  return (
    <div className="rounded-panel border border-line bg-panel-2 px-3 py-3">
      <p className="text-[12px] uppercase tracking-wider text-muted">Your wallet</p>
      {holding?.priceReady === false ? (
        <p className="mt-2 text-[13px] text-muted">Waiting for a verified token price. Your agent needs at least $20 of holdings.</p>
      ) : holding === null || read === null ? (
        <p className="mt-2 text-[13px] leading-5 text-muted">Your wallet is checked automatically. You can also check it now after a purchase.</p>
      ) : (
        <p className="mt-2 text-[13px] leading-5">
          Holds <span className="font-mono text-gold">{holding.valueUsd != null ? `$${holding.valueUsd.toFixed(2)}` : `${chips(holding.chips)} chips’ worth`}</span> of this token. An agent
          needs <span className="font-mono">$20</span> of this token.{" "}
          {holding.eligible ? (
            <span className="text-win">That&apos;s enough.</span>
          ) : (
            <span className="text-loss">
              Currently below the required holding value.
            </span>
          )}
        </p>
      )}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="mt-2 border border-line px-3 py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent disabled:text-muted"
      >
        {refreshing ? "Reading…" : read ? "Read it again" : "Check my wallet"}
      </button>
      <p className="mt-2 text-[12px] leading-5 text-muted">
        A qualifying wallet gets an agent and an automatically selected strategy. Autoplay starts without spending tokens. Nothing leaves your wallet: holding is the entry. Sell below it and the agent stops
        playing until you hold it again. Zero tokens ends that token’s agent.
        {holding?.priceReady === false ? <> Live pricing is unavailable; activation is paused.</> : null}
        {read ? <> Last read {localMoment(read)}.</> : null}
      </p>
    </div>
  );
}

/** A 0-to-1 figure as a bar. */
function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <span className="block h-1.5 w-full bg-panel-2">
      <span className={`block h-1.5 ${tone}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </span>
  );
}

/**
 * What a holder's holding earns: conviction, position, and the weight on its
 * score. Said plainly that it weights the reward and never a match, because a
 * bar called "power" invites the opposite reading.
 */
export function PowerPanel({ holder }: { holder: HolderView }) {
  const { holding, power } = holder;
  const clock = holding.conviction;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12px] uppercase tracking-wider text-accent">Power</h3>
        <span className="font-mono text-[18px] text-gold">×{power.weight.toFixed(2)}</span>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-muted">
        The weight on your score: net chips won against other players, times this. It never touches a match &mdash;
        strategy alone decides those.
      </p>

      <div className="mt-3 space-y-3 text-[13px]">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span>Conviction</span>
            <span className="font-mono text-[12px] text-muted">
              {power.convictionDays} / {power.convictionCapDays} days · 85%
            </span>
          </div>
          <div className="mt-1">
            <Bar value={power.conviction} tone="bg-gold" />
          </div>
          <p className="mt-1 text-[12px] leading-5 text-muted">
            {clock.since ? (
              <>
                Held since {localMoment(clock.since)}. Keep at least{" "}
                <span className="font-mono">{chips(clock.chips ?? 0)}</span> chips&apos; worth and it keeps running;
                topping up never resets it, and a price move never costs you your days.
              </>
            ) : (
              <>Starts the first time your wallet is read holding the minimum.</>
            )}
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span>Position</span>
            <span className="font-mono text-[12px] text-muted">
              {(power.shareOfSupply * 100).toFixed(4)}% of supply · 15%
            </span>
          </div>
          <div className="mt-1">
            <Bar value={power.position} tone="bg-accent" />
          </div>
          <p className="mt-1 text-[12px] leading-5 text-muted">Reaches its top at 1% of supply.</p>
        </div>
      </div>

      <p className="mt-3 text-[12px] leading-5 text-muted">
        Your wallet holds <span className="font-mono text-gold">{chips(holding.chips)}</span> chips&apos; worth, read
        every ten minutes{holding.readAt ? <>, last {localMoment(holding.readAt)}</> : null}. A sell and a buy-back between
        two reads is not seen.
      </p>
    </div>
  );
}
