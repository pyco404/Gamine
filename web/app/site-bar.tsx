"use client";

import { readStoredValue } from "@/lib/browser-storage";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { installUrl, shortKey, type WalletName } from "@/lib/wallet";
import { CopyButton } from "./copy-button";
import { PrivyOption } from "./privy-option";
import { useWallet } from "./wallet-context";
import { REWARDS_LINKED } from "./site-header";
import { LAUNCHPAD } from "@/lib/launchpad";
import { useWorld } from "./village/world";
import { sound } from "@/lib/sound";
import {
  MuteIcon,
  SoundIcon,
  ChevronIcon,
  CloseIcon,
  MoonIcon,
  SunIcon,
  WalletIcon,
} from "./icons";

type Section = { href: string; label: string };

const NAV: Section[] = [
  // Behind NEXT_PUBLIC_LAUNCHPAD=1 until the launchpad has a backend.
  ...(LAUNCHPAD
    ? [
        { href: "/launch", label: "Launch" },
        { href: "/explore", label: "Explore" },
      ]
    : []),
  { href: "/agent", label: "Agent" },
  { href: "/live", label: "Live" },
  { href: "/ladder", label: "Ladder" },
  { href: "/games", label: "Games" },
  // Announces the token before it exists; NEXT_PUBLIC_SHOW_REWARDS=false hides it without a code change.
  ...(REWARDS_LINKED ? [{ href: "/rewards", label: "Rewards" }] : []),
  { href: "/about", label: "About" },
];


/** Which section a path belongs to: match pages live under Live, agent pages under Ladder. */
function sectionOf(path: string): string | null {
  if (path === "/agents" || path === "/agent") return "/agent";
  if (path.startsWith("/m/") || path.startsWith("/live")) return "/live";
  if (path.startsWith("/a/") || path.startsWith("/ladder")) return "/ladder";
  if (path.startsWith("/games")) return "/games";
  if (path.startsWith("/rewards")) return "/rewards";
  if (path.startsWith("/launch")) return "/launch";
  if (path.startsWith("/explore")) return "/explore";
  if (path.startsWith("/about")) return "/about";
  return null;
}

const LOGO_CLASS = "h-6 w-6 rounded-sm bg-[#0c1018] object-contain [image-rendering:pixelated] lg:h-8 lg:w-8";

function Mark() {
  return (
    // The logo opens the village itself, with no page over it.
    <Link href="/" aria-label="Gamine home" className="flex shrink-0 items-center gap-2">
      <img src="/gamine-tb.png" alt="" width={372} height={370} className={LOGO_CLASS} />
    </Link>
  );
}

/**
 * The wallet control: "Sign in" signed out, the short address signed in. Either opens a small menu rather
 * than acting on one tap, so a stray tap can't sign anyone out.
 */
