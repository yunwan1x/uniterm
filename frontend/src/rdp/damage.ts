export interface DamageRect { x: number; y: number; width: number; height: number }

const area = (r: DamageRect) => r.width * r.height
const intersectionArea = (a: DamageRect, b: DamageRect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
const union = (a: DamageRect, b: DamageRect): DamageRect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** Bounded changed regions owned by the next display batch. */
export class DesktopDamage {
  private width = 0
  private height = 0
  private pending: DamageRect[] = []
  private epoch = 0
  constructor(private readonly maxRegions = 1) {
    if (!Number.isInteger(maxRegions) || maxRegions < 1 || maxRegions > 4) throw new Error('Invalid damage region limit')
  }
  get generation() { return this.epoch }
  /** Also invalidates snapshots when a same-size framebuffer is reset. */
  full(width: number, height: number) {
    this.width = width; this.height = height; this.epoch++
    this.pending = width > 0 && height > 0 ? [{ x: 0, y: 0, width, height }] : []
  }
  add(width: number, height: number, image: Pick<ImageData, 'width' | 'height'>, dx: number, dy: number, dirtyX = 0, dirtyY = 0, dirtyWidth = image.width, dirtyHeight = image.height) {
    if (this.width !== width || this.height !== height) { this.full(width, height); return }
    // Dirty source coordinates and the destination both require clipping.
    const sx = Math.min(dirtyX, dirtyX + dirtyWidth), sy = Math.min(dirtyY, dirtyY + dirtyHeight)
    const x = Math.max(0, dx + Math.max(0, sx)), y = Math.max(0, dy + Math.max(0, sy))
    const right = Math.min(width, dx + Math.min(image.width, sx + Math.abs(dirtyWidth)))
    const bottom = Math.min(height, dy + Math.min(image.height, sy + Math.abs(dirtyHeight)))
    if (right <= x || bottom <= y) return
    let next = { x, y, width: right - x, height: bottom - y }
    for (let i = 0; i < this.pending.length;) {
      const previous = this.pending[i]!, merged = union(previous, next)
      if (this.maxRegions === 1 || area(merged) <= 1.25 * (area(previous) + area(next) - intersectionArea(previous, next))) {
        next = merged; this.pending.splice(i, 1); i = 0
      } else i++
    }
    this.pending.push(next)
    if (this.pending.length > this.maxRegions) this.pending = [this.pending.reduce(union)]
  }
  take(width: number, height: number): DamageRect[] | null {
    if (this.width !== width || this.height !== height) this.full(width, height)
    if (!this.pending.length) return null
    const result = this.pending; this.pending = []
    return result
  }
}
