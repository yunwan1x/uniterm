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
it('transfers completed GPU outputs as full frames and keeps later damage until display acknowledgement', async () => {
  vi.useFakeTimers()
  const scope: any = { postMessage: vi.fn() }, create = vi.fn()
  const source = { width: 3840, height: 2160, addEventListener: vi.fn(), transferToImageBitmap: vi.fn(() => ({ width: 3840, height: 2160, close: vi.fn() })) }
  state.source = source
  vi.stubGlobal('self', scope); vi.stubGlobal('WebSocket', class {})
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {}; getContext() { return { putImageData: vi.fn() } } })
  vi.stubGlobal('createImageBitmap', create)
  await import('./session.worker')
  await scope.onmessage({ data: { id: 1, method: 'connect', value: { options: { size: { width: 3840, height: 2160 } }, extensions: { webcodecs_enabled: false }, callbacks: [] } } })
  state.present!([10, 20, 110, 120])
  await vi.advanceTimersByTimeAsync(1)
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(1)
  expect(create).not.toHaveBeenCalled()
  state.present!([200, 300, 210, 310])
  state.present!([500, 600, 510, 610])
  await vi.advanceTimersByTimeAsync(1)
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(1)
  await scope.onmessage({ data: { method: 'frameAck' } })
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(2)
  const frames = scope.postMessage.mock.calls.map((c: any[]) => c[0]).filter((m: any) => m.type === 'frame')
  expect(frames).toHaveLength(2)
  for (const frame of frames) expect(frame.region).toEqual({ x: 0, y: 0, width: 3840, height: 2160, desktopWidth: 3840, desktopHeight: 2160 })
  await scope.onmessage({ data: { method: 'frameAck' } })
  expect(source.transferToImageBitmap).toHaveBeenCalledTimes(2)
})
