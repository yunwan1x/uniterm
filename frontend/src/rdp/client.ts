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
      await session.call('connect', { options: this.options, extensions: this.extensions, callbacks: Object.keys(this.callbacks) })
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
  private renderer: DesktopRenderer
  constructor(canvas: HTMLCanvasElement, private callbacks: Record<string, Function>, canvas2d: boolean) {
    try { this.renderer = new DesktopRenderer(canvas, () => this.post({ method: 'frameAck' }), () => this.fail(new Error('RDP WebGL context lost')), canvas2d ? 'canvas2d' : 'auto') }
    catch (e) { this.worker.terminate(); throw e }
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'frame') { this.renderer.frame(data.bitmap); return }
      if (data.type === 'event') {
        if (data.name === 'workerError') { this.fail(new Error(data.args[0])); return }
        if (data.name === 'clipboard') { const c = new ClipboardData(); c.entries = data.args[0]; data.args = [c] }
        this.callbacks[data.name]?.(...data.args); return
      }
      if (data.type === 'stats') {
        canvas.dataset.rdpStats = JSON.stringify({ ...data.stats, renderer: this.renderer.mode })
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
  private post(value: any) { if (!this.dead) this.worker.postMessage(value) }
  call(method: string, value?: any): Promise<any> {
    if (this.dead) return Promise.reject(new Error('RDP session ended'))
    const id = ++this.serial
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.post({ id, method, value }) })
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
