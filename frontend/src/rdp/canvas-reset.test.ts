import { expect, it, vi } from 'vitest'
import { watchCanvasReset } from './canvas-reset'

class Canvas {
  private currentWidth = 640
  private currentHeight = 480
  setCount = 0
  get width() { return this.currentWidth }
  set width(value: number) { if (value < 0) throw new RangeError('negative width'); this.currentWidth = Math.trunc(value); this.setCount++ }
  get height() { return this.currentHeight }
  set height(value: number) { if (value < 0) throw new RangeError('negative height'); this.currentHeight = Math.trunc(value); this.setCount++ }
}

it('observes successful same-size and round-trip assignments after the real setters', () => {
  const canvas = new Canvas(), seen: number[][] = []
  watchCanvasReset(canvas as unknown as OffscreenCanvas, () => seen.push([canvas.width, canvas.height, canvas.setCount]))
  canvas.width = 640; canvas.height = 480
  canvas.width = 800; canvas.width = 640
  canvas.height = 600; canvas.height = 480
  canvas.width = 320.9
  expect(seen).toEqual([[640, 480, 1], [640, 480, 2], [800, 480, 3], [640, 480, 4], [640, 600, 5], [640, 480, 6], [320, 480, 7]])
})
it('preserves a failed native setter without reporting a reset', () => {
  const canvas = new Canvas(), reset = vi.fn()
  watchCanvasReset(canvas as unknown as OffscreenCanvas, reset)
  expect(() => { canvas.width = -1 }).toThrow('negative width')
  expect(canvas.width).toBe(640); expect(canvas.setCount).toBe(0); expect(reset).not.toHaveBeenCalled()
})
it('finds inherited accessors, changes only the watched instance, and restores it', () => {
  class DerivedCanvas extends Canvas {}
  const canvas = new DerivedCanvas(), other = new DerivedCanvas(), reset = vi.fn()
  const originalWidth = Object.getOwnPropertyDescriptor(Canvas.prototype, 'width')
  const restore = watchCanvasReset(canvas as unknown as OffscreenCanvas, reset)
  canvas.width = 800; other.width = 900
  expect(reset).toHaveBeenCalledOnce()
  expect(Object.getOwnPropertyDescriptor(Canvas.prototype, 'width')).toEqual(originalWidth)
  expect(Object.hasOwn(other, 'width')).toBe(false)
  restore(); restore()
  expect(Object.hasOwn(canvas, 'width')).toBe(false)
  expect(Object.hasOwn(canvas, 'height')).toBe(false)
  canvas.width = 600
  expect(reset).toHaveBeenCalledOnce()
})
it('fails before installing either hook if an instance dimension cannot be observed', () => {
  const canvas = new Canvas()
  Object.defineProperty(canvas, 'height', { value: 480, configurable: false })
  expect(() => watchCanvasReset(canvas as unknown as OffscreenCanvas, vi.fn())).toThrow('RDP worker OffscreenCanvas height cannot be observed')
  expect(Object.hasOwn(canvas, 'width')).toBe(false)
})
it('rejects unsupported canvas accessors so the caller can select a fallback', () => {
  expect(() => watchCanvasReset({ width: 640, height: 480 } as OffscreenCanvas, vi.fn())).toThrow('RDP worker OffscreenCanvas width accessor unavailable')
})
it('propagates observer failure after the backing store was replaced', () => {
  const canvas = new Canvas()
  watchCanvasReset(canvas as unknown as OffscreenCanvas, () => { throw new Error('reset tracking failed') })
  expect(() => { canvas.width = 800 }).toThrow('reset tracking failed')
  expect(canvas.width).toBe(800); expect(canvas.setCount).toBe(1)
})
it('restores original instance descriptors without overwriting a later observer', () => {
  const canvas = new Canvas(), get = () => 42, set = vi.fn()
  Object.defineProperty(canvas, 'width', { get, set, configurable: true })
  const restore = watchCanvasReset(canvas as unknown as OffscreenCanvas, vi.fn())
  expect(canvas.width).toBe(640)
  restore()
  expect(Object.getOwnPropertyDescriptor(canvas, 'width')).toMatchObject({ get, set })
  const restoreAgain = watchCanvasReset(canvas as unknown as OffscreenCanvas, vi.fn())
  Object.defineProperty(canvas, 'width', { value: 123, configurable: true })
  restoreAgain()
  expect(canvas.width).toBe(123)
})
