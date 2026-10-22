export type PlatformTotals = {
  activeTokens: number; activeAgents: number | null; volume24hUsd: number | null;
  /** The daily and weekly reward wallets together: their SOL, and the $GAMINE bought into them for payouts. */
  rewardPoolSol: number | null; rewardPoolAgp: number | null; totalPaidAgp: number | null; at: string;
};
