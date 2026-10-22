/** $GAMINE, Gamine's own token, launched on pump.fun through Gamine on 2026-10-09. */
export const AGP_MINT = process.env.NEXT_PUBLIC_AGP_MINT || "0000000000000000000000000000000000000000000";
export const AGP_LINKS = {
  pump: `https://pump.fun/coin/${AGP_MINT}`,
  solscan: `https://solscan.io/token/${AGP_MINT}`,
  page: `/launch/${AGP_MINT}`,
};
