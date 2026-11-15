export interface DamageRect { x: number; y: number; width: number; height: number }

/** Accumulates changed pixels until a snapshot takes ownership of them. */
export class DesktopDamage {
  private width = 0
  private height = 0
  private pending: DamageRect | null = null
  add(width: number, height: number, image: Pick<ImageData, 'width' | 'height'>, dx: number, dy: number, dirtyX = 0, dirtyY = 0, dirtyWidth = image.width, dirtyHeight = image.height) {
    if (this.width !== width || this.height !== height) {
      this.width = width; this.height = height
      this.pending = { x: 0, y: 0, width, height }
      return
    }
    // putImageData dirty coordinates are relative to the source image, while
    // dx/dy locate the source origin on the destination canvas.
    const sx = Math.min(dirtyX, dirtyX + dirtyWidth), sy = Math.min(dirtyY, dirtyY + dirtyHeight)
    const x = Math.max(0, dx + Math.max(0, sx)), y = Math.max(0, dy + Math.max(0, sy))
    const right = Math.min(width, dx + Math.min(image.width, sx + Math.abs(dirtyWidth)))
    const bottom = Math.min(height, dy + Math.min(image.height, sy + Math.abs(dirtyHeight)))
    if (right <= x || bottom <= y) return
    const previous = this.pending
    const left = previous ? Math.min(x, previous.x) : x, top = previous ? Math.min(y, previous.y) : y
    this.pending = { x: left, y: top, width: Math.max(right, previous ? previous.x + previous.width : right) - left,
      height: Math.max(bottom, previous ? previous.y + previous.height : bottom) - top }
  }
  take(width: number, height: number): DamageRect | null {
    // A resize clears the backing store; the receiver must receive a complete
    // new surface even when the first update only touches a small rectangle.
    if (this.width !== width || this.height !== height) {
      this.width = width; this.height = height; this.pending = { x: 0, y: 0, width, height }
    }
    const result = this.pending; this.pending = null
    return result
  }
}
