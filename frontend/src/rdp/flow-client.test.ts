import { afterEach, expect, it, vi } from 'vitest'
import { SessionBuilder } from './client'

vi.mock('./renderer', () => ({ DesktopRenderer: class { mode = 'canvas2d'; stats = {}; dispose() {} } }))
afterEach(() => vi.unstubAllGlobals())

it('resets drain serial when a new Worker session replaces the old session on the same page', async () => {
  const workers: any[] = []
  vi.stubGlobal('Worker', class {
    onmessage: any
    constructor() { workers.push(this) }
    postMessage(message: any) { if (message.method === 'connect') queueMicrotask(() => this.onmessage({ data: { id: message.id, result: null } })) }
    terminate() {}
  })
  const host: any = { sessionStorage: { getItem: (key: string) => key === 'uniterm.rdp.presentationTrace' ? '1' : null } }
  const canvas: any = { ownerDocument: { defaultView: host, hidden: false }, dataset: {} }
  const drain = (worker: any, drainId: number) => worker.onmessage({ data: { type: 'presentationTrace', drainId, events: [], dropped: 0 } })
  const old = await new SessionBuilder().renderCanvas(canvas).connect()
  for (let id = 1; id <= 7; id++) drain(workers[0], id)
  expect(host.__unitermRdpTraceWorkerDrainSerial).toBe(7)
  expect(host.__unitermRdpTraceDrainGaps).toBe(0)
  old.free()
  const current = await new SessionBuilder().renderCanvas(canvas).connect()
  expect(host.__unitermRdpTraceWorkerDrainSerial).toBe(0)
  drain(workers[1], 1)
  expect(host.__unitermRdpTraceDrainCount).toBe(1)
  expect(host.__unitermRdpTraceDrainGaps).toBe(0)
  drain(workers[1], 3)
  expect(host.__unitermRdpTraceDrainGaps).toBe(1)
  current.free()
})

it.each([[false, false], [false, true], [true, false], [true, true]])('passes the gated flow switch (trace=%s, flow=%s)', async (trace, flow) => {
  let connection: any
  vi.stubGlobal('Worker', class {
    onmessage: any
    postMessage(message: any) { if (message.method === 'connect') { connection = message.value; queueMicrotask(() => this.onmessage({ data: { id: message.id, result: null } })) } }
    terminate() {}
  })
  const values: Record<string, string> = { 'uniterm.rdp.presentationTrace': trace ? '1' : '0', 'uniterm.rdp.flowTrace': flow ? '1' : '0' }
  const host: any = { sessionStorage: { getItem: (key: string) => values[key] } }
  const canvas: any = { ownerDocument: { defaultView: host, hidden: false }, dataset: {} }
  const session = await new SessionBuilder().renderCanvas(canvas).connect()
  expect(connection.extensions.flow_trace).toBe(trace && flow)
  expect(connection.extensions.presentation_trace).toBe(trace)
  expect(Boolean(host.__unitermRdpTrace)).toBe(trace)
  session.free()
})


it.each([[false, 65536], [true, 262144]])('bounds main trace and distinguishes overflow sources (flow=%s)', async (flow, capacity) => {
  let worker: any
  vi.stubGlobal('Worker', class {
    onmessage: any
    constructor() { worker = this }
    postMessage(message: any) { if (message.method === 'connect') queueMicrotask(() => this.onmessage({ data: { id: message.id, result: null } })) }
    terminate() {}
  })
  const host: any = { sessionStorage: { getItem: (key: string) => key === 'uniterm.rdp.presentationTrace' || (flow && key === 'uniterm.rdp.flowTrace') ? '1' : null } }
  const canvas: any = { ownerDocument: { defaultView: host, hidden: false }, dataset: {} }
  const session = await new SessionBuilder().renderCanvas(canvas).connect()
  const events = Array.from({ length: capacity + 2 }, (_, id) => ({ stage: 'probe', id, time: id }))
  worker.onmessage({ data: { type: 'presentationTrace', drainId: 1, events, dropped: 7 } })
  expect(host.__unitermRdpTrace).toHaveLength(capacity)
  expect(host.__unitermRdpTraceMainDropped).toBe(2)
  expect(host.__unitermRdpTraceWorkerDropped).toBe(7)
  expect(host.__unitermRdpTraceDropped).toBe(9)
  expect(host.__unitermRdpTraceWorkerPeakBatch).toBe(capacity + 2)
  expect(host.__unitermRdpTraceWorkerDrainedEvents).toBe(capacity + 2)
  session.free()
  const second = await new SessionBuilder().renderCanvas(canvas).connect()
  expect(host.__unitermRdpTraceMainDropped).toBe(0)
  expect(host.__unitermRdpTraceWorkerDropped).toBe(0)
  expect(host.__unitermRdpTraceWorkerPeakBatch).toBe(0)
  second.free()
})
