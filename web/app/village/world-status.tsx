"use client";

import { useState } from "react";
import { worldTally, type World } from "./world";
import { townActivityTally } from "./activity-tally";

export function WorldStatus({ world, hidden }: { world: World; hidden: boolean }) {
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

