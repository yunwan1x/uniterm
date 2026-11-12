import type { ClipboardFile } from './rdpClipboard'

export type FileRequest = { streamId: number; index: number; flags: number; position: number; size: number; dataId?: number }
export type FileResponse = { streamId: number; isError: boolean; data: Uint8Array }
export type RemoteFile = ClipboardFile & { isDirectory?: boolean }
type FileBridge = {
  invoke(name: string, value: unknown): unknown
  readBytes?(id: string, offset: number, size: number): Promise<Uint8Array>
  served?(file: ClipboardFile, offset: number, size: number): void
  readChunk(id: string, offset: number, size: number): Promise<string>
  getFiles(): Promise<ClipboardFile[]>
  begin(files: ClipboardFile[]): Promise<string>
  writeChunk(id: string, index: number, offset: number, data: string): Promise<unknown>
  finish(id: string): Promise<unknown>
  abort(id: string): Promise<unknown>
  log(message: string): void
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}

function encodeBase64(value: Uint8Array): string {
  let text = ''
  for (let i = 0; i < value.length; i += 8192) text += String.fromCharCode(...value.subarray(i, i + 8192))
  return btoa(text)
}

export class RdpFileTransfer {
  private localFiles: ClipboardFile[] = []
  private lockedFiles = new Map<number, ClipboardFile[]>()
  private disposed = false
  private generation = 0
  private nextStreamId = 1
  private pending = new Map<number, { resolve(data: Uint8Array): void; reject(error: Error): void }>()

  constructor(private readonly bridge: FileBridge) {}

  setLocalFiles(files: ClipboardFile[]) {
    this.localFiles = files
  }

  lock(id: number) { this.lockedFiles.set(id, this.localFiles.slice()) }
  unlock(id: number) { this.lockedFiles.delete(id) }

  async onRequest(request: FileRequest): Promise<void> {
    let data: Uint8Array = new Uint8Array()
    let isError = false
    try {
      const files = request.dataId === undefined ? this.localFiles : this.lockedFiles.get(request.dataId) ?? this.localFiles
      const file = files[request.index]
      if (!file || !Number.isSafeInteger(request.index) || request.index < 0) throw new Error('Invalid clipboard file index')
      if (request.flags === 1) {
        data = new Uint8Array(8)
        new DataView(data.buffer).setBigUint64(0, BigInt(file.size), true)
      } else if (request.flags === 2 && Number.isSafeInteger(request.position) && request.position >= 0 &&
        Number.isInteger(request.size) && request.size >= 0 && request.size <= 8 * 1024 * 1024) {
        if (!file.id) throw new Error('Missing clipboard file token')
        data = this.bridge.readBytes ? await this.bridge.readBytes(file.id, request.position, request.size) : decodeBase64(await this.bridge.readChunk(file.id, request.position, request.size))
      } else throw new Error('Invalid clipboard file range')
    } catch (error) {
      isError = true
      this.bridge.log(`clipboard file read failed: ${String(error)}`)
    }
    if (this.disposed) return
    try {
      await this.bridge.invoke('submit_file_contents', { stream_id: request.streamId, is_error: isError, data })
      const files = request.dataId === undefined ? this.localFiles : this.lockedFiles.get(request.dataId) ?? this.localFiles
      const file = files[request.index]
      if (!isError && file && (request.flags === 2 || file.size === 0)) this.bridge.served?.(file, request.position, request.flags === 2 ? data.length : 0)
    } catch (error) {
      this.bridge.log(`clipboard file response failed: ${String(error)}`)
    }
  }

  onResponse(response: FileResponse) {
    const request = this.pending.get(response.streamId)
    if (!request) return
    if (response.isError) request.reject(new Error('Remote clipboard file read failed'))
    else request.resolve(response.data)
  }

