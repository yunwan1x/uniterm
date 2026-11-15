import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ present: null as null | ((r: number[]) => void), source: null as any }))
vi.mock('@ys-ll/ironrdp-wasm', () => ({
  default: vi.fn(), setup: vi.fn(), DesktopSize: class {},
  SessionBuilder: class { desktopSize() { return this }; renderCanvas() { return this }; connect() { return {} }; free() {} },
}))
vi.mock('./gpu-compositor', () => ({
  GpuCompositor: class {
    active = true
    canvas = state.source
    constructor(present: (r: number[]) => void) { state.present = present }
  },
}))
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })
it.each([1, 4])('transfers complete GPU outputs as one patch even with region limit %s', async regions => {
  vi.useFakeTimers()
  const scope: any = { postMessage: vi.fn() }, create = vi.fn()
  const source = { width: 3840, height: 2160, addEventListener: vi.fn(), transferToImageBitmap: vi.fn(() => ({ width: 3840, height: 2160, close: vi.fn() })) }
  state.source = source
  vi.stubGlobal('self', scope); vi.stubGlobal('WebSocket', class {})
  vi.stubGlobal('OffscreenCanvas', class {
    private backingWidth: number
    private backingHeight: number
    constructor(width: number, height: number) { this.backingWidth = width; this.backingHeight = height }
    get width() { return this.backingWidth }
    set width(value: number) { this.backingWidth = value }
    get height() { return this.backingHeight }
    set height(value: number) { this.backingHeight = value }
    getContext() { return { putImageData: vi.fn() } }
  })
  vi.stubGlobal('createImageBitmap', create)
  await import('./session.worker')
  await scope.onmessage({ data: { id: 1, method: 'connect', value: { options: { size: { width: 3840, height: 2160 } }, extensions: { webcodecs_enabled: false, presentation_regions: regions }, callbacks: [] } } })
  const frames = () => scope.postMessage.mock.calls.map((call: any[]) => call[0]).filter((message: any) => message.type === 'frame')
  state.present!([10, 20, 110, 120])
  await vi.advanceTimersByTimeAsync(1)
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(1)
  expect(create).not.toHaveBeenCalled()
  const first = frames()[0]
  expect(first.frameId).toBe(1)
  state.present!([200, 300, 210, 310])
  state.present!([500, 600, 510, 610])
  await vi.advanceTimersByTimeAsync(1)
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(1)
  await scope.onmessage({ data: { method: 'frameAck' } })
  await scope.onmessage({ data: { method: 'frameAck', frameId: first.frameId + 1 } })
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(1)
  await scope.onmessage({ data: { method: 'frameAck', frameId: first.frameId } })
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(2)
  expect(frames()).toHaveLength(2)
  for (const [index, frame] of frames().entries()) {
    expect(frame.frameId).toBe(index + 1)
    expect(frame.patches).toHaveLength(1)
    const patch = frame.patches[0]
    expect(patch.region).toEqual({ x: 0, y: 0, width: 3840, height: 2160, desktopWidth: 3840, desktopHeight: 2160 })
    expect(patch.bitmap).toBe(source.transferToImageBitmap.mock.results[index]!.value)
    expect(scope.postMessage.mock.calls.find((call: any[]) => call[0] === frame)?.[1]).toEqual([patch.bitmap])
  }
  // ACKing an already transferred output must not transfer its cleared backing store again.
  await scope.onmessage({ data: { method: 'frameAck', frameId: first.frameId } })
  await scope.onmessage({ data: { method: 'frameAck', frameId: frames()[1].frameId } })
  await vi.advanceTimersByTimeAsync(200)
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(2)
  expect(create).not.toHaveBeenCalled()
})
