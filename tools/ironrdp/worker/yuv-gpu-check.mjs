const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try {
 const page=await browser.newPage()
 await page.goto((process.env.UNITERM_RENDER_TEST_ORIGIN || 'http://127.0.0.1:34116')+'/src/rdp/yuv-gpu.ts')
 const result=await page.evaluate(async()=>{
  const {YuvGpu}=await import('/src/rdp/yuv-gpu.ts')
  let softwareRejected=false;try{new YuvGpu()}catch{softwareRejected=true}
  const gpu=new YuvGpu(false),clamp=n=>Math.max(0,Math.min(255,n))
  let cases=0,pixels=0
  for(const mode of [0,1])for(const [stride,rows,x,top,width,height] of [[16,16,0,0,16,16],[32,32,3,5,19,23],[18,18,0,0,17,17]]){
   const cw=mode===0?Math.ceil(stride/2):stride,ch=mode===0?Math.ceil(rows/2):rows
   const planes=[new Uint8Array(stride*rows),new Uint8Array(cw*ch),new Uint8Array(cw*ch)]
   for(const [i,p]of planes.entries())for(let j=0;j<p.length;j++)p[j]=(j*71+i*83+(j>>3)*13)%256
   const out=gpu.convert(mode,stride,rows,...planes,x,top,width,height)
   let k=0
   for(let row=top;row<top+height;row++)for(let col=x;col<x+width;col++){
    const sample=p=>{
     if(mode===0)return p[Math.floor(row/2)*cw+Math.floor(col/2)]
     const at=row*stride+col,a=p[at]
     if(row%2||col%2)return a
     const b=clamp(4*a-p[at+1]-p[at+stride]-p[at+stride+1])
     return Math.abs(b-a)<30?a:b
    }
    const y=planes[0][row*stride+col]*256,u=sample(planes[1])-128,v=sample(planes[2])-128
    const expected=[clamp((y+403*v)>>8),clamp((y-48*u-120*v)>>8),clamp((y+475*u)>>8),255]
    for(const byte of expected){if(out[k]!==byte)throw Error(`mode=${mode} pixel=${row},${col} byte=${k} actual=${out[k]} expected=${byte}`);k++}
    pixels++
   }
   cases++
  }
  let malformedRejected=false;try{gpu.convert(1,16,16,new Uint8Array(1),new Uint8Array(1),new Uint8Array(1),0,0,16,16)}catch{malformedRejected=true}
  return {cases,pixels,softwareRejected,malformedRejected}
 })
 if(!result.softwareRejected||!result.malformedRejected)throw Error(JSON.stringify(result))
 console.log(JSON.stringify(result))
} finally {await browser.close()}
