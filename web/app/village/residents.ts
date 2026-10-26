/**
 * Where every agent on the field stands in the village, and what it looks
 * like there. Pure: the page feeds it the field and the matches playing out,
 * and the scene draws the result. It reads results and never makes one, so
 * nothing here can reach a match, a pairing or a balance.
 *
 * Kept free of the web app's path aliases so the root suite can test it; the
 * shapes below are the parts of FieldAgent and LiveMatch it reads.
 */

import type { WorldActivity } from "../../lib/world/simulation";

export type FieldEntry = {
  id: string;
  name: string;
  presetName: string | null;
  house: boolean;
  retiredAt: string | null;
  worldActivity?: WorldActivity | null;
  worldReceivedAt?: number;
};

export type PlayingMatch = {
  id: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  netA: number;
  netB: number;
  /** House agents playing each other: nothing was staked. */
  exhibition: boolean;
  /** When its playback started on this page's clock, and how long it runs: for the arena's running score. */
  startedAt?: number;
  playMs?: number;
  /** Its rounds, each with the rounds won by either side once that round is over, and what happened in it. */
  play?: readonly ({ roundsWon: { A: number; B: number } } & Partial<TableRound>)[];
};

/** One round of Bluff & Fold as the arena's table shows it. Mirrors PlayRound in lib/live.ts. */
export type TableRound = {
  /** Who acted first; null when both chose at once. */
  leader: "A" | "B" | null;
  /** Each side's edge: its chance, as a share, of winning the flip. */
  edges: { A: number; B: number };
  /** The choices, in the order they were made. */
  sequence: readonly { seat: "A" | "B"; action: "fold" | "call" | "raise" }[];
  outcome: "both-folded" | "one-folded" | "flipped";
  /** The chips that changed hands. */
  bet: number;
  winner: "A" | "B" | null;
};

/**
 * A match's playback, for the arena as the rounds play out: the running score,
 * and each round's hands and choices when the stream sent them.
 */
export type MatchClock = { startedAt: number; playMs: number; roundsWon: { A: number; B: number }[]; rounds: (TableRound | null)[] };

/** A round's detail, when the stream sent all of it. */
function tableRound(r: Partial<TableRound>): TableRound | null {
  if (!r.edges || !r.sequence || !r.outcome || r.bet === undefined || r.winner === undefined) return null;
  return { leader: r.leader ?? null, edges: r.edges, sequence: r.sequence, outcome: r.outcome, bet: r.bet, winner: r.winner };
}

/**
 * Where an agent is. The halls and the gate are buildings it stands at; a
 * match is played in the Arena when it is the one the Arena shows (arena.ts),
 * and otherwise in a duel, wherever its two sides meet (game/duels.ts).
 */
export type Place = "arena" | "duel" | "tavern" | "forge" | "castle" | "gate";

/** Whether an agent is in a match, in the Arena or out in the village. */
export const inMatch = (place: Place) => place === "arena" || place === "duel";

export { HALLS, hallOf } from "../../lib/world/identity";
import { hallOf, type Hall } from "../../lib/world/identity";
export type { Hall } from "../../lib/world/identity";

import { lookOf, type Look } from "../../lib/world/character";
export { HERO_UNITS, HERO_COLOURS, lookOf, type Look } from "../../lib/world/character";

export type Resident = {
  id: string;
  name: string;
  presetName: string | null;
  house: boolean;
  /** The hall it waits at, fixed by its id. */
  hall: Hall;
  place: Place;
  /** The match it is playing now. `net` is this side's result, to show once the match has played out. */
  match: {
    id: string;
    seat: "A" | "B";
    opponent: { id: string; name: string };
    net: number;
    exhibition: boolean;
    /** The Arena's match played again by stand-ins, rather than live by its own agents. */
    replay: boolean;
    /** The Arena's showing of it: the same match shown twice is played twice. */
    key?: string;
    clock: MatchClock | null;
  } | null;
  look: Look;
  worldActivity?: WorldActivity | null;
  worldReceivedAt?: number;
  /** A replay's stand-in: the agent it stands in for, whose face it wears and whose page it opens. */
  standIn?: string;
};

