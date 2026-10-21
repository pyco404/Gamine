import type { Metadata } from "next";
import { Page } from "@/app/site-header";
import { AdminPanel } from "./panel";

export const metadata: Metadata = {
  title: "Admin — Gamine",
  // Not indexed and not linked from anywhere: the only way here is to know.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <Page title="Admin" intro="Reward payout plans, approvals, and operational health.">
      <AdminPanel />
    </Page>
  );
}
