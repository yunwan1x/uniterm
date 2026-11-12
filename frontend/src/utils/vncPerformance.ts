// noVNC 1.7 adapter. Only observe its update/decode boundaries; never drop
// rectangles or bypass its backbuffer/flush ordering (RFB is stateful).
export class VncQualityController {
  quality: number
  private changedAt = -Infinity
  private fast = 0

  constructor(quality = 6) { this.quality = Math.max(3, Math.min(6, quality)) }

  observe(ms: number, pixels: number, screenPixels: number, now: number): number {
    if (!Number.isFinite(ms) || ms < 0 || screenPixels <= 0 || pixels < screenPixels / 4) return this.quality
    if (ms >= 180) {
      this.fast = 0
      if (now - this.changedAt >= 1500 && this.quality > 3) {
        this.quality--
        this.changedAt = now
      }
    } else if (ms < 80) {
      this.fast++
      if (this.fast >= 8 && now - this.changedAt >= 8000 && this.quality < 6) {
        this.quality++
        this.changedAt = now
        this.fast = 0
      }
    } else {
      this.fast = 0
    }
    return this.quality
  }
}

interface RfbPerformanceTarget extends EventTarget {
  qualityLevel: number
  _fbWidth: number
  _fbHeight: number
  _canvas?: HTMLCanvasElement
  _sock?: { _websocket?: WebSocket }
  _FBU: { encoding: number | null; width: number; height: number }
  _display: { pending(): boolean; flush(): Promise<void> }
  _framebufferUpdate(): boolean
  _handleRect(): boolean
}

export function installVncPerformance(rfb: RfbPerformanceTarget): () => void {
  // Fail open if a future noVNC version changes the private interface.
  if (typeof rfb._framebufferUpdate !== 'function' || typeof rfb._handleRect !== 'function' || !rfb._display) return () => {}
  const policy = new VncQualityController(rfb.qualityLevel)
  const originalUpdate = rfb._framebufferUpdate
  const originalRect = rfb._handleRect
  let started: number | null = null
  let pixels = 0
  let cpuMs = 0
  let bytes = 0
  let updates = 0
  let lastUpdateMs = 0
  let processingMs = 0
  let disposed = false
  let socket: WebSocket | undefined

  const receive = (event: MessageEvent) => {
    const data = event.data
    bytes += data instanceof ArrayBuffer ? data.byteLength : data instanceof Blob ? data.size : 0
  }
  const attach = () => {
    const next = rfb._sock?._websocket
    if (socket === next) return
    socket?.removeEventListener('message', receive)
    socket = next
    socket?.addEventListener('message', receive)
  }
  const rect = function () {
    const { encoding, width, height } = rfb._FBU
    const result = originalRect.call(rfb)
    if (result && encoding !== null && encoding >= 0) pixels += width * height
    return result
  }
  const update = function () {
    const now = performance.now()
    if (started === null) started = now
    const result = originalUpdate.call(rfb)
    cpuMs += performance.now() - now
    if (result) {
      const begin = started, area = pixels, cost = cpuMs
      started = null
      pixels = cpuMs = 0
      const complete = () => {
        if (disposed) return
        updates++
        lastUpdateMs = performance.now() - begin
        processingMs += cost
        // Background throttling is not evidence of a slow network.
        if (!document.hidden) {
          const quality = policy.observe(lastUpdateMs, area, rfb._fbWidth * rfb._fbHeight, performance.now())
          if (quality !== rfb.qualityLevel) rfb.qualityLevel = quality
        }
      }
      if (rfb._display.pending()) void rfb._display.flush().then(complete)
      else complete()
    }
    return result
  }
  rfb._handleRect = rect
  rfb._framebufferUpdate = update
  attach()
  rfb.addEventListener('connect', attach)

  // Bounded diagnostics for profiling; no pixel readback, global patches,
  // payload logging or user-facing performance controls.
  const timer = setInterval(() => {
    rfb._canvas?.dispatchEvent(new CustomEvent('uniterm:vnc-performance', {
      bubbles: true,
      detail: { bytes, updates, lastUpdateMs, processingMs, quality: rfb.qualityLevel },
    }))
  }, 1000)
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearInterval(timer)
    socket?.removeEventListener('message', receive)
    rfb.removeEventListener('connect', attach)
    rfb.removeEventListener('disconnect', dispose)
    if (rfb._handleRect === rect) rfb._handleRect = originalRect
    if (rfb._framebufferUpdate === update) rfb._framebufferUpdate = originalUpdate
  }
  rfb.addEventListener('disconnect', dispose)
  return dispose
}
