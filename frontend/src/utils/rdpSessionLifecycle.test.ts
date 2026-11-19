import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Exercise the component's actual lifecycle functions without mounting its
// unrelated dialogs/stores/native bindings. No copied implementation is tested.
const source = readFileSync(new URL('../components/RDPTabContent.vue', import.meta.url), 'utf8')
const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
const ast = ts.createSourceFile('RDPTabContent.ts', script, ts.ScriptTarget.Latest, true)
const names = new Set([
  'startClient', 'retryRenderer', 'runEnded', 'reconnect', 'connect',
  'clearConnectTimer', 'splitDomainUser', 'requestFallbackReconnect',
  'finishReconnect', 'reconnectWithSize', 'retryWithSecurityFallback',
  'requestAdaptiveResize', 'onFramebufferResize',
])
const functions = ast.statements.filter((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ''),
).map(node => node.getText(ast)).join('\n')
const compiled = ts.transpileModule(functions
  .split('import.meta.env.VITE_VERSION').join('"test"')
  .split('import.meta.url').join('"http://localhost/test"'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const ref = <T>(value: T) => ({ value })

function fixture() {
  vi.useFakeTimers()
  let sessionId = 0
  const builderConnect = vi.fn(() => new Promise(() => {}))
  const mod = {
    SessionBuilder: class {
      constructor() {
        let proxy: any
        proxy = new Proxy(this, { get: (_, key) => key === 'connect' ? builderConnect : () => proxy })
        return proxy
      }
    },
    DesktopSize: class {}, Extension: class {},
  }
  const c: any = {
    console, URL, JSON, performance, Uint8Array, Error, Number, String, Map, Set, Object,
    props: { config: { host: 'test' }, panelId: 'test' }, canvasEl: ref({}),
    started: false, disposed: false, clientGeneration: 0, activeSecurityMode: 'nla-prefer',
    status: ref('connected'), errorMessage: ref(''), framebufferSize: ref(null),
    connectTimer: null, CONNECT_TIMEOUT: 30000, setTimeout, clearTimeout,
    t: (s: string) => s, canvasGeneration: ref(0), nextTick: vi.fn(async () => {}),
    canvasObserver: null, browserFilesEnabled: ref(false),
    isWebServerMode: async () => true, loadWasm: async () => mod,
    effectiveUser: ref('test'), effectivePassword: ref(''),
    resolveDesktopSize: () => ({ width: 1280, height: 720 }),
    lastResizeRequest: null, lastScaleRequest: null, scaleSyncAttempts: 0,
    displayControlUsable: null, clearScaleSync: () => {}, rdpLog: vi.fn(),
    activeQuality: ref('balanced'), activeGraphicsMode: ref('gfx'),
    activeResolution: ref('fixed'), zoom: ref(1), localScalePercent: () => 100,
    isAdaptive: () => false, resolveSecurityMode: () => 'nla-prefer',
    avcFallbackAttempted: false, workerFallbackAttempted: false, canvasFallbackAttempted: false,
    securityFallbackAttempted: false, wasmModule: null,
    toWebSocketURL: (s: string) => s, proxyAuthToken: () => '', audioPlayer: null,
    audioEnabled: ref(true), audioBlocked: ref(false),
    RdpAudioPlayer: class { setEnabled() {} unlock() {} onStats() {} dispose() {} },
    capture: { enabled: () => false }, sessionGraphicsMode: ref('gfx'),
    rdpQualityProfile: () => ({ connectionType: 6, performanceFlags: 0 }),
    sessionQuality: ref('balanced'), sessionResolution: ref('fixed'),
    onCursorStyle: () => {}, onRemoteClipboard: () => {}, describeError: (e: Error) => e.message,
    backendErrorText: (e: Error) => e.message, reconnecting: false,
    currentSessionId: ref('old'), CloseSession: vi.fn(async () => {}),
    CreateSession: vi.fn(async () => ({ id: 'new' + (++sessionId), proxyAddr: 'ws://test' })),
    panelStore: { bindSession: vi.fn(), setProxyAddr: vi.fn() }, pendingFallback: false,
    onContainerResize: vi.fn(), onFocusOut: vi.fn(), stopClipboardPoll: vi.fn(),
    clearResizeProbe: vi.fn(), pressedMouseButtons: new Set(),
  }
  c.teardownClient = vi.fn(() => {
    c.started = false
    c.clientGeneration++
    c.clearConnectTimer()
  })
  createContext(c)
  runInContext(compiled, c)
  const unmount = () => {
    c.disposed = true
    c.pendingFallback = false
    c.teardownClient()
    c.canvasEl.value = null
  }
  return { c, builderConnect, unmount }
}
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve() }
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('RDP session lifecycle recovery', () => {
  it('waits for the initial framebuffer before negotiating xrdp DPI', () => {
    const { c } = fixture()
    const desktop = { width: 1734, height: 1090 }
    c.props.config.rdpXrdpScaleCompatibility = true
    c.session = {}
    c.isAdaptive = () => true
    c.floating = c.mobileKbOpen = ref(false)
    c.canvasEl.value = { width: 300, height: 150 }
    c.currentDesktopSize = () => c.canvasEl.value
    c.adaptiveDesktopSize = () => desktop
    c.localScalePercent = () => 150
    c.sendScaledResize = vi.fn()
    c.scheduleScaleSync = vi.fn()
    c.onContainerResize.mockImplementation(() => c.requestAdaptiveResize())

    c.requestAdaptiveResize()
    expect(c.sendScaledResize).not.toHaveBeenCalled()
    c.canvasEl.value = desktop
    c.onFramebufferResize()
    expect(c.sendScaledResize).toHaveBeenCalledExactlyOnceWith(1734, 1090, 150)
    expect(c.scheduleScaleSync).toHaveBeenCalledWith(150)
    c.onFramebufferResize()
    expect(c.onContainerResize).toHaveBeenCalledOnce()
  })

  it.each([
    ['RDP canvas context unavailable', 'canvasFallbackAttempted'],
    ['RDP worker failed', 'workerFallbackAttempted'],
  ])('retries %s after the active reconnect unlocks', async (message, flag) => {
    const { c, builderConnect } = fixture()
    builderConnect.mockRejectedValueOnce(new Error(message))
    await c.reconnect()
    await settle()
    expect(c[flag]).toBe(true)
    expect(c.CreateSession).toHaveBeenCalledTimes(2)
    expect(builderConnect).toHaveBeenCalledTimes(2)
    expect(c.status.value).toBe('connecting')
    expect(c.reconnecting).toBe(true)
    expect(vi.getTimerCount()).toBe(1) // The replacement handshake has a timeout.
  })

  it('coalesces AVC and renderer fallbacks raised while a reconnect is running', async () => {
    const { c } = fixture()
    c.reconnecting = true
    c.runEnded('WebCodecs AVC decode failed', true)
    c.retryRenderer('RDP WebGL context lost')
    expect(c.pendingFallback).toBe(true)
    expect(c.CreateSession).not.toHaveBeenCalled()
    c.finishReconnect()
    await settle()
    expect(c.avcFallbackAttempted).toBe(true)
    expect(c.canvasFallbackAttempted).toBe(true)
    expect(c.CreateSession).toHaveBeenCalledTimes(1)
    expect(c.pendingFallback).toBe(false)
  })

  it('stops after the compatible renderer also fails', async () => {
    const { c, builderConnect } = fixture()
    builderConnect.mockRejectedValue(new Error('RDP canvas context unavailable'))
    await c.reconnect()
    await settle()
    expect(c.CreateSession).toHaveBeenCalledTimes(2)
    expect(c.status.value).toBe('error')
    expect(c.errorMessage.value).toBe('RDP canvas context unavailable')
    expect(c.reconnecting).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still queues a security fallback behind the active reconnect', async () => {
    const { c } = fixture()
    c.reconnecting = true
    expect(c.retryWithSecurityFallback('remote error: tls: internal error')).toBe(true)
    c.finishReconnect()
    await settle()
    expect(c.activeSecurityMode).toBe('tls')
    expect(c.CreateSession).toHaveBeenCalledOnce()
    expect(c.CreateSession.mock.calls[0][1].rdpSecurityMode).toBe('tls')
  })

  it.each(['connect', 'reconnectWithSize'])('closes a %s response that arrives after unmount', async method => {
    const { c, unmount } = fixture()
    let resolve!: (value: any) => void
    c.currentSessionId.value = null
    c.CreateSession.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = c[method](1920, 1080)
    await settle()
    unmount()
    resolve({ id: 'late', proxyAddr: 'ws://test' })
    await pending
    expect(c.CloseSession).toHaveBeenCalledWith('late')
    expect(c.panelStore.bindSession).not.toHaveBeenCalled()
    expect(c.panelStore.setProxyAddr).not.toHaveBeenCalled()
    expect(c.currentSessionId.value).toBeNull()
    expect(c.onContainerResize).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes an obsolete response without overwriting the newer session', async () => {
    const { c } = fixture()
    let resolve!: (value: any) => void
    c.CreateSession.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = c.connect()
    c.teardownClient()
    c.currentSessionId.value = 'replacement'
    resolve({ id: 'obsolete', proxyAddr: 'ws://test' })
    await pending
    expect(c.CloseSession).toHaveBeenCalledWith('obsolete')
    expect(c.currentSessionId.value).toBe('replacement')
    expect(c.panelStore.bindSession).not.toHaveBeenCalled()
  })

  it('keeps the same proxy if the initial store watcher starts its client before nextTick', async () => {
    const { c } = fixture()
    c.panelStore.setProxyAddr.mockImplementationOnce(() => {
      c.started = true
      c.clientGeneration++
    })
    await c.connect()
    expect(c.currentSessionId.value).toBe('new1')
    expect(c.CloseSession).not.toHaveBeenCalled()
  })

  it('does not create a replacement session if the tab closes while closing the old proxy', async () => {
    const { c, unmount } = fixture()
    let resolve!: () => void
    c.CloseSession.mockImplementationOnce(() => new Promise<void>(r => { resolve = r }))
    const pending = c.reconnect()
    unmount()
    resolve()
    await pending
    expect(c.CreateSession).not.toHaveBeenCalled()
  })

  it('cancels queued fallback on unmount and ignores late creation errors', async () => {
    const { c, unmount } = fixture()
    let reject!: (error: Error) => void
    c.CreateSession.mockImplementationOnce(() => new Promise((_, r) => { reject = r }))
    const pending = c.reconnect()
    await settle()
    c.runEnded('WebCodecs AVC decode failed', true)
    unmount()
    c.status.value = 'disconnected'
    reject(new Error('late backend error'))
    await pending
    expect(c.CreateSession).toHaveBeenCalledOnce()
    expect(c.status.value).toBe('disconnected')
    expect(c.errorMessage.value).toBe('')
    expect(c.pendingFallback).toBe(false)
  })
})
