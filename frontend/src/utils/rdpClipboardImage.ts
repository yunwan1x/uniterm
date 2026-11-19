// Normalize images through the same canvas encoder in both directions. OS
// clipboards may re-encode PNGs; comparing their original bytes causes echoes.
export const MAX_CLIPBOARD_IMAGE_BYTES = 16 * 1024 * 1024
const MAX_PIXELS = 16 * 1024 * 1024

export function pasteImage(data: DataTransfer | null): File | null {
  for (const item of Array.from(data?.items ?? [])) {
    if (item.kind === 'file' && /^image\/(png|jpeg|webp|bmp)$/.test(item.type)) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}

export async function normalizeClipboardImage(blob: Blob): Promise<Uint8Array> {
  if (!blob.size || blob.size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('Clipboard image exceeds 16 MiB')
  const bitmap = await createImageBitmap(blob)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_PIXELS) {
      throw new Error('Clipboard image exceeds 16 megapixels')
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image clipboard requires a canvas context')
    context.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Cannot encode clipboard image')), 'image/png')
    })
    if (png.size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('Clipboard image exceeds 16 MiB')
    return new Uint8Array(await png.arrayBuffer())
  } finally { bitmap.close() }
}

export async function readClipboardImage(): Promise<Uint8Array | null> {
  if (!navigator.clipboard?.read) return null
  let items: ClipboardItem[]
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    items = await Promise.race([
      navigator.clipboard.read(),
      new Promise<ClipboardItem[]>(resolve => { timer = setTimeout(() => resolve([]), 1000) }),
    ])
  }
  catch { return null }
  finally { clearTimeout(timer) } // Native paste events remain available without permission.
  for (const item of items) {
    if (item.types.includes('image/png')) return normalizeClipboardImage(await item.getType('image/png'))
  }
  return null
}

export async function writeClipboardImage(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return null
  const png = await normalizeClipboardImage(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  return png
}
