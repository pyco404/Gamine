"use client";

import Link from "next/link";
import { useEffect, useState, type RefObject } from "react";
import type { VillageHandle } from "./game";
import type { ArenaShow } from "./arena";
import { matchPresentation } from "../../lib/world/match-presentation";

export function ArenaHud({ show, village, compact, onFocus }: {
  show: ArenaShow | null; village: RefObject<VillageHandle | null>; compact: boolean; onFocus: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clock, setClock] = useState<{ id: string; elapsed: number | null; playMs: number } | null>(null);
  useEffect(() => {
    if (!show) return;
    const read = () => {
      if (document.hidden) return;
      const playback = village.current?.playback(show.match.id);
      setClock({ id: show.match.id, elapsed: playback?.elapsed ?? null, playMs: playback?.playMs ?? 10_000 });
    };
    read(); const timer = setInterval(read, 150);
    document.addEventListener("visibilitychange", read);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", read); };
  }, [show?.match.id, village]);
  const data = show && matchPresentation(show.match, clock?.id === show.match.id ? clock.elapsed : null, clock?.playMs ?? 10_000);
  const open = expanded && !compact;
  return <section className={`arena-hud game-panel ${open ? "is-expanded" : ""}`} aria-label="Arena match">
    <button type="button" className="arena-hud-toggle" aria-expanded={open} onClick={() => { setExpanded(!expanded); if (!expanded) onFocus(); }}>
      <span className={`status-light ${show?.kind === "live" ? "is-online" : ""}`} aria-hidden />
      <span className="min-w-0 flex-1 text-left"><span className="hud-eyebrow">Bluff &amp; Fold · {show ? show.kind === "replay" ? "Replay" : "Match playback" : "Arena"}</span>
        <span className="block truncate font-medium">{show ? `${show.match.a.name} vs ${show.match.b.name}` : "Waiting for the next match"}</span></span>
      <span className="arena-mini-score">{data ? `${data.score.A} : ${data.score.B}` : "—"}</span>
      <span aria-hidden className="text-muted">{open ? "−" : "+"}</span>
    </button>
    {open ? <div className="arena-hud-body">
      {show && data ? <>
        <div className="flex items-center justify-between gap-2"><span className="hud-badge">{show.match.exhibition ? "Exhibition · no rewards" : "Player match"}</span><span className="text-xs text-muted">{data.phase === "arrival" ? "Agents entering" : data.phase === "final" ? "Final result" : `Round ${data.round}`}</span></div>
        <div className="arena-scoreboard"><Link href={`/a/${show.match.a.id}`}>{show.match.a.name}</Link><strong>{data.score.A} <span>:</span> {data.score.B}</strong><Link href={`/a/${show.match.b.id}`}>{show.match.b.name}</Link></div>
        <div className="arena-progress" aria-label="Match playback progress"><span style={{ width: `${data.progress * 100}%` }} /></div>
        <p className="mt-3 text-sm text-text" role="status">{data.result ?? (data.phase === "arrival" ? "The match starts when both agents arrive." : data.phase === "hands" ? "Private hands dealt. Decisions coming next." : data.phase === "outcome" ? "Round complete. Hands revealed." : "Agents are making their moves.")}</p>
        {data.actions.length ? <ol className="mt-2 flex flex-wrap gap-2">{data.actions.map((a, i) => <li key={i} className={`match-action action-${a.action}`}><span>{a.seat === "A" ? show.match.a.name : show.match.b.name}</span> {a.action}</li>)}</ol> : null}
        {data.edges ? <p className="mt-2 text-xs text-muted">Revealed edges: {data.edges.A.toFixed(2)} / {data.edges.B.toFixed(2)}</p> : null}
        <Link className="hud-link mt-3 inline-block" href={`/m/${show.match.id}`}>Open full match history ↗</Link>
      </> : <p className="text-sm leading-6 text-muted">Matches appear here when the server supplies them. Explore the village while the arena waits.</p>}
    </div> : null}
  </section>;
}
