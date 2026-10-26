# Pump launch integration

The launchpad has a real, wallet-signed mainnet adapter alongside its explicit
preview adapter. Set `NEXT_PUBLIC_LAUNCHPAD_MODE=pump` to use the real adapter.
`NEXT_PUBLIC_LAUNCHPAD=1` exposes the launch pages and village Launch Pad.

The launch transaction, constructed with `@pump-fun/pump-sdk` 2.0.0, contains:

1. Pump `create_v2` for a SOL-paired Token-2022 token. Mayhem, cashback and
   Pump's separate holder-reward mode are off.
2. A Pump fee-sharing configuration and its final, locked recipients:
   shared agent reward wallet **70%**, platform wallet **30%**.
   The launcher receives **0%** of creator fees.
3. An optional token purchase into the launching wallet. Its SOL amount is a
   strict spend cap, including trading fees, and it executes after fee locking.
4. A mandatory **0.1 SOL** transfer to the platform wallet
   configured by `PUMP_PLATFORM_WALLET` (no default address).

All these instructions share one transaction. A failed transaction does not
collect the platform fee or perform the buy; network fees may still apply.
The transaction also pays rent for the new mint, curve, sharing account and,
when needed, token account. Signing in remains free.

For packet size, this SOL-only integration uses the SDK's supported
`updateFeeShares` and `getBuyInstructionRaw` instructions, with protocol fee
recipients read from Pump's live global account. The newer quote-token variants
add unused accounts for native SOL. Mainnet simulation runs before requesting
wallet approval. The metadata is pinned using CIDv0 to keep its HTTPS URI short.
Tests cover maximum accepted name/ticker lengths against a shared lookup table
created for a different wallet and mint, including an initial buy.