/** A replay's stand-in's id: never an agent's, so the real one carries on elsewhere. */
export const standInId = (matchId: string, seat: "A" | "B") => `stand-in:${matchId}:${seat}`;

/** The match the Arena shows (arena.ts), as far as placing needs it. */
export type ArenaPick = { kind: "live" | "replay"; match: PlayingMatch; key: string };

/**
 * Everyone on the field, placed. `playing` is newest first, so an agent in two
 * playbacks at once is shown in the newer. A retiring agent heads for the gate
 * whatever it was doing: the field shows it leaving for a minute, then drops it.
 *
 * `arena` is the one match the Arena shows. Live, its own two agents play it
 * there, whatever the server has them doing since; a replay is played by two
 * stand-ins, added to the list, so the real agents carry on where they are.
 * The Arena keeps its own clock (the scene plays the match from when both
 * sides are in), so the clock here is only the rounds.
 */
export function placeResidents(agents: readonly FieldEntry[], playing: readonly PlayingMatch[], arena: ArenaPick | null = null): Resident[] {
  const playingIn = new Map<string, NonNullable<Resident["match"]>>();
  const seat = (m: PlayingMatch, replay: boolean) => {
    const clock = m.play
      ? { startedAt: m.startedAt ?? 0, playMs: m.playMs ?? 0, roundsWon: m.play.map((r) => ({ ...r.roundsWon })), rounds: m.play.map(tableRound) }
      : null;
    const a = { id: m.id, seat: "A" as const, opponent: m.b, net: m.netA, exhibition: m.exhibition, replay, clock };
    const b = { id: m.id, seat: "B" as const, opponent: m.a, net: m.netB, exhibition: m.exhibition, replay, clock };
    return [a, b] as const;
  };
  const known = new Set(agents.filter((a) => !a.retiredAt).map((a) => a.id));
  const live = arena?.kind === "live" && known.has(arena.match.a.id) && known.has(arena.match.b.id) ? arena.match : null;
  if (live) {
    const [a, b] = seat(live, false);
    playingIn.set(live.a.id, { ...a, key: arena!.key });
    playingIn.set(live.b.id, { ...b, key: arena!.key });
  }
  for (const m of playing) {
    if (m.id === live?.id || playingIn.has(m.a.id) || playingIn.has(m.b.id)) continue;
    const [a, b] = seat(m, false);
    if (m.startedAt === undefined || m.playMs === undefined) {
      a.clock = null;
      b.clock = null;
    }
    playingIn.set(m.a.id, a);
    playingIn.set(m.b.id, b);
  }
  const placed: Resident[] = agents.map((a) => {
    const match = a.retiredAt ? null : (playingIn.get(a.id) ?? null);
    return {
      id: a.id,
      name: a.name,
      presetName: a.presetName,
      house: a.house,
      hall: hallOf(a.id),
      place: a.retiredAt ? "gate" : match ? (match.id === live?.id ? "arena" : "duel") : hallOf(a.id),
      match,
      look: lookOf(a.id),
      ...(a.worldActivity !== undefined ? { worldActivity: a.worldActivity } : {}),
      ...(a.worldReceivedAt !== undefined ? { worldReceivedAt: a.worldReceivedAt } : {}),
    };
  });
  // A live match whose agents have left the field is played by stand-ins too.
  if (!arena || live) return placed;
  const m = arena.match;
  const [a, b] = seat(m, arena.kind === "replay");
  const standIn = (real: { id: string; name: string }, s: "A" | "B", match: NonNullable<Resident["match"]>): Resident => ({
    id: standInId(m.id, s),
    name: real.name,
    presetName: null,
    house: false,
    hall: hallOf(real.id),
    place: "arena",
    match: { ...match, key: arena.key, opponent: { id: standInId(m.id, s === "A" ? "B" : "A"), name: match.opponent.name } },
    look: lookOf(real.id),
    standIn: real.id,
  });
  return [...placed, standIn(m.a, "A", a), standIn(m.b, "B", b)];
}
