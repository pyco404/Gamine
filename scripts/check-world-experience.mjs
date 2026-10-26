// Local read-only presentation checks. No signing, writes, or on-chain requests.
// BASE_URL=http://localhost:3001 node scripts/check-world-experience.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:3001';
const out = process.env.SCREENSHOT_DIR ?? '/tmp/gamine-upgrade';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const results = [], selector = 'canvas[aria-label^="Explore the Gamine"]';

async function open(options) {
  const page = await browser.newPage(options), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('gamine.sound', '0'); localStorage.setItem('gamine.cameraHelp', 'closed'); });
  await page.goto(`${base}/?debugWorldPerf=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('button', { name: /enter world/i }).click({ timeout: 60000 });
  await page.waitForFunction((s) => Number(document.querySelector(s)?.dataset.zoom) > 0, selector, { timeout: 90000 });
  await page.waitForTimeout(1800);
  return { page, errors };
}
const camera = (page) => page.locator(selector).evaluate((c) => ({ x: +c.dataset.focusX, y: +c.dataset.focusY, zoom: +c.dataset.zoom, yaw: +c.dataset.yaw }));
const noOverflow = async (page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal page overflow');

try {
  const desktop = await open({ viewport: { width: 1440, height: 960 } }), { page } = desktop;
  assert.equal(await page.getByRole('toolbar', { name: 'World navigation' }).count(), 0);
  await page.screenshot({ path: `${out}/after-desktop.png` });
  const before = await camera(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(1280, 720); await page.mouse.down(); await page.mouse.move(1350, 760, { steps: 12 }); await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(1000);
  const after = await camera(page);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 10, 'Pan drag did not move camera');
  assert.ok(Math.abs(after.yaw - before.yaw) < .001, 'Pan drag rotated camera');
  assert.equal(await page.getByRole('region', { name: 'Arena match' }).count(), 0);
  await page.getByRole('button', { name: 'Night in the village' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/after-night.png` });
  await noOverflow(page);
  assert.deepEqual(desktop.errors, []);
  const performance = await page.evaluate(() => {
    const frames = window.__worldRenderPerf?.frames.slice(-120) ?? [];
    const times = frames.map((f) => f.ms).sort((a, b) => a - b);
    return frames.length ? { sampleFrames: frames.length, meanDrawMs: times.reduce((a, b) => a + b, 0) / (times.length || 1), p95DrawMs: times[Math.floor(times.length * .95)] ?? null, ...(window.__worldRenderPerf?.summary ?? {}) } : { instrumented: false, reason: "Internal render diagnostics are disabled in production." };
  });
  results.push({ viewport: 'desktop', camera: 'toolbar removed; Shift-drag pan passed', errors: desktop.errors, performance, rendering: 'Headless Chromium / software GPU' });
  await page.close();

  const mobile = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mobile.page.getByRole('button', { name: 'World stats' }).click();
  assert.equal(await mobile.page.getByRole('button', { name: 'World stats' }).getAttribute('aria-expanded'), 'true');
  await mobile.page.getByRole('button', { name: 'World stats' }).click();
  await mobile.page.getByRole('button', { name: 'Open menu' }).click();
  await mobile.page.getByRole('link', { name: 'About', exact: true }).last().click();
  await mobile.page.getByRole('heading', { name: 'About', exact: true }).waitFor();
  await mobile.page.getByRole('button', { name: 'Close the page and see the village' }).click();
  assert.equal(await mobile.page.getByRole('toolbar', { name: 'World navigation' }).count(), 0);
  await mobile.page.waitForTimeout(1400);
  const cdp = await mobile.page.context().newCDPSession(mobile.page), pinchBefore = await camera(mobile.page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300, id: 1 }, { x: 230, y: 300, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 300, id: 1 }, { x: 260, y: 300, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.page.waitForTimeout(1200);
  assert.ok((await camera(mobile.page)).zoom > pinchBefore.zoom, 'Touch pinch did not zoom');
  assert.equal(await mobile.page.getByRole('toolbar', { name: 'World navigation' }).count(), 0);
  await mobile.page.waitForTimeout(1200);
  assert.equal(await mobile.page.getByRole('region', { name: 'Arena match' }).count(), 0);
  await mobile.page.screenshot({ path: `${out}/after-mobile.png` });
  await noOverflow(mobile.page);
  assert.deepEqual(mobile.errors, []);
  results.push({ viewport: 'mobile', navigation: 'menu, page sheet, stats, camera and touch pinch passed', overflow: false, errors: mobile.errors });
  await mobile.page.close();

  const reduced = await open({ viewport: { width: 768, height: 1024 }, reducedMotion: 'reduce' });
  assert.equal(await reduced.page.getByRole('toolbar', { name: 'World navigation' }).count(), 0);
  await reduced.page.screenshot({ path: `${out}/after-tablet-reduced-motion.png` });
  await noOverflow(reduced.page);
  assert.deepEqual(reduced.errors, []);
  results.push({ viewport: 'tablet', reducedMotion: true, errors: reduced.errors });
  await reduced.page.close();
  writeFileSync(`${out}/browser-results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
