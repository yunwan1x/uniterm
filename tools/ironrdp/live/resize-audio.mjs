// Run against an unlocked, dedicated xrdp test desktop with PulseAudio.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
const cred=JSON.parse(fs.readFileSync(process.env.RDP_CREDENTIALS_FILE)),user=cred.username;
const b=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const base=process.env.UNITERM_TEST_URL || 'http://127.0.0.1:18119';
let audio;
function env(){const pid=execFileSync('pgrep',['-u',user,'-x','xfce4-session'],{encoding:'utf8'}).trim().split('\n')[0];return fs.readFileSync('/proc/'+pid+'/environ').toString().split('\0').filter(s=>/^(DISPLAY=|XAUTHORITY=|DBUS_SESSION_BUS_ADDRESS=|XDG_RUNTIME_DIR=|XRDP_SESSION=)/.test(s))}
function run(...args){return execFileSync('runuser',['-u',user,'--','env',...env(),...args],{encoding:'utf8'}).trim()}
async function connect(dpr){
 const ctx=await b.newContext({viewport:{width:1400,height:800},deviceScaleFactor:dpr});
 await ctx.addInitScript(()=>{const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...args){if(m?.method==='resize'||m?.method==='connect')window.__rdpWorker=this;return post.call(this,m,...args)}});
 await ctx.request.post(base+'/api/auth/login',{data:{username:'admin',password:cred.adminPassword}});
 const p=await ctx.newPage();p.on('console',m=>{if(m.type()==='error')console.log('BROWSER ERROR',m.text())});p.on('pageerror',e=>console.log('PAGE ERROR',e.message));await p.goto(base);await p.waitForTimeout(1500);
 if(await p.getByRole('button',{name:'Cancel',exact:true}).count())await p.getByRole('button',{name:'Cancel',exact:true}).click();
 await p.evaluate(({user,cred,compat})=>window.dispatchEvent(new CustomEvent('app:connect-terminal',{detail:{id:'dpi-test',name:'DPI test',type:'rdp',host:'127.0.0.1',port:3389,user,password:cred.password,rdpSecurityMode:'tls',rdpEnableNLA:false,rdpGraphicsMode:'gfx',rdpXrdpScaleCompatibility:compat}})),{user,cred,compat:process.env.RDP_COMPAT === '1'});
 await p.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>c.dataset.rdpStats&&JSON.parse(c.dataset.rdpStats).frames>0),null,{timeout:45000});
 await p.waitForTimeout(7000);return {ctx,p};
}
try{
 const {ctx,p}=await connect(2);
 audio=spawn('runuser',['-u',user,'--','env',...env(),'paplay','--raw','--rate=44100','--channels=2','--format=s16le','/dev/zero'],{stdio:'ignore'});
 await p.waitForTimeout(1000);
 let previousAudioPackets=0;
 for(let round=0;round<3;round++){
  for(const zoom of ['75%','100%','150%','100%']){
   console.log('select',round,zoom);
   await p.locator('.remote-desktop-zoom-select:visible').first().click();
   await p.getByRole('option',{name:zoom,exact:true}).click();
   await p.waitForTimeout(1800);
   const error=await p.locator('.rdp-error').allTextContents();
   const body=await p.locator('body').innerText();
   if(body.includes('invalid pdu type') || body.includes('decode error')){
    console.log(body.slice(-5000));
    throw Error('REPRODUCED decode error');
   }
   const stats=await p.evaluate(()=>[...document.querySelectorAll('canvas')].filter(c=>c.dataset.rdpStats).map(c=>JSON.parse(c.dataset.rdpStats))); if(!stats.length)throw Error('RDP canvas missing'); if(stats[0].audioPackets<=previousAudioPackets)throw Error('Audio stalled after resize'); previousAudioPackets=stats[0].audioPackets; if(error.some(x=>x.trim()))throw Error('RDP error: '+error.join(' ')); console.log('PASS resize',round,zoom,{frames:stats[0].frames,audioPackets:stats[0].audioPackets});
  }
 }
 audio.kill();await ctx.close();
}finally{audio?.kill();await b.close()}
