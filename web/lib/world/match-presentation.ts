import { playhead } from "../playhead";
import type { PlayingMatch } from "../../app/village/residents";

/** Mirrors the card table's reveal clock. Never exposes future actions or results. */
export function matchPresentation(match: PlayingMatch, elapsed: number | null, playMs: number) {
  if (elapsed === null || !match.play?.length) return {
    phase: "arrival" as const, round: 0, score: { A: 0, B: 0 }, actions: [], result: null,
    progress: 0, edges: null,
  };
  const clock = playhead(match.play.length, Math.max(0, elapsed), playMs);
  const current = match.play[clock.round]!;
  const settled = clock.phase === "outcome" || clock.phase === "final";
  const sequence = current.sequence ?? [];
  const revealed = settled ? sequence.length : clock.phase === "action" ? Math.min(sequence.length, Math.floor(clock.within * (sequence.length + 1))) : 0;
  return {
    phase: clock.phase, round: clock.round + 1,
    score: (settled ? current.roundsWon : match.play[clock.round - 1]?.roundsWon) ?? { A: 0, B: 0 },
    actions: sequence.slice(0, revealed),
    result: clock.phase === "final" ? match.netA === 0 ? "Match drawn" : `${match.netA > 0 ? match.a.name : match.b.name} wins` : null,
    progress: Math.max(0, Math.min(1, elapsed / Math.max(1, playMs))),
    edges: settled ? current.edges ?? null : null,
  };
}
