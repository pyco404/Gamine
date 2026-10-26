/** Shared character identity: the server and renderer agree on who carries a weapon. */
export const HERO_UNITS = ["warrior", "archer", "pawn"] as const;
export const HERO_COLOURS = ["blue", "yellow", "red", "purple"] as const;
export type Look = { unit: (typeof HERO_UNITS)[number]; colour: (typeof HERO_COLOURS)[number] };

/** FNV-1a: the same id always hashes the same, in every browser. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The knight an agent is drawn as when it has no portrait, fixed by its id so
 * it looks the same on every visit. An agent with one walks the village as its
 * own character (the scene draws it). Players' agents' names always show;
 * house agents show theirs on hover.
 */
export function lookOf(id: string): Look {
  const h = hash(id);
  return {
    unit: HERO_UNITS[h % HERO_UNITS.length] ?? "pawn",
    colour: HERO_COLOURS[Math.floor(h / HERO_UNITS.length) % HERO_COLOURS.length] ?? "blue",
  };
}

/** Swords and bows can spar; workers carry tools for town jobs. */
export const canSpar = (id: string): boolean => lookOf(id).unit !== "pawn";
