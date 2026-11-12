const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
const dir=process.env.RDP_ARTIFACT_DIR || '/tmp/uniterm-rdp-evidence';
fs.mkdirSync(dir,{recursive:true});
const base=process.env.UNITERM_TEST_URL || 'http://127.0.0.1:18082';
const label=process.argv[2] || 'gfx20',isOld=label.startsWith('baseline');
const cred=JSON.parse(fs.readFileSync(process.env.RDP_CREDENTIALS_FILE || dir+'/credentials.json'));
const b=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try {
const ctx=await b.newContext({viewport:{width:1920,height:1080}});
await ctx.request.post(base+'/api/auth/login',{data:{username:'admin',password:cred.adminPassword}});
await ctx.addInitScript(()=>{window.__m={draw:[],ws:[],long:[]};const name=location.port==='18086'?'putImageData':'drawImage';const f=CanvasRenderingContext2D.prototype[name];CanvasRenderingContext2D.prototype[name]=function(...a){let t=performance.now();const r=f.apply(this,a);window.__m.draw.push([performance.timeOrigin+t,performance.now()-t,a[1],a[2],a[0].width,a[0].height]);return r};const WS=WebSocket;window.WebSocket=class extends WS{constructor(...a){super(...a);if(String(a[0]).includes('session-proxy'))this.addEventListener('message',e=>window.__m.ws.push([Date.now(),e.data.byteLength??e.data.size??0]))}};new PerformanceObserver(l=>window.__m.long.push(...l.getEntries().map(e=>[performance.timeOrigin+e.startTime,e.duration]))).observe({entryTypes:['longtask']})});
if(process.env.RDP_NO_ISOLATION==='1')await ctx.route('**/*',async route=>{const response=await route.fetch();const headers={...response.headers()};delete headers['cross-origin-opener-policy'];delete headers['cross-origin-embedder-policy'];await route.fulfill({response,headers})});
const p=await ctx.newPage();p.on('console',m=>{if(m.type()==='error'||m.type()==='warning')fs.appendFileSync(dir+'/'+label+'-console.log',m.text()+'\n')});p.on('pageerror',e=>fs.appendFileSync(dir+'/'+label+'-console.log','PAGEERROR '+e.message+'\n'));
await p.goto(base+'/');await p.waitForTimeout(2500);
if(await p.getByRole('button',{name:'Cancel',exact:true}).count())await p.getByRole('button',{name:'Cancel',exact:true}).click();
await p.evaluate(({cred,label,isOld})=>window.dispatchEvent(new CustomEvent('app:connect-terminal',{detail:{id:'compare-'+label,name:label,type:'rdp',authType:'password',host:'172.17.0.1',port:13391,user:cred.username,password:cred.password,rdpEnableNLA:false,rdpGraphicsMode:'gfx',rdpFixedWidth:1920,rdpFixedHeight:1080,desktopPreferences:{rdpZoom:'adaptive'}}})),{cred,label,isOld});
await p.waitForTimeout(7000);
const remote=await chromium.connectOverCDP(process.env.REMOTE_BROWSER_CDP || 'http://127.0.0.1:19222');const rp=remote.contexts()[0].pages().find(p=>p.url().includes('index.html'));
await rp.evaluate(async()=>{[...document.images].forEach((im,i)=>im.src=`photo${(i+Math.floor(i/4))%4}.jpg`);await Promise.all([...document.images].map(i=>i.decode()));scrollTo(0,0);window.steps=[];window.runTest=(n=6,interval=2500)=>{let i=0;let t=setInterval(()=>{i++;document.querySelector('#marker').textContent=i;scrollTo(0,i%2?900:0);steps.push({i,t:Date.now()});if(i>=n)clearInterval(t)},interval)}});
await p.waitForTimeout(3500);await p.screenshot({path:dir+'/'+label+'-before.png'});
const initialStats=await p.locator('canvas').evaluateAll(cs=>cs.map(c=>c.dataset.rdpStats ? JSON.parse(c.dataset.rdpStats):null));await p.evaluate(()=>window.__m={draw:[],ws:[],long:[]});
await rp.evaluate(()=>runTest());await p.waitForTimeout(17500);
const data=await p.evaluate(()=>({...window.__m,canvas:[...document.querySelectorAll('canvas')].map(c=>[c.width,c.height])}));data.steps=await rp.evaluate(()=>steps);data.label=label; data.initialStats=initialStats;data.finalStats=await p.locator('canvas').evaluateAll(cs=>cs.map(c=>c.dataset.rdpStats ? JSON.parse(c.dataset.rdpStats):null));
fs.writeFileSync(dir+'/'+label+'-compare.json',JSON.stringify(data));
console.log(label,JSON.stringify({bytes:data.finalStats[0] ? data.finalStats[0].receivedBytes-data.initialStats[0].receivedBytes:data.ws.reduce((s,x)=>s+x[1],0),draws:data.draw.length,perStep:data.steps.map((s,i)=>{const a=data.draw.filter(x=>x[0]>=s.t&&x[0]<(data.steps[i+1]?.t??s.t+2500));return {draws:a.length,first:a[0]?.[0]-s.t,last:a.at(-1)?.[0]-s.t,regions:a.length}})}));
// Separate recording; drive real RDP mouse input.
const frames=dir+'/'+label+'-frames';fs.mkdirSync(frames,{recursive:true});await rp.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(3000);
const cdp=await ctx.newCDPSession(p);let index=0,es=[];cdp.on('Page.screencastFrame',async e=>{const name=String(index++).padStart(5,'0')+'.jpg';fs.writeFileSync(frames+'/'+name,Buffer.from(e.data,'base64'));es.push({name,t:e.metadata.timestamp});await cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{})});
await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1600,maxHeight:900,everyNthFrame:1});
await p.mouse.click(650,400);await p.waitForTimeout(500);for(let i=0;i<8;i++){await p.mouse.wheel(0,120);await p.waitForTimeout(100)}await p.waitForTimeout(3000);if(await rp.evaluate(()=>scrollY)===0)throw new Error("RDP wheel did not scroll remote page");for(let i=0;i<8;i++){await p.mouse.wheel(0,-120);await p.waitForTimeout(100)}await p.waitForTimeout(3000);
await cdp.send('Page.stopScreencast');fs.writeFileSync(dir+'/'+label+'-frames.json',JSON.stringify(es));await p.screenshot({path:dir+'/'+label+'-after.png'});
console.log('recording',label,es.length,'frames');await remote.close();
} finally { await b.close(); }
