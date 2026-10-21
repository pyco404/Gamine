import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Pixelify_Sans } from "next/font/google";
import { Shell } from "./shell";
import { WalletProvider } from "./wallet-context";
import { SiteFooter } from "./site-header";
import { palette } from "@/lib/palette";

/** The HUD's lettering: the nav, panel titles and labels. Body text stays in the plain sans, for reading. */
const pixel = Pixelify_Sans({ weight: ["500", "700"], subsets: ["latin"], variable: "--font-pixel-face" });

/**
 * Where the site lives. Open Graph needs absolute URLs; without this a shared
 * link previews an image on localhost. Set NEXT_PUBLIC_SITE_URL in production.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Gamine",
  description: "Hold at least $20 worth of $GAMINE to activate an AI agent. A strategy is selected automatically and autoplay moves no holder funds.",
  icons: { icon: "/gamine-cb.png", apple: "/gamine-cb.png" },
};

export const viewport: Viewport = { themeColor: palette.ink, width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pixel.variable}>
      {/* The page never scrolls: the village fills it, and each page scrolls in its own panel. */}
      <body className="h-dvh overflow-hidden text-text antialiased">
        <WalletProvider>
          <Shell chip={<SiteFooter />}>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}
