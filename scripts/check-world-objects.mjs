// BASE_URL=http://localhost:3000 node scripts/check-world-objects.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const base=process.env.BASE_URL??'http://localhost:3000', out=process.env.OBJECT_SHOTS??'/tmp/gamine-world-objects';
mkdirSync(out,{recursive:true}); const temporary=mkdtempSync(join(tmpdir(),'gamine-objects-')),helper=join(temporary,'helper.js');
const source=p=>JSON.stringify(fileURLToPath(new URL(p,import.meta.url)));
await build({stdin:{contents:[
 `export { renderProjectedWorld } from ${source('../web/app/village/game/projected-art.ts')};`,
 `export { fixedObjectGeometry, projectedObjectFaces } from ${source('../web/lib/world/object-geometry.ts')};`,
 `export { physicalKind, directionalAssetAudit } from ${source('../web/lib/world/object-appearance.ts')};`,
 `export { project } from ${source('../web/lib/world/projection.ts')};`,
 `export { worldPicker } from ${source('../web/app/village/game/projected-picking.ts')};`,
].join('\n'),resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,platform:'browser',format:'iife',globalName:'ObjectTest',define:{'process.env':'{}'},outfile:helper});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:950}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('gamine.sound','0');localStorage.setItem('gamine.cameraHelp','closed');});
 await page.route('**/*',route=>{
  const u=new URL(route.request().url()),headers={'access-control-allow-origin':'*'};
  if(u.pathname==='/field'&&route.request().resourceType()!=='document') return route.fulfill({json:{agents:Array.from({length:100},(_,i)=>({id:`object-test-${i}`,name:`Walker ${i}`,presetName:'Anchor',house:false,mark:null,retiredAt:null,worldActivity:null})),at:new Date().toISOString()},headers});
  if(u.pathname==='/live'&&route.request().headers().accept?.includes('text/event-stream')) return route.fulfill({body:'retry: 600000\n\nevent: hello\ndata: {"counters":{"matchesToday":0,"holders":100},"playMs":10000}\n\n',contentType:'text/event-stream',headers});
  if(/\/portrait|\/avatar/.test(u.pathname)) return route.fulfill({status:404,body:'',headers});
  return route.continue();
 });
 await page.goto(`${base}/?debugAgents=1`,{waitUntil:'domcontentloaded',timeout:90000});
 const canvas=page.locator('canvas[aria-label^="Explore the Gamine"]');await canvas.waitFor({timeout:60000});
 const enter=page.getByRole('button',{name:/enter world/i});if(await enter.count()) await enter.click();
 await page.waitForFunction(()=>window.__agentRenderDebug?.total===100,undefined,{timeout:60000});
 await page.addScriptTag({path:helper});await page.waitForTimeout(2000);
 await page.evaluate(()=>{
  const el=document.querySelector('canvas[aria-label^="Explore the Gamine"]');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.village?.current) f=f.return;
  window.__objectHandle=f.memoizedProps.village.current;window.__originalCanvas=el;
 });
 await page.screenshot({path:`${out}/town-front.png`});
 const inventory=await page.evaluate(()=>ObjectTest.directionalAssetAudit(window.__objectHandle.snapshot().world.objects));
 writeFileSync(`${out}/assets.json`,JSON.stringify(inventory,null,2));
 const audit=await page.evaluate(()=>{
  const snapshot=window.__objectHandle.snapshot(),kinds=['house','major-building','shop','market','sign','tower','tent','tree','bench','flag','lamp','fountain','launch-pad','arena'];
  const samples=kinds.map(kind=>snapshot.world.objects.find(o=>o.category!=='movement'&&o.category!=='agent'&&ObjectTest.physicalKind(o)===kind)).filter(Boolean);
  window.__objectSamples=samples;
  for(const o of samples.filter(o=>o.type!=='arena')) {
   const mesh=JSON.stringify(ObjectTest.fixedObjectGeometry(o));
   for(let i=0;i<=72;i++) {
    const faces=ObjectTest.projectedObjectFaces({yaw:i*Math.PI/36,tilt:.52},o);
    if(!faces.length||faces.some(f=>f.points.some(p=>!Number.isFinite(p.x+p.y)))) throw Error(`Invalid geometry ${o.id}`);
    if(mesh!==JSON.stringify(ObjectTest.fixedObjectGeometry(o))) throw Error(`Object rotates: ${o.id}`);
   }
  }
  return {kinds:samples.map(o=>ObjectTest.physicalKind(o)), missing:kinds.filter(k=>!samples.some(o=>ObjectTest.physicalKind(o)===k))};
 });
 console.log('Mesh orbit audit',audit);
 writeFileSync(`${out}/samples.json`,JSON.stringify(await page.evaluate(()=>window.__objectSamples.map(o=>({object:o,frame:o.metadata?.art?(()=>{const f=window.__objectHandle.snapshot().art(o.metadata.art);return f&&{width:f.width,height:f.height,content:f.content};})():null}))),null,2));
 assert.deepEqual(audit.missing,[]);
 // Actual camera gestures through all four sides and back to the front.
 const instances=await page.evaluate(()=>Object.fromEntries(window.__agentRenderDebug.agents.map(a=>[a.id,a.source.instance])));
 for(const [name,targetYaw] of (process.env.OBJECT_REVIEW_ONLY==='1' ? [] : [['south',0],['west',-Math.PI/2],['north',-Math.PI],['east',-Math.PI*1.5],['south-again',-Math.PI*2]])) {
  for(let attempt=0;attempt<8;attempt++) {
   const gesture=await page.evaluate(({targetYaw,attempt})=>{
    const el=window.__originalCanvas,r=el.getBoundingClientRect(),debug=window.__agentRenderDebug,cam=debug.camera;
    let delta=(cam.yaw-targetYaw)/.006;delta=Math.max(-280,Math.min(280,delta));
    const picker=ObjectTest.worldPicker(cam,window.__objectHandle.snapshot().world.objects,cam,r.width,r.height,window.__objectHandle.snapshot().art);
    for(let y=130+(attempt%2)*20;y<r.height-190;y+=45) for(let x=70+(attempt%3)*15;x<r.width-60;x+=45) {
     if(x+delta<30||x+delta>r.width-30||picker({x,y})||document.elementFromPoint(r.left+x,r.top+y)!==el) continue;
     if(debug.agents.some(a=>Math.abs(a.screenX-x)<35&&y>a.screenY-100&&y<a.screenY+20)) continue;
     return {x:r.left+x,y:r.top+y,dx:delta};
    }
    return null;
   },{targetYaw,attempt});
   assert.ok(gesture,'No free ground for orbit gesture');
   if(Math.abs(gesture.dx)<8) break;
   await page.mouse.move(gesture.x,gesture.y);await page.mouse.down();await page.mouse.move(gesture.x+gesture.dx,gesture.y,{steps:12});await page.mouse.up();await page.waitForTimeout(800);
  }
  const yaw=+(await canvas.getAttribute('data-yaw'));assert.ok(Math.abs(yaw-targetYaw)<.07,`Orbit ${name}: ${yaw}`);
  await page.screenshot({path:`${out}/town-${name}.png`});
  const state=await page.evaluate(()=>({instances:Object.fromEntries(window.__agentRenderDebug.agents.map(a=>[a.id,a.source.instance])),fallbacks:window.__agentRenderDebug.fallbacks}));
  assert.deepEqual(state.instances,instances);assert.equal(state.fallbacks,0);
  console.log(name,'physical orientation and agent identities preserved');
 }
 // Review actual artwork and fallback volumes side-by-side without changing the live model/layout.
 await page.evaluate(()=>{
  const snapshot=window.__objectHandle.snapshot(),sheet=document.createElement('div');sheet.id='object-sheet';
  sheet.style='position:absolute;top:0;left:0;width:1440px;z-index:999999;background:#233724;color:#f2db9b;font:13px monospace;display:grid;grid-template-columns:repeat(4,360px)';document.body.append(sheet);
  for(const o of window.__objectSamples) for(const [label,yaw] of [['Front',0],['Left',-Math.PI/2],['Back',Math.PI],['Right',Math.PI/2]]) {
   const cell=document.createElement('div');cell.style='height:250px;border:1px solid #60704d;padding:6px;box-sizing:border-box';
   const text=document.createElement('div');text.textContent=`${ObjectTest.physicalKind(o)} · ${o.metadata?.label??o.metadata?.art?.key??o.id} · ${label}`;cell.append(text);
   const c=document.createElement('canvas');c.width=344;c.height=215;cell.append(c);sheet.append(cell);
   const view={yaw,tilt:.52},frame=o.metadata?.art&&snapshot.art(o.metadata.art);
   const points=o.type==='arena' ? [{x:-o.width/2,y:-o.height},{x:o.width/2,y:o.depth/2}].map(p=>({x:ObjectTest.project(view,o).x+p.x,y:ObjectTest.project(view,o).y+p.y})) : ObjectTest.projectedObjectFaces(view,o,frame??undefined).flatMap(f=>f.points);
   const x0=Math.min(...points.map(p=>p.x)),x1=Math.max(...points.map(p=>p.x)),y0=Math.min(...points.map(p=>p.y)),y1=Math.max(...points.map(p=>p.y));
   const p={x:(x0+x1)/2,y:(y0+y1)/2},scale=Math.min(1.15,280/Math.max(1,x1-x0),170/Math.max(1,y1-y0));
   ObjectTest.renderProjectedWorld(c.getContext('2d'),{...snapshot.world,bounds:{x0:o.x-500,y0:o.y-500,x1:o.x+500,y1:o.y+500},objects:[o]},view,{x:p.x,y:p.y,scale},344,215,undefined,{art:snapshot.art});
  }
 });
 const visibleSamples=await page.evaluate(()=>[...document.querySelectorAll('#object-sheet canvas')].map((c,i)=>{
  const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let count=0;for(let p=0;p<pixels.length;p+=4) if(pixels[p]!==pixels[0]||pixels[p+1]!==pixels[1]||pixels[p+2]!==pixels[2]) count++;
  return {sample:i,count};
 }));
 assert.ok(visibleSamples.every(s=>s.count>5),'A representative object face was not painted');
 await page.locator('#object-sheet').screenshot({path:`${out}/object-faces.png`});
 assert.deepEqual(errors,[]);
 console.log(`PASS: ${process.env.OBJECT_REVIEW_ONLY==='1'?'isolated object previews':'full 360-degree camera orbit'}, object-aware fixed geometry, ${audit.kinds.length} physical categories, 100 stable agents. Report and screenshots: ${out}`);
} finally {await browser.close();rmSync(temporary,{recursive:true,force:true});}
