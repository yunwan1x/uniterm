import type { DamageRect } from './damage'
import type { FramePatch } from './renderer'

export type SnapshotStage = 'bitmap-call-start' | 'bitmap-call-returned' | 'bitmap-ready'

/** Capture every region before yielding; callers retain sole ownership of source. */
export async function captureSnapshotBatch(source: OffscreenCanvas, regions: readonly DamageRect[], isCurrent: () => boolean, observer?: (stage: SnapshotStage, index: number) => void): Promise<FramePatch[] | null> {
  if (!regions.length) return []
  const width = source.width, height = source.height
  const trace = (stage: SnapshotStage, index: number) => { try { observer?.(stage, index) } catch {} }
  const captures = regions.map((region, index) => {
    try {
      trace('bitmap-call-start', index)
      const capture = createImageBitmap(source, region.x, region.y, region.width, region.height)
      trace('bitmap-call-returned', index)
      return capture.then(bitmap => {
        trace('bitmap-ready', index)
        return { bitmap, region: { ...region, desktopWidth: width, desktopHeight: height } }
      })
    } catch (error) { return Promise.reject(error) }
  })
  const results = await Promise.allSettled(captures)
  const patches: FramePatch[] = []
  let failure: PromiseRejectedResult | undefined
  for (const result of results) {
    if (result.status === 'fulfilled') patches.push(result.value)
    else failure ??= result
  }
  if (failure || source.width !== width || source.height !== height || !isCurrent()) {
    for (const patch of patches) patch.bitmap.close()
    if (failure) throw failure.reason
    return null
  }
  return patches
}
