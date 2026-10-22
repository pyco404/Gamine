import { Connection, PublicKey } from "@solana/web3.js";
import { DAILY_REWARDS_WALLET, WEEKLY_REWARDS_WALLET } from "./launchpad-fees";
import { AGP_MINT } from "./agp";

export type RewardWallet = { address: string; sol: number | null; agp: number | null };
export type RewardWallets = Record<"daily" | "weekly", RewardWallet>;

let cached: { at: number; value: RewardWallets } | null = null;

/**
 * The daily and weekly reward wallets, as the chain has them now: the SOL each holds for fees, and
 * the $GAMINE bought into it for payouts. Read at most every 30 seconds; a wallet that cannot be read
 * shows its address with unknown balances rather than failing the page.
 */
export async function rewardWallets(): Promise<RewardWallets> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const value: RewardWallets = {
    daily: { address: DAILY_REWARDS_WALLET, sol: null, agp: null },
    weekly: { address: WEEKLY_REWARDS_WALLET, sol: null, agp: null },
  };
  if (process.env.PUMP_RPC_URL) {
    const rpc = new Connection(process.env.PUMP_RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8_000) }) });
    const mint = new PublicKey(process.env.PAYOUT_AGP_MINT || AGP_MINT);
    await Promise.all((["daily", "weekly"] as const).map(async (kind) => {
      try {
        const owner = new PublicKey(value[kind].address);
        value[kind].sol = await rpc.getBalance(owner) / 1e9;
        value[kind].agp = (await rpc.getParsedTokenAccountsByOwner(owner, { mint })).value
          .reduce((sum, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
      } catch { /* Left unknown. */ }
    }));
  }
  cached = { at: Date.now(), value };
  return value;
}
