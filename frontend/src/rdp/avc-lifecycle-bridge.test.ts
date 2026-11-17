import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@ys-ll/ironrdp-wasm', () => ({
  default: vi.fn(), setup: vi.fn(), DesktopSize: class {},
  SessionBuilder: class { desktopSize() { return this }; renderCanvas() { return this }; connect() { return {} }; free() {} },
}))
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules()
  for (const name of ['unitermReleaseAvc','unitermResetAvc','unitermPrepareAvc','unitermDecodeAvc','unitermAvcYuv']) delete (globalThis as any)[name]
})

it('exposes decoder cleanup without a GPU bridge and ignores completions from a cancelled generation', async () => {
  vi.useFakeTimers()
  const scope: any = { postMessage: vi.fn() }, messages: any[] = []
  let worker: any, control: Int32Array
  vi.stubGlobal('self', scope); vi.stubGlobal('WebSocket', class {})
  vi.stubGlobal('crossOriginIsolated', true); vi.stubGlobal('isSecureContext', true); vi.stubGlobal('VideoDecoder', class {})
  vi.stubGlobal('Worker', class {
    onmessage: any; onerror: any; terminate = vi.fn()
    constructor() { worker = this }
    postMessage(message: any) {
      messages.push(message)
      if (message.method === 'init') { control = new Int32Array(message.control); this.onmessage({ data: { ready: true, yuv: false } }) }
    }
  })
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {}; getContext() { return { putImageData: vi.fn() } } })
  await import('./session.worker')
  await scope.onmessage({ data: { id: 1, method: 'connect', value: { options: { size: { width: 100, height: 100 } }, extensions: { canvas2d: true }, callbacks: [] } } })
  expect((globalThis as any).unitermGpuCommand).toBeUndefined()
  ;(globalThis as any).unitermReleaseAvc(9)
  expect(messages.at(-1)).toEqual({ method: 'release', surface: 9 })
  const old = (globalThis as any).unitermPrepareAvc([[9,new Uint8Array(1),false]])
  const rejected = expect(old).rejects.toThrow('AVC preparation cancelled')
  ;(globalThis as any).unitermResetAvc()
  await rejected
  const fresh = (globalThis as any).unitermPrepareAvc([[9,new Uint8Array(1),false]])
  worker.onmessage({ data: { method: 'decoded', timestamp: 1, status: -1 } })
  control![1] = 2; control![2] = 2
  worker.onmessage({ data: { method: 'decoded', timestamp: 2, status: 1 } })
  await expect(fresh).resolves.toBeUndefined()
  expect((globalThis as any).unitermDecodeAvc(9,false,false).slice(0,2)).toEqual([2,2])
})
