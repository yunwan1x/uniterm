import { RdpFileTransfer, type RemoteFile } from './rdpFileTransfer'
import type { ClipboardFile } from './rdpClipboard'

export type FileTaskState = 'preparing' | 'ready' | 'queued' | 'transferring' | 'completed' | 'cancelled' | 'failed'
export type FileTask = {
  id: string; name: string; size: number; done: number; direction: 'upload' | 'download'; state: FileTaskState
  error?: string; offer?: number; index?: number; retryable: boolean
}
export type RemoteOffer = RemoteFile & { index: number }
const terminal = new Set<FileTaskState>(['completed', 'cancelled', 'failed'])
const validName = (name: string) => !!name && !/[\\/\x00-\x1f]/.test(name) && !['.', '..'].includes(name)

/** Session-local browser files. Closing the panel does not dispose this controller. */
export class RdpBrowserFiles {
  tasks: FileTask[] = []
  remote: RemoteOffer[] = []
  armed = false
  remoteActive = false
  private uploadSnapshot: string[] = []
  private files = new Map<string, File>()
  private ranges = new Map<string, Array<[number, number]>>()
  private engine: RdpFileTransfer | null = null
  private publish: (() => Promise<void>) | null = null
  private offer = 0
  private clipDataId: number | undefined
  private queue: FileTask[] = []
  private active: FileTask | null = null
  private running = false
  constructor(private changed: () => void, private save: (name: string, data: Blob) => void) {}

