import type { ReactNode } from "react";
import { AGP_LINKS, AGP_MINT } from "@/lib/agp";
import { siteLinks } from "@/lib/site-links";

/**
 * /rewards announces the token before it exists. It is in the nav unless
 * NEXT_PUBLIC_SHOW_REWARDS is "false", so it can be hidden without a code change.
 */
export const REWARDS_LINKED = process.env.NEXT_PUBLIC_SHOW_REWARDS !== "false";

/** Every page's frame over the village: its title and intro in a card of their own, then the page's own cards. */
export function Page({ title, intro, children }: { title?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="w-full space-y-3 px-1 pb-4 [&>*]:m-0">
      {title || intro ? (
        <header className="hud-card px-4 py-3">
          {title ? <h1 className="font-pixel text-[24px] font-bold leading-8 text-accent @xl:text-[28px]">{title}</h1> : null}
          {intro ? <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted">{intro}</p> : null}
        </header>
      ) : null}
      {children}
    </main>
  );
}

/** A small note under a page's content, specific to that page. */
export function PageNote({ children }: { children: ReactNode }) {
  return <p className="hud-card px-4 py-3 text-[11px] leading-5 text-muted">{children}</p>;
}

const link = "hover:text-text";

/**
 * The footer: a small chip pinned to the bottom-right of the screen on every
 * page and every screen, like the village's hint at the bottom-left. Its
 * $GAMINE link goes to the live token; the full note shows on hover.
 */
export function SiteFooter() {
  return (
    <footer
      className="rounded-panel flex h-8 items-center border border-hud-line bg-hud px-2.5 text-[12px] text-muted"
      title={`Gamine runs on Solana mainnet. $GAMINE is live: ${AGP_MINT}`}
    >
      <p className="flex flex-wrap items-center justify-end gap-x-3">
        <span>Solana</span>
        <a href={AGP_LINKS.pump} className={link} target="_blank" rel="noreferrer">$GAMINE</a>
        <a href={siteLinks.x} className={link} target="_blank" rel="noreferrer">X</a>
        <a href={siteLinks.repository} className={link} target="_blank" rel="noreferrer">Source</a>
        <a href={siteLinks.repository} className={link} target="_blank" rel="noreferrer">Security</a>
      </p>
    </footer>
  );
}
