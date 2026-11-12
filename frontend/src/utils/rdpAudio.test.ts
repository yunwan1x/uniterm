import { describe, it, expect, vi } from 'vitest'
import { decodeRdpPcm, RdpAudioPlayer } from './rdpAudio'
function fixture(state = 'running') {
  const sources: any[] = [], gains: any[] = []
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const ctx: any = { state, currentTime: 1, destination: {}, close: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    createChannelSplitter: node, createChannelMerger: node,
    createGain: () => { const n = { ...node(), gain: { value: 1, setValueAtTime: vi.fn() } }; gains.push(n); return n },
    createBuffer: (_: number, frames: number, rate: number) => ({ duration: frames / rate, copyToChannel: vi.fn() }),
    createBufferSource: () => { const n = { ...node(), start: vi.fn(), stop: vi.fn(), onended: null }; sources.push(n); return n },
  }
  const blocked = vi.fn(), player = new RdpAudioPlayer(blocked, () => ctx)
  return { ctx, sources, gains, blocked, player }
}
describe('RDP audio', () => {
  it('decodes signed little endian stereo and respects byte offsets', () => {
    const data = new Uint8Array([99, 0, 128, 255, 127, 99]).subarray(1, 5)
    const [l, r] = decodeRdpPcm(data, 2, 16)
    expect([...l]).toEqual([-1]); expect(r[0]).toBeCloseTo(32767 / 32768)
  })
  it('duplicates unsigned mono into both channels', () => {
    const planes = decodeRdpPcm(new Uint8Array([0,128,255]), 1, 8)
    expect([...planes[0]]).toEqual([-1,0,127/128]); expect(planes[0]).toEqual(planes[1])
  })
  it('rejects malformed frames and formats', () => {
    expect(() => decodeRdpPcm(new Uint8Array(3),2,16)).toThrow()
    expect(() => decodeRdpPcm(new Uint8Array(4),2,24)).toThrow()
  })
  it('drops blocked audio instead of replaying stale data after unlock', async () => {
    const f = fixture('suspended'); f.player.pcm(new Uint8Array(320),8000,1,16)
    expect(f.blocked).toHaveBeenCalledWith(true); expect(f.sources).toHaveLength(0)
    f.player.unlock(); expect(f.ctx.resume).toHaveBeenCalled()
    f.ctx.state = 'running'; f.player.pcm(new Uint8Array(320),8000,1,16); expect(f.sources).toHaveLength(1)
  })
  it('applies remote channel volume and mute to scheduled audio', () => {
    const f=fixture(); f.player.setVolume(.5,0); f.player.unlock()
    expect(f.gains.map(g=>g.gain.value)).toEqual([.5,0])
    f.player.setVolume(0,1); expect(f.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0,1)
  })
  it('bounds latency and stops queued audio on disconnect', () => {
    const f=fixture(); for(let i=0;i<30;i++) f.player.pcm(new Uint8Array(320),8000,1,16)
    expect(f.sources[0].stop).toHaveBeenCalled()
    f.player.dispose(); expect(f.sources[f.sources.length - 1].stop).toHaveBeenCalled(); expect(f.ctx.close).toHaveBeenCalled()
    f.player.pcm(new Uint8Array(320),8000,1,16); expect(f.sources).toHaveLength(30)
  })
})
