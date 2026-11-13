import { TinyH264Decoder } from '@yume-chan/scrcpy-decoder-tinyh264'
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
} from '@yume-chan/scrcpy-decoder-webcodecs'
import {
  ScrcpyVideoCodecId,
  type ScrcpyMediaStreamPacket,
} from '@yume-chan/scrcpy'
import { toWebSocketURL } from '../utils/webSocketUrl'
export const androidClients = new Map<string, AndroidClient>()
export class AndroidClient {
  canvas = document.createElement('canvas')
  ws: WebSocket
  width = 720
  height = 1280
  frames = 0
  mode = ''
  error = ''
  connected = false
  changed = () => {}
  private decoder: TinyH264Decoder | WebCodecsVideoDecoder
  private audio: AudioContext | null = null
  private nextAudio = 0
  private pending = 0
  private chain = Promise.resolve()
  private disposed = false
  constructor(public url: string) {
    if (WebCodecsVideoDecoder.isSupported) {
      this.decoder = new WebCodecsVideoDecoder({
        codec: ScrcpyVideoCodecId.H264,
        renderer: new BitmapVideoFrameRenderer(this.canvas),
      })
      this.mode = 'WebCodecs'
    } else {
      this.decoder = new TinyH264Decoder({ canvas: this.canvas })
      this.mode = 'H.264 software'
    }
    this.decoder.sizeChanged(({ width, height }) => {
      this.width = width
      this.height = height
      this.changed()
    })
    const writer = this.decoder.writable.getWriter()
    this.ws = new WebSocket(toWebSocketURL(url))
    this.ws.binaryType = 'arraybuffer'
    this.ws.onmessage = (e) => {
      if (this.disposed) return
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data)
        if (m.error) {
          this.error = m.error
          this.changed()
          return
        }
        this.width = m.width
        this.height = m.height
        this.connected = true
        this.changed()
        return
      }
      const bytes = new Uint8Array(e.data)
      if (bytes.length < 13) return
      if (bytes[0] === 2) {
        this.playAudio(bytes.subarray(13))
        return
      }
      const view = new DataView(bytes.buffer)
      const flags = view.getBigUint64(1)
      const data = bytes.subarray(13)
      const packet: ScrcpyMediaStreamPacket =
        flags >> 63n
          ? { type: 'configuration', data }
          : {
              type: 'data',
              data,
              pts: flags & ((1n << 62n) - 1n),
              keyframe: !!(flags & (1n << 62n)),
            }
      this.pending += data.length
      if (this.pending > 8 * 1024 * 1024) {
        this.error = 'Video decoder cannot keep up; reconnect'
        this.dispose()
        return
      }
      this.chain = this.chain
        .then(async () => {
          if (!this.disposed) {
            await writer.write(packet)
            this.frames = this.decoder.framesRendered
            this.changed()
          }
        })
        .catch((e) => {
          this.error = String(e)
          this.dispose()
        })
        .finally(() => {
          this.pending -= data.length
        })
    }
    this.ws.onerror = () => {
      this.error = 'Android connection failed'
      this.changed()
    }
    this.ws.onclose = () => {
      if (!this.error) this.error = 'Android connection closed; reconnect'
      this.connected = false
      this.dispose()
      androidClients.delete(url)
      this.changed()
    }
  }
  send(message: object) {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(message))
  }
  enableAudio() {
    if (!this.audio) this.audio = new AudioContext({ sampleRate: 48000 })
    void this.audio.resume()
  }
  private playAudio(data: Uint8Array) {
    const ctx = this.audio
    if (!ctx || ctx.state !== 'running' || data.length < 4) return
    const count = Math.floor(data.length / 4),
      buf = ctx.createBuffer(2, count, 48000),
      v = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let ch = 0; ch < 2; ch++) {
      const samples = buf.getChannelData(ch)
      for (let i = 0; i < count; i++)
        samples[i] = v.getInt16(i * 4 + ch * 2, true) / 32768
    }
    if (this.nextAudio > ctx.currentTime + 0.25) return
    const source = ctx.createBufferSource()
    source.buffer = buf
    source.connect(ctx.destination)
    this.nextAudio = Math.max(ctx.currentTime + 0.015, this.nextAudio)
    source.start(this.nextAudio)
    this.nextAudio += buf.duration
  }
  httpURL(op: string, path: string) {
    const url = new URL(toWebSocketURL(this.url))
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.search = new URLSearchParams({ op, path }).toString()
    return url.toString()
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.connected = false
    this.ws.close()
    this.decoder.dispose()
    void this.audio?.close()
    this.changed()
  }
}
