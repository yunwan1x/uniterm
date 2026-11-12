import { afterEach, describe, expect, it, vi } from 'vitest'
import { installVncImageEncoding } from './vncImageEncoding'
const native = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64')
afterEach(() => {
  if (native) Object.defineProperty(Uint8Array.prototype, 'toBase64', native)
  else delete (Uint8Array.prototype as any).toBase64
  vi.unstubAllGlobals()
})
function fixture() {
  vi.stubGlobal('Image', class { src = '' })
  Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true,
    value(this: Uint8Array) { return Buffer.from(this).toString('base64') } })
  const queue: any[] = [], original = vi.fn()
  const display = { imageRect: original, _renderQPush: (v: any) => queue.push(v) }
  const rfb = Object.assign(new EventTarget(), { _display: display })
  const rect = (data: any = new Uint8Array([1, 2, 3]), w = 10, h = 20) =>
    (display.imageRect as any)(4, 5, w, h, 'image/jpeg', data)
  return { rfb, display, queue, original, rect }
}
describe('native VNC image preparation', () => {
  it('encodes only view bytes and preserves decode queue order', () => {
    const f = fixture(), stop = installVncImageEncoding(f.rfb)
    f.rect(new Uint8Array([99, 1, 2, 3, 88]).subarray(1, 4)); f.rect(new Uint8Array([4]))
    expect(f.queue.map(v => v.img.src)).toEqual(['data: image/jpeg;base64,AQID', 'data: image/jpeg;base64,BA=='])
    expect(f.queue[0]).toMatchObject({ type: 'img', x: 4, y: 5, width: 10, height: 20 })
    expect(f.original).not.toHaveBeenCalled(); stop()
  })
  it('ignores empty rectangles and delegates plain arrays', () => {
    const f = fixture(), stop = installVncImageEncoding(f.rfb)
    f.rect(undefined, 0); f.rect(undefined, 1, 0); expect(f.queue).toHaveLength(0)
    f.rect([1, 2]); expect(f.original).toHaveBeenCalledWith(4, 5, 10, 20, 'image/jpeg', [1, 2]); stop()
  })
  it('leaves older browsers unchanged', () => {
    const f = fixture(); delete (Uint8Array.prototype as any).toBase64
    installVncImageEncoding(f.rfb)(); expect(f.display.imageRect).toBe(f.original)
  })
  it('restores on disconnect without cancelling queued images', () => {
    const f = fixture(), stop = installVncImageEncoding(f.rfb); f.rect()
    f.rfb.dispatchEvent(new Event('disconnect')); stop()
    expect(f.display.imageRect).toBe(f.original); expect(f.queue[0].img.src).toContain('AQID')
  })
  it('supports reinstall and stale disposal for cached tabs', () => {
    const f = fixture(), first = installVncImageEncoding(f.rfb), second = installVncImageEncoding(f.rfb)
    first(); f.rect(); expect(f.queue).toHaveLength(1); second(); expect(f.display.imageRect).toBe(f.original)
  })
  it('isolates sessions and preserves later adapters', () => {
    const a = fixture(), b = fixture(), stopA = installVncImageEncoding(a.rfb), stopB = installVncImageEncoding(b.rfb)
    stopA(); a.rect(); b.rect(); expect(a.original).toHaveBeenCalled(); expect(b.queue).toHaveLength(1)
    const later = vi.fn(); b.display.imageRect = later; stopB(); expect(b.display.imageRect).toBe(later)
  })
})
