// BASE_URL=http://localhost:3002 PROFILE_TAG=before node scripts/profile-world-rotation.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const base=process.env.BASE_URL??'http://localhost:3002',tag=process.env.PROFILE_TAG??'profile',out='/tmp/gamine-rotation-profile';
const counts=(process.env.AGENT_COUNTS??'100,1000').split(',').map(Number),cycles=+(process.env.ROTATION_CYCLES??3);
mkdirSync(out,{recursive:true});
const temp=mkdtempSync(join(tmpdir(),'gamine-profile-')),helper=join(temp,'helper.js');
await build({stdin:{contents:`export {placeResidents} from ${JSON.stringify(fileURLToPath(new URL('../web/app/village/residents.ts',import.meta.url)))};`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'PerfTest',outfile:helper});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const results=[];
try {
 for(const count of counts) {
  const page=await browser.newPage({viewport:{width:1440,height:950}}),errors=[];let textureLoads=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.resourceType()==='image')textureLoads++;});
  let fields=Array.from({length:count},(_,i)=>({id:`profile-${i}`,name:`Walker ${i}`,presetName:'Anchor',mark:null,house:false,retiredAt:null,worldActivity:null}));
  await page.addInitScript(()=>{localStorage.setItem('gamine.sound','0');localStorage.setItem('gamine.cameraHelp','closed');});
  await page.route('**/*',route=>{
   const u=new URL(route.request().url()),headers={'access-control-allow-origin':'*'};
   if(u.pathname==='/field'&&route.request().resourceType()!=='document')return route.fulfill({json:{agents:fields,at:new Date().toISOString()},headers});
   if(u.pathname==='/live'&&route.request().headers().accept?.includes('text/event-stream'))return route.fulfill({body:'retry: 600000\n\nevent: hello\ndata: {"counters":{"matchesToday":0,"holders":1000},"playMs":10000}\n\n',contentType:'text/event-stream',headers});
   if(/\/portrait|\/avatar/.test(u.pathname))return route.fulfill({status:404,body:'',headers});
   return route.continue();
  });
  await page.goto(`${base}/?debugWorldPerf=1`,{waitUntil:'domcontentloaded',timeout:90000});
  const canvas=page.locator('canvas[aria-label^="Explore the Gamine"]');await canvas.waitFor({timeout:60000});
  const enter=page.getByRole('button',{name:/enter world/i});if(await enter.count())await enter.click();
  await page.waitForFunction(n=>window.__worldRenderPerf?.totals.activeAgents>=n,count,{timeout:60000});
  await page.addScriptTag({path:helper});
  fields=await page.evaluate(fields=>{
   const el=document.querySelector('canvas[aria-label^="Explore the Gamine"]');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.village?.current)f=f.return;
   const h=f.memoizedProps.village.current;window.__perfHandle=h;window.__perfCanvas=el;
   const roads=h.snapshot().world.map.paths.filter(p=>p.points.length>=3),now=Date.now(),received=performance.now();
   const moving=fields.map((a,i)=>{
    const route=roads[i%roads.length].points.map(([x,y])=>({x,y})),path=[...route,...route.slice(0,-1).reverse()],startedAt=now-i%40*350;
    return {...a,worldReceivedAt:received,worldActivity:{at:now,revision:`profile-${i}`,position:path[0],motion:{path,startedAt,endsAt:startedAt+600000},state:{activity:'exploration',phase:'traveling',destinationId:null,destination:'Road profile',route:'Road circuit',startedAt,completesAt:startedAt+600000,progress:0}}};
   });h.setResidents(PerfTest.placeResidents(moving,[]));return moving;
  },fields);
  await page.waitForFunction(()=>!window.__perfHandle.snapshot().forestPending,undefined,{timeout:60000});await page.waitForTimeout(2000);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
  const memory=async()=>{await cdp.send('HeapProfiler.collectGarbage');const {metrics}=await cdp.send('Performance.getMetrics');const values=Object.fromEntries(metrics.map(x=>[x.name,x.value]));return {heap:values.JSHeapUsedSize,nodes:values.Nodes,layouts:values.LayoutCount,styles:values.RecalcStyleCount};};
  const initialMemory=await memory(),initialLoads=textureLoads;
  const before=await page.evaluate(()=>({totals:{...window.__worldRenderPerf.totals},world:window.__perfHandle.snapshot().world,agents:window.__perfHandle.snapshot().agents.map(a=>({id:a.id,x:a.x,y:a.y,instance:window.__perfHandle.inspectAgent(a.id)?.instance}))}));
  await page.evaluate(()=>{window.__worldRenderPerf.frames.length=0;window.__perfWorld=window.__perfHandle.snapshot().world;window.__perfObjects=[...window.__perfWorld.objects];});
  const memories=[initialMemory],cycleTimes=[];await cdp.send('Profiler.start');
  for(let cycle=0;cycle<cycles;cycle++) {
   const duration=await page.evaluate(async cycle=>{
    const start=performance.now(),yaw=+window.__perfCanvas.dataset.yaw;
    for(let i=1;i<=72;i++){window.__worldPerfCamera(yaw+i*Math.PI/36);await new Promise(r=>setTimeout(r,35));}
    return performance.now()-start;
   },cycle);
   cycleTimes.push(duration);memories.push(await memory());
   console.log(tag,count,'cycle',cycle+1,'ms',Math.round(duration),'heap MB',Math.round(memories.at(-1).heap/1048576));
  }
  const {profile}=await cdp.send('Profiler.stop');writeFileSync(`${out}/${tag}-${count}.cpuprofile`,JSON.stringify(profile));
  const after=await page.evaluate(()=>({frames:window.__worldRenderPerf.frames,totals:window.__worldRenderPerf.totals,worldStable:window.__perfWorld===window.__perfHandle.snapshot().world,objectsStable:window.__perfObjects.every((o,i)=>o===window.__perfHandle.snapshot().world.objects[i]),agents:window.__perfHandle.snapshot().agents.map(a=>({id:a.id,x:a.x,y:a.y,instance:window.__perfHandle.inspectAgent(a.id)?.instance}))}));
  const quantile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]??0;
  const mean=values=>values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);
  const stages={};for(const f of after.frames)for(const [key,value]of Object.entries(f.stages))(stages[key]??=[]).push(value);
  const delta=Object.fromEntries(Object.entries(after.totals).map(([k,v])=>[k,v-(before.totals[k]??0)]));
  const result={tag,count,cycles,worldObjects:before.world.objects.length,trees:before.world.objects.filter(o=>o.type==='tree').length,frames:after.frames.length,frameMs:{mean:mean(after.frames.map(f=>f.ms)),median:quantile(after.frames.map(f=>f.ms),.5),p95:quantile(after.frames.map(f=>f.ms),.95),max:Math.max(...after.frames.map(f=>f.ms))},paintIntervalMs:{mean:mean(after.frames.map(f=>f.interval)),p95:quantile(after.frames.map(f=>f.interval),.95),max:Math.max(...after.frames.map(f=>f.interval))},stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,{mean:mean(v),max:Math.max(...v)}])),delta,textureLoads:textureLoads-initialLoads,cycleTimes,memories,worldStable:after.worldStable,objectsStable:after.objectsStable,instancesStable:after.agents.every((a,i)=>a.instance===before.agents[i]?.instance),movingAgents:after.agents.filter((a,i)=>Math.hypot(a.x-before.agents[i].x,a.y-before.agents[i].y)>1).length,errors};
  results.push(result);writeFileSync(`${out}/${tag}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(result));
  assert.equal(result.worldStable,true);assert.equal(result.objectsStable,true);assert.equal(result.instancesStable,true);assert.equal(result.textureLoads,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:`${out}/${tag}-${count}.png`});await page.close();
 }
}finally{await browser.close();rmSync(temp,{recursive:true,force:true});}
