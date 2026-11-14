/** Worker-owned socket keeps scroll/paint from stopping Android audio delivery. */
export class AndroidTransport {
  readyState: number = WebSocket.CONNECTING
  binaryType = 'arraybuffer'
  onmessage: ((event: { data: any }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  private worker: Worker
  private closed = false
  constructor(url: string) {
    this.worker = new Worker(new URL('./transport.worker.ts', import.meta.url), { type: 'module', name: 'uniterm-android-stream' })
    this.worker.onmessage = ({ data: m }) => {
      if (this.closed) return
      if (m.type === 'open') this.readyState = WebSocket.OPEN
      else if (m.type === 'message') {
        this.onmessage?.({ data: m.data })
        if (m.data instanceof ArrayBuffer && !this.closed) this.worker.postMessage({ type: 'ack', bytes: m.data.byteLength })
      } else if (m.type === 'error') this.onerror?.()
      else if (m.type === 'close') {
        this.readyState = WebSocket.CLOSED
        this.onclose?.({ code: m.code, reason: m.reason })
        this.close()
      }
    }
    this.worker.onerror = () => this.onerror?.()
    this.worker.postMessage({ type: 'connect', url })
  }
  attachAudio(port: MessagePort) {
    if (this.closed) { port.close(); return }
    this.worker.postMessage({ type: 'audio', port }, [port])
  }
  send(data: string) { if (!this.closed) this.worker.postMessage({ type: 'send', data }) }
  close() {
    if (this.closed) return
    this.closed = true; this.readyState = WebSocket.CLOSED
    this.worker.postMessage({ type: 'close' })
    this.worker.terminate()
  }
}
