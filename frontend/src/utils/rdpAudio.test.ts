import { describe, it, expect, vi } from 'vitest'
import { decodeRdpPcm, RdpAudioPlayer } from './rdpAudio'
import { decodePcm, PcmAudioPlayer } from './pcmAudio'
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
describe('Shared PCM / RDP audio', () => {
  it('shares one implementation with the RDP adapter', () => {
    expect(RdpAudioPlayer).toBe(PcmAudioPlayer); expect(decodeRdpPcm).toBe(decodePcm)
  })
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
  const packet = (f: ReturnType<typeof fixture>, time: number, duration = .04) => {
    f.ctx.currentTime=time; f.player.pcm(new Uint8Array(Math.round(duration*48000)*4),48000,2,16)
  }
  it('keeps a continuous timeline despite 10ms late arrival', () => {
    const f=fixture();[1,1.04,1.09,1.12,1.16].forEach(t=>packet(f,t))
    const starts=f.sources.map(s=>s.start.mock.calls[0][0])
    starts.slice(1).forEach((t,i)=>expect(t-starts[i]).toBeCloseTo(.04,10))
    expect(f.player.getStats().underruns).toBe(0);expect(starts[0]).toBeCloseTo(1.12)
  })
  it('absorbs a delivery stall and burst without cutting sound', () => {
    const f=fixture();[1,1.04,1.08,1.20,1.20,1.20,1.24].forEach(t=>packet(f,t))
    expect(f.player.getStats().underruns).toBe(0);expect(f.player.getStats().overflows).toBe(0)
    expect(f.player.getStats().maxArrivalGapMs).toBeCloseTo(120)
    expect(f.sources.every(s=>s.stop.mock.calls.length===0)).toBe(true)
    f.sources.slice(1).forEach((s,i)=>expect(s.start.mock.calls[0][0]-f.sources[i].start.mock.calls[0][0]).toBeCloseTo(.04))
  })
  it('retains a 300ms burst instead of clearing at 250ms', () => {
    const f=fixture();for(let i=0;i<6;i++)packet(f,1,.05)
    expect(f.sources.every(s=>s.stop.mock.calls.length===0)).toBe(true)
    expect(f.player.getStats().overflows).toBe(0);expect(f.player.getStats().queuedMs).toBeCloseTo(420)
  })
  it('re-buffers after true starvation and increases reserve', () => {
    const f=fixture();packet(f,1);packet(f,1.3)
    const stats=f.player.getStats();expect(stats.underruns).toBe(1);expect(stats.missingMs).toBeCloseTo(140)
    expect(stats.targetMs).toBeGreaterThan(120);expect(stats.targetMs).toBeLessThanOrEqual(150)
    expect(f.sources[1].start.mock.calls[0][0]).toBeCloseTo(1.3+stats.targetMs/1000)
  })
  it('preserves the playing source while trimming an excessive backlog', () => {
    const f=fixture();packet(f,1,.05);for(let i=0;i<20;i++)packet(f,1.13,.05)
    expect(f.sources[0].stop).not.toHaveBeenCalled()
    const stats=f.player.getStats();expect(stats.overflows).toBeGreaterThan(0);expect(stats.droppedMs).toBeGreaterThan(0)
    expect(stats.queuedMs).toBeLessThanOrEqual(500)
    const active=f.sources.filter(s=>s.stop.mock.calls.length===0)
    active.slice(1).forEach((s,i)=>expect(s.start.mock.calls[0][0]).toBeCloseTo(active[i].start.mock.calls[0][0]+active[i].start.mock.calls[0][2]))
    f.player.dispose();expect(f.sources[0].stop).toHaveBeenCalled();expect(f.ctx.close).toHaveBeenCalled()
  })
  it('drains a closed stream and does not count normal silence as starvation', () => {
    const f=fixture();packet(f,1);f.player.end();expect(f.sources[0].stop).not.toHaveBeenCalled();packet(f,5)
    expect(f.player.getStats().underruns).toBe(0);expect(f.player.getStats().maxArrivalGapMs).toBe(0)
  })
  it('clears stale sound on suspension and never schedules after disposal', () => {
    const f=fixture();packet(f,1);f.ctx.state='suspended';f.ctx.onstatechange()
    expect(f.sources[0].stop).toHaveBeenCalled();expect(f.player.getStats().queuedMs).toBe(0)
    f.player.dispose();const count=f.sources.length;packet(f,5);expect(f.sources).toHaveLength(count)
  })
  it('bounds node count even for tiny packets', () => {
    const f=fixture();for(let i=0;i<1500;i++)f.player.pcm(new Uint8Array(4),48000,2,16)
    expect(f.player.getStats().sources).toBeLessThanOrEqual(512)
    expect(f.player.getStats().overflows).toBeGreaterThan(0)
  })

  it('counts the playing long packet against the total backlog limit', () => {
    const f=fixture();packet(f,1,.36)
    for(let i=0;i<8;i++)packet(f,1.125,.1)
    expect(f.sources[0].stop).not.toHaveBeenCalled()
    expect(f.player.getStats().queuedMs).toBeLessThanOrEqual(500.00001)
  })

})
