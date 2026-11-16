import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useFullscreenToolbar } from './useFullscreenToolbar'

const scopes: ReturnType<typeof effectScope>[] = []
function open(options: { active?: boolean; pinned?: boolean } = {}) {
  const active = ref(options.active ?? true)
  const hold = ref(false)
  const pin = ref(options.pinned ?? false)
  const scope = effectScope()
  scopes.push(scope)
  const toolbar = scope.run(() => useFullscreenToolbar(() => active.value, () => hold.value, pin))!
  return { ...toolbar, active, hold, scope }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('fullscreen toolbar policy', () => {
  it('starts visible for two seconds without pinning, then collapses', () => {
    const toolbar = open()
    expect(toolbar.visible.value).toBe(true)
    expect(toolbar.pinned.value).toBe(false)
    vi.advanceTimersByTime(1999)
    expect(toolbar.visible.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(toolbar.visible.value).toBe(false)
  })

  it('requires a 200 ms handle hover and cancels a brief crossing', () => {
    const toolbar = open()
    vi.advanceTimersByTime(2000)
    toolbar.hoverHandle()
    vi.advanceTimersByTime(199)
    expect(toolbar.visible.value).toBe(false)
    toolbar.cancelReveal()
    vi.advanceTimersByTime(1)
    expect(toolbar.visible.value).toBe(false)
    toolbar.hoverHandle()
    vi.advanceTimersByTime(200)
    expect(toolbar.visible.value).toBe(true)
  })

  it('keeps pointer hover open and waits one second after leaving', () => {
    const toolbar = open()
    toolbar.hovered.value = true
    vi.advanceTimersByTime(5000)
    expect(toolbar.visible.value).toBe(true)
    toolbar.hovered.value = false
    vi.advanceTimersByTime(999)
    expect(toolbar.visible.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(toolbar.visible.value).toBe(false)
  })

  it.each(['focused', 'popupOpen', 'hold'] as const)('keeps %s open, then resumes auto-hide', reason => {
    const toolbar = open()
    toolbar[reason].value = true
    vi.advanceTimersByTime(5000)
    expect(toolbar.visible.value).toBe(true)
    toolbar[reason].value = false
    vi.advanceTimersByTime(1000)
    expect(toolbar.visible.value).toBe(false)
  })

  it('does not let explicit collapse strand an open menu or detached panel', () => {
    const toolbar = open()
    toolbar.popupOpen.value = true
    expect(toolbar.hide()).toBe(false)
    toolbar.popupOpen.value = false
    toolbar.hold.value = true
    expect(toolbar.hide()).toBe(false)
    expect(toolbar.visible.value).toBe(true)
  })

  it('explicit collapse clears the pin and local focus/hover without reopening itself', () => {
    const toolbar = open({ pinned: true })
    toolbar.hovered.value = true
    toolbar.focused.value = true
    expect(toolbar.hide()).toBe(true)
    expect(toolbar.visible.value).toBe(false)
    expect(toolbar.pinned.value).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(toolbar.visible.value).toBe(false)
  })

  it('does not reveal over a remote drag, including a drag starting during hover dwell', () => {
    const toolbar = open()
    vi.advanceTimersByTime(2000)
    toolbar.hoverHandle(1)
    vi.advanceTimersByTime(200)
    expect(toolbar.visible.value).toBe(false)
    toolbar.hoverHandle()
    vi.advanceTimersByTime(100)
    toolbar.remoteGesture.value = true
    vi.advanceTimersByTime(100)
    toolbar.show()
    expect(toolbar.visible.value).toBe(false)
    expect(toolbar.hide()).toBe(false)
    toolbar.remoteGesture.value = false
    toolbar.show()
    expect(toolbar.visible.value).toBe(true)
  })

  it('honors the pin until unpinned and preserves it across fullscreen activations', () => {
    const toolbar = open({ pinned: true })
    vi.advanceTimersByTime(10000)
    expect(toolbar.visible.value).toBe(true)
    toolbar.active.value = false
    expect(toolbar.visible.value).toBe(false)
    toolbar.active.value = true
    vi.advanceTimersByTime(10000)
    expect(toolbar.visible.value).toBe(true)
    toolbar.togglePin()
    vi.advanceTimersByTime(1000)
    expect(toolbar.visible.value).toBe(false)
  })

  it('restarts the two-second introduction only when entering fullscreen', () => {
    const toolbar = open({ active: false })
    vi.advanceTimersByTime(5000)
    expect(toolbar.visible.value).toBe(false)
    toolbar.active.value = true
    vi.advanceTimersByTime(1000)
    toolbar.scheduleHide()
    vi.advanceTimersByTime(999)
    expect(toolbar.visible.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(toolbar.visible.value).toBe(false)
  })

  it('cancels pending timers when leaving fullscreen or destroying the component', () => {
    const toolbar = open()
    toolbar.hoverHandle()
    toolbar.active.value = false
    expect(vi.getTimerCount()).toBe(0)
    toolbar.active.value = true
    expect(vi.getTimerCount()).toBe(1)
    toolbar.scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('fullscreen pin preference', () => {
  it('shares a persisted preference and restores it on a new application load', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) })
    vi.resetModules()
    const first = await import('./useFullscreenToolbar')
    const rdp = first.useFullscreenToolbarPinned()
    const android = first.useFullscreenToolbarPinned()
    expect(rdp.value).toBe(false)
    rdp.value = true
    expect(android.value).toBe(true)
    expect(storage.get(first.FULLSCREEN_TOOLBAR_PIN_KEY)).toBe('true')
    vi.resetModules()
    const reloaded = await import('./useFullscreenToolbar')
    expect(reloaded.useFullscreenToolbarPinned().value).toBe(true)
  })

  it('supports a session-only preference when browser storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    vi.resetModules()
    const module = await import('./useFullscreenToolbar')
    const pin = module.useFullscreenToolbarPinned()
    expect(pin.value).toBe(false)
    expect(() => { pin.value = true }).not.toThrow()
    expect(pin.value).toBe(true)
  })
})
