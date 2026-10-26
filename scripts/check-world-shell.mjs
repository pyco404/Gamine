// Read-only browser regression. Run against a production web server with
// NEXT_PUBLIC_LAUNCHPAD=1; backend reads use isolated fixtures, never real wallets.
// BASE_URL=http://localhost:3001 CHROME_BIN=/usr/bin/google-chrome node scripts/check-world-shell.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:3001';
const selector = 'canvas[aria-label^="Explore the Gamine"]';
const owner = '11111111111111111111111111111111';
const session = { token: 'world-shell-fixture', ownerId: owner, wallet: 'Phantom', expiresAt: '2099-01-01T00:00:00Z' };
const resident = { id: 'world-shell-agent', name: 'World Resident', presetName: 'Anchor', mark: null, house: false, retiredAt: null };
const agent = { ...resident, retired: false, funding: 'holder', balance: 3600, matchesPlayed: 0, cumulativeNet: 0 };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];

async function setup(options, path = '/') {
  const page = await browser.newPage(options);
  page.on('pageerror', (e) => errors.push(e.message));
  let maps = 0;
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/village/map.json') maps++; });
  await page.addInitScript((value) => {
    localStorage.setItem('gamine.session', JSON.stringify(value));
    localStorage.setItem('gamine.sound', '0');
  }, session);
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    // Never mistake Next's own route payloads for backend reads.
    if (u.origin === new URL(base).origin) return route.continue();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (u.pathname === '/field') return route.fulfill({ json: { agents: [resident], at: new Date().toISOString() }, headers });
    if (u.pathname === '/auth/me') return route.fulfill({ json: { ownerId: owner, agents: [agent], holding: null, tokenHoldings: [] }, headers });
    if (u.pathname === `/agents/${resident.id}`) return route.fulfill({ json: { agent, view: 'owner', holder: null }, headers });
    if (u.pathname === '/live') return route.fulfill({ body: 'retry: 600000\n\nevent: hello\ndata: {"counters":{"matchesToday":0,"holders":1},"playMs":10000}\n\n', contentType: 'text/event-stream', headers });
    return route.continue();
  });
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator(selector).waitFor({ timeout: 60000 });
  const enter = page.getByRole('button', { name: /enter world/i });
  if (await enter.count()) await enter.click();
  await page.waitForFunction((s) => !!document.querySelector(s)?.dataset.zoom, selector, { timeout: 60000 });
  await page.getByRole('button', { name: `Wallet ${owner}`, exact: true }).waitFor();
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    let f = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))];
    while (f && !f.memoizedProps?.village?.current) f = f.return;
    const handle = f.memoizedProps.village.current;
    window.__worldTest = { el, handle, source: document.querySelector('[aria-hidden].invisible canvas'), first: handle.snapshot(), frames: 0, drawn: new Map(), picked: [] };
    const paint = handle.paintAgent, activate = handle.activateWorldTarget;
    handle.paintAgent = (id, ctx, x, y, k, painter) => {
      const r = el.getBoundingClientRect();
      window.__worldTest.drawn.set(id, { x: x + r.left, y: y + r.top });
      window.__worldTest.frames++;
      return paint(id, ctx, x, y, k, painter);
    };
    handle.activateWorldTarget = (target) => { window.__worldTest.picked.push(target); return activate(target); };
  }, selector);
  return { page, canvas: page.locator(selector), maps: () => maps };
}

