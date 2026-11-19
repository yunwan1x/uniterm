export type ClipboardFile = { id?: string; name: string; size: number; lastModified: number }
export type RdpClipboardContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; png: Uint8Array }
  | { kind: 'files'; files: ClipboardFile[] }

type ClipboardBridge = {
  read(): Promise<RdpClipboardContent | null>
  publish(content: RdpClipboardContent): Promise<void>
  writeText(text: string): Promise<boolean>
  writeImage?(png: Uint8Array): Promise<Uint8Array | null>
}

function sameContent(a: RdpClipboardContent | undefined, b: RdpClipboardContent): boolean {
  if (a?.kind !== b.kind) return false
  if (a.kind === 'image' && b.kind === 'image') {
    return a.png.length === b.png.length && a.png.every((byte, i) => byte === b.png[i])
  }
  if (a.kind === 'text' && b.kind === 'text') {
    // Windows converts LF to CRLF when serving CF_UNICODETEXT.
    return a.text.replace(/\r\n/g, '\n') === b.text.replace(/\r\n/g, '\n')
  }
  return a.kind === 'files' && b.kind === 'files' && JSON.stringify(a.files) === JSON.stringify(b.files)
}

/** One clipboard owner per session. Remote writes must never be echoed back. */
export class RdpClipboardSync {
  private ready = false
  private disposed = false
  private revision = 0
  private lastContent: RdpClipboardContent | undefined
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly bridge: ClipboardBridge, initiallyReady = false) {
    this.ready = initiallyReady
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const result = this.tail.then(action)
    // A failed read/write/advertise must not poison later retries.
    this.tail = result.catch(() => {})
    return result
  }

  requestFormatList(): Promise<void> {
    // MonitorReady is the protocol's initialization trigger. Do not send
    // capabilities/format lists from polling before it arrives.
    this.ready = true
    return this.sync(true)
  }

  invalidateLocal(): void {
    ++this.revision
    this.lastContent = undefined
  }

  sync(force = false, supplied?: string | RdpClipboardContent): Promise<void> {
    const revision = this.revision
    return this.enqueue(async () => {
      if (!this.ready || this.disposed || (!force && revision !== this.revision)) return
      let content: RdpClipboardContent | null = supplied === undefined
        ? await this.bridge.read()
        : typeof supplied === 'string' ? { kind: 'text', text: supplied } : supplied
      if (this.disposed) return
      if (revision !== this.revision) {
        if (!force) return
        content = { kind: 'text', text: '' }
      }
      // Even an empty initial clipboard must complete the handshake.
      if (!content && force) content = { kind: 'text', text: '' }
      if (!content) return
      if (!force && sameContent(this.lastContent, content)) return
      // initiate_file_copy requires Ready. Only a text/empty format list
      // drives the client's initial Capabilities + TempDir + FormatList.
      if (force && content.kind === 'files') await this.bridge.publish({ kind: 'text', text: '' })
      if (this.disposed) return
      await this.bridge.publish(content)
      if (!this.disposed && revision === this.revision) this.lastContent = content
    })
  }

  receiveText(text: string): Promise<void> {
    ++this.revision // Invalidate any local read already in flight.
    return this.enqueue(async () => {
      if (this.disposed) return
      if (!await this.bridge.writeText(text)) throw new Error('System clipboard write failed')
      if (!this.disposed) this.lastContent = { kind: 'text', text }
    })
  }

  receiveImage(png: Uint8Array): Promise<void> {
    const revision = ++this.revision
    return this.enqueue(async () => {
      if (this.disposed || revision !== this.revision) return
      const written = await this.bridge.writeImage?.(png)
      if (!written) throw new Error('System image clipboard write failed')
      if (!this.disposed && revision === this.revision) this.lastContent = { kind: 'image', png: written }
    })
  }

  receiveFiles(download: () => Promise<ClipboardFile[]>): Promise<void> {
    const revision = ++this.revision
    return this.enqueue(async () => {
      if (this.disposed || revision !== this.revision) return
      const files = await download()
      if (!this.disposed && revision === this.revision) this.lastContent = { kind: 'files', files }
    })
  }

  dispose() {
    this.lastContent = undefined
    this.disposed = true
    ++this.revision
  }
}

/** Keep all key transitions ordered while clipboard I/O delays a paste. */
export class RdpInputQueue {
  private tasks: Array<() => void | Promise<void>> = []
  private busy = false
  private generation = 0

  constructor(private readonly onError: (error: unknown) => void) {}

  enqueue(action: () => void | Promise<void>) {
    this.tasks.push(action)
    this.drain()
  }

  clear() {
    ++this.generation
    this.tasks = []
    this.busy = false
  }

  private drain() {
    if (this.busy) return
    while (this.tasks.length) {
      const action = this.tasks.shift()!
      try {
        const result = action()
        if (result) {
          this.busy = true
          const generation = this.generation
          Promise.resolve(result).catch(this.onError).then(() => {
            if (generation !== this.generation) return
            this.busy = false
            this.drain()
          })
          return
        }
      } catch (error) {
        this.onError(error)
      }
    }
  }
}
