import { expect, it } from 'vitest'
import { DesktopDamage } from './damage'
const image = { width: 100, height: 80 }
function initialized() { const d = new DesktopDamage(); d.add(3840, 2160, image, 0, 0); d.take(3840, 2160); return d }
it('sends a full initial surface and a full surface after resize', () => {
  const d = new DesktopDamage(); d.add(3840, 2160, image, 900, 600)
  expect(d.take(3840, 2160)).toEqual({ x: 0, y: 0, width: 3840, height: 2160 })
  d.add(1920, 1080, image, 900, 600)
  expect(d.take(1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
})
it('unions updates arriving while a previous snapshot is in flight', () => {
  const d = initialized(); d.add(3840, 2160, image, 20, 30)
  expect(d.take(3840, 2160)).toEqual({ x: 20, y: 30, width: 100, height: 80 })
  d.add(3840, 2160, image, 10, 20); d.add(3840, 2160, image, 200, 300)
  expect(d.take(3840, 2160)).toEqual({ x: 10, y: 20, width: 290, height: 360 })
  expect(d.take(3840, 2160)).toBeNull()
})
it('maps source dirty rectangles to destination coordinates and clips both bounds', () => {
  const d = initialized(); d.add(3840, 2160, image, -10, -20, 5, 10, 30, 40)
  expect(d.take(3840, 2160)).toEqual({ x: 0, y: 0, width: 25, height: 30 })
  d.add(3840, 2160, image, 3820, 2150)
  expect(d.take(3840, 2160)).toEqual({ x: 3820, y: 2150, width: 20, height: 10 })
  d.add(3840, 2160, image, 4000, 3000)
  expect(d.take(3840, 2160)).toBeNull()
})
it('normalizes negative dirty sizes and clips to the source image', () => {
  const d = initialized(); d.add(3840, 2160, image, 10, 20, 120, 100, -50, -40)
  expect(d.take(3840, 2160)).toEqual({ x: 80, y: 80, width: 30, height: 20 })
})
