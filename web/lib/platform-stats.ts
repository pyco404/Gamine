export type PlatformTotals = {
  activeTokens: number; activeAgents: number | null; volume24hUsd: number | null;
  /** The shared agent reward wallet: its SOL and the $GAMINE bought into it for payouts. */
  rewardPoolSol: number | null; rewardPoolAgp: number | null; totalPaidAgp: number | null; at: string;
};
