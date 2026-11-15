import type { PresentationTrace } from './presentation-trace'

/** Isolated diagnostic build only. IDs here are Rust loop or WebSocket delivery
 * sequences, never display batch IDs, AVC picture IDs or protocol frame IDs. */
export class FlowTrace {
  readonly enabled: boolean
  readonly callback: ((stage: number, id: number, a: number, b: number, c: number) => void) | undefined

  constructor(private readonly trace: PresentationTrace, enabled = false) {
    this.enabled = enabled && trace.enabled
    if (!this.enabled) return
    this.callback = (stage, id, a, b, c) => {
      if (!Number.isSafeInteger(id) || id < 0 || !Number.isFinite(stage) || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return
      switch (stage) {
        case 1: trace.record('rdp-loop-state', id, { pendingCount: a, pendingBytes: b, flags: c }); break
        case 2: trace.record('prepare-call-start', id); break
        case 3: trace.record('prepare-call-end', id, { ok: a, hasFuture: b }); break
        case 4: trace.record('rdp-network-selected', id, { bytes: a }); break
        case 5: trace.record('network-process-start', id, { pendingCount: a, pendingBytes: b }); break
        case 6: trace.record('network-process-end', id, { ok: a, pendingCount: b, pendingBytes: c }); break
        case 7: trace.record('graphics-process-start', id, { pendingCount: a, pendingBytes: b }); break
        case 8: trace.record('graphics-process-end', id, { ok: a, pendingCount: b, pendingBytes: c }); break
        // Success means queued for the writer. It is not a parsed RDP wire ACK
        // and does not establish WebSocket delivery or server receipt.
        case 9: trace.record(c === 1 ? 'response-enqueued' : 'response-enqueue-failed', id, { bytes: a, writerPending: b }); break
        case 10: trace.record('prepare-completed', id, { ok: a }); break
        case 11: trace.record('rdp-damage-enqueued', id); break
        case 12: trace.record('canvas-render-start', id, { width: a, height: b }); break
        case 13: trace.record('canvas-render-end', id, { ok: a }); break
      }
    }
  }

  install(target: Record<string, unknown>): () => void {
    if (!this.callback) return () => {}
    const callback = this.callback
    target.unitermRdpFlowTrace = callback
    return () => { if (target.unitermRdpFlowTrace === callback) delete target.unitermRdpFlowTrace }
  }

  messageDelivered(id: number, socketId: number, bytes: number) {
    if (this.enabled) this.trace.record('ws-message-delivered', id, { socketId, bytes })
  }
}
