import { expect, it } from 'vitest'
import { DesktopDamage } from './damage'
const image = { width: 100, height: 80 }
function initialized(limit = 1) { const d = new DesktopDamage(limit); d.add(3840, 2160, image, 0, 0); d.take(3840, 2160); return d }
it('sends a full initial surface and invalidates old captures on resize or explicit reset', () => {
  const d = new DesktopDamage(4); d.add(3840, 2160, image, 900, 600)
  expect(d.take(3840, 2160)).toEqual([{ x: 0, y: 0, width: 3840, height: 2160 }])
  const generation = d.generation
  d.add(3840, 2160, image, 0, 0); d.take(3840, 2160)
  expect(d.generation).toBe(generation)
  d.add(1920, 1080, image, 900, 600)
  expect(d.generation).toBe(generation + 1)
  expect(d.take(1920, 1080)).toEqual([{ x: 0, y: 0, width: 1920, height: 1080 }])
  d.full(1920, 1080)
  expect(d.generation).toBe(generation + 2)
  expect(d.take(1920, 1080)).toEqual([{ x: 0, y: 0, width: 1920, height: 1080 }])
  expect(d.take(800, 600)).toEqual([{ x: 0, y: 0, width: 800, height: 600 }])
  expect(d.generation).toBe(generation + 3)
})
it('keeps the original bounding rectangle behavior with the default limit', () => {
  const d = initialized(); d.add(3840, 2160, image, 20, 30)
  expect(d.take(3840, 2160)).toEqual([{ x: 20, y: 30, width: 100, height: 80 }])
  d.add(3840, 2160, image, 10, 20); d.add(3840, 2160, image, 200, 300)
  expect(d.take(3840, 2160)).toEqual([{ x: 10, y: 20, width: 290, height: 360 }])
  expect(d.take(3840, 2160)).toBeNull()
})
it('keeps far apart updates separate and merges nearby patches within the pixel budget', () => {
  const d = initialized(4)
  d.add(3840, 2160, image, 10, 20); d.add(3840, 2160, image, 3000, 1900)
  expect(d.take(3840, 2160)).toEqual([{ x: 10, y: 20, width: 100, height: 80 }, { x: 3000, y: 1900, width: 100, height: 80 }])
  d.add(3840, 2160, image, 10, 20); d.add(3840, 2160, image, 150, 20)
  expect(d.take(3840, 2160)).toEqual([{ x: 10, y: 20, width: 240, height: 80 }])
})
it('does not inflate thin intersecting regions into a large rectangle', () => {
  const d = initialized(4)
  d.add(3840, 2160, { width: 1000, height: 2 }, 0, 500)
  d.add(3840, 2160, { width: 2, height: 1000 }, 500, 0)
  const regions = d.take(3840, 2160)!
  expect(regions).toHaveLength(2)
  expect(regions.reduce((n, r) => n + r.width * r.height, 0)).toBe(4000)
})
it('counts overlapping pixels once when applying the merge overhead budget', () => {
  const d = initialized(4), square = { width: 100, height: 100 }
  // 22,500 bounding pixels exceed 125% of the 17,500 unique changed pixels.
  d.add(3840, 2160, square, 0, 0); d.add(3840, 2160, square, 50, 50)
  expect(d.take(3840, 2160)).toHaveLength(2)
  // A smaller diagonal offset fits the unique-area budget and can coalesce.
  d.add(3840, 2160, square, 0, 0); d.add(3840, 2160, square, 40, 40)
  expect(d.take(3840, 2160)).toEqual([{ x: 0, y: 0, width: 140, height: 140 }])
  d.add(3840, 2160, { width: 120, height: 60 }, 0, 30)
  d.add(3840, 2160, { width: 60, height: 120 }, 30, 0)
  expect(d.take(3840, 2160)).toHaveLength(2)
})
it('bounds region count during long bursts and folds a full update into one capture', () => {
  const d = initialized(4)
  for (let i = 0; i < 500; i++) d.add(3840, 2160, { width: 1, height: 1 }, (i * 53) % 3840, (i * 97) % 2160)
  expect(d.take(3840, 2160)!.length).toBeLessThanOrEqual(4)
  for (let i = 0; i < 4; i++) d.add(3840, 2160, image, i * 800, i * 500)
  d.add(3840, 2160, { width: 3840, height: 2160 }, 0, 0)
  expect(d.take(3840, 2160)).toEqual([{ x: 0, y: 0, width: 3840, height: 2160 }])
})
it('preserves every changed pixel across bounded batches', () => {
  const d = new DesktopDamage(4); d.take(64, 64)
  for (let batch = 0; batch < 20; batch++) {
    const changed = new Set<number>()
    for (let i = 0; i < 12; i++) {
      const x = (batch * 7 + i * 17) % 64, y = (batch * 19 + i * 11) % 64
      d.add(64, 64, { width: 3, height: 5 }, x, y)
      for (let py = y; py < Math.min(64, y + 5); py++) for (let px = x; px < Math.min(64, x + 3); px++) changed.add(py * 64 + px)
    }
    const regions = d.take(64, 64)!
    expect(regions.length).toBeLessThanOrEqual(4)
    for (const at of changed) expect(regions.some(r => at % 64 >= r.x && at % 64 < r.x + r.width && Math.floor(at / 64) >= r.y && Math.floor(at / 64) < r.y + r.height)).toBe(true)
  }
})
it('maps source dirty rectangles to destination coordinates and clips both bounds', () => {
  const d = initialized(4); d.add(3840, 2160, image, -10, -20, 5, 10, 30, 40)
  expect(d.take(3840, 2160)).toEqual([{ x: 0, y: 0, width: 25, height: 30 }])
  d.add(3840, 2160, image, 3820, 2150)
  expect(d.take(3840, 2160)).toEqual([{ x: 3820, y: 2150, width: 20, height: 10 }])
  d.add(3840, 2160, image, 4000, 3000)
  expect(d.take(3840, 2160)).toBeNull()
})
it('normalizes negative dirty sizes and clips to the source image', () => {
  const d = initialized(4); d.add(3840, 2160, image, 10, 20, 120, 100, -50, -40)
  expect(d.take(3840, 2160)).toEqual([{ x: 80, y: 80, width: 30, height: 20 }])
})
