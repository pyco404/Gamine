// BASE_URL=http://localhost:3000 node scripts/check-asset-consistency.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://localhost:3000', out = '/tmp/gamine-asset-consistency';
mkdirSync(out, { recursive: true });
const helper = await build({ stdin: { contents: `
 export {physicalKind, directionalAssetAudit} from './web/lib/world/object-appearance.ts';
 export {solidVegetationLayer, solidRevision} from './web/app/village/game/solid-renderer.ts';
 export {TREE_KINDS, solidMesh} from './web/lib/world/solid-models.ts';
 export {worldObject} from './web/lib/world/model.ts';
 export {worldPerformance} from './web/lib/world/render-performance.ts';
 export {worldPicker} from './web/lib/world/picking.ts';
`, resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'iife', globalName: 'Consistency', define: { 'process.env': '{}' }, write: false });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }), errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(() => { localStorage.setItem('gamine.sound', '0'); localStorage.setItem('gamine.cameraHelp', 'closed'); });
 await page.route('**/*', r => {
  const u = new URL(r.request().url()), headers = { 'access-control-allow-origin': '*' };
  if (u.pathname === '/field' && r.request().resourceType() !== 'document') return r.fulfill({ json: { agents: Array.from({ length: 100 }, (_, i) => ({ id: `consistency-${i}`, name: `Walker ${i}`, presetName: 'Anchor', house: false, mark: null, retiredAt: null, worldActivity: null })), at: new Date().toISOString() }, headers });
  if (u.pathname === '/live' && r.request().headers().accept?.includes('text/event-stream')) return r.fulfill({ body: 'retry: 600000\n\nevent: hello\ndata: {"counters":{"matchesToday":0,"holders":100},"playMs":10000}\n\n', contentType: 'text/event-stream', headers });
  if (/\/portrait|\/avatar/.test(u.pathname)) return r.fulfill({ status: 404, body: '', headers });
  return r.continue();
 });
 console.log('Loading the live village');
 await page.goto(`${base}/?debugWorldPerf=1&debugAgents=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
 const canvas = page.locator('canvas[aria-label^="Explore the Gamine"]'); await canvas.waitFor({ timeout: 60000 });
 const enter = page.getByRole('button', { name: /enter world/i }); if (await enter.count()) await enter.click();
 await page.waitForFunction(() => window.__worldRenderPerf?.totals.activeAgents >= 100, undefined, { timeout: 60000 });
 await page.evaluate(() => {
  const el = document.querySelector('canvas[aria-label^="Explore the Gamine"]');
  let f = el[Object.keys(el).find(k => k.startsWith('__reactFiber'))]; while (f && !f.memoizedProps?.village?.current) f = f.return;
  window.__consistencyHandle = f.memoizedProps.village.current;
 });
 await page.waitForFunction(() => !window.__consistencyHandle.snapshot().forestPending, undefined, { timeout: 60000 });
 await page.addScriptTag({ content: helper.outputFiles[0].text });
 await page.waitForFunction(() => Consistency.solidRevision() > 0);
 const audit = await page.evaluate(() => {
  const world = window.__consistencyHandle.snapshot().world;
  window.__consistencyWorld = world;
  const relevant = new Set(['house','major-building','market','shop','tower','tent','tree','shrub']);
  const remaining = world.objects.filter(o => relevant.has(Consistency.physicalKind(o)) && !o.solid);
  const counts = {}, trees = new Set();
  for (const o of world.objects) if (o.solid) { counts[o.solid] = (counts[o.solid] ?? 0) + 1; if (o.solid.startsWith('tree')) trees.add(o.solid); }
  const started = performance.now();
  const picker = Consistency.worldPicker({yaw:0,tilt:.55},world.objects,{x:1400,y:400,scale:.5},1440,1050);
  for (let i=0;i<50;i++) picker({x:i*27,y:400});
  return { objects: world.objects.length, counts, treeVariants: [...trees], pickingMs: performance.now()-started, remaining: remaining.map(o => ({id:o.id,key:o.metadata?.art?.key})),
   oldFrontPlanes: Consistency.directionalAssetAudit(world.objects).filter(o => o.fallback.startsWith('fixed front plane')),
   arena: world.objects.find(o => o.type === 'arena') };
 });
 assert.deepEqual(audit.remaining, []); assert.deepEqual(audit.oldFrontPlanes, []);
 assert.equal(audit.treeVariants.length, 7); assert.equal(audit.arena.solid, undefined);
 console.log('World audit', JSON.stringify(audit));
 for (const [name, yaw, tilt] of [['front',0,.55],['left',-Math.PI/2,.55],['back',Math.PI,.55],['right',Math.PI/2,.55],['high',Math.PI/4,.95]]) {
  await page.evaluate(({yaw,tilt}) => window.__worldPerfCamera(yaw,tilt), {yaw,tilt});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/world-${name}.png` });
  assert.equal(await page.evaluate(() => window.__consistencyWorld === window.__consistencyHandle.snapshot().world), true);
 }
 console.log('World rotation passed; rendering the shared tree family');
 const templates = await page.evaluate(() => {
  const sheet = document.createElement('div'); sheet.id = 'tree-family';
  sheet.style = 'position:absolute;top:0;left:0;z-index:999999;display:grid;grid-template-columns:repeat(4,340px);background:#d8e3c4;color:#222;font:14px sans-serif'; document.body.append(sheet);
  Consistency.worldPerformance.enabled = true;
  for (const [name, yaw] of [['Front',0],['Side',Math.PI/2],['Back',Math.PI],['Diagonal',Math.PI/4]]) {
   for (const kind of Consistency.TREE_KINDS) {
    const cell = document.createElement('div'), title = document.createElement('div'); title.textContent = `${kind} · ${name}`;
    const c = document.createElement('canvas'); c.width = 330; c.height = 270; const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    cell.append(title,c); sheet.append(cell);
    const o = Consistency.worldObject(kind, 'tree', 0,0,192,96,192); o.solid = kind; o.metadata = { topAnchor: {x:0,y:0} };
    const p = Consistency.solidVegetationLayer(ctx,{yaw,tilt:.55},o), b = p.bounds;
    p.drawScreen({x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2,scale:Math.min(310/(b.x1-b.x0),250/(b.y1-b.y0))},330,270);
    if (!ctx.getImageData(0,0,330,270).data.some((v,i)=>i%4===3 && v>0)) throw Error(`Blank ${kind}`);
    // Many additional instances at a stationary pose must never re-render templates or upload meshes.
    const before = { ...Consistency.worldPerformance.totals };
    for (let i=0;i<100;i++) Consistency.solidVegetationLayer(ctx,{yaw,tilt:.55},{...o,x:i,y:i,metadata:{topAnchor:{x:i,y:i}}});
    for (const counter of ['treeTemplateRenders','solidReads','solidUploads']) if ((before[counter]??0)!==(Consistency.worldPerformance.totals[counter]??0)) throw Error(`Per-instance ${counter}`);
   }
  }
  return {counts:Consistency.worldPerformance.totals,meshes:Consistency.TREE_KINDS.map(k=>({kind:k,triangles:Consistency.solidMesh(k).triangles}))};
 });
 assert.equal(templates.counts.treeTemplateRenders, 32);
 await page.locator('#tree-family').screenshot({ path: `${out}/tree-family.png` });
 assert.deepEqual(errors, []);
 writeFileSync(`${out}/audit.json`, JSON.stringify({audit,templates,errors},null,2));
 console.log(`PASS: complete solid world coverage, all seven tree families, camera rotation, shared template rendering. Previews: ${out}`);
} finally { await browser.close(); }
