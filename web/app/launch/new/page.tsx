import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/app/site-header";
import { LAUNCHPAD } from "@/lib/launchpad";
import { LaunchFlow } from "../flow";

export const metadata: Metadata = {
  title: "Launch a token — Gamine",
  description: "Launch a token on pump.fun through Gamine, step by step.",
  alternates: { canonical: "/launch/new" },
};

export default function NewLaunchPage() {
  if (!LAUNCHPAD) notFound();
  return (
    <Page title="Launch a token" intro="Connect, fill in, review, launch. Every step is shown below, and nothing launches until you have reviewed where the creator fees go.">
      <LaunchFlow />
    </Page>
  );
}
