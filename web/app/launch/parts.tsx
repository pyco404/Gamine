import type { ReactNode } from "react";
import type { FeeSplit, Verification } from "@/lib/launchpad";

/** A heading on a wooden sign, as the village's signposts are drawn. */
export function WoodSign({ children, small = false }: { children: ReactNode; small?: boolean }) {
  return <span className={`wood-sign ${small ? "text-[13px]" : "text-[16px]"}`}>{children}</span>;
}

/** A section of a launch page: a wooden sign over the HUD card's content. */
export function Board({ sign, action, children }: { sign: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 @3xl:px-4">
        <WoodSign>{sign}</WoodSign>
        {action}
      </div>
      <div className="p-3 text-[13px] leading-5 @3xl:p-4">{children}</div>
    </section>
  );
}

/** Where a token's creator fees go, as one bar and a legend. The launcher's share shows only when it is not zero. */
export function FeeSplitBar({ split, launcherShare }: { split: FeeSplit; launcherShare: number }) {
  const parts = [
    { label: "Agent reward wallet", share: split.agents, tone: "bg-live", text: "text-live" },
    { label: "Platform", share: split.platform, tone: "bg-wood-light", text: "text-[#c9935a]" },
    ...(launcherShare > 0 ? [{ label: "Launcher", share: launcherShare, tone: "bg-accent", text: "text-accent" }] : []),
  ];
  return (
    <div>
      <div
        className="flex h-6 overflow-hidden rounded-[3px] border-2 border-wood-dark bg-black/50"
        role="img"
        aria-label={parts.map((p) => `${p.share}% ${p.label.toLowerCase()}`).join(", ")}
      >
        {parts.map((p) => (
          <div
            key={p.label}
            className={`${p.tone} flex items-center justify-center border-r-2 border-wood-dark font-mono text-[12px] font-bold text-ink last:border-r-0`}
            style={{ width: `${p.share}%` }}
          >
            {p.share >= 10 ? `${p.share}%` : null}
          </div>
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-1 text-[12px] @md:grid-cols-3">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[1px] ${p.tone}`} />
            <span className={`font-mono ${p.text}`}>{p.share}%</span>
            <span className="text-muted">{p.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VERIFICATION: Record<Verification, { label: string; tone: string }> = {
  verified: { label: "Verified on chain", tone: "border-live text-live" },
  pending: { label: "Verifying", tone: "border-accent text-accent" },
  failed: { label: "Not verified", tone: "border-loss text-loss" },
  removed: { label: "Removed from the game", tone: "border-loss text-loss" },
};

export function VerificationBadge({ v }: { v: Verification }) {
  const { label, tone } = VERIFICATION[v];
  return (
    <span className={`rounded-panel inline-flex shrink-0 items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${tone}`}>
      <span aria-hidden>{v === "verified" ? "✓" : v === "pending" ? "…" : "✗"}</span>
      {label}
    </span>
  );
}

export function TokenImage({ src, size = 48 }: { src: string; size?: number }) {
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-[3px] border-2 border-wood-dark bg-black/40 object-cover [image-rendering:pixelated]"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[3px] border-2 border-dashed border-wood-light/60 text-[11px] text-muted"
      style={{ width: size, height: size }}
    >
      image
    </span>
  );
}

/** A token as a card: what the launch form previews, and what the share card shows. */
export function TokenCard({
  name,
  ticker,
  image,
  description,
  footer,
}: {
  name: string;
  ticker: string;
  image: string;
  description?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-panel border border-line">
      <div className="flex items-center gap-3 p-3">
        <TokenImage src={image} size={64} />
        <div className="min-w-0">
          <p className="pixel-outline truncate font-pixel text-[20px] font-bold leading-6 text-[#f5ecd8]">{name || "Token name"}</p>
          <p className="font-mono text-[13px] text-teal">${ticker || "TICKER"}</p>
        </div>
      </div>
      {description ? <p className="border-t border-line px-3 py-2 text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">{description}</p> : null}
      {footer ? <div className="border-t border-line px-3 py-2">{footer}</div> : null}
    </div>
  );
}

/** Says, on every launchpad page while the mock stands in, that nothing here is real. */
export function MockNote() {
  return (
    <p className="rounded-panel border border-accent/60 bg-accent/5 px-3 py-2 text-[12px] leading-5 text-accent">
      Preview mode. These tokens and launches are made up, and nothing here sends a transaction or charges SOL.
    </p>
  );
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
