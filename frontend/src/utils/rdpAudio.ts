/** RDP PCM playback. Volume is controlled by the remote server, not a second UI. */
export function decodeRdpPcm(data: Uint8Array, channels: number, bits: number): Float32Array<ArrayBuffer>[] {
  if ((channels !== 1 && channels !== 2) || (bits !== 8 && bits !== 16)) throw new Error('Unsupported RDP PCM format')
  const bytes = bits / 8
  if (data.byteLength % (channels * bytes)) throw new Error('Incomplete RDP PCM frame')
  const frames = data.byteLength / (channels * bytes)
  const output = Array.from({ length: 2 }, () => new Float32Array(frames))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 2; c++) {
      const offset = (i * channels + Math.min(c, channels - 1)) * bytes
      output[c][i] = bits === 16 ? view.getInt16(offset, true) / 32768 : (view.getUint8(offset) - 128) / 128
    }
  }
  return output
}

export class RdpAudioPlayer {
  private context: AudioContext | null = null
  private splitter: ChannelSplitterNode | null = null
  private gains: GainNode[] = []
  private sources = new Set<AudioBufferSourceNode>()
  private nextTime = 0
  private volume = [1, 1]
  private disposed = false

  constructor(private readonly onBlocked: (blocked: boolean) => void,
    private readonly createContext = () => new AudioContext({ latencyHint: 'interactive' })) {}

  private ensureContext() {
    if (this.disposed) return null
    if (this.context) return this.context
    const ctx = this.createContext()
    this.context = ctx
    this.splitter = ctx.createChannelSplitter(2)
    const merger = ctx.createChannelMerger(2)
    this.gains = [ctx.createGain(), ctx.createGain()]
    this.gains.forEach((gain, i) => {
      gain.gain.value = this.volume[i]
      this.splitter!.connect(gain, i)
      gain.connect(merger, 0, i)
    })
    merger.connect(ctx.destination)
    ctx.onstatechange = () => { if (!this.disposed) this.onBlocked(ctx.state !== 'running') }
    return ctx
  }

  /** Must also be called synchronously from a trusted pointer/key gesture. */
  unlock() {
    try {
      const ctx = this.ensureContext()
      if (!ctx || ctx.state === 'running') { if (ctx) this.onBlocked(false); return }
      void ctx.resume().then(() => { if (!this.disposed) this.onBlocked(ctx.state !== 'running') }).catch(() => {
        if (!this.disposed) this.onBlocked(true)
      })
    } catch { /* No Web Audio implementation; never break the RDP connection. */ }
  }

  pcm(data: Uint8Array, sampleRate: number, channels: number, bits: number) {
    if (this.disposed || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) return
    if (!data.byteLength || data.byteLength > sampleRate * channels * (bits / 8)) return
    const ctx = this.ensureContext()
    if (!ctx) return
    if (ctx.state !== 'running') {
      this.onBlocked(true)
      // Don't save stale sound while autoplay is blocked or the device is suspended.
      this.clear()
      this.unlock()
      return
    }
    const planes = decodeRdpPcm(data, channels, bits)
    // Bound latency and memory after network stalls; only fresh audio is useful.
    if (this.nextTime - ctx.currentTime > 0.25 || this.sources.size >= 64) this.clear()
    const buffer = ctx.createBuffer(2, planes[0].length, sampleRate)
    buffer.copyToChannel(planes[0], 0)
    buffer.copyToChannel(planes[1], 1)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.splitter!)
    source.onended = () => { this.sources.delete(source); source.disconnect() }
    this.sources.add(source)
    const start = Math.max(this.nextTime, ctx.currentTime + 0.02)
    source.start(start)
    this.nextTime = start + buffer.duration
  }

  setVolume(left: number, right: number) {
    this.volume = [left, right].map(v => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1)
    this.gains.forEach((gain, i) => gain.gain.setValueAtTime(this.volume[i], this.context!.currentTime))
  }

  clear() {
    for (const source of this.sources) {
      source.onended = null
      try { source.stop(); source.disconnect() } catch { /* Already ended. */ }
    }
    this.sources.clear()
    this.nextTime = 0
  }

  dispose() {
    this.disposed = true
    this.clear()
    if (this.context) {
      this.context.onstatechange = null
      void this.context.close().catch(() => {})
      this.context = null
    }
    this.splitter = null
    this.gains = []
    this.onBlocked(false)
  }
}
