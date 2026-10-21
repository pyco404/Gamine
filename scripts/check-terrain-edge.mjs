// BASE_URL=http://localhost:3000 node scripts/check-terrain-edge.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://localhost:3000', out = '/tmp/gamine-perimeter-review';
mkdirSync(out, { recursive: true });
const helper = await build({ stdin: { contents: `
 export {renderProjectedWorld} from './web/app/village/game/projected-art.ts';
 export {drawTerrainEdge} from './web/app/village/game/terrain-edge.ts';
 export {terrainEdge} from './web/lib/world/terrain-edge.ts';
 export {project,unprojectGround,projectedBounds,frameProjection} from './web/lib/world/projection.ts';
 export {solidRevision} from './web/app/village/game/solid-renderer.ts';
`, resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'iife', globalName: 'Edge', define: { 'process.env': '{}' }, write: false });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
 const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(() => { localStorage.setItem('gamine.sound','0'); localStorage.setItem('gamine.cameraHelp','closed'); });
 await page.route('**/*', r => {
  const u = new URL(r.request().url()), headers = { 'access-control-allow-origin':'*' };
  if(u.pathname === '/field' && r.request().resourceType() !== 'document') return r.fulfill({ json:{agents:[],at:new Date().toISOString()},headers });
  if(u.pathname === '/live' && r.request().headers().accept?.includes('text/event-stream')) return r.fulfill({body:'retry: 600000\n\nevent: hello\ndata: {"counters":{"matchesToday":0,"holders":0},"playMs":10000}\n\n',contentType:'text/event-stream',headers});
  return r.continue();
 });
 await page.goto(`${base}/?debugWorldPerf=1`, { waitUntil:'domcontentloaded', timeout:90000 });
 await page.locator('canvas[aria-label^="Explore the Gamine"]').waitFor({timeout:60000});
 const enter = page.getByRole('button',{name:/enter world/i}); if(await enter.count()) await enter.click();
 await page.evaluate(() => {
  const el = document.querySelector('canvas[aria-label^="Explore the Gamine"]'); let f = el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];
  while(f && !f.memoizedProps?.village?.current) f=f.return;
  window.__edgeHandle=f.memoizedProps.village.current;
 });
 await page.waitForFunction(()=>window.__edgeHandle.snapshot().ground && !window.__edgeHandle.snapshot().forestPending,undefined,{timeout:60000});
 await page.addScriptTag({content:helper.outputFiles[0].text}); await page.waitForFunction(()=>Edge.solidRevision()>0);
 const results = await page.evaluate(() => {
  const snapshot=window.__edgeHandle.snapshot(), world=snapshot.world, ground=snapshot.ground;
  const original=JSON.stringify({bounds:world.bounds,objects:world.objects,map:world.map}), image=ground.image;
  const sheet=document.createElement('div'); sheet.id='edge-review'; sheet.style='position:absolute;left:0;top:0;z-index:999999;background:#171c25;color:#eee;font:18px sans-serif'; document.body.append(sheet);
  const canvas=document.createElement('canvas'); canvas.id='edge-canvas'; canvas.width=1600; canvas.height=1000; sheet.append(canvas);
  const ctx=canvas.getContext('2d');
  function draw(view,camera,structures=true) {
   const parts=[]; Edge.renderProjectedWorld(ctx,structures?world:{...world,objects:[]},view,camera,1600,1000,undefined,{ground,art:snapshot.art},p=>parts.push(p));
   for(const p of parts.sort((a,b)=>a.depth-b.depth)) {ctx.save(); if(p.drawScreen) p.drawScreen(camera,1600,1000); else {ctx.translate(800,500);ctx.scale(camera.scale,camera.scale);ctx.translate(-camera.x,-camera.y);p.draw();}ctx.restore();}
  }
  window.__edgeDraw=draw;
  const checks=[];
  for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2,Math.PI/4]) {
   const view={yaw,tilt:.55}, camera=Edge.frameProjection(view,world.bounds,1600,1000,world.slabDepth,'overview'); draw(view,camera,false);
   const actual=ctx.getImageData(0,0,1600,1000).data;
   const reference=document.createElement('canvas'); reference.width=1600;reference.height=1000; const g=reference.getContext('2d');g.imageSmoothingEnabled=false;
   const origin=Edge.project(view,{x:0,y:0}),x=Edge.project(view,{x:1,y:0}),y=Edge.project(view,{x:0,y:1});
   g.translate(800,500);g.scale(camera.scale,camera.scale);g.translate(-camera.x,-camera.y);g.transform(x.x-origin.x,x.y-origin.y,y.x-origin.x,y.y-origin.y,origin.x,origin.y);g.drawImage(image,ground.x0,ground.y0,ground.width,ground.height);
   const expected=g.getImageData(0,0,1600,1000).data; let checked=0;
   for(let sy=0;sy<1000;sy+=3) for(let sx=0;sx<1600;sx+=3) {
    const p=Edge.unprojectGround(view,{x:(sx-800)/camera.scale+camera.x,y:(sy-500)/camera.scale+camera.y}), b=world.bounds;
    if(p.x<b.x0+40||p.x>b.x1-40||p.y<b.y0+40||p.y>b.y1-40)continue;
    const at=(sy*1600+sx)*4; for(let k=0;k<4;k++)if(actual[at+k]!==expected[at+k])throw Error(`Top surface changed at ${yaw}/${sx}/${sy}`); checked++;
   }
   checks.push({yaw,unchangedTopSamples:checked});
  }
  const mesh=Edge.terrainEdge(world.bounds,world.slabDepth), times=[];
  // Measure just the new perimeter bake, including projection, sort and rasterization.
  for(let i=0;i<80;i++) {ctx.clearRect(0,0,1600,1000);ctx.save();ctx.translate(800,500);ctx.scale(.18,.18);ctx.translate(-1400,-400);
   const started=performance.now();Edge.drawTerrainEdge(ctx,{yaw:i*Math.PI/40,tilt:.55},world.bounds,world.slabDepth,ground);times.push(performance.now()-started);ctx.restore();}
  if(original!==JSON.stringify({bounds:world.bounds,objects:world.objects,map:world.map}))throw Error('World mutated');
  const sorted=times.slice(5).sort((a,b)=>a-b);
  return {checks,segments:mesh.segments,triangles:mesh.faces.length,rockTriangles:mesh.faces.filter(f=>f.material==='rock').length,
   edgeBakeMs:{mean:sorted.reduce((a,b)=>a+b,0)/sorted.length,p95:sorted[Math.floor(sorted.length*.95)]},objects:world.objects.length,worldUnchanged:true};
 });
 for(const [name,yaw,tilt] of [['diagonal',Math.PI/4,.55],['front',0,.55],['back',Math.PI,.55],['side',Math.PI/2,.55]]) {
  await page.evaluate(({yaw,tilt})=>{const s=window.__edgeHandle.snapshot(),v={yaw,tilt};window.__edgeDraw(v,Edge.frameProjection(v,s.world.bounds,1600,1000,s.world.slabDepth,'overview'));},{yaw,tilt});
  await page.locator('#edge-canvas').screenshot({path:`${out}/world-${name}.png`});
 }
 await page.evaluate(()=>{const s=window.__edgeHandle.snapshot(),b=s.world.bounds,v={yaw:Math.PI/4,tilt:.4},p=Edge.project(v,{x:b.x1-350,y:b.y1-350},-35);window.__edgeDraw(v,{x:p.x,y:p.y,scale:.85});});
 await page.locator('#edge-canvas').screenshot({path:`${out}/corner.png`});
 assert.deepEqual(errors,[]);writeFileSync(`${out}/audit.json`,JSON.stringify({...results,errors},null,2));console.log(JSON.stringify(results,null,2));
 console.log(`PASS: top pixels and world data unchanged across five angles. Previews: ${out}`);
} finally {await browser.close();}
