/* Runs on the audio rendering thread. No DOM, timers, per-quantum allocation,
 * or dependency on main-thread scheduling. Incoming PCM comes from a worker. */
class UnitermPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.capacity = 48002
    this.left = new Float32Array(this.capacity)
    this.right = new Float32Array(this.capacity)
    this.read = 0; this.length = 0; this.phase = 0; this.rate = 48000
    this.target = .12; this.jitter = 0; this.lastArrival = null; this.lastWallArrival = null; this.lastDuration = 0
    this.playing = false; this.active = true; this.enabled = true; this.ended = true; this.starving = false; this.reserveAdjusted = false
    this.missing = 0; this.volume = [1, 1]; this.elapsed = 0; this.input = null
    this.counters = { packets: 0, bytes: 0, underruns: 0, missingMs: 0, overflows: 0, droppedMs: 0, maxArrivalGapMs: 0, maxWallArrivalGapMs: 0, maxQueuedMs: 0 }
    this.format = { sampleRate: 0, channels: 0, bits: 0 }
    this.port.onmessage = ({data}) => {
      if (data.type === 'attach') {
        if (this.input) this.input.close()
        this.input = data.port
        this.input.onmessage = ({data: m}) => {
          this.message(m)
          if (m.type === 'pcm') this.input.postMessage({ type: 'consumed', bytes: m.data?.byteLength || 0 })
        }
        this.input.start()
      } else this.message(data)
    }
  }
  reset() {
    this.read = 0; this.length = 0; this.phase = 0
    this.playing = false; this.ended = true; this.starving = false; this.reserveAdjusted = false; this.missing = 0
    this.lastArrival = null; this.lastWallArrival = null; this.lastDuration = 0; this.target = .12; this.jitter = 0
  }
  message(m) {
    if (m.type === 'active') { this.active = m.value; this.reset(); return }
    if (m.type === 'enabled') { this.enabled = m.value; this.reset(); return }
    if (m.type === 'reset') { this.reset(); return }
    if (m.type === 'end') { this.ended = true; this.lastArrival = null; this.lastWallArrival = null; return }
    if (m.type === 'volume') { this.volume = [m.left, m.right].map(v => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1); return }
    if (m.type !== 'pcm' || !this.enabled || !this.active) return
    const {data, rate, channels, bits} = m
    if (!(data instanceof Uint8Array) || !Number.isInteger(rate) || rate < 8000 || rate > 48000 || ![1,2].includes(channels) || ![8,16].includes(bits)) return
    const stride = channels * bits / 8
    if (!data.length || data.length % stride || data.length > rate * stride) return
    if (this.rate !== rate) { this.reset(); this.rate = rate }
    const frames = data.length / stride, duration = frames / rate
    const wallArrival=Date.now()
    if(this.lastWallArrival!==null)this.counters.maxWallArrivalGapMs=Math.max(this.counters.maxWallArrivalGapMs,wallArrival-this.lastWallArrival)
    this.lastWallArrival=wallArrival
    if (this.lastArrival !== null) {
      const gap = Math.max(0, currentTime - this.lastArrival)
      this.counters.maxArrivalGapMs = Math.max(this.counters.maxArrivalGapMs, gap * 1000)
      this.jitter += (Math.abs(gap - this.lastDuration) - this.jitter) / 16
      this.target = Math.max(Math.min(.3, .08 + 4 * this.jitter), this.target - duration * .005)
    }
    if (this.starving && !this.reserveAdjusted) {
      this.target = Math.min(.3, this.target + this.missing / sampleRate + .02)
      // Keep counting the recovery silence until playout actually resumes.
      this.reserveAdjusted = true
    }
    this.lastArrival = currentTime; this.lastDuration = duration; this.ended = false
    this.counters.packets++; this.counters.bytes += data.length
    this.format = { sampleRate: rate, channels, bits }
    // Bound latency to 750ms, retaining the newest tail during real congestion.
    const max = Math.floor(rate * .75)
    if (this.length + frames > max) {
      const drop = this.length + frames - max
      const old = Math.min(this.length, Math.max(0, drop))
      this.read = (this.read + old) % this.capacity; this.length -= old; this.phase = 0
      this.counters.overflows++; this.counters.droppedMs += old / rate * 1000
    }
    const skip = Math.max(0, frames - max)
    this.counters.droppedMs += skip / rate * 1000
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let i = skip; i < frames; i++) {
      const at = (this.read + this.length) % this.capacity
      const a = i * stride, b = a + (channels === 2 ? bits / 8 : 0)
      this.left[at] = bits === 16 ? view.getInt16(a, true) / 32768 : (view.getUint8(a) - 128) / 128
      this.right[at] = bits === 16 ? view.getInt16(b, true) / 32768 : (view.getUint8(b) - 128) / 128
      this.length++
    }
    this.counters.maxQueuedMs = Math.max(this.counters.maxQueuedMs, this.length / this.rate * 1000)
  }
  process(_inputs, outputs) {
    const out = outputs[0]
    if (!out?.[0]) return true
    const frames = out[0].length, step = this.rate / sampleRate
    // Keep one packet plus the reserve before starting: large Windows packets
    // must not consume the entire reserve as soon as the first block plays.
    if (!this.playing && this.length >= (this.ended ? 1 : Math.ceil(Math.min(.75, this.target + this.lastDuration) * this.rate))) {
      this.playing = true; this.starving = false; this.reserveAdjusted = false; this.missing = 0
    }
    for (let i = 0; i < frames; i++) {
      if (!this.enabled || !this.playing || this.length < 1) {
        out[0][i] = 0; if (out[1]) out[1][i] = 0
        if (this.playing && !this.ended) {
          if (!this.starving) { this.starving = true; this.counters.underruns++ }
          this.playing = false
        }
        if (this.starving && !this.ended) {
          this.missing++; this.counters.missingMs += 1000 / sampleRate
        }
        continue
      }
      const next = (this.read + Math.min(1, this.length - 1)) % this.capacity
      out[0][i] = (this.left[this.read] + (this.left[next] - this.left[this.read]) * this.phase) * this.volume[0]
      if (out[1]) out[1][i] = (this.right[this.read] + (this.right[next] - this.right[this.read]) * this.phase) * this.volume[1]
      this.phase += step
      const consume = Math.min(this.length, Math.floor(this.phase))
      this.read = (this.read + consume) % this.capacity; this.length -= consume; this.phase -= consume
      if (!this.length) this.phase = 0
    }
    this.elapsed += frames
    if (this.elapsed >= sampleRate / 4) {
      this.elapsed = 0
      this.port.postMessage({type:'stats',stats:{...this.counters,...this.format,backend:'audio-worklet',renderSampleRate:sampleRate,enabled:this.enabled,queuedMs:this.length/this.rate*1000,targetMs:this.target*1000,jitterMs:this.jitter*1000,sources:0}})
    }
    return true
  }
}
registerProcessor('uniterm-pcm', UnitermPcmProcessor)
