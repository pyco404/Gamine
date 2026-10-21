# Gamine

[![Gamine: every agent in play lives in a pixel-art village, with the game over it](web/public/github-readme-image.png)](https://trygamine.xyz)

Gamine is a game where you don't play — your agent does. Hold at least $20 of $GAMINE or a token launched here in your own wallet and you have an agent for that token: one of four balanced presets, or one you describe in plain English. It plays short matches of bluff-and-fold against other people's agents, with every hand shown afterwards like a poker hand history. Strategy alone decides every match. What your holding earns is a weight on the reward: mostly how long you have held, a little how much.

**Play it:** **[Gamine](https://trygamine.xyz)**. Connect Phantom or Solflare (signing in costs nothing), hold at least $20 of $GAMINE or a token launched here; each qualifying token activates its own autoplay agent.

**Follow:** [Gamine on X](https://x.com/trygamine) on X

Mainnet holder agents qualify using $GAMINE or confirmed Gamine launch tokens. Devnet uses a faucet test token instead. Nothing is deposited, staked or settled, and there is no on-chain program: your tokens stay in your wallet, and the server only reads what it holds. The design is **[docs/holder-agents.md](docs/holder-agents.md)**; the build order is the roadmap in **[docs/economy.md](docs/economy.md)**.

---

## How a match works

Each round, both agents privately draw an edge from 0.30 to 0.70 — roughly, their chance of winning the round. Neither sees the other's. One agent acts first and the other answers: **fold** (pay the ante and lose the round), **call**, or **raise**. If nobody folds, a weighted coin decides the round for the base bet, or the raised bet if anyone raised. First to two rounds, at most three — so a match can move at most two rounds at the raised bet.

Every match plays at one scale: ante 4, bet 10, raised 20, so a match is won by at most 40 chips. A match moves no money; the chips it was won by are its score. Matches between two players' agents are ranked, and they are what the ladder and the day's scores count; a match with a house agent in it is an exhibition and counts toward nothing.

Because the opponent's edge is hidden and a raise can be answered in the same round, a weak agent can raise and make a stronger one fold. That is a bluff, and whether it pays is the game.

## Running it

**Prerequisites:** Node 24 and npm. A Phantom or Solflare browser extension to sign in. `npm run check` also needs the Postgres binaries on the machine (Debian/Ubuntu: `apt install postgresql`) — it starts a throwaway cluster for the checks that must run against the real driver, and refuses to pass without one.

```bash
npm install
npm run check                    # type-check, the real-Postgres checks, then the suite

docker compose up -d             # Postgres on :5432
npm run serve -- --migrate       # API on :8787; migrates, seeds a house roster of 24 agents

cd web && npm install
npm run build && npm run start   # web app on :3000
```

Open http://localhost:3000 and sign in with a qualifying wallet. Each eligible token gets a separate agent with a randomly picked strategy and autoplay enabled. Any Postgres works; `--migrate` applies only migrations not yet applied, so it is safe on every start. For a throwaway run with no database, `npm run serve -- --migrate --memory` uses embedded PGlite in memory, and everything, share links included, is gone when it stops. The test suite always uses PGlite.

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | API | Needed to make an agent from a written brief; read from the environment or a `.env` file in the repo root. Without it, presets work and briefs return 503. |
| `CHAIN_RPC_URL` | API | The RPC holdings are read from, e.g. `https://api.devnet.solana.com`. Without it no wallet is read and nobody can get an agent. |
| `HOLDER_MINT` | API | Primary $GAMINE mint, defaulting to `CHAIN_STAKE_MINT` on devnet. Confirmed launch mints are imported separately. |
| `HOLDER_LAUNCHPAD_URL` | API | Trusted web origin for confirmed launch tokens; defaults to `https://trygamine.xyz`. For local mainnet testing, use `http://localhost:3000`. |
| `FUNDING_MODE`, `HOLDER_WALLETS` | API | `FUNDING_MODE=holder` lets every wallet get an agent by holding; `HOLDER_WALLETS` is a comma-separated allowlist for trying it first. |
| `FAUCET_ENABLED`, `CHAIN_TREASURY_SECRET` | API | Devnet only: hand out test tokens from a treasury, so a wallet has something to hold. |
| `ADMIN_WALLETS` | API | Comma-separated wallets that may read `/admin`. Unset means no admin page at all, not an open one. |
| `DATABASE_URL` | API | Postgres connection string. Required unless `--memory` is passed. |
| `AUTH_DOMAIN`, `CORS_ORIGIN` | API | `AUTH_DOMAIN=trygamine.xyz` and `CORS_ORIGIN=https://trygamine.xyz` in production. |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` | web, build time | API location; use `NEXT_PUBLIC_SITE_URL=https://trygamine.xyz` for share previews and canonical redirects. |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | web, build time | Cluster for explorer links on match pages, default `devnet`. |

### Holder agents across tokens

Each wallet gets one agent for every qualifying token worth at least $20. Strategies
are selected randomly and autoplay starts automatically. A token below $20 pauses
only its own agent; a verified zero balance retires it from the field. Requalifying
can create a fresh agent, while an owner-ended agent stays opted out until manually
replaced. RPC failures never count as zero. Agents from the same wallet cannot play
each other for score. Each token has its own holding clock and pricing checks.

Deploy both services; API startup applies `0034_multi_token_holders.sql` while
preserving existing agents and histories. The trusted web mint registry includes
confirmed launches only. Archived market listings retain their mint identity;
missing catalog/market data never invents eligibility. Reward payments use
wallet-approved swaps and transfers; enable and configure the executor separately.
See [automatic agents](docs/automatic-agents.md) and [reward payouts](docs/reward-payouts.md).

The world also has [persistent autonomous activities](docs/autonomous-activities.md): farming, gathering, deliveries, exploration, friendly sparring, rest and rotating Notice Board jobs. House and holder agents participate. They continue with the API running while users are away and are purely cosmetic. **Only Bluff & Fold earns agent rewards.**

### No program

There is no on-chain program (docs/holder-agents.md, decision 12). Holding the token in your own wallet is the agent; the server only reads wallets, and the season's chip rate - the minimum's dollar peg - is set in the database with `scripts/set-season-rate.ts`. The Anchor program that held vaults is in the git history.

### Deployment

The live site runs on Railway: Postgres, the API and the web app as three services.

**`railway up` uploads the git repository root, not the working directory.** The API deploys correctly from the repo root with `railway up -s api`, because the root `railway.json` is its config. The web app does not: its config is `web/railway.json`, but a CLI upload puts the repo root at the top of the build context, so Railway reads the root `railway.json`, starts `npm start` → `tsx scripts/serve.ts --migrate`, finds no `DATABASE_URL` and crash-loops. `cd web && railway up -s web` does not fix it, because the CLI still walks up to the git root.

The web service has its **Root Directory set to `/web`**, and current Railway (railpack v0.40) *does* apply that to a CLI upload — an earlier version of this note said it applied only to git-triggered builds. So the upload has to contain a `web/` directory for the setting to resolve: uploading the *contents* of `web/` fails at prepare with `Root directory "/web" was not found in the deployed source`. Nothing ships when that happens, so the site stays up.

**Use `scripts/deploy.sh`, not `railway up` directly.**

```
scripts/deploy.sh api
scripts/deploy.sh web
```

`railway up` uploads the *working tree*, not the commit, so deploying by hand
can put code live that is in nobody's git history — which has happened here,
with two sessions editing one checkout. The script closes that: the api refuses
to deploy from a dirty tree, and web stages with `git archive HEAD` into a copy
of `web/` outside the repository, so uncommitted work cannot ship at all. Both
refuse an unpushed HEAD, so whatever is live can always be fetched back.

It writes the commit into the upload, so the question has an answer:

```
curl https://trygamine.xyz/commit.txt
```

**Check the deploy logs every time.** A correct web deploy logs `gamine-web@1.0.0 start` → `next start`. If it logs `gamine@0.0.1 start` → `tsx scripts/serve.ts`, the API build shipped to the web service and the site is down — Railway has marked such a deployment `SUCCESS` before the container began crash-looping, so the status alone is not enough. This has taken the site down twice.

The API takes `DATABASE_URL`, `CHAIN_RPC_URL`, `HOLDER_MINT` (or `CHAIN_STAKE_MINT`), `FUNDING_MODE=holder`, `ANTHROPIC_API_KEY`, `CORS_ORIGIN`, `AUTH_DOMAIN`, `HOST=0.0.0.0` and `TRUST_PROXY=1`; the web app takes the three `NEXT_PUBLIC_*` variables at build time.

The site has one address. The configured `www` domain and the `*.up.railway.app` default domain both answer with a permanent 308 to `https://trygamine.xyz`, keeping the path and query — see `web/proxy.ts`, which reads the apex from `NEXT_PUBLIC_SITE_URL`. So `CORS_ORIGIN` and `AUTH_DOMAIN` name the apex only: nothing reaches the API from a www origin.

## Architecture

```
 browser ──wallet signature──▶ HTTP API ──▶ runner ──▶ engine (match)
                                  │            │
                                  │            └──▶ matches + ratings   (Postgres, one transaction)
                                  │
                           holdings reader ──▶ wallet balances (Solana RPC, read only)
                           scores ──▶ each day frozen with its power inputs
```

**Engine** — `src/engine.ts`, `src/round.ts`. A pure, deterministic TypeScript match: seeded PRNG, turn order, the draw, resolution. The same seed and agents always produce the same match, so every stored match replays exactly from its seed and rules.

**Agents are decision tables** — `src/presets.ts`, `src/agents/`. A strategy is 30 cells: an action for each of five edges in six situations. The four presets (Anchor, Hammer, Mirage, Bully) are tables. An agent made from a brief asks the model once, when it is created, to fill in a table, which is stored with the agent; the model is never called during a match and never signs anything.

**Exact calculator** — `src/exact.ts`. Because agents are tables, a matchup's expected value can be computed exactly by enumerating every draw and coin flip — no sampling noise. It was used to balance the presets, and in the product it rates a brief against today's roster, privately. The public ladder ranks what agents actually won, not this number.

**Holdings** — `src/db/holdings.ts`, `src/chain/holdings.ts`. Each wallet behind an agent is read every ten minutes; the reading is the agent's balance, decides whether it is in play, and keeps its conviction clock. A sell and a buy-back between two readings is not seen.

**Scores** — `src/score.ts`, `src/db/scores.ts`. Net chips won against other players, capped at 40 per opponent a day and floored at zero, times a weight from x1 to x4 that the holding earns. Each UTC day is frozen once it is over, with every agent's power inputs stored beside its score.

**Auth** — `src/auth/`. Sign-in with a Solana wallet: a single-use nonce inside a message naming the site, verified as an ed25519 signature, exchanged for a session.

## How the design got here

The first version had both agents choosing at the same time, and the balance harness caught a problem immediately: **AlwaysRaise beat all four presets, by +4.04 chips a match.** The cause was structural. A fold cost 10, while calling even the worst hand cost at most 8 in expectation, so folding was never right and a player who always raised could only gain. Two rule changes that made folding cheaper each broke the preset balance instead, and a sweep over every ante from 3 to 9 found no value where AlwaysRaise stopped winning *and* the presets still beat each other in a loop.

The deeper problem was bluffing. With both agents choosing at once, a raise can never make the opponent fold *that round*, so a bluff has nothing to win. Switching to turn-based play, where the second agent can fold to a raise, looked like the fix. It wasn't: across **585 preset sets that passed every balance check, not one contained a bluff that ever made a stronger hand fold.** The reason was the draw itself — B's edge was always 1 − A's, so a player holding 0.3 *knew* the opponent held 0.7 and never had reason to believe the bluff.

Making the two draws independent gave the game hidden information. In the shipped set, opponents fold to Mirage's bluffs **48–67% of the time, about half of those while holding the stronger hand**, and bluffing is worth **+0.36 chips a match** to it — turning it off makes Mirage worse against every other preset. **435,821 preset sets** passed every check across antes 3–5; the shipped set is one of them, with the loop holding at every ante in that range.

The same habit of measuring shaped the rest:

- **Ratings.** A rolling average over 50 matches has a spread of ±5.6 chips, while the real gaps between presets are about 0.1. That couldn't rank anything, so the ladder ranks total winnings — a fact — and the exact rating stays private.
- **Starting balance.** At 60, 82% of agents went broke, half of them within 13 matches. 180 was right while a match could never move more than 40 and a ceiling clamped what was left. Once bands became money scales and the clamp went, a week of autoplay at one match per ten minutes needed more: at 900, 99% of band A agents last the week, 80% in band B and 61% in band C. Those figures are measured, not estimated — the simulation enumerated every draw and flip. (Both the simulation and bands were removed on 2026-10-01: with nothing staked, nobody goes broke and there is one scale.)
- **Bands were money scales, not ceilings.** The old per-match ceiling decided who an agent met and clamped its results, which meant the top two bands played identically: a match could never move more than 40 anyway. Bands then multiplied every amount by one factor — A ×0.5, B ×1, C ×1.5 — so the decision each agent faced was identical in all three and only what it was worth changed. They went on 2026-10-01, when matches stopped moving money.

## Limitations

Stated plainly; the design and what is still open are in [docs/holder-agents.md](docs/holder-agents.md).

- **The game is devnet and a test token only.** $GAMINE has not launched, and rewards are not paid until the legal review.
- **Holdings are snapshots.** A wallet is read every ten minutes, so a sell and a buy-back between two reads is not seen, and keeps its conviction clock. Indexing transfers would close that; it waits until someone exploits it.
- **Splitting a holding across wallets pays.** Each wallet earns its own points; the fixed reward pool and the 10% share cap bound it, and the design records it as a known property.
- **One agent in play per wallet.**
- **Briefs need an Anthropic API key.** Without one, only presets can be played.
- **The session token lives in browser storage**, readable by any script on the page.

## Repository

```
src/        engine, exact calculator, presets, agents, holdings, scores, auth, HTTP API
web/        Next.js app: the village, getting an agent, playing, ladder, rewards, match pages
scripts/    balance harness, preset search, seeding, the season rate, deployment
test/       vitest suites; test/postgres.test.ts runs against a real Postgres
docs/       the holder-agents design, the earlier models, how LLM agents plug in
```

More: [docs/holder-agents.md](docs/holder-agents.md) · [docs/economy.md](docs/economy.md) · [docs/ai-agents.md](docs/ai-agents.md)


