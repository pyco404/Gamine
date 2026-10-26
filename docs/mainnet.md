# Mainnet deploy plan

**Status: planned, not started.** Nothing here is deployed to mainnet. This is the order it happens in, what it costs, what cannot be taken back, and what is decided. It sits beside [economy.md](economy.md), which says what the game's money does, and [security.md](security.md), which says what protects it.

**Replaced 2026-10-02 by [holder-agents.md](holder-agents.md).** There is no on-chain program to deploy, so this plan - the verifiable build, the hardware-wallet admin, the account sizing, the initialise-in-one-transaction order - no longer applies. It is kept for its decisions and the measurements behind them; the build order now lives in [economy.md](economy.md#roadmap).

## Decided

| # | Decision |
|---|---|
| 1 | **The chip rate is held until $GAMINE has a real price.** The peg stands (900 chips ≈ $5, [economy.md](economy.md#the-chip-rate)); the number waits for the market. Before launch the program gets the decided rate rule — raise freely, lower by at most half per step — so a wrong launch rate is a few transactions to correct, not weeks of ±50% every six days. |
| 2 | **A fresh program ID from a freshly generated keypair.** The devnet program's keypair has been on a laptop for weeks. |
| 3 | **The upgrade authority lives on a hardware wallet, separate from the config admin**, and the program gets **`set_admin`**, so a lost admin key — the key that sets the chip rate every week — is recoverable rather than permanent. |
| 4 | **Hourly net settlement**, as already decided in [economy.md](economy.md#decided), instead of one on-chain settlement per match. |
| 5 | **House agents need no balance.** They never stake, so they need no vault money to be offered as opponents. This removes the treasury key from mainnet and about $270 of $GAMINE that would have sat locked in house vaults. |
| 6 | **No audit before mainnet, for now. This is the operator's decision**, recorded as such: [security.md](security.md) limitation 9 still stands, and so does the residual risk it describes. |
| 7 | **trygamine.xyz becomes mainnet.** Devnet moves to a subdomain and stays for testing. |
| 8 | **Helius, paid tier,** as the mainnet RPC. The 28-hour settlement outage of 2026-09-23 was the free endpoint. |
| 9 | **Economics confirmed:** $5 minimum deposit (900 chips), $2 rent, a per-match limit of 60 chips (band C's worst match), and a default loss budget of a third of the deposit per day. |

## Keys

Every mainnet key is freshly generated. None of the devnet keys are reused: the admin, settler and treasury keys have been on a laptop, and two of them in Railway variables.

| Key | What it can do | Where it lives |
|---|---|---|
| **Program keypair** | Nothing but fix the program's address, once, at deploy. | Generated on a clean machine and kept private until the deploy — anyone holding it could deploy to that address first. Powerless afterwards. |
| **Deploy key** | Pays for and signs the deploy's ~600 buffer writes, which a hardware wallet cannot practically sign. | A throwaway on the deploy machine. The upgrade authority moves to the hardware wallet straight after, and this key is emptied. |
| **Upgrade authority** | Replace the program's code — and so take everything ([security.md](security.md) limitation 2). | A hardware wallet, used only for upgrades. |
| **Config admin** | Set the chip rate weekly, the rent, the per-match limit and the exit window; rotate the settler; hand itself on, in two steps (propose, then the new key accepts). | A second hardware wallet, used weekly, with a tested seed backup. |
| **Settler** | Settle within the outflow cap and the owners' loss budgets, co-sign withdrawals, and pay every fee and account rent. | Hot, but only as a secret on the mainnet api service — never written to a laptop. Holds a small SOL float, topped up from the ops wallet. The admin can rotate it. |
| **Ops wallet** | Hold the SOL that funds the deploy and tops up the settler. | A hardware wallet. |

No treasury key: with decision 5, mainnet has nothing for one to fund, and there is no faucet on mainnet.

The shared agent reward wallet and the platform wallet ([economy.md](economy.md#creator-fees-and-prizes)) are pump.fun fee destinations, not program keys.

## Steps, in order

1. **Code, before anything touches mainnet**, each tested on devnet:
   1. ~~Token-2022 support~~ — built and on devnet (2026-09-28). The chain suite runs in full against both token programs.
   2. ~~The chip-rate rule: raise freely, lower by at most half per step~~ — built (2026-09-28), not yet on devnet.
   3. ~~`set_admin`~~ — built as a two-step handover (2026-09-28), not yet on devnet: the admin proposes (`propose_admin`) and the new key accepts by signing (`accept_admin`), so a mistyped address can never become the admin.
   4. ~~Hourly net settlement, and the per-agent per-period limit it needs~~ — built (2026-09-28), not yet on devnet. The limit is option B: the outflow window is one UTC hour, a quarter of the vault per hour. Each agent's net for an hour moves in one `settle_net` transfer through a clearing account the program owns ([economy.md](economy.md#open-questions), question 4).
   5. ~~House agents with no balance~~ — built (2026-09-28): matchmaking, exhibitions and retirement ask nothing of a house agent's balance.
   6. ~~The chip rate throughout the server~~ — built (2026-09-30). The server cannot set the rate (the admin is a hardware wallet), so it adopts the program's: on the first pass after each boundary it reads `chip_rate`, records it against the season, and plays the whole week at it (`src/db/chip-rate.ts`); a change the admin makes mid-week is reported as drift and taken up at the next boundary. Nothing stakes before the season's rate is read at startup, and the rent quoted follows the program's on every pass. The admin sets next season's rate and rent with `scripts/set-season-rate.ts --price <USD per token>`, a dry run until `--apply`. **Still open:** that script signs with a file key, and the mainnet admin is a hardware wallet — it needs a way to sign with one.
   7. A mainnet exit page: the mainnet program ID and a mainnet RPC as its defaults.
   8. ~~**Blocker: only the upgrade authority may `initialize`.**~~ — built (2026-09-29, `dc6d4cf`). Found in the [rehearsal](rehearsal.md): `initialize` could be called by anyone, once, and fixes the admin, the settler and the stake token for good. The deploy (step 7) and `initialize` (step 8) are separate transactions, so whoever saw the deploy land could take the program. It now also needs the signature of the upgrade authority recorded in the program's ProgramData. Not on devnet, where the program is already initialised; proven in the rehearsal.
   9. ~~The api on the deposit program alone~~ — built (2026-09-29, `13b4e3b`, `96c2096`). Found in the rehearsal: the server assumed the seed program, crashing without its key, and ran the chain worker, the drift watcher and the settler low-SOL alarm only when the seed program was configured — so with the deposit program alone, which is all mainnet has, nothing would have settled and no alarm would have run. The worker also sent a lone deposit program's ops to the seed client. It now runs on whichever programs are configured, and opens the clearing account itself, since only the api holds the settler.
   10. ~~No seed-program roster on an empty database~~ — built (2026-09-29, `96c2096`). Found in the rehearsal: a fresh database was given 24 house agents on the seed program. With the deposit program alone it now gets the deposit house roster.
2. **Build verifiably** (`anchor build --verifiable`), so anyone can check the deployed bytecode against the source.
3. **Generate the keys** as above. Fund the ops wallet; fund the deploy key and the settler from it.
4. **A separate mainnet environment:** its own database (the current one is devnet agents and balances), api and web; Helius paid; the mainnet cluster, RPC and $GAMINE mint; deposit funding only; the faucet off. Devnet moves to its subdomain.
5. **Mint $GAMINE** on pump.fun, named **Gamine** with ticker **AGP**, and confirm its token program (Token-2022 expected) and that its mint and freeze authorities are revoked — the program refuses a mint that can still mint.
6. **Configure the creator-fee split** on pump.fun, three ways, before fees accumulate ([economy.md](economy.md#creator-fees-and-prizes)). One-shot.
7. **Deploy the program** with the deploy key, and **initialise it in the next transaction**, before anything else: the deploy key is still the upgrade authority, so it signs `initialize` with the admin (step 1.8). Initialise sets the settler, the chip rate from $GAMINE's real price, rent of $2 and a per-match limit of 60 chips at that rate.
8. **Then** move the upgrade authority to its hardware wallet, verify the deployed build against the published hash (step 2), empty the deploy key, and turn the exit window on (30 minutes).
9. **House agents**, which with decision 5 need rows and nothing else.
10. **Prove every path with small real money** and two test wallets: rent, deposit, a player-versus-player match and its settlement, the loss budget, a withdrawal, and a full exit through the mainnet exit page.
11. **Open it.** Publish the program ID and the exit page; switch on the settlement-lag and settler low-SOL alarms.

## What it costs, in SOL

Rent is from mainnet as of 2026-09-28. It has been lowered network-wide before; check again on the day.

**One-time**

| Item | SOL |
|---|---|
| Program data account, **sized from the verifiable build**. With netting the binary is 709,632 bytes (ordinary build; the verifiable one is to be measured), past the 700,000 this was first sized at. At 800,000 bytes, leaving about 90 KB for later upgrades; rent is about 0.254 SOL per 50 KB | ~4.07 at 800,000 bytes, permanent |
| Deploy buffer, refunded when the deploy succeeds | ~3.6, temporary |
| Deploy transaction fees | ~0.01 |
| Config and exit-window accounts | ~0.002 |
| Settler starting float | 1–2 |
| **Needed on hand** | **~8.7–9.7**, at 800,000 bytes |
| **Spent for good** | **~4.1**, at 800,000 bytes |

House vaults are gone from this list with decision 5.

**Running, paid by the settler**

| Per | SOL |
|---|---|
| Rental | ~0.0055, or ~0.007 when the owner has no $GAMINE token account yet |
| Settlement | The transaction fee, ~0.000005, at most 24 per agent per day and only for agents that played. Net settlement creates no record per settlement; its one per-agent account (~0.0011) and the outflow window's are paid the first time an agent settles |
| Withdrawal | ~0.0012, or ~0.0026 with a new token account |
| Deposit | ~0.000005 |
| Exit | nothing — the owner pays |

## What cannot be undone

- **The program ID**, once owners have deposited: every vault, owner record and loss budget derives from it.
- **`initialize`**: the $GAMINE mint is fixed for the program's life. The admin is not: the two-step handover moves it, and only to a key that signs to accept.
- **The first chip rate** is free at initialise; after that the rate rule governs how fast it can be corrected.
- **The creator-fee split** and its three addresses.
- **Burns**: every rental fee.
- **Making the program immutable**, if that is ever done: no bug could be fixed after.
- **Using any devnet keypair on mainnet** gives that address away.

## Still open

- **The chip rate's number**, until $GAMINE has a real price (decision 1). Where the weekly average comes from is [economy.md](economy.md#open-questions) question 2; pump.fun's bonding curve has no pool to average over until the token graduates.
- **The exit window, now shorter than the outflow window.** Thirty minutes was sized to clear a ten-minute outflow window. It is now an hour, so a payment refused by the cap can wait past an exit's window, and the claim would take money owed to that hour's winners ([security.md](security.md) limitation 12). Lengthening it to about ninety minutes (13,500 slots) restores the margin, at the cost of a longer wait on the path owners use only when this server is not there; `set_exit_window` can lengthen it at any time.
- **What `max_settlement` is for, under netting.** Decision 9's 60-chip per-match limit binds `settle`, one match at a time. Net settlement does not use it: an hour's net is many matches, and the hourly outflow cap bounds it instead. On mainnet, where every match nets, the per-match limit bounds nothing. It could be dropped, or become an absolute per-hour ceiling beside the proportional cap (the pre-mainnet item in security.md).
- **The legal review** ([economy.md](economy.md#open-questions) question 5), which the audit decision does not touch.
