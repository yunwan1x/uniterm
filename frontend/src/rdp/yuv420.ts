// Preserve the decoder's YUV samples: RGB conversion destroys AVC444's auxiliary view.
export function packYuv420(source: Uint8Array, format: string | null, planes: readonly {offset:number;stride:number}[], width:number, height:number, destination:Uint8Array): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error('Invalid YUV extent')
  const cw=Math.ceil(width/2), ch=Math.ceil(height/2), ySize=width*height, cSize=cw*ch, total=ySize+2*cSize
  if (total > destination.length) throw new Error('YUV destination too small')
  const planar=format==='I420'||format==='I420A'
  if (!planar && format!=='NV12') throw new Error('Unsupported AVC pixel format: '+format)
  const check=(index:number,w:number,h:number) => {
    const p=planes[index]
    if (!p || !Number.isInteger(p.offset) || !Number.isInteger(p.stride) || p.offset<0 || p.stride<w || p.offset+(h-1)*p.stride+w>source.length) throw new Error('Invalid YUV plane layout')
    return p
  }
  const y=check(0,width,height), u=check(1,planar?cw:2*cw,ch), v=planar?check(2,cw,ch):u
  for(let row=0;row<height;row++) destination.set(source.subarray(y.offset+row*y.stride,y.offset+row*y.stride+width),row*width)
  for(let row=0;row<ch;row++) {
    if(planar) {
      destination.set(source.subarray(u.offset+row*u.stride,u.offset+row*u.stride+cw),ySize+row*cw)
      destination.set(source.subarray(v.offset+row*v.stride,v.offset+row*v.stride+cw),ySize+cSize+row*cw)
    } else for(let col=0;col<cw;col++) {
      const at=u.offset+row*u.stride+2*col
      destination[ySize+row*cw+col]=source[at]!
      destination[ySize+cSize+row*cw+col]=source[at+1]!
    }
  }
  return total
}
