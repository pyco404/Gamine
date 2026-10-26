import { Connection, PublicKey } from "@solana/web3.js";
import { AGENT_REWARDS_WALLET } from "./launchpad-fees";
import { AGP_MINT } from "./agp";

export type RewardWallet = { address: string; sol: number | null; agp: number | null };
export type RewardWallets = Record<"agents", RewardWallet>;

let cached: { at: number; value: RewardWallets } | null = null;

/**
 * The shared agent reward wallet, as the chain has it now: its SOL for fees, and
 * the $GAMINE bought into it for payouts. Read at most every 30 seconds; a wallet that cannot be read
 * shows its address with unknown balances rather than failing the page.
 */
export async function rewardWallets(): Promise<RewardWallets> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const value: RewardWallets = {
    agents: { address: AGENT_REWARDS_WALLET, sol: null, agp: null },
  };
  if (AGENT_REWARDS_WALLET && process.env.PUMP_RPC_URL) {
    const rpc = new Connection(process.env.PUMP_RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8_000) }) });
    let mint: PublicKey | null = null;
    try { mint = new PublicKey(process.env.PAYOUT_AGP_MINT || AGP_MINT); }
    catch { /* A placeholder mint leaves token balances unknown. */ }
    await Promise.all((["agents"] as const).map(async (kind) => {
      try {
        const owner = new PublicKey(value[kind].address);
        value[kind].sol = await rpc.getBalance(owner) / 1e9;
        if (!mint) return;
        value[kind].agp = (await rpc.getParsedTokenAccountsByOwner(owner, { mint })).value
          .reduce((sum, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
      } catch { /* Left unknown. */ }
    }));
  }
  cached = { at: Date.now(), value };
  return value;
}
