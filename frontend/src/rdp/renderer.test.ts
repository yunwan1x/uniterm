import { afterEach, expect, it, vi } from 'vitest'
import { DesktopRenderer } from './renderer'
afterEach(() => vi.unstubAllGlobals())
it('moves frame scheduling and visibility listeners with the canvas and restores them', () => {
  const makeDocument = () => {
    const owner = { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() }
    return { defaultView: owner, hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), createElement: () => ({ getContext: () => null }) }
  }
  const main = makeDocument(), child = makeDocument(), drawImage = vi.fn(), ack = vi.fn()
  vi.stubGlobal('document', main)
  const canvas = { ownerDocument: main, width: 10, height: 10, getContext: () => ({ drawImage }), addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const renderer = new DesktopRenderer(canvas as any, ack, vi.fn(), 'canvas2d')
  const frame = () => ({ width: 10, height: 10, close: vi.fn() })
  const first = frame(); renderer.frame(first as any)
  canvas.ownerDocument = child
  renderer.frame(frame() as any)
  expect(main.defaultView.cancelAnimationFrame).toHaveBeenCalledWith(1)
  expect(main.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  expect(child.defaultView.requestAnimationFrame).toHaveBeenCalledOnce()
  expect(first.close).toHaveBeenCalledOnce()
  const render = child.defaultView.requestAnimationFrame.mock.calls[0] as unknown as [() => void]
  render[0]()
  expect(drawImage).toHaveBeenCalledOnce(); expect(ack).toHaveBeenCalledOnce()
  canvas.ownerDocument = main
  renderer.frame(frame() as any)
  expect(main.defaultView.requestAnimationFrame).toHaveBeenCalledTimes(2)
  renderer.dispose()
  expect(child.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
})
