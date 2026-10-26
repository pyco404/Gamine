import { PublicKey } from "@solana/web3.js";

/** Mandatory per-token anti-spam fee, separate from buys and network fees. */
export const LAUNCH_FEE_LAMPORTS = 100_000_000;

/** Receiving addresses must be supplied explicitly; no fallback wallets. */
export const LAUNCH_FEE_RECIPIENT = process.env.PUMP_PLATFORM_WALLET?.trim() ?? "";
export const AGENT_REWARDS_WALLET = process.env.PUMP_AGENT_REWARDS_WALLET?.trim() ?? "";

export function feeWalletsReady(): boolean {
  try {
    if (!LAUNCH_FEE_RECIPIENT || !AGENT_REWARDS_WALLET) return false;
    const platform = new PublicKey(LAUNCH_FEE_RECIPIENT);
    const agents = new PublicKey(AGENT_REWARDS_WALLET);
    return PublicKey.isOnCurve(platform.toBytes()) && PublicKey.isOnCurve(agents.toBytes()) && !platform.equals(agents);
  } catch { return false; }
}
