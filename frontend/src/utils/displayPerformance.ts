export interface DisplayCounters {
  at: number
  frames: number | null
  bytes: number | null
}

// Diagnostic snapshots belong to a single rendering surface and expire with it.
export const displayCounters = new WeakMap<HTMLCanvasElement, DisplayCounters>()

export function displayRates(previous: DisplayCounters | undefined, current: DisplayCounters) {
  function rate(field: 'frames' | 'bytes') {
    const before = previous?.[field], after = current[field]
    if (!previous || before == null || after == null || after < before || current.at <= previous.at) return null
    return (after - before) * 1000 / (current.at - previous.at)
  }
  const frames = rate('frames'), bytes = rate('bytes')
  return {
    fps: frames === null ? '—' : String(Math.round(frames)),
    bitrate: bytes === null ? '—' : bytes < 125000 ? Math.round(bytes * 8 / 1000) + ' kbps' : (bytes * 8 / 1e6).toFixed(1) + ' Mbps',
  }
}
