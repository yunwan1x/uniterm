import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

it.each([
  ['baseline-unsupported', false, false, 'unsupported', 'baseline-unavailable'],
  ['baseline-query-error', false, false, 'query-error:NotSupportedError', 'baseline-unavailable'],
  ['high-profile-unsupported', true, false, 'ready', 'high-profile-unsupported'],
  ['readback-error', true, false, 'ready', 'readback-error:NotSupportedError'],
  ['probe-constructor-error', false, false, 'ready', 'probe-error:NotSupportedError'],
  ['probe-timeout', true, false, 'ready', 'probe-timeout'],
  ['ready', true, true, 'ready', 'ready'],
])('reports nested decoder startup %s', async (scenario, ready, yuv, baselineReason, yuvReason) => {
  vi.useFakeTimers()
  const scope: any = { postMessage: vi.fn() }
  vi.stubGlobal('self', scope)
  vi.stubGlobal('EncodedVideoChunk', class {})
  vi.stubGlobal('VideoDecoder', class {
    constructor(private callbacks: any) { if (scenario === 'probe-constructor-error') throw new DOMException('test', 'NotSupportedError') }
    static async isConfigSupported(config: any) {
      if (config.codec === 'avc1.42E028') {
        if (scenario === 'baseline-query-error') throw new DOMException('test', 'NotSupportedError')
        return { supported: scenario !== 'baseline-unsupported' }
      }
      return { supported: scenario !== 'high-profile-unsupported' }
    }
    configure() {}
    decode() {
      if (scenario === 'probe-timeout') return
      queueMicrotask(() => this.callbacks.output({
        visibleRect: { x: 0, y: 0, width: 2, height: 2 }, format: 'I420',
        allocationSize: () => 6, close: vi.fn(),
        copyTo: async () => {
          if (scenario === 'readback-error') throw new DOMException('test', 'NotSupportedError')
          return [{ offset: 0, stride: 2 }, { offset: 4, stride: 1 }, { offset: 5, stride: 1 }]
        },
      }))
    }
    close() {}
  })
  await import('./avc.worker')
  const initialized = scope.onmessage({ data: { method: 'init', control: new SharedArrayBuffer(16), pixels: new SharedArrayBuffer(64) } })
  if (scenario === 'probe-timeout') await vi.advanceTimersByTimeAsync(2000)
  await initialized
  expect(scope.postMessage).toHaveBeenCalledOnce()
  expect(scope.postMessage).toHaveBeenCalledWith({ ready, yuv, baselineReason, yuvReason, ...(scenario === 'probe-constructor-error' ? { reason: 'yuv-probe-error' } : {}) })
})
