import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { groundDetail } from "../lib/world/ground-detail";
import { createWorldModel, prepareWorldMap } from "../lib/world/model";
import { matchPresentation } from "../lib/world/match-presentation";
import { createWater } from "../app/village/game/solid-water";
import { eligibilityPresentation } from "../lib/eligibility-presentation";
import type { PlayingMatch } from "../app/village/residents";
import type { HoldingView } from "../lib/api";

const round = { leader: "A" as const, edges: { A: .3, B: .7 }, sequence: [{ seat: "A" as const, action: "raise" as const }, { seat: "B" as const, action: "fold" as const }], outcome: "one-folded" as const, bet: 4, winner: "A" as const };
const match: PlayingMatch = { id: "verified-match", a: { id: "a", name: "Alpha" }, b: { id: "b", name: "Beta" }, netA: 8, netB: -8, exhibition: false,
  play: [{ ...round, roundsWon: { A: 1, B: 0 } }, { ...round, roundsWon: { A: 2, B: 0 } }] };

describe("arena presentation follows the card table reveal clock", () => {
  it("does not expose the score, actions, hands or result while agents are arriving", () => {
    expect(matchPresentation(match, null, 10_500)).toMatchObject({ phase: "arrival", score: { A: 0, B: 0 }, actions: [], edges: null, result: null });
  });
  it("keeps hands and outcomes private during the deal", () => {
    expect(matchPresentation(match, 100, 10_500)).toMatchObject({ phase: "hands", actions: [], edges: null, result: null, score: { A: 0, B: 0 } });
  });
  it("reveals actions in order, without showing an early outcome", () => {
    const view = matchPresentation(match, 2100, 10_500);
    expect(view.actions).toEqual([round.sequence[0]]);
    expect(view.score).toEqual({ A: 0, B: 0 });
    expect(view.edges).toBeNull(); expect(view.result).toBeNull();
  });
  it("reveals only the completed round score and hands at the outcome", () => {
    expect(matchPresentation(match, 3500, 10_500)).toMatchObject({ phase: "outcome", round: 1, score: { A: 1, B: 0 }, edges: round.edges, result: null });
  });
  it("carries the previous score into the next round without revealing its result", () => {
    expect(matchPresentation(match, 4600, 10_500)).toMatchObject({ phase: "hands", round: 2, score: { A: 1, B: 0 }, actions: [], result: null });
  });
  it("shows the actual match winner only at the final phase", () => {
    expect(matchPresentation(match, 9000, 10_500)).toMatchObject({ phase: "final", score: { A: 2, B: 0 }, result: "Alpha wins" });
    expect(matchPresentation({ ...match, netA: -8 }, 9000, 10_500).result).toBe("Beta wins");
    expect(matchPresentation({ ...match, netA: 0 }, 9000, 10_500).result).toBe("Match drawn");
  });
  it("does not invent rounds for older match records without playback data", () => {
    expect(matchPresentation({ ...match, play: undefined }, 100_000, 10_500).phase).toBe("arrival");
  });
  it("clamps progress for early and expired clocks without mutating source events", () => {
    const before = structuredClone(match);
    expect(matchPresentation(match, -500, 10_500).progress).toBe(0);
    expect(matchPresentation(match, 1_000_000, 10_500).progress).toBe(1);
    expect(match).toEqual(before);
  });
});

describe("deterministic flat ground detail", () => {
  const imported = JSON.parse(readFileSync(new URL("../public/village/map.json", import.meta.url), "utf8"));
  const world = createWorldModel(prepareWorldMap(imported), () => ({ width: 128, height: 160 }));
  it("is bounded and repeatable, without changing shared geometry", () => {
    const before = structuredClone(world), a = groundDetail(world);
    expect(a.length).toBeGreaterThan(40); expect(a.length).toBeLessThanOrEqual(9 * 64);
    expect(a).toEqual(groundDetail(world)); expect(world).toEqual(before);
    expect(new Set(a.map((p) => p.kind)).size).toBe(3);
  });
  it("keeps detail off road surfaces and reserved footprints", () => {
    for (const p of groundDetail(world)) {
      expect(world.lots.some((b) => p.x > b.x0 - 12 && p.x < b.x1 + 12 && p.y > b.y0 - 12 && p.y < b.y1 + 12)).toBe(false);
      for (const road of world.map.paths) for (let i = 1; i < road.points.length; i++) {
        const [ax, ay] = road.points[i - 1]!, [bx, by] = road.points[i]!;
        const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)));
        expect(Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy)).toBeGreaterThanOrEqual(road.width / 2 + 18);
      }
    }
  });
});

describe("wallet verification presentation", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const holding = { eligible: true, readAt: new Date(now).toISOString(), priceReady: true } as HoldingView;
  it("distinguishes checking, eligibility, and a confirmed insufficient balance", () => {
    expect(eligibilityPresentation(holding, true, now).state).toBe("verifying");
    expect(eligibilityPresentation(holding, false, now).state).toBe("eligible");
    expect(eligibilityPresentation({ ...holding, eligible: false }, false, now).state).toBe("ineligible");
  });
  it("does not label missing, stale, invalid, or unavailable verification as ineligible", () => {
    expect(eligibilityPresentation(null, false, now).state).toBe("unverified");
    for (const value of [{ ...holding, priceReady: false, readAt: null }, { ...holding, priceReady: false }, { ...holding, readAt: "invalid" }, { ...holding, readAt: new Date(now - 21 * 60_000).toISOString(), eligible: false }]) {
      expect(eligibilityPresentation(value, false, now).state).toBe("unavailable");
    }
  });
});


describe("water effects on CPU-backed WebGL", () => {
  it.each(["ANGLE SwiftShader Device", "llvmpipe (LLVM)", "Microsoft Basic Render Driver"])("avoids the full-screen shader on %s", (renderer) => {
    const compileShader = vi.fn();
    const gl = { getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }), getParameter: () => renderer, compileShader };
    const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
    expect(createWater(canvas)).toBeNull();
    expect(compileShader).not.toHaveBeenCalled();
  });
  it("keeps the lightweight path available when WebGL is unavailable", () => {
    expect(createWater({ getContext: () => null } as unknown as HTMLCanvasElement)).toBeNull();
  });
});