const state = (canvas) => canvas.evaluate((el) => Object.fromEntries(['yaw', 'tilt', 'zoom', 'focusX', 'focusY'].map((k) => [k, +el.dataset[k]])));
async function identity(page) {
  assert.deepEqual(await page.evaluate((s) => {
    const t = window.__worldTest, el = document.querySelector(s);
    let f = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))];
    while (f && !f.memoizedProps?.village?.current) f = f.return;
    return {
      canvas: t.el === el,
      handle: t.handle === f.memoizedProps.village.current,
      source: t.source === document.querySelector('[aria-hidden].invisible canvas'),
      sourceHidden: getComputedStyle(t.source.parentElement).visibility === 'hidden',
      worlds: document.querySelectorAll(s).length,
      session: JSON.parse(localStorage.getItem('gamine.session')).token,
    };
  }, selector), { canvas: true, handle: true, source: true, sourceHidden: true, worlds: 1, session: session.token });
}
async function nav(page, path) {
  const link = path === '/' ? page.getByRole('link', { name: 'Gamine home' }) : page.locator(`nav[aria-label="Sections"] a[href="${path}"]`);
  await link.click();
  // The SSE connection remains open; route commit and world identity are the assertions.
  await page.waitForURL((url) => url.pathname === path, { waitUntil: "commit", timeout: 60000 });
  await page.waitForTimeout(400);
  await identity(page);
}
async function drag(page, x, y, dx, dy, shift = false) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(1200);
}
const closeEnough = (before, after, keys = Object.keys(before)) => {
  for (const key of keys) assert.ok(Math.abs(before[key] - after[key]) < 0.002, `${key} changed: ${before[key]} -> ${after[key]}`);
};

