# Reward payout batches

Decided 2026-10-05: accumulate creator fees as SOL in one shared agent
reward wallet. At payout, swap SOL into $GAMINE and distribute $GAMINE to
winners in small batches, instead of buying the whole pool at once.

Decided 2026-10-12: the operator buys $GAMINE into the reward wallet by hand, and
the payout distributes what the wallet holds (**held $GAMINE**, the default). No
Jupiter API key is needed. The SOL-swap mode below remains available, and needs
`JUPITER_API_KEY` only when used.

## Held $GAMINE (default)

1. In the shared agent reward wallet itself, swap SOL for
   $GAMINE, in several small buys if that limits price impact. Keep the swap
   signatures: the dashboard does not record the purchase.
2. In `/admin`, choose **$GAMINE already in the reward wallet**, the period, the $GAMINE
   amount to pay, a minimum score (0 for none), the maximum share per winner
   (default 10%) and the payout percentage. What the cap holds back from a top
   scorer goes to the other winners by score, so the whole amount is paid when
   winners × cap reaches 100% (ten winners at 10%, five at 20%). Shares
   come from the frozen scores with the same 10% per-winner cap; the plan shows
   each winner's $GAMINE and lists who was not paid, and why.
3. **Approve this plan**, then **Start payout**. In Phantom (or Solflare), select the
   reward wallet; the admin sign-in stays on the operator's wallet. Press **Approve
   transfer 1 of N in Phantom** and approve it there; when it shows **Waiting … to
   confirm**, it updates by itself, then offers the next transfer. Up to eight winners
   are paid per transaction, so 40 winners are five approvals.

   An approved plan that has not started can be withdrawn with **Cancel approval**,
   which frees its days for a new plan; once started, it can only be paused. The
   panel opens any approved plan still to pay in a **Ready to pay** box at the top,
   shows the reward wallet's $GAMINE and SOL (red below 0.06 SOL), and starts the form
   at the next unpaid day.
   Before starting, the wallet must hold the allocated $GAMINE and the SOL fee
   reserve (`PAYOUT_FEE_RESERVE_SOL`), which pays network fees and any winner's
   new token account.

**Checked at payout, not at freeze.** At preview the API drops every winning agent
that is no longer in play (its wallet sold to zero since: the agent ended, and its
scores went with it), the reward wallets' own agents, and anyone under the minimum
score. It reads every remaining winner's wallet on chain, at the verified price,
and drops anyone holding under $20 of their agent's token. Shares are then
worked out again over the winners left (proportional to score, capped at 10%), so
the dropped shares go to the holders who stayed. The web refuses to preview
against an API too old to make this check. A wallet that sells between preview
and payment is still paid: preview close to paying. If a holding cannot be read,
the preview fails rather than guessing; try again.

**Catch-up: several days at once.** A daily plan can cover a run of frozen days
(**Through** on the form, up to 31 days): each agent's score is the sum of its
scores on the days in the run where it qualified, and the holding check, minimum
score, shares and 10% cap apply to that total. A day is paid once: approval refuses
any daily plan, single or catch-up, that overlaps one already approved. Used first
for the days from $GAMINE's launch (2026-10-09) to the first regular payout; after
that, one plan per frozen day, and weekly plans from the same shared agent reward wallet.

**What the wallet may add.** Phantom adds its own instructions to a transaction before
signing it (a priority fee, balance assertions). A signed winner transfer is accepted
with additions only if it keeps the prepared signer and blockhash (expiry is counted
from it, so a payment is never prepared twice) and every prepared instruction,
unchanged and in order; and only after simulating exactly what was signed shows the
reward wallet's $GAMINE falling by the planned total, each winner's rising by their
amount, and the SOL spent within the fee limit. A swap must come back byte for byte,
as Jupiter executes only what it built.

**Eight per transaction.** Eight transfers, each creating the recipient's token
account if it is missing, measure 1,024 of Solana's 1,232 bytes. A transaction
lands whole or not at all, so its eight are paid together; a failed one pauses
the payout and is retried as a whole. The SOL cost limit (`PAYOUT_MAX_TX_COST_SOL`)
applies per transfer.

Amounts are planned in the mint's base units, read from the chain at preview and
checked again before any transfer. Whatever is capped, rounded or not allocated
stays in the reward wallet as $GAMINE for a later payout. There is no swap step and
no batch delay: winner transfers in transactions of eight, each signed, saved
before submission, and counted only after finalized confirmation, as below.

## Swapping SOL during the payout

The `/admin` dashboard now supports payout-plan previews, per-plan percentages,
approval records and history. Its API checks signed wallet sessions and the
backend's existing `ADMIN_WALLETS` permissions. Recipient wallets and shares
come from frozen game scores, never from an administrator's submitted list.
SQLite stores each plan and the approving wallet. Only one plan can be
approved per daily/weekly period; approving the same plan again is idempotent.

Set `ADMIN_WALLETS` in the backend's root `.env` to a comma-separated list of
operator public addresses, then restart the backend. It is intentionally empty
by default; the platform receiving address is not automatically made an admin.

