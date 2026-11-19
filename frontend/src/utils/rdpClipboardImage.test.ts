import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_CLIPBOARD_IMAGE_BYTES, normalizeClipboardImage, pasteImage, readClipboardImage } from './rdpClipboardImage'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('RDP image clipboard boundaries', () => {
  it('extracts an image from a mixed native paste without treating arbitrary files as images', () => {
    const image = new File(['png'], 'screenshot.png', { type: 'image/png' })
    const transfer = { items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'application/pdf', getAsFile: () => new File([], 'a.pdf') },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ] } as unknown as DataTransfer
    expect(pasteImage(transfer)).toBe(image)
    expect(pasteImage(null)).toBeNull()
  })

  it('rejects oversized clipboard payloads before decoding', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(normalizeClipboardImage(new Blob([new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1)]))).rejects.toThrow('16 MiB')
    expect(decode).not.toHaveBeenCalled()
  })

  it('closes decoded resources when dimensions exceed the pixel limit', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 8192, height: 8192, close }))
    await expect(normalizeClipboardImage(new Blob(['image']))).rejects.toThrow('16 megapixels')
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not block the paste queue on denied or unanswered clipboard permission', async () => {
    vi.stubGlobal('navigator', { clipboard: { read: vi.fn().mockRejectedValue(new Error('denied')) } })
    expect(await readClipboardImage()).toBeNull()
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { clipboard: { read: () => new Promise(() => {}) } })
    const read = readClipboardImage()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await read).toBeNull()
  })
})
