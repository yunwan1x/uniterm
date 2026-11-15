export interface PresentationTraceEvent {
  stage: string
  id: number
  /** Epoch milliseconds, shared by document and Worker presentation events. */
  time: number
  [key: string]: string | number
}

export interface PresentationTraceBatch {
  events: PresentationTraceEvent[]
  dropped: number
}

const MAX_CAPACITY = 65536
const MAX_METADATA_FIELDS = 16

/** Optional, bounded diagnostics. Callers supply stage names and numeric timing/size data only. */
export class PresentationTrace {
  private active: boolean
  private events: PresentationTraceEvent[] = []
  private dropped = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private heartbeatSerial = 0
  private readonly capacity: number

  constructor(enabled = false, capacity = 4096) {
    this.active = enabled
    this.capacity = Number.isSafeInteger(capacity) && capacity > 0 ? Math.min(capacity, MAX_CAPACITY) : 4096
  }

  get enabled() { return this.active }

  record(stage: string, id: number, detail?: Record<string, number>) {
    if (!this.active) return
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(stage) || !Number.isFinite(id)) return
    if (this.events.length >= this.capacity) { this.dropped++; return }
    const entry: PresentationTraceEvent = { stage, id, time: performance.timeOrigin + performance.now() }
    if (detail) {
      let fields = 0
      for (const key of Object.keys(detail)) {
        if (fields === MAX_METADATA_FIELDS) break
        const value = detail[key]
        if (key === 'stage' || key === 'id' || key === 'time' || !/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(key)) continue
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        entry[key] = value
        fields++
      }
    }
    this.events.push(entry)
  }

  /** Moves ownership of the batch to the caller; the next batch starts empty. */
  drain(): PresentationTraceBatch {
    const batch = { events: this.events, dropped: this.dropped }
    this.events = []
    this.dropped = 0
    return batch
  }

  /** Records delayed callbacks, without inferring whether CPU, GC or scheduling caused the delay. */
  startHeartbeat(intervalMs = 50, lateThresholdMs = 20) {
    if (!this.active || this.timer !== undefined) return
    if (!Number.isFinite(intervalMs) || intervalMs < 10 || !Number.isFinite(lateThresholdMs) || lateThresholdMs < 0) return
    const schedule = () => {
      const expected = performance.now() + intervalMs
      this.timer = setTimeout(() => {
        this.timer = undefined
        if (!this.active) return
        const delayMs = performance.now() - expected
        const id = ++this.heartbeatSerial
        if (delayMs >= lateThresholdMs) this.record('worker-lag', id, {
          dueAt: performance.timeOrigin + expected, delayMs, intervalMs,
        })
        // Start at the actual callback time: never run catch-up heartbeats after a pause.
        schedule()
      }, intervalMs)
    }
    schedule()
  }

  stopHeartbeat() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  dispose() {
    this.stopHeartbeat()
    this.active = false
    this.events = []
    this.dropped = 0
  }
}
