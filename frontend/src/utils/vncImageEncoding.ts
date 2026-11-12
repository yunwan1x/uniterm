interface ImageDisplay {
  imageRect(x: number, y: number, width: number, height: number, mime: string, data: Uint8Array): void
  _renderQPush(action: { type: 'img'; img: HTMLImageElement; x: number; y: number; width: number; height: number }): void
}

interface ImageTarget extends EventTarget {
  _display?: ImageDisplay
}

const installed = new WeakMap<ImageDisplay, () => void>()

/** noVNC 1.7: accelerate image preparation without changing its decode queue,
 * frame boundaries, CopyRect dependencies, or negotiated image quality. */
export function installVncImageEncoding(rfb: ImageTarget): () => void {
  const display = rfb._display
  const encode = (Uint8Array.prototype as Uint8Array & { toBase64?: () => string }).toBase64
  if (!display || typeof display.imageRect !== 'function' ||
      typeof display._renderQPush !== 'function' || typeof encode !== 'function') return () => {}
  installed.get(display)?.()
  const original = display.imageRect
  const imageRect: ImageDisplay['imageRect'] = function (this: ImageDisplay, x, y, width, height, mime, data) {
    if (width === 0 || height === 0) return
    // Older decoders can provide plain arrays. Preserve the upstream path.
    if (!(data instanceof Uint8Array)) return original.call(this, x, y, width, height, mime, data)
    const img = new Image()
    img.src = `data: ${mime};base64,${encode.call(data)}`
    this._renderQPush({ type: 'img', img, x, y, width, height })
  }
  display.imageRect = imageRect
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (display.imageRect === imageRect) display.imageRect = original
    if (installed.get(display) === dispose) installed.delete(display)
    rfb.removeEventListener('disconnect', dispose)
    // Queued Images remain owned by noVNC and finish normally, including when
    // a tab is cached. There are no Blob URLs or extra frame buffers to retain.
  }
  installed.set(display, dispose)
  rfb.addEventListener('disconnect', dispose)
  return dispose
}
