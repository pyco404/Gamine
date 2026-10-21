// Screenshots the Arena (web/app/village/arena.ts) in its three states - a live
// match, a replay, and no matches yet - against the local web app, with the
// live stream and the ladder served from a fixture so the states are certain.
// Two real agents are taken from the local game server's field; the match
// between them, its rounds, and their ladder ranks are made up here.
//
// Usage: node scripts/shoot-arena.mjs [out-dir]   (web on :3000, game server on :8787)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const out = process.argv[2] ?? "web/.shots/arena-always-on";
const WEB = "http://localhost:3000";
const API = "http://localhost:8787";
mkdirSync(out, { recursive: true });

const { agents } = await (await fetch(`${API}/field`)).json();
if (agents.length < 2) throw new Error("the game server's field needs two agents");
const [a, b] = agents;
const side = (x) => ({ id: x.id, name: x.name, presetName: x.presetName ?? null, mark: null });

/** Five rounds, won 3-2: a close match between the ladder's top two. */
const wins = ["A", "B", "A", "B", "A"];
const play = wins.map((winner, i) => {
  const won = { A: wins.slice(0, i + 1).filter((w) => w === "A").length, B: wins.slice(0, i + 1).filter((w) => w === "B").length };
  return {
    roundNumber: i + 1,
    leader: i % 2 ? "B" : "A",
    edges: { A: 0.4 + 0.1 * (i % 3), B: 0.6 - 0.1 * (i % 3) },
    sequence: [{ seat: i % 2 ? "B" : "A", action: "raise" }, { seat: i % 2 ? "A" : "B", action: "call" }],
    outcome: "flipped",
    bet: 20,
    chanceA: 0.5,
    winner,
    nets: { A: (won.A - won.B) * 20, B: (won.B - won.A) * 20 },
    roundsWon: won,
    beats: [],
  };
});
const match = {
  id: "00000000-0000-4000-8000-00000000a7e4",
  seq: 1,
  createdAt: new Date().toISOString(),
  a: side(a),
  b: side(b),
  winner: "A",
  netA: 20,
  netB: -20,
  stake: 20,
  rounds: play.length,
  headline: null,
  ranked: true,
  beat: null,
  beatSeat: null,
  exhibition: false,
  play,
};
const ladder = {
  rows: [a, b].map((x, i) => ({ agentId: x.id, name: x.name, presetName: null, matchesPlayed: 12, cumulativeNet: 200 - i * 50, recentForm: 0, balance: 1000, retired: false })),
  season: { key: "fixture", number: 1, startsAt: new Date(Date.now() - 864e5).toISOString(), endsAt: new Date(Date.now() + 864e5).toISOString(), current: true },
};

const sse = (withMatch) =>
  `retry: 600000\n\nevent: hello\ndata: ${JSON.stringify({ counters: { matchesToday: withMatch ? 1 : 0, totalStaked: 0, holders: 2 }, playMs: 10_000 })}\n\n` +
  (withMatch ? `id: 1\nevent: match\ndata: ${JSON.stringify({ match, ageMs: 0 })}\n\n` : "");

const STORE = "gamine.arena.v1";
const kept = { best: [{ match, score: 1, at: Date.now() - 3_600_000 }], meetings: {}, season: "fixture" };

const states = [
  { name: "live", stream: true, store: null, wait: 4_500 },
  { name: "replay", stream: false, store: kept, wait: 4_500 },
  { name: "empty", stream: false, store: null, wait: 2_000 },
];

const browser = await chromium.launch();
for (const s of states) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(([key, value]) => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {}
  }, [STORE, s.store ? JSON.stringify(s.store) : null]);
  await page.route(`${API}/live**`, (route) => route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse(s.stream) }));
  await page.route(`${API}/ladder**`, (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, json: ladder }));
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Show the page" }).waitFor({ timeout: 30_000 });
  // In close on the Arena - the camera frames the whole village, the Arena in the middle - so the sign and
  // the label over the fighters can be read; then back out a little for the village round it.
  const zoom = (name) => page.getByRole("button", { name }).last().click();
  for (let i = 0; i < 3; i++) await zoom("Zoom in");
  await page.waitForTimeout(s.wait);
  await page.screenshot({ path: `${out}/arena-${s.name}-close.png`, clip: { x: 290, y: 120, width: 700, height: 460 } });
  for (let i = 0; i < 2; i++) await zoom("Zoom out");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/arena-${s.name}.png` });
  console.log(`${out}/arena-${s.name}.png (+ -close)`);
  await page.close();
}
await browser.close();
