/** One complete worker snapshot per display frame. No dependent RDP deltas are discarded. */
export class DesktopRenderer {
  private gl: WebGL2RenderingContext | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private texture: WebGLTexture | null = null
  private program: WebGLProgram | null = null
  private textureWidth = 0
  private textureHeight = 0
  private pending: ImageBitmap | null = null
  private raf = 0
  private stopped = false
  private owner: Window
  private doc: Document
  readonly mode: 'webgl2' | 'canvas2d'
  constructor(private canvas: HTMLCanvasElement, private ack: () => void, private failure: () => void, preference: 'auto' | 'canvas2d' | 'webgl2' = 'auto') {
    this.doc = canvas.ownerDocument
    this.owner = this.doc.defaultView ?? window
    // Probe a separate canvas: a failed GL attempt must not lock the real canvas out of 2D.
    const probe = document.createElement('canvas').getContext('webgl2')
    const debug = probe?.getExtension('WEBGL_debug_renderer_info')
    const name = debug ? String(probe!.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : ''
    const hardware = preference !== 'canvas2d' && probe && (preference === 'webgl2' || !/swiftshader|llvmpipe|software/i.test(name))
    probe?.getExtension('WEBGL_lose_context')?.loseContext()
    this.gl = hardware ? canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false }) : null
    this.mode = this.gl ? 'webgl2' : 'canvas2d'
    if (this.gl) this.initGL()
    else this.ctx = canvas.getContext('2d', { alpha: false })
    if (!this.gl && !this.ctx) throw new Error('RDP canvas context unavailable')
    canvas.addEventListener('webglcontextlost', this.contextLost)
    this.doc.addEventListener('visibilitychange', this.visibility)
  }
  private contextLost = (e: Event) => { e.preventDefault(); if (!this.stopped) this.failure() }
  private visibility = () => { if (this.doc.hidden) this.flush(); else this.schedule() }
  private initGL() {
    const gl = this.gl!
    const compile = (type: number, source: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, source); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('RDP shader compilation failed')
      return s
    }
    const vs = compile(gl.VERTEX_SHADER, `#version 300 es
    out vec2 uv;
    void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); uv=vec2(p.x,1.0-p.y); gl_Position=vec4(p*2.0-1.0,0,1);}`)
    const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float; in vec2 uv; uniform sampler2D desktop; out vec4 color;
    void main(){color=vec4(texture(desktop,uv).rgb,1.0);}`)
    const p = gl.createProgram()!; gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p)
    gl.deleteShader(vs); gl.deleteShader(fs)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('RDP shader linking failed')
    this.program = p; gl.useProgram(p)
    this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
  frame(bitmap: ImageBitmap) {
    if (this.stopped) { bitmap.close(); return }
    if (this.doc !== this.canvas.ownerDocument) {
      this.owner.cancelAnimationFrame(this.raf); this.raf = 0
      this.doc.removeEventListener('visibilitychange', this.visibility)
      this.doc = this.canvas.ownerDocument
      this.owner = this.doc.defaultView ?? window
      this.doc.addEventListener('visibilitychange', this.visibility)
    }
    this.pending?.close(); this.pending = bitmap
    if (this.doc.hidden) this.flush()
    else this.schedule()
  }
  private schedule() { if (this.pending && !this.raf) this.raf = this.owner.requestAnimationFrame(() => { this.raf = 0; this.flush() }) }
  private flush() {
    const bitmap = this.pending; if (!bitmap) return
    this.pending = null
    try {
      if (this.canvas.width !== bitmap.width) this.canvas.width = bitmap.width
      if (this.canvas.height !== bitmap.height) this.canvas.height = bitmap.height
      if (this.gl) {
        const gl = this.gl
        gl.viewport(0, 0, bitmap.width, bitmap.height)
        if (this.textureWidth !== bitmap.width || this.textureHeight !== bitmap.height) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
          this.textureWidth = bitmap.width; this.textureHeight = bitmap.height
        } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      } else this.ctx!.drawImage(bitmap, 0, 0)
    } finally { bitmap.close(); this.ack() }
  }
  dispose() {
    this.stopped = true; this.owner.cancelAnimationFrame(this.raf); this.pending?.close(); this.pending = null
    this.canvas.removeEventListener('webglcontextlost', this.contextLost)
    this.doc.removeEventListener('visibilitychange', this.visibility)
    if (this.gl) { this.gl.deleteTexture(this.texture); this.gl.deleteProgram(this.program) }
  }
}
