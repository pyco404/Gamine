# Security model

**Replaced 2026-10-02 by [holder-agents.md](holder-agents.md).** With no deposits, vaults or on-chain program, most of what this page protects is gone: the vaults, the settler key, the program's caps and the exit. It is kept for the reasoning and the record of what was measured and closed. What still needs securing under holder agents - the reward wallets' keys and the key that signs payouts - is in [economy.md](economy.md#roadmap).

Gamine is a devnet demo with fake currency. This document says what it protects, how, and where it stops. Nothing here has been audited.

## What is at stake

Game tokens in per-agent vaults on Solana devnet, and the accuracy of the off-chain ledger that decides every movement. There is no mainnet deployment and nothing of real value.

## Who is trusted with what

| Party | Can do | Cannot do |
|---|---|---|
| A player (wallet) | Sign in; rent agents; play their own agents; move their own agents between bands their balance covers; rate briefs; **withdraw from their own agents' vaults**, signing a transaction | Act for another wallet's agents; withdraw from anyone else's vault; withdraw without the server co-signing; see another player's brief, table or private rating |
| The model | Fill in a decision table once, when an agent is rented from a brief | Anything during a match; see any key; sign anything |
| The API server | Run matches, write the ledger, queue chain operations, prepare withdrawals | Move vault funds except through the program's `settle`, within its limits, or an owner-signed `withdraw` |
| The settler key (server) | Open vaults, up to 900 each and 18,000 per window between them; settle matches, up to `max_settlement` each (60), each match once, up to a quarter of any one vault's balance per window (never less than 120), and within each owner's daily loss budget; co-sign withdrawals | Exceed those limits; settle a match twice; withdraw without the owner's signature; record anyone but the owner an agent's id derives from; change `max_settlement`, an agent's loss budget or its committed strategy table |
| The admin key | Initialise the program; **upgrade it**; change `max_settlement` within `MAX_SEED`; **move the chip rate**, up freely under `MAX_CHIP_RATE` and down by at most half per step; **rotate the settler** with `set_settler`; **hand itself on** with `propose_admin`, which takes effect only when the proposed key signs `accept_admin` | Open vaults, settle, or withdraw; take the settler's role itself; hand the admin role to the settler's key, or to a key that does not sign for it |

## Identity: wallet sign-in

`src/auth/wallet.ts`, `src/http/server.ts`.

- **Challenge.** `POST /auth/nonce` issues 16 random bytes, bound to one public key, valid for 5 minutes, rate limited per IP.
- **Message.** The wallet signs plain text naming the site ("*domain* wants you to sign in with your Solana account"), so a signature made for Gamine cannot be replayed on another site. It says signing costs nothing and triggers no transaction, because the signing prompt is where people get phished.
- **Verification.** The server rebuilds the exact message it issued and checks the ed25519 signature. It never trusts message text sent back by the client.
- **Replay.** A nonce is burnt with a conditional update, so two concurrent verifications of one signature cannot both open a session. Tested: a wrong-key signature, a replayed nonce, a nonce issued to another key, a tampered message and an expired nonce are all rejected.
- **Sessions.** 32 random bytes, returned once and stored only as a SHA-256 hash, valid 7 days, revoked on sign-out. Sent as `Authorization: Bearer`.
- **Email or X, through Privy (optional).** With `NEXT_PUBLIC_PRIVY_APP_ID` set, a Privy embedded Solana wallet can sign in too. It signs the same nonce message and the server verifies it the same way, so the owner is still the public key and nothing downstream knows the difference. The key lives in Privy's isolated iframe, not the page. Unset, no Privy code is loaded.

## Money: ledger and chain

`src/db/ledger.ts`, `src/db/runner.ts`, `src/chain/`, `chain/programs/gamine_settlement/`.

- **The ledger is authoritative.** Balances are sums of immutable ledger rows. A match, its ledger rows, both ratings and its chain operation are written in one database transaction, so they cannot disagree.
- **The server validates before anything moves.** A match is played at its band's scale, and the band's worst match - two rounds at the raised bet, so 20, 40 or 60 - is what each side risks. Nothing is clamped: both agents must be able to pay that worst case outright before the match is played at all, and an agent that cannot is refused. It is retired only when no band is affordable to it, below band A's 20.
- **Settlement is hourly and net on the deposit flow.** A match moves the ledger at once, but its chain op is marked netted and never sent alone. Once its hour is over the worker cuts that hour's matches into one net settlement per agent (`settle_net`): a loser's net moves from its vault into the program's clearing account, a winner's net out of it. Every cut is zero-sum, so clearing is empty between cuts; a cut's receipts are sent only after all its payments have landed. Each agent's net settlements are numbered, and the program takes only the next one, so each lands once and in order. An agent whose owner opens the withdraw panel, or who is exiting, is cut early rather than made to wait for the hour. The seed program has none of this and still settles match by match (`src/db/netting.ts`).
- **The chain records, in order.** An outbox worker submits vault openings and settlements in the order the ledger recorded them. If the chain is unreachable it stops at the first op it cannot send and starts there next time. If the program refuses an op — a vault that has paid out its limit for this window, say — that op waits for the next pass while the rest carry on, so one throttled vault doesn't hold up everyone else; the program's own balance checks mean an op that overtakes one it depends on is refused too, and lands later. If an earlier attempt landed but its confirmation was lost, the vault or settlement record already exists, so the worker marks it done instead of sending it again.
- **The program checks again.** Only the configured settler can open vaults or settle. A per-match settlement cannot exceed the per-match limit, and settles at most once, because its record is a PDA seeded by the match id; a net settlement is bounded by the hourly outflow cap instead, since an hour's net is many matches. Vault authority is a PDA, so no private key — the server's included — can move vault funds except through `settle`, `settle_net`, or a `withdraw` or exit the agent's owner signed. Each of these is tested on a local validator (`npm run test:chain`).
- **Rate limits in the program.** No vault can pay out more than `outflow_cap` through settlements in one UTC hour, by the cluster's clock, counted in a per-agent account the program keeps and shared by `settle` and `settle_net`. The window is an hour so that an honest hour's net lands in one piece, and by the clock rather than in slots so that it lines up with the hours the server cuts on; it was 1,500 slots, about ten minutes, until hourly netting. That cap is a quarter of what the vault holds, never below 120, and it is read from the balance *before* each payment leaves - so it falls as the vault pays, and a window in practice closes at about a fifth of the balance it opened with. These bound what a stolen settler key can take per hour, rather than letting it empty every vault in one pass (limitation 1). The ledger mirrors the window before it pairs an agent: on the deposit flow, this hour's net loss plus a worst match must fit in a fifth of the balance.
- **A daily loss budget, set by the owner.** Every agent rented on the deposit flow starts with one: a third of its deposit, per UTC day, net of wins. It is created in the rental transaction under the owner's signature, and only the owner can change it (`set_loss_budget`); a raise applies at once, a cut from the next UTC day, so a match already played under the old limit can always settle. `settle` and a paying `settle_net` charge the loss to the day the match was played, in one of three per-agent buckets - today and the two days before - and refuses a settlement that would take that day past the budget, or one dated in the future or more than two days back. The budget account's address is derived from the agent, so a settlement cannot leave it out or name another. The ledger declines a pairing before either side could reach its budget, so the program's check is a backstop the ledger never walks into. Agents rented before budgets existed have none until their owner sets one; for them, and for house agents, settlement is exactly as before.
- **Each agent's strategy table is on chain, fixed at rent.** `commit_strategy` records the 30-cell table an agent plays, signed by its owner, in an account that can be created once. Nothing reads it yet; it is the half of a match a settler key cannot make up, and the input any future check of a result would start from.
- **`max_settlement` is admin-settable.** The per-match cap is stored on the config rather than compiled in, so a band with bigger stakes can be priced in without a program upgrade. Only the admin recorded at initialisation can change it - never the settler, whose reach the cap exists to bound - and it is refused above `MAX_SEED`, so a stolen admin key cannot switch the guard off. The other limits above remain constants, so changing them still means an upgrade.
- **Reconciliation.** `reconcile` compares every fully settled agent's vault with its ledger balance and reports disagreements; it never overwrites either side.

## Withdrawals

`src/db/withdrawals.ts`, `src/agent-id.ts`, `chain/programs/gamine_settlement/` (`open_owned_vault`, `withdraw`).

- **An agent id belongs to its owner.** A new agent's id is the first 16 bytes of `sha256("oxude-agent-v1" || owner's key || random salt)`, as a UUID. Opening its vault recomputes that hash and records the owner in a PDA seeded by the id, in the same instruction. So the only owner that can ever be recorded for an agent is the one its id derives from: a stolen settler key cannot name itself, and there is no window before a record lands in which it could (limitation 11). A house agent's id hashes 32 zero bytes in the owner's place, so it has no owner and nothing can be withdrawn from it. Agents rented before this had random ids and owner records written by the settler; those records stand, created once and unchangeable.
- **Two signatures, on the fast path.** A withdrawal needs the owner's signature, checked by the program against that record, so a non-owner can never withdraw. It also needs the settler's co-signature, which is the server saying nothing is in flight. Tokens can only go to the owner's own token account, and the server pays the fee.
- **One signature, on the path that does not need us.** `request_exit` and `claim_exit` are owner-signed and take no settler at all. The window between them replaces what the co-signature attested: instead of the server promising nothing is in flight, the chain gives it thirty minutes to settle whatever is. The owner pays their own fees there, and the destination is still their own token account. See [non-custodial-exit.md](non-custodial-exit.md).
- **Nothing in flight.** The server refuses while any of the agent's settlements is still pending on chain. On top of that, the transaction states the balance the vault must be left with, taken from the ledger. If the vault disagrees because a settlement hasn't landed, the program refuses.
- **Empty or playable.** A withdrawal must leave either nothing, which retires the agent and freezes its record, or enough to keep playing. The server holds that floor at 20, the cheapest band's worst match, because below it no band is affordable and the agent would be left holding money it could never play. The program enforces a looser floor of its own, `MIN_STAKE` 10, so a vault is never left with dust.
- **Once.** Each withdrawal has an id, and its on-chain record is a PDA seeded by it, so it pays once. The server also accepts each prepared withdrawal's signed transaction once, and checks that it is byte for byte the transaction it prepared.
- **Ledger first.** The ledger row, the outbox row and any retirement are written in one database transaction, then the transaction is sent. While it is on its way, the agent can't play. If it can never land (its blockhash expired, or the program refused it), the ledger row is reversed, the retirement undone, and the queue carries on.

## The model

The model's only job is to fill in a 30-cell decision table from a brief, once, when an agent is rented. The table is validated (every cell must be fold, call or raise) and stored. Matches play the stored table; the model is not called during a match and has no access to keys, balances, other agents or the chain. The prompt is a pure function of the stakes and the brief, and a test checks it contains no seed or opponent information.

## Other protections

- **Rate limits**, per wallet or per IP: model-backed requests 5 a minute (each owner's first is free), matches 30 a minute, sign-in nonces 20 a minute.
- **Privacy of strategies.** Another player's brief, table and exact rating are never returned by the public views of an agent, the ladder, the roster, or match pages. Match transcripts show every hand played, by design — a player who studies transcripts and adapts is playing the game properly.
- **CORS** allows one configured web origin.

## Invariants

Things that are true today and that nothing currently enforces. Each one names
the constants it depends on, because the way these break is that somebody
changes a number without knowing this paragraph exists.

### The close grace must comfortably exceed the watcher's pass interval

**Depends on:** `exit_config.slots` (the exit window, on chain, default
`DEFAULT_EXIT_WINDOW_SLOTS` = 4,500 slots ≈ 30 minutes) and
`exitIntervalMs` in `startChainWorker` (default 30 seconds).

An exit's record is the only evidence on chain that a vault is legitimately
smaller than the ledger. `close_exit` refuses to remove a **claimed** exit
until one whole window has passed since the claim, and the watcher reads every
exit once a pass. So the server has about sixty passes in which to see a claim
before its record can disappear.

That margin is what makes the watcher's other rule safe. An exit that vanishes
before this server ever saw a claim is read as a **cancel**: the agent is
unfrozen and no debit is written. If a claim could be closed inside one pass
interval, that reading would be wrong — the money would have left, the agent
would go back to playing, and the ledger would never hear about it.

**What breaks it.** Lengthening the pass interval, or shortening the window.
The window is configuration, not a constant: `set_exit_window` can halve it
per step, and `MIN_EXIT_WINDOW_SLOTS` is **10 slots, about four seconds —
already shorter than one pass**. Nine halvings from the default reach it, so
this invariant is reachable through ordinary admin transactions with no code
change at all. Below roughly 750 slots (five minutes) the margin is gone.

**If it breaks**, the failure is loud rather than silent, which is the reason
to accept it rather than enforce it in the program: the vault is short, the
exit record is gone, and nothing explains the difference, so `reconcile`
reports a mismatch (see the third state in
[non-custodial-exit.md](non-custodial-exit.md)). The money is still wrong, but
nobody has to notice on their own.

**Enforced since 2026-09-26.** The server reads the on-chain window at startup
and refuses to run when it is less than `MIN_EXIT_GRACE_MULTIPLE` (ten) times
its own `CHAIN_EXIT_INTERVAL_MS`, naming both ways out with the numbers worked
out. Refused rather than warned about: the failure is a silent one, and a
warning in a startup log is how silent failures stay silent.

This is the check to keep, rather than a floor in the program, because neither
constant can see the problem alone - it is only visible from both at once, and
startup is where both are known. The program's floor stays where it is; it
makes zero unrepresentable, which is a different job.

The watcher re-checks it on **every pass** as well, since `set_exit_window` can
move the window under a running server, and alarms once on each crossing - it
already reads the chain every pass, so this costs one more small account read.
That turns what would have been an after-the-fact catch by the reconciler into
an immediate one. Ingestion carries on regardless while the alarm is up: the
window being wrong does not make the money any less real.

## Known limitations

These are real, and would each need fixing before anything of value were at stake.

1. **A stolen settler key can still take money, within limits.** Match ids are made up by the server, so an attacker holding the settler key can invent matches and settle them into a vault of their own; it can open such a vault for the cost of rent. Two limits in the program bound it. The outflow cap: a quarter of each vault per UTC hour - a fifth in practice, as the cap falls with the balance. That is a sixth of what it allowed while the window was ten minutes. With net settlement a thief need not invent match ids at all: `settle_net` takes any amount up to the cap, into clearing and out to a vault of its choosing, and clearing briefly holds honest payments waiting for their receipts, which a thief could take instead. Both are inside the same bound, because nothing leaves a vault except through the cap. And the owner's daily loss budget: by default a third of the deposit per UTC day, and because a settlement may be dated up to two days back, a thief can spend three days' budgets at once and one more each day after. Agents without a budget - rented before budgets, until their owner sets one - are bounded by the outflow cap alone.

   Hostile matchmaking survives any fix to fabrication, and is measured rather than guessed (`scripts/best-response.ts`). Whoever controls pairing can match a victim against a table built to beat the victim's own. Against the presets, the best such table wins 1.1-2.0 chips a match in band B, where ordinary preset-against-preset play is within 0.4; against badly written tables, about 1.5-2 chips a match beyond what ordinary play already takes. At the ten-minute autoplay pace that is roughly 220-290 chips a day per victim in band B. The loss budget bounds this too.

   Having the chain decide results instead - replaying each match on chain with oracle randomness - was measured and set aside: the replay is cheap, but every match would wait seconds on an oracle and play would stop when one is down ([oracle-spike.md](oracle-spike.md)).

   There is no co-signer, and that is a decision, not an omission. A second key that had to approve each settlement would stop a stolen settler key, but the operator holds every key, including the program's upgrade authority, and could replace or remove any co-signer. Built on infrastructure the operator controls it would protect against settler-key theft while implying more, so it was not built.

   **The residual risk, plainly: a stolen settler key is bounded by the outflow cap and the loss budget; a compromised admin key or a dishonest operator is not bounded by anything.**
2. **The admin key can upgrade the program**, and so could replace every rule above. It should move to a multisig, or the program should be made immutable.
3. **Closed, on devnet, and proven there.** This said the vaults were custodial in practice, because a server that refused or disappeared stranded the money. `request_exit` and `claim_exit` are built and deployed, need no signature but the owner's, and are driven by a page that has no dependency on this server at all ([`web/public/exit/`](../web/public/exit/)). On 2026-09-27 a real wallet took money out that way end to end on devnet: it requested an exit, waited out the window, claimed from `/exit`, and the money arrived in the wallet, with the admin page's reconciliation clean afterwards. It no longer depends on our hosting either: the same page is published from the repository to GitHub Pages ([GitHub](https://github.com/.)), a different provider from the Railway service behind trygamine.xyz, by a workflow that publishes the folder exactly as committed. That is the copy that doesn't depend on us - on our servers, our database or our hosting - and the page carries its whole library inline, so a copy saved to disk works opened directly. What it still depends on is GitHub, a Solana RPC endpoint and the owner's wallet.
4. **The settler key is a hot key on the server.** Locally it lives in a file (`.keys/settler.json`); on the deployed site it is a Railway service variable (`CHAIN_SETTLER_SECRET`, and `CHAIN_SETTLER_SECRET_V2` for the deposit program), readable by anyone with access to that Railway project. There is no HSM and no signing service. The seed program cannot rotate its settler without an upgrade; the deposit program can, with `set_settler` from the admin.

   **How it gets there is a known exposure, accepted for now (the operator's decision, 2026-09-29), to be revisited before mainnet.** The mainnet settler is to live only on the api service and never be written to a laptop. The procedure ([rehearsal.md](rehearsal.md#the-settler-key-never-on-a-laptop-a-mainnet-blocker)) generates it in memory and pipes it straight into `railway variables --set-from-stdin`, so it never reaches a file, the screen, the clipboard or shell history. It does pass through the operator machine's memory for the length of that one command: malware on that machine at that moment could take it. The alternative that closes this is for the server to make its own key - the api generating a settler on first start, keeping it on a Railway volume and printing only the public key for the admin to install with `set_settler` - at the cost of a code change and of a key that then lives on a volume.

   On devnet the faucet's treasury key is a second hot key, holding the whole devnet stake supply. That supply is worth nothing, and the faucet that spends it refuses any cluster but devnet by the chain's own genesis hash rather than by a variable naming it, so no configuration mistake can point it at real money. There is no faucet on mainnet and there cannot be one: the supply is fixed and every token already has an owner.

5. **The session token is in browser `localStorage`**, readable by any script running on the page. It grants the app's actions, not wallet authority. Serving the API through Next.js on the same origin would allow an HttpOnly cookie instead.
6. **Nonces and sessions are not garbage-collected.** Expired rows accumulate.
7. **Rate limits are in memory**, per process. They reset on restart and are not shared across instances.
8. **Each per-match settlement record costs the settler about 0.0015 SOL in rent.** Net settlement creates no record per settlement, only one small account per agent the first time it settles net, so on the deposit flow this is now a once-per-agent cost; the per-match records remain on the seed program, and there is no instruction to close them. Each withdrawal likewise leaves a record, and the first one per owner also creates their token account, both paid by the settler.
9. **Unaudited.** The program, the auth flow and the ledger have tests, not an audit. Going to mainnet without one is the operator's decision, recorded as such in [mainnet.md](mainnet.md); it does not close this limitation.
10. **Privy is third-party script in the page.** With the flag on, Privy's SDK runs alongside the session token in `localStorage` (limitation 5), and it contacts Privy's servers and WalletConnect's wallet directory. A compromise of that SDK could read the session token, which grants the app's actions but no wallet authority. Embedded wallets are also custodial in Privy's sense: recovery depends on the user's email or X account.
11. **The settlement path runs through a third party**, and it is a single point of failure. The deployed worker settles through a Helius devnet RPC endpoint rather than Solana's public one, whose rate limits on shared cloud IPs made settlements slow. On 2026-09-23 that key stopped working and every pass failed with `401 Unauthorized` for about 28 hours, queueing 159 settlements. Nothing was lost — the outbox stopped at the first failure, sent nothing twice, and drained in order once an endpoint answered — but nothing noticed either, because a worker that cannot reach a chain looks exactly like a worker with nothing to do. Settlement lag needs an alarm before real money. That endpoint sees every settlement before it reaches the chain and could delay or drop one; it cannot forge one, because the settler's signature is made locally. The ledger stays authoritative and the reconciler still reports a disagreement.
12. **An hour's net of exposure on a non-custodial exit.** Accepted deliberately, and bounded. With hourly netting an agent's matches from the current hour have not reached the chain, so the exit has to be ingested and the agent cut early before its window runs out; the server does both within a minute of the request. A claim can be short only if the server then stayed down, or the payment was refused by the vault's hourly cap and waited for the next hour, for longer than the thirty-minute window. The ceiling is the agent's unsettled net loss: at most its current hour, which the ledger keeps under a fifth of its balance. **The window is shorter than the outflow window it once cleared**: a payment refused by the cap waits up to an hour, and thirty minutes was sized against ten. Lengthening it (`set_exit_window` grows freely) is the fix, and an open decision in [mainnet.md](mainnet.md).

    A reserve would close it: hold `max_settlement` back on every unilateral claim. That was considered and rejected when the exposure was one match — it strands 60 chips on every honest exit to insure against a compound failure that needs the server to die inside a one-pass window and stay dead for half an hour. The exposure is smaller than the cure. It is listed here so that it is a known number rather than a surprise, and it is the figure to revisit if the window is ever shortened.

13. **Closed: renting now proves consent.** This said the server created an agent without its owner signing anything, so it could make one "owned" by a wallet that never asked for it. On the deposit flow a rental is one transaction the owner signs: the rent is burned and the deposit moves from their own wallet, and the agent cannot play until that transaction lands ([economy.md](economy.md), step 5). The seed flow, which never had this, takes no new rentals or renewals since the cutover (`SEED_CUTOVER=closed`, [cutover.md](cutover.md)); its last renewed agent lapses on 2026-10-06.

## Before mainnet

Nothing here is optional. This is a devnet demo today; each item is a thing that
must be true before any of it holds real money.

**Rotate every production credential.** All four were exposed in a terminal
session on 2026-09-20, and `DATABASE_URL` and `CHAIN_SETTLER_SECRET` again on
2026-09-25. They must be replaced, not merely re-scoped. Three have been; the
seed program's settler is the one still outstanding, and only because that
program cannot rotate it (below).

`DATABASE_URL` was rotated on 2026-09-25: the role password was changed and the
old one now fails authentication over the network path, which is the only path
there is — the database service has no `RAILWAY_TCP_PROXY_*` and so no public
endpoint, so reaching it at all requires being inside the Railway project.

Two lessons from doing it. Testing the old password from inside the database's
own container proves nothing, because local connections there use `trust` auth
and never check it; the test has to go over `postgres.railway.internal`. And
`railway variables --set-from-stdin KEY` keeps the value out of the command
line, which `--set "KEY=$(cat file)"` does not.

- [x] `ANTHROPIC_API_KEY` — revoked and reissued in the Anthropic console.
      Rotated on the operator's word; the date was not recorded here.
- [x] `CHAIN_RPC_URL` — Helius API key rolled. Rotated on the operator's word;
      the date was not recorded here.
- [x] `DATABASE_URL` — Postgres password changed in Railway on 2026-09-25, as
      above.
- [ ] `CHAIN_SETTLER_SECRET` — **not rotatable on the deployed program.**
      `set_settler` exists in this repo but was committed on 2026-09-20 at
      22:14, about fifteen hours after the last deploy at 07:05, so the live
      bytecode has never had it: calling it fails with
      `InstructionFallbackNotFound`. Rotating the seed program's settler
      therefore means upgrading it first, which would also ship every other
      program change since that deploy — including the playable-withdrawal
      floor — to the program holding every existing vault.

      The decision taken on 2026-09-25 was **not** to upgrade: the seed program
      is frozen and retires at the deposit cutover, and its token is worthless,
      so a stolen settler there can deface the devnet record but cannot take
      anything of value. The deposit-funded program gets a fresh settler at
      `initialize` and has `set_settler` from the start, so this stops being a
      one-way door. Until the cutover, the seed program signs with a key that
      is known to be exposed. That is a deliberate, bounded acceptance and not
      a thing to repeat on mainnet.

Read variables with `railway variables -s <service> --json` and take the key
names; printing the table puts the values on screen.

**Then the rest:**

- [ ] Hand the admin key to a multisig, or make the program immutable. It can
      upgrade the program, rotate the settler and raise the per-match limit.
- [ ] Close the known limitations below, particularly 1 (a stolen settler key
      can still drain slowly) and 4 (the settler is a hot key on the server).
- [ ] Put an absolute ceiling on what one vault can pay out in a window,
      alongside the proportional one. The cap is a quarter of the vault, which
      was a bounded number while `MAX_SEED` bounded what a vault could hold.
      Deposits remove that bound, so a quarter of a large vault is a large
      number, and the proportional cap alone stops meaning what it used to.
      One `min()` in `settle`, against a chip figure converted at the season's
      rate like every other limit in the program.
- [ ] Get an audit. The program, the auth flow and the ledger have tests, not an
      audit.
- [ ] Recompute every survival figure from the player's deposit rather than the
      fixed seed — see [economy.md](economy.md), open question 3.
- [ ] Revisit the cost of autoplay's waiting retry. An agent with no opponent in
      its band retries on every poll of the scheduler (about every 15 seconds at
      the default interval), not once per interval, so that it plays the moment
      an opponent appears. Each retry is one matchmaking query. Trivial on
      devnet; at scale, many agents waiting in a thin band multiply it. Measure
      it before real money, and consider backing off the retry for an agent that
      has waited a long time (src/db/autoplay.ts, `dueAgents`).

## Reporting

This is a demo. If you find something, open an issue.
