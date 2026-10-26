"use client";

import Link from "next/link";
import { useWorld } from "./world";

/** Only public field snapshots are read here. Owner editing remains on authenticated agent management pages. */
export function SelectedAgentActivity({ id }: { id: string }) {
  const world = useWorld();
  const resident = world.residents?.find((r) => r.id === id && !r.standIn);
  const activity = resident?.worldActivity?.state;
  const inMatch = resident?.place === "arena" || resident?.place === "duel";
  const title = inMatch ? "Competing in Bluff & Fold" : activity ? ({ farming: "Tending the fields", gathering: "Gathering in the village", delivery: "Making a delivery", exploration: "Exploring the countryside", sparring: "Friendly practice", idle: "Taking a moment" }[activity.activity]) : "Waiting for a verified activity";
  return <section className="selected-agent-activity" aria-label="Selected agent activity">
    <p className="hud-eyebrow">In the village</p><p className="mt-1 font-medium text-text">{title}</p>
    {activity && !inMatch ? <>
      <p className="mt-1 text-xs text-muted capitalize">{activity.phase} · {activity.destination}</p>
      <progress className="mt-3 block h-1.5 w-full accent-emerald-400" value={activity.progress} max={1} aria-label="Selected agent activity progress" />
      {activity.job ? <p className="mt-2 text-xs text-live">Notice Board: {activity.job.title}</p> : null}
    </> : null}
    <p className="mt-2 text-[11px] leading-5 text-muted">{resident?.house ? "House exhibitions do not earn rankings or rewards." : "Village errands are cosmetic. Only qualifying Bluff & Fold matches contribute to reward scores."}</p>
    {!resident?.house ? <div className="mt-2 flex gap-4"><Link href="/ladder" className="hud-link">Rankings ↗</Link><Link href="/rewards" className="hud-link">Reward standings ↗</Link></div> : null}
  </section>;
}
