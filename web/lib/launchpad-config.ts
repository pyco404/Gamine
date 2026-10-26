import { AGENT_REWARDS_WALLET, LAUNCH_FEE_LAMPORTS, LAUNCH_FEE_RECIPIENT } from "./launchpad-fees";
import type { LaunchpadConfig } from "./launchpad";

export const launchConfig: LaunchpadConfig = {
  launchFeeLamports: LAUNCH_FEE_LAMPORTS,
  launchFeeRecipient: LAUNCH_FEE_RECIPIENT,
  minimumUsd: 20,
  feeSplit: { agents: 70, platform: 30 },
  launcherShare: 0,
  perTokenCap: null,
  agpMultiplier: 1.3,
  launchMultiplier: 1,
  maxImageBytes: 2_000_000,
  agentsEnabled: true,
};

export const feeWallets = [
  { address: AGENT_REWARDS_WALLET, shareBps: 7000 },
  { address: LAUNCH_FEE_RECIPIENT, shareBps: 3000 },
];