  attach(engine: RdpFileTransfer, publish: () => Promise<void>) { this.engine = engine; this.publish = publish; this.changed() }
  private prune() {
    while (this.tasks.length >= 100) {
      const index = this.tasks.findIndex(t => terminal.has(t.state))
      if (index < 0) throw new Error('tooMany')
      const [task] = this.tasks.splice(index, 1); this.files.delete(task.id); this.ranges.delete(task.id)
    }
  }
  async select(files: File[]) {
    if (!this.engine || !this.publish) throw new Error('disconnected')
    if (!files.length || files.length > 100 || files.some(f => !validName(f.name)) || new Set(files.map(f => f.name.toLowerCase())).size !== files.length) throw new Error('invalidFiles')
    if (this.tasks.some(t => t.direction === 'upload' && ['preparing', 'ready', 'transferring'].includes(t.state))) throw new Error('uploadBusy')
    if (this.tasks.filter(t => !terminal.has(t.state)).length + files.length > 100) throw new Error('tooMany')
    this.clearRemote('changed')
    // A new upload replaces the previous local clipboard snapshot, never a locked read in progress.
    this.armed = true
    const added: FileTask[] = []
    for (const file of files) {
      this.prune()
      const task: FileTask = { id: crypto.randomUUID(), name: file.name, size: file.size, done: 0, direction: 'upload', state: 'preparing', retryable: true }
      this.files.set(task.id, file); this.tasks.push(task); added.push(task)
    }
    this.uploadSnapshot = added.map(t => t.id)
    this.changed()
    try {
      await this.publish()
      for (const t of added) if (t.state === 'preparing') t.state = 'ready'
    } catch {
      for (const t of added) if (!terminal.has(t.state)) { t.state = 'failed'; t.error = 'failed' }
      this.armed = false
    }
    this.changed()
  }
  localFiles(): ClipboardFile[] {
    if (!this.armed) return []
    return this.tasks.filter(t => this.uploadSnapshot.includes(t.id) && t.direction === 'upload' && ['preparing', 'ready', 'transferring', 'completed'].includes(t.state) && this.files.has(t.id))
      .map(t => ({ id: t.id, name: t.name, size: t.size, lastModified: this.files.get(t.id)!.lastModified }))
  }
  async readBytes(id: string, offset: number, size: number) {
    const task = this.tasks.find(t => t.id === id), file = this.files.get(id)
    if (!task || !file || ['cancelled', 'failed'].includes(task.state) || !this.engine) throw new Error('Upload cancelled')
    if (offset > file.size) throw new Error('Invalid range')
    const data = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer())
    if (['cancelled', 'failed'].includes(task.state) || !this.engine) throw new Error('Upload cancelled')
    return data
  }
  served(file: ClipboardFile, start: number, size: number) {
    const task = this.tasks.find(t => t.id === file.id)
    if (!task || ['cancelled', 'failed'].includes(task.state)) return
    const ranges = [...(this.ranges.get(task.id) ?? []), [start, Math.min(task.size, start + size)] as [number, number]].sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = []
    for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r) }
    this.ranges.set(task.id, merged)
    task.done = merged.reduce((n, r) => n + r[1] - r[0], 0)
    task.state = task.done >= task.size ? 'completed' : 'transferring'
    this.changed()
  }
  offerRemote(files: RemoteFile[], clipDataId?: number) {
    this.clearRemote('changed'); this.releaseUploads('changed')
    this.remoteActive = true; this.clipDataId = clipDataId
    this.remote = files.slice(0, 1000).map((file, index) => ({ ...file, index, isDirectory: file.isDirectory || !validName(file.name) }))
    this.changed()
  }
  private releaseUploads(error: string) {
    this.armed = false
    for (const t of this.tasks) if (t.direction === 'upload' && !terminal.has(t.state)) { t.state = 'failed'; t.error = error }
  }
  clearRemote(error = 'changed') {
    this.offer++; this.remoteActive = false; this.remote = []; this.clipDataId = undefined
    for (const t of this.tasks) if (t.direction === 'download') {
      t.retryable = false
      if (!terminal.has(t.state)) { t.state = 'failed'; t.error = error }
    }
    this.queue = []; this.engine?.cancelDownload(); this.changed()
  }
  remoteText() { this.releaseUploads('changed'); this.clearRemote('changed') }
  download(indices: number[]) {
    if (!this.engine) return
    for (const index of new Set(indices)) {
      const file = this.remote.find(f => f.index === index)
      if (!file || file.isDirectory || this.tasks.some(t => t.direction === 'download' && t.offer === this.offer && t.index === index && !terminal.has(t.state))) continue
      this.prune()
      const task: FileTask = { id: crypto.randomUUID(), direction: 'download', name: file.name, size: file.size, done: 0, state: 'queued', offer: this.offer, index, retryable: true }
      this.tasks.push(task); this.queue.push(task)
    }
    this.changed(); void this.drain()
  }
  private async drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length && this.engine) {
        const task = this.queue.shift()!
        if (task.state !== 'queued' || task.offer !== this.offer) continue
        const file = this.remote.find(f => f.index === task.index)
        if (!file) continue
        this.active = task; task.state = 'transferring'; this.changed()
        try {
          const blob = await this.engine.downloadBlob(task.index!, file, this.clipDataId, (done, total) => {
            task.done = done; task.size = total; this.changed()
          })
          if (task.offer !== this.offer || task.state !== 'transferring' || !this.engine) continue
          this.save(task.name, blob); task.state = 'completed'
        } catch (e) {
          if (task.state === 'transferring') { task.state = 'failed'; task.error = e instanceof Error && e.message === 'BROWSER_FILE_TOO_LARGE' ? 'tooLarge' : 'failed' }
        } finally { if (this.active === task) this.active = null; this.changed() }
      }
    } finally { this.running = false }
  }
  cancel(id: string) {
    const task = this.tasks.find(t => t.id === id)
    if (!task || terminal.has(task.state)) return
    task.state = 'cancelled'; task.error = undefined
    if (this.active === task) this.engine?.cancelDownload()
    this.changed()
  }
  async retry(id: string) {
    const task = this.tasks.find(t => t.id === id)
    if (!task || !task.retryable || !this.engine || !['failed', 'cancelled'].includes(task.state)) return
    task.done = 0; task.error = undefined
    if (task.direction === 'upload') {
      if (this.tasks.some(t => t.direction === 'upload' && t !== task && ['preparing', 'ready', 'transferring'].includes(t.state))) throw new Error('uploadBusy')
      this.clearRemote(); this.armed = true; this.uploadSnapshot = [task.id]; this.ranges.delete(task.id); task.state = 'preparing'; this.changed()
      try { await this.publish?.(); if (task.state === 'preparing') task.state = 'ready' }
      catch { task.state = 'failed'; task.error = 'failed' }
    } else if (task.offer === this.offer) { task.state = 'queued'; this.queue.push(task); void this.drain() }
    this.changed()
  }
  clearFinished() {
    const keep = this.tasks.filter(t => !terminal.has(t.state))
    for (const t of this.tasks) if (!keep.includes(t)) { this.files.delete(t.id); this.ranges.delete(t.id) }
    this.tasks = keep; this.changed()
  }
  detach() {
    this.releaseUploads('disconnected'); this.clearRemote('disconnected')
    this.engine = null; this.publish = null; this.changed()
  }
}

export function saveRdpBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name.replace(/[\\/\x00-\x1f]/g, '_'); anchor.hidden = true
  document.body.append(anchor)
  try { anchor.click() } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
}
