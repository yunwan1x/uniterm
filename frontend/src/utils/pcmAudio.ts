/** Shared bounded PCM playback for remote desktops. Volume remains remote-controlled. */
export function decodePcm(data: Uint8Array, channels: number, bits: number): Float32Array<ArrayBuffer>[] {
  if ((channels !== 1 && channels !== 2) || (bits !== 8 && bits !== 16)) throw new Error('Unsupported PCM format')
  const bytes = bits / 8
  if (data.byteLength % (channels * bytes)) throw new Error('Incomplete PCM frame')
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

type AudioChunk = { buffer: AudioBuffer; offset: number; duration: number }
type ScheduledAudio = AudioChunk & { start: number; end: number }

export class PcmAudioPlayer {
  private context: AudioContext | null = null
  private splitter: ChannelSplitterNode | null = null
  private gains: GainNode[] = []
  private sources = new Map<AudioBufferSourceNode, ScheduledAudio>()
  private target = 0.12
  private jitter = 0
  private lastArrival: number | null = null
  private lastDuration = 0
  private streamEnded = true
  private counters = { packets: 0, bytes: 0, underruns: 0, missingMs: 0, overflows: 0, droppedMs: 0, maxArrivalGapMs: 0, maxQueuedMs: 0 }
  private format = { sampleRate: 0, channels: 0, bits: 0 }
  private nextTime = 0
  private volume = [1, 1]
  private disposed = false
  private enabled = true

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
    ctx.onstatechange = () => {
      if (this.disposed || !this.enabled) return
      if (ctx.state !== 'running') this.clear()
      this.onBlocked(ctx.state !== 'running')
    }
    return ctx
  }

  /** Must also be called synchronously from a trusted pointer/key gesture. */
  unlock() {
    if (!this.enabled || this.disposed) return
    try {
      const ctx = this.ensureContext()
      if (!ctx || ctx.state === 'running') { if (ctx) this.onBlocked(false); return }
      void ctx.resume().then(() => { if (!this.disposed && this.enabled) this.onBlocked(ctx.state !== 'running') }).catch(() => {
        if (!this.disposed && this.enabled) this.onBlocked(true)
      })
    } catch { /* No Web Audio implementation; never break the RDP connection. */ }
  }

  pcm(data: Uint8Array, sampleRate: number, channels: number, bits: number) {
    if (this.disposed || !this.enabled || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) return
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
    const planes = decodePcm(data, channels, bits)
    const now = ctx.currentTime
    const duration = planes[0].length / sampleRate
    this.counters.packets++
    this.counters.bytes += data.byteLength
    this.format = { sampleRate, channels, bits }
    // Measure arrival variation against the duration of the preceding packet.
    // Change the reserve used at the NEXT start/rebuffer; never move a healthy
    // playback timeline just because the estimate changed.
    if (this.lastArrival !== null) {
      const gap = Math.max(0, now - this.lastArrival)
      this.counters.maxArrivalGapMs = Math.max(this.counters.maxArrivalGapMs, gap * 1000)
      this.jitter += (Math.abs(gap - this.lastDuration) - this.jitter) / 16
      const desired = Math.min(0.15, 0.08 + 4 * this.jitter)
      this.target = Math.max(desired, this.target - duration * 0.005)
    }
    this.lastArrival = now
    this.lastDuration = duration
    if (this.nextTime <= now) {
      if (!this.streamEnded && this.nextTime > 0 && now - this.nextTime > 0.001) {
        this.counters.underruns++
        this.counters.missingMs += (now - this.nextTime) * 1000
        this.target = Math.min(0.15, this.target + 0.02)
      }
      this.nextTime = now + this.target
    }
    this.streamEnded = false
    const buffer = ctx.createBuffer(2, planes[0].length, sampleRate)
    buffer.copyToChannel(planes[0], 0)
    buffer.copyToChannel(planes[1], 1)
    const chunk = { buffer, offset: 0, duration }
    // Remove finished entries even if main-thread onended callbacks were delayed.
    for (const [source, item] of this.sources) {
      if (item.end <= now) { source.onended = null; source.disconnect(); this.sources.delete(source) }
    }
    if (this.nextTime + duration - now > 0.5 || this.sources.size >= 512) this.trimBacklog(chunk, now)
    else this.schedule(chunk)
    this.counters.maxQueuedMs = Math.max(this.counters.maxQueuedMs, (this.nextTime - now) * 1000)
  }

  private schedule(chunk: AudioChunk) {
    const source = this.context!.createBufferSource()
    source.buffer = chunk.buffer
    source.connect(this.splitter!)
    source.onended = () => { this.sources.delete(source); source.disconnect() }
    const start = this.nextTime
    this.nextTime += chunk.duration
    this.sources.set(source, { ...chunk, start, end: this.nextTime })
    source.start(start, chunk.offset, chunk.duration)
  }

  private trimBacklog(incoming: AudioChunk, now: number) {
    this.counters.overflows++
    const future: AudioChunk[] = []
    let protectedEnd = now
    // Preserve the current/imminent segment. Only replace not-yet-playing
    // backlog, retaining its newest tail instead of stopping all audio.
    for (const [source, item] of this.sources) {
      if (item.start <= now + 0.005) { protectedEnd = Math.max(protectedEnd, item.end); continue }
      future.push(item)
      source.onended = null
      source.stop()
      source.disconnect()
      this.sources.delete(source)
    }
    future.push(incoming)
    const total = future.reduce((sum, item) => sum + item.duration, 0)
    const budget = Math.min(this.target, Math.max(0, 0.5 - (protectedEnd - now)))
    let remaining = budget
    const retained: AudioChunk[] = []
    for (let i = future.length - 1; i >= 0 && remaining > 0.000001 && retained.length < 256; i--) {
      const item = future[i]
      const duration = Math.min(item.duration, remaining)
      retained.unshift({ buffer: item.buffer, offset: item.offset + item.duration - duration, duration })
      remaining -= duration
    }
    this.counters.droppedMs += Math.max(0, total - (budget - remaining)) * 1000
    this.nextTime = protectedEnd > now ? protectedEnd : now + this.target
    for (const item of retained) this.schedule(item)
  }

  /** End of a remote audio stream; let its already queued tail finish. */
  end() {
    this.streamEnded = true
    this.lastArrival = null
    this.lastDuration = 0
  }

  getStats() {
    return { ...this.counters, ...this.format, enabled: this.enabled, queuedMs: Math.max(0, this.nextTime - (this.context?.currentTime ?? 0)) * 1000,
      targetMs: this.target * 1000, jitterMs: this.jitter * 1000, sources: this.sources.size, state: this.disposed ? 'closed' : this.context?.state ?? 'uninitialized' }
  }

  /** Local playback switch; remote volume remains independent. */
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled || this.disposed) return
    this.enabled = enabled
    if (!enabled) {
      this.clear()
      this.onBlocked(false)
    }
  }

  setVolume(left: number, right: number) {
    this.volume = [left, right].map(v => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1)
    this.gains.forEach((gain, i) => gain.gain.setValueAtTime(this.volume[i], this.context!.currentTime))
  }

  clear() {
    for (const source of this.sources.keys()) {
      source.onended = null
      try { source.stop(); source.disconnect() } catch { /* Already ended. */ }
    }
    this.sources.clear()
    this.nextTime = 0
    this.end()
    this.jitter = 0
    this.target = 0.12
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
