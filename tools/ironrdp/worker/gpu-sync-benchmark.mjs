// Copy the previous gpu-compositor.ts and yuv-gpu.ts into frontend/rdp-sync-baseline
// before starting Vite. Remove that temporary directory after comparison.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
const b=process.env.REMOTE_BROWSER_CDP ? await chromium.connectOverCDP(process.env.REMOTE_BROWSER_CDP) : await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const origin=process.env.UNITERM_RENDER_TEST_ORIGIN || 'http://127.0.0.1:34116';
const c=await b.newContext();
try{
 const p=await c.newPage();await p.goto(origin+'/src/rdp/gpu-compositor.ts');
 const results=[];
 for(const regions of [1,16,64])for(let round=0;round<4;round++)for(const variant of round%2?['candidate','baseline']:['baseline','candidate']){
  const result=await p.evaluate(async({regions,variant,requireHardware})=>{
   const {GpuCompositor}=await import(variant==='candidate'?'/src/rdp/gpu-compositor.ts':'/rdp-sync-baseline/gpu-compositor.ts');
   const gpu=new GpuCompositor(()=>{},requireHardware),gl=gpu.yuv.gl,width=3840,height=2160;
   const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
   gpu.reset(width,height);gpu.create(1,width,height);gpu.map(1,0,0);
   const y=new Uint8Array(width*height).fill(110),u=new Uint8Array(width*height/4).fill(128),rects=[];
   const across=Math.sqrt(regions),rw=width/across,rh=height/across;
   for(let j=0;j<across;j++)for(let i=0;i<across;i++)rects.push([i*rw,j*rh,(i+1)*rw,(j+1)*rh]);
   const counters={getError:0,checkFramebufferStatus:0,framebufferTexture2D:0,getUniformLocation:0};
   for(const name of Object.keys(counters)){const orig=gl[name].bind(gl);gl[name]=(...args)=>{counters[name]++;return orig(...args)}}
   const samples=[];
   for(let n=0;n<26;n++){
    await new Promise(r=>setTimeout(r,0));
    const start=performance.now();gpu.yuvBitmap(1,0,width,height,y,u,u,rects);gpu.frame();const bitmap=gpu.canvas.transferToImageBitmap();bitmap.close();const elapsed=performance.now()-start;
    if(n>=6)samples.push(elapsed);
   }
   const data=gpu.readSurface(1);if(!data || data[0]!==110 || data.at(-1)!==255)throw Error('invalid benchmark pixels');
   gpu.close();gl.getExtension('WEBGL_lose_context')?.loseContext();samples.sort((a,b)=>a-b);
   return{variant,regions,renderer,medianMs:samples[10],p95Ms:samples[19],meanMs:samples.reduce((a,b)=>a+b)/samples.length,counters};
  },{regions,variant,requireHardware:Boolean(process.env.REMOTE_BROWSER_CDP)});results.push(result);console.log(JSON.stringify(result));
 }
 if(process.env.RDP_BENCHMARK_RESULT)fs.writeFileSync(process.env.RDP_BENCHMARK_RESULT,JSON.stringify(results,null,2));
}finally{await c.close();await b.close()}
