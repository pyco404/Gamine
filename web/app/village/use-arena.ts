"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { readStoredValue } from "@/lib/browser-storage";
import type { Arrival } from "@/lib/live";
import { arrive, emptyArena, finish, REPLAY_WINDOW_MS, tick, type ArenaShow, type ArenaState } from "./arena";

/** How deep into the ladder ranks are read: past RANK_DEPTH a rank counts for nothing anyway. */
const LADDER_READ = 50;
/** How often the Arena checks whether a better new match may now take over. */
const TICK_MS = 5_000;
/** The replay pool and this season's meetings, kept in this browser so a reload still has something to replay. */
const STORE = "gamine.arena.v1";

/**
 * The Arena's one match (arena.ts), fed from the live stream. The stream
 * carries neither ladder ranks nor head-to-head counts: ranks are read from
 * the ladder, and meetings are counted from the matches this browser has seen
 * this season - kept, with the best of the last day to replay, in local
 * storage. Presentation only: nothing here reaches a match.
 */
export function useArena(arrivals: readonly Arrival[]): { show: ArenaShow | null; done: (matchId: string) => void } {
  const [state, setState] = useState<ArenaState>(emptyArena);
  const ranks = useRef<ReadonlyMap<string, number>>(new Map());
  const season = useRef<string | null>(null);
  const fed = useRef(new Set<string>());
  const [ready, setReady] = useState(false);

  // What this browser kept from before, dropping replays older than a day.
  useEffect(() => {
    try {
      const kept = JSON.parse(readStoredValue(localStorage, STORE) ?? "null") as Pick<ArenaState, "best" | "meetings" | "season"> | null;
      if (kept) {
        const now = Date.now();
        setState((s) => tick({ ...s, best: kept.best.filter((b) => now - b.at < REPLAY_WINDOW_MS), meetings: kept.meetings, season: kept.season }, now));
        season.current = kept.season;
      }
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    let gone = false;
    const load = () =>
      api.ladder("winnings", LADDER_READ).then(
        (r) => {
          if (gone) return;
          ranks.current = new Map(r.rows.filter((row) => !row.retired).map((row, i) => [row.agentId, i + 1]));
          if (r.season?.key) season.current = r.season.key;
        },
        () => {},
      );
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, []);

  // Every match the stream brings, oldest first, once.
  useEffect(() => {
    if (!ready) return;
    const fresh = arrivals.filter((a) => !fed.current.has(a.match.id)).reverse();
    if (fresh.length === 0) return;
    for (const a of fresh) fed.current.add(a.match.id);
    setState((s) =>
      fresh.reduce(
        (acc, a) =>
          arrive(acc, { id: a.match.id, a: a.match.a, b: a.match.b, netA: a.match.netA, netB: a.match.netB, exhibition: a.match.exhibition, play: a.match.play }, ranks.current, a.startedAt, season.current),
        s,
      ),
    );
  }, [arrivals, ready]);

  useEffect(() => {
    const timer = setInterval(() => setState((s) => tick(s, Date.now())), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ best: state.best, meetings: state.meetings, season: state.season }));
    } catch {}
  }, [ready, state.best, state.meetings, state.season]);

  const done = useCallback((matchId: string) => setState((s) => finish(s, matchId, Date.now())), []);
  return { show: state.show, done };
}
