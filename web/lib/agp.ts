/** Official $GAMINE token mint. */
export const AGP_MINT = process.env.NEXT_PUBLIC_AGP_MINT || "Aw55TiFnRqzXQZyLxhdqxE3T7fGMYpXHECTfDv6H62LS";
export const AGP_LINKS = {
  pump: `https://pump.fun/coin/${AGP_MINT}`,
  solscan: `https://solscan.io/token/${AGP_MINT}`,
  page: `/launch/${AGP_MINT}`,
};
