export type CaptureKind = 'microphone' | 'camera'
type Invoke = (name: string, value: unknown) => Promise<any>

/** Streaming resampler retains fractional position across worklet blocks. */
export class PcmResampler {
  private samples: number[] = []
  private position = 0
  constructor(private inputRate: number, private outputRate: number, private channels: number) {
    if (inputRate <= 0 || outputRate < 8000 || outputRate > 48000 || ![1, 2].includes(channels)) throw new Error('Invalid PCM format')
  }
  push(input: Float32Array): Uint8Array {
    this.samples.push(...input)
    const output: number[] = [], step = this.inputRate / this.outputRate
    while (this.position + 1 < this.samples.length) {
      const i = Math.floor(this.position), fraction = this.position - i
      const sample = Math.max(-1, Math.min(1, this.samples[i] * (1 - fraction) + this.samples[i + 1] * fraction))
      const pcm = Math.round(sample * (sample < 0 ? 32768 : 32767))
      for (let c = 0; c < this.channels; c++) output.push(pcm)
      this.position += step
    }
    const consumed = Math.min(Math.floor(this.position), this.samples.length)
    this.samples.splice(0, consumed); this.position -= consumed
    const data = new Uint8Array(output.length * 2), view = new DataView(data.buffer)
    output.forEach((value, i) => view.setInt16(i * 2, value, true))
    return data
  }
}

export class RdpCapture {
  private streams: Partial<Record<CaptureKind, MediaStream>> = {}
  private requests = { microphone: 0, camera: 0 }
  private generation = 0
  private context: AudioContext | null = null
  private worklet: AudioWorkletNode | null = null
  private video: HTMLVideoElement | null = null
  private cameraTimer: ReturnType<typeof setInterval> | null = null
  constructor(private changed: () => void, private failed: (kind: CaptureKind, error: unknown) => void) {}
  enabled(kind: CaptureKind) { return !!this.streams[kind] }
  async enable(kind: CaptureKind): Promise<boolean> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('HTTPS_REQUIRED')
    const request = ++this.requests[kind]
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'microphone'
      ? { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false }
      : { audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 10, max: 10 } } })
    if (request !== this.requests[kind]) { stream.getTracks().forEach(t => t.stop()); return false }
    this.streams[kind]?.getTracks().forEach(t => t.stop())
    this.streams[kind] = stream
    stream.getTracks().forEach(track => { track.onended = () => { if (this.streams[kind] === stream) { this.disable(kind); this.failed(kind, new Error('DEVICE_ENDED')) } } })
    this.changed(); return true
  }
  disable(kind: CaptureKind) {
    this.requests[kind]++
    this.streams[kind]?.getTracks().forEach(t => { t.onended = null; t.stop() })
    delete this.streams[kind]
    if (kind === 'microphone') { this.worklet?.disconnect(); this.worklet = null; void this.context?.close().catch(() => {}); this.context = null }
    else { if (this.cameraTimer) clearInterval(this.cameraTimer); this.cameraTimer = null; if (this.video) { this.video.pause(); this.video.srcObject = null }; this.video = null }
    this.changed()
  }
  stopBridge() {
    this.generation++
    this.worklet?.disconnect(); this.worklet = null
    void this.context?.close().catch(() => {}); this.context = null
    if (this.cameraTimer) clearInterval(this.cameraTimer); this.cameraTimer = null
    if (this.video) { this.video.pause(); this.video.srcObject = null }; this.video = null
  }
  stopAll() { this.stopBridge(); this.disable('microphone'); this.disable('camera') }

  async attach(invoke: Invoke) {
    this.stopBridge()
    const generation = this.generation
    const mic = this.streams.microphone, camera = this.streams.camera
    const valid = (kind: CaptureKind, stream: MediaStream) => generation === this.generation && this.streams[kind] === stream
    if (mic) {
      try {
        const ctx = new AudioContext({ latencyHint: 'interactive' }); this.context = ctx
        await ctx.audioWorklet.addModule(new URL('./rdpMicWorklet.js', import.meta.url).href)
        if (!valid('microphone', mic)) return
        const worklet = new AudioWorkletNode(ctx, 'rdp-microphone'); this.worklet = worklet
        const source = ctx.createMediaStreamSource(mic), silence = ctx.createGain(); silence.gain.value = 0
        source.connect(worklet); worklet.connect(silence); silence.connect(ctx.destination)
        let formatKey = '', resampler: PcmResampler | null = null
        worklet.port.onmessage = async event => {
          try {
            if (!valid('microphone', mic)) return
            const format = await invoke('microphone_status', true)
            if (!valid('microphone', mic) || !Array.isArray(format) || format.length !== 3) { formatKey = ''; resampler = null; return }
            if (format.join(':') !== formatKey) { formatKey = format.join(':'); resampler = new PcmResampler(ctx.sampleRate, format[0], format[1]) }
            const data = resampler!.push(event.data)
            if (data.length) await invoke('microphone_data', { data, epoch: format[2] })
          } catch (error) { if (valid('microphone', mic)) { this.disable('microphone'); this.failed('microphone', error) } }
          finally { worklet.port.postMessage('ready') }
        }
        await ctx.resume()
      } catch (error) { if (valid('microphone', mic)) { this.disable('microphone'); this.failed('microphone', error) } }
    }
    if (camera && valid('camera', camera)) {
      try {
        const video = document.createElement('video'); this.video = video; video.muted = true; video.playsInline = true; video.srcObject = camera
        await video.play()
        if (!valid('camera', camera)) return
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
        const ctx = canvas.getContext('2d')!; let busy = false
        this.cameraTimer = setInterval(async () => {
          if (busy || !valid('camera', camera) || video.readyState < 2) return
          busy = true
          try {
            const epoch = await invoke('camera_requested', true)
            if (!epoch || !valid('camera', camera)) return
            ctx.drawImage(video, 0, 0, 640, 480)
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7))
            if (!blob || blob.type !== 'image/jpeg' || blob.size > 512 * 1024) throw new Error('CAMERA_ENCODING')
            const data = new Uint8Array(await blob.arrayBuffer())
            if (valid('camera', camera)) await invoke('camera_data', { data, epoch })
          } catch (error) { if (valid('camera', camera)) { this.disable('camera'); this.failed('camera', error) } }
          finally { busy = false }
        }, 100)
      } catch (error) { if (valid('camera', camera)) { this.disable('camera'); this.failed('camera', error) } }
    }
  }
}
