import { expect, it } from 'vitest'
import { PreparedAvc } from './async-avc'
it('keeps both AVC444 pictures when the shared decoder output is reused', async () => {
  const prepared = new PreparedAvc(), shared = new Uint8Array(4)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const work = prepared.prepare([[3,new Uint8Array([10]),true],[3,new Uint8Array([20]),true]], async (_surface,data) => {
    await gate; shared.fill(data[0]!); return [2,2,shared]
  })
  // The caller can service audio while decoder output is outstanding.
  let serviced = false; await Promise.resolve().then(() => { serviced = true })
  expect(serviced).toBe(true)
  release(); await work
  expect(prepared.take(3,true)[2]).toEqual(new Uint8Array(4).fill(10))
  expect(prepared.take(3,true)[2]).toEqual(new Uint8Array(4).fill(20))
  expect(() => prepared.take(3,true)).toThrow()
})
it('rejects overlap and discards incomplete results after a decoder failure', async () => {
  const prepared = new PreparedAvc()
  await expect(prepared.prepare([[1,new Uint8Array(),true],[1,new Uint8Array(),true]], async () => { throw new Error('codec failed') })).rejects.toThrow('codec failed')
  expect(() => prepared.take(1,true)).toThrow()
  await prepared.prepare([[2,new Uint8Array(),false]],async () => [1,1,new Uint8Array(4)])
  await expect(prepared.prepare([[2,new Uint8Array(),false]],async () => [])).rejects.toThrow('Unconsumed')
  expect(() => prepared.take(1,false)).toThrow('order')
})

it('cancels a pending generation without exposing its late decoder picture', async () => {
  const prepared = new PreparedAvc()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const pending = prepared.prepare([[1,new Uint8Array(),true]],async () => { await gate; return [1,1,new Uint8Array([10])] })
  prepared.clear(); release()
  await expect(pending).rejects.toThrow('cancelled')
  expect(() => prepared.take(1,true)).toThrow()
  await prepared.prepare([[2,new Uint8Array(),true]],async () => [1,1,new Uint8Array([20])])
  expect(prepared.take(2,true)[2]).toEqual(new Uint8Array([20]))
})
