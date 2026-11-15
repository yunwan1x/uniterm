import { afterEach, expect, it, vi } from 'vitest'
import { captureSnapshotBatch } from './snapshot-batch'
afterEach(() => vi.unstubAllGlobals())
const regions = [{ x: 10, y: 20, width: 20, height: 30 }, { x: 300, y: 200, width: 10, height: 10 }]
const bitmap = (width = 20, height = 30) => ({ width, height, close: vi.fn() })
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
it('starts all crops synchronously and retains order when promises resolve out of order', async () => {
  const source = { width: 640, height: 480 } as OffscreenCanvas
  const first = deferred<any>(), second = deferred<any>()
  const create = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), observer = vi.fn()
  vi.stubGlobal('createImageBitmap', create)
  const result = captureSnapshotBatch(source, regions, () => true, observer)
  expect(create.mock.calls).toEqual([[source, 10, 20, 20, 30], [source, 300, 200, 10, 10]])
  expect(observer.mock.calls).toEqual([['bitmap-call-start', 0], ['bitmap-call-returned', 0], ['bitmap-call-start', 1], ['bitmap-call-returned', 1]])
  const a = bitmap(), b = bitmap(10, 10)
  second.resolve(b); first.resolve(a)
  expect(await result).toEqual([{ bitmap: a, region: { ...regions[0], desktopWidth: 640, desktopHeight: 480 } }, { bitmap: b, region: { ...regions[1], desktopWidth: 640, desktopHeight: 480 } }])
  expect(a.close).not.toHaveBeenCalled(); expect(b.close).not.toHaveBeenCalled()
})
it('waits for every crop before closing successes when another crop rejects', async () => {
  const source = { width: 640, height: 480 } as OffscreenCanvas
  const first = deferred<any>(), second = deferred<any>(), a = bitmap(), error = new Error('capture failed')
  vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
  const result = captureSnapshotBatch(source, regions, () => true)
  const rejected = expect(result).rejects.toBe(error)
  second.reject(error); await Promise.resolve()
  expect(a.close).not.toHaveBeenCalled()
  first.resolve(a); await rejected
  expect(a.close).toHaveBeenCalledOnce()
})
it('closes successful crops when a later call throws synchronously', async () => {
  const a = bitmap(), error = new Error('capture threw')
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(a).mockImplementationOnce(() => { throw error }))
  await expect(captureSnapshotBatch({ width: 640, height: 480 } as OffscreenCanvas, regions, () => true)).rejects.toBe(error)
  expect(a.close).toHaveBeenCalledOnce()
})
it.each(['size', 'generation'])('closes a completed batch invalidated by %s while awaiting snapshots', async reason => {
  const source = { width: 640, height: 480 } as OffscreenCanvas
  const first = deferred<any>(), second = deferred<any>(), a = bitmap(), b = bitmap(10, 10)
  let current = true
  vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
  const result = captureSnapshotBatch(source, regions, () => current)
  if (reason === 'size') source.width = 800
  else current = false
  first.resolve(a); second.resolve(b)
  expect(await result).toBeNull()
  expect(a.close).toHaveBeenCalledOnce(); expect(b.close).toHaveBeenCalledOnce()
})
it('does not let optional diagnostics leak captured resources', async () => {
  const a = bitmap()
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(a))
  expect(await captureSnapshotBatch({ width: 640, height: 480 } as OffscreenCanvas, regions.slice(0, 1), () => true, () => { throw new Error('diagnostic failed') })).toHaveLength(1)
  expect(a.close).not.toHaveBeenCalled()
})
it('does not capture or require an ACK for an empty batch', async () => {
  const create = vi.fn(); vi.stubGlobal('createImageBitmap', create)
  expect(await captureSnapshotBatch({ width: 640, height: 480 } as OffscreenCanvas, [], () => true)).toEqual([])
  expect(create).not.toHaveBeenCalled()
})
