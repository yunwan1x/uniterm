import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rdpScaledResize } from './rdpGeometry'
import { XrdpScaleRefresh } from './xrdpScaleRefresh'

const temp = rdpScaledResize(2510, 1384, 200)
const target = rdpScaledResize(2512, 1384, 200)

describe('xrdp DPI refresh', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function start() {
    const send = vi.fn()
    const refresh = new XrdpScaleRefresh(send)
    refresh.start(temp, target)
    return { send, refresh }
  }

  it('waits for the temporary framebuffer and stops when the target is restored', () => {
    const { send, refresh } = start()
    refresh.observe(target[0], target[1]) // old frame still on screen
    vi.advanceTimersByTime(900)
    expect(send.mock.calls).toEqual([[temp]])
    refresh.observe(temp[0], temp[1])
    refresh.observe(temp[0], temp[1])
    refresh.observe(target[0], target[1])
    vi.runAllTimers()
    expect(send.mock.calls).toEqual([[temp], [target]])
  })

  it('retries only the unobserved step, including a dropped restore', () => {
    const { send, refresh } = start()
    vi.advanceTimersToNextTimer()
    refresh.observe(temp[0], temp[1])
    vi.advanceTimersToNextTimer()
    refresh.observe(target[0], target[1])
    vi.runAllTimers()
    expect(send.mock.calls).toEqual([[temp], [temp], [target], [target]])
  })

  it('finishes with the intended size and bounds retries without feedback', () => {
    const { send } = start()
    vi.runAllTimers()
    expect(send.mock.calls).toEqual([[temp], [temp], [temp], [target], [target], [target]])
  })

  it('supersedes the old layout and cancels pending work on disconnect', () => {
    const { send, refresh } = start()
    const nextTemp = rdpScaledResize(1918, 1080, 150)
    const nextTarget = rdpScaledResize(1920, 1080, 150)
    refresh.start(nextTemp, nextTarget)
    refresh.observe(temp[0], temp[1])
    refresh.observe(nextTemp[0], nextTemp[1])
    refresh.cancel()
    vi.runAllTimers()
    expect(send.mock.calls).toEqual([[temp], [nextTemp], [nextTarget]])
  })
})
