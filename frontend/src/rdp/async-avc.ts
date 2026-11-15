/** One command (one or two reference pictures) may be prepared at a time. */
export class PreparedAvc {
  private pictures: { surface: number; yuv: boolean; value: any[] }[] = []
  private preparing = false
  private generation = 0
  async prepare(requests: [number, Uint8Array, boolean][], decode: (surface: number, data: Uint8Array, yuv: boolean) => Promise<any[]>) {
    if (this.preparing || this.pictures.length) throw new Error('Unconsumed AVC command')
    if (requests.length < 1 || requests.length > 2) throw new Error('Invalid AVC command size')
    this.preparing = true
    const generation = this.generation
    try {
      for (const [index, [surface, data, yuv]] of requests.entries()) {
        const value = await decode(surface, data, yuv)
        if (generation !== this.generation) throw new Error('AVC preparation cancelled')
        // Only the first AVC444 picture needs a copy. The final picture stays
        // valid until the engine consumes this command and prepares the next.
        this.pictures.push({ surface, yuv, value: value.map(v => v instanceof Uint8Array && index + 1 < requests.length ? v.slice() : v) })
      }
    } catch (error) { this.pictures = []; throw error }
    finally { this.preparing = false }
  }
  take(surface: number, yuv: boolean) {
    const picture = this.pictures.shift()
    if (this.preparing || !picture || picture.surface !== surface || picture.yuv !== yuv) throw new Error('AVC preparation order mismatch')
    return picture.value
  }
  clear() { this.generation++; this.pictures = [] }
}
