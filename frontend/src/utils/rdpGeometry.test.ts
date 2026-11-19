import { describe, expect, it } from 'vitest'
import { adaptiveRdpSize, rdpContentRect, rdpPointerPosition, rdpScaledResize, rdpScaleRefreshSize, rdpResizeRequests } from './rdpGeometry'

describe('adaptive RDP desktop dimensions', () => {
  it('uses one consistent alignment for initial connection and resizing', () => {
    expect(adaptiveRdpSize(1367, 745)).toEqual({ width: 1366, height: 744 })
  })

  it('keeps small panes within the supported desktop size and u16 limits', () => {
    expect(adaptiveRdpSize(320, 240)).toEqual({ width: 640, height: 480 })
    expect(adaptiveRdpSize(100000, 100000)).toEqual({ width: 65534, height: 65534 })
  })

  it.each([1.25, 1.5, 2])('fills the viewport with native pixels at display scale %s', ratio => {
    const desktop = adaptiveRdpSize(1280, 720, ratio)
    expect(desktop).toEqual({ width: 1280 * ratio, height: 720 * ratio })
    expect({ width: desktop.width / ratio, height: desktop.height / ratio }).toEqual({ width: 1280, height: 720 })
  })

  it('aligns the physical dimensions after applying display scaling', () => {
    expect(adaptiveRdpSize(1367, 745, 1.25)).toEqual({ width: 1708, height: 930 })
  })

  it.each([1, 1.25, 1.5, 2])('fits fractional viewport bounds without rounding up at display scale %s', ratio => {
    for (const [width, height] of [[1200.796875, 771.6875], [1000.8, 671.5], [999.59375, 670.208374]]) {
      const desktop = adaptiveRdpSize(width, height, ratio)
      expect(desktop.width / ratio).toBeLessThanOrEqual(width)
      expect(desktop.height / ratio).toBeLessThanOrEqual(height)
      expect(width * ratio - desktop.width).toBeLessThan(2)
      expect(height * ratio - desktop.height).toBeLessThan(2)
    }
  })

  it.each([0, -1, NaN, Infinity])('handles an invalid display scale %s', ratio => {
    expect(adaptiveRdpSize(1280, 720, ratio)).toEqual({ width: 1280, height: 720 })
  })
})

describe('RDP bitmap and mouse geometry', () => {
  const bounds = { left: 50, top: 100, width: 1200, height: 600 }
  const desktop = { width: 800, height: 600 }

  it('subtracts left/right letterboxing from fixed-resolution coordinates', () => {
    expect(rdpContentRect(bounds, desktop, false)).toEqual({ left: 250, top: 100, width: 800, height: 600 })
    expect(rdpPointerPosition(250, 100, bounds, desktop, false)).toEqual({ x: 0, y: 0 })
    expect(rdpPointerPosition(650, 400, bounds, desktop, false)).toEqual({ x: 400, y: 300 })
    expect(rdpPointerPosition(1049.9, 699.9, bounds, desktop, false)).toEqual({ x: 799, y: 599 })
  })

  it('subtracts top/bottom letterboxing and applies the bitmap scale', () => {
    const box = { left: 20, top: 40, width: 800, height: 800 }
    const remote = { width: 1600, height: 900 }
    expect(rdpContentRect(box, remote, false)).toEqual({ left: 20, top: 215, width: 800, height: 450 })
    expect(rdpPointerPosition(20, 215, box, remote, false)).toEqual({ x: 0, y: 0 })
    expect(rdpPointerPosition(420, 440, box, remote, false)).toEqual({ x: 800, y: 450 })
    expect(rdpPointerPosition(819.9, 664.9, box, remote, false)).toEqual({ x: 1599, y: 899 })
  })

  it.each([[100, 400], [1100, 400], [650, 99], [650, 700]])(
    'ignores clicks/movement outside the bitmap at (%d, %d)', (x, y) => {
      expect(rdpPointerPosition(x, y, bounds, desktop, false)).toBeNull()
    },
  )

  it('ignores upper/lower blank regions of a wide remote desktop', () => {
    const box = { left: 0, top: 0, width: 800, height: 800 }
    const remote = { width: 1600, height: 900 }
    expect(rdpPointerPosition(400, 100, box, remote, false)).toBeNull()
    expect(rdpPointerPosition(400, 700, box, remote, false)).toBeNull()
  })

  it('maps the entire viewport in adaptive mode even before a remote resize finishes', () => {
    expect(rdpContentRect(bounds, desktop, true)).toEqual(bounds)
    expect(rdpPointerPosition(50, 100, bounds, desktop, true)).toEqual({ x: 0, y: 0 })
    expect(rdpPointerPosition(650, 400, bounds, desktop, true)).toEqual({ x: 400, y: 300 })
    expect(rdpPointerPosition(1249.9, 699.9, bounds, desktop, true)).toEqual({ x: 799, y: 599 })
  })

  it('accepts DOMRect-style coordinates provided by prototype accessors', () => {
    const domRect = Object.create(bounds)
    expect(rdpPointerPosition(50, 100, domRect, desktop, true)).toEqual({ x: 0, y: 0 })
    expect(rdpPointerPosition(650, 400, domRect, desktop, true)).toEqual({ x: 400, y: 300 })
  })

  it('clamps an ongoing drag/release to the desktop edge outside the bitmap', () => {
    expect(rdpPointerPosition(100, 400, bounds, desktop, false, true)).toEqual({ x: 0, y: 300 })
    expect(rdpPointerPosition(1300, 800, bounds, desktop, false, true)).toEqual({ x: 799, y: 599 })
    expect(rdpPointerPosition(500, 50, bounds, desktop, false, true)).toEqual({ x: 250, y: 0 })
  })

  it('uses fractional CSS pixels without treating them as framebuffer pixels', () => {
    const box = { left: 100.25, top: 50.5, width: 1000.5, height: 700.25 }
    const remote = { width: 1920, height: 1080 }
    const content = rdpContentRect(box, remote, false)!
    expect(rdpPointerPosition(content.left, content.top, box, remote, false)).toEqual({ x: 0, y: 0 })
    expect(rdpPointerPosition(content.left + content.width / 2, content.top + content.height / 2, box, remote, false))
      .toEqual({ x: 960, y: 540 })
  })

  it('maps against the new framebuffer after a desktop resolution change', () => {
    const box = { left: 0, top: 0, width: 1200, height: 800 }
    expect(rdpPointerPosition(600, 400, box, { width: 1280, height: 720 }, true)).toEqual({ x: 640, y: 360 })
    expect(rdpPointerPosition(600, 400, box, { width: 1200, height: 800 }, true)).toEqual({ x: 600, y: 400 })
  })

  it('maps native-size fixed desktop coordinates on a 125% display', () => {
    const remote = { width: 1280, height: 720 }
    const box = { left: 20, top: 40, width: remote.width / 1.25, height: remote.height / 1.25 }
    expect(rdpPointerPosition(532, 328, box, remote, true)).toEqual({ x: 640, y: 360 })
    expect(rdpPointerPosition(1043.9, 615.9, box, remote, true)).toEqual({ x: 1279, y: 719 })
  })

  it('maps adaptive pointer coordinates to the high-DPI framebuffer', () => {
    const box = { left: 20, top: 40, width: 1280, height: 720 }
    const desktop = adaptiveRdpSize(box.width, box.height, 1.25)
    expect(rdpPointerPosition(660, 400, box, desktop, true)).toEqual({ x: 800, y: 450 })
    expect(rdpPointerPosition(1299.9, 759.9, box, desktop, true)).toEqual({ x: 1599, y: 899 })
  })

  it('ignores hidden/zero-sized viewports or an unavailable framebuffer', () => {
    expect(rdpPointerPosition(0, 0, { ...bounds, width: 0 }, desktop, false)).toBeNull()
    expect(rdpPointerPosition(0, 0, { ...bounds, height: 0 }, desktop, true)).toBeNull()
    expect(rdpPointerPosition(0, 0, bounds, { width: 0, height: 0 }, false)).toBeNull()
  })
})

