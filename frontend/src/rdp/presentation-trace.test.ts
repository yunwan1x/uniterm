import { afterEach, describe, expect, it, vi } from 'vitest'
import { PresentationTrace } from './presentation-trace'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('PresentationTrace', () => {
  it('does not read the clock or create timers when disabled', () => {
    const clock = vi.spyOn(performance, 'now')
    const timer = vi.spyOn(globalThis, 'setTimeout')
    const trace = new PresentationTrace()
    trace.record('frame-sent', 1, { width: 1920 })
    trace.startHeartbeat()
    expect(trace.enabled).toBe(false)
    expect(clock).not.toHaveBeenCalled()
    expect(timer).not.toHaveBeenCalled()
    expect(trace.drain()).toEqual({ events: [], dropped: 0 })
  })

  it('preserves frame stages and epoch timestamps for presentation correlation', () => {
    vi.spyOn(performance, 'now').mockReturnValue(125)
    const trace = new PresentationTrace(true)
    trace.record('main-received', 7, { updateSerial: 9, updatedAt: 110, width: 1920 })
    trace.record('ack-received', 7)
    expect(trace.drain()).toEqual({ events: [
      { stage: 'main-received', id: 7, time: performance.timeOrigin + 125, updateSerial: 9, updatedAt: 110, width: 1920 },
      { stage: 'ack-received', id: 7, time: performance.timeOrigin + 125 },
    ], dropped: 0 })
  })

  it('bounds retained events, reports overflow and transfers an independent batch', () => {
    const trace = new PresentationTrace(true, 2)
    trace.record('snapshot-start', 1)
    trace.record('snapshot-ready', 1)
    trace.record('frame-sent', 1)
    trace.record('main-received', 1)
    const first = trace.drain()
    expect(first.events.map(event => event.stage)).toEqual(['snapshot-start', 'snapshot-ready'])
    expect(first.dropped).toBe(2)
    trace.record('ack-received', 1)
    const next = trace.drain()
    expect(next.events.map(event => event.stage)).toEqual(['ack-received'])
    expect(next.dropped).toBe(0)
    expect(first.events).toHaveLength(2)
    expect(trace.drain()).toEqual({ events: [], dropped: 0 })
  })

  it('retains bounded numeric metadata and protects correlation fields', () => {
    const trace = new PresentationTrace(true)
    trace.record('damage', 2, {
      x: 10, width: 320, invalid: NaN, infinite: Infinity, stage: 99, id: 99, time: 99,
      payload: 'unrecorded text', nested: { value: 1 },
    } as unknown as Record<string, number>)
    const event = trace.drain().events[0]!
    expect(event).toMatchObject({ stage: 'damage', id: 2, x: 10, width: 320 })
    expect(Object.keys(event).sort()).toEqual(['id', 'stage', 'time', 'width', 'x'])
    trace.record('damage', 3, Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, i])))
    expect(Object.keys(trace.drain().events[0]!)).toHaveLength(19)
    trace.record('message body', 4)
    trace.record('damage', NaN)
    expect(trace.drain().events).toHaveLength(0)
  })

  it('records only late heartbeat callbacks and avoids catch-up timer bursts', () => {
    vi.useFakeTimers()
    let elapsed = 0
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
    const trace = new PresentationTrace(true)
    trace.startHeartbeat()
    trace.startHeartbeat()
    expect(vi.getTimerCount()).toBe(1)
    elapsed = 50
    vi.advanceTimersByTime(50)
    expect(trace.drain().events).toHaveLength(0)
    elapsed = 125
    vi.advanceTimersByTime(50)
    expect(trace.drain()).toEqual({ events: [{
      stage: 'worker-lag', id: 2, time: performance.timeOrigin + 125,
      dueAt: performance.timeOrigin + 100, delayMs: 25, intervalMs: 50,
    }], dropped: 0 })
    expect(vi.getTimerCount()).toBe(1)
    elapsed = 175
    vi.advanceTimersByTime(50)
    expect(trace.drain().events).toHaveLength(0)
    trace.stopHeartbeat()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up timers and prevents recording or restarting after disposal', () => {
    vi.useFakeTimers()
    const trace = new PresentationTrace(true)
    trace.startHeartbeat()
    trace.record('snapshot-start', 1)
    trace.dispose()
    trace.startHeartbeat()
    trace.record('snapshot-ready', 1)
    expect(trace.enabled).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(trace.drain()).toEqual({ events: [], dropped: 0 })
  })
})
