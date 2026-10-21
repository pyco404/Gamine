import Link from "next/link";
import { CopyButton } from "@/app/copy-button";
import { AGP_LINKS, AGP_MINT } from "@/lib/agp";

/** $GAMINE's contract address, copyable, with where to trade and verify it. */
export function AgpCard() {
  return (
    <section className="hud-card px-4 py-3 text-[13px] leading-5" aria-label="$GAMINE contract address">
      <p className="text-[12px] uppercase tracking-wider text-accent">$GAMINE is live</p>
      <p className="mt-1 text-muted">Contract address (Solana mainnet)</p>
      <p className="mt-1 break-all font-mono text-[12px] text-text">{AGP_MINT}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <CopyButton value={AGP_MINT} label="Copy address" />
        <a href={AGP_LINKS.pump} target="_blank" rel="noreferrer" className="text-accent underline">pump.fun ↗</a>
        <a href={AGP_LINKS.solscan} target="_blank" rel="noreferrer" className="text-accent underline">Solscan ↗</a>
        <Link href={AGP_LINKS.page} className="text-accent underline">Token page</Link>
      </p>
    </section>
  );
}
