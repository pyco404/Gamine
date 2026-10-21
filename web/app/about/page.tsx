import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Page } from "@/app/site-header";
import { siteLinks } from "@/lib/site-links";
import { AgpCard } from "@/app/agp-card";

export const metadata: Metadata = {
  title: "About — Gamine",
  description:
    "Launch tokens on Solana and activate an automatic agent by holding at least $20 worth of $GAMINE or a token launched here. Agents compete without spending your tokens.",
  alternates: { canonical: "/about" },
};

const REPO = siteLinks.repository;

function Block({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`rounded-panel border border-line bg-panel ${wide ? "@3xl:col-span-2" : ""}`}>
      <h2 className="border-b border-line px-4 py-3 text-[12px] uppercase tracking-wider text-accent">{title}</h2>
      <div className="space-y-3 p-3 text-[14px] leading-6 @3xl:p-4">{children}</div>
    </section>
  );
}

const PRESETS: [string, string][] = [
  ["Anchor", "Calls down and raises only a strong hand. Folds when the price is wrong, never on a hunch."],
  ["Hammer", "Raises from even money up. Same discipline as Anchor, a lot more pressure."],
  ["Mirage", "Raises its worst hand and its best, calls in between. The bluffer."],
  ["Bully", "Raises almost everything, then backs down when someone raises back."],
];

export default function AboutPage() {
  return (
    <Page title="About">
      <p className="hud-card px-4 py-3 text-[16px] leading-7 @3xl:text-[18px] @3xl:leading-8">
        Gamine brings token launches and an agent arena into one village. Launch a token on Solana, or hold at
        least $20 worth of $GAMINE or any token launched here to activate an agent for that token. The system picks a strategy and starts autoplay against
        other players&apos; agents. Matches never spend your tokens.
      </p>
      <AgpCard />

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @3xl:items-start">
        <Block title="How a match works">
          <p>
            A match is up to three rounds; the first agent to win two takes it. At the start of each round, both agents
            privately draw an edge between 0.30 and 0.70, roughly their chance of winning that round. Each sees only
            its own.
          </p>
          <p>
            One agent acts first and the other answers. Either can fold, call or raise. A fold gives up the round for a
            small ante. If nobody folds, a coin weighted by the two edges decides the round, and a raise doubles what
            it is worth.
          </p>
          <p>
            Because neither side can see the other&apos;s edge, the weaker hand can raise and make the stronger one
            fold. That is a bluff. Whether it pays is the game.
          </p>
          <p className="text-muted">
            After the match every hand is revealed, both sides, round by round, like a poker hand history.
          </p>
        </Block>

        <Block title="The four presets">
          <p className="text-muted">One of these four strategies is picked randomly when your automatic agent activates. There is no single default strategy.</p>
          <ul className="space-y-2">
            {PRESETS.map(([name, text]) => (
              <li key={name} className="flex gap-3">
                <span className="w-16 shrink-0 font-mono">{name}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Writing your own">
          <p>Prefer to choose? End your automatic agent on the Agent page, then create a new one with your chosen preset or a written strategy. Ending an agent stops automatic recreation; your tokens stay in your wallet.</p>
          <p>
            Instead of a preset, you can describe how your agent should play in plain English: when to fold, when to
            raise, when to bluff. An AI model turns that description into a strategy table, once, when you get the
            agent. After that the agent plays the table. The model is never consulted during a match.
          </p>
          <p>
            Before you choose, the preview rates your strategy exactly against every agent on the roster as it
            stands today: its expected result per match, computed by working through every possible draw and coin flip,
            not by simulation. Only you see it. Your written strategy stays private; other players see only what your
            agent does.
          </p>
        </Block>

        <Block title="Holding is the agent">
          <p>
            Hold at least $20 worth of a qualifying token in your own wallet and its agent activates automatically with autoplay
            enabled. Holdings are checked regularly and when you sign in. Nothing is rented, deposited or staked
            to play. One wallet can have one active agent per qualifying token, each with its own strategy and holding clock.
          </p>
          <p>
            If your verified holding value falls below $20, play pauses. It resumes when your holdings qualify
            again. If the verified balance reaches zero, that token’s agent is retired; other token agents remain active. Market prices can change eligibility even if you keep the same number of tokens. If holdings
            or price data cannot be verified, play waits for fresh information.
          </p>
          <p>
            A lost match costs nothing. Every match is played at one scale &mdash; ante 4, bet 10, raised 20 &mdash; and
            the chips a match is won by are its score, not money.
          </p>
        </Block>

        <Block title="Power and rewards">
          <p>
            Each day&apos;s score is the net chips your agent won against other players&apos; agents, times a weight
            from x1 to x4. The weight comes from your holding: mostly how long you have held (85%, up to 180 days),
            and a little how much (15%). It weights the reward and never a match &mdash; strategy alone decides those.
          </p>
          <p>
            Tokens launched through Gamine direct 65% of their creator fees to rewards: 15% to the daily wallet
            and 50% to the weekly wallet. The remaining 35% goes to the platform wallet.
          </p>
          <p>
            Rewards are paid in $GAMINE from the reward wallets: the daily payout for the previous UTC day each morning,
            and the weekly payout for each season. At payout, only agents still in play are paid &mdash; selling all
            your tokens ends your agent and its scores &mdash; and your wallet must hold at least $20 of that token. Shares
            follow score; each payout sets a maximum share per winner and a minimum score, and what the cap holds back
            goes to the other winners. The platform takes no cut, and every transfer is on chain. The{" "}
            <Link href="/rewards" className="text-accent">
              rewards page
            </Link>{" "}
            lists every payout with its transactions, and shows who would be paid as things stand.
          </p>
        </Block>

        <Block title="Launching a token">
          <p>
            Create a real pump.fun token from the{" "}<Link href="/launch/new" className="text-accent">launch page</Link>
            {" "}using your connected Solana wallet. Enter its name, ticker, image and description, then review and
            approve the launch transaction. You can optionally buy your token during launch.
          </p>
          <p>
            Every launch includes a mandatory 0.1 SOL platform fee to discourage spam. Network fees and account
            creation costs are additional, as is any optional purchase. The creator-fee split is locked during
            launch; launchers receive no creator-fee share.
          </p>
        </Block>

        <Block title="Your wallet and the game">
          <p>
            Gameplay reads your holdings and records match scores without transferring your tokens. Agents do not
            sign transactions. Token launches and optional purchases are separate wallet-approved transactions
            on Solana mainnet.
          </p>
          <p className="text-muted">
            Nothing has been audited. Holding requirements and reward rules are described above.
          </p>
        </Block>

        <Block title="The game token and networks">
          <p>
            $GAMINE and tokens confirmed as launched through Gamine qualify for holder agents. Each token must independently meet the $20 requirement; balances across tokens are not combined. Everything runs on
            Solana mainnet: $GAMINE is live, and pump.fun launches use mainnet SOL.
          </p>
        </Block>

        <Block title="House agents and inactive tokens">
          <p>
            House agents keep the village moving with exhibition matches. They are counted separately from real
            agents and never earn rankings or rewards. House exhibitions pause when ten eligible real agents
            have autoplay enabled, and resume if that count drops below ten.
          </p>
          <p>
            A launched token is archived after four hours of verified zero trading activity. Archived tokens
            disappear from public listings and active-token counts, while admins retain their records. Missing
            market data alone is not proof that a token is inactive.
          </p>
          <p>
            The source repository will be shared when ready.{" "}
            <a href={REPO} className="text-accent" target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </p>
        </Block>
      </div>

    </Page>
  );
}
