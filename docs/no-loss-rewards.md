# No-loss play

**Replaced 2026-10-02 by [holder-agents.md](holder-agents.md),** before it was built. Its score, guards and daily-and-weekly shape carry over there; the rent, the deposit and the deposit-weighted share do not. Kept for the reasoning behind what carried over.

**Status: decided 2026-09-30, not built.** This replaces the staked model in [economy.md](economy.md) once it is built: matches stop moving money between players, and the prize pool becomes the only way to earn. Until then, economy.md describes what runs on devnet. Nothing here goes to mainnet before the legal review ([Legal](#legal)).

## In one paragraph

An owner rents an agent for a week ($2 of $GAMINE, burned) and funds it with at least $20 of $GAMINE. The agent then plays other players' agents at Bluff & Fold, and nothing it holds is ever at risk: a lost match costs nothing. Winners share the reward wallets, funded by the token's creator fees, by a score that multiplies the net chips they won against other players' agents by the weight of a deposit they have kept in play. The owner can withdraw whenever the agent is not busy, which takes it out of the game and out of the rewards not yet paid.

## Decided

| # | Decision |
|---|---|
| 1 | **Nobody loses anything.** A lost match costs the owner nothing. The deposit is never staked. |
| 2 | **Rent: $2 of $GAMINE, burned, for one week** - the season, Monday to Monday UTC, as built. |
| 3 | **Minimum funding: $20 of $GAMINE**, up from $5. It is never spent; it is the owner's, and it is what the reward weight reads. |
| 4 | **One agent in play per wallet at a time**, as today. Retired agents do not count. |
| 5 | **One game: Bluff & Fold.** Mining was designed and dropped the same day ([Mining, dropped](#mining-dropped)). The other games on the games page stay in design. |
| 6 | **Rewards come only from the reward wallets**, funded by pump.fun creator fees, and are paid in $GAMINE. The split stays as decided: 10% daily wallet, 50% weekly wallet, 40% platform, each payout releasing half its wallet ([economy.md](economy.md#creator-fees-and-prizes)). |
| 7 | **No lock.** The owner can withdraw whenever the agent is not busy, which means between matches: a match lasts seconds. |
| 8 | **Withdrawing everything, or below the $20 minimum, takes the agent out** of the game and out of every reward not yet paid. It can come back by funding again. |
| 9 | **To be in the rewards, the agent must be active** - playing by hand or on autoplay - and still in when the reward is paid. |
| 10 | **Latecomers take part.** An agent joins a reward period whenever it starts playing, and is paid for what it did in the time it had. |
| 11 | **A deposit counts only once it has been in play for a full day** (the counted deposit, below). This is what stops a large deposit arriving just before a payout from buying a large share. |
| 12 | **No bands.** Every match plays at one scale - ante 4, bet 10, raised 20 - and every agent can meet every other. A band's only job was setting how much money a match could move, and nothing moves. A chip is a chip, so nothing is normalised before scoring. Decided 2026-10-01; this was open question 3. |
| 13 | **Payouts are proportional to score**, daily and weekly alike, within the 10% cap. Decided 2026-09-30; this was open question 1. |
| 14 | **Points are net chips, not win counts.** What an agent won across its ranked matches in the period, less what it lost, floored at zero; capped at 40 against any one opponent a day; and a minimum of ranked matches, not points, to qualify. Decided 2026-10-01, replacing one point a win ([The score](#the-score)). |
| 15 | **The qualifying minimums are parameters, not constants.** 10 ranked matches a day and 50 a season assume opponents are there to play; with a thin roster autoplay waits, so an agent can be active all day and still not qualify, and the payout pays nobody. Both minimums start low at launch and rise as the roster grows. What each is set to, and when it changes, is recorded, so a season's qualifying bar can be read afterwards. Decided 2026-10-01; part of open question 1, which stays open. |

## The score

Each day, every qualifying agent gets a score, and the day's payout is shared in proportion to it; the weekly payout adds up the days ([Daily and weekly](#daily-and-weekly)):

    score  = points × weight
    points = max(0, Σ over opponents of min(40, net chips won against that opponent))
    weight = min(4, √(counted deposit ÷ $20))

- **Points** are the net chips the agent won across its ranked matches in the period - matches against other players' agents. A match lost subtracts what it lost, so points measure how well the agent played, not how often. A day's points are floored at zero: an agent can have a bad day, but never a negative one.
- **Against any one opponent, at most 40 chips a day count** - one match's widest net. Beating the same opponent over and over earns what beating it once can earn. Losses against it still count in full.
- **Points reset every period.** A day counts that day's matches; a week adds up its days.
- **Counted deposit** is the lowest balance the agent held over the last 24 hours in play. An agent in play for less than 24 hours - or topped up within them - counts at the $20 minimum for whatever it has not held a full day. A withdrawal and redeposit starts the day again.
- **The weight grows with the square root of the deposit and stops at ×4**, which $320 reaches. Four times the deposit is twice the weight, not four times, so money helps a winner without letting it outweigh winning.
- **No points, no reward**, however large the deposit.

**The rent screen's figure is the score's unit.** The expected net per match it shows (`previewPolicy`, exact, against the other players' agents in play) is what points are made of: an agent expected to net +0.4 a match, playing 100 ranked matches a day, expects about 40 points a day before its weight. The caps and the floor only ever trim the tails.

Examples, one day:

| Agent | In play | Deposit | Ranked matches | Net chips | Counted as | Weight | Score |
|---|---|---|---|---|---|---|---|
| A | all day | $20 | 72 | +38 | $20 | ×1 | 38 |
| B | all day | $80 | 72 | +38 | $80 | ×2 | 76 |
| C | 12 hours | $20 | 36 | +20 | $20 | ×1 | 20 |
| D | last 2 hours | $20 | 12 | +9 | $20 | ×1 | 9 |
| E | last 2 hours | $2,000 | 12 | +9 | $20 | ×1 | 9 |
| F | all day, for days | $2,000 | 72 | +3 | $2,000 | ×4 (cap) | 12 |
| G | all day | $80 | 72 | −15 | $80 | ×2 | 0 (floored) |
| H | all day | $20 | 8 | +30 | $20 | ×1 | not qualified |

E's money buys nothing on its first day; F's buys the cap, which any owner with $320 reaches too, and F still trails A for want of winning. G lost on the day and scores nothing, but loses nothing either. H won well but played too few ranked matches to qualify.

## Daily and weekly

Two payouts, from the two reward wallets, on the same score:

| | Daily | Weekly |
|---|---|---|
| **Wallet** | daily reward wallet, 10% of creator fees | weekly reward wallet, 50% of creator fees |
| **Paid** | every day, 00:00 UTC | at the season boundary, Monday 00:00 UTC |
| **Score** | that day's points × that day's weight | **the sum of the agent's daily scores across the season** |
| **To qualify** | 10 ranked matches that day, lower at launch (decision 15) | 50 ranked matches across the season, lower at launch (decision 15) |
| **Must be in** | at that day's payout | at the boundary |
| **Share cap** | 10% of the payout | 10% of the payout |

- **The weekly score adds up the days**, so each day's points carry the weight that day's counted deposit had, and each day is floored on its own: a bad Tuesday costs nothing from a good Monday. A latecomer's week is simply shorter; a large deposit that arrives mid-week counts from the day after, exactly as it does daily. No second formula to explain or to game.
- **An agent earns both.** A day's points count toward that day's payout and toward the week's; the two come from different wallets and never share a pool.
- **The weekly is the larger prize** - five times the daily wallet's share of fees - which is what makes staying in for the whole week worth more than dipping in for days.
- **Withdrawing out before the boundary forfeits the week**, as it forfeits any day not yet paid. Days already paid stay paid.
- **Each payout releases half its wallet**, as decided, so a quiet week still pays and neither wallet empties.

## Guards

- **Only matches against other players' agents score.** House agents are fixed presets whose weaknesses are exactly computable (`src/exact.ts`); winning against one measures nothing, as today.
- **At most 40 chips against any one opponent a day.** Losing is free, so a second wallet can hand out wins; this holds a puppet opponent to what one match against it could ever earn, at the cost of its $2 rent and a $20 deposit.
- **No agent takes more than 10% of a period's payout.** The backstop if anything not foreseen here lets one agent score far above the rest; what is left over stays in the wallet for the next period.
- **A minimum to qualify, in ranked matches rather than chips:** 10 in a day, 50 in a season once the roster can supply them. A count is harder to game than a chip total, and it does not punish an agent for a bad run - a match lost still counts toward qualifying. Both are parameters, set low at launch and raised as the roster grows, each value and each change recorded (decision 15). The season figure replaces `MIN_RANKED_MATCHES_FOR_PRIZE` (20 as built) when this is built.
- **Anomaly detection stays**, flagging rather than pre-blocking ([economy.md](economy.md#anti-farming)).

## Mining, dropped

Mining - agents digging hills on the field for hours, for a find or nothing, scoring points as a win does - was designed on 2026-09-30 and dropped the same day: one game is enough for now. It would have let agents earn without an opponent in thin early weeks; against that, a dig partly decided by luck and paying $GAMINE to renters was the hardest part of this design to defend ([Legal](#legal)), and the most to build. If it returns, the design was: the playbook decides which hill and when to dig deeper against a collapse, every dig is seeded and published like a match, and a find is worth points.

## What this replaces

In [economy.md](economy.md):

- **Funding and stakes.** Stakes are no longer zero-sum between two agents; nothing moves between players. The $5 minimum becomes $20.
- **Bands.** Gone (decision 12): a band's scale set how much a match could move, and with nothing staked they had no job.
- **Autoplay's balance floor, loss budget and survival figures.** All exist because a balance could shrink; none applies when it cannot.
- **Placement's "net per chip staked".** Replaced by the score above.
- **"No pay-to-win: a larger balance must never help."** Reversed in part, on purpose: a larger deposit raises a winner's share, capped and only after a day in play. It still never makes an agent play better; the decision table decides every action.

In the program and [mainnet.md](mainnet.md):

- **Stays:** rent (burned), deposit, withdrawal, the non-custodial exit, the chip rate for converting dollar amounts, `set_admin`.
- **Unused once nothing is staked:** `settle` and `settle_net` between players' vaults, the clearing account, the per-agent loss budget, `max_settlement`, and the hourly outflow cap as the brake on a stolen settler key.
- **New:** paying rewards from the reward wallets to owners, and whatever records a period's scores so the payout can be checked against them.

This is a large change to the mainnet plan, and easier to make before the program is deployed and initialised than after.

## Legal

Real rewards for a paid rental, where chance plays a part, are what most places treat as gambling: payment, chance and a prize of value together. Two parts need the lawyer in particular, before either pays real $GAMINE:

- **Bluff & Fold's prizes.** Each round's edges are drawn at random; the decision table is what argues for skill, and whether skill or chance mostly decides a match is the question.
- **A deposit that raises a share of token rewards**, which may read as an investment return.

This is [economy.md](economy.md#open-questions)'s open question 5, extended.

## Still open

1. **Early weeks.** Rewards need player opponents, and at launch there will be few: the pool pays a handful of agents until more arrive, and each payout releases only half its wallet, so nothing is wasted meanwhile.
