import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@ys-ll/ironrdp-wasm', () => ({
  default: vi.fn(), setup: vi.fn(), DesktopSize: class {},
  SessionBuilder: class { desktopSize() { return this }; renderCanvas() { return this }; connect() { return {} }; free() {} },
}))
vi.mock('./gpu-compositor', () => ({ GpuCompositor: class { constructor() { throw new Error('Hardware renderer not verified') } } }))
vi.mock('./renderer', () => ({ DesktopRenderer: class { mode = 'canvas2d'; stats = {}; dispose() {} } }))
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

async function startup(options: { gate?: string; disabled?: boolean; ready?: object; error?: boolean; timeout?: boolean } = {}) {
  vi.useFakeTimers()
  const scope: any = { postMessage: vi.fn() }, terminated = vi.fn()
  vi.stubGlobal('self', scope); vi.stubGlobal('WebSocket', class {})
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('crossOriginIsolated', options.gate !== 'isolation')
  vi.stubGlobal('SharedArrayBuffer', options.gate === 'shared' ? undefined : SharedArrayBuffer)
  vi.stubGlobal('VideoDecoder', options.gate === 'decoder' ? undefined : class {})
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { putImageData: vi.fn() } } })
  for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'unitermAvcYuv', 'unitermPrepareAvc', 'unitermResetAvc', 'unitermDecodeAvc']) vi.stubGlobal(name, undefined)
  vi.stubGlobal('Worker', class {
    onmessage?: (event: any) => void; onerror?: () => void
    terminate = terminated
    postMessage() {
      if (!options.timeout) queueMicrotask(() => options.error ? this.onerror?.() : this.onmessage?.({ data: options.ready ?? { ready: true, yuv: true, baselineReason: 'ready', yuvReason: 'ready' } }))
    }
  })
  await import('./session.worker')
  const connected = scope.onmessage({ data: { id: 1, method: 'connect', value: { options: { size: { width: 640, height: 480 } }, extensions: { webcodecs_enabled: !options.disabled }, callbacks: ['rdp_diagnostic'] } } })
  if (options.timeout) await vi.advanceTimersByTimeAsync(3000)
  await connected
  const messages = scope.postMessage.mock.calls.map((call: any[]) => call[0])
  const reports = messages.filter((message: any) => message.type === 'event' && message.name === 'rdp_diagnostic')
  expect(reports).toHaveLength(1)
  expect(messages.find((message: any) => message.id === 1)?.error).toBeUndefined()
  return { report: reports[0].args[0], terminated }
}

it.each([
  [{ gate: 'isolation' }, 'not-cross-origin-isolated'],
  [{ gate: 'shared' }, 'shared-array-buffer-unavailable'],
  [{ gate: 'decoder' }, 'video-decoder-unavailable'],
  [{ disabled: true }, 'disabled-after-fallback'],
  [{ error: true }, 'worker-load-error'],
  [{ timeout: true }, 'init-timeout'],
  [{ ready: { ready: false, yuv: false, baselineReason: 'unsupported' } }, 'baseline-codec-unavailable'],
] as const)('reports the AVC startup exit %j without converting it into connection failure', async (options, reason) => {
  const { report } = await startup(options)
  expect(report.avc.reason).toBe(reason)
  expect(report.avc.avcAvailable).toBe(false)
  expect(report.gpuReason).toBe('Hardware renderer not verified')
})

it.each([false, true])('preserves AVC readiness when YUV support is %s', async yuv => {
  const { report, terminated } = await startup({ ready: { ready: true, yuv, baselineReason: 'ready', yuvReason: yuv ? 'ready' : 'high-profile-unsupported' } })
  expect(report.avc).toMatchObject({ reason: 'ready', avcAvailable: true, avcYuvAvailable: yuv })
  expect(typeof (globalThis as any).unitermDecodeAvc).toBe('function')
  expect(terminated).not.toHaveBeenCalled()
})

it('reports positive AVC observations once each and does not infer codec use from zero counts', async () => {
  let worker: any
  vi.stubGlobal('Worker', class {
    onmessage?: (event: any) => void
    constructor() { worker = this }
    postMessage(message: any) { queueMicrotask(() => this.onmessage?.({ data: { id: message.id } })) }
    terminate() {}
  })
  const { SessionBuilder, Extension, DesktopSize } = await import('./client')
  const diagnostic = vi.fn()
  const session = await new SessionBuilder().desktopSize(new DesktopSize(640, 480)).renderCanvas({ dataset: {} } as HTMLCanvasElement).extension(new Extension('rdp_diagnostic', diagnostic)).connect()
  const stats = { avcFrames: 0, gpuAvc420Frames: 0, gpuAvc444Frames: 0 }
  const send = () => worker.onmessage({ data: { type: 'stats', stats: { ...stats } } })
  send(); send(); expect(diagnostic).not.toHaveBeenCalled()
  stats.avcFrames = 1; send(); send()
  expect(diagnostic.mock.calls.map(call => call[0].kind)).toEqual(['avc-decoded'])
  stats.gpuAvc420Frames = 1; send(); send()
  stats.gpuAvc444Frames = 1; send(); send()
  expect(diagnostic.mock.calls.map(call => call[0].kind)).toEqual(['avc-decoded', 'gpu-avc420', 'gpu-avc444'])
  session.free()
})
