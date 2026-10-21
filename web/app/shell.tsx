"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useField, usePlayingNow } from "@/lib/field";
import { useLive } from "@/lib/live";
import { api } from "@/lib/api";
import { useWallet } from "@/app/wallet-context";
import { prefersReducedMotion } from "@/lib/motion";
import { sound } from "@/lib/sound";
import { readStoredValue, removeStoredValue } from "@/lib/browser-storage";
import { SiteBar, useNight } from "@/app/site-bar";
import { CloseIcon } from "@/app/icons";
import { Welcome } from "@/app/welcome";
import { BuildingCard, OpenBuildingProvider } from "@/app/village/hud";
import { placeOf, PLACES } from "@/app/village/places";
import { placeResidents } from "@/app/village/residents";
import { townActivityTally } from "@/app/village/activity-tally";
import { placeLine, worldTally, WorldProvider, type World } from "@/app/village/world";
import type { VillageHandle } from "@/app/village/game";
import { arenaLine } from "@/app/village/arena";
import { WorldCamera } from "@/app/village/world-camera";
import { AgentStatus, type AgentAccount } from "@/app/village/agent-status";
import type { WorldView } from "@/app/village/game/presentation";
import { useArena } from "@/app/village/use-arena";
import { CopyButton } from "@/app/copy-button";
import { AGP_MINT } from "@/lib/agp";

/** The phone layout ends here: from md up the page is a panel on the right, below it a sheet along the bottom. */
const WIDE = "(min-width: 768px)";

/** The buttons shown with the page put away: all alike, in the bar's dark with the gold of its edge. */
const QUICK =
  "rounded-panel h-8 items-center justify-center border border-hud-line bg-hud px-4 text-[12px] font-medium text-accent shadow-[0_4px_16px_rgb(0_0_0/0.5)] hover:border-accent md:h-9";

/** The longest the site waits behind its cover for the village and its agents. */
const COVER_MAX_MS = 10_000;

/** The agent whose page is open, from /a/<id>. */
const agentOf = (path: string) => /^\/a\/([^/]+)/.exec(path)?.[1] ?? null;
const cameraPage = (path: string) => path === "/agent" || path === "/";

/** Pages that open wider than the rest: lists with many columns, laid out side by side on a desktop. */
const WIDE_PAGES = ["/explore"];

/** How far the phone's sheet is dragged down before letting go puts the page away. */
const SHEET_CLOSE_PX = 120;

/** The bar's height: it covers the top of the village on every page. */
const BAR = 56;

/**
 * Every page's frame. The village is the application: it fills the window
 * behind everything and keeps playing from page to page, since this frame is
 * never unmounted by a navigation. The bar sits on top like a game's HUD; a
 * page opens as a panel over the world that can be put away to see the whole
 * of it. The world is the site's map: an
 * agent opens its record, a building its card, and the card its page.
 */
type ShellProps = { children: ReactNode; chip: ReactNode };

/** Admin opens as a dashboard, without the village's loading cover or hidden sheet. */
export function Shell({ children, chip }: ShellProps) {
  const path = usePathname() ?? "/";
  return path === "/admin" || path.startsWith("/admin/")
    ? <AdminShell>{children}</AdminShell>
    : <WorldShell chip={chip}>{children}</WorldShell>;
}

function AdminShell({ children }: { children: ReactNode }) {
  const [night, toggleNight] = useNight();
  return (
    <div className="h-dvh overflow-y-auto bg-ink">
      <SiteBar night={night} onNight={toggleNight} showing villageUp={false} />
      <div className="hud-page mx-auto w-full max-w-6xl px-3 pb-6 pt-20 sm:px-6">
        {children}
      </div>
    </div>
  );
}

