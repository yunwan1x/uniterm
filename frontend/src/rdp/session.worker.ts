/// <reference lib="webworker" />
import { AudioTransport } from './audio-transport'
import { DesktopDamage } from './damage'
import { PreparedAvc } from './async-avc'
import { GpuCompositor } from './gpu-compositor'
import * as mod from '@ys-ll/ironrdp-wasm'
const scope = self as unknown as DedicatedWorkerGlobalScope
let session: any, canvas: OffscreenCanvas
let gpu: GpuCompositor | undefined, gpuFrameReady = false
let hiddenPresentation = false, nextBackgroundSnapshot = 0
let sentAt = 0, snapshotTimer: ReturnType<typeof setTimeout> | undefined
const damage = new DesktopDamage()
let dirty = false, inFlight = false, snapshotting = false, stopped = false
let codecWorker: Worker | undefined
const stats = { gpuAvc420Frames: 0, gpuAvc444Frames: 0, gpuReadbacks: 0, gpuReadbackBytes: 0, gpuYuvAvailable: false, gpuYuvFrames: 0, gpuYuvMs: 0, maxGpuYuvMs: 0, worker: true, frames: 0, coalesced: 0, avcFrames: 0, avcAvailable: false, avcYuvAvailable: false, receivedBytes: 0, maxDecodeMs: 0, decodeMs: 0, snapshotMs: 0, maxSnapshotMs: 0, snapshotPixels: 0, fullSnapshotPixels: 0, ackWaitMs: 0, maxAckWaitMs: 0, canvasWriteMs: 0, maxCanvasWriteMs: 0, audioPackets: 0, maxAudioDispatchGapMs: 0, maxAudioSourceGapMs: 0, maxAudioSourceJitterMs: 0 }
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
  const delay = hiddenPresentation ? nextBackgroundSnapshot - performance.now() : 0
  if (delay > 0) {
    if (!snapshotTimer) snapshotTimer = setTimeout(() => { snapshotTimer = undefined; void snapshot() }, delay)
    return
  }
  if (gpu?.active && !gpuFrameReady) return
  const source = gpu?.active ? gpu.canvas : canvas
  let region = damage.take(source.width, source.height)
  if (!region) { dirty = false; return }
  const width = source.width, height = source.height
  dirty = false; snapshotting = true
  const started = performance.now()
  try {
    // GPU surfaces retain the desktop; frame() redraws every mapped surface.
    // Transferring this completed output can discard its backing store safely.
    // The incremental Canvas2D framebuffer must keep its pixels between updates.
    const transferOutput = gpu?.active && typeof source.transferToImageBitmap === 'function'
    if (transferOutput) region = { x: 0, y: 0, width, height }
    const bitmap = transferOutput ? source.transferToImageBitmap() : await createImageBitmap(source, region.x, region.y, region.width, region.height)
    const elapsed = performance.now() - started
    stats.snapshotMs += elapsed; stats.maxSnapshotMs = Math.max(stats.maxSnapshotMs, elapsed)
    stats.snapshotPixels += region.width * region.height; stats.fullSnapshotPixels += width * height
    if (stopped) { bitmap.close(); return }
    inFlight = true; sentAt = performance.now(); nextBackgroundSnapshot = sentAt + 100; stats.frames++
    send({ type: 'frame', bitmap, region: { ...region, desktopWidth: width, desktopHeight: height } }, [bitmap])
  } catch { stopped = true; session?.shutdown(); event('workerError', 'RDP worker snapshot failed') } finally { snapshotting = false }
}
async function setupAvc(enabled = true): Promise<Record<string, unknown>> {
  const started = performance.now()
  const prerequisites = { secureContext: globalThis.isSecureContext === true, crossOriginIsolated: globalThis.crossOriginIsolated === true, sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', videoDecoder: typeof VideoDecoder !== 'undefined' }
  const report = (reason: string, details: Record<string, unknown> = {}) => ({ ...prerequisites, reason, elapsedMs: Math.round(performance.now() - started), avcAvailable: stats.avcAvailable, avcYuvAvailable: stats.avcYuvAvailable, ...details })
  if (!enabled) return report('disabled-after-fallback')
  if (!prerequisites.crossOriginIsolated) return report('not-cross-origin-isolated')
  if (!prerequisites.sharedArrayBuffer) return report('shared-array-buffer-unavailable')
  if (!prerequisites.videoDecoder) return report('video-decoder-unavailable')
  const control = new Int32Array(new SharedArrayBuffer(16))
  const pixels = new Uint8Array(new SharedArrayBuffer(64 * 1024 * 1024))
  const worker = new Worker(new URL('./avc.worker.ts', import.meta.url), { type: 'module', name: 'uniterm-avc' })
  codecWorker = worker
  const ready = await new Promise<{ ready: boolean; yuv?: boolean; baselineReason?: string; yuvReason?: string; reason?: string }>(resolve => {
    const timer = setTimeout(() => resolve({ ready: false, reason: 'init-timeout' }), 3000)
    worker.onmessage = e => { clearTimeout(timer); stats.avcYuvAvailable = e.data.yuv === true; resolve(e.data) }
    worker.onerror = () => { clearTimeout(timer); resolve({ ready: false, reason: 'worker-load-error' }) }
    worker.postMessage({ method: 'init', control: control.buffer, pixels: pixels.buffer })
  })
  if (ready.ready !== true) { worker.terminate(); codecWorker = undefined; return report(ready.reason || 'baseline-codec-unavailable', { baselineReason: ready.baselineReason, yuvReason: ready.yuvReason }) }
  stats.avcAvailable = true
  ;(globalThis as any).unitermAvcYuv = stats.avcYuvAvailable
  let timestamp = 0
  const prepared = new PreparedAvc()
  let pending: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
  worker.onmessage = ({ data }) => {
    // A cancelled decode can finish after reset and after a new request starts.
    // Its completion must not clear the new request or its timeout.
    if (data.method !== 'decoded' || !pending || data.timestamp !== timestamp) return
    const completion = pending; pending = undefined; clearTimeout(completion.timer)
    if (data.status !== 1) completion.reject(new Error('WebCodecs AVC decode failed'))
    else completion.resolve()
  }
  worker.onerror = () => { if (pending) { clearTimeout(pending.timer); pending.reject(new Error('AVC worker failed')); pending = undefined } }
  // This lifecycle bridge is independent of the optional GPU command bridge,
  // so Canvas2D sessions release decoders without copying unused GPU arguments.
  ;(globalThis as any).unitermReleaseAvc = (surface: number) => worker.postMessage({ method: 'release', surface })
  ;(globalThis as any).unitermResetAvc = () => {
    prepared.clear()
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('AVC preparation cancelled')); pending = undefined }
    worker.postMessage({ method: 'reset' })
  }
  ;(globalThis as any).unitermPrepareAvc = (requests: [number, Uint8Array, boolean][]) => prepared.prepare(requests, async (surface, data, yuv) => {
    if (pending) throw new Error('Concurrent AVC decode')
    const start = performance.now()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending = undefined; worker.terminate(); reject(new Error('AVC decoder timed out')) }, 2000)
      pending = { resolve, reject, timer }
      worker.postMessage({ method: 'decode', surface, data, yuv, timestamp: ++timestamp })
    })
    const w = Atomics.load(control, 1), h = Atomics.load(control, 2)
    const elapsed = performance.now() - start
    stats.decodeMs += elapsed; stats.maxDecodeMs = Math.max(stats.maxDecodeMs, elapsed); stats.avcFrames++
    if (yuv) {
      const ySize = w*h, cSize = Math.ceil(w/2)*Math.ceil(h/2)
      return [w, h, pixels.subarray(0,ySize), pixels.subarray(ySize,ySize+cSize), pixels.subarray(ySize+cSize,ySize+2*cSize)]
    }
    return [w, h, pixels.subarray(0,w*h*4)]
  })
  ;(globalThis as any).unitermDecodeAvc = (surface: number, _data: Uint8Array, yuv = false) => prepared.take(surface, yuv)
  return report('ready', { baselineReason: ready.baselineReason, yuvReason: ready.yuvReason })
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
        const { options, extensions, callbacks, audioPort } = m.value
        // GPU surfaces are authoritative after ResetGraphics. Compatibility
        // fallback reconnects with canvas2d and leaves the CPU path unchanged.
        let gpuReason = extensions.canvas2d === true ? 'disabled-after-fallback' : 'ready'
        if (extensions.canvas2d !== true) try {
          gpu = new GpuCompositor(([x,y,right,bottom]) => {
            gpuFrameReady = true
            damage.add(gpu!.canvas.width,gpu!.canvas.height,{width:right-x,height:bottom-y},x,y)
            if(dirty)stats.coalesced++;dirty=true
            if(!snapshotTimer&&!inFlight&&!snapshotting)snapshotTimer=setTimeout(()=>{snapshotTimer=undefined;void snapshot()},0)
          })
          stats.gpuYuvAvailable = true
          ;(globalThis as any).unitermGpuCommand = (name: string, ...args: any[]) => {
            if(name === 'active')return gpu?.active === true
            if(name === 'reset')gpuFrameReady = false
            const started = performance.now()
            try {
              const methods: Record<string,Function> = Object.fromEntries(['reset','create','remove','map','bitmap','frame','close','fill','copy','store','restore','evict','readSurface','yuvBitmap'].map(name=>[name,(gpu as any)[name].bind(gpu)]))
              const method = methods[name];if(!method)throw new Error('Unknown GPU command')
              const result=method(...args)
              if(name === "readSurface" && result instanceof Uint8Array){stats.gpuReadbacks++;stats.gpuReadbackBytes+=result.byteLength}
              if(name === 'yuvBitmap'){
                if(args[1]===0)stats.gpuAvc420Frames++;else stats.gpuAvc444Frames++
                const elapsed=performance.now()-started;stats.gpuYuvFrames++;stats.gpuYuvMs+=elapsed;stats.maxGpuYuvMs=Math.max(stats.maxGpuYuvMs,elapsed)
              }
              return result
            } catch(error) {
              stopped=true;stats.gpuYuvAvailable=false
              event('workerError','RDP WebGL compositor failed; canvas context fallback required')
              throw error
            }
          }
          gpu.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();stopped=true;event('workerError','RDP WebGL context lost')})
        } catch (error) { gpu=undefined; gpuReason = error instanceof Error ? error.message.replace(/[\r\n]/g, ' ').slice(0, 160) : 'initialization-failed' }
        await mod.default(); try { mod.setup('warn') } catch {}
        let lastAudioAt: number | undefined, lastAudioSource: number | undefined, lastAudioDuration = 0
        const audioTransport = audioPort ? new AudioTransport(audioPort) : null
        let avc: Record<string, unknown>
        try { avc = await setupAvc(extensions.webcodecs_enabled !== false) }
        catch (error) {
          event('rdp_diagnostic', { phase: 'worker-startup', asset: new URL(import.meta.url).pathname, gpuAvailable: !!gpu, gpuReason, avc: { reason: 'setup-error', errorName: error instanceof Error ? error.name : 'unknown' } })
          throw error
        }
        event('rdp_diagnostic', { phase: 'worker-startup', asset: new URL(import.meta.url).pathname, gpuAvailable: !!gpu, gpuReason, avc })
        canvas = new OffscreenCanvas(options.size.width, options.size.height)
        const ctx = canvas.getContext('2d', { alpha: false })!
        const put = ctx.putImageData.bind(ctx)
        ctx.putImageData = ((...args: Parameters<typeof ctx.putImageData>) => {
          if(gpu?.active)throw new Error('RDP WebGL mixed graphics requires canvas context fallback')
          const started = performance.now()
          put(...args)
          const elapsed = performance.now() - started
          stats.canvasWriteMs += elapsed; stats.maxCanvasWriteMs = Math.max(stats.maxCanvasWriteMs, elapsed)
          damage.add(canvas.width, canvas.height, ...args)
          if (dirty) stats.coalesced++; dirty = true
          if (!snapshotTimer && !inFlight && !snapshotting) snapshotTimer = setTimeout(() => { snapshotTimer = undefined; void snapshot() }, 0)
        }) as typeof ctx.putImageData
        const builder = new mod.SessionBuilder().desktopSize(new mod.DesktopSize(options.size.width, options.size.height)).renderCanvas(canvas as any)
        for (const [name, value] of Object.entries(options)) if (name !== 'size') (builder as any)[name](value)
        for (const [name, value] of Object.entries(extensions)) if (!['webcodecs_enabled', 'canvas2d'].includes(name)) builder.extension(new mod.Extension(name, value))
        for (const name of callbacks) {
          if (name === 'rdp_diagnostic') continue
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
              if (!audioTransport?.canSend(data.byteLength)) return
              const copy = data.slice()
              audioTransport.send({ type: 'pcm', data: copy, rate, channels, bits }, [copy.buffer])
            } else if (kind === 'volume') audioPort.postMessage({ type: 'volume', left: data, right: rate })
            else if (kind === 'close') audioTransport?.send({ type: 'end' })
          }))
          else builder.extension(new mod.Extension(name, (...args: any[]) => event(name, ...args)))
        }
        try { session = await builder.connect() } finally { builder.free(); options.password = ''; options.authToken = '' }
        setInterval(() => send({ type: 'stats', stats: { ...stats, pendingFrames: Number(inFlight), dirty } }), 1000)
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
      case 'frameAck': {
        if (!inFlight) break
        hiddenPresentation = m.hidden === true
        const elapsed = performance.now() - sentAt
        stats.ackWaitMs += elapsed; stats.maxAckWaitMs = Math.max(stats.maxAckWaitMs, elapsed)
        // The document RAF already paces presentation. Adding an ACK-derived
        // delay here counts protocol-worker congestion as display time twice.
        inFlight = false; void snapshot(); break
      }
    }
    if (m.id) send({ id: m.id, result })
  } catch (e) {
    if (m.id) send({ id: m.id, error: errorText(e) })
    else { stopped = true; session?.shutdown(); codecWorker?.terminate(); send({ type: 'event', name: 'workerError', args: [errorText(e)] }) }
  }
}
