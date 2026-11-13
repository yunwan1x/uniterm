export type QualityPreset = 'auto' | 'balanced' | 'fidelity' | 'custom'
export const qualityBitrates = [2, 4, 8, 12, 20, 30, 40]
export const qualityPresets: QualityPreset[] = ['auto', 'balanced', 'fidelity', 'custom']
export function presetQuality(preset: QualityPreset, custom: { size: string; fps: number; bitrate: number }) {
  if (preset === 'fidelity') return { size: '0', fps: 60, bitrate: 40 }
  if (preset === 'balanced') return { size: '1920', fps: 30, bitrate: 8 }
  if (preset === 'auto') return { size: 'auto', fps: 30, bitrate: 8 }
  return custom
}
export function storedQuality(saved: any) {
  if (!saved || !['auto','0','1280','1920','2560'].includes(saved.size) || ![15,30,60].includes(saved.fps) || !qualityBitrates.includes(saved.bitrate)) return null
  // Old manually selected parameters must not silently become adaptive.
  return { ...saved, preset: qualityPresets.includes(saved.preset) ? saved.preset as QualityPreset : 'custom' as QualityPreset }
}

/** Conservative AIMD-like ladder. No throughput inference from static screens. */
export class AdaptiveBitrate {
  private healthy = 0
  private congested = 0
  private lastChange = -Infinity
  constructor(public bitrate: number) {}
  sample(s: { now: number; delay: number; rttGrowth: number; pending: number; decodeMs: number; active: boolean }): number | null {
    if (!s.active) { this.healthy = 0; this.congested = 0; return null }
    const poor = s.delay > 250 || s.rttGrowth > 200 || s.pending > 1024*1024 || s.decodeMs > 80
    this.congested = poor ? this.congested + 1 : 0
    this.healthy = !poor && s.delay < 100 && s.rttGrowth < 100 && s.pending < 256*1024 && s.decodeMs < 35 ? this.healthy + 1 : 0
    if (s.now - this.lastChange < 6000) return null
    const rates = qualityBitrates.map(v => v * 1000000)
    let next: number | undefined
    if (this.congested >= 2) next = [...rates].reverse().find(v => v <= this.bitrate * .65) ?? rates[0]
    else if (this.healthy >= 10) next = rates.find(v => v > this.bitrate)
    if (next == null || next === this.bitrate) return null
    this.healthy = this.congested = 0
    this.lastChange = s.now
    // The caller commits bitrate only after device acknowledgement.
    return next
  }
}
