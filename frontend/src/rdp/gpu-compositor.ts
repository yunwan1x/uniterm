import { YuvGpu } from './yuv-gpu'
type Rect = [number, number, number, number]
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }
type Surface = Target & { mapping?: [number, number, number, number] }
/** Persistent GPU surfaces. Video never passes through an RGBA CPU framebuffer.
 * CPU codecs still upload patches; cache and copy operations stay on the GPU.
 */
export class GpuCompositor {
  readonly yuv: YuvGpu
  readonly canvas: OffscreenCanvas
  active = false
  private surfaces = new Map<number, Surface>()
  private cache = new Map<number, Target>()
  private bytes = 0
  private cachedBytes = 0
  private damage: Rect | undefined
  private copyProgram: WebGLProgram
  private image: WebGLUniformLocation | null
  constructor(private present: (rect: Rect) => void, requireHardware = true) {
    this.yuv = new YuvGpu(requireHardware)
    this.canvas = this.yuv.canvas
    const gl = this.yuv.gl
    const shader = (type: number, source: string) => {
      const result=gl.createShader(type)!;gl.shaderSource(result,source);gl.compileShader(result)
      if(!gl.getShaderParameter(result,gl.COMPILE_STATUS))throw new Error('GPU copy shader failed')
      return result
    }
    this.copyProgram=gl.createProgram()!
    gl.attachShader(this.copyProgram,shader(gl.VERTEX_SHADER,`#version 300 es
      out vec2 uv;
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`))
    gl.attachShader(this.copyProgram,shader(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;uniform sampler2D image;in vec2 uv;out vec4 color;
      void main(){color=texture(image,vec2(uv.x,1.0-uv.y));}`))
    gl.linkProgram(this.copyProgram)
    if(!gl.getProgramParameter(this.copyProgram,gl.LINK_STATUS))throw new Error('GPU copy program failed')
    this.image=gl.getUniformLocation(this.copyProgram,'image')
  }
  private get gl() { return this.yuv.gl }
  // Synchronous GPU queries belong at allocation and frame boundaries, not
  // after each region. Context loss is still detected during command handling.
  private check(synchronous = false) { if(this.gl.isContextLost() || (synchronous && this.gl.getError()!==this.gl.NO_ERROR)) throw new Error('RDP WebGL compositor failed') }
  private allocate(width: number, height: number): Target {
    const gl=this.gl,size=width*height*4
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||this.bytes+size>256*1024*1024)throw new Error('RDP WebGL surface budget exceeded')
    const texture=gl.createTexture();if(!texture)throw new Error('RDP WebGL allocation failed')
    const framebuffer=gl.createFramebuffer();if(!framebuffer){gl.deleteTexture(texture);throw new Error('RDP WebGL allocation failed')}
    try{
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,texture)
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
      gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height)
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0)
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('RDP WebGL framebuffer incomplete')
      gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT)
      this.check(true)
    }catch(error){gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);throw error}
    this.bytes+=size;return{texture,framebuffer,width,height}
  }
  private release(target: Target) { this.gl.deleteFramebuffer(target.framebuffer);this.gl.deleteTexture(target.texture);this.bytes-=target.width*target.height*4 }
  private invalidate(rect: Rect) {
    const [x,y,right,bottom]=rect,w=this.canvas.width,h=this.canvas.height
    const clipped: Rect=[Math.max(0,x),Math.max(0,y),Math.min(w,right),Math.min(h,bottom)]
    if(clipped[2]<=clipped[0]||clipped[3]<=clipped[1])return
    if(this.damage){this.damage=[Math.min(this.damage[0],clipped[0]),Math.min(this.damage[1],clipped[1]),Math.max(this.damage[2],clipped[2]),Math.max(this.damage[3],clipped[3])]}
    else this.damage=clipped
  }
  private changed(surface: Surface, rect: Rect) {
    const m=surface.mapping;if(!m)return
    this.invalidate([Math.floor(m[0]+rect[0]*m[2]/surface.width),Math.floor(m[1]+rect[1]*m[3]/surface.height),Math.ceil(m[0]+rect[2]*m[2]/surface.width),Math.ceil(m[1]+rect[3]*m[3]/surface.height)])
  }
  reset(width: number,height: number) {
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16*1024*1024)throw new Error('RDP WebGL output extent exceeded')
    for(const surface of this.surfaces.values())this.release(surface)
    this.surfaces.clear();this.canvas.width=width;this.canvas.height=height
    this.active=true;this.damage=[0,0,width,height]
  }
  create(id: number,width: number,height: number) { this.remove(id);this.surfaces.set(id,this.allocate(width,height)) }
  remove(id: number) { const old=this.surfaces.get(id);if(old){if(old.mapping)this.invalidate([0,0,this.canvas.width,this.canvas.height]);this.release(old);this.surfaces.delete(id)} }
  map(id: number,x: number,y: number,width?: number,height?: number) {
    const surface=this.surfaces.get(id);if(!surface)return
    surface.mapping=[x,y,width??surface.width,height??surface.height];this.invalidate([0,0,this.canvas.width,this.canvas.height])
  }
  bitmap(id: number,rect: Rect,data: Uint8Array) {
    const surface=this.surfaces.get(id);if(!surface)return
    const [x,y,right,bottom]=rect,width=right-x,height=bottom-y
    if(x<0||y<0||right>surface.width||bottom>surface.height||width<1||height<1||data.length!==width*height*4)throw new Error('RDP WebGL bitmap extent mismatch')
    const gl=this.gl;gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,surface.texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data)
    this.changed(surface,rect);this.check()
  }
  yuvBitmap(id: number,mode: number,stride: number,rows: number,y: Uint8Array,u: Uint8Array,v: Uint8Array,rects: number[][]) {
    const surface=this.surfaces.get(id);if(!surface)return true
    const gl=this.gl;gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND)
    let reusePlanes=false
    for(const [x,top,right,bottom,sx,sy] of rects) {
      if(x===undefined||top===undefined||right===undefined||bottom===undefined)throw new Error('RDP WebGL malformed region')
      if(right>surface.width||bottom>surface.height||x<0||top<0)throw new Error('RDP WebGL region exceeds surface')
      this.yuv.convert(mode,stride,rows,y,u,v,sx??x,sy??top,right-x,bottom-top,{framebuffer:surface.framebuffer,x,y:top,reusePlanes})
      reusePlanes=true
      this.changed(surface,[x,top,right,bottom])
    }
    this.check();return true
  }
  fill(id: number,color: number[],rects: Rect[]) {
    const surface=this.surfaces.get(id);if(!surface)return
    const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,surface.framebuffer)
    gl.enable(gl.SCISSOR_TEST);gl.clearColor((color[0]??0)/255,(color[1]??0)/255,(color[2]??0)/255,(color[3]??255)/255)
    for(const rect of rects){const [x,y,right,bottom]=rect;gl.scissor(x,y,right-x,bottom-y);gl.clear(gl.COLOR_BUFFER_BIT);this.changed(surface,rect)}
    gl.disable(gl.SCISSOR_TEST);this.check()
  }
  private blit(source: Target,dest: Target,rect: Rect,x: number,y: number) {
    const gl=this.gl;gl.disable(gl.SCISSOR_TEST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,source.framebuffer)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,dest.framebuffer)
    gl.blitFramebuffer(...rect,x,y,x+rect[2]-rect[0],y+rect[3]-rect[1],gl.COLOR_BUFFER_BIT,gl.NEAREST)
  }
  copy(sourceId: number,destId: number,rect: Rect,points: number[][]) {
    const source=this.surfaces.get(sourceId),dest=this.surfaces.get(destId);if(!source||!dest)return
    // Every destination sees the same source, including overlapping self copies.
    let from: Target=source,area=rect,scratch: Target|undefined
    if(source===dest){scratch=this.allocate(rect[2]-rect[0],rect[3]-rect[1]);this.blit(source,scratch,rect,0,0);from=scratch;area=[0,0,scratch.width,scratch.height]}
    try{for(const [x,y] of points){this.blit(from,dest,area,x!,y!);this.changed(dest,[x!,y!,x!+area[2]-area[0],y!+area[3]-area[1]])}}finally{if(scratch)this.release(scratch)}
    this.check()
  }
  store(id: number,slot: number,rect: Rect) {
    const source=this.surfaces.get(id);if(!source)return
    this.evict(slot);const width=rect[2]-rect[0],height=rect[3]-rect[1],size=width*height*4
    if(this.cachedBytes+size>16*1024*1024||this.cache.size>=4096)throw new Error('RDP WebGL cache budget exceeded')
    const target=this.allocate(width,height);this.blit(source,target,rect,0,0);this.cache.set(slot,target);this.cachedBytes+=size;this.check()
  }
  restore(slot: number,id: number,points: number[][]) {
    const source=this.cache.get(slot),dest=this.surfaces.get(id);if(!source||!dest)return
    for(const [x,y]of points){this.blit(source,dest,[0,0,source.width,source.height],x!,y!);this.changed(dest,[x!,y!,x!+source.width,y!+source.height])}this.check()
  }
  evict(slot: number) { const old=this.cache.get(slot);if(old){this.cachedBytes-=old.width*old.height*4;this.release(old);this.cache.delete(slot)} }
  readSurface(id: number): Uint8Array | null {
    const source=this.surfaces.get(id);if(!source)return null
    const gl=this.gl,out=new Uint8Array(source.width*source.height*4)
    gl.bindFramebuffer(gl.FRAMEBUFFER,source.framebuffer)
    gl.readPixels(0,0,source.width,source.height,gl.RGBA,gl.UNSIGNED_BYTE,out);this.check(true);return out
  }
  frame() {
    if(!this.damage){this.check(true);return}
    const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.copyProgram);gl.uniform1i(this.image,4)
    for(const [,surface]of [...this.surfaces.entries()].sort(([a],[b])=>a-b)){
      const m=surface.mapping;if(!m)continue
      gl.viewport(m[0],this.canvas.height-m[1]-m[3],m[2],m[3]);gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,surface.texture);gl.drawArrays(gl.TRIANGLES,0,3)
    }
    this.check(true);const rect=this.damage;this.damage=undefined;this.present(rect)
  }
  close() { for(const id of [...this.surfaces.keys()])this.remove(id);for(const slot of [...this.cache.keys()])this.evict(slot);this.active=false;this.damage=undefined }
}
