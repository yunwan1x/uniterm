/** Worker-side PCM endpoint, replaceable without reconnecting the remote session. */
export class AudioTransport {
  private port: MessagePort | null = null
  private pending = 0
  constructor(private readonly control: MessagePort) {
    control.onmessage = ({ data }) => {
      if (data.type !== 'attach' && data.type !== 'detach') return
      if (this.port) { this.port.onmessage = null; this.port.close() }
      this.port = data.type === 'attach' ? data.port : null
      this.pending = 0
      const port = this.port
      if (port) {
        port.onmessage = ({ data: message }) => {
          if (this.port === port && message.type === 'consumed' && Number.isFinite(message.bytes)) this.pending = Math.max(0, this.pending - Math.max(0, message.bytes))
        }
        port.start()
      }
    }
    control.start()
  }
  close() {
    this.control.close()
    this.port?.close()
    this.port = null
    this.pending = 0
  }
  canSend(bytes: number) { return !!this.port && this.pending + bytes <= 256 * 1024 }
  send(message: any, transfer: Transferable[] = []) {
    if (!this.port) return
    if (message.type === 'pcm') {
      if (!this.canSend(message.data.byteLength)) return
      this.pending += message.data.byteLength
    }
    this.port.postMessage(message, transfer)
  }
}
