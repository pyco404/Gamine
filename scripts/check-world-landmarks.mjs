// BASE_URL=http://localhost:3000 node scripts/check-world-landmarks.mjs
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const base=process.env.BASE_URL??'http://localhost:3000',out='/tmp/gamine-landmark-review';mkdirSync(out,{recursive:true});
const helper=await build({stdin:{contents:`
 export {renderProjectedWorld} from './web/app/village/game/projected-art.ts';
 export {project} from './web/lib/world/projection.ts';
 export {solidRevision} from './web/app/village/game/solid-renderer.ts';
 export {solidMesh} from './web/lib/world/solid-models.ts';
`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'Landmarks',define:{'process.env':'{}'},write:false});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('gamine.sound','0');localStorage.setItem('gamine.cameraHelp','closed');});
 await page.route('**/*',r=>{const u=new URL(r.request().url()),headers={'access-control-allow-origin':'*'};
  if(u.pathname==='/field'&&r.request().resourceType()!=='document')return r.fulfill({json:{agents:[],at:new Date().toISOString()},headers});
  if(u.pathname==='/live'&&r.request().headers().accept?.includes('text/event-stream'))return r.fulfill({body:'retry: 600000\n\nevent: hello\ndata: {"counters":{"matchesToday":0,"holders":0},"playMs":10000}\n\n',contentType:'text/event-stream',headers});return r.continue();});
 await page.goto(`${base}/?debugWorldPerf=1`,{waitUntil:'domcontentloaded',timeout:90000});await page.locator('canvas[aria-label^="Explore the Gamine"]').waitFor({timeout:60000});
 const enter=page.getByRole('button',{name:/enter world/i});if(await enter.count())await enter.click();
 await page.evaluate(()=>{const el=document.querySelector('canvas[aria-label^="Explore the Gamine"]');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.village?.current)f=f.return;window.__landmarkHandle=f.memoizedProps.village.current;});
 await page.waitForFunction(()=>window.__landmarkHandle.snapshot().ground&&!window.__landmarkHandle.snapshot().forestPending,undefined,{timeout:60000});
 await page.addScriptTag({content:helper.outputFiles[0].text});await page.waitForFunction(()=>Landmarks.solidRevision()>0);
 const audit=await page.evaluate(()=>{
  const s=window.__landmarkHandle.snapshot(),arena=s.world.objects.find(o=>o.type==='arena'),mountain=s.world.objects.find(o=>o.solid==='mountain');
  if(!arena||!mountain)throw Error('Missing landmark');window.__landmarkInitial=JSON.stringify([arena,mountain,s.world.bounds]);
  const c=document.createElement('canvas');c.id='landmark-review';c.width=1600;c.height=1000;c.style='position:absolute;left:0;top:0;z-index:999999;background:#171c25';document.body.append(c);
  window.__landmarkDraw=(name,yaw)=>{
   const view={yaw,tilt:.55},o=name==='arena'?arena:mountain;
   const at=Landmarks.project(view,o,name==='arena'?20:140),camera={x:at.x,y:at.y,scale:name==='arena'?1.65:2.4},ctx=c.getContext('2d'),parts=[];
   Landmarks.renderProjectedWorld(ctx,s.world,view,camera,1600,1000,undefined,{ground:s.ground,art:s.art},p=>parts.push(p));
   for(const p of parts.sort((a,b)=>a.depth-b.depth)){ctx.save();if(p.drawScreen)p.drawScreen(camera,1600,1000);else{ctx.translate(800,500);ctx.scale(camera.scale,camera.scale);ctx.translate(-camera.x,-camera.y);p.draw();}ctx.restore();}
   if(window.__landmarkInitial!==JSON.stringify([arena,mountain,s.world.bounds]))throw Error('Landmark moved');
   if(!ctx.getImageData(0,0,1600,1000).data.some((v,i)=>i%4===3&&v))throw Error('Blank landmark');
  };
  return {arena:{x:arena.x,y:arena.y,width:arena.width,depth:arena.depth,height:arena.height},mountain:{x:mountain.x,y:mountain.y,width:mountain.width,height:mountain.height,triangles:Landmarks.solidMesh('mountain').triangles}};
 });
 for(const name of ['arena','mountain'])for(const [side,yaw]of [['front',0],['side',Math.PI/2],['back',Math.PI],['diagonal',Math.PI/4]]){
  await page.evaluate(({name,yaw})=>window.__landmarkDraw(name,yaw),{name,yaw});await page.locator('#landmark-review').screenshot({path:`${out}/${name}-${side}.png`});
 }
 assert.deepEqual(errors,[]);writeFileSync(`${out}/audit.json`,JSON.stringify({audit,errors},null,2));console.log(JSON.stringify(audit));console.log(`PASS: both landmarks from four angles; positions and footprint unchanged. Previews: ${out}`);
}finally{await browser.close();}
