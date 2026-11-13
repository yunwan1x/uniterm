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
import { androidErrorMessage } from './errors'
import { PcmAudioPlayer } from '../utils/pcmAudio'
export const androidClients = new Map<string, AndroidClient>()
export class AndroidClient {
  canvas = document.createElement('canvas')
  ws: WebSocket
  width = 720
  height = 1280
  frames = 0
  videoSource: 'display' | 'front' | 'back' = 'display'
  mode = ''
  error = ''
  connected = false
  changed = () => {}
  private decoder: TinyH264Decoder | WebCodecsVideoDecoder
  private audio: PcmAudioPlayer | null = null
  private nextAudioStats = 0
  private pending = 0
  private chain = Promise.resolve()
  private disposed = false
  private startupTimer: ReturnType<typeof setTimeout> | undefined
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
    this.startupTimer = setTimeout(() => this.fail('Android connection timed out: no video received. Check wireless debugging, device authorization and network reachability.'), 45000)
    this.ws.onmessage = (e) => {
      if (this.disposed) return
      if (typeof e.data === 'string') {
        let m
        try { m = JSON.parse(e.data) } catch {
          this.fail('Invalid response from Android session server')
          return
        }
        if (m?.error) {
          this.fail(androidErrorMessage(m.error))
          return
        }
        if (!m || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width <= 0 || m.height <= 0) {
          this.fail('Invalid Android video metadata')
          return
        }
        this.videoSource = m.videoSource ?? 'display'
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
            if (packet.type === 'data') clearTimeout(this.startupTimer)
            this.frames = this.decoder.framesRendered
            this.changed()
          }
        })
        .catch((e) => {
          this.fail(androidErrorMessage(e))
        })
        .finally(() => {
          this.pending -= data.length
        })
    }
    this.ws.onerror = () => {
      if (!this.disposed) this.fail('Android stream connection failed. Check server connectivity and reconnect.')
    }
    this.ws.onclose = (event) => {
      if (this.disposed) return
      if (!this.error) this.error = `Android connection closed${event?.code ? ` (${event.code})` : ''}${event?.reason ? `: ${event.reason}` : '; reconnect'}`
      this.connected = false
      this.dispose()
      androidClients.delete(url)
      this.changed()
    }
  }
  private fail(message: string) {
    if (this.disposed) return
    this.error = message
    this.dispose()
  }
  send(message: object) {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(message))
  }
  enableAudio() {
    if (this.disposed) return
    // Retain Android's gesture-driven activation; never queue sound from before
    // the user enabled playback. Each desktop owns an independent player.
    if (!this.audio) this.audio = new PcmAudioPlayer(() => {},
      () => new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }))
    this.audio.unlock()
  }
  private playAudio(data: Uint8Array) {
    if (!this.audio || data.length < 4 || data.length % 4 !== 0) return
    try {
      // scrcpy audio_codec=raw supplies signed LE PCM, 48kHz stereo, 16-bit.
      this.audio.pcm(data, 48000, 2, 16)
      if (performance.now() >= this.nextAudioStats) {
        this.canvas.dataset.androidAudioStats = JSON.stringify(this.audio.getStats())
        this.nextAudioStats = performance.now() + 1000
      }
    } catch (error) {
      // Audio/device failures must not interrupt video or input handling.
      this.canvas.dataset.androidAudioError = String(error)
    }
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
    clearTimeout(this.startupTimer)
    if (androidClients.get(this.url) === this) androidClients.delete(this.url)
    this.connected = false
    this.ws.close()
    this.decoder.dispose()
    this.audio?.dispose()
    if (this.audio) this.canvas.dataset.androidAudioStats = JSON.stringify(this.audio.getStats())
    this.changed()
  }
}
