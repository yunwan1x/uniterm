const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const root=process.env.RDP_ARTIFACT_DIR || path.resolve('.router-build');
fs.mkdirSync(root,{recursive:true});
const cred=JSON.parse(fs.readFileSync(process.env.RDP_CREDENTIALS_FILE || root+'/credentials.json'));
const container=process.env.RDP_TEST_CONTAINER || 'uniterm-linux-rdp';
const base=process.env.UNITERM_TEST_URL || 'http://127.0.0.1:18085';
const label=process.argv[2]??'candidate';
const stop=()=>execFileSync('docker',['exec',container,'python3','-c',`import pathlib,os,signal\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit(): continue\n try:\n  args=(p/'cmdline').read_bytes().split(b'\\0')\n  if b'--user-data-dir=/tmp/uniterm-render-test-profile' in args: os.kill(int(p.name),signal.SIGTERM)\n except (FileNotFoundError,ProcessLookupError,PermissionError): pass`]);
const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try {
 const ctx=await b.newContext({viewport:{width:1920,height:1080}});
 const response=await ctx.request.post(base+'/api/auth/login',{data:{username:'admin',password:cred.adminPassword}});assert.equal(response.status(),200);
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/');await p.waitForTimeout(1500);
 if(await p.getByRole('button',{name:'Cancel',exact:true}).count())await p.getByRole('button',{name:'Cancel',exact:true}).click();
 await p.evaluate(c=>window.dispatchEvent(new CustomEvent('app:connect-terminal',{detail:{id:'rdp-render-test',name:'RDP render test',type:'rdp',authType:'password',host:'127.0.0.1',port:3390,user:c.username,password:c.password,rdpSecurityMode:'tls',rdpEnableNLA:false,rdpGraphicsMode:'gfx',rdpFixedWidth:3840,rdpFixedHeight:2160,rdpAudioPlayback:true,desktopPreferences:{rdpZoom:'adaptive'}}})),cred);
 await p.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>c.dataset.rdpStats&&JSON.parse(c.dataset.rdpStats).frames>0),null,{timeout:20000});
 stop();await p.waitForTimeout(1000);
 const log=execFileSync('docker',['exec',container,'cat','/var/log/xrdp.log'],{encoding:'utf8'});const display=':'+[...log.matchAll(/session is available on display (\d+) for user linuxrdp/g)].at(-1)[1];
 execFileSync('docker',['exec','-d',container,'runuser','-u','linuxrdp','--','env','DISPLAY='+display,'XDG_RUNTIME_DIR=/run/user/1000','chromium','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-session-crashed-bubble','--user-data-dir=/tmp/uniterm-render-test-profile','--password-store=basic','--autoplay-policy=no-user-gesture-required','--start-maximized','file:///tmp/uniterm-render-test.html']);
 await p.waitForTimeout(9000);
 const sample=()=>p.locator('canvas.rdp-area').evaluate(c=>({time:performance.now(),width:c.width,height:c.height,graphics:JSON.parse(c.dataset.rdpStats||'{}'),audio:JSON.parse(c.dataset.rdpAudioStats||'{}')}));
 const before=await sample();assert.equal(before.width,3840);assert.equal(before.height,2160);assert(before.graphics.worker);
 const observations=[];for(let i=0;i<12;i++){await p.waitForTimeout(1000);observations.push(await sample())}
 const after=observations.at(-1),elapsed=(after.time-before.time)/1000;
 assert(after.graphics.frames>before.graphics.frames+10);assert.deepEqual(errors,[]);
 const delta={};for(const key of ['frames','avcFrames','receivedBytes','snapshotPixels','fullSnapshotPixels','snapshotMs','decodeMs','ackWaitMs','canvasWriteMs','audioPackets'])if(Number.isFinite(after.graphics[key]))delta[key]=after.graphics[key]-(before.graphics[key]??0);
 const report={label,elapsed,submittedFps:delta.frames/elapsed,before,after,delta,errors};
 if(delta.fullSnapshotPixels)report.snapshotPixelRatio=delta.snapshotPixels/delta.fullSnapshotPixels;
 fs.writeFileSync(root+'/'+label+'-live.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({label,elapsed,fps:report.submittedFps,pixelRatio:report.snapshotPixelRatio,frames:delta.frames,avcFrames:delta.avcFrames,audioBefore:before.audio,audioAfter:after.audio}));
}finally{try{stop()}finally{await b.close()}}
