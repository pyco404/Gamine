// Local browser regression: live Phaser identities, projected culling, pixel occlusion and camera stress.
// BASE_URL=http://localhost:3000 node scripts/check-world-agents.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const counts = process.env.AGENT_COUNTS ? process.env.AGENT_COUNTS.split(',').map(Number) : [100, 1000];
const mixedPortraits = process.env.MIXED_PORTRAITS === '1';
const out = process.env.AGENT_SHOTS ?? '/tmp/gamine-agent-validation';
mkdirSync(out, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'gamine-agent-check-'));
const helper = join(temporary, 'helper.js');
const source = relative => JSON.stringify(fileURLToPath(new URL(relative, import.meta.url)));
await build({ stdin: { contents: [
  `export { worldPicker } from ${source('../web/app/village/game/projected-picking.ts')};`,
  `export { renderProjectedWorld } from ${source('../web/app/village/game/projected-art.ts')};`,
  `export { project, MIN_TILT, MAX_TILT } from ${source('../web/lib/world/projection.ts')};`,
  `export { placeResidents } from ${source('../web/app/village/residents.ts')};`,
].join('\n'), resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, platform: 'browser', format: 'iife', globalName: 'WorldTest', define: { 'process.env': '{}' }, outfile: helper });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  for (const count of counts) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    page.on('pageerror', e => errors.push(e.message));
    let fields = Array.from({ length: count }, (_, i) => ({ id: `render-regression-${i}`, name: `Walker ${i}`, presetName: 'Anchor', mark: null, house: false, retiredAt: null, worldActivity: null }));
    await page.addInitScript(() => { localStorage.setItem('gamine.sound', '0'); localStorage.setItem('gamine.cameraHelp', 'closed'); });
    await page.route('**/*', async route => {
      const u = new URL(route.request().url()), headers = { 'access-control-allow-origin': '*' };
      if (u.pathname === '/field' && route.request().resourceType() !== 'document') {
        const at = Date.now();
        return route.fulfill({ json: { agents: fields.map(a => ({ ...a, ...(a.worldActivity ? { worldActivity: { ...a.worldActivity, at } } : {}) })), at: new Date(at).toISOString() }, headers });
      }
      if (u.pathname === '/live' && route.request().resourceType() !== 'document' && route.request().headers().accept?.includes('text/event-stream')) return route.fulfill({ body: 'retry: 600000\n\nevent: hello\ndata: {"counters":{"matchesToday":0,"holders":1000},"playMs":10000}\n\n', contentType: 'text/event-stream', headers });
      // Exercise unavailable portraits and, optionally, delayed successful texture updates.
      if (/\/portrait|\/avatar/.test(u.pathname)) {
        const index = Number(u.pathname.match(/render-regression-(\d+)/)?.[1]);
        if (mixedPortraits && index % 3 === 0) {
          await new Promise(resolve => setTimeout(resolve, 120));
          return route.fulfill({ body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><g fill="#dfba83"><rect x="8" y="4" width="24" height="32"/><path fill="#314c42" d="M8 4h24v8H8z"/><path fill="#182b23" d="M12 18h4v4h-4zm12 0h4v4h-4z"/></g></svg>', contentType: 'image/svg+xml', headers });
        }
        return route.fulfill({ status: 404, body: '', headers });
      }
      return route.continue();
    });
    await page.goto(`${base}/?debugAgents=1`, { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('canvas[aria-label^="Explore the Gamine"]');
    await canvas.waitFor({ timeout: 60000 });
    const enter = page.getByRole('button', { name: /enter world/i });
    if (await enter.count()) await enter.click();
    await page.waitForFunction(n => window.__agentRenderDebug?.total === n, count, { timeout: 60000 });
    await page.addScriptTag({ path: helper });
    // Verify actual pixels: a sign panel covers the head, its open supports preserve the legs.
    // This catches regressions back to whole-actor occlusion or actors behind the terrain.
    const pixels = await page.evaluate(() => {
      const sprite = document.createElement('canvas'); sprite.width = 100; sprite.height = 100;
      const s = sprite.getContext('2d'); s.fillStyle = '#ff0000'; s.fillRect(0, 0, 100, 100); s.clearRect(40, 50, 20, 50);
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 300;
      const ctx = canvas.getContext('2d'), camera = { x: 0, y: 0, scale: 1 }, parts = [];
      const object = { id: 'wall', appearance: 'sign', orientation: 'south', type: 'building', category: 'structure', x: 0, y: 10, width: 100, depth: 10, height: 100, elevation: 0,
        metadata: { art: { key: 'wall', frame: 0 }, topAnchor: { x: 0, y: 10 } } };
      WorldTest.renderProjectedWorld(ctx, { bounds: { x0: -150, y0: -150, x1: 150, y1: 150 }, slabDepth: 20, objects: [object] }, { yaw: 0, tilt: Math.PI / 6 }, camera, 300, 300, undefined,
        { art: () => ({ image: sprite, x: 0, y: 0, width: 100, height: 100 }) }, part => parts.push(part));
      ctx.fillStyle = '#00ffff'; ctx.fillRect(145, 70, 10, 80);
      for (const part of parts) { ctx.save(); ctx.translate(150, 150); part.draw(); ctx.restore(); }
      return { head: [...ctx.getImageData(150, 80, 1, 1).data], legs: [...ctx.getImageData(150, 140, 1, 1).data], depth: parts[0].depth };
    });
    assert.deepEqual(pixels.head, [255, 0, 0, 255]); assert.deepEqual(pixels.legs, [0, 255, 255, 255]); assert.equal(pixels.depth, 14);
    fields = await page.evaluate(fields => {
      const el = document.querySelector('canvas[aria-label^="Explore the Gamine"]');
      let f = el[Object.keys(el).find(k => k.startsWith('__reactFiber'))];
      while (f && !f.memoizedProps?.village?.current) f = f.return;
      const handle = f.memoizedProps.village.current;
      window.__agentTest = { handle, canvas: el, instances: new Map(), paints: new Map(), frames: [], missing: [], stale: [], intervals: [], previous: null };
      const paint = handle.paintAgent;
      handle.paintAgent = (id, ctx, x, y, k, painter) => {
        const result = paint(id, ctx, x, y, k, painter);
        window.__agentTest.paints.set(id, { at: performance.now(), x, y, result });
        return result;
      };
      const now = Date.now(), received = performance.now();
      const roads = handle.snapshot().world.map.paths.filter(p => p.points.length >= 3);
      const moving = fields.map((field, i) => {
        const route = roads[i % roads.length].points.map(([x, y]) => ({ x, y }));
        // Arc-length interpolation follows real road bends in the shared simulation.
        const path = i % 20 === 0 ? [{ x: 1400, y: 1080 }, { x: 1400, y: 1010 }, { x: 1400, y: 800 }, { x: 1400, y: 1010 }, { x: 1400, y: 1080 }] : [...route, ...route.slice(0, -1).reverse()];
        const startedAt = now - i % 40 * 350;
        return { ...field, worldReceivedAt: received, worldActivity: {
          at: now, revision: `test-${i}`, position: path[0], motion: { path, startedAt, endsAt: startedAt + 120000 },
          state: { activity: 'exploration', phase: 'traveling', destinationId: null, destination: 'Road regression', route: 'Road circuit', startedAt, completesAt: startedAt + 120000, progress: 0 },
        } };
      });
      handle.setResidents(WorldTest.placeResidents(moving, []));
      handle.lookAt({ x: 1400, y: 900 }); handle.view('district');
      const observe = () => {
        const t = window.__agentTest, d = window.__agentRenderDebug;
        if (d && d.at !== t.previous) {
          if (t.previous !== null) t.intervals.push(d.at - t.previous);
          t.previous = d.at;
          for (const a of d.agents) {
            if (a.source) {
              const old = t.instances.get(a.id);
              if (old !== undefined && old !== a.source.instance) t.missing.push(`remounted ${a.id}`);
              t.instances.set(a.id, a.source.instance);
            } else t.missing.push(`missing source ${a.id}`);
            // Compare against this render's rAF timestamp, independent of observer scheduling stalls.
            if (a.state === 'composited' && (!t.paints.get(a.id)?.result || t.paints.get(a.id).at < d.at)) t.missing.push(`not painted ${a.id}`);
            const r = el.getBoundingClientRect();
            if (a.screenX >= 0 && a.screenX <= r.width && a.screenY >= 0 && a.screenY <= r.height && a.state === 'offscreen') t.missing.push(`onscreen culled ${a.id}`);
          }
          t.frames.push({ at: d.at, painted: d.painted, total: d.total, fallbacks: d.fallbacks });
        }
        t.raf = requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
      return moving;
    }, fields);

    async function angle(yaw, tilt) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const gesture = await page.evaluate(({ yaw, tilt }) => {
          const t = window.__agentTest, el = t.canvas, d = el.dataset, rect = el.getBoundingClientRect();
          const current = { yaw: +d.yaw, tilt: +d.tilt }, dx = (current.yaw - yaw) / 0.006, dy = (current.tilt - tilt) / 0.005;
          const centre = WorldTest.project(current, { x: +d.focusX, y: +d.focusY });
          const picker = WorldTest.worldPicker(current, t.handle.snapshot().world.objects, { ...centre, scale: +d.zoom }, rect.width, rect.height, t.handle.snapshot().art);
          for (let y = 380; y < rect.height - 140; y += 55) for (let x = 380; x < rect.width - 60; x += 55) {
            if (x + dx < 25 || x + dx > rect.width - 25 || y + dy < 20 || y + dy > rect.height - 20 || picker({ x, y })) continue;
            if (document.elementFromPoint(rect.left + x, rect.top + y) !== el) continue;
            if (window.__agentRenderDebug.agents.some(a => Math.abs(a.screenX - x) < 35 && y > a.screenY - 100 && y < a.screenY + 20)) continue;
            return { x: rect.left + x, y: rect.top + y, dx, dy };
          }
          return null;
        }, { yaw, tilt });
        assert.ok(gesture, 'No empty camera gesture point');
        if (Math.abs(gesture.dx) + Math.abs(gesture.dy) < 1) return;
        await page.mouse.move(gesture.x, gesture.y); await page.mouse.down();
        await page.mouse.move(gesture.x + gesture.dx, gesture.y + gesture.dy, { steps: 16 }); await page.mouse.up();
        await page.waitForTimeout(800);
        const actual = await canvas.evaluate(el => ({ yaw: +el.dataset.yaw, tilt: +el.dataset.tilt }));
        if (Math.abs(actual.yaw - yaw) + Math.abs(actual.tilt - tilt) < 0.05) return;
        console.log('Camera gesture retry', { yaw, tilt, actual, gesture });
      }
      throw new Error('Camera did not reach the requested angle');
    }
    await page.waitForTimeout(1200);
    // Stress the supported camera envelope; gesture tilt is intentionally clamped to 15–55°.
    const limits = await page.evaluate(() => ({ min: WorldTest.MIN_TILT, max: WorldTest.MAX_TILT }));
    for (const [name, yaw, tilt] of [
      ['top-limit', 0, limits.max], ['front', 0, 28 * Math.PI / 180], ['isometric', Math.PI / 4, Math.asin(1 / Math.sqrt(3))],
      ['low', Math.PI / 4, limits.min], ['high', Math.PI / 4, limits.max], ['back', Math.PI, 28 * Math.PI / 180],
    ]) {
      await angle(yaw, tilt); await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/${count}-${name}.png` });
      console.log(`${count}: ${name} camera checked`);
    }
    await canvas.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('-');
    await page.waitForTimeout(1000);
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');
    await page.waitForTimeout(1000);
    for (const path of ['/launch', '/live', '/games', '/']) {
      if (path === '/') await page.getByRole('link', { name: 'Gamine home' }).click();
      else await page.locator(`nav[aria-label="Sections"] a[href="${path}"]`).click();
      await page.waitForTimeout(350);
      assert.equal(await canvas.evaluate(el => el === window.__agentTest.canvas), true, 'World canvas remounted on navigation');
      console.log(`${count}: ${path} route checked`);
    }
    const result = await page.evaluate(() => {
      const t = window.__agentTest;
      cancelAnimationFrame(t.raf);
      const sorted = t.intervals.slice().sort((a, b) => a - b);
      return { agents: t.instances.size, frames: t.frames.length, missing: t.missing.slice(0, 20), fallbacks: t.frames.reduce((sum, f) => sum + f.fallbacks, 0), portraits: window.__agentRenderDebug.agents.filter(a => a.source.texture.startsWith('head-')).length, medianFrameMs: sorted[Math.floor(sorted.length / 2)], maxFrameMs: Math.max(...sorted), last: t.frames.at(-1) };
    });
    console.log(JSON.stringify({ count, ...result }));
    assert.equal(result.agents, count); assert.ok(result.frames > 20);
    assert.deepEqual(result.missing, []); assert.equal(result.fallbacks, 0);
    if (mixedPortraits) { assert.ok(result.portraits > 0, 'Successful portrait updates were not exercised'); assert.ok(result.portraits < count, 'Unavailable portrait fallback was not exercised'); }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${counts.join(', ')} agents, movement, viewport retention, pixel occlusion, rotation, tilt, zoom, route continuity${mixedPortraits ? ', delayed portrait updates' : ''}. Screenshots: ${out}`);
} finally { await browser.close(); rmSync(temporary, { recursive: true, force: true }); }
