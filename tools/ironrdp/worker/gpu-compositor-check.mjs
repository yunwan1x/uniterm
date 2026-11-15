const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const b=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--enable-unsafe-swiftshader']})
try{
 const p=await b.newPage();await p.goto((process.env.UNITERM_RENDER_TEST_ORIGIN || 'http://127.0.0.1:34116')+'/src/rdp/gpu-compositor.ts')
 const result=await p.evaluate(async()=>{
  const {GpuCompositor}=await import('/src/rdp/gpu-compositor.ts')
  const events=[],gpu=new GpuCompositor(r=>events.push(r),false),width=32,height=24
  let readbacks=0;const read=gpu.yuv.gl.readPixels.bind(gpu.yuv.gl);gpu.yuv.gl.readPixels=(...args)=>{readbacks++;return read(...args)}
  const expected=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)expected.set([x*7,y*9,(x+y)*3,255],(y*width+x)*4)
  const equal=(a,b,label)=>{if(a.length!==b.length||a.some((n,i)=>n!==b[i]))throw Error(label+' pixels differ')}
  gpu.reset(width,height);gpu.create(1,width,height);gpu.map(1,0,0);gpu.bitmap(1,[0,0,width,height],expected)
  if(events.length)throw Error('Presented incomplete frame')
  gpu.frame();if(events.length!==1)throw Error('Frame not presented')
  const bitmap=gpu.canvas.transferToImageBitmap(),out=new OffscreenCanvas(width,height),ctx=out.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close()
  equal(new Uint8Array(ctx.getImageData(0,0,width,height).data.buffer),expected,'GPU orientation')
  gpu.fill(1,[20,80,140,255],[[3,4,12,10]])
  for(let y=4;y<10;y++)for(let x=3;x<12;x++)expected.set([20,80,140,255],(y*width+x)*4)
  // Cache source before overlapping writes and preserve it across ResetGraphics.
  gpu.store(1,7,[0,0,8,8]);const cached=new Uint8Array(8*8*4)
  for(let y=0;y<8;y++)cached.set(expected.slice(y*width*4,(y*width+8)*4),y*8*4)
  const copied=expected.slice();gpu.copy(1,1,[1,1,7,7],[[2,2],[5,5]])
  for(const [dx,dy]of [[2,2],[5,5]])for(let y=0;y<6;y++)for(let x=0;x<6;x++)expected.set(copied.slice(((y+1)*width+x+1)*4,((y+1)*width+x+2)*4),((dy+y)*width+dx+x)*4)
  gpu.frame();if(readbacks!==0)throw Error('Video/copy performed CPU readback')
  equal(gpu.readSurface(1),expected,'self-copy snapshot')
  const updated=gpu.canvas.transferToImageBitmap();ctx.drawImage(updated,0,0);updated.close()
  equal(new Uint8Array(ctx.getImageData(0,0,width,height).data.buffer),expected,'patch after output transfer')
  gpu.reset(width,height);gpu.create(2,width,height);gpu.map(2,0,0);gpu.restore(7,2,[[3,5]]);gpu.frame()
  const restored=gpu.readSurface(2)
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)equal(restored.slice(((y+5)*width+x+3)*4,((y+5)*width+x+4)*4),cached.slice((y*8+x)*4,(y*8+x+1)*4),'cache after resize')
  // Native YUV stays on the GPU until final presentation.
  const y=new Uint8Array(width*height).fill(110),u=new Uint8Array(width*height/4).fill(128)
  const before=readbacks;gpu.yuvBitmap(2,0,width,height,y,u,u,[[0,0,width,height]]);gpu.frame()
  if(readbacks!==before)throw Error('YUV performed CPU readback')
  const native=gpu.readSurface(2);for(let i=0;i<native.length;i+=4)equal(native.slice(i,i+4),new Uint8Array([110,110,110,255]),'YUV')
  gpu.close();if(gpu.active)throw Error('GPU remains active')
  return{frames:events.length,pixels:width*height,normalReadbacks:0,orientation:true,selfCopy:true,persistentCache:true,yuv:true,transferPreservesDamage:true}
 });console.log(JSON.stringify(result))
}finally{await b.close()}