function WorldShell({ children, chip }: ShellProps) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  // Field/Agent expose the world; functional routes open their overlay on arrival.
  const [open, setOpen] = useState(() => !cameraPage(path));
  const [building, setBuilding] = useState<string | null>(null);
  const [night, toggleNight] = useNight();
  // A state rather than a ref, so measuring starts again whenever the panel comes and goes.
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState({ right: 0, bottom: 0 });
  const [villageStatus, setVillageStatus] = useState<"loading" | "ready" | "failed">("loading");
  /** The village's handle, shared by the village with the controls in the footer chip's row. */
  const villageHandle = useRef<VillageHandle | null>(null);
  // If the game server can't be reached the agents never come, and a site that waited for them would stay
  // blank for good: after this long the cover lifts anyway, and the village says why it is empty.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), COVER_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  const live = useLive();
  // The signed-in owner's agents, to mark in the village. Read again now and then, so a new rental is marked too.
  const { session } = useWallet();
  const [accountRead, setAccountRead] = useState<{ token: string; data: AgentAccount | null; failed: boolean } | null>(null);
  const account = session && accountRead?.token === session.token ? accountRead.data : null;
  const accountError = !!session && accountRead?.token === session.token && accountRead.failed;
  const mine = useMemo<ReadonlySet<string>>(() => new Set(account?.agents.filter((a) => !a.retired).map((a) => (a.id ?? a.agentId)!).filter(Boolean)), [account]);
  useEffect(() => {
    if (!session) return;
    let gone = false;
    const load = () =>
      api.me(session.token).then(
        (r) => !gone && setAccountRead({ token: session.token, data: r, failed: false }),
        () => !gone && setAccountRead((old) => ({ token: session.token, data: old?.token === session.token ? old.data : null, failed: true })),
      );
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [session, path]);
  const playing = usePlayingNow();
  const agents = useField(null, playing);
  // The Arena's one match (village/arena.ts): the best of what the stream brings, or a replay.
  const arena = useArena(live.arrivals);
  const show = arena.show;
  // Each match with its playback clock, so the arena keeps the same running score as the live feed.
  const residents = useMemo(
    () =>
      agents
        ? placeResidents(
            agents,
            playing.map((a) => ({ ...a.match, startedAt: a.startedAt, playMs: live.playMs })),
            show ? { kind: show.kind, match: { ...show.match, playMs: live.playMs }, key: `${show.kind}:${show.match.id}:${show.since}` } : null,
          )
        : null,
    [agents, playing, live.playMs, show],
  );
  const world: World = useMemo(
    () => ({
      residents,
      arrivals: live.arrivals,
      playMs: live.playMs,
      now: live.now,
      counters: live.counters,
      online: live.status === "connecting" ? null : live.status === "open",
      arena: { line: arenaLine(show), live: show?.kind === "live" },
    }),
    [residents, live, show],
  );

  // A soft click when a building's card or a new page opens.
  useEffect(() => {
    if (building) sound.click();
  }, [building]);
  const firstPath = useRef(path);
  useEffect(() => {
    if (path !== firstPath.current) sound.click();
    firstPath.current = path;
  }, [path]);

  // A page someone went to starts at its top - the panel, not the window, is what scrolls - and closes any card.
  // The page the site loaded on stays put away until asked for.
  // Judged against the path it loaded on, not a first run: React runs effects twice on mount in development.
  const loadedOn = useRef(path);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current && path === loadedOn.current) return;
    moved.current = true;
    setOpen(!cameraPage(path));
    setBuilding(null);
    scroller.current?.scrollTo(0, 0);
  }, [path]);

  // Content links open a panel; Agent and Field open their dedicated camera views.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href^='/']");
      if (a && !a.closest("footer")) {
        const href = a.getAttribute("href") ?? "";
        setOpen(!cameraPage(href));
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // What the panel covers of the village, so it frames itself in the rest.
  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const measure = () => {
      const r = open ? panel?.getBoundingClientRect() : undefined;
      if (!r || r.width === 0) return setInset({ right: 0, bottom: 0 });
      setInset(wide.matches ? { right: window.innerWidth - r.left, bottom: 0 } : { right: 0, bottom: window.innerHeight - r.top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (panel) observer.observe(panel);
    wide.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
    };
  }, [open, panel]);

  const go = useCallback(
    (href: string) => {
      setBuilding(null);
      setOpen(!cameraPage(href));
      router.push(href);
    },
    [router],
  );
  // The Arena opens the page of the match it shows, as the match feed does; every other building its card.
  const showing = useRef(show);
  useEffect(() => {
    showing.current = show;
  }, [show]);
  const openBuilding = useCallback(
    (id: string) => {
      const on = showing.current;
      if (id === "arena" && on) go(`/m/${on.match.id}`);
      else setBuilding(id);
    },
    [go],
  );
  // The phone's sheet dragged down by its head: past SHEET_CLOSE_PX it closes, short of that it springs back.
  const drag = useRef<{ from: number; by: number } | null>(null);
  const endDrag = () => {
    const by = drag.current?.by ?? 0;
    drag.current = null;
    if (panel) panel.style.transform = "";
    if (by > SHEET_CLOSE_PX) setOpen(false);
  };
  const place = building ? placeOf(building) : undefined;
  // The village drawn and its agents in it: what the cover waits for, and when its sound may begin.
  const villageUp = villageStatus === "ready" && residents !== null;

  return (
    <WorldProvider value={world}>
      <OpenBuildingProvider value={setBuilding}>
        <PersistentWorld
          world={world}
          path={path}
          inset={inset}
          night={night}
          go={go}
          openBuilding={openBuilding}
          onArenaDone={arena.done}
          scrolls={open ? scroller : null}
          mine={mine}
          onStatus={setVillageStatus}
          handleRef={villageHandle}
          account={account}
          accountError={accountError}
          ownerKey={session?.token ?? null}
        />
        <SiteBar night={night} onNight={toggleNight} showing={open} villageUp={villageUp} />

        {/*
          The page as a HUD card over the world, like the village's own: as tall as its content and no
          taller, scrolling only when it runs longer than the screen. Inside it the site's panel and line
          colours become the HUD's, so every page's own boxes turn into translucent, gold-edged cards too.
          Put away, it is hidden rather than left out: the page is still in the HTML, so a search engine,
          a link preview or an assistant reading the site sees what it says, not an empty village.
          On a phone it is a sheet up from the bottom edge instead, 80% of the screen tall (.hud-sheet), with
          a strip of village left above it.
        */}
        <div
          ref={setPanel}
          className={`hud-page hud-sheet pointer-events-auto fixed inset-x-0 bottom-0 z-20 ${open ? "flex" : "hidden"} flex-col rounded-t-[14px] border-t border-hud-line bg-ink/95 shadow-[0_-6px_24px_rgb(0_0_0/0.5)] md:inset-x-auto md:bottom-auto md:right-4 md:top-[4.5rem] md:max-h-[calc(100dvh-5.5rem)] md:rounded-panel md:border md:border-hud-line md:bg-ink/90 md:p-3 md:pt-2 md:shadow-[0_6px_24px_rgb(0_0_0/0.5)] ${WIDE_PAGES.some((p) => path.startsWith(p)) ? "md:w-[min(1120px,calc(100vw-2rem))]" : "md:w-[clamp(400px,48vw,680px)]"}`}
        >
          {/*
            The close X inside the page's own frame, at its top-right, above the cards so it never sits on
            a page's content. On a phone it heads the sheet with a handle: dragging the head down far enough
            puts the page away.
          */}
          <div
            className="relative flex shrink-0 touch-none justify-end px-2 pb-1 pt-2 md:touch-auto md:px-0 md:pb-2 md:pt-0"
            onPointerDown={(e) => {
              if (window.matchMedia(WIDE).matches || (e.target as Element).closest("button")) return;
              drag.current = { from: e.clientY, by: 0 };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current || !panel) return;
              drag.current.by = Math.max(0, e.clientY - drag.current.from);
              panel.style.transform = `translateY(${drag.current.by}px)`;
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-hud-line md:hidden" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close the page and see the village"
              title="Close"
              className="rounded-panel pointer-events-auto flex h-8 w-8 items-center justify-center border border-hud-line bg-hud text-accent shadow-[0_4px_16px_rgb(0_0_0/0.5)] hover:border-accent"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <div
            ref={scroller}
            className="hud-sheet-body @container pointer-events-auto min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 md:px-0"
          >
            {children}
          </div>
        </div>
        {/*
          With the page put away: the way back to it, and the two things most worth doing, all in one look.
          Hidden rather than unmounted while the page shows: a click on a link opens the page from a capture
          listener (above), before React handles the click. Unmounted then, the link would be gone by the time
          its click reached it, Next would never see it, and the browser would follow the bare href - a full
          reload of the site, village and all.
        */}
        <div
          className={`${open || path === "/agent" ? "hidden" : "flex"} fixed bottom-12 right-2 z-20 flex-col items-stretch gap-2 md:bottom-auto md:right-4 md:top-[4.5rem]`}
        >
          <button type="button" onClick={() => setOpen(true)} className={`${cameraPage(path) ? "hidden" : "flex"} ${QUICK}`}>
            Show the page
          </button>
          {/* Not on a phone: the ☰ menu there already has the pages and Rent. */}
          <Link href="/live" onClick={() => setOpen(true)} className={`hidden md:flex ${QUICK}`}>
            Watch matches
          </Link>
          <Link href="/agents" onClick={() => setOpen(true)} className={`hidden md:flex ${QUICK}`}>
            Get an agent
          </Link>
        </div>

        {/* The footer as a chip in the bottom-right corner, with the village's zoom just above it: world */}
        {/* controls, so they are put away while a page is open and the page has that space. */}
        <div className={`fixed bottom-2 right-2 z-20 ${open ? "hidden" : "flex"} max-w-[calc(100vw-1rem)] flex-col items-end gap-2 md:bottom-4 md:right-4 md:max-w-[min(760px,calc(100vw-2rem))]`}>
          {villageStatus === "ready" && path !== "/agent" ? (
            <div className="hidden flex-col items-end gap-2 md:flex">
              <VillageControls village={villageHandle} mine={mine} findLast />
            </div>
          ) : null}
          {chip}
        </div>

        {place ? (
          // A building's card, in the middle of the uncovered village; on a phone, along the bottom.
          <div
            className="pointer-events-none fixed left-0 top-14 z-20 flex items-end justify-center p-3 pb-12 md:items-center md:p-6"
            style={{ right: inset.right, bottom: inset.bottom }}
          >
            <BuildingCard place={place} onClose={() => setBuilding(null)} onEnter={go} />
          </div>
        ) : null}
        <Welcome ready={villageUp || villageStatus === "failed" || waited} drawn={villageStatus === "ready"} failed={villageStatus === "failed"} onEnter={(href) => { if (href) go(href); }} />
      </OpenBuildingProvider>
    </WorldProvider>
  );
}

/** The village layer: fixed behind everything, with a light veil so what is on top of it reads. */
function PersistentWorld({
  world,
  path,
  inset,
  night,
  go,
  openBuilding,
  onArenaDone,
  scrolls,
  onStatus,
  mine,
  handleRef,
  account,
  accountError,
  ownerKey,
}: {
  world: World;
  path: string;
  inset: { right: number; bottom: number };
  night: boolean;
  go: (href: string) => void;
  openBuilding: (id: string) => void;
  /** The Arena's match has played out: the Arena moves on (village/arena.ts). */
  onArenaDone: (matchId: string) => void;
  /** The open page's scroller: while there is one, the wheel over the village scrolls the page rather than zooming. */
  scrolls: React.RefObject<HTMLDivElement | null> | null;
  /** How the village's own loading is going, for the frame's cover. */
  onStatus: (status: "loading" | "ready" | "failed") => void;
  /** The signed-in owner's agents. */
  mine: ReadonlySet<string>;
  /** Shared with the shell, so the controls in the footer chip's row can drive the village too. */
  handleRef: React.MutableRefObject<VillageHandle | null>;
  account: AgentAccount | null;
  accountError: boolean;
  ownerKey: string | null;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => onStatus(status), [status, onStatus]);
  // The field is re-read every few seconds; if a first read still hasn't come back after this, say why the village is empty.
  const [stranded, setStranded] = useState(false);
  const empty = world.residents === null;
  useEffect(() => {
    if (!empty) return setStranded(false);
    const timer = setTimeout(() => setStranded(true), 8_000);
    return () => clearTimeout(timer);
  }, [empty]);
  const box = useRef<HTMLDivElement>(null);
  const village = useRef<VillageHandle | null>(null);
  const [view, setView] = useState<WorldView | null>(null);
  const observing = path === "/agent";
  // The camera help can be put away to a small button in the bottom strip; remembered per browser.
  const [help, setHelp] = useState(true);
  useEffect(() => { try { if (readStoredValue(localStorage, "gamine.cameraHelp") === "closed") setHelp(false); } catch { /* storage unavailable */ } }, []);
  const showHelp = (open: boolean) => {
    setHelp(open);
    try { if (open) removeStoredValue(localStorage, "gamine.cameraHelp"); else localStorage.setItem("gamine.cameraHelp", "closed"); } catch { /* storage unavailable */ }
  };
  const observation = useRef<{ owner: string | null; id: string | null }>({ owner: null, id: null });

  const notes = useMemo(() => Object.fromEntries(PLACES.map((p) => [p.id, placeLine(world, p)])), [world]);
  /** The latest of everything the village is told, for when it finishes loading. */
  const latest = useRef({ world, inset, notes, night, go, openBuilding, onArenaDone, agent: agentOf(path), mine });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let gone = false;
    // Building names are drawn in the HUD's pixel face: the family next/font gave it, loaded before the first draw.
    const face = getComputedStyle(document.documentElement).getPropertyValue("--font-pixel-face").trim() || "monospace";
    const loaded = document.fonts ? document.fonts.load(`18px ${face}`).catch(() => []) : Promise.resolve([]);
    // Phaser is loaded here and only here, after the page itself: never in the server render.
    Promise.all([import("./village/game"), loaded])
      .then(([{ startVillage }]) =>
        gone ? null : startVillage(el, {
          base: "/village",
          buildings: PLACES.map(({ id, label, note }) => ({ id, label, note })),
          still: prefersReducedMotion(),
          nameFont: face,
          events: {
            ready: () => { if (!gone) setStatus("ready"); },
            view: (next) => { if (!gone) setView(next); },
            selectAgent: (id) => {
              if (id) latest.current.go(`/a/${id}`);
            },
            selectBuilding: (id) => latest.current.openBuilding(id),
            arenaDone: (id) => latest.current.onArenaDone(id),
          },
        }),
      )
      .then(
        (handle) => {
          if (!handle) return;
          if (gone) return handle.destroy();
          village.current = handle;
          handleRef.current = handle;
          const now = latest.current;
          handle.setInsets({ top: BAR, ...now.inset });
          handle.setNotes(now.notes);
          handle.setNight(now.night);
          handle.setMine(now.mine);
          if (now.world.residents) handle.setResidents(now.world.residents);
          handle.select(now.agent, true);
        },
        () => {
          if (!gone) setStatus("failed");
        },
      );
    return () => {
      gone = true;
      village.current?.destroy();
      village.current = null;
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    latest.current.go = go;
    latest.current.openBuilding = openBuilding;
    latest.current.onArenaDone = onArenaDone;
  }, [go, openBuilding, onArenaDone]);

  const residents = world.residents;
  useEffect(() => {
    latest.current.world = world;
    if (residents) village.current?.setResidents(residents);
  }, [world, residents]);

  useEffect(() => {
    latest.current.notes = notes;
    village.current?.setNotes(notes);
  }, [notes]);

  useEffect(() => {
    latest.current.mine = mine;
    village.current?.setMine(mine);
  }, [mine]);

  useEffect(() => {
    latest.current.night = night;
    village.current?.setNight(night);
  }, [night]);

  useEffect(() => {
    latest.current.inset = inset;
    village.current?.setInsets({ top: BAR, ...inset });
  }, [inset]);

  // An agent's page picks it out in the village and brings the camera to it.
  const agent = agentOf(path);
  useEffect(() => {
    latest.current.agent = agent;
    village.current?.select(agent, true);
  }, [agent]);

  // Agent follows an owner in the same renderer. Other routes leave the camera alone.
  useEffect(() => {
    const handle = village.current;
    if (!handle) return;
    handle.setObservation(observing);
    observation.current = { owner: null, id: null };
  }, [status, observing]);

  useEffect(() => {
    const handle = village.current;
    if (!handle || !observing) return;
    const before = observation.current;
    if (before.owner !== ownerKey) {
      handle.select(null);
      observation.current = { owner: ownerKey, id: null };
    }
    const here = (id: string) => mine.has(id) && !!residents?.some((r) => r.id === id && r.place !== "gate");
    // Keep the chosen owned agent through feed refreshes and match transitions.
    if (view?.selected && here(view.selected.id)) {
      if (observation.current.id !== view.selected.id || !view.following) handle.select(view.selected.id, true);
      observation.current.id = view.selected.id;
      return;
    }
    const id = [...mine].find(here);
    if (id && (observation.current.id !== id || !view?.following)) {
      handle.select(id, true);
      observation.current.id = id;
    } else if (!id && observation.current.id) {
      handle.select(null);
      observation.current.id = null;
    }
  }, [observing, ownerKey, mine, residents, status, view?.selected?.id, view?.following]);

  return (
    <div className="fixed inset-0 z-0 bg-ink">

      {/* The source engine owns simulation/art, never a second public map. */}
      <div ref={box} aria-hidden className="pointer-events-none invisible absolute inset-0" />
      {status === "ready" ? <WorldCamera village={village} observing={observing} scrolls={scrolls} inset={inset} help={help} onHelp={showHelp} /> : null}
      {/* The veil: enough to settle the world behind the HUD, never enough to hide it. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-ink/10" />
      {/* On a phone the bar has no room for the world's numbers: they sit on the village, top left. */}
      {/* Not on a phone with a page open: the sheet takes the screen, and the strip above it is for the village. */}
      {status === "ready" && !observing ? <PhoneStats world={world} hidden={scrolls !== null} /> : null}
      {observing ? <AgentStatus account={account} accountError={accountError} view={view} village={village} /> : null}
      {/* The village's own controls, kept in the part the panel leaves uncovered. */}
      <div
        className="pointer-events-none absolute left-0 top-14 z-10 flex items-end justify-between gap-2 p-2 md:p-4"
        style={{ right: inset.right, bottom: inset.bottom }}
      >
        <div className="block">
        {/* The camera help, put away: the way back to it, first in the world's own bottom strip. */}
        {status === "ready" && !scrolls && !observing && !help ? (
          <button type="button" onClick={() => showHelp(true)}
            className="rounded-panel pointer-events-auto flex h-8 w-fit items-center border border-hud-line bg-hud px-2.5 text-[12px] text-accent hover:border-accent md:mb-2">
            Camera
          </button>
        ) : null}
        {status === "ready" && !stranded && !observing ? (
          // The world itself: $GAMINE's contract address, ready to copy.
          <p className="rounded-panel pointer-events-auto hidden items-center gap-2 border border-hud-line bg-hud py-1 pl-2.5 pr-1 text-[12px] text-muted md:flex">
            <span><span className="text-accent">$GAMINE</span> - <span className="font-mono text-text">{AGP_MINT}</span></span>
            <CopyButton value={AGP_MINT} label="Copy" className="rounded border border-hud-line px-2 py-0.5 text-[11px] text-accent hover:border-accent" />
          </p>
        ) : (
          <p
            className={`rounded-panel border border-hud-line bg-hud px-2.5 py-1 text-[11px] uppercase tracking-wide text-muted ${
              observing || status === "ready" && !stranded ? "hidden md:block" : "mb-10 max-w-[55%] md:mb-0 md:max-w-none"
            }`}
          >
            {status === "failed"
              ? "The village didn't load"
              : status === "loading"
                ? "Opening..."
                : stranded
                  ? "Can't reach the game server, so no agents yet. Retrying…"
                  : "Following your autonomous agent"}
          </p>
        )}
        </div>
        {status === "ready" && !scrolls && !observing ? (
          // On a phone the footer chip runs along the bottom edge and "Show the page" sits over it, so these
          // stack above both. From md the shell puts them in the chip's own row instead. Put away with an open page.
          // 8px apart, and 8px above "Show the page" (or, on the world with no page, above the footer chip).
          <div className={`pointer-events-auto ${path === "/" ? "mb-10" : "mb-20"} ml-auto flex flex-col items-end gap-2 md:hidden`}>
            <VillageControls village={village} mine={mine} findLast />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A compact, expandable mobile HUD leaves the world visible. Desktop keeps
 * its detailed readout open.
 */
function PhoneStats({ world, hidden }: { world: World; hidden: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const t = worldTally(world);
  const town = townActivityTally(world.residents ?? []);
  const busy = town.farming + town.gathering + town.delivery + town.exploration + town.sparring;
  const n = (v: number | undefined) => (v === undefined ? "–" : v);
  const state = world.online === null ? "Connecting" : world.online ? "Online" : "Offline";
  const tone = world.online === null ? "text-muted" : world.online ? "text-live" : "text-loss";
  const dot = `inline-block h-2 w-2 rounded-full ${world.online ? "live-blink bg-live" : world.online === null ? "bg-muted" : "bg-loss"}`;
  const cells: { label: string; value: number | undefined; tone: string; title?: string }[] = [
    { label: "In matches", value: t?.active, tone: "text-live" },
    { label: "Idle", value: t?.idle, tone: "text-accent" },
    { label: "Done", value: t?.done, tone: "text-text", title: "Player matches finished in the live window; exhibitions excluded" },
    { label: "Total", value: t?.total, tone: "text-text" },
    { label: "House", value: t?.house, tone: "text-muted", title: "Demo agents; excluded from player counts" },
  ];
  return (
    <div
      className={`${hidden ? "hidden md:block" : ""} rounded-panel pointer-events-auto absolute left-2 top-16 z-10 w-fit max-w-[calc(100vw-1rem)] border border-hud-line bg-hud font-mono text-[11px] leading-5 shadow-[0_4px_16px_rgb(0_0_0/0.45)] md:pointer-events-none md:left-4 md:top-[4.5rem] md:min-w-32 md:px-3 md:py-2 md:text-[12px]`}
    >
      <button
        type="button"
        aria-label="World stats"
        aria-expanded={expanded}
        aria-controls="world-stats-details"
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-panel px-3 text-[11px] focus-visible:outline-2 focus-visible:outline-accent md:hidden"
      >
        <span className={`flex items-center gap-1.5 ${tone}`} aria-live="polite"><span className={dot} aria-hidden />{state}</span>
        <span className="text-muted">Town <span className="text-live">{busy}</span> busy</span>
        <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" className={expanded ? "rotate-180" : ""}><path d="m2 4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <div id="world-stats-details" className={`${expanded ? "block" : "hidden"} min-w-56 border-t border-hud-line px-3 pb-2 pt-1.5 md:block md:min-w-0 md:border-0 md:p-0`}>
        <p className="hidden items-center justify-between gap-4 md:flex">
          <span className="text-muted">Status:</span>
          <span className="flex items-center gap-1.5">
            <span className={dot} aria-hidden />
            <span className={tone}>{state}</span>
          </span>
        </p>
        <div className="grid grid-cols-2 gap-x-3 md:block">
          {cells.map((c) => (
            <span key={c.label} title={c.title} className="flex justify-between gap-2 md:gap-4">
              <span className="text-muted">{c.label}:</span> <span className={c.tone}>{n(c.value)}</span>
            </span>
          ))}
        </div>
        <div className="mt-1.5 border-t border-hud-line pt-1.5">
          <p className="text-live">Town life</p>
          <div className="grid grid-cols-2 gap-x-3 text-[10px] leading-4">
            {([['Farming', town.farming], ['Gathering', town.gathering], ['Delivery', town.delivery], ['Exploring', town.exploration], ['Practice', town.sparring], ['Rest/return', town.resting]] as const).map(([label, count]) => (
              <span key={label} className="flex justify-between gap-2"><span className="text-muted">{label}</span><span className="text-text">{count}</span></span>
            ))}
          </div>
          <p className="text-[9px] leading-4 text-muted">House + holder agents</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The village's controls: find my agent, then zoom. In the footer chip's row
 * from md, so they sit at the screen's bottom-right; stacked over the village
 * on a phone, where the chip fills the bottom edge.
 */
function VillageControls({
  village,
  mine,
  findLast = false,
}: {
  village: React.RefObject<VillageHandle | null>;
  mine: ReadonlySet<string>;
  /** On a phone the zoom comes first and "Find my agent" under it, over "Show the page". */
  findLast?: boolean;
}) {
  const find =
    mine.size > 0 ? (
      <Link
        href="/agent"
        aria-label="Find my agent"
        title="Find my agent"
        className="rounded-panel flex h-9 items-center gap-1.5 whitespace-nowrap border border-accent bg-hud px-2.5 text-[12px] font-medium text-accent shadow-[0_4px_16px_rgb(0_0_0/0.5)] hover:text-text"
      >
        <span aria-hidden>◎</span> Find my agent
      </Link>
    ) : null;
  return (
    <>
      {findLast ? null : find}
      {([1, -1] as const).map((step) => (
        <button
          key={step}
          type="button"
          onClick={() => village.current?.zoom(step)}
          aria-label={step > 0 ? "Zoom in" : "Zoom out"}
          className="rounded-panel h-9 w-9 border border-hud-line bg-hud text-[16px] text-text hover:border-accent"
        >
          {step > 0 ? "+" : "−"}
        </button>
      ))}
      {findLast ? find : null}
    </>
  );
}
