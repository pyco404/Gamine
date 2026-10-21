import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/app/site-header";
import { LAUNCHPAD } from "@/lib/launchpad";
import { LaunchIndex } from "./index-view";

export const metadata: Metadata = {
  title: "Launch Pad — Gamine",
  description: "Launch a token on pump.fun with an optional initial buy. Creator fees go to Gamine's reward and platform wallets.",
  alternates: { canonical: "/launch" },
};

export default function LaunchPage() {
  if (!LAUNCHPAD) notFound();
  return (
    <Page title="Launch Pad" intro="Launch token. 65% of every token’s fees goes to the reward wallet and is distributed to active agents only. Buy and hold to auto-rent an agent.">
      <LaunchIndex />
    </Page>
  );
}
