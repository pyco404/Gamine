# Automatic agents for $GAMINE and launch-token holders

A wallet holding at least $20 in each qualifying token gets a separate agent for
each. Qualifying tokens are $GAMINE and confirmed Gamine launches; balances
across tokens are not combined. A verified zero balance retires that token’s
agent, while a nonzero balance below $20 pauses it. Each token has its own clock. The backend picks Anchor,
Hammer, Mirage or Bully with equal probability, once at creation, and enables
autoplay. Matches do not spend or transfer holder tokens. A wallet stays the
owner identity; its public automatic name is its shortened address.

The signed-in Agent page checks holdings automatically and refreshes every
30 seconds. The backend also discovers holders through Helius DAS, without
requiring a site visit, and refreshes them on its holdings schedule (ten minutes
by default). Multiple token accounts of the same owner are aggregated. Pool
and other off-curve program addresses are excluded. Balances are verified over
Solana RPC before activation. Failed reads never become zero balances.

Ending an agent retires its record, switches off autoplay and persists an opt-out
from automatic creation for that wallet/token pair only. The holder can then create a new agent using a chosen
preset or brief. Both automatic and manual creation take the same wallet lock,
so concurrent requests cannot produce two active agents for the same wallet/token pair. Ending and manual
creation move no tokens. Old agent results stay in history. Each wallet/token
pair is paid as its own recipient with its own 10% cap, so a wallet holding
several qualifying tokens is paid for each. Frozen payout recipients merge only
replacement agents for the same wallet/token pair, under that pair's one cap.

On mainnet, eligibility uses a current DEX Screener price from the token's most
liquid matching base-token pool and the mint's real decimals. The required amount
is rounded up. Conviction still follows token amounts; its older amount no longer
overrides the live $20 eligibility threshold. Quotes older than fifteen minutes
or wallet readings older than twenty minutes prevent play until fresh reads
arrive. Autoplay remains enabled during an eligibility hold and resumes when
verified holdings qualify again. Chip scoring and strategies keep their fixed
season rate; market price does not change match rules. Devnet keeps its existing
season-pegged test-token threshold.

## Railway api settings

- `FUNDING_MODE=holder`
- `CHAIN_RPC_URL`: full Solana mainnet RPC URL for production $GAMINE agents.
- `HOLDER_MINT`: the real mainnet $GAMINE mint (overrides `CHAIN_STAKE_MINT`).
- `HOLDER_DISCOVERY_RPC_URL`: mainnet Helius RPC URL with DAS access. Otherwise
  `CHAIN_RPC_URL_HELIUS` is used, or a Helius `CHAIN_RPC_URL` itself.
- `HOLDINGS_INTERVAL_MS`: optional; default 600000.

Balance and discovery RPCs must use the same network. Without discovery access,
signed-in wallets still activate but undiscovered wallets cannot activate until
an on-chain discovery pass or a site visit. Without a reliable indexed $GAMINE price,
mainnet activation stays unavailable. Never use a devnet mint as the mainnet
$GAMINE mint. Deployment's existing migration runner applies
`0034_multi_token_holders.sql`; no destructive migration is required.

## Confirmed launch catalog

`HOLDER_LAUNCHPAD_URL` on the API defaults to `https://trygamine.xyz`. Set it to
`http://localhost:3000` for local mainnet tests. The web route
`/api/launchpad/holder-tokens` exposes paginated mint identity from confirmed
launch records only, including archived launches; it is not a token-market listing.
The API imports these mints into Postgres and verifies balances and per-mint
prices over RPC and DEX Screener. Only this operator-configured origin can
register qualifying launch tokens. Arbitrary client-submitted mints are rejected.
Mainnet catalogs are never read into the devnet game. Deploy both services and
keep the launch SQLite database on a persistent volume.

## Inactive launch tokens

$GAMINE is exempt from inactivity archiving by its configured mint address. It stays
publicly listed even during zero trading activity, and any previously archived
$GAMINE market record is treated as active immediately. Market data still refreshes.
Other launch tokens follow the four-hour rule below.

The web Node server polls DEX Screener every five minutes and persists readings
in the existing launch SQLite database on the persistent volume. A token is
archived after four continuously covered hours of zero buys, zero sells and
zero USD volume across its reported pools. The hourly observation windows must
overlap; an outage, missing market or malformed response resets the evidence
window. A missing listing is not proof of inactivity. Recently launched tokens
are given the full four hours. An archived token remains archived even if
trading later restarts; no launch records are deleted.

Public lists, search, rankings, token detail routes and active-token counts exclude
archived tokens. Owner launch recovery remains available. The authenticated admin
Token monitoring panel retains every confirmed launch, its archive status, last
verified reading, market cap and 24-hour volume. Admin access uses the API's
existing `ADMIN_WALLETS` checks. A provider's unindexed tokens cannot yet be
classified as inactive: they remain visible with unknown figures.

Use a single persistent Node web service and `PUMP_LAUNCH_DB_PATH`; the
instrumentation hook starts the monitor when Pump mode is enabled. Do not run
independent replicas with separate databases. No new market-data API key is
required. DEX Screener does not provide a four-hour zero-volume field: the
continuous observation window is persisted rather than treating 24-hour volume
as four-hour activity.

## Public totals

House exhibitions pause once ten unretired real agents under the same funding
program have autoplay enabled and currently meet the holding requirement. The
house loop resumes below that threshold; exhibitions already played may finish
their visual playback. Village Active, Idle and Total counts include real agents
only, with house residents listed separately. Completed-match counts exclude
exhibitions. House agents never receive rankings or rewards.

Explore shows active tokens, active autoplay agents, combined
24-hour token volume, the shared agent reward wallet’s current SOL balance, and
a payout-total slot. Archived tokens do not contribute to token totals or volume.
Unknown/stale data shows a dash; partial token volume is not presented as a
complete total. Reward-wallet SOL is available balance, not historical fees earned.
Lifetime volume is not claimed from rolling 24-hour figures. Payout totals count
only finalized $GAMINE winner transfers recorded by the wallet-approved executor,
including completed portions of a partial payout. Approving a plan never counts
as paying it. The executor is configured separately; see [reward payouts](reward-payouts.md).

References: [Helius token account discovery](https://www.helius.dev/docs/api-reference/das/gettokenaccounts),
[DEX Screener API](https://docs.dexscreener.com/api/reference).