The administrator selects a SOL budget, the percentage allocated to rewards,
the maximum SOL per batch, minimum delay and maximum slippage. Defaults shown
for review are 90% rewards, 0.25 SOL per batch, 60 seconds between batches,
and 50 basis points (0.5%) slippage. These are starting settings, not liquidity
estimates or promises that a trade will succeed.

For a 10 SOL budget at 80%, up to 8 SOL is allocated to winners and at least
2 SOL stays in the same reward wallet, accumulating alongside new fees for
future payouts. The platform takes no cut from reward wallets. The existing
10% per-winner cap still applies, per wallet/token pair: a wallet with agents
for several tokens is paid once for each, each capped on its own; capped or rounded allocations also stay in
the reward wallet. Rent, transaction costs and swap fees must be accounted for
separately. The pump.fun creator-fee split is 70% to the shared agent reward wallet and 30% to the platform.
Older plans with a platform cut remain in history but cannot be approved;
preview a new plan using these rules.

## Wallet-approved execution

The executor prepares real mainnet swaps and winner transfers. **Approval records
a plan only.** Start the approved plan, then use **Check progress / approve next
step**. Each swap and each winner transfer needs a wallet transaction signature;
there are no server-held private keys. Choose Phantom or Solflare and switch that
extension to the source reward wallet. The admin session may remain on the
operator's wallet: admin authorization and the reward wallet's spending signature
are checked independently. An embedded wallet can sign only if it is itself the
source reward wallet.

Set these on Railway's **web** service, or `web/.env.local` locally:

- `PUMP_RPC_URL`: verified Solana mainnet RPC.
- `PUMP_AGENT_REWARDS_WALLET`: the shared signing-wallet address for all agent payouts.
- `PUMP_PLATFORM_WALLET`: the separate platform receiving address.
- `PAYOUT_AGP_MINT`: real mainnet $GAMINE mint; preview again after changing it.
- `JUPITER_API_KEY`: server-only key from Jupiter's developer portal. Needed only to swap SOL during a payout; held-$GAMINE payouts run without it.
- `PUMP_LAUNCH_DB_PATH`: SQLite file on one persistent volume, retaining launches and payout journals.
- `PAYOUT_EXECUTION_ENABLED=true`: enable preparation and confirmation processing.
- `PAYOUT_FEE_RESERVE_SOL=0.05`: minimum SOL beyond the payout budget for costs.
- `PAYOUT_MAX_TX_COST_SOL=0.01`: maximum extra SOL cost per simulated transaction.
- `PAYOUT_MAX_PRICE_IMPACT_BPS=200`: maximum absolute quoted price impact (2%).

Do not put reward-wallet keys in Railway or a `NEXT_PUBLIC_*` variable. The RPC,
mint and a viable liquid Jupiter route must be verified before real payments;
the automated tests use fake providers and do not send funds. The initial wallet
balance must cover the full budget plus reserve. Fees/rent consume that extra
reserve; they do not give the platform a share of retained rewards. Insufficient
funds pause the process. One unfinished payout reserves each source wallet, and
an approved period stays unique even after payment completes.

Standard SPL tokens and Token-2022 metadata extensions are supported. Transfer-fee,
transfer-hook and confidential-transfer mints are rejected rather than miscounting
recipient receipts. The worker checks finalized receipts every five seconds while
enabled. It may re-submit an already wallet-signed transaction, but it cannot
prepare or sign another payment without the operator using the dashboard.

The executor processes one batch at a time:

1. Confirm the approved source wallet, SOL budget and network-fee reserve.
2. Get a fresh SOL-to-$GAMINE quote only when the batch is ready. Enforce the
   approved spending, slippage and price-impact limits, or pause for review.
3. Submit through a managed/protected transaction path, not a public fallback.
4. Wait for finalized confirmation and measure actual $GAMINE received from the transaction's token-balance changes.
5. Distribute that batch to the snapshotted winners, with integer token amounts.
6. Confirm every transfer, persist its signature and wait at least the approved
   delay plus a randomized 0–15 seconds before the next swap.

Persist signed bytes and identifiers before submission. A timeout leaves a
batch pending; resume/check its original signatures rather than creating another
buy or payment. Never mark a swap or payout complete based only on a browser
assertion. A partial payout spends only the completed batches; all remaining
SOL stays in the reward wallet. There is no platform transfer from rewards.
Pause/resume retains signed bytes. Fresh transaction bytes are permitted only
after a finalized failure or finalized block-height expiry with no transaction
status. Expired unsigned wallet prompts can be refreshed without sending anything.
History retains failed attempt signatures. Confirmed transfer totals include
partial payouts exactly once. There is no fee-claim operation: payout sources
must already contain their accumulated SOL.

Batching limits individual order size and can reduce price impact, but does not
guarantee protection from front-running. Use conservative slippage, fresh quotes,
liquidity/price-impact checks and managed transaction submission together.
Jupiter's [Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute)
supports managed landing and swap confirmation. Its
[Swap API overview](https://developers.jup.ag/docs/swap)
describes the available routing and MEV protection. Those services and a liquid
mainnet $GAMINE market must be verified before enabling payments.