function WalletControl() {
  const { session, wallets, busy, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Close once signing in or out finishes.
  useEffect(() => setOpen(false), [session]);

  const all: WalletName[] = ["Phantom", "Solflare"];
  return (
    <div ref={box} className={`relative ${session ? "min-w-0" : "shrink-0"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={session ? `Wallet ${session.ownerId}` : "Sign in"}
        className={`rounded-panel flex h-9 max-w-full items-center gap-2 truncate border px-2 text-[13px] font-medium md:h-10 md:px-3.5 ${
          session ? "border-hud-line bg-hud font-mono text-text" : "border-accent bg-accent/10 text-accent hover:bg-accent/20"
        }`}
      >
        {/* The wallet mark from tablets up; on a phone the words alone, to keep the bar's room. */}
        {session ? null : <WalletIcon className="hidden h-[18px] w-[18px] shrink-0 md:block" />}
        <span className="truncate">{busy === "connect" ? "Waiting…" : session ? shortKey(session.ownerId) : "Sign in"}</span>
      </button>
      {open ? (
        <div
          role="menu"
          // On a phone the button sits mid-bar, so a menu hung from it would run off the screen: there it spans
          // the width under the bar. Near-solid, so what it says about signing reads clearly over the village.
          className="rounded-panel fixed inset-x-2 top-16 z-40 border border-hud-line bg-ink/95 p-4 text-[13px] leading-5 shadow-[0_10px_32px_rgb(0_0_0/0.6)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-72"
        >
          {session ? (
            <>
              <p className="text-muted">
                Signed in with {session.wallet === "Privy" ? "an email or X wallet" : session.wallet}
              </p>
              <p className="mt-1 break-all font-mono text-[11px]">{session.ownerId}</p>
              <div className="mt-2"><CopyButton value={session.ownerId} label="Copy wallet address" /></div>
              <button
                type="button"
                role="menuitem"
                onClick={() => void disconnect()}
                disabled={busy === "disconnect"}
                className="rounded-panel mt-3 w-full border border-line px-3 py-2 text-[13px] text-muted hover:text-accent"
              >
                {busy === "disconnect" ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <p className="text-muted">You sign a message, not a transaction. It costs nothing and moves nothing.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {all.map((name) =>
                  wallets.includes(name) ? (
                    <button
                      key={name}
                      type="button"
                      role="menuitem"
                      onClick={() => void connect(name)}
                      disabled={busy === "connect"}
                      className="rounded-panel bg-accent px-3 py-2 text-[13px] font-medium text-ink disabled:bg-line disabled:text-muted"
                    >
                      {name}
                    </button>
                  ) : (
                    <a
                      key={name}
                      role="menuitem"
                      href={installUrl(name)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-panel border border-line px-3 py-2 text-center text-[13px] text-muted"
                    >
                      Get {name}
                    </a>
                  ),
                )}
              </div>
              {/* A second way in: an embedded wallet from an email or X login. */}
              <PrivyOption menu />
            </>
          )}
          {error ? <p className="mt-2 text-loss">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Sound on or off, remembered in this browser, and on unless the visitor has
 * turned it off. A browser plays a page's sound only once someone has clicked,
 * tapped or pressed a key on it - loading, however long, is not enough - so
 * once the village is up it tries, which some browsers allow for a site
 * visited often, and otherwise starts on the first touch of the page: a drag
 * of the map, a tap, a click on a building. Until then it is `waiting`: on,
 * and silent, which the speaker says rather than pretend to be playing.
 */
export function useSoundSetting(villageUp: boolean): [on: boolean, toggle: () => void, waiting: boolean] {
  const [on, setOn] = useState(false);
  const playing = useSyncExternalStore(sound.subscribe, () => sound.playing, () => false);
  useEffect(() => {
    let off = false;
    try {
      off = readStoredValue(localStorage, "gamine.sound") === "0";
    } catch {
      // No storage: nothing was turned off, so it is on.
    }
    if (!off) setOn(true);
    // Entering the world from the welcome screen switches sound on.
    const turnedOn = () => setOn(true);
    window.addEventListener("gamine:sound-on", turnedOn);
    return () => window.removeEventListener("gamine:sound-on", turnedOn);
  }, []);
  useEffect(() => {
    if (!on || !villageUp || sound.playing) return;
    const start = () => (sound.enabled ? sound.wake() : sound.setEnabled(true));
    // Straight away where the browser allows it; wherever it does not, this waits, silent, for the first touch.
    start();
    const events = ["pointerdown", "keydown", "touchend"] as const;
    for (const e of events) window.addEventListener(e, start, { once: true, capture: true });
    return () => {
      for (const e of events) window.removeEventListener(e, start, { capture: true });
    };
  }, [on, villageUp]);
  const toggle = () => {
    // A click on the speaker while it waits is someone asking to hear it: that click lets it play, it does not turn it off.
    if (on && !playing) {
      if (sound.enabled) sound.wake();
      else sound.setEnabled(true);
      return;
    }
    setOn((was) => {
      const now = !was;
      sound.setEnabled(now);
      try {
        localStorage.setItem("gamine.sound", now ? "1" : "0");
      } catch {
        // Not remembered, but still switched.
      }
      return now;
    });
  };
  return [on, toggle, on && villageUp && !playing];
}

/** Day or night over the village, remembered in this browser. */
export function useNight(): [boolean, () => void] {
  const [night, setNight] = useState(false);
  useEffect(() => {
    try {
      setNight(readStoredValue(localStorage, "gamine.night") === "1");
    } catch {
      // No storage (a private window): it is day.
    }
  }, []);
  const toggle = () =>
    setNight((n) => {
      try {
        localStorage.setItem("gamine.night", n ? "0" : "1");
      } catch {
        // Not remembered, but still switched.
      }
      return !n;
    });
  return [night, toggle];
}


/**
 * The HUD over the village: the mark, the sections, what the world is doing,
 * day or night, and the wallet. Below xl the ☰ menu holds the sections the
 * bar has no room for - on a phone, all of them.
 */
export function SiteBar({
  night,
  onNight,
  showing,
  villageUp,
}: {
  night: boolean;
  onNight: () => void;
  showing: boolean;
  /** The village is on screen: the moment its sound may begin. */
  villageUp: boolean;
}) {
  const path = usePathname() ?? "/";
  const [soundOn, toggleSound, soundWaiting] = useSoundSetting(villageUp);
  // A section is current only while its page is showing: with the page closed, only the village is.
  const active = showing ? sectionOf(path) : null;
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Close on navigation.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => menu.current && !menu.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-hud-line bg-hud px-3 shadow-[0_2px_10px_rgb(0_0_0/0.4)] md:px-4 xl:gap-6">
        <Mark />
        <nav className="hidden h-full min-w-0 items-stretch lg:flex" aria-label="Sections">
          {NAV.map((item) => {
            const current = active === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`pixel-outline relative flex items-center px-2 font-pixel text-[17px] font-bold xl:px-3.5 ${
                  current ? "text-accent" : "text-[#f5ecd8] hover:text-accent"
                }`}
              >
                {item.label}
                {current ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] bg-accent xl:inset-x-3.5" /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 md:gap-3">
          <WalletControl />
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={toggleSound}
              aria-label={soundWaiting ? "Play the village's sound" : soundOn ? "Turn sound off" : "Turn sound on"}
              aria-pressed={soundOn}
              title={soundWaiting ? "Tap anywhere for sound" : soundOn ? "Sound on" : "Sound off"}
              className={`rounded-panel flex h-9 w-9 items-center justify-center border bg-hud text-accent hover:border-accent md:h-10 md:w-10 ${
                soundWaiting ? "animate-pulse border-accent" : "border-hud-line"
              }`}
            >
              {soundOn ? <SoundIcon className="h-5 w-5" /> : <MuteIcon className="h-5 w-5 text-muted" />}
            </button>
            {/* The browser holds sound back until the page is touched: say so, rather than show a speaker that is silent. */}
            {soundWaiting ? (
              <p
                aria-hidden
                className="rounded-panel pointer-events-none absolute right-0 top-full mt-2 whitespace-nowrap border border-hud-line bg-hud px-2 py-1 text-[12px] text-accent shadow-[0_4px_16px_rgb(0_0_0/0.5)]"
              >
                Tap anywhere for sound
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onNight}
            aria-label={night ? "Day in the village" : "Night in the village"}
            aria-pressed={night}
            title={night ? "Day" : "Night"}
            className="rounded-panel flex h-9 w-9 shrink-0 items-center justify-center border border-hud-line bg-hud text-accent hover:border-accent md:h-10 md:w-10"
          >
            {night ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
          </button>
          <div ref={menu} className="relative xl:hidden">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="site-menu"
              className="rounded-panel flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-[5px] border border-hud-line bg-hud md:h-10 md:w-10"
            >
              {open ? (
                <span className="text-lg leading-none text-muted">×</span>
              ) : (
                <>
                  <span className="block h-0.5 w-5 bg-text" />
                  <span className="block h-0.5 w-5 bg-text" />
                  <span className="block h-0.5 w-5 bg-text" />
                </>
              )}
            </button>
            {open ? <MenuPanel active={active} onClose={() => setOpen(false)} /> : null}
          </div>
        </div>
      </header>

    </>
  );
}

/**
 * The menu, in Agent Quest's shape: a panel with the mark, a live dot and its
 * own close, the pages as rows, and Rent at the foot. On a phone it drops over
 * the top of the screen; from sm up it hangs under the ☰. The world's numbers
 * are not here: on a phone they sit on the village itself (shell.tsx).
 */
function MenuPanel({ active, onClose }: { active: string | null; onClose: () => void }) {
  const w = useWorld();
  return (
    <>
    {/* The rest of the screen, dimmed: a tap on it closes the menu, as in Agent Quest. */}
    <div aria-hidden onClick={onClose} className="fixed inset-0 z-40 bg-ink/20" />
    <div
      id="site-menu"
      role="dialog"
      aria-label="Menu"
      className="rounded-panel fixed inset-x-2 top-2 z-40 flex max-h-[calc(100dvh-1rem)] flex-col overflow-y-auto border border-hud-line bg-hud px-4 pb-4 pt-3 shadow-[0_10px_32px_rgb(0_0_0/0.6)] sm:inset-x-auto sm:right-3 sm:top-16 sm:w-80"
    >
      <div className="flex items-center justify-between pb-2">
        <img src="/gamine-tb.png" alt="Gamine" width={372} height={370} className={LOGO_CLASS} />
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`inline-block h-2.5 w-2.5 rounded-full ${w.online ? "live-blink bg-live" : w.online === null ? "bg-muted" : "bg-loss"}`}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-panel flex h-9 w-9 items-center justify-center border border-hud-line bg-hud text-text hover:border-accent"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav aria-label="Pages" className="mt-1 border-t border-line">
        {NAV.map((item) => {
          const current = active === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={current ? "page" : undefined}
              className={`pixel-outline flex items-center justify-between border-b border-line py-2.5 font-pixel text-[18px] font-bold ${
                current ? "text-accent" : "text-[#f5ecd8] hover:text-accent"
              }`}
            >
              {item.label}
              <ChevronIcon className={`h-4 w-4 ${current ? "text-accent" : "text-muted"}`} />
            </Link>
          );
        })}
      </nav>

      <div className="mt-3 flex gap-2">
        <Link
          href="/agents"
          onClick={onClose}
          className="rounded-panel flex h-11 flex-1 items-center justify-center bg-accent px-3 text-[13px] font-semibold text-ink hover:bg-accent/90"
        >
          Get an agent
        </Link>
      </div>
    </div>
    </>
  );
}
