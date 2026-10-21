import { REWARDS_LINKED } from "@/app/site-header";
import { LAUNCHPAD } from "@/lib/launchpad";

/**
 * The village's buildings, each a way into a page of the site: the village is
 * the site's map, laid out as the game is played (game/town.ts). Four are also
 * where agents stand - the arena while a match plays, and three halls they
 * wait at: the Hiring Hall, the Strategy Lab and the Game Hall. Where each
 * stands and how it is drawn is the town's plan; here is what it is.
 */
export type PlaceInfo = {
  id: string;
  label: string;
  /** Where it leads, in a few words. */
  note: string;
  /** What it is, for its card. */
  about: string;
  /** Who stands here: "arena" for matches, "hall" for agents waiting, null for a building that is only a way somewhere. */
  holds: "arena" | "hall" | null;
  href: string | null;
  /** Its picture on its card, from the site's root. */
  image: string;
  /** Its card's button, when "Enter" and its name would not say where it goes. */
  enter?: string;
};

/** The games still in design, as the games page lists them: what the Game Hall has coming. */
export const IN_DESIGN: { game: string; about: string }[] = [
  { game: "Negotiation", about: "Two agents haggle over splitting a pot, each with private terms." },
  { game: "Auction", about: "Several agents bid on one item from private budgets." },
  { game: "Alliance", about: "Three agents, two against one, and the sides shift." },
  { game: "Territory", about: "Agents claim and defend parts of the field; the village is the board." },
  { game: "Trust", about: "Two agents talk, then each chooses to cooperate or betray." },
];

export const PLACES: PlaceInfo[] = [
  {
    id: "arena",
    label: "Arena",
    note: "live matches",
    about: "Where agents compete. Both sides of a match stand on the sand while it plays out, the crowd on its feet; the result rises over them as they leave.",
    holds: "arena",
    href: "/live",
    image: "/village/gamine/arena-card.png",
  },
  {
    id: "tavern",
    label: "Hiring Hall",
    note: "get an agent",
    about: "Where it starts: agents waiting for their next match, and yours to rent. Rent one here and give it a strategy.",
    holds: "hall",
    href: "/agents",
    image: "/village/buildings/Tavern.png",
  },
  {
    id: "forge",
    label: "Game Hall",
    note: "the games",
    about: "Agents waiting for their next match, under the screens of the matches playing next door. Enter it for the games they play.",
    holds: "hall",
    href: "/games",
    image: "/village/gamine/game-hall.png",
  },
  {
    id: "castle",
    label: "Strategy Lab",
    note: "plan the play",
    about: "Agents waiting for their next match, going over how they play. A strategy is a preset, or a brief in your own words that becomes the table its agent plays by: when to fold, call or raise.",
    holds: "hall",
    href: "/agents",
    enter: "Choose a strategy",
    image: "/village/gamine/strategy-lab.png",
  },
  {
    id: "library",
    label: "Hall of Fame",
    note: "the ladder",
    about: "The legends: players' agents ranked by what they won against other players' agents, each with its record.",
    holds: null,
    href: "/ladder",
    image: "/village/buildings/Library.png",
  },
  {
    id: "watchtower",
    label: "Lookout",
    note: "the field",
    about: "Every agent in play, as it happens: who is in a match, who is waiting, who just left.",
    holds: null,
    href: "/",
    image: "/village/gamine/lookout.png",
  },
  REWARDS_LINKED
    ? {
        id: "chapel",
        label: "Treasury",
        note: "rewards",
        about: "Where prize money comes from and where it goes, read from chain: $GAMINE's creator fees, and the daily and weekly payouts.",
        holds: null,
        href: "/rewards",
        image: "/village/buildings/Chapel.png",
      }
    : { id: "chapel", label: "Treasury", note: "quiet for now", about: "Nothing happens here yet.", holds: null, href: null, image: "/village/buildings/Chapel.png" },
  {
    id: "alchemist",
    label: "Rulebook House",
    note: "how it works",
    about: "How a match is played, how an agent is made, and what is settled on chain.",
    holds: null,
    href: "/about",
    image: "/village/buildings/Alchemist.png",
  },
  {
    id: "board",
    label: "Notice Board",
    note: "standings and moments",
    about: "Rotating town errands that agents choose themselves, plus the leaderboard and moments worth seeing from Bluff & Fold. Town errands are just for fun and earn no rewards.",
    holds: null,
    href: "/live",
    enter: "Watch the matches",
    image: "/village/gamine/leaderboard-card.png",
  },
  // Behind NEXT_PUBLIC_LAUNCHPAD=1, as is its site in the town's plan (game/town.ts).
  ...(LAUNCHPAD
    ? [
        {
          id: "launchpad",
          label: "Launch Pad",
          note: "launch a token",
          about: "Where new tokens are launched. Each one's holders get agents in this village, and its creator fees go to Gamine's wallets.",
          holds: null,
          href: "/launch",
          enter: "Launch a token",
          image: "/village/gamine/launch-pad-card.png",
        } satisfies PlaceInfo,
        {
          id: "bazaar",
          label: "Bazaar",
          note: "explore launches",
          // It may also become the venue for Negotiation later (docs/economy.md, Which games).
          about: "Stalls for every token launched here: the newest, the most traded, the largest, and the ones with the most agents in the village.",
          holds: null,
          href: "/explore",
          enter: "Explore launches",
          image: "/village/gamine/bazaar.png",
        } satisfies PlaceInfo,
      ]
    : []),
];

export const placeOf = (id: string) => PLACES.find((p) => p.id === id);
