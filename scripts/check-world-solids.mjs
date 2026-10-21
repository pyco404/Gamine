// BASE_URL=http://localhost:3000 node scripts/check-world-solids.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const out = '/tmp/gamine-solid-review';
mkdirSync(out, { recursive: true });
const helper = await build({ stdin: { contents: `
  export {solidLayer, solidRevision} from './web/app/village/game/solid-renderer.ts';
  export {worldObject} from './web/lib/world/model.ts';
  export {TREE_KINDS} from './web/lib/world/solid-models.ts';
`, resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'iife', globalName: 'Solids', define: { 'process.env': '{}' }, write: false });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/__solid-check', r => r.fulfill({ contentType: 'text/html', body: '<html><head><meta charset="utf-8"></head><body style="background:#d8e3c4;font:14px sans-serif"><h1>3D building families — front, side, back, other side</h1></body></html>' }));
  await page.goto(`${base}/__solid-check`);
  // Exercise multiple cache pages and the high-DPI fallback on a deliberately small GPU limit.
  await page.evaluate(() => {
    const get = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(p) {
      if (p === this.MAX_VIEWPORT_DIMS) return new Int32Array([512, 512]);
      if (p === this.MAX_RENDERBUFFER_SIZE) return 512;
      return get.call(this, p);
    };
  });
  await page.addScriptTag({ content: helper.outputFiles[0].text });
  assert.deepEqual(errors, []);
  await page.waitForFunction(() => Solids.solidRevision() > 0);
  const results = await page.evaluate(() => {
    const kinds = ['cottage', 'redCottage', 'townhouse', 'workshop', 'stall', 'redStall', 'hall', 'board',
      'tower', 'shed', 'tent', 'bazaar', 'hiringBoard', 'strategyBoard', 'scoreBoard', 'waypost', 'mushroom', ...Solids.TREE_KINDS, 'shrub'];
    function pending(kind, yaw, ratio = 1, scale = 1.6, size = 1, mirror = false) {
      const canvas = document.createElement('canvas'); canvas.width = 240 * ratio; canvas.height = 210 * ratio;
      const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.imageSmoothingEnabled = false;
      const object = Solids.worldObject(kind, 'building', 0, 0, 80, 50, 80);
      object.solid = kind; object.solidVariant = { size, mirror, tone: 0, plants: 0 };
      object.metadata = { topAnchor: { x: 0, y: 0 } };
      const layer = Solids.solidLayer(ctx, { yaw, tilt: .55 }, object);
      if (!layer) throw Error(`Missing solid layer: ${kind}`);
      const camera = { x: 0, y: -45, scale };
      return { canvas, ctx, draw: () => layer.drawScreen(camera, 240, 210) };
    }
    const pixels = p => p.ctx.getImageData(0, 0, p.canvas.width, p.canvas.height).data;
    const specs = kinds.flatMap(kind => [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(yaw => [kind, yaw]));
    // Every model occupies the same screen rectangle; a shared screen cache would contaminate them.
    const batch = specs.map(([kind, yaw]) => pending(kind, yaw));
    batch.forEach(p => p.draw());
    const originals = batch.map(pixels);
    const results = specs.map(([kind, yaw], i) => {
      const alone = pending(kind, yaw); alone.draw(); const single = pixels(alone);
      let ink = 0, different = 0;
      for (let j = 0; j < single.length; j++) {
        if (j % 4 === 3 && single[j]) ink++;
        if (single[j] !== originals[i][j]) different++;
      }
      if (ink < 100) throw Error(`Blank render: ${kind}, ${yaw}`);
      // Changing atlas dimensions slightly changes GPU edge rounding. Allow at most 0.1% of
      // channel values; a neighbour leaking into a layer changes whole faces, not a few edges.
      if (different > single.length * .001) throw Error(`Neighbour pixels leaked into ${kind}, ${yaw}: ${different}`);
      const label = document.createElement('div'); label.textContent = `${kind} · ${Math.round(yaw * 180 / Math.PI)}°`;
      const card = document.createElement('div'); card.append(label, batch[i].canvas); card.style.display = 'inline-block'; document.body.append(card);
      return { kind, yaw, ink, different };
    });
    for (const ratio of [1.25, 2, 3]) {
      const full = pending('hall', 0, ratio, 100); full.draw();
      if (!pixels(full).some((value, i) => i % 4 === 3 && value > 0)) throw Error(`Screen-filling model dropped at DPR ${ratio}`);
    }
    const mirrored = pending('redCottage', 0, 1, 1.6, 1.4, true); mirrored.draw();
    if (!pixels(mirrored).some((value, i) => i % 4 === 3 && value > 0)) throw Error('Missing mirrored variant');
    return results;
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/families.png`, fullPage: true });
  console.log(`Passed ${results.length} family/direction renders, isolated cache pages, mirrored variant, and screen-filling DPR 1.25/2/3. Preview: ${out}/families.png`);
} finally {
  await browser.close();
}
