import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

async function decoderHarness() {
  const messages: any[] = [], decoders: any[] = []
  const scope: any = { postMessage: (message: any) => messages.push(message) }
  class Decoder {
    state = 'unconfigured'
    close = vi.fn(() => { if (this.state === 'closed') throw new Error('already closed'); this.state = 'closed' })
    decode = vi.fn()
    constructor(public callbacks: any) { decoders.push(this) }
    configure() { this.state = 'configured' }
    static async isConfigSupported() { return { supported: false } }
  }
  vi.stubGlobal('self', scope); vi.stubGlobal('VideoDecoder', Decoder)
  vi.stubGlobal('EncodedVideoChunk', class { constructor(options: any) { Object.assign(this, options) } })
  await import('./avc.worker')
  const control = new SharedArrayBuffer(16), pixels = new SharedArrayBuffer(64)
  const send = (data: any) => scope.onmessage({ data })
  await send({ method: 'init', control, pixels }); messages.length = 0
  const decode = (surface: number, timestamp: number, yuv = false) => send({ method: 'decode', surface, timestamp, yuv,
    data: new Uint8Array([0,0,0,1,0x67,0x42,0xe0,0x28,0,0,0,1,0x65,0x80]) })
  const frame = (timestamp: number, copyTo = async (destination: Uint8Array) => {
    destination.fill(timestamp)
    return [{ offset: 0, stride: 2 }, { offset: 4, stride: 1 }, { offset: 5, stride: 1 }]
  }) => ({ timestamp, visibleRect: { x: 0, y: 0, width: 2, height: 2 }, format: 'I420', allocationSize: () => 6, copyTo, close: vi.fn() })
  return { send, decode, frame, messages, decoders, pixels: new Uint8Array(pixels) }
}

it('releases each deleted surface so 32 successive IDs do not reach the 16-live-decoder limit', async () => {
  const h = await decoderHarness()
  for (let id = 1; id <= 32; id++) {
    await h.decode(id, id)
    await h.decoders.at(-1).callbacks.output(h.frame(id))
    await h.send({ method: 'release', surface: id })
  }
  expect(h.messages).toHaveLength(32)
  expect(h.messages.every(message => message.status === 1)).toBe(true)
  expect(h.decoders).toHaveLength(32)
  for (const decoder of h.decoders) expect(decoder.close).toHaveBeenCalledOnce()
})

it('keeps both AVC444 pictures on one decoder and releases only the selected stream before ID reuse', async () => {
  const h = await decoderHarness()
  for (const [id, timestamp, index] of [[7,1,0],[7,2,0],[8,3,1],[8,4,1]]) {
    await h.decode(id!, timestamp!, true)
    await h.decoders[index!].callbacks.output(h.frame(timestamp!))
  }
  expect(h.decoders).toHaveLength(2)
  await h.send({ method: 'release', surface: 7 })
  expect(h.decoders[0].close).toHaveBeenCalledOnce()
  expect(h.decoders[1].close).not.toHaveBeenCalled()
  await h.decode(8,5,true); await h.decoders[1].callbacks.output(h.frame(5))
  await h.decode(7,6,true); await h.decoders[2].callbacks.output(h.frame(6))
  expect(h.decoders).toHaveLength(3)
  expect(h.messages.map(message => message.status)).toEqual([1,1,1,1,1,1])
})

it('ignores output from a released decoder while the same ID has a newer active request', async () => {
  const h = await decoderHarness()
  await h.decode(4,1)
  const previous = h.decoders[0]
  await h.send({ method: 'release', surface: 4 })
  expect(h.messages).toEqual([{ method: 'decoded', timestamp: 1, status: -1 }])
  await h.decode(4,2)
  const stale = h.frame(1)
  await previous.callbacks.output(stale)
  previous.callbacks.error(new Error('late decoder error'))
  expect(stale.close).toHaveBeenCalledOnce()
  expect(h.messages).toHaveLength(1)
  await h.decoders[1].callbacks.output(h.frame(2))
  expect(h.messages.at(-1)).toEqual({ method: 'decoded', timestamp: 2, status: 1 })
})

it('does not publish an old asynchronous readback after release and surface reuse', async () => {
  const h = await decoderHarness()
  let finishReadback!: () => void
  await h.decode(3,1)
  const oldFrame = h.frame(1, async () => { await new Promise<void>(resolve => { finishReadback = resolve }); return [] })
  const output = h.decoders[0].callbacks.output(oldFrame)
  await h.send({ method: 'release', surface: 3 })
  await h.decode(3,2); await h.decoders[1].callbacks.output(h.frame(2))
  finishReadback(); await output
  expect(oldFrame.close).toHaveBeenCalledOnce()
  expect(h.messages.map(message => [message.timestamp,message.status])).toEqual([[1,-1],[2,1]])
  expect([...h.pixels.slice(0,16)]).toEqual(Array(16).fill(2))
})

it('reset tolerates an already-closed decoder and cancels pending work before accepting a reused ID', async () => {
  const h = await decoderHarness()
  await h.decode(1,1); await h.decoders[0].callbacks.output(h.frame(1))
  h.decoders[0].state = 'closed'
  await h.decode(2,2)
  await h.send({ method: 'reset' })
  expect(h.decoders[0].close).not.toHaveBeenCalled()
  expect(h.decoders[1].close).toHaveBeenCalledOnce()
  expect(h.messages.at(-1)).toEqual({ method: 'decoded', timestamp: 2, status: -1 })
  await h.decode(1,3); await h.decoders[2].callbacks.output(h.frame(3))
  expect(h.messages.at(-1)).toEqual({ method: 'decoded', timestamp: 3, status: 1 })
})

it('does not reuse the YUV destination of an abandoned asynchronous readback', async () => {
  const h = await decoderHarness()
  let oldDestination!: Uint8Array, newDestination!: Uint8Array, finishOld!: () => void, finishNew!: () => void
  await h.decode(6,1,true)
  const oldOutput = h.decoders[0].callbacks.output(h.frame(1, async destination => {
    oldDestination = destination
    await new Promise<void>(resolve => { finishOld = resolve })
    destination.fill(1)
    return [{ offset: 0, stride: 2 }, { offset: 4, stride: 1 }, { offset: 5, stride: 1 }]
  }))
  await h.send({ method: 'release', surface: 6 })
  await h.decode(6,2,true)
  const newOutput = h.decoders[1].callbacks.output(h.frame(2, async destination => {
    newDestination = destination; destination.fill(2)
    await new Promise<void>(resolve => { finishNew = resolve })
    return [{ offset: 0, stride: 2 }, { offset: 4, stride: 1 }, { offset: 5, stride: 1 }]
  }))
  expect(oldDestination).not.toBe(newDestination)
  finishOld(); await oldOutput
  finishNew(); await newOutput
  expect([...newDestination]).toEqual(Array(6).fill(2))
  expect([...h.pixels.slice(0,6)]).toEqual(Array(6).fill(2))
  expect(h.messages.map(message => [message.timestamp,message.status])).toEqual([[1,-1],[2,1]])
})
