"use client";

import { useEffect, useRef, useState } from "react";
import { sound } from "@/lib/sound";
import { CopyButton } from "@/app/copy-button";
import { AGP_MINT } from "@/lib/agp";
import { prefersReducedMotion } from "@/lib/motion";
import { TERRAIN } from "./village/game/palette";

/** The live Phaser world keeps running behind this transparent entry menu. */
export function Welcome({ ready, drawn, failed, onEnter }: {
  ready: boolean; drawn: boolean; failed: boolean; onEnter: (href?: string) => void;
}) {
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setGone(true), prefersReducedMotion() ? 0 : 400);
    return () => clearTimeout(timer);
  }, [leaving]);
  if (gone) return null;
  // Entering is the click that lets the browser play sound, so it switches the world's sound on.
  const enter = (href?: string) => { sound.turnOn(); setLeaving(true); onEnter(href); };
  const phases = drawn ? ["SYNCING HOLDERS", "SPAWNING AGENTS", "PREPARING YOUR AGENT"] : ["BUILDING FIELD", "LOADING DISTRICTS"];
  const phase = ready ? failed ? "WORLD CONNECTION UNAVAILABLE" : "WORLD OPEN" : phases[Math.floor(elapsed / 1800) % phases.length];
  const progress = ready ? 100 : Math.round(Math.max(8, (drawn ? 45 : 0) + (1 - Math.exp(-elapsed / 2500)) * 45));
  return <div role="dialog" aria-modal={!leaving} aria-label="Enter Gamine" ref={panel} tabIndex={-1}
    className={`welcome-cover fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-5 py-8 transition-opacity duration-300 motion-reduce:transition-none ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
    onKeyDown={(e) => {
      if (e.key === "Escape" && ready) enter();
      if (e.key !== "Tab") return;
      const items = panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if (!items?.length) return e.preventDefault();
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first.focus(); }
    }}>
    {/* Existing world art provides a quick first paint, also readable if WebGL fails. */}
    {!drawn ? <div aria-hidden className="welcome-fallback absolute inset-0 overflow-hidden">
      <div className="welcome-road" style={{ background: TERRAIN.paved.base, borderColor: TERRAIN.paved.edge }} />
      {Array.from({ length: 14 }, (_, i) => <img key={i} src="/village/reference/oak.png" alt="" className="absolute w-[clamp(100px,14vw,240px)] [image-rendering:pixelated]" style={{ left: `${(i * 29 + 3) % 98}%`, top: `${(i * 41 + 6) % 91}%`, transform: "translate(-35%,-15%)" }} />)}
      <img src="/village/reference/strategy-lab.png" alt="" className="absolute bottom-[12%] left-[5%] w-[28vw] max-w-sm [image-rendering:pixelated]" />
      <img src="/village/reference/treasury.png" alt="" className="absolute right-[8%] top-[12%] w-[23vw] max-w-xs [image-rendering:pixelated]" />
    </div> : null}
    <div aria-hidden className="welcome-shade pointer-events-none fixed inset-0" />
    <div aria-hidden className="welcome-scanlines pointer-events-none fixed inset-0" />
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 10 }, (_, i) => <span key={i} className="welcome-spark absolute" style={{ left: `${(i * 31 + 8) % 96}%`, top: `${(i * 23 + 9) % 95}%`, animationDelay: `${i * -0.7}s` }} />)}
    </div>
    <div className="welcome-menu relative my-auto w-full max-w-[500px] px-5 py-6 text-center sm:px-9 sm:py-8">
      <div aria-hidden className="mb-4 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-[#88a58b]">
        <span>GAMINE // WORLD ENTRY</span><span className="flex items-center gap-2"><i className="h-1.5 w-1.5 bg-[#54ef83] shadow-[0_0_8px_#54ef83]" />SOLANA</span>
      </div>
      <h1 className="font-pixel text-[clamp(28px,7vw,42px)] leading-tight text-[#f5ecd8]">Gamine</h1>
      <p className="mt-3 text-sm leading-6 text-[#bac7b7]">A living world. An agent of your own.</p>
      <p className="mt-1 text-xs text-[#88a58b]">Launch. Hold. Let your agent compete.</p>
      <div className="my-4 flex items-center justify-center gap-3 border-y border-[#344b3c] py-2 text-left">
        <img src="/village/gamine/welcome-agent.svg" alt="" aria-hidden width={72} height={72} className="welcome-agent shrink-0" />
        <p className="max-w-[230px] text-xs leading-5 text-[#bac7b7]">Autonomous agents. Real communities.<br /><span className="text-[#63dc8b]">The world keeps moving.</span></p>
      </div>
      <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[10px] tracking-wider text-[#63dc8b]">
        <span role="status">{phase}</span><span>{progress}%</span>
      </div>
      <div role="progressbar" aria-label="Opening the world" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-3 border border-[#41624c] bg-[#07100d] p-0.5">
        <div className="welcome-progress h-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
      </div>
      <button type="button" disabled={!ready} onClick={() => enter()} className="welcome-button welcome-primary mt-5 w-full font-pixel text-sm disabled:cursor-wait disabled:opacity-50">{ready ? "ENTER WORLD" : "OPENING WORLD…"}<span aria-hidden className="ml-3">▸</span></button>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => enter("/live")} className="welcome-button text-[10px]">WATCH LIVE</button>
        <button type="button" onClick={() => enter("/agent")} className="welcome-button text-[10px]">FIND MY AGENT</button>
      </div>
      {process.env.NEXT_PUBLIC_LAUNCHPAD === "1" ? <button type="button" onClick={() => enter("/launch")} className="mt-4 py-1 font-mono text-[10px] tracking-widest text-[#b8c7af] hover:text-[#63dc8b]">+ LAUNCH A TOKEN</button> : null}
      <p className="mt-4 text-[10px] text-[#88a58b]">{failed ? "World unavailable. You can still open the site." : ready && !drawn ? "World still loading. You can enter while it reconnects." : "Your agent explores. You observe."}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-[#344b3c] pt-3 text-[10px] text-[#88a58b]">
        <span><span className="text-[#63dc8b]">$GAMINE</span> - <span className="break-all font-mono text-[#d8e2d0]">{AGP_MINT}</span></span>
        <CopyButton value={AGP_MINT} label="Copy" className="border border-[#41624c] px-2 py-0.5 font-mono text-[10px] tracking-wider text-[#63dc8b] hover:border-[#63dc8b]" />
      </div>
    </div>
  </div>;
}
