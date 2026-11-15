export interface TraceDrainCounters {
  __unitermRdpTraceDrainCount?: number
  __unitermRdpTraceWorkerDrainSerial?: number
  __unitermRdpTraceDrainGaps?: number
}

export function resetTraceDrains(host: TraceDrainCounters) {
  host.__unitermRdpTraceDrainCount = 0
  host.__unitermRdpTraceWorkerDrainSerial = 0
  host.__unitermRdpTraceDrainGaps = 0
}

export function acceptTraceDrain(host: TraceDrainCounters, id: number) {
  host.__unitermRdpTraceDrainCount = (host.__unitermRdpTraceDrainCount ?? 0) + 1
  const previous = host.__unitermRdpTraceWorkerDrainSerial ?? 0
  if (!Number.isSafeInteger(id) || id < 1 || id !== previous + 1) {
    host.__unitermRdpTraceDrainGaps = (host.__unitermRdpTraceDrainGaps ?? 0) + 1
  }
  if (Number.isSafeInteger(id) && id >= 1) host.__unitermRdpTraceWorkerDrainSerial = id
}