try {
  const { page, canvas, maps } = await setup({ viewport: { width: 1440, height: 950 } });
  const initial = await state(canvas);
  // The world opens on its home view (world-camera.tsx HOME): yaw 18°, tilt 30°. Dragging up looks down more.
  assert.ok(Math.abs(initial.tilt - Math.PI / 6) < 0.002 && Math.abs(initial.yaw - Math.PI / 10) < 0.002, 'World did not open on its home view');
  await drag(page, 1290, 670, 90, -130);
  assert.notEqual((await state(canvas)).yaw, initial.yaw, 'Empty-ground rotation failed');
  assert.ok((await state(canvas)).tilt > initial.tilt, 'Tilt failed');
  await page.mouse.move(1290, 670); await page.mouse.wheel(0, -100); await page.waitForTimeout(800);
  assert.ok((await state(canvas)).zoom > initial.zoom, 'Wheel zoom failed');
  await drag(page, 1290, 670, 50, 20, true);
  const saved = await state(canvas);
  for (const path of ['/launch', '/explore']) {
    await nav(page, path); closeEnough(saved, await state(canvas));
    assert.ok(await page.getByRole('button', { name: 'Close the page and see the village' }).isVisible(), `${path} overlay closed`);
  }
  await nav(page, '/agent');
  await page.waitForFunction((s) => document.querySelector(s)?.dataset.following === 'world-shell-agent', selector);
  closeEnough(saved, await state(canvas), ['yaw', 'tilt']);
  assert.ok(await page.getByRole('complementary', { name: 'Your agent status' }).isVisible());
  await nav(page, '/games');
  // Stop the intentional owner-follow, then assert all ordinary transitions preserve focus too.
  await page.evaluate(() => window.__worldTest.handle.select(null, false));
  await page.waitForTimeout(300);
  const afterAgent = await state(canvas);
  for (const path of ['/live', '/ladder', '/rewards', '/about', '/', '/launch', '/games']) {
    await nav(page, path); closeEnough(afterAgent, await state(canvas));
  }
  await page.goBack({ waitUntil: 'commit' }); await page.waitForURL('**/launch', { waitUntil: 'commit' }); await identity(page); closeEnough(afterAgent, await state(canvas));
  await page.goForward({ waitUntil: 'commit' }); await page.waitForURL('**/games', { waitUntil: 'commit' }); await identity(page); closeEnough(afterAgent, await state(canvas));
  await page.getByRole('button', { name: 'Close the page and see the village' }).click();
  await page.getByRole('button', { name: 'Show the page', exact: true }).click();
  closeEnough(afterAgent, await state(canvas));
  // A wheel over exposed world margins scrolls the overlay; Ctrl-wheel zooms.
  await page.mouse.move(350, 650); await page.mouse.wheel(0, 120); await page.waitForTimeout(300);
  closeEnough(afterAgent, await state(canvas));
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control'); await page.waitForTimeout(500);
  assert.ok((await state(canvas)).zoom > afterAgent.zoom);
  await page.getByRole('button', { name: `Wallet ${owner}`, exact: true }).click();
  assert.ok(await page.getByRole('menu').isVisible());
  closeEnough(afterAgent, await state(canvas), ['yaw', 'tilt']);
  await page.keyboard.press('Escape');
  await nav(page, '/');
  await page.getByRole('link', { name: 'Find my agent', exact: true }).filter({ visible: true }).click();
  await page.waitForURL('**/agent', { waitUntil: 'commit' }); await identity(page);
  await page.waitForFunction((s) => document.querySelector(s)?.dataset.following === 'world-shell-agent', selector);
  await page.waitForTimeout(1500);
  const drawn = await page.evaluate(() => window.__worldTest.drawn.get('agent:world-shell-agent'));
  assert.ok(drawn, 'Owned agent was never painted');
  const followed = await state(canvas);
  await drag(page, drawn.x, drawn.y - 15, 40, 0);
  closeEnough(followed, await state(canvas), ['yaw', 'tilt']);
  assert.equal(await canvas.getAttribute('data-following'), resident.id, 'Object drag detached owner follow');
  const continuity = await page.evaluate(() => {
    const t = window.__worldTest, first = t.first.agents[0], last = t.handle.snapshot().agents[0];
    return { id: last.id, moved: Math.hypot(last.x - first.x, last.y - first.y), frames: t.frames };
  });
  assert.equal(maps(), 1, 'Navigation created another world engine');
  assert.ok(continuity.frames > 20 && continuity.moved > 0, 'Simulation did not continue');
  await page.screenshot({ path: '/tmp/gamine-global-world-agent.png' });

  const direct = await setup({ viewport: { width: 1440, height: 950 } }, '/launch');
  assert.ok(await direct.page.getByRole('heading', { name: 'Launch Pad', exact: true }).isVisible(), 'Direct Launch overlay missing');
  await identity(direct.page);
  await direct.page.screenshot({ path: '/tmp/gamine-global-world-launch.png' });

  const mobile = await setup({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, '/about');
  assert.ok(await mobile.page.getByRole('button', { name: 'Close the page and see the village' }).isVisible());
  await mobile.page.getByRole('button', { name: 'Close the page and see the village' }).click();
  const touch = await mobile.page.context().newCDPSession(mobile.page);
  const beforeTouch = await state(mobile.canvas);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 350, y: 400, id: 1 }] });
  for (let i = 1; i <= 10; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 350 - i * 6, y: 400 - i * 4, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.page.waitForTimeout(1000);
  assert.notEqual((await state(mobile.canvas)).yaw, beforeTouch.yaw, 'Touch rotation failed');
  const beforePinch = await state(mobile.canvas);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 260, y: 390, id: 1 }, { x: 330, y: 390, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: 390, id: 1 }, { x: 370, y: 390, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.page.waitForTimeout(700);
  assert.ok((await state(mobile.canvas)).zoom > beforePinch.zoom, 'Touch pinch failed');
  await mobile.page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await mobile.page.getByRole('navigation', { name: 'Pages', exact: true }).getByRole('link', { name: 'Games', exact: true }).click();
  await mobile.page.waitForURL('**/games', { waitUntil: 'commit' }); await identity(mobile.page);
  assert.equal(mobile.maps(), 1);
  await mobile.page.screenshot({ path: '/tmp/gamine-global-world-mobile.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, routes: ['World (/)', 'Launch', 'Explore', 'Agent', 'Games', 'Live', 'Ladder', 'Rewards', 'About'], mapLoads: maps(), continuity, errors }));
} finally {
  await browser.close();
}
