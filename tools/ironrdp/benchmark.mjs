import {writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2] || 'http://127.0.0.1:4180/benchmark.html');
 await page.waitForFunction(()=>window.ready,{},{timeout:60000});
 const environment=await page.evaluate(()=>{const c=document.createElement('canvas');const gl=c.getContext('webgl2');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',devicePixelRatio};});
 const results=[];
 for(let repetition=0;repetition<3;repetition++)for(const [w,h] of [[1920,1080],[3840,2160]])for(const kind of ['narrow-overlap','tiles','scattered','full-screen']){
  const result=await page.evaluate(([w,h,kind,reverse])=>window.runReplay(w,h,kind,60,reverse),[w,h,kind,repetition%2===1]);
  result.repetition=repetition;results.push(result);console.log(JSON.stringify(result));
 }
 await page.evaluate(()=>window.checkFrameClock());
 const edges=await page.evaluate(()=>window.runEdgeCases());
 if(errors.length)throw Error(errors.join('\n'));
 writeFileSync(process.argv[3] || 'rdp-render-results.json',JSON.stringify({environment,edges,results},null,2)+'\n');
}finally{await browser.close();}
