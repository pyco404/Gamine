# Holder agents

**Status: per-token holder activation implemented 2026-10-06; see [automatic agents](automatic-agents.md) for current behavior and deployment settings.** This replaces both the staked model in [economy.md](economy.md) and the no-loss model in [no-loss-rewards.md](no-loss-rewards.md). Until it is built, economy.md still describes what runs on devnet. Nothing here pays real $GAMINE before the legal review ([Legal](#legal)).

## In one paragraph

Hold $GAMINE in your own wallet above a dollar-pegged minimum and you have an agent. Nothing is rented, nothing is deposited, nothing is held for you, and there is nothing to withdraw. The agent plays Bluff & Fold against other holders' agents, with an automatically selected preset or a strategy its owner chooses, and the strategy alone decides every match. What an owner's holding buys is a weight on the reward, not an edge at the table: each period's score is the net chips the agent won, times a capped weight derived from its **power** - mostly how long the wallet has held, and a little for how much it holds. Playing enough is a gate: an agent below the qualifying minimum of matches does not score at all.

## Decided

| # | Decision |
|---|---|
| 1 | **An agent is a wallet holding at least the minimum.** No rent, no deposit, no vault, no custody, no withdrawal, no exit page. The tokens never leave the owner's wallet. |
| 2 | **No rent.** There is nothing to rent: holding is the entry. It also removes a reason to charge someone before they have seen anything. |
| 3 | **The minimum is $20 at the current verified mainnet price.** Chip scoring keeps its season rate; eligibility is checked separately. Devnet retains the season-pegged test threshold. |
| 4 | **Conviction follows the tokens, not the dollar line.** The token amount is recorded when a wallet first qualifies, and only a sell below that amount resets the clock. A price move, or a retune of the minimum, never costs someone their days ([Conviction](#conviction)). |
| 5 | **One game: Bluff & Fold, unchanged.** The system picks one of the four presets at activation. Holders can end that agent and create their own with a chosen strategy. |
| 6 | **Power never affects a match.** Matches are decided by strategy alone. Power weights the reward and nothing else. |
| 7 | **Power = 85% conviction + 15% position** ([Power](#power)). Performance is not part of it: net chips appear once, in the score. Activity is not part of it either: autoplay puts every active agent near full activity, so it would be banked on day one. Playing enough is the qualifying gate instead - it decides whether an agent scores, not how much. |
| 8 | **Score = net chips won in the period × weight**, the weight derived from power and capped at ×4 ([Scoring](#scoring)). |
| 9 | **The no-loss model's guards all carry over**: the 40-chip cap per opponent per day, the floor at zero, house matches not scoring, and the qualifying minimums ([Guards](#guards)). |
| 10 | **Rewards are unchanged** ([Rewards](#rewards)). |
| 11 | **The village grows with the real-agent count across tokens.** Presentation only, no mechanics ([The village](#the-village)). |
| 12 | **No on-chain program.** Nothing is left for one to do. Payouts are plain token transfers from the reward wallets, the minimum's peg lives in the ledger, and strategy commitments are published as hashes in the season statement. Decided 2026-10-02; the build order is in [economy.md](economy.md#roadmap). |
| 13 | **Conviction runs on balance snapshots**, with the gap stated: a sell and rebuy between two snapshots is not seen. Indexing transfer history waits until someone has actually exploited that. Decided 2026-10-02. |

## Power

    power      = 0.85 × conviction + 0.15 × position

    conviction = min(180, days held) ÷ 180
    position   = min(1, √(share of supply ÷ 1%))

Each part runs from 0 to 1, so power does too.

- **Conviction is 85%.** It is the clock described below, as a fraction of its 180-day cap. It is the one part of power that cannot be bought on the day: it is earned only by holding.
- **Position is 15%.** The square root and the 1% reference mirror the no-loss weight: four times the holding is twice the position, and 1% of supply (10,000,000 of 1,000,000,000) reaches the cap. A wallet holding just the minimum scores close to nothing here - at $20 and a $1M market cap it holds 0.002% of supply, a position of 0.04 and 0.007 of power. Position is the most a large holding can buy, and it is under a sixth of power.
- **Activity is not in power.** An agent on autoplay plays nearly every match available to it, so a share of matches played would put every active agent near full marks from its first day, and it would mostly narrow the gap conviction is meant to open. How much an agent plays matters only as the qualifying minimum ([Guards](#guards)): below it, no score; above it, no bonus.
- **Power is about commitment, not results or effort.** How well the agent plays is measured once, by the net chips in its score; whether it played enough is the gate.

### Conviction

- **The clock starts when a wallet first qualifies**, and the minimum as it stands at that moment, in tokens, is recorded as its **conviction amount** - the minimum, not the whole holding, so a large holder who trims to anything above it keeps their clock.
- **It runs while the wallet holds at least the conviction amount.** Selling below it sets the clock back to zero. Topping up never resets it, and never raises the conviction amount. Selling down to anything still at or above the conviction amount costs nothing.
- **The dollar line does not touch it.** If $GAMINE falls and the minimum is retuned to more tokens, a wallet that has not sold keeps its clock. The minimum is what a new wallet must hold to qualify; once a wallet has qualified, its own recorded amount is what it must keep.
- **After a reset**, the next qualification records a new conviction amount at the minimum as it then stands.
- **At 180 days the clock stops growing.**
- **Mainnet play requires a fresh verified $20 holding at every eligibility check**, independent of the conviction clock. A market-price drop can pause play while the holding clock continues. Devnet retains its test-token threshold.
- **As built, the clock runs on readings** (decision 13), taken every ten minutes and whenever an owner asks: it starts at the first reading that holds the minimum, and a day's score counts the whole days it had run by that day's end.

## Scoring

    score  = points × weight
    points = max(0, Σ over opponents of min(40, net chips won against that opponent))
    weight = 1 + 3 × power

- **Points are the net chips** the agent won across its ranked matches in the period, less what it lost, with the per-opponent cap and the floor described in [Guards](#guards).
- **The weight runs from ×1 to ×4.** ×4 is the cap the no-loss model chose, and it keeps the gap between the most and least committed agent the same as before. It is linear in power, so it is a sentence to explain.
- **No points, no reward**, whatever the power. Power multiplies winning and never stands in for it.
- **Daily and weekly** payouts use the same shared agent reward wallet. Daily scores and weekly season scores still determine the recipients for each payout period.

Examples, one day, each agent with +30 points (a minimum holding's position is taken as 0; it adds about 0.02 to the weight):

| Agent | Held for | Ranked matches | Holding | Power | Weight | Score |
|---|---|---|---|---|---|---|
| A | new today | qualified | minimum | 0.00 | ×1.00 | 30 |
| B | 30 days | qualified | minimum | 0.14 | ×1.43 | 43 |
| C | 90 days | qualified | minimum | 0.43 | ×2.28 | 68 |
| D | 180 days | qualified | minimum | 0.85 | ×3.55 | 107 |
| E | new today | qualified | 1% of supply | 0.15 | ×1.45 | 44 |
| F | 180 days | qualified | 1% of supply | 1.00 | ×4.00 (cap) | 120 |
| G | 180 days | below the minimum | minimum | 0.85 | - | not qualified |

**The spread is 3.55×** between a minimum holder of six months and one who arrived today (D against A), and 2.4× between that six-month holder and a whale who arrived today (D against E). A month's holding is worth about what 1% of supply buys on the day (B against E). G has the power but did not play enough, and scores nothing.

## Guards

All four carry over from [no-loss-rewards.md](no-loss-rewards.md#guards):

- **At most 40 chips against any one opponent a day.** Losing is free again, so feeding wins from a second wallet is back; this holds a puppet opponent to what one match against it could ever earn. Losses against it still count in full.
- **Points are floored at zero** each day. An agent can have a bad day, never a negative one.
- **Only matches against other holders' agents score.** House agents are fixed presets whose weaknesses are exactly computable (`src/exact.ts`); beating one measures nothing.
- **A minimum to qualify, in ranked matches:** 3 a day and 15 a season at launch, raised toward 10 and 50 as the roster grows, each change recorded in the [parameter log](#parameter-log). This is the only place activity counts: it decides whether an agent scores, not how much.

**Anomaly detection stays**, flagging rather than pre-blocking ([economy.md](economy.md#anti-farming)).

### Parameter log

The qualifying minimums and the per-opponent cap are parameters, raised as the roster grows. Every change is recorded here, and every frozen day also stores the values it was scored with.

| From | Daily minimum | Season minimum | Per-opponent cap | Why |
|---|---|---|---|---|
| launch (decided 2026-10-02) | 3 ranked matches | 15 ranked matches | 40 chips | Ten a day assumes opponents are available; on a thin roster autoplay waits, nobody would qualify and the daily pool would pay nobody. The target figures are 10 and 50. |

## Rewards

As in [economy.md](economy.md#creator-fees-and-prizes), with the split changed 2026-10-03:

- Funded by pump.fun creator fees: **70% to one shared agent reward wallet and 30% to the platform**, for every token on the platform. Configure `PUMP_AGENT_REWARDS_WALLET` and `PUMP_PLATFORM_WALLET`; neither has a fallback address. Both daily and weekly payouts use the shared wallet.
- **Each cycle uses an admin-selected SOL budget and reward percentage** (updated 2026-10-05). The remainder stays in the same reward wallet and continues accumulating fees; for example, 80% for winners and 20% retained. The platform takes no additional cut from reward wallets. This replaces the fixed half-wallet release. Network fees and rent need a separate reserve.
- **No agent takes more than 10% of a cycle's payout.** An agent is one wallet holding one token, and each earns on its own: a wallet with agents for $GAMINE, $DOX and $ZIP can take up to 10% for each, so holding more tokens earns more. Only a replacement agent for the same token shares its predecessor's 10% (decided 2026-10-07).
- **Paid in $GAMINE the operator buys into the reward wallet** (decided 2026-10-12). Swapping SOL during the payout remains available but needs a Jupiter key. Execution is built: winner transfers, eight to a transaction, each approved in the reward wallet. See [reward-payouts.md](reward-payouts.md).
- **Paid only to wallets still holding $20 of the agent's token at payout** (decided 2026-10-12). Scores freeze with the day, but a winner who has since sold, or holds under $20, is not paid. Each winner's wallet is read fresh on chain at preview; shares are worked out again over those left, proportional to score and still capped at 10%, so a dropped share goes to the holders who stayed, and what the cap holds back stays in the wallet. The first three days after launch showed why: 127 wallets won a share and 110 had sold everything within days.
- **Only an agent still in play at payout is paid** (decided 2026-10-12). Selling to zero ends a wallet's agent and a rebuy starts a new one, which earns from then on: the ended agent's scores are forfeit, so buying, playing and selling again cannot collect agents. A holder who never sells to zero keeps one agent throughout and loses nothing. Wallets cycling buy-and-sell did exactly this after launch: one sold to zero and rebought 28 times in 40 hours. The reward wallets' own agents are never paid either.
- **The cap is set per payout, and what it holds back is passed on** (decided 2026-10-12). The most one winner may take defaults to 10% and is chosen when previewing a payout. Shares are proportional to score; a winner over the cap is held to it, and the excess goes to the others by score, so the amount set is paid out in full whenever winners × cap reaches 100%. Frozen days still show plain capped shares. With few winners a 10% cap flattens everyone toward the same amount; a higher cap keeps score counting.
- **An optional minimum score per payout**, set when previewing it (default 0, decided 2026-10-12). It applies on top of the qualifying minimum of ranked matches.

## Launchpad (direction)

**Token launch integration started 2026-10-05; automatic $GAMINE holder activation is implemented; multi-token activation is implemented.** The wallet-signed Pump adapter and explicit preview are described in [pump-launchpad.md](pump-launchpad.md). Real launches require operator configuration before they can run. The holding model applies independently to $GAMINE and every confirmed Gamine launch token.

- **Any token can launch on the platform.** It gives up 100% of its creator fees, split 70/30 like every token ([Rewards](#rewards)).
- **Every launch requires a 0.05 SOL platform fee** (50,000,000 lamports), to deter spam. This is separate from creator fees, network costs and any optional initial token purchase. Launchers receive 0% of creator fees and may buy tokens during creation. Recorded 2026-10-05.
- **The launch fee goes to the platform wallet** configured by `PUMP_PLATFORM_WALLET`.
- **The real launch transaction includes the fee transfer with token creation.** The server verifies the complete signed message and chain confirmation before accepting a platform launch. A failed creation does not collect the platform fee, and recovery resends the same transaction. The explicit preview collects no SOL.
- **Its holders become agents in the same village** and draw from **the same shared pool** as $GAMINE agents.
- **Proposed, not implemented: $GAMINE agents earn 1.3x per point; launch-token agents earn 1.0x.** The multiplier sits on top of the weight: score = points × weight × 1.3 for a $GAMINE agent, × 1.0 for any other.
- **One agent per wallet per token.** A wallet holding $GAMINE, $DOX and $ZIP has three agents, each with its own conviction clock, score and 10% payout cap. Selling one token resets only that token's clock.
- **Conviction and position are measured per token.** A $DOX agent's conviction is its $DOX clock, and its position is its share of $DOX supply, through the same formula as [Power](#power).

Each token independently requires $20 at its verified market price. Zero holdings retires its agent; a nonzero balance below $20 pauses it. Still open: how a launch that brings far more agents than $GAMINE shares the pool ([Open](#open), item 2).

## The village

Neighbourhoods open as the real-agent count grows across all qualifying tokens. House residents and replay stand-ins do not trigger expansion. Residents beyond the central hall forecourts get separate dry spots around new homes. Buildings and trees respond to growth inside the current world bounds. Growth is presentation only: it does not affect power, scoring or matches. See [world layout](world-layout.md) for capacity and reload limits.

## What this drops

Rent, deposits, vaults, custody, withdrawals, the non-custodial exit, `settle`, `settle_net`, the clearing account, the loss budget, `max_settlement`, the outflow cap, and bands.

Most of the program's surface goes with them. This is a large change to [mainnet.md](mainnet.md)'s plan, and, like the no-loss change before it, much easier to make before the program is deployed and initialised than after.

## Legal

A reward weighted by how long and how much someone holds a token may read as a return on holding it, which is a different question from whether Bluff & Fold is a game of skill. Both go to the lawyer before any real $GAMINE is paid. This extends [economy.md](economy.md#open-questions)'s open question 5.

## Known properties

### Splitting pays, and the model cannot prevent it

A holder who splits a holding across K wallets, each above the minimum, gets K agents. The same tokens then earn more than one wallet holding them would. This is a property of the model, recorded so it is not mistaken for a bug still to be fixed. It was open question 2 until 2026-10-02.

**Why it pays.** A fix would need one wallet holding N tokens to score more than K wallets holding N/K each, and the model fails that in three places:

- **Position uses a square root**, so splitting raises total position: K wallets of N/K hold √K times the position of one wallet of N (ten wallets, about 3.2 times).
- **Conviction accrues per wallet.** Each wallet's clock runs on its own, so ten wallets at the minimum each reach ×3.55 after six months.
- **Each wallet earns its own points.** Ten wallets play ten sets of matches, so the base the weight multiplies is itself multiplied by K.

The third is why no fix exists inside the model. A different position curve could make concentration pay, and a conviction floor that rises the longer a wallet holds - in tokens, not dollars, as the conviction amount does, so a price move never costs anyone their days - could make splitting cost more tokens. But neither touches the points: whatever the weight does, K wallets that qualify earn K scores. And the floor alone would not have met the condition anyway, since a holder with enough tokens keeps every wallet above it.

**Why it cannot be capped.** A collective cap - agents split from one source sharing one 10% ceiling - needs to know which wallets are related, which is the detection this design cannot do. **The 10% share cap limits one agent, not a fleet.**

**What bounds it.** The pool is fixed. Each payout releases half its wallet, whoever is in it, so splitting creates no new payout: it redistributes the pool toward whoever splits, away from everyone else. The other bounds are per wallet, so they apply K times over without being defeated: every wallet must meet the qualifying minimum of ranked matches, and every wallet's points are capped at 40 chips against any one opponent a day.

## Open

1. **Moving between one's own wallets.** A transfer to a holder's own new wallet looks identical to a sell, and costs the clock unless something links the two. Conviction runs on snapshots for now (decision 13), which reads balances, not transfers, so nothing links them yet.
2. **A launch that outnumbers $GAMINE** ([Launchpad](#launchpad-direction)). If a launch brings far more agents than $GAMINE has, those agents take most of the shared pool on numbers alone. The 1.3x multiplier does not close a large headcount gap, and the fee split does not touch it. The options: a higher multiplier, pools split per token, or weighting each token's collective draw by the fees it contributed.
