import { describe, expect, it } from 'vitest'
import { displayRates } from './displayPerformance'

describe('remote display performance rates', () => {
  const start = { at: 200, frames: 120, bytes: 1000 }
  it('uses elapsed time, decimal bits and rendered updates', () => {
    expect(displayRates(start, { at: 1200, frames: 150, bytes: 501000 })).toEqual({ fps: '30', bitrate: '4.0 Mbps' })
    expect(displayRates(start, { at: 2700, frames: 125, bytes: 13500 })).toEqual({ fps: '2', bitrate: '40 kbps' })
  })
  it('distinguishes idle, missing samples and reset counters independently', () => {
    expect(displayRates(undefined, start)).toEqual({ fps: '—', bitrate: '—' })
    expect(displayRates(start, { ...start, at: 1200 })).toEqual({ fps: '0', bitrate: '0 kbps' })
    expect(displayRates(start, { at: 1200, frames: 0, bytes: 2000 })).toEqual({ fps: '—', bitrate: '8 kbps' })
    expect(displayRates(start, { at: 1200, frames: 140, bytes: null })).toEqual({ fps: '20', bitrate: '—' })
  })
})
