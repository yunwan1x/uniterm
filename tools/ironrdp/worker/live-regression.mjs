const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');import fs from 'node:fs';import assert from 'node:assert/strict';
const cred=JSON.parse(fs.readFileSync(process.env.RDP_CREDENTIALS_FILE || '/tmp/uniterm-worker-credentials.json'));const dir=process.env.RDP_ARTIFACT_DIR || '/tmp/uniterm-rdp-evidence';
const b=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try {
const ctx=await b.newContext({viewport:{width:1920,height:1080}});await ctx.request.post('http://127.0.0.1:18085/api/auth/login',{data:{username:'admin',password:cred.adminPassword}});
await ctx.addInitScript(()=>{
 const get=WebGL2RenderingContext.prototype.getParameter;WebGL2RenderingContext.prototype.getParameter=function(p){if(p===37446)return 'test-force-functional-WebGL';return get.call(this,p)};
 const Original=Worker;window.__frameQueue={max:0,pending:0,received:0};window.Worker=class extends Original{constructor(...a){super(...a);this.addEventListener('message',e=>{if(e.data.type==='frame'){window.__frameQueue.pending++;window.__frameQueue.received++;window.__frameQueue.max=Math.max(window.__frameQueue.max,window.__frameQueue.pending)}})}postMessage(v,...a){if(v.method==='frameAck')window.__frameQueue.pending--;return super.postMessage(v,...a)}};
});
const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:18085/');await p.waitForTimeout(1800);if(await p.getByRole('button',{name:'Cancel',exact:true}).count())await p.getByRole('button',{name:'Cancel',exact:true}).click();
await p.evaluate(cred=>window.dispatchEvent(new CustomEvent('app:connect-terminal',{detail:{id:'rdp-regression',name:'RDP regression',type:'rdp',host:'172.17.0.1',port:13390,user:cred.username,password:cred.password,rdpEnableNLA:false,rdpFixedWidth:1920,rdpFixedHeight:1080,desktopPreferences:{rdpZoom:'adaptive'}}})),cred);
const stats=()=>p.locator('.rdp-canvas').count();
await p.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>c.dataset.rdpStats&&JSON.parse(c.dataset.rdpStats).avcFrames>0),null,{timeout:30000});
const initial=await p.locator('canvas').evaluateAll(cs=>cs.map(c=>JSON.parse(c.dataset.rdpStats||'null')));assert.equal(initial[0].renderer,'webgl2');
await p.screenshot({path:dir+'/webgl2-live.png'});
const remote=await chromium.connectOverCDP('http://127.0.0.1:19226');const rp=remote.contexts()[0].pages().find(p=>p.url().includes('index.html'));
await rp.evaluate(()=>{scrollTo(0,0);window.__keyEvents=[];addEventListener('keydown',e=>window.__keyEvents.push(e.code))});
await p.locator('canvas').click({position:{x:300,y:300}});await p.keyboard.press('PageDown');await p.waitForTimeout(1000);assert((await rp.evaluate(()=>scrollY))>0);await p.keyboard.press('a');await p.waitForTimeout(250);assert((await rp.evaluate(()=>window.__keyEvents)).includes('KeyA'));
await p.getByRole('button',{name:'Keys',exact:true}).click();assert(await p.locator('.floating-keyboard').isVisible());await p.getByRole('button',{name:'Keys',exact:true}).click();
await rp.evaluate(()=>{let i=0;window.__stress=setInterval(()=>{scrollTo(0,++i%2?900:0);if(i===40){clearInterval(window.__stress);document.body.dataset.stressDone='true'}},30)});
await p.evaluate(()=>{const end=performance.now()+700;while(performance.now()<end){}});await p.waitForTimeout(2500);
const queue=await p.evaluate(()=>window.__frameQueue);assert(queue.max<=1);assert.equal(await rp.evaluate(()=>document.body.dataset.stressDone),'true');
await p.locator('canvas').evaluate(c=>c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
await p.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>c.dataset.rdpStats&&JSON.parse(c.dataset.rdpStats).renderer==='canvas2d'&&JSON.parse(c.dataset.rdpStats).avcFrames>0),null,{timeout:30000});
const recovered=await p.locator('canvas').evaluateAll(cs=>cs.map(c=>JSON.parse(c.dataset.rdpStats||'null')));await p.screenshot({path:dir+'/webgl2-recovered.png'});
await p.locator('.rdp-statusbar .rdp-quality-select').first().click();await p.locator('.el-select-dropdown__item').filter({hasText:/1280.*720/}).first().click();
await p.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>c.width===1280&&c.height===720&&c.dataset.rdpStats&&JSON.parse(c.dataset.rdpStats).frames>0),null,{timeout:30000});
await p.locator('.rdp-statusbar .remote-desktop-zoom-select').click();await p.getByRole('option',{name:'100%',exact:true}).click();
await p.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>c.style.width==='1280px'&&c.style.height==='720px'));
const result={initial,recovered,queue,keyboard:true,keyboardToggle:true,resize:[1280,720],numericZoom:true,errors};assert.deepEqual(errors,[]);fs.writeFileSync(dir+'/live-regression.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await remote.close();
}finally{await b.close()}
