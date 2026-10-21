import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/app/site-header";
import { LAUNCHPAD } from "@/lib/launchpad";
import { Explore } from "./view";

export const metadata: Metadata = {
  title: "Explore — Gamine",
  description: "Every token launched on Gamine: new launches, the most traded, the largest, and the ones with the most agents.",
  alternates: { canonical: "/explore" },
};

export default function ExplorePage() {
  if (!LAUNCHPAD) notFound();
  return (
    <Page title="Explore" intro="Every token launched here. Search for one, or browse the newest, the most traded, the largest and the ones with the most agents in the village.">
      <Explore />
    </Page>
  );
}
