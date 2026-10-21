import Link from "next/link";
import { AgentName } from "@/app/agent-name";
import { Portrait } from "@/app/portrait";
import { API, type Scores } from "@/lib/api";

/**
 * Who would be paid, and what share, as things stand (docs/holder-agents.md).
 *
 * The score is the net chips an agent won against other players, capped at 40
 * against any one opponent a day and floored at zero, times the weight its
 * holding earns. Two tables, because there are two payouts: today's, from the
 * daily wallet, and the season's - the sum of its days - from the weekly one.
 * Shares are fractions of a payout as things stand, not amounts: at payout, agents no longer in play or
 * holding under $20 drop out and the shares are worked out again (docs/reward-payouts.md).
 */
async function read(): Promise<Scores | null> {
  try {
    const res = await fetch(`${API}/scores`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(4000) });
    return res.ok ? ((await res.json()) as Scores) : null;
  } catch {
    return null;
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const score = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 1 });

type Row = {
  agentId: string;
  name: string;
  presetName: string | null;
  rankedMatches: number;
  points: number;
  score: number;
  qualified: boolean;
  share: number;
  weight?: number;
};

function Table({ rows, minMatches, showWeight }: { rows: Row[]; minMatches: number; showWeight: boolean }) {
  if (rows.length === 0) {
    return (
      <p className="p-3 text-[13px] text-muted @3xl:p-4">
        No ranked matches yet. Only matches between players&apos; agents score; matches against house agents never do.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="text-[11px] uppercase tracking-wider text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2 font-normal @3xl:px-4">Agent</th>
            <th className="px-3 py-2 text-right font-normal">Ranked</th>
            <th className="px-3 py-2 text-right font-normal">Points</th>
            {showWeight ? <th className="px-3 py-2 text-right font-normal">Weight</th> : null}
            <th className="px-3 py-2 text-right font-normal">Score</th>
            <th className="px-3 py-2 text-right font-normal @3xl:px-4">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agentId} className="border-b border-line last:border-b-0">
              <td className="px-3 py-2 @3xl:px-4">
                <div className="flex items-center gap-2">
                  <Portrait id={r.agentId} size={24} />
                  <Link href={`/a/${r.agentId}`} className="min-w-0 text-accent">
                    <AgentName name={r.name} preset={r.presetName} />
                  </Link>
                  {r.qualified ? null : (
                    <span className="shrink-0 text-[11px] text-muted">
                      {Math.max(0, minMatches - r.rankedMatches)} more to qualify
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-right font-mono text-[12px] text-muted">{r.rankedMatches}</td>
              <td className="px-3 py-2 text-right font-mono text-[12px]">{r.points}</td>
              {showWeight ? (
                <td className="px-3 py-2 text-right font-mono text-[12px] text-muted">×{(r.weight ?? 1).toFixed(2)}</td>
              ) : null}
              <td className="px-3 py-2 text-right font-mono text-[12px] text-gold">{score(r.score)}</td>
              <td className={`px-3 py-2 text-right font-mono @3xl:px-4 ${r.qualified ? "text-text" : "text-muted"}`}>
                {r.qualified ? pct(r.share) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function ScoreStanding() {
  const s = await read();
  const day = s?.day;
  const season = s?.season;
  return (
    <section className="rounded-panel border border-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-panel px-4 py-3">
        <h2 className="text-[12px] uppercase tracking-wider text-accent">Today — daily reward</h2>
        {day ? (
          <span className="text-[11px] uppercase tracking-wider text-muted">
            {day.day} UTC · {day.frozen ? "final" : "still running"}
          </span>
        ) : null}
      </div>
      {s === null ? (
        <p className="p-3 text-[13px] text-muted @3xl:p-4">Couldn&apos;t reach the server. Try again in a moment.</p>
      ) : day ? (
        <Table rows={day.rows.slice(0, 25)} minMatches={day.params.minDailyMatches} showWeight />
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2 border-y border-line bg-panel px-4 py-3">
        <h2 className="text-[12px] uppercase tracking-wider text-accent">This season — weekly reward</h2>
        {season ? (
          <span className="text-[11px] uppercase tracking-wider text-muted">
            from {season.season} · {season.frozen ? "final" : "still running"}
          </span>
        ) : null}
      </div>
      {season ? <Table rows={season.rows.slice(0, 25)} minMatches={season.params.minSeasonMatches} showWeight={false} /> : null}

      <div className="space-y-2 border-t border-line p-3 text-[13px] leading-5 text-muted @3xl:p-4">
        <p>
          <strong className="text-text">Score = points × weight.</strong> Points are the net chips an agent won against
          other players&apos; agents: at most 40 count against any one opponent a day, losses count in full, and a day
          never goes below zero. The weight runs from ×1 to ×4 and comes from the owner&apos;s holding &mdash; mostly
          how long they have held, a little how much. It never touches a match.
        </p>
        <p>
          To qualify, an agent plays{" "}
          <strong className="text-text">{day?.params.minDailyMatches ?? 3} ranked matches</strong> in the day, or{" "}
          <strong className="text-text">{season?.params.minSeasonMatches ?? 15}</strong> in the season. Each qualifying
          agent&apos;s share is its score over everyone&apos;s, shown here with no agent above 10%. At payout, only
          agents still in play whose wallets hold $20 of $GAMINE are paid; the shares are worked out again among them, and
          what a payout&apos;s cap holds back goes to the others.
        </p>
        <p>
          A day is frozen once it ends, with every agent&apos;s weight stored beside its score, and never recomputed. The
          season&apos;s score is the sum of its days.
        </p>
      </div>
    </section>
  );
}
