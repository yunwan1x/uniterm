import { acceptTraceDrain, resetTraceDrains, type TraceDrainCounters } from './trace-drain'
import { DesktopRenderer } from './renderer'
export const isWorker = true

export class Extension { constructor(public name: string, public value: any) {} free() {} }
export class DesktopSize { constructor(public width: number, public height: number) {} free() {} }
export class InputTransaction { events: any[] = []; addEvent(e: any) { this.events.push(e) } free() {} }
export const DeviceEvent = Object.fromEntries(['keyPressed', 'keyReleased', 'mouseButtonPressed', 'mouseButtonReleased', 'mouseMove', 'unicodePressed', 'unicodeReleased', 'wheelRotations'].map(name => [name, (...args: any[]) => ({ name, args })]))
export const RotationUnit = { Pixel: 0, Line: 1, Page: 2 }
export class ClipboardData {
  entries: { mime: string; value: any }[] = []
  addText(mime: string, value: string) { this.entries.push({ mime, value }) }
  addBinary(mime: string, value: Uint8Array) { this.entries.push({ mime, value }) }
  items() { return this.entries.map(i => ({ mimeType: () => i.mime, value: () => i.value, free() {} })) }
  free() {} isEmpty() { return !this.entries.length }
}
export class SessionBuilder {
  private options: Record<string, any> = {}
  private extensions: Record<string, any> = {}
  private callbacks: Record<string, Function> = {}
  private canvas!: HTMLCanvasElement
  username(v: string) { this.options.username = v; return this }
  password(v: string) { this.options.password = v; return this }
  serverDomain(v: string) { this.options.serverDomain = v; return this }
  destination(v: string) { this.options.destination = v; return this }
  proxyAddress(v: string) { this.options.proxyAddress = v; return this }
  authToken(v: string) { this.options.authToken = v; return this }
  desktopSize(v: DesktopSize) { this.options.size = { width: v.width, height: v.height }; return this }
  renderCanvas(v: HTMLCanvasElement) { this.canvas = v; return this }
  setCursorStyleCallback(v: Function) { this.callbacks.cursor = v; return this }
  setCursorStyleCallbackContext(_: any) { return this }
  remoteClipboardChangedCallback(v: Function) { this.callbacks.clipboard = v; return this }
  forceClipboardUpdateCallback(v: Function) { this.callbacks.clipboardForce = v; return this }
  extension(v: Extension) { if (typeof v.value === 'function') this.callbacks[v.name] = v.value; else this.extensions[v.name] = v.value; return this }
  async connect() {
    const session = new WorkerSession(this.canvas, this.callbacks, this.extensions.canvas2d === true)
    try {
      const { audio_port: audioPort, ...extensions } = this.extensions
      extensions.presentation_regions = session.snapshotRegions
      extensions.presentation_trace = session.traceEnabled
      extensions.flow_trace = session.flowEnabled
      await session.call('connect', { options: this.options, extensions, callbacks: Object.keys(this.callbacks), audioPort }, audioPort ? [audioPort] : [])
      return session
    } catch (e) { session.free(); throw e }
    finally { this.options.password = ''; this.options.authToken = '' }
  }
  free() {}
}
class WorkerSession {
  private worker = new Worker(new URL('./session.worker.ts', import.meta.url), { type: 'module', name: 'uniterm-rdp' })
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private serial = 0
  private dead = false
  private observedCodecs = new Set<string>()
  private renderer: DesktopRenderer
  readonly snapshotRegions: 1 | 4
  readonly traceEnabled: boolean
  readonly flowEnabled: boolean
  constructor(canvas: HTMLCanvasElement, private callbacks: Record<string, Function>, canvas2d: boolean) {
    let snapshotRegions: 1 | 4 = 1, traceEnabled = false, flowEnabled = false
    const owner = canvas.ownerDocument?.defaultView
    try {
      snapshotRegions = owner?.sessionStorage.getItem('uniterm.rdp.snapshotRegions') === '4' ? 4 : 1
      traceEnabled = owner?.sessionStorage.getItem('uniterm.rdp.presentationTrace') === '1'
      flowEnabled = traceEnabled && owner?.sessionStorage.getItem('uniterm.rdp.flowTrace') === '1'
    } catch { /* Session storage may be unavailable under browser policy. */ }
    this.snapshotRegions = snapshotRegions; this.traceEnabled = traceEnabled; this.flowEnabled = flowEnabled
    const host = owner as (Window & TraceDrainCounters & { __unitermRdpTrace?: Record<string, unknown>[]; __unitermRdpTraceDropped?: number; __unitermRdpTraceWorkerDropped?: number; __unitermRdpTraceMainDropped?: number; __unitermRdpTraceWorkerPeakBatch?: number; __unitermRdpTraceWorkerDrainedEvents?: number }) | null
    if (traceEnabled && host) { host.__unitermRdpTrace = []; host.__unitermRdpTraceDropped = 0; host.__unitermRdpTraceWorkerDropped = 0; host.__unitermRdpTraceMainDropped = 0; host.__unitermRdpTraceWorkerPeakBatch = 0; host.__unitermRdpTraceWorkerDrainedEvents = 0; resetTraceDrains(host) }
    const appendTrace = (entry: Record<string, unknown>) => {
      if (!host?.__unitermRdpTrace) return
      if (host.__unitermRdpTrace.length < (flowEnabled ? 262144 : 65536)) host.__unitermRdpTrace.push(entry)
      else { host.__unitermRdpTraceDropped = (host.__unitermRdpTraceDropped ?? 0) + 1; host.__unitermRdpTraceMainDropped = (host.__unitermRdpTraceMainDropped ?? 0) + 1 }
    }
    const trace = traceEnabled ? (stage: string, id: number, detail: Record<string, number> = {}) => appendTrace({ ...detail, stage, id, time: performance.timeOrigin + performance.now() }) : undefined
    try { this.renderer = new DesktopRenderer(canvas, frameId => {
      if (frameId !== undefined) trace?.('ack-sent', frameId)
      this.post({ method: 'frameAck', frameId, hidden: canvas.ownerDocument.hidden })
    }, error => this.fail(error), canvas2d ? 'canvas2d' : 'auto', trace) }
    catch (e) { this.worker.terminate(); throw e }
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'frame') {
        trace?.('main-received', data.frameId, { updateSerial: data.updateSerial, updatedAt: data.updatedAt })
        if (data.patches) this.renderer.frameBatch(data.patches, data.frameId)
        else this.renderer.frame(data.bitmap, data.region, data.frameId)
        return
      }
      if (data.type === 'presentationTrace') {
        if (traceEnabled && host) {
          acceptTraceDrain(host, data.drainId)
          host.__unitermRdpTraceWorkerDropped = (host.__unitermRdpTraceWorkerDropped ?? 0) + (data.dropped ?? 0)
          host.__unitermRdpTraceWorkerPeakBatch = Math.max(host.__unitermRdpTraceWorkerPeakBatch ?? 0, data.events.length)
          host.__unitermRdpTraceWorkerDrainedEvents = (host.__unitermRdpTraceWorkerDrainedEvents ?? 0) + data.events.length
          for (const entry of data.events) appendTrace(entry)
          host.__unitermRdpTraceDropped = (host.__unitermRdpTraceDropped ?? 0) + (data.dropped ?? 0)
        }
        return
      }
      if (data.type === 'event') {
        if (data.name === 'workerError') { this.fail(new Error(data.args[0])); return }
        if (data.name === 'clipboard') { const c = new ClipboardData(); c.entries = data.args[0]; data.args = [c] }
        this.callbacks[data.name]?.(...data.args); return
      }
      if (data.type === 'stats') {
        canvas.dataset.rdpStats = JSON.stringify({ ...data.stats, renderer: this.renderer.mode, presentation: this.renderer.stats })
        // Report actual codec use once per kind, using the existing 1 Hz stats.
        for (const [kind, counter] of [['avc-decoded', 'avcFrames'], ['gpu-avc420', 'gpuAvc420Frames'], ['gpu-avc444', 'gpuAvc444Frames']]) {
          if (data.stats[counter!] > 0 && !this.observedCodecs.has(kind!)) {
            this.observedCodecs.add(kind!)
            this.callbacks.rdp_diagnostic?.({ phase: 'codec-observed', kind, renderer: this.renderer.mode, avcFrames: data.stats.avcFrames, gpuAvc420Frames: data.stats.gpuAvc420Frames, gpuAvc444Frames: data.stats.gpuAvc444Frames })
          }
        }
        return
      }
      const p = this.pending.get(data.id); if (!p) return
      this.pending.delete(data.id)
      if (data.error) p.reject(new Error(data.error))
      else p.resolve(data.result)
    }
    this.worker.onerror = e => { e.preventDefault(); this.fail(new Error('RDP worker failed')) }
    this.worker.onmessageerror = () => this.fail(new Error('RDP worker message failed'))
  }
  private post(value: any, transfer: Transferable[] = []) { if (!this.dead) this.worker.postMessage(value, transfer) }
  call(method: string, value?: any, transfer: Transferable[] = []): Promise<any> {
    if (this.dead) return Promise.reject(new Error('RDP session ended'))
    const id = ++this.serial
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.post({ id, method, value }, transfer) })
  }
  private fail(error: Error) { for (const p of this.pending.values()) p.reject(error); this.pending.clear(); this.free() }
  run() { return this.call('run').then(reason => ({ reason: () => reason, free() {} })) }
  applyInputs(tx: InputTransaction) { this.post({ method: 'inputs', value: tx.events }) }
  releaseAllInputs() { this.post({ method: 'releaseAllInputs' }) }
  resize(...args: any[]) { this.post({ method: 'resize', value: args }) }
  invokeExtension(e: Extension) { return this.call('extension', { name: e.name, value: e.value }) }
  onClipboardPaste(c: ClipboardData) { return this.call('clipboard', c.entries) }
  synchronizeLockKeys(...args: boolean[]) { this.post({ method: 'synchronizeLockKeys', value: args }) }
  supportsUnicodeKeyboardShortcuts() { return false }
  shutdown() { this.free() }
  free() {
    if (this.dead) return
    this.dead = true; this.worker.terminate(); this.renderer.dispose()
    for (const p of this.pending.values()) p.reject(new Error('RDP session ended'))
    this.pending.clear()
  }
}