Official references: [creation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md),
[fee sharing](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md),
[supported SOL trade instructions](https://github.com/pump-fun/pump-public-docs#existing-trade-instructions),
[Pinata file pinning](https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-file-to-ipfs),
[Pinata JSON pinning](https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-json-to-ipfs).

## Setup

Add the entries from [web/launchpad.env.example](../web/launchpad.env.example)
to `web/.env.local`. `PUMP_RPC_URL` and `PINATA_JWT` are server secrets; they
must not have a `NEXT_PUBLIC_` prefix. The RPC's genesis hash is checked against
mainnet before any launch preparation or submission. There is no devnet fallback.

Set the two receiving public addresses with `PUMP_PLATFORM_WALLET` and
`PUMP_AGENT_REWARDS_WALLET`. The example
contains the configured public receiving addresses. The platform address receives both
the 0.1 SOL launch fee and its 30% creator-fee share. Both addresses must
be valid and distinct. Restart the app after changing them and verify that
launch transactions still fit the configured shared lookup table. A table does
not need every recipient in it: omitted recipients can remain in the transaction
message if the serialized packet stays within 1,232 bytes. Replace the table
only if the packet no longer fits or the table is inactive.
Existing on-chain fee splits are locked and cannot be changed by editing env.

Create a shared mainnet address lookup table once. From `web/`, first inspect
the required addresses with `npm run pump:setup`. This only reads chain state.
To actually create and freeze the table, an operator runs:

```sh
npm run pump:setup -- --keypair /path/to/platform-wallet.json --send
```

This explicit command spends the platform wallet's SOL on lookup-table rent and
network fees. It does not launch a token. The keypair must match the platform
wallet and stays on the operator's machine. The script prints the table address
and saves its public details to `.data/pump-lookup-table.json`; put the address
in `PUMP_LOOKUP_TABLE`. The table becomes usable after the extension slot has
passed. Keep the setup file if an extension/freezing transaction fails: the
existing table can be recovered instead of creating another one.

Use Node 24 or later and a **single persistent Node host** for the launch API.
Launch records are stored in SQLite with WAL and unique IDs/mints. Set
`PUMP_LAUNCH_DB_PATH` to a file on the host's persistent volume. Production
launches stay disabled without that path. Do not put this database on an
ephemeral serverless filesystem or run independent copies on multiple hosts;
shared Postgres storage is needed before scaling that way.

Finally set `PUMP_LAUNCH_ENABLED=true` and restart/rebuild the web app so its
public adapter flag takes effect. Missing configuration leaves real launches
unavailable. To view the fake preview instead, use
`NEXT_PUBLIC_LAUNCHPAD_MODE=mock`.

## Confirmation and recovery

Only an authenticated wallet session can prepare, submit or read its private
launch status. Metadata uploads are capped at 2 MB and three preparations per
wallet per ten minutes. POST requests must originate from the site.

The mint signs the prepared transaction, then its keypair is discarded. Wallet
approval supplies the remaining signature. The server compares the complete
message against the prepared transaction and verifies all Ed25519 signatures
before sending. RPC credentials and Pinata's token never reach the browser.

The browser saves a signed launch before submission; the server persists its
exact transaction and signature before broadcasting. **Resume launch** resends
the same bytes if necessary. It never creates another mint or platform-fee
payment. **Check status** can verify an uncertain submission without resending.
Expiry is reported only after finalized block-height expiry and a finalized
check that the mint does not exist. An unavailable RPC leaves a launch pending.

A launch is listed only after confirmed execution and verification that the
Pump-owned curve points to the matching Pump Fees configuration, with the two
expected recipients and admin updates revoked. Token pages recheck the sharing
configuration. The platform fee is verified through the immutable prepared
message and confirmed signature, rather than a client payment assertion.

## The $GAMINE launch

The official launching wallet is `Gh8BDiUhocbkrwaFv755y75dbH7QgzmaVJdF1SqYRi9H`.
Connect and sign in with this wallet for the official launch; its private key stays
in the wallet. Enter name `Gamine` and ticker `GAMINE` on the website.

Every ordinary launch receives a fresh random mint. The official launch can
optionally use a pre-generated random mint; no vanity suffix is required.

The reserved official mint is `Aw55TiFnRqzXQZyLxhdqxE3T7fGMYpXHECTfDv6H62LS`.
Set server-only `GAMINE_LAUNCHER_WALLET` to the official wallet and
`GAMINE_LAUNCH_MINT_SECRET` to the privately stored keypair JSON. Only that
wallet launching ticker `GAMINE` uses this mint. Other launches are unchanged.
Never publish the keypair or put it in a public environment variable. Remove the
reservation variables after the launch confirms.
Resuming an existing launch keeps its original mint and transaction.
After the confirmed launch, set the public token and holder/reward configuration
to the actual mint address.

## Current limits

This integrates token creation, initial buying, platform charging, fee routing,
metadata storage and launch confirmation. **Multi-token holder-agent activation
is not connected to the game yet.** Real launches keep that tracker stage
pending and never pretend to activate an agent. The existing single-token game
holder flow remains separate.

Market cap and 24-hour volume now come from the persisted DEX Screener monitor,
with verified inactive tokens excluded. Unknown or stale figures show a dash.
Holder counts and bonding progress remain unavailable. See
[automatic agents and monitoring](automatic-agents.md). No fee-claiming worker or automatic reward payout is added here.

The SDK's native ESM dependency chain currently has an Anchor `BN` export
problem under Node. The server loads the SDK's published CommonJS entry through
`createRequire`; its transaction builders work through that entry. No SDK or
private RPC access is bundled into the browser.

Validation: `npm exec vitest -- run --config web/vitest.config.ts` from the
repository root, and `npm run typecheck` from `web/`. Tests stub RPC/IPFS and
do not spend SOL. A real mainnet smoke launch remains necessary after operator
configuration; it has not been performed by this implementation.

## Paying out creator fees

pump.fun does not send creator fees to a token's split on its own: they accumulate
in its creator vault until a distribute transaction pays them to the locked
shareholders (70% shared agent rewards, 30% platform). Anyone may send it; the signer
pays only the network fee. pump.fun's program now sweeps the curve's creator bucket
first, which only `@pump-fun/pump-sdk` 4 builds, so the script uses it under the
alias `pump-sdk-v4` while launches stay on the SDK they were tested with. From `web/`:

```sh
npm run pump:distribute                                    # report and simulate
npm run pump:distribute -- --keypair /path/to/wallet.json --send
```

It defaults to $GAMINE; `--mint <address>` pays out another launch. The first payout,
1.495 SOL, was sent on 2026-10-09.

To pay out every launch except $GAMINE in one run:

```sh
npm run pump:claim-all                                     # report and simulate
npm run pump:claim-all -- --keypair /path/to/wallet.json --send
```

It fetches the site's confirmed-launch list (`/api/launchpad/holder-tokens`) and keeps
it in `web/.data/launched-tokens.json`, adding launches as they appear and never
dropping one, so an archived token is still swept (if the site cannot be reached, the
saved list is used). Each token is simulated first; one failing never stops the rest.
A token with less than `--min-sol` waiting (default 0.001 SOL) is left to accumulate.
`--site <url>` points it at another deployment.