  private request(index: number, flags: number, position: number, size: number, clipDataId?: number): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new Error('RDP session closed'))
    const streamId = this.nextStreamId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('Clipboard file request timed out')), 15000)
      const cleanup = () => { clearTimeout(timer); this.pending.delete(streamId) }
      const fail = (error: Error) => { cleanup(); reject(error) }
      this.pending.set(streamId, { resolve: data => { cleanup(); resolve(data) }, reject: fail })
      try {
        Promise.resolve(this.bridge.invoke('request_file_contents', {
          stream_id: streamId, file_index: index, flags, position, size, clip_data_id: clipDataId ?? null,
        })).catch(error => fail(error instanceof Error ? error : new Error(String(error))))
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  async download(files: RemoteFile[], clipDataId?: number): Promise<ClipboardFile[]> {
    const generation = this.generation
    const checkActive = () => {
      if (this.disposed || generation !== this.generation) throw new Error('Clipboard download cancelled')
    }
    checkActive()
    if (!files.length || files.some(file => file.isDirectory)) throw new Error('Clipboard directory copy is not supported')
    const metadata: ClipboardFile[] = []
    // Ask for sizes instead of trusting optional FileGroupDescriptorW fields.
    for (let index = 0; index < files.length; index++) {
      const data = await this.request(index, 1, 0, 8, clipDataId)
      checkActive()
      if (data.byteLength !== 8) throw new Error('Invalid clipboard file size response')
      const size = Number(new DataView(data.buffer, data.byteOffset, 8).getBigUint64(0, true))
      if (!Number.isSafeInteger(size)) throw new Error('Clipboard file exceeds supported size')
      metadata.push({ name: files[index].name, size, lastModified: files[index].lastModified })
    }
    const id = await this.bridge.begin(metadata)
    let finished = false
    try {
      checkActive()
      for (let index = 0; index < metadata.length; index++) {
        const file = metadata[index]
        let position = 0
        while (position < file.size) {
          const size = Math.min(1024 * 1024, file.size - position)
          const data = await this.request(index, 2, position, size, clipDataId)
          checkActive()
          if (!data.length || data.length > size) throw new Error('Invalid clipboard file chunk response')
          await this.bridge.writeChunk(id, index, position, encodeBase64(data))
          checkActive()
          position += data.length
        }
      }
      checkActive()
      await this.bridge.finish(id)
      finished = true
      // Use the filesystem's timestamp precision for subsequent echo checks.
      return await this.bridge.getFiles()
    } finally {
      if (!finished) await this.bridge.abort(id)
    }
  }

  /** Browser path: no server filesystem or Windows clipboard dependency. */
  async downloadBlob(index: number, file: RemoteFile, clipDataId: number | undefined,
    progress: (done: number, total: number) => void, maxBytes = 256 * 1024 * 1024): Promise<Blob> {
    const generation = this.generation
    const check = () => { if (this.disposed || generation !== this.generation) throw new Error('Clipboard download cancelled') }
    check()
    if (file.isDirectory || !Number.isInteger(index) || index < 0) throw new Error('Invalid remote file')
    const sizeBytes = await this.request(index, 1, 0, 8, clipDataId)
    check()
    if (sizeBytes.length !== 8) throw new Error('Invalid clipboard file size response')
    const size = Number(new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 8).getBigUint64(0, true))
    if (!Number.isSafeInteger(size) || size > maxBytes) throw new Error('BROWSER_FILE_TOO_LARGE')
    const chunks: ArrayBuffer[] = []
    let offset = 0
    progress(0, size)
    while (offset < size) {
      const requested = Math.min(1024 * 1024, size - offset)
      const data = await this.request(index, 2, offset, requested, clipDataId)
      check()
      if (!data.length || data.length > requested) throw new Error('Invalid clipboard file chunk response')
      chunks.push(new Uint8Array(data).buffer)
      offset += data.length
      progress(offset, size)
    }
    check()
    return new Blob(chunks, { type: 'application/octet-stream' })
  }

  cancelDownload() {
    ++this.generation
    for (const request of this.pending.values()) request.reject(new Error('Clipboard download cancelled'))
    this.pending.clear()
  }

  dispose() {
    this.disposed = true
    this.lockedFiles.clear()
    this.cancelDownload()
  }
}