describe('native RandR scale bridge', () => {
  it.each([100, 125, 150, 200, 300, 500])('encodes %s%% as virtual monitor DPI', scale => {
    const [w, h, sent, mmw, mmh] = rdpScaledResize(2512, 1384, scale)
    expect(sent).toBe(scale)
    const actual = Math.min(w * 25.4 / mmw, h * 25.4 / mmh) / 96 * 100
    expect(Math.abs(actual - scale)).toBeLessThan(2)
  })
  it('preserves pixel dimensions and protocol limits', () => {
    expect(rdpScaledResize(1920, 1080, 200)).toEqual([1920, 1080, 200, 254, 143])
    expect(rdpScaledResize(640, 480, NaN)[2]).toBe(100)
    expect(rdpScaledResize(65534, 65534, 0).slice(3)).toEqual([10000, 10000])
    expect(rdpScaledResize(10, 10, 999).slice(2)).toEqual([500, 10, 10])
  })
  it.each([640, 642, 2512, 65534])('refreshes a same-size %s-pixel layout with a valid aligned size', width => {
    const intermediate = rdpScaleRefreshSize(width, 1384)
    expect(intermediate.width).not.toBe(width)
    expect(intermediate.width % 2).toBe(0)
    expect(intermediate.width).toBeGreaterThanOrEqual(640)
    expect(intermediate.width).toBeLessThanOrEqual(65534)
    expect(intermediate.height).toBe(1384)
  })
})

describe('Windows RDP isolation', () => {
  it.each([undefined, false])('keeps exactly the original three-argument message when compatibility is %s', enabled => {
    for (const current of [null, { width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      for (const scale of [100, 150, 200]) {
        expect(rdpResizeRequests(1920, 1080, scale, current, enabled)).toEqual([[1920, 1080, scale]])
      }
    }
  })
  it('only sends a physical-size refresh sequence for explicitly enabled xrdp', () => {
    expect(rdpResizeRequests(1920, 1080, 200, { width: 1920, height: 1080 }, true))
      .toEqual([[1918, 1080, 200, 254, 143], [1920, 1080, 200, 254, 143]])
    expect(rdpResizeRequests(1920, 1080, 200, null, true)).toEqual([[1920, 1080, 200, 254, 143]])
  })
})
