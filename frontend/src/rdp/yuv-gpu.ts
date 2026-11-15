/** Exact MS-RDPEGFX integer color conversion and AVC444 reverse chroma filter.
 * Targets render directly into persistent GPU surfaces. Readback is used by
 * standalone pixel validation; normal video presentation does not request it.
 */
export class YuvGpu {
  readonly gl: WebGL2RenderingContext
  readonly canvas: OffscreenCanvas
  private program: WebGLProgram
  private textures: WebGLTexture[]
  private output: WebGLTexture
  private framebuffer: WebGLFramebuffer
  private origin: WebGLUniformLocation | null
  private mode: WebGLUniformLocation | null
  private planeSizes: string[] = []
  private outputSize = ''
  constructor(requireHardware = true, canvas = new OffscreenCanvas(1,1)) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    if (requireHardware && (!info || /swiftshader|llvmpipe|softpipe|software/i.test(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)))) throw new Error('Hardware renderer not verified')
    const shader = (type: number, source: string) => {
      const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s)
      if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'YUV shader failed')
      return s
    }
    this.program=gl.createProgram()!
    gl.attachShader(this.program,shader(gl.VERTEX_SHADER,`#version 300 es
    void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1); }`))
    gl.attachShader(this.program,shader(gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float; precision highp int; precision highp usampler2D;
    uniform usampler2D Y; uniform usampler2D U; uniform usampler2D V;
    uniform ivec2 origin; uniform int mode;
    out vec4 color;
    int sampleAt(usampler2D t,ivec2 p){return int(texelFetch(t,p,0).r);}
    int chroma(usampler2D t,ivec2 p){
      if(mode==0)return sampleAt(t,p/2);
      int a=sampleAt(t,p);
      if((p.x&1)==0&&(p.y&1)==0){
        int b=clamp(4*a-sampleAt(t,p+ivec2(1,0))-sampleAt(t,p+ivec2(0,1))-sampleAt(t,p+ivec2(1,1)),0,255);
        if(abs(b-a)>=30)return b;
      }
      return a;
    }
    void main(){
      ivec2 p=ivec2(gl_FragCoord.xy)+origin;
      int y=256*sampleAt(Y,p),u=chroma(U,p)-128,v=chroma(V,p)-128;
      ivec3 rgb=clamp(ivec3((y+403*v)>>8,(y-48*u-120*v)>>8,(y+475*u)>>8),0,255);
      color=vec4(vec3(rgb)/255.0,1.0);
    }`))
    gl.linkProgram(this.program)
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('YUV program failed')
    this.textures=[gl.createTexture()!,gl.createTexture()!,gl.createTexture()!]
    this.output=gl.createTexture()!;this.framebuffer=gl.createFramebuffer()!
    gl.useProgram(this.program)
    for(const [i,name] of ['Y','U','V'].entries())gl.uniform1i(gl.getUniformLocation(this.program,name),i)
    this.origin=gl.getUniformLocation(this.program,'origin');this.mode=gl.getUniformLocation(this.program,'mode')
    for(const [i,texture] of this.textures.entries()){
      gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture)
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST)
    }
    gl.disable(gl.DITHER);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1)
  }
  convert(mode: number, stride: number, rows: number, y: Uint8Array, u: Uint8Array, v: Uint8Array, x: number, top: number, width: number, height: number, target?: { framebuffer: WebGLFramebuffer; x: number; y: number; reusePlanes?: boolean }): Uint8Array {
    const gl=this.gl
    if(gl.isContextLost())throw new Error('YUV context lost')
    if(![mode,stride,rows,x,top,width,height].every(Number.isInteger)||![0,1].includes(mode)||stride<1||rows<1||width<1||height<1||x<0||top<0||x+width>stride||top+height>rows||width*height>16*1024*1024)throw new Error('Invalid YUV extent')
    const cw=mode===0?Math.ceil(stride/2):stride,ch=mode===0?Math.ceil(rows/2):rows
    if(y.length<stride*rows||u.length<cw*ch||v.length<cw*ch)throw new Error('Truncated YUV planes')
    gl.useProgram(this.program)
    let allocated=false
    if(!target?.reusePlanes)for(const [i,plane] of [y,u,v].entries()){
      gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,this.textures[i]!)
      const w=i===0?stride:cw,h=i===0?rows:ch,key=`${w}:${h}`
      if(this.planeSizes[i]!==key){
        gl.texImage2D(gl.TEXTURE_2D,0,gl.R8UI,w,h,0,gl.RED_INTEGER,gl.UNSIGNED_BYTE,plane)
        this.planeSizes[i]=key
        allocated=true
      }else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,w,h,gl.RED_INTEGER,gl.UNSIGNED_BYTE,plane)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,target?.framebuffer ?? this.framebuffer)
    if(!target){
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.output)
      const outputSize=`${width}:${height}`
      if(this.outputSize!==outputSize){
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null)
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.output,0)
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('YUV framebuffer incomplete')
        this.outputSize=outputSize;allocated=true
      }
    }
    // Allocation failures must be caught immediately. Stable targets were
    // validated when created; the compositor checks draw errors at EndFrame.
    if(allocated && gl.getError()!==gl.NO_ERROR)throw new Error('YUV GPU allocation failed')
    gl.viewport(target?.x ?? 0,target?.y ?? 0,width,height)
    gl.uniform2i(this.origin,x-(target?.x ?? 0),top-(target?.y ?? 0));gl.uniform1i(this.mode,mode)
    gl.drawArrays(gl.TRIANGLES,0,3)
    if(target)return new Uint8Array(0)
    const out=new Uint8Array(width*height*4)
    // FBO row zero is deliberately mapped to source row zero (no canvas flip).
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,out)
    if(gl.getError()!==gl.NO_ERROR)throw new Error('YUV GPU operation failed')
    return out
  }
}
