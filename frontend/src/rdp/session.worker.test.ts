import { afterEach, describe, expect, it, vi } from 'vitest'

const wasm = vi.hoisted(() => ({ connect: vi.fn(), shutdown: vi.fn(), run: vi.fn() }))
vi.mock('@ys-ll/ironrdp-wasm', () => ({
  default: vi.fn(), setup: vi.fn(), DesktopSize: class {},
  SessionBuilder: class {
    desktopSize() { return this }
    renderCanvas() { return this }
    password() { return this }
    authToken() { return this }
    connect() { return wasm.connect() }
    free() {}
  },
}))

afterEach(() => {
  vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules()
})

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() })
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

async function startWorker(options: { regions?: number; trace?: boolean; connectError?: Error } = {}) {
  vi.useFakeTimers()
  wasm.shutdown.mockReset()
  wasm.run.mockReset().mockResolvedValue({ reason: () => 'finished', free: vi.fn() })
  wasm.connect.mockReset()
  if (options.connectError) wasm.connect.mockRejectedValue(options.connectError)
  else wasm.connect.mockResolvedValue({ shutdown: wasm.shutdown, run: wasm.run, resize: vi.fn() })
  const postMessage = vi.fn(), scope: any = { postMessage }
  const ctx = { putImageData: vi.fn((..._args: any[]) => {}) }
  let canvas!: { width: number; height: number }
  vi.stubGlobal('self', scope)
  vi.stubGlobal('WebSocket', class {})
  vi.stubGlobal('OffscreenCanvas', class {
    private backingWidth: number
    private backingHeight: number
    constructor(width: number, height: number) { this.backingWidth = width; this.backingHeight = height; canvas = this }
    get width() { return this.backingWidth }
    set width(value: number) { this.backingWidth = value }
    get height() { return this.backingHeight }
    set height(value: number) { this.backingHeight = value }
    getContext() { return ctx }
  })
  const create = vi.fn(async (_source: any, _x: number, _y: number, width: number, height: number) => bitmap(width, height))
  vi.stubGlobal('createImageBitmap', create)
  await import('./session.worker')
  const message = (data: Record<string, unknown>) => scope.onmessage({ data })
  await message({ method: 'connect', id: 1, value: {
    options: { size: { width: 3840, height: 2160 }, password: 'trace-test-secret', authToken: 'trace-test-token' },
    extensions: { canvas2d: true, webcodecs_enabled: false, presentation_regions: options.regions, presentation_trace: options.trace },
    callbacks: [],
  } })
  const frames = () => postMessage.mock.calls.map(call => call[0]).filter(value => value.type === 'frame')
  const ack = async (frameId?: number, hidden = false) => { await message({ method: 'frameAck', frameId, hidden }); await flush() }
  const put = (x: number, y: number, width = 100, height = 80) => ctx.putImageData({ width, height }, x, y)
  const tick = (ms = 1) => vi.advanceTimersByTimeAsync(ms)
  const warmup = async () => { put(10, 20); await tick(); return frames()[0] }
  return { scope, canvas, create, message, frames, ack, put, tick, warmup, postMessage }
}

