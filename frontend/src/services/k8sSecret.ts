export interface SecretEntry { key: string; original: string; text: string; binary: boolean }
export function decodeSecret(data: Record<string, string> = {}): SecretEntry[] {
  return Object.entries(data).map(([key, original]) => {
    try {
      const bytes = Uint8Array.from(atob(original), c => c.charCodeAt(0))
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw Error('binary')
      return {key, original, text, binary: false}
    } catch { return {key, original, text: '', binary: true} }
  })
}
export function encodeSecret(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw)
}
export function secretPatch(target: any, entries: SecretEntry[]) {
  if (target.immutable) throw Error('Secret is immutable')
  if (!target.metadata?.resourceVersion) throw Error('Secret resourceVersion is missing; reload the resource')
  const data: Record<string, string> = Object.create(null)
  for (const entry of entries) {
    if (!entry.binary) {
      const encoded = encodeSecret(entry.text)
      if (encoded !== entry.original) data[entry.key] = encoded
    }
  }
  return { metadata: { resourceVersion: target.metadata.resourceVersion }, data }
}
