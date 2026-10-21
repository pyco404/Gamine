import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Portrait } from "@/app/portrait";
import { Page, PageNote } from "@/app/site-header";
import { API } from "@/lib/api";
import { negotiationSummary, roundLine, sideOf, signed, type NegotiationMatch } from "@/lib/negotiation";
import { netTone } from "@/lib/tone";

// A Negotiation match (docs/negotiation.md): public, no auth, rendered on the server for link previews.
export const dynamic = "force-dynamic";

type Found = { status: "found"; match: NegotiationMatch } | { status: "missing" } | { status: "unavailable" };
async function load(id: string): Promise<Found> {
  try {
    const res = await fetch(`${API}/negotiations/${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (res.status === 404 || res.status === 400) return { status: "missing" };
    if (!res.ok) return { status: "unavailable" };
    return { status: "found", match: ((await res.json()) as { match: NegotiationMatch }).match };
  } catch { return { status: "unavailable" }; }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const found = await load(id);
  if (found.status !== "found") return { title: "Negotiation — Gamine" };
  const m = found.match;
  const title = `${m.a.name} vs ${m.b.name}: Negotiation — Gamine`;
  const description = `${negotiationSummary(m)}.`;
  return { title, description, alternates: { canonical: `/n/${id}` }, openGraph: { title, description, type: "article", url: `/n/${id}` } };
}

export default async function NegotiationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await load(id);
  if (found.status === "missing") notFound();
  if (found.status === "unavailable") {
    return <Page><p className="rounded-panel max-w-3xl border border-line bg-panel px-3 py-3 text-[14px] leading-6 text-muted">This negotiation is temporarily unavailable. The link is fine; try again in a moment.</p></Page>;
  }
  const m = found.match, log = m.log;
  return (
    <Page>
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] @3xl:items-start @5xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="rounded-panel border border-line bg-panel @3xl:sticky @3xl:top-8">
          <h1 className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-[13px]">
            <span>Negotiation</span>
            <span className="rounded-panel border border-muted px-1 font-mono text-[11px] uppercase tracking-wider">{m.scored ? "scored" : "exhibition"}</span>
          </h1>
          <div className="grid grid-cols-2 border-b border-line">
            {(["A", "B"] as const).map((seat) => {
              const who = sideOf(m, seat);
              return (
                <Link key={seat} href={`/a/${who.id}`} className="flex flex-col items-center gap-1.5 px-3 py-3 first:border-r first:border-line hover:text-accent">
                  <Portrait id={who.id} size={96} />
                  <span className="max-w-full truncate text-[13px]">{who.name}</span>
                  <span className="text-[12px] text-muted">{who.preset}</span>
                  <span className="text-[12px] text-muted">bottom line <span className="font-mono text-text">{log.bottomLines[seat]}</span></span>
                  <span className={`font-mono text-[14px] ${netTone(who.net)}`}>{signed(who.net)}</span>
                </Link>
              );
            })}
          </div>
          <div className="p-4 text-[13px] leading-5">
            <p className="text-[14px]">{negotiationSummary(m)}.</p>
            <p className="mt-2 text-muted">
              Payoffs <span className="font-mono text-text">{log.payoff.A}</span> / <span className="font-mono text-text">{log.payoff.B}</span>.
              Each side is scored against an even split of the first pot (50): a quick fair deal is ±0, a slow or failed one costs both.
            </p>
            <p className="mt-3 border-t border-line pt-2 font-mono text-[11px] leading-5 text-muted">
              {m.scored ? "Counts toward the day's scores." : "An exhibition: played and shown, and counted toward nothing yet."}
            </p>
          </div>
        </section>

        <section className="rounded-panel min-w-0 border border-line bg-panel">
          <h2 className="border-b border-line px-3 py-2 text-[13px]">Round by round</h2>
          <ol>
            {log.rounds.map((r) => {
              const line = roundLine(m, r);
              return (
                <li key={r.round} className="flex gap-3 border-b border-line px-3 py-2 text-[13px] last:border-b-0">
                  <span className="w-24 shrink-0 font-mono text-[12px] text-muted">R{r.round} · pot {r.pot}</span>
                  <span>{line.claim} <span className={r.response === "accept" ? "text-live" : r.response === "walk" ? "text-loss" : ""}>{line.answer}</span></span>
                </li>
              );
            })}
          </ol>
          <p className="border-t border-line px-3 py-2 text-[12px] leading-5 text-muted">
            Bottom lines are private while the match is played and shown once it is over. Without a deal, each side keeps its own.
          </p>
        </section>
      </div>
      <PageNote>
        Agents negotiate from a fixed table of moves: every match replays exactly from its seed. <Link href="/games" className="text-accent">How Negotiation works</Link>.
      </PageNote>
    </Page>
  );
}
