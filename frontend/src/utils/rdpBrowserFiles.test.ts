import { describe, expect, it, vi } from 'vitest'
import { RdpBrowserFiles } from './rdpBrowserFiles'
import { RdpFileTransfer } from './rdpFileTransfer'

function fixture(remote: Uint8Array[] = []) {
  const save = vi.fn<(name: string, blob: Blob) => void>()
  const files = new RdpBrowserFiles(() => {}, save)
  const invoke = vi.fn(async (name: string, value: any) => {
    if (name !== 'request_file_contents') return
    const source = remote[value.file_index]
    const data = value.flags === 1 ? new Uint8Array(8) : source.slice(value.position, value.position + value.size)
    if (value.flags === 1) new DataView(data.buffer).setBigUint64(0, BigInt(source.length), true)
    queueMicrotask(() => engine.onResponse({ streamId: value.stream_id, data, isError: false }))
  })
  const engine = new RdpFileTransfer({ invoke, readBytes: (...args) => files.readBytes(...args), served: (...args) => files.served(...args),
    readChunk: async () => '', getFiles: async () => [], begin: async () => '', writeChunk: async () => {}, finish: async () => {}, abort: async () => {}, log: () => {} })
  const publish = vi.fn(async () => { engine.setLocalFiles(files.localFiles()) })
  files.attach(engine, publish)
  return { files, engine, invoke, publish, save }
}
const offer = (name: string, size = 0) => ({ name, size, lastModified: 0 })
const settle = () => vi.waitFor(() => expect(true).toBe(true))

describe('browser RDP files', () => {
  it('stages files without sending contents, and waits for remote paste', async () => {
    const { files, invoke, publish } = fixture()
    await files.select([new File(['abc'], '你好.txt', { lastModified: 42 })])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalled()
    expect(files.tasks[0].state).toBe('ready')
    expect(files.localFiles()[0]).toMatchObject({ name: '你好.txt', size: 3, lastModified: 42 })
  })

  it('serves binary ranges and counts repeated/out-of-order bytes only once', async () => {
    const { files, engine, invoke } = fixture()
    await files.select([new File([new Uint8Array([0, 255, 3, 4, 5, 6])], 'data.bin')])
    const read = (position: number, size: number) => engine.onRequest({ streamId: 1, index: 0, flags: 2, position, size })
    await read(4, 2); expect(files.tasks[0].done).toBe(2)
    await read(4, 2); expect(files.tasks[0].done).toBe(2)
    await read(0, 5); expect(files.tasks[0].done).toBe(6); expect(files.tasks[0].state).toBe('completed')
    expect(invoke).toHaveBeenLastCalledWith('submit_file_contents', expect.objectContaining({ data: new Uint8Array([0, 255, 3, 4, 5]), is_error: false }))
    await files.select([new File(['new'], 'new.txt')])
    expect(files.localFiles().map(f => f.name)).toEqual(['new.txt'])
  })

  it('cancels uploads, refuses further bytes, and explicitly re-arms on retry', async () => {
    const { files, engine, invoke } = fixture()
    await files.select([new File(['data'], 'a.txt')]); const id = files.tasks[0].id
    files.cancel(id)
    await engine.onRequest({ streamId: 1, index: 0, flags: 2, position: 0, size: 4 })
    expect(invoke).toHaveBeenLastCalledWith('submit_file_contents', expect.objectContaining({ is_error: true }))
    expect(files.tasks[0].state).toBe('cancelled')
    await files.retry(id); expect(files.tasks[0].state).toBe('ready')
    await engine.onRequest({ streamId: 2, index: 0, flags: 2, position: 0, size: 4 })
    expect(files.tasks[0].state).toBe('completed')
  })

  it('does not auto-download remote offers; selected indices retain their wire index', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 29).map((_, i) => i % 251)
    const { files, save, invoke } = fixture([new Uint8Array([1]), bytes])
    files.offerRemote([offer('skip.txt'), offer('二进制.bin')], 17)
    expect(invoke).not.toHaveBeenCalled()
    files.download([1])
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0]).toBe('二进制.bin')
    expect(new Uint8Array(await save.mock.calls[0][1].arrayBuffer())).toEqual(bytes)
    expect(invoke.mock.calls.every(([name, value]) => name === 'request_file_contents' && value.file_index === 1 && value.clip_data_id === 17)).toBe(true)
    expect(files.tasks[0]).toMatchObject({ state: 'completed', done: bytes.length })
  })

  it('cancels a pending download on remote clipboard change and prohibits stale retry', async () => {
    const { files, save, invoke } = fixture()
    invoke.mockImplementation(async () => {})
    files.offerRemote([offer('old.txt')]); files.download([0])
    files.offerRemote([offer('new.txt')])
    await settle()
    expect(files.tasks[0]).toMatchObject({ state: 'failed', error: 'changed', retryable: false })
    await files.retry(files.tasks[0].id)
    expect(save).not.toHaveBeenCalled()
  })

  it('stops interrupted tasks and never saves partial data after disconnect', async () => {
    const { files, engine, save, invoke } = fixture()
    invoke.mockImplementation(async () => {})
    files.offerRemote([offer('test.bin')]); files.download([0]); files.detach(); engine.dispose()
    await settle()
    expect(files.tasks[0]).toMatchObject({ state: 'failed', error: 'disconnected' }); expect(save).not.toHaveBeenCalled()
  })

  it('rejects asynchronous RPC errors immediately, without an unhandled rejection', async () => {
    const { files, invoke, save } = fixture()
    invoke.mockRejectedValue(new Error('worker closed'))
    files.offerRemote([offer('test.bin')]); files.download([0])
    await vi.waitFor(() => expect(files.tasks[0].state).toBe('failed'))
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects oversized downloads before requesting contents', async () => {
    const { files, engine, invoke, save } = fixture()
    invoke.mockImplementation(async (_name, req) => {
      const data = new Uint8Array(8); new DataView(data.buffer).setBigUint64(0, 300n * 1024n * 1024n, true)
      queueMicrotask(() => engine.onResponse({ streamId: req.stream_id, data, isError: false }))
    })
    files.offerRemote([offer('large.bin')]); files.download([0])
    await vi.waitFor(() => expect(files.tasks[0].error).toBe('tooLarge'))
    expect(invoke).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled()
  })

  it('handles empty files and refuses directory offers', async () => {
    const { files, save } = fixture([new Uint8Array()])
    files.offerRemote([offer('empty.txt'), { ...offer('folder'), isDirectory: true }]); files.download([0, 1])
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][1].size).toBe(0); expect(files.tasks).toHaveLength(1)
  })

  it('rejects duplicate/path-like upload names before advertising anything', async () => {
    const { files, publish } = fixture()
    await expect(files.select([new File(['x'], '../bad')])).rejects.toThrow('invalidFiles')
    await expect(files.select([new File(['x'], 'A'), new File(['x'], 'a')])).rejects.toThrow('invalidFiles')
    expect(publish).not.toHaveBeenCalled()
  })
})
