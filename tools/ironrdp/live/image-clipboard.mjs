// Run against an unlocked, dedicated local xrdp account; this test changes its clipboard.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';import {execFileSync,spawn} from 'node:child_process';import assert from 'node:assert/strict';
const cred=JSON.parse(fs.readFileSync(process.env.RDP_CREDENTIALS_FILE));
const base=process.env.UNITERM_TEST_URL || 'http://127.0.0.1:18119';
const artifacts=process.env.RDP_ARTIFACT_DIR || '/tmp/uniterm-image-clipboard';
fs.mkdirSync(artifacts,{recursive:true,mode:0o755});
const b=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const ctx=await b.newContext({viewport:{width:1400,height:900},permissions:['clipboard-read','clipboard-write']});
function env(){const pid=execFileSync('pgrep',['-u',cred.username,'-x','xfce4-session'],{encoding:'utf8'}).trim().split('\n')[0];return fs.readFileSync('/proc/'+pid+'/environ').toString().split('\0').filter(s=>/^(DISPLAY=|XAUTHORITY=|DBUS_SESSION_BUS_ADDRESS=|XDG_RUNTIME_DIR=)/.test(s))}
function remote(args,encoding='utf8'){return execFileSync('runuser',['-u',cred.username,'--','env',...env(),...args],{encoding,timeout:10000})}
let imageTarget;
try {
 assert.equal((await ctx.request.post(base+'/api/auth/login',{data:{username:'admin',password:cred.adminPassword}})).status(),200);
 await ctx.addInitScript(()=>{window.clipSends=[];window.clipEvents=[];const W=window.Worker;window.Worker=class extends W{constructor(...a){super(...a);this.addEventListener('message',e=>{if(e.data?.type==='event'&&e.data.name==='clipboard')window.clipEvents.push(e.data.args[0].map(i=>({mime:i.mime,type:i.value?.constructor?.name,length:i.value?.length})))})}};const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...a){if(m?.method==='clipboard')window.clipSends.push(m.value.map(i=>i.mime));return post.call(this,m,...a)}});
 const p=await ctx.newPage();p.on('pageerror',e=>console.log('PAGE ERROR',e.message));p.on('console',m=>{if(m.type()==='error')console.log('BROWSER ERROR',m.text())});
 await p.goto(base);await p.waitForTimeout(1500);if(await p.getByRole('button',{name:'Cancel',exact:true}).count())await p.getByRole('button',{name:'Cancel',exact:true}).click();
 await p.evaluate(c=>window.dispatchEvent(new CustomEvent('app:connect-terminal',{detail:{id:'image-test',name:'Image clipboard test',type:'rdp',host:'127.0.0.1',port:3389,user:c.username,password:c.password,rdpSecurityMode:'tls',rdpEnableNLA:false,rdpFixedWidth:1280,rdpFixedHeight:720,rdpGraphicsMode:'legacy'}})),cred);
 await p.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>c.dataset.rdpStats&&JSON.parse(c.dataset.rdpStats).frames>0),null,{timeout:45000});
 await p.waitForTimeout(4000);await p.locator('.rdp-tab-content').focus();
 await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#e02030';x.fillRect(0,0,48,64);x.fillStyle='#20b060';x.fillRect(48,0,48,64);const png=await new Promise(r=>c.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);});
 await p.waitForTimeout(2500);
 const targets=remote(['xclip','-selection','clipboard','-o','-t','TARGETS']);console.log('REMOTE TARGETS',targets);
 assert.match(targets,/image\/bmp/,'xrdp must expose the local image');
 const bmp=remote(['xclip','-selection','clipboard','-o','-t','image/bmp'],null);fs.writeFileSync(artifacts+'/received.bmp',bmp);console.log('LOCAL TO REMOTE BYTES',bmp.length);
 const check=execFileSync('python3',['-c',"import sys; from PIL import Image; im=Image.open(sys.argv[1]); assert im.size==(96,64); assert im.getpixel((10,10))[:3]==(224,32,48); assert im.getpixel((80,10))[:3]==(32,176,96); print('PASS forward pixels')",artifacts+'/received.bmp'],{encoding:'utf8'});console.log(check.trim());
 execFileSync('python3',['-c',"import sys; from PIL import Image; im=Image.new('RGB',(128,80),(20,60,230)); im.save(sys.argv[1])",artifacts+'/remote.bmp']);
 const before=await p.evaluate(()=>window.clipSends.length);
 const setter=spawn('runuser',['-u',cred.username,'--','env',...env(),'xclip','-selection','clipboard','-i','-t','image/bmp',artifacts+'/remote.bmp'],{stdio:'ignore'});
 await new Promise((resolve,reject)=>{setter.on('exit',code=>code===0?resolve():reject(Error('xclip set failed')))});
 await p.waitForTimeout(2500);
 const result=await p.evaluate(async()=>{const items=await navigator.clipboard.read();const image=items.find(i=>i.types.includes('image/png'));if(!image)return null;const b=await createImageBitmap(await image.getType('image/png'));const c=document.createElement('canvas');c.width=b.width;c.height=b.height;const x=c.getContext('2d');x.drawImage(b,0,0);return {width:b.width,height:b.height,pixel:[...x.getImageData(10,10,1,1).data]}});
 console.log('CLIP EVENTS',await p.evaluate(()=>({events:window.clipEvents,sends:window.clipSends})));console.log('AFTER TARGETS',remote(['xclip','-selection','clipboard','-o','-t','TARGETS']));
 assert.deepEqual(result,{width:128,height:80,pixel:[20,60,230,255]});console.log('PASS remote to local image pixels');
 await p.waitForTimeout(2200);assert.equal(await p.evaluate(()=>window.clipSends.length),before,'remote image must not echo');console.log('PASS no image echo across polling');
 await p.evaluate(()=>navigator.clipboard.writeText('image-to-text-regression'));
 await p.waitForTimeout(1500);assert.equal(remote(['xclip','-selection','clipboard','-o']),'image-to-text-regression');console.log('PASS text after image');
 // Use an image-aware destination: XFCE's desktop interprets Ctrl+V as file paste.
 const targetPath='/tmp/'+cred.username+'-image-paste.png';
 try { fs.unlinkSync(targetPath) } catch {}
 imageTarget=spawn('runuser',['-u',cred.username,'--','env',...env(),'/usr/bin/python3','-c',
 `import gi
gi.require_version('Gtk','3.0')
from gi.repository import Gtk,Gdk
w=Gtk.Window(title='uniTerm Clipboard QA')
w.set_default_size(320,240)
image=Gtk.Image()
w.add(image)
def received(clipboard,pixbuf,data):
 if pixbuf:
  pixbuf.savev(${JSON.stringify(targetPath)},'png',[],[])
  image.set_from_pixbuf(pixbuf)
def key(window,event):
 if event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval in (Gdk.KEY_v,Gdk.KEY_V):
  Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).request_image(received,None)
  return True
 return False
w.connect('key-press-event',key)
w.show_all()
Gtk.main()`],{stdio:'ignore'});
 await p.waitForTimeout(1000);
 remote(['xdotool','search','--name','uniTerm Clipboard QA','windowactivate','--sync']);
 // A real Ctrl+V must use the DOM paste image, even when programmatic reads are unavailable.
 await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=32;c.height=24;const x=c.getContext('2d');x.fillStyle='#f0c020';x.fillRect(0,0,32,24);const png=await new Promise(r=>c.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);Object.defineProperty(navigator.clipboard,'read',{value:undefined,configurable:true});});
 await p.locator('.rdp-tab-content').focus();
 await p.keyboard.press('Control+v');
 // Wait for the remote clipboard advertisement instead of assuming a fixed delay.
 const deadline=Date.now()+10000;
 while(!remote(['xclip','-selection','clipboard','-o','-t','TARGETS']).includes('image/bmp')) {
   if(Date.now()>deadline)throw Error('Native paste image was not advertised: '+JSON.stringify(await p.evaluate(()=>({sends:window.clipSends,events:window.clipEvents,focus:document.activeElement?.className}))));
   await p.waitForTimeout(200);
 }
 const pasted=remote(['xclip','-selection','clipboard','-o','-t','image/bmp'],null);fs.writeFileSync(artifacts+'/pasted.bmp',pasted);
 execFileSync('python3',['-c',"import sys; from PIL import Image; im=Image.open(sys.argv[1]); assert im.size==(32,24); assert im.getpixel((10,10))[:3]==(240,192,32)",artifacts+'/pasted.bmp']);console.log('PASS native image paste without Clipboard.read');
 const pasteDeadline=Date.now()+5000;while(!fs.existsSync(targetPath)){if(Date.now()>pasteDeadline)throw Error('Remote GTK app did not receive Ctrl+V image');await p.waitForTimeout(100)}
 execFileSync('python3',['-c',"import sys; from PIL import Image; im=Image.open(sys.argv[1]); assert im.size==(32,24); assert im.getpixel((10,10))[:3]==(240,192,32)",targetPath]);console.log('PASS image received by remote GTK application');
 await p.screenshot({path:artifacts+'/connected.png'});
} finally {imageTarget?.kill();await b.close()}
