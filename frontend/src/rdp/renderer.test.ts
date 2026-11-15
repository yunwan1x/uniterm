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
it('preserves desktop size and every queued damage patch', () => {
  let callback: (() => void) | undefined
  const doc = { hidden: false, defaultView: { requestAnimationFrame: vi.fn((fn: () => void) => { callback = fn; return 1 }), cancelAnimationFrame: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn(), createElement: () => ({ getContext: () => null }) }
  vi.stubGlobal('document', doc)
  const drawImage = vi.fn(), ack = vi.fn()
  const canvas = { ownerDocument: doc, width: 3840, height: 2160, getContext: () => ({ drawImage }), addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const r = new DesktopRenderer(canvas as any, ack, vi.fn(), 'canvas2d')
  const patch = () => ({ width: 100, height: 80, close: vi.fn() })
  const first = patch(), second = patch()
  r.frame(first as any, { x: 20, y: 30, width: 100, height: 80, desktopWidth: 3840, desktopHeight: 2160 })
  r.frame(second as any, { x: 400, y: 300, width: 100, height: 80, desktopWidth: 3840, desktopHeight: 2160 })
  callback!()
  expect(drawImage.mock.calls).toEqual([[first, 20, 30], [second, 400, 300]])
  expect([canvas.width, canvas.height]).toEqual([3840, 2160])
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce()
  expect(ack).toHaveBeenCalledTimes(2)
  const third = patch(); r.frame(third as any)
  r.dispose(); expect(third.close).toHaveBeenCalledOnce()
})
function batchHarness() {
  let callback: (() => void) | undefined
  const doc = { hidden: false, defaultView: { requestAnimationFrame: vi.fn((fn: () => void) => { callback = fn; return 1 }), cancelAnimationFrame: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn(), createElement: () => ({ getContext: () => null }) }
  vi.stubGlobal('document', doc)
  const drawImage = vi.fn(), ack = vi.fn(), trace = vi.fn(), failure = vi.fn()
  const canvas = { ownerDocument: doc, width: 3840, height: 2160, getContext: () => ({ drawImage }), addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const renderer = new DesktopRenderer(canvas as any, ack, failure, 'canvas2d', trace)
  const patch = (x: number, y: number, desktopWidth = 3840, desktopHeight = 2160) => ({ bitmap: { width: 100, height: 80, close: vi.fn() } as unknown as ImageBitmap, region: { x, y, width: 100, height: 80, desktopWidth, desktopHeight } })
  return { renderer, patch, doc, canvas, drawImage, ack, trace, failure, flush: () => callback!() }
}
it('submits every patch in one RAF and acknowledges one batch after its last draw', () => {
  const h = batchHarness(), a = h.patch(10, 20), b = h.patch(3000, 1900)
  h.renderer.frameBatch([a, b], 42)
  expect(h.doc.defaultView.requestAnimationFrame).toHaveBeenCalledOnce()
  expect(h.drawImage).not.toHaveBeenCalled(); expect(h.ack).not.toHaveBeenCalled()
  h.flush()
  expect(h.drawImage.mock.calls).toEqual([[a.bitmap, 10, 20], [b.bitmap, 3000, 1900]])
  expect(h.ack.mock.calls).toEqual([[42]])
  expect(h.ack.mock.invocationCallOrder[0]).toBeGreaterThan(h.drawImage.mock.invocationCallOrder[1]!)
  expect(h.trace.mock.calls).toEqual([['draw-start', 42], ['draw-end', 42]])
  expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(b.bitmap.close).toHaveBeenCalledOnce()
  expect(h.renderer.stats.frames).toBe(1)
})
it('preserves all incremental batches and changes desktop extent once per batch', () => {
  const h = batchHarness(), first = [h.patch(10, 20), h.patch(3000, 1900)]
  const resized = h.patch(0, 0, 1920, 1080)
  h.renderer.frameBatch(first, 1)
  h.renderer.frameBatch([resized], 2)
  expect(h.drawImage).toHaveBeenCalledTimes(2)
  expect(h.ack.mock.calls).toEqual([[1]])
  h.flush()
  expect(h.ack.mock.calls).toEqual([[1], [2]])
  expect([h.canvas.width, h.canvas.height]).toEqual([1920, 1080])
})
it('closes every undisplayed bitmap on disposal without sending a display ACK', () => {
  const h = batchHarness(), a = h.patch(10, 20), b = h.patch(3000, 1900)
  h.renderer.frameBatch([a, b], 1); h.renderer.dispose()
  expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(b.bitmap.close).toHaveBeenCalledOnce()
  expect(h.ack).not.toHaveBeenCalled()
  const late = h.patch(0, 0); h.renderer.frameBatch([late], 2)
  expect(late.bitmap.close).toHaveBeenCalledOnce()
})
it('rejects mixed-size patches before drawing any part of the batch', () => {
  const h = batchHarness(), a = h.patch(10, 20), b = h.patch(30, 40, 1920, 1080)
  h.renderer.frameBatch([a, b], 99)
  expect(h.flush).not.toThrow()
  expect(h.drawImage).not.toHaveBeenCalled()
  expect([h.canvas.width, h.canvas.height]).toEqual([3840, 2160])
  expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(b.bitmap.close).toHaveBeenCalledOnce()
  expect(h.failure).toHaveBeenCalledOnce()
  expect(h.failure.mock.calls[0]![0].message).toBe('RDP worker presentation failed: Invalid RDP display batch')
  expect(h.ack).not.toHaveBeenCalled(); expect(h.renderer.stats.frames).toBe(0)
  const late = h.patch(0, 0); h.renderer.frameBatch([late], 100)
  expect(late.bitmap.close).toHaveBeenCalledOnce(); expect(h.failure).toHaveBeenCalledOnce()
})
it('closes all patches and notifies failure without ACK when a draw fails midway', () => {
  const h = batchHarness(), a = h.patch(10, 20), b = h.patch(3000, 1900)
  h.drawImage.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('lost drawing context') })
  h.renderer.frameBatch([a, b], 4)
  expect(h.flush).not.toThrow()
  expect(h.drawImage).toHaveBeenCalledTimes(2)
  expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(b.bitmap.close).toHaveBeenCalledOnce()
  expect(h.failure).toHaveBeenCalledOnce(); expect(h.ack).not.toHaveBeenCalled()
  expect(h.trace.mock.calls).toEqual([['draw-start', 4]])
  expect(h.renderer.stats.frames).toBe(0)
})
it('discards an arriving batch if preserving the preceding patch reveals a failure', () => {
  const h = batchHarness(), a = h.patch(0, 0), b = h.patch(20, 30)
  h.drawImage.mockImplementation(() => { throw new Error('draw failed') })
  h.renderer.frameBatch([a], 1); h.renderer.frameBatch([b], 2)
  expect(h.failure).toHaveBeenCalledOnce(); expect(h.ack).not.toHaveBeenCalled()
  expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(b.bitmap.close).toHaveBeenCalledOnce()
  h.flush()
  expect(h.drawImage).toHaveBeenCalledOnce()
})
it('stops on context loss and disposes once even when the failure handler also disposes', () => {
  const h = batchHarness(), a = h.patch(0, 0)
  h.failure.mockImplementation(() => h.renderer.dispose())
  h.renderer.frameBatch([a], 1)
  const listener = h.canvas.addEventListener.mock.calls.find((call: unknown[]) => call[0] === 'webglcontextlost')![1] as (event: any) => void
  const preventDefault = vi.fn()
  listener({ preventDefault }); listener({ preventDefault })
  expect(h.failure).toHaveBeenCalledOnce()
  expect(h.failure.mock.calls[0]![0].message).toBe('RDP WebGL context lost')
  expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(h.ack).not.toHaveBeenCalled()
  expect(h.doc.removeEventListener).toHaveBeenCalledOnce()
})
it('ignores an empty batch and retains legacy single-frame trace ids', () => {
  const h = batchHarness()
  h.renderer.frameBatch([], 1)
  expect(h.doc.defaultView.requestAnimationFrame).not.toHaveBeenCalled()
  const p = h.patch(0, 0)
  h.renderer.frame(p.bitmap, p.region, 7); h.flush()
  expect(h.ack.mock.calls).toEqual([[7]])
})
it('uploads all patches before a single WebGL draw', () => {
  let callback: (() => void) | undefined
  const gl: any = Object.fromEntries(['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'useProgram', 'bindTexture', 'texParameteri', 'viewport', 'texImage2D', 'texSubImage2D', 'drawArrays'].map(name => [name, vi.fn()]))
  Object.assign(gl, { createShader: () => ({}), createProgram: () => ({}), createTexture: () => ({}), getShaderParameter: () => true, getProgramParameter: () => true, getExtension: () => null })
  const doc = { hidden: false, defaultView: { requestAnimationFrame: vi.fn((fn: () => void) => { callback = fn; return 1 }), cancelAnimationFrame: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn(), createElement: () => ({ getContext: () => gl }) }
  vi.stubGlobal('document', doc)
  const canvas = { ownerDocument: doc, width: 640, height: 480, getContext: () => gl, addEventListener: vi.fn(), removeEventListener: vi.fn() }, ack = vi.fn()
  const renderer = new DesktopRenderer(canvas as any, ack, vi.fn(), 'webgl2')
  const patches = [10, 400].map(x => ({ bitmap: { width: 20, height: 30, close: vi.fn() } as unknown as ImageBitmap, region: { x, y: 10, width: 20, height: 30, desktopWidth: 640, desktopHeight: 480 } }))
  renderer.frameBatch(patches, 3); callback!()
  expect(gl.texSubImage2D).toHaveBeenCalledTimes(2); expect(gl.drawArrays).toHaveBeenCalledOnce()
  expect(gl.drawArrays.mock.invocationCallOrder[0]).toBeGreaterThan(gl.texSubImage2D.mock.invocationCallOrder[1])
  expect(ack.mock.calls).toEqual([[3]])
})
