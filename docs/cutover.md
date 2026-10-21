# The seed flow cutover

Gamine has two settlement programs on devnet. This is the plan for closing the
older one, and it is short because the machinery already existed: **every rental
ends at a season boundary**, so a rental that cannot be renewed simply runs out.

| | |
|---|---|
| Old, closing | [`EKJHJ8js…n8kir`](https://explorer.solana.com/address/EKJHJ8jsuXQ9hzy4qPXMsAHDagA38C1pkDWoz3un8kir?cluster=devnet) — seeds a free balance, mints its own token |
| New | [`HTs42VFp…tvkdy`](https://explorer.solana.com/address/HTs42VFpHS4XT9Cr8xH7cJEMgqPL9uuzZn6QHGwtvkdy?cluster=devnet) — owner funds the agent, fixed-supply token |

## Why now, and not later

The old program's settler key was exposed on 2026-09-25, and **it cannot be
rotated**: the deployed bytecode has no `set_settler` (see
[security.md](security.md)). Whoever holds that key can mint about 18,000 chips
per ten-minute window into vaults of their own, and drain any existing vault at
roughly a fifth of its balance per window. On devnet that is worth nothing, but
a drained vault stops matching the ledger, and **a withdrawal checks exactly
that** — so the practical harm is that owners find their balances stuck.

This section used to say the exposure lasts as long as the last un-retired seed
agent. That was wrong. **The key stays usable for ever**: the program
is frozen and cannot rotate it, so nothing on this page ends it. What the
cutover can end is how much of the game still relies on that program:

- **Seed players.** Fifteen expired at the 2026-09-28 boundary and lapse on the
  29th. One was renewed on 2026-09-23, before renewals closed, and plays until
  **2026-10-05** (lapses 2026-10-06).
- **Seed house agents.** Forty-eight of them, and a house agent has no rental,
  so no boundary ever retires one. They are retired by hand
  (`scripts/retire-seed-house.ts`, reason `closed`); until then they keep
  playing exhibitions on the old program.
- **Owner balances.** A lapsed agent's balance stays withdrawable, and a
  withdrawal checks the vault against the ledger. So an owner who has not
  withdrawn relies on the exposed program for as long as that money sits there
  (4,692 chips across 16 agents on 2026-09-28). This is the part a drain can
  actually hurt.

Closing quickly is still the right call: every one of those that goes away is
one less thing the key can spoil.

## The dates

| When | What |
|---|---|
| Now | `SEED_CUTOVER=closed` — no new seed rentals, no seed renewals |
| **2026-09-28 00:00 UTC** | The season boundary. Seed agents stop playing and expire |
| **2026-09-29 00:00 UTC** | Grace ends. They lapse; record kept, balance still withdrawable |
| **2026-10-05 00:00 UTC** | The one seed agent renewed before the cutover expires; it lapses a day later |
| **2026-09-28 22:10 UTC** | Done: the 48 seed house agents retired (`closed`), balances untouched; exhibitions carry on with the deposit program's 36 |

Nothing new enforces the player dates: a rental already ends there, and refusing
the renewal is the whole of the change. The house needs the script, because it
has no rental to end.

**Retiring the house leaves its balances alone, on purpose.** They were minted
free and there is no owner to sign a withdrawal, so moving them is neither
possible nor worth anything. More to the point, a ledger that still matches the
vault is what makes a drain *visible*: reconciliation keeps reading those
vaults, and a shortfall there means the exposed key is in use. Zeroing the
ledger first would hide exactly that.

## What is not being done, and why

**Balances are not migrated.** Every seed chip was minted free by the program,
so there is nothing of value to move, and each way of moving it is worse than
leaving it. Withdrawing on owners' behalf needs each owner's signature, which
cannot be collected. Upgrading the old program to rotate its settler would ship
every other change since its deploy — including a different withdrawal rule —
to the program holding every live vault. And waiting for the balances to be
withdrawn one by one just extends the window in which they can be drained.

Owners re-rent on the new program and fund the agent themselves. On devnet the
faucet supplies the tokens, so this costs them nothing but a signature.

## Watching it

Three alarms now cover the window, all of which were absent when the key was
exposed:

- **vaults short of the ledger** — the shape a drain takes, and nothing looked
  before;
- **settlement lag** — the outbox standing still;
- **settler SOL** — the account that pays for everything running dry.

A surplus in a *seed* vault is never credited, because the exposed key can mint
and the money may be invented. Only the deposit program's surpluses are counted,
where the token has no mint authority.
