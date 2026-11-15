import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@ys-ll/ironrdp-wasm', () => ({
  default: vi.fn(), setup: vi.fn(), DesktopSize: class {},
  SessionBuilder: class {
    desktopSize() { return this }
    renderCanvas() { return this }
    connect() { return {} }
    free() {}
  },
}))
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })
it('crops accumulated updates, bounds in-flight frames and resumes immediately on display ACK', async () => {
  vi.useFakeTimers()
  const postMessage = vi.fn(), scope: any = { postMessage }
  const ctx = { putImageData: vi.fn((..._args: any[]) => {}) }
  let canvas: any
  vi.stubGlobal('self', scope)
  vi.stubGlobal('WebSocket', class {})
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) { canvas = this }
    getContext() { return ctx }
  })
  const create = vi.fn(async (_: any, x: number, y: number, width: number, height: number) => ({ width, height, close: vi.fn() }))
  vi.stubGlobal('createImageBitmap', create)
  await import('./session.worker')
  await scope.onmessage({ data: { method: 'connect', id: 1, value: { options: { size: { width: 3840, height: 2160 } }, extensions: { webcodecs_enabled: false }, callbacks: [] } } })
  const image = { width: 100, height: 80 }
  ctx.putImageData(image as any, 10, 20)
  await vi.advanceTimersByTimeAsync(1)
  expect(create.mock.calls[0]?.slice(1)).toEqual([0, 0, 3840, 2160])
  ctx.putImageData(image as any, 20, 30)
  ctx.putImageData(image as any, 200, 300)
  await vi.advanceTimersByTimeAsync(1)
  expect(create).toHaveBeenCalledOnce()
  await scope.onmessage({ data: { method: 'frameAck' } })
  // No ACK-derived delay: the next snapshot starts within the handler.
  expect(create).toHaveBeenCalledTimes(2)
  expect(create.mock.calls[1]?.slice(1)).toEqual([20, 30, 280, 350])
  const frames = postMessage.mock.calls.map(c => c[0]).filter(m => m.type === 'frame')
  expect(frames[1].region).toEqual({ x: 20, y: 30, width: 280, height: 350, desktopWidth: 3840, desktopHeight: 2160 })
  await scope.onmessage({ data: { method: 'frameAck' } })
  expect(create).toHaveBeenCalledTimes(2)
  canvas.width = 1920; canvas.height = 1080
  ctx.putImageData(image as any, 200, 300)
  await vi.advanceTimersByTimeAsync(1)
  expect(create.mock.calls[2]?.slice(1)).toEqual([0, 0, 1920, 1080])
  ctx.putImageData(image as any, 30, 40)
  await scope.onmessage({ data: { method: "frameAck", hidden: true } })
  await vi.advanceTimersByTimeAsync(50)
  expect(create).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(50)
  expect(create).toHaveBeenCalledTimes(4)
  ctx.putImageData(image as any, 50, 60)
  await scope.onmessage({ data: { method: "frameAck", hidden: false } })
  expect(create).toHaveBeenCalledTimes(5)
})
