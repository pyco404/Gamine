import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/app/site-header";
import { LAUNCHPAD } from "@/lib/launchpad";
import { TokenView } from "../token-view";

export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }): Promise<Metadata> {
  const { mint } = await params;
  return { title: "Token — Gamine", alternates: { canonical: `/launch/${mint}` } };
}

/** A launched token's page, read through the configured launchpad adapter. */
export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  if (!LAUNCHPAD) notFound();
  const { mint } = await params;
  return (
    <Page>
      <TokenView mint={mint} />
    </Page>
  );
}
