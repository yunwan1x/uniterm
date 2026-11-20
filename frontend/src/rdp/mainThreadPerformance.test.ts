import { expect, it, vi } from 'vitest'
import { observeMainThreadPerformance } from './mainThreadPerformance'

it('groups dirty rectangles into paints, counts socket payloads, and removes session hooks', () => {
  const write = vi.fn()
  const ctx = { putImageData: write }
  let paint!: () => void
  const win = { requestAnimationFrame(fn: () => void) { paint = fn; return 1 }, cancelAnimationFrame: vi.fn() }
  const canvas = { ownerDocument: { defaultView: win }, getContext: () => ctx }
  const socket = new EventTarget()
  const remove = vi.fn()
  const monitor = observeMainThreadPerformance(canvas as unknown as HTMLCanvasElement, 'ws://example.invalid/', (_, callback) => {
    callback(socket as WebSocket)
    return remove
  })
  const message = () => socket.dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(30) }))
  message()
  ctx.putImageData()
  ctx.putImageData()
  paint()
  expect(monitor.read()).toMatchObject({ frames: 1, bytes: 30 })
  expect(write).toHaveBeenCalledTimes(2)
  monitor.dispose()
  message()
  expect(monitor.read().bytes).toBe(30)
  expect(ctx.putImageData).toBe(write)
  expect(remove).toHaveBeenCalledOnce()
})
