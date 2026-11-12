import { afterEach, describe, expect, it, vi } from 'vitest'
import { installVncPerformance, VncQualityController } from './vncPerformance'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('automatic VNC quality', () => {
  it('reduces slow large updates, rate limits changes, and retains a quality floor', () => {
    const p = new VncQualityController()
    expect(p.observe(250, 100, 100, 0)).toBe(5)
    expect(p.observe(250, 100, 100, 100)).toBe(5)
    expect(p.observe(250, 100, 100, 2000)).toBe(4)
    expect(p.observe(250, 100, 100, 4000)).toBe(3)
    expect(p.observe(1000, 100, 100, 8000)).toBe(3)
  })
  it('does not mistake fast cursor or small tile updates for a recovered link', () => {
    const p = new VncQualityController(3)
    for (let i = 0; i < 100; i++) p.observe(1, 1, 100, i * 1000)
    expect(p.quality).toBe(3)
    expect(p.observe(1000, 1, 100, 200000)).toBe(3)
  })
  it('requires sustained recovery and raises quality one step at a time', () => {
    const p = new VncQualityController()
    p.observe(250, 100, 100, 0)
    for (let i = 1; i <= 7; i++) p.observe(40, 100, 100, i * 1000)
    expect(p.quality).toBe(5)
    expect(p.observe(40, 100, 100, 8000)).toBe(6)
    for (let i = 9; i < 50; i++) p.observe(40, 100, 100, i * 1000)
    expect(p.quality).toBe(6)
  })
  it('does not recover merely because the screen is idle', () => {
    const p = new VncQualityController(3)
    expect(p.observe(0, 0, 100, 60000)).toBe(3)
    expect(p.observe(NaN, 100, 100, 61000)).toBe(3)
  })
})

describe('noVNC adapter lifecycle and ordering', () => {
  function fixture() {
    vi.useFakeTimers()
    vi.stubGlobal('document', { hidden: false })
    const socket = new EventTarget()
    const canvas = new EventTarget()
    let remaining = true
    const rfb = Object.assign(new EventTarget(), {
      qualityLevel: 6, _fbWidth: 100, _fbHeight: 100,
      _canvas: canvas, _sock: { _websocket: socket },
      _FBU: { encoding: 7, width: 100, height: 100 },
      _display: { pending: (): boolean => false, flush: () => Promise.resolve() },
      _handleRect: vi.fn(() => remaining),
      _framebufferUpdate() { return this._handleRect() },
    })
    return { rfb, setRemaining: (value: boolean) => { remaining = value } }
  }
  it('measures a fragmented update across arrivals without dropping or replaying it', () => {
    const { rfb, setRemaining } = fixture()
    const original = rfb._framebufferUpdate
    const rect = rfb._handleRect
    const stop = installVncPerformance(rfb as any)
    setRemaining(false)
    expect(rfb._framebufferUpdate()).toBe(false)
    vi.advanceTimersByTime(250)
    setRemaining(true)
    expect(rfb._framebufferUpdate()).toBe(true)
    expect(rfb.qualityLevel).toBe(5)
    expect(rect).toHaveBeenCalledTimes(2)
    stop(); stop()
    expect(rfb._framebufferUpdate).toBe(original)
    expect(rfb._handleRect).toBe(rect)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('waits for decode completion and ignores pending callbacks after disposal', async () => {
    const { rfb } = fixture()
    let finish!: () => void
    rfb._display.pending = () => true
    rfb._display.flush = () => new Promise<void>(resolve => { finish = resolve })
    const stop = installVncPerformance(rfb as any)
    rfb._framebufferUpdate()
    vi.advanceTimersByTime(300)
    expect(rfb.qualityLevel).toBe(6)
    stop(); finish(); await Promise.resolve()
    expect(rfb.qualityLevel).toBe(6)
  })
  it('cleans up on disconnect and does not treat background throttling as congestion', () => {
    const { rfb, setRemaining } = fixture()
    const original = rfb._framebufferUpdate
    installVncPerformance(rfb as any)
    setRemaining(false); rfb._framebufferUpdate()
    vi.advanceTimersByTime(1000)
    vi.stubGlobal('document', { hidden: true })
    setRemaining(true); rfb._framebufferUpdate()
    expect(rfb.qualityLevel).toBe(6)
    rfb.dispatchEvent(new Event('disconnect'))
    expect(rfb._framebufferUpdate).toBe(original)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('leaves unsupported future noVNC versions alone', () => {
    const rfb = { qualityLevel: 6 }
    installVncPerformance(rfb as any)()
    expect(rfb).toEqual({ qualityLevel: 6 })
  })
})