describe('RDP worker snapshot batches', () => {
  it.each([undefined, 4])('keeps one batch in flight with region limit %s', async regions => {
    const w = await startWorker({ regions })
    const first = await w.warmup()
    expect(w.create.mock.calls[0]?.slice(1)).toEqual([0, 0, 3840, 2160])
    expect(first.patches).toHaveLength(1)
    w.put(20, 30); w.put(3000, 1800)
    await w.tick()
    expect(w.create).toHaveBeenCalledOnce()
    await w.ack(first.frameId)
    const second = w.frames()[1]
    expect(second.frameId).toBe(first.frameId + 1)
    expect(second.patches).toHaveLength(regions === 4 ? 2 : 1)
    const expected = regions === 4 ? [[20, 30, 100, 80], [3000, 1800, 100, 80]] : [[20, 30, 3080, 1850]]
    expect(w.create.mock.calls.slice(1).map(call => call.slice(1))).toEqual(expected)
    expect(w.postMessage.mock.calls.find(call => call[0] === second)?.[1]).toEqual(second.patches.map((patch: any) => patch.bitmap))
    w.put(40, 50)
    await w.tick(10)
    expect(w.frames()).toHaveLength(2)
    await w.ack(second.frameId)
    expect(w.frames()).toHaveLength(3)
    expect(w.frames()[2].patches).toHaveLength(1)
  })

  it('does not release the next batch for a missing, stale, duplicate or unrelated ACK', async () => {
    const w = await startWorker({ regions: 4 })
    const first = await w.warmup()
    w.put(20, 30); w.put(3000, 1800)
    await w.ack()
    await w.ack(first.frameId + 99)
    expect(w.create).toHaveBeenCalledOnce()
    await w.ack(first.frameId)
    const second = w.frames()[1]
    w.put(50, 60)
    const count = w.create.mock.calls.length
    await w.ack(first.frameId)
    await w.ack(second.frameId - 1)
    await w.ack(second.frameId + 1)
    expect(w.create).toHaveBeenCalledTimes(count)
    await w.ack(second.frameId)
    expect(w.frames()).toHaveLength(3)
  })

  it('retains damage arriving while an asynchronous bitmap is being prepared', async () => {
    const w = await startWorker({ regions: 4 })
    const first = await w.warmup()
    const pending = deferred<ReturnType<typeof bitmap>>()
    w.create.mockImplementationOnce(() => pending.promise)
    w.put(100, 200)
    await w.ack(first.frameId)
    expect(w.create).toHaveBeenCalledTimes(2)
    w.put(3000, 1800)
    await w.tick(10)
    expect(w.create).toHaveBeenCalledTimes(2)
    pending.resolve(bitmap(100, 80)); await flush()
    const second = w.frames()[1]
    expect(second.patches[0].region).toMatchObject({ x: 100, y: 200, width: 100, height: 80 })
    await w.tick()
    expect(w.create).toHaveBeenCalledTimes(2)
    await w.ack(second.frameId)
    expect(w.frames()[2].patches[0].region).toMatchObject({ x: 3000, y: 1800, width: 100, height: 80 })
  })

  it.each([false, true])('discards a stale resize capture and sends a full replacement (return to old size: %s)', async returnToOldSize => {
    const w = await startWorker({ regions: 4 })
    const pending = deferred<ReturnType<typeof bitmap>>()
    const stale = bitmap(3840, 2160)
    w.create.mockImplementationOnce(() => pending.promise)
    w.put(10, 20); await w.tick()
    w.canvas.width = 1920; w.canvas.height = 1080
    w.put(200, 300)
    if (returnToOldSize) {
      w.canvas.width = 3840; w.canvas.height = 2160
      w.put(300, 400)
    }
    pending.resolve(stale); await flush(); await w.tick()
    expect(stale.close).toHaveBeenCalledOnce()
    expect(w.frames()).toHaveLength(1)
    expect(w.frames()[0].frameId).toBe(2)
    expect(w.frames()[0].patches[0].region).toEqual({ x: 0, y: 0, width: w.canvas.width, height: w.canvas.height, desktopWidth: w.canvas.width, desktopHeight: w.canvas.height })
    expect(w.create.mock.calls[1]?.slice(1)).toEqual([0, 0, w.canvas.width, w.canvas.height])
  })

  it.each(['same-width', 'same-height', 'round-trip'])('waits for new pixels after a %s reset invalidates a pending capture', async reset => {
    const w = await startWorker({ regions: 4 })
    const pending = deferred<ReturnType<typeof bitmap>>()
    const stale = bitmap(3840, 2160)
    w.create.mockImplementationOnce(() => pending.promise)
    w.put(10, 20); await w.tick()
    if (reset === 'same-width') w.canvas.width = w.canvas.width
    else if (reset === 'same-height') w.canvas.height = w.canvas.height
    else {
      // No paint occurs at the intermediate size, so add() cannot detect this reset.
      w.canvas.width = 1920; w.canvas.height = 1080
      w.canvas.width = 3840; w.canvas.height = 2160
    }
    pending.resolve(stale); await flush(); await w.tick(200)
    expect(stale.close).toHaveBeenCalledOnce()
    expect(w.frames()).toHaveLength(0)
    expect(w.create).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    w.put(3000, 1800)
    await w.tick()
    expect(w.frames()).toHaveLength(1)
    expect(w.frames()[0].frameId).toBe(2)
    expect(w.frames()[0].patches[0].region).toEqual({ x: 0, y: 0, width: 3840, height: 2160, desktopWidth: 3840, desktopHeight: 2160 })
    expect(w.create.mock.calls[1]?.slice(1)).toEqual([0, 0, 3840, 2160])
  })

  it('does not send a reset framebuffer on ACK before its first new paint', async () => {
    const w = await startWorker({ regions: 4 })
    const first = await w.warmup()
    w.canvas.width = w.canvas.width
    await w.ack(first.frameId)
    await w.tick(200)
    expect(w.frames()).toHaveLength(1)
    expect(w.create).toHaveBeenCalledOnce()
    w.put(200, 300)
    await w.tick()
    expect(w.frames()).toHaveLength(2)
    expect(w.frames()[1].patches[0].region).toEqual({ x: 0, y: 0, width: 3840, height: 2160, desktopWidth: 3840, desktopHeight: 2160 })
  })

  it('closes successful patches when another capture fails and stops further snapshots', async () => {
    const w = await startWorker({ regions: 4, trace: true })
    const first = await w.warmup()
    const success = bitmap(100, 80)
    w.create.mockResolvedValueOnce(success).mockRejectedValueOnce(new Error('capture failed'))
    w.put(20, 30); w.put(3000, 1800)
    await w.ack(first.frameId)
    expect(success.close).toHaveBeenCalledOnce()
    expect(wasm.shutdown).toHaveBeenCalledOnce()
    expect(w.frames()).toHaveLength(1)
    expect(w.postMessage.mock.calls.filter(call => call[0].name === 'workerError')).toHaveLength(1)
    w.put(40, 50); await w.tick(200)
    expect(w.create).toHaveBeenCalledTimes(3)
    // The existing stats interval remains until the main client terminates this Worker.
    expect(vi.getTimerCount()).toBe(1)
  })

  it('does not schedule idle snapshots and resumes immediately when visible', async () => {
    const w = await startWorker()
    const first = await w.warmup()
    await w.ack(first.frameId)
    await w.tick(200)
    expect(w.create).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    w.put(20, 30); await w.tick()
    const second = w.frames()[1]
    w.put(40, 50)
    await w.ack(second.frameId, true)
    await w.tick(50)
    expect(w.frames()).toHaveLength(2)
    await w.tick(50)
    const third = w.frames()[2]
    expect(third).toBeDefined()
    w.put(60, 70)
    await w.ack(third.frameId, false)
    expect(w.frames()).toHaveLength(4)
  })

  it.each([false, true])('keeps tracing and its heartbeat opt-in (%s)', async enabled => {
    const w = await startWorker({ trace: enabled })
    expect(vi.getTimerCount()).toBe(enabled ? 2 : 1)
    const first = await w.warmup()
    await w.ack(first.frameId)
    await w.tick(1000)
    const batches = w.postMessage.mock.calls.map(call => call[0]).filter(value => value.type === 'presentationTrace')
    if (!enabled) expect(batches).toHaveLength(0)
    else {
      const events = batches.flatMap(batch => batch.events)
      expect(events.map(event => event.stage)).toEqual(expect.arrayContaining([
        'put-start', 'put-end', 'damage', 'snapshot-start', 'snapshot-ready', 'frame-sent', 'ack-received',
        'bitmap-call-start', 'bitmap-call-returned', 'bitmap-ready',
      ]))
      expect(events.filter(event => ['snapshot-start', 'snapshot-ready', 'frame-sent', 'ack-received'].includes(event.stage)).every(event => event.id === first.frameId)).toBe(true)
      expect(events.every(event => Number.isFinite(event.time) && event.time >= performance.timeOrigin)).toBe(true)
      expect(JSON.stringify(batches)).not.toContain('trace-test-secret')
      expect(JSON.stringify(batches)).not.toContain('trace-test-token')
      expect(batches.every(batch => batch.dropped === 0)).toBe(true)
    }
  })

  it('stops the heartbeat after connection failure or normal session termination', async () => {
    const w = await startWorker({ trace: true })
    await w.message({ method: 'run', id: 2 })
    expect(vi.getTimerCount()).toBe(1)
  })

  it('does not retain a heartbeat when connection initialization fails', async () => {
    const w = await startWorker({ trace: true, connectError: new Error('connection failed') })
    expect(w.postMessage.mock.calls.find(call => call[0].id === 1)?.[0].error).toBe('connection failed')
    expect(vi.getTimerCount()).toBe(0)
  })
})
