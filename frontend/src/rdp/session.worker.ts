/// <reference lib="webworker" />
import * as mod from '@ys-ll/ironrdp-wasm'
const scope = self as unknown as DedicatedWorkerGlobalScope
let session: any, canvas: OffscreenCanvas
let sentAt = 0, nextSnapshot = 0, snapshotTimer: ReturnType<typeof setTimeout> | undefined
let interval = 16
let dirty = false, inFlight = false, snapshotting = false, stopped = false
let codecWorker: Worker | undefined
const stats = { worker: true, frames: 0, coalesced: 0, avcFrames: 0, avcAvailable: false, avcYuvAvailable: false, receivedBytes: 0, maxDecodeMs: 0, audioPackets: 0, maxAudioDispatchGapMs: 0, maxAudioSourceGapMs: 0, maxAudioSourceJitterMs: 0 }
const NativeWS = WebSocket
;(globalThis as any).WebSocket = class extends NativeWS {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    this.addEventListener('message', e => { stats.receivedBytes += e.data.byteLength ?? e.data.size ?? 0 })
  }
}
// Worker RAF is not implemented by every browser; a cancellable timer is sufficient
// here because presentation on the document is still synchronized to its real RAF.
;(globalThis as any).requestAnimationFrame = (f: Function) => setTimeout(() => f(performance.now()), 0)
;(globalThis as any).cancelAnimationFrame = clearTimeout
const send = (value: any, transfer: Transferable[] = []) => scope.postMessage(value, transfer)
const event = (name: string, ...args: any[]) => send({ type: 'event', name, args })
async function snapshot() {
  if (!dirty || inFlight || snapshotting || stopped) return
  const delay = nextSnapshot - performance.now()
  if (delay > 0) { if (!snapshotTimer) snapshotTimer = setTimeout(() => { snapshotTimer = undefined; void snapshot() }, delay); return }
  dirty = false; snapshotting = true
  try {
    const bitmap = await createImageBitmap(canvas)
    if (stopped) { bitmap.close(); return }
    inFlight = true; sentAt = performance.now(); nextSnapshot = sentAt + interval; stats.frames++
    send({ type: 'frame', bitmap }, [bitmap])
  } catch { stopped = true; session?.shutdown(); event('workerError', 'RDP worker snapshot failed') } finally { snapshotting = false }
}
async function setupAvc() {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined' || typeof VideoDecoder === 'undefined') return
  const control = new Int32Array(new SharedArrayBuffer(16))
  const pixels = new Uint8Array(new SharedArrayBuffer(64 * 1024 * 1024))
  const worker = new Worker(new URL('./avc.worker.ts', import.meta.url), { type: 'module', name: 'uniterm-avc' })
  codecWorker = worker
  const ready = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 3000)
    worker.onmessage = e => { clearTimeout(timer); stats.avcYuvAvailable = e.data.yuv === true; resolve(e.data.ready === true) }
    worker.onerror = () => { clearTimeout(timer); resolve(false) }
    worker.postMessage({ method: 'init', control: control.buffer, pixels: pixels.buffer })
  })
  if (!ready) { worker.terminate(); codecWorker = undefined; return }
  stats.avcAvailable = true
  ;(globalThis as any).unitermAvcYuv = stats.avcYuvAvailable
  let timestamp = 0
  ;(globalThis as any).unitermResetAvc = () => worker.postMessage({ method: 'reset' })
  ;(globalThis as any).unitermDecodeAvc = (surface: number, data: Uint8Array, yuv = false) => {
    Atomics.store(control, 0, 0)
    worker.postMessage({ method: 'decode', surface, data, yuv, timestamp: ++timestamp })
    const start = performance.now()
    // Never wait on the UI thread. Timeout ends the session instead of showing stale pixels.
    const result = Atomics.wait(control, 0, 0, 2000)
    if (result === 'timed-out' || Atomics.load(control, 0) !== 1) {
      // EGFX tolerates individual corrupt updates, so a Rust decode error alone
      // would leave a negotiated-but-unusable AVC session displaying stale pixels.
      stopped = true; worker.terminate()
      event('workerError', 'WebCodecs AVC decode failed')
      throw new Error('AVC decoder failed')
    }
    const w = Atomics.load(control, 1), h = Atomics.load(control, 2)
    stats.maxDecodeMs = Math.max(stats.maxDecodeMs, performance.now() - start); stats.avcFrames++
    if(yuv) {
      const ySize=w*h,cSize=Math.ceil(w/2)*Math.ceil(h/2)
      return [w,h,pixels.subarray(0,ySize),pixels.subarray(ySize,ySize+cSize),pixels.subarray(ySize+cSize,ySize+2*cSize)]
    }
    return [w, h, pixels.subarray(0, w * h * 4)]
  }
}
function errorText(e: any) {
  try { if (typeof e?.backtrace === 'function') return `kind=${e.kind()} ${e.backtrace()}` } catch {}
  return e instanceof Error ? e.message : String(e)
}
scope.onmessage = async ({ data: m }) => {
  try {
    let result: any
    switch (m.method) {
      case 'connect': {
        await mod.default(); try { mod.setup('warn') } catch {}
        const { options, extensions, callbacks, audioPort } = m.value
        let audioPending = 0, lastAudioAt: number | undefined, lastAudioSource: number | undefined, lastAudioDuration = 0
        if (audioPort) {
          audioPort.onmessage = ({ data }: MessageEvent) => { if (data.type === 'consumed') audioPending = Math.max(0, audioPending - data.bytes) }
          audioPort.start()
        }
        if (extensions.webcodecs_enabled !== false) await setupAvc()
        canvas = new OffscreenCanvas(options.size.width, options.size.height)
        const ctx = canvas.getContext('2d', { alpha: false })!
        const put = ctx.putImageData.bind(ctx)
        ctx.putImageData = ((...args: Parameters<typeof ctx.putImageData>) => {
          put(...args); if (dirty) stats.coalesced++; dirty = true
          setTimeout(() => void snapshot(), 0)
        }) as typeof ctx.putImageData
        const builder = new mod.SessionBuilder().desktopSize(new mod.DesktopSize(options.size.width, options.size.height)).renderCanvas(canvas as any)
        for (const [name, value] of Object.entries(options)) if (name !== 'size') (builder as any)[name](value)
        for (const [name, value] of Object.entries(extensions)) if (!['webcodecs_enabled', 'canvas2d'].includes(name)) builder.extension(new mod.Extension(name, value))
        for (const name of callbacks) {
          if (name === 'cursor') { builder.setCursorStyleCallback((...args: any[]) => event(name, ...args)); builder.setCursorStyleCallbackContext(null) }
          else if (name === 'clipboardForce') builder.forceClipboardUpdateCallback(() => event(name))
          else if (name === 'clipboard') builder.remoteClipboardChangedCallback((data: any) => {
            const items = data.items()
            try { event(name, items.map((i: any) => ({ mime: i.mimeType(), value: i.value() }))) }
            finally { items.forEach((i: any) => i.free()); data.free() }
          })
          else if (name === 'audio_callback' && audioPort) builder.extension(new mod.Extension(name, (kind: string, data: Uint8Array | number, rate?: number, channels?: number, bits?: number, sourceTimestamp?: number) => {
            if (kind === 'pcm' && data instanceof Uint8Array) {
              const now=performance.now()
              if(lastAudioAt!==undefined) stats.maxAudioDispatchGapMs=Math.max(stats.maxAudioDispatchGapMs,now-lastAudioAt)
              if(sourceTimestamp!==undefined && lastAudioSource!==undefined) {
                const gap=(sourceTimestamp-lastAudioSource+65536)%65536
                stats.maxAudioSourceGapMs=Math.max(stats.maxAudioSourceGapMs,gap)
                stats.maxAudioSourceJitterMs=Math.max(stats.maxAudioSourceJitterMs,Math.abs(gap-lastAudioDuration))
              }
              lastAudioAt=now;lastAudioSource=sourceTimestamp;lastAudioDuration=data.byteLength/((rate||1)*(channels||1)*(bits||8)/8)*1000;stats.audioPackets++
              // Suspended audio renderers must not accumulate unbounded port messages.
              if (audioPending + data.byteLength > 256 * 1024) return
              audioPending += data.byteLength
              const copy = data.slice()
              audioPort.postMessage({ type: 'pcm', data: copy, rate, channels, bits }, [copy.buffer])
            } else if (kind === 'volume') audioPort.postMessage({ type: 'volume', left: data, right: rate })
            else if (kind === 'close') audioPort.postMessage({ type: 'end' })
          }))
          else builder.extension(new mod.Extension(name, (...args: any[]) => event(name, ...args)))
        }
        try { session = await builder.connect() } finally { builder.free(); options.password = ''; options.authToken = '' }
        setInterval(() => send({ type: 'stats', stats: { ...stats, pendingFrames: Number(inFlight), dirty, interval } }), 1000)
        break
      }
      case 'run': { const term = await session.run(); result = term.reason(); term.free(); break }
      case 'inputs': {
        const tx = new mod.InputTransaction()
        for (const e of m.value) tx.addEvent((mod.DeviceEvent as any)[e.name](...e.args))
        session.applyInputs(tx); break
      }
      case 'resize': session.resize(...m.value); break
      case 'releaseAllInputs': session.releaseAllInputs(); break
      case 'synchronizeLockKeys': session.synchronizeLockKeys(...m.value); break
      case 'extension': result = await session.invokeExtension(new mod.Extension(m.value.name, m.value.value)); break
      case 'clipboard': {
        const c = new mod.ClipboardData()
        try { for (const i of m.value) { if (typeof i.value === 'string') c.addText(i.mime, i.value); else c.addBinary(i.mime, i.value) } await session.onClipboardPaste(c) }
        finally { c.free() }
        break
      }
      case 'frameAck': interval = Math.max(16, Math.min(100, interval * 0.8 + (performance.now() - sentAt) * 0.2)); inFlight = false; void snapshot(); break
    }
    if (m.id) send({ id: m.id, result })
  } catch (e) {
    if (m.id) send({ id: m.id, error: errorText(e) })
    else { stopped = true; session?.shutdown(); codecWorker?.terminate(); send({ type: 'event', name: 'workerError', args: [errorText(e)] }) }
  }
}
