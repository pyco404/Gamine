import { PublicKey } from "@solana/web3.js";
import { rewardWallets, type RewardWallet } from "@/lib/reward-wallets";
import { LAUNCH_FEE_RECIPIENT, DAILY_REWARDS_WALLET, WEEKLY_REWARDS_WALLET } from "@/lib/launchpad-fees";
import { fromThisSite, LaunchError, ownerOf, readLaunchBody } from "@/lib/launchpad-server";
import { buildHeldPayoutPlan, buildPayoutPlan, planDays, type HeldPayoutInput, type PayoutDropped, type PayoutInput, type PayoutPlan, type PayoutWinner } from "@/lib/payout-plan";
import { PayoutStore } from "@/lib/payout-store";
import { ExecutionStore } from "@/lib/payout-execution-store";
import { agpDecimals, executionConfig } from "@/lib/payout-adapter";
import { payoutStep, startExecution, startPayoutWorker } from "@/lib/payout-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const apiUrl = () => process.env.LAUNCHPAD_AUTH_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
async function adminRead(request: Request, path: string, timeoutMs = 10_000) {
  let response: Response;
  try { response = await fetch(`${apiUrl()}${path}`, { headers: { authorization: request.headers.get("authorization") ?? "" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new LaunchError("The payout API did not answer in time. It reads every winner's wallet on chain; try again shortly.", 504); }
  if (!response.ok) {
    const message = response.status === 400 ? "Invalid payout date. Weekly seasons must start on a Monday (UTC)."
      : response.status === 409 ? "This payout needs frozen scores and valid receiving wallets."
      : response.status === 401 ? "Your sign-in expired. Sign out and sign in again."
      : response.status === 403 || response.status === 404 ? "The payout API has not granted admin access to this wallet. Check that it uses the same API as the dashboard."
      : "The payout API is unavailable. Try again shortly.";
    throw new LaunchError(message, response.status);
  }
  return response.json();
}
function agpMint() {
  if (!process.env.PAYOUT_AGP_MINT) return null;
  try { return new PublicKey(process.env.PAYOUT_AGP_MINT).toBase58(); }
  catch { throw new LaunchError("The payout mint is not configured correctly.", 503); }
}
/** Each reward wallet's SOL and $GAMINE, for choosing an amount (reward-wallets.ts reads them at most every 30 seconds). */
async function rewardBalances() {
  const wallets = await rewardWallets();
  const one = (w: RewardWallet) => w.sol === null ? null : { sol: w.sol, agp: w.agp };
  return { daily: one(wallets.daily), weekly: one(wallets.weekly) };
}
/** The day after the last day an approved daily plan pays: the next one to pay. */
function nextDaily(plans: PayoutPlan[]): string | null {
  const paid = plans.filter((p) => p.kind === "daily" && p.status === "approved").flatMap(planDays).sort();
  return paid.length ? new Date(Date.parse(`${paid.at(-1)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null;
}
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (request.method === "POST" && !fromThisSite(request)) throw new LaunchError("Payout requests must come from this site.", 403);
    const owner = await ownerOf(request);
    await adminRead(request, "/admin");
    const { path } = await context.params;
    const store = new PayoutStore();
    const executions = new ExecutionStore(store.db);
    startPayoutWorker();
    let result: unknown;
    if (request.method === "GET" && path.join("/") === "plans") result = {
      plans: store.list(), agpMint: agpMint(), balances: await rewardBalances(), nextDaily: nextDaily(store.list()), executionConnected: executionConfig().ready, swapsConnected: executionConfig().swaps,
      executionMissing: executionConfig().missing, executions: executions.views(),
      sourceWallets: { daily: DAILY_REWARDS_WALLET, weekly: WEEKLY_REWARDS_WALLET }, platform: LAUNCH_FEE_RECIPIENT,
    };
    else if (request.method === "POST" && path.join("/") === "preview") {
      const body = await readLaunchBody(request);
      // "held" pays $GAMINE the operator already bought into the reward wallet; otherwise SOL is swapped.
      const held = body.funding === "held";
      if ((body.kind !== "daily" && body.kind !== "weekly") || typeof body.period !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.period) ||
        (held ? !["budgetAgp", "rewardPercent"].every((key) => typeof body[key] === "string")
          : !["budgetSol", "rewardPercent", "batchSol"].every((key) => typeof body[key] === "string") ||
            typeof body.delaySeconds !== "number" || typeof body.slippageBps !== "number")) throw new LaunchError("Invalid payout settings.");
      const input = body as unknown as PayoutInput | HeldPayoutInput;
      const minScore = body.minScore === undefined || body.minScore === "" ? 0 : Number(body.minScore);
      if (!Number.isFinite(minScore) || minScore < 0) throw new LaunchError("The minimum score must be a number, 0 or more.");
      // The most one winner may take, as a percentage; what it holds back goes to the others by score.
      const capPercent = body.capPercent === undefined || body.capPercent === "" ? 10 : Number(body.capPercent);
      if (!Number.isFinite(capPercent) || capPercent < 1 || capPercent > 100 || Math.round(capPercent * 100) !== capPercent * 100) throw new LaunchError("The maximum share per winner must be from 1% to 100%.");
      const capBps = Math.round(capPercent * 100);
      const date = new Date(`${input.period}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.period) throw new LaunchError("Choose a valid calendar date.");
      if (input.kind === "weekly" && date.getUTCDay() !== 1) throw new LaunchError("Choose the Monday that started a completed weekly season.");
      // A daily catch-up: every frozen day from `period` through `periodEnd`, paid at once.
      const periodEnd = typeof body.periodEnd === "string" && body.periodEnd && body.periodEnd !== input.period ? body.periodEnd : null;
      if (periodEnd) {
        const end = new Date(`${periodEnd}T00:00:00Z`);
        if (input.kind !== "daily") throw new LaunchError("Only daily payouts can cover several days.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== periodEnd) throw new LaunchError("Choose a valid last day.");
        if (end <= date || end.getTime() - date.getTime() > 30 * 86_400_000) throw new LaunchError("A catch-up covers 2 to 31 days, its last day after its first.");
      }
      // The API checks every winner's holding now ($20 at payout) and re-shares among those left.
      const range = periodEnd ? `from=${input.period}&to=${periodEnd}` : `${input.kind === "daily" ? "day" : "season"}=${encodeURIComponent(input.period)}`;
      // The reward wallets hold $GAMINE, so they have agents; they never pay themselves.
      // Every winner's wallet is read on chain: allow a minute rather than the usual ten seconds.
      const frozen = await adminRead(request, `/admin/payout-recipients?${range}&minScore=${minScore}&cap=${capBps / 10_000}&exclude=${DAILY_REWARDS_WALLET},${WEEKLY_REWARDS_WALLET}`, 60_000) as { frozen: boolean; winners: PayoutWinner[]; dropped?: PayoutDropped[] };
      if (!frozen.frozen) throw new LaunchError("Only frozen scores can be paid.", 409);
      // An API from before the payout-time holding check returns no `dropped`: it would pay wallets that sold.
      if (!Array.isArray(frozen.dropped)) throw new LaunchError("The payout API does not check holdings at payout yet. Deploy the api, then preview again.", 503);
      for (const winner of frozen.winners) {
        if (new PublicKey(winner.wallet).toBase58() === LAUNCH_FEE_RECIPIENT) throw new LaunchError("The platform wallet cannot be a reward winner.");
      }
      const source = input.kind === "daily" ? DAILY_REWARDS_WALLET : WEEKLY_REWARDS_WALLET;
      let decimals = 0;
      if (held) {
        try { decimals = await agpDecimals(); }
        catch { throw new LaunchError("The $GAMINE mint could not be read. Check PUMP_RPC_URL and PAYOUT_AGP_MINT.", 503); }
      }
      let plan;
      try {
        plan = held ? buildHeldPayoutPlan(input as HeldPayoutInput, decimals, frozen.winners, source, LAUNCH_FEE_RECIPIENT, owner, capBps)
          : buildPayoutPlan(input as PayoutInput, frozen.winners, source, LAUNCH_FEE_RECIPIENT, owner, capBps);
      }
      catch (error) { throw new LaunchError((error as Error).message); }
      plan.agpMint = agpMint();
      plan.minScore = minScore; plan.dropped = frozen.dropped;
      if (periodEnd) plan.periodEnd = periodEnd;
      store.insert(plan);
      result = plan;
    } else if (request.method === "POST" && path.length === 2 && path[1] === "delete") {
      try { store.remove(path[0]!); result = { deleted: path[0] }; }
      catch (error) { throw new LaunchError((error as Error).message, 409); }
    } else if (request.method === "POST" && path.length === 2 && path[1] === "cancel") {
      try { result = store.cancel(path[0]!, owner); }
      catch (error) { throw new LaunchError((error as Error).message, 409); }
    } else if (request.method === "POST" && path.length === 2 && path[1] === "approve") {
      const plan = store.get(path[0]!);
      if (!plan) throw new LaunchError("Payout plan not found.", 404);
      if (!plan.agpMint || plan.agpMint !== agpMint()) throw new LaunchError("Configure the $GAMINE mint and preview again before approving this plan.", 409);
      try { result = store.approve(plan.id, owner); }
      catch (error) { throw new LaunchError((error as Error).message, 409); }
    } else if (request.method === "POST" && path.length === 2 && ["start", "prepare", "submit", "pause", "resume"].includes(path[1]!)) {
      if (!executionConfig().ready && path[1] !== "pause") throw new LaunchError("Configure payout execution before starting or resuming payments.", 503);
      const id = path[0]!; const action = path[1]!;
      const target = store.get(id);
      if (!target) throw new LaunchError("Payout plan not found.", 404);
      if (target.funding !== "held" && !executionConfig().swaps && (action === "start" || action === "prepare"))
        throw new LaunchError("This plan swaps SOL, which needs JUPITER_API_KEY. Buy $GAMINE into the reward wallet and preview a held-$GAMINE payout instead.", 503);
      try {
        if (action === "start") result = await startExecution(id, owner, undefined, executions);
        else if (action === "pause" || action === "resume") result = executions.control(id, action);
        else if (action === "prepare") result = await payoutStep(id, true, undefined, undefined, executions);
        else {
          const body = await readLaunchBody(request);
          if (typeof body.signed !== "string" || body.signed.length > 10_000) throw new LaunchError("Invalid signed payout transaction.");
          result = await payoutStep(id, false, body.signed, undefined, executions);
        }
      } catch (error) {
        if (error instanceof LaunchError) throw error;
        // Local verification errors are useful; do not return external provider errors.
        const message = error instanceof Error ? error.message : "";
        const known = ["Payout ", "Approve a payout", "This reward wallet", "A payout step", "A batch step", "Payout execution not found", "No payout transaction", "Only the reward wallet", "The signed launch", "The launch transaction"];
        throw new LaunchError(known.some(prefix => message.startsWith(prefix)) ? message.replaceAll("launch", "payout") : "Payout step could not be verified. Check progress and configuration before retrying.", 409);
      }
    } else throw new LaunchError("Not found.", 404);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof LaunchError ? error.message : "The payout service could not complete the request." }, { status: error instanceof LaunchError ? error.status : 502 });
  }
}
export const GET = handle;
export const POST = handle;
