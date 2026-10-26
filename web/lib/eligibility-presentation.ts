import type { HoldingView } from "./api";

/** Presentation only: a failed or stale verification must never look like a sold holding. */
export function eligibilityPresentation(holding: HoldingView | null, refreshing: boolean, now: number) {
  if (refreshing) return { state: "verifying", label: "Verifying your holdings", tone: "text-accent" };
  if (holding?.priceReady === false) return { state: "unavailable", label: "Waiting for a verified token price", tone: "text-accent" };
  if (!holding || !holding.readAt) return { state: "unverified", label: "Ready to check your wallet", tone: "text-muted" };
  const readAt = Date.parse(holding.readAt);
  if (!Number.isFinite(readAt) || now - readAt > 20 * 60_000) return {
    state: "unavailable", label: "Waiting for fresh verification", tone: "text-accent",
  };
  return holding.eligible ? { state: "eligible", label: "Holding requirement met", tone: "text-live" }
    : { state: "ineligible", label: "Temporarily below the requirement", tone: "text-muted" };
}
