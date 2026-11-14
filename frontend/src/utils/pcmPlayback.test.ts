import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
function fixture(outputRate = 48000) {
  let Processor: any
  const env: any = { sampleRate: outputRate, currentTime: 0, Float32Array, Uint8Array, DataView,
    AudioWorkletProcessor: class { port = { onmessage: null, postMessage() {} } },
    registerProcessor: (_name: string, value: any) => { Processor = value } }
  runInNewContext(readFileSync(new URL('./pcmPlayback.worklet.js', import.meta.url), 'utf8'), env)
  const p = new Processor()
  const render = (n = 128) => {
    const left = new Float32Array(n), right = new Float32Array(n)
    p.process([], [[left, right]])
    env.currentTime += n / outputRate
    return [left, right]
  }
  const pcm = (frames: number, rate = 48000, channels = 2, bits = 16) => {
    const a = new Uint8Array(frames * channels * bits / 8), v = new DataView(a.buffer)
    for (let i = 0; i < frames * channels; i++) bits === 16 ? v.setInt16(i * 2, 8192, true) : v.setUint8(i, 160)
    p.message({type:'pcm',data:a,rate,channels,bits})
  }
  return { p, render, pcm }
}
describe('audio rendering thread PCM queue', () => {
  it('keeps a continuous 48k stereo signal when the UI does no work for 2 seconds', () => {
    const f = fixture(); f.pcm(5760)
    for (let i = 0; i < 750; i++) {
      if (i % 15 === 0) f.pcm(1920)
      const planes = f.render()
      expect(planes[0].every(v => v === .25)).toBe(true)
      expect(planes[1].every(v => v === .25)).toBe(true)
    }
    expect(f.p.counters.underruns).toBe(0)
  })
  it('resamples 44.1k input without changing signal level or drifting the queue', () => {
    const f = fixture(); f.pcm(5292,44100)
    for (let i = 0; i < 750; i++) {
      if (i % 15 === 0) f.pcm(1764,44100)
      expect(f.render()[0].every(v => v === .25)).toBe(true)
    }
    expect(f.p.length).toBeGreaterThan(5000); expect(f.p.length).toBeLessThan(5500)
    expect(f.p.counters.underruns).toBe(0)
  })
  it('keeps large Windows packets continuous despite quantized arrival timing', () => {
    const f = fixture();let next = 0, packets = 0, sounding = 0
    for (let frame = 0; frame < 144000; frame += 128) {
      if (frame >= next) { f.pcm(8192,44100);packets++;next=Math.ceil(packets*8192/44100*48000/2048)*2048 }
      if (f.render()[0][0] > .1) sounding++
    }
    expect(sounding).toBeGreaterThan(800);expect(f.p.counters.underruns).toBe(0)
  })
  it('handles mono unsigned PCM, per-channel mute, and short end-of-stream tails', () => {
    const f = fixture(); f.pcm(100,8000,1,8); f.p.message({type:'end'}); f.p.message({type:'volume',left:0,right:.5})
    const [l,r] = f.render();expect(l.every(v=>v===0)).toBe(true);expect(r.every(v=>v===.125)).toBe(true)
  })
  it('reports real starvation, increases recovery reserve and bounds stale backlog', () => {
    const f = fixture();f.pcm(5760);f.pcm(5760);for(let i=0;i<200;i++)f.render()
    expect(f.p.counters.underruns).toBe(1);expect(f.p.counters.missingMs).toBeGreaterThan(100)
    f.pcm(960);expect(f.p.target).toBeGreaterThan(.2);expect(f.p.target).toBeLessThanOrEqual(.3)
    for(let i=0;i<100;i++)f.pcm(960)
    expect(f.p.length).toBeLessThanOrEqual(36000);expect(f.p.counters.overflows).toBeGreaterThan(0)
  })
  it('preserves the full latency budget instead of discarding the recovery reserve on overflow', () => {
    const f = fixture(); f.pcm(24000); f.pcm(14400)
    expect(f.p.length).toBe(36000)
    expect(f.p.counters.droppedMs).toBe(50)
    f.pcm(1920)
    expect(f.p.length).toBe(36000)
    expect(f.p.counters.droppedMs).toBe(90)
  })
  it('counts silence while waiting for the recovery reserve after packets return', () => {
    const f = fixture(); f.pcm(5760); f.pcm(5760)
    for (let i = 0; i < 100; i++) f.render()
    expect(f.p.counters.underruns).toBe(1)
    f.pcm(960)
    const before = f.p.counters.missingMs
    for (let i = 0; i < 10; i++) f.render()
    expect(f.p.counters.missingMs - before).toBeCloseTo(1280 / 48, 6)
    expect(f.p.counters.underruns).toBe(1)
    f.pcm(9600); f.pcm(9600); f.pcm(9600); f.render()
    expect(f.p.starving).toBe(false)
  })
  it('drops muted packets, clears stale audio, and resumes with fresh PCM only', () => {
    const f=fixture();f.pcm(5760);f.p.message({type:'enabled',value:false});f.pcm(5760)
    expect(f.p.length).toBe(0);expect(f.render()[0].every(v=>v===0)).toBe(true)
    f.p.message({type:'enabled',value:true});f.pcm(5760);f.pcm(5760);expect(f.render()[0].every(v=>v===.25)).toBe(true)
    f.p.message({type:'reset'});expect(f.p.length).toBe(0)
  })
  it('rejects malformed input without poisoning the playback thread', () => {
    const f=fixture();f.p.message({type:'pcm',data:new Uint8Array(5),rate:48000,channels:2,bits:16})
    f.p.message({type:'pcm',data:new Uint8Array(4),rate:999999,channels:2,bits:16})
    expect(f.p.counters.packets).toBe(0);f.pcm(5760);f.pcm(5760);expect(f.render()[0][0]).toBe(.25)
  })
})
