import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import workletSource from './pcmPlayback.worklet.js?raw'

/** Execute the shipped processor, with the same 128-sample render quanta. */
function fixture(renderRate = 48000) {
  let Processor: any
  const runtime = {
    currentTime: 0, sampleRate: renderRate,
    Float32Array, Uint8Array, DataView,
    Date: { now: () => runtime.currentTime * 1000 },
    AudioWorkletProcessor: class { port = { postMessage() {} } },
    registerProcessor: (_name: string, klass: any) => { Processor = klass },
  }
  runInNewContext(workletSource, runtime)
  const processor = new Processor()
  function pcm(ms: number, rate = 48000) {
    const data = new Uint8Array(Math.round(ms * rate / 1000) * 2)
    const view = new DataView(data.buffer)
    for (let i = 0; i < data.length; i += 2) view.setInt16(i, 8192, true)
    processor.message({ type: 'pcm', data, rate, channels: 1, bits: 16 })
  }
  function render(ms: number, beforeQuantum?: (now: number) => void) {
    const until = runtime.currentTime + ms / 1000
    let audible = 0, firstAudible: number | null = null
    while (runtime.currentTime < until - 1e-9) {
      beforeQuantum?.(runtime.currentTime)
      const output = [new Float32Array(128), new Float32Array(128)]
      expect(processor.process([], [output])).toBe(true)
      for (let i = 0; i < output[0].length; i++) {
        if (output[0][i] !== 0) {
          firstAudible ??= runtime.currentTime + i / renderRate
          audible++
        }
      }
      runtime.currentTime += 128 / renderRate
    }
    return { audible, firstAudible }
  }
  return { processor, pcm, render, runtime }
}

describe('PCM AudioWorklet playout', () => {
  it.each([20, 100])('plays a lone %d ms sound without waiting for RDPSND Close', ms => {
    const f = fixture()
    f.pcm(ms)
    const played = f.render(600)
    expect(played.audible).toBe(ms * 48)
    expect(played.firstAudible).toBeGreaterThanOrEqual(.12 + ms / 1000)
    expect(played.firstAudible).toBeLessThan(.12 + ms / 1000 + .003)
    expect(f.processor.length).toBe(0)
  })

  it('does not postpone the deadline whenever another sparse packet arrives', () => {
    const f = fixture()
    f.pcm(20)
    expect(f.render(80).audible).toBe(0)
    f.pcm(20)
    const played = f.render(100)
    expect(played.firstAudible).toBeLessThan(.145)
    expect(played.audible).toBe(1920)
  })

  it.each([40, 160])('keeps continuous %d ms packets buffered without introducing gaps', duration => {
    const f = fixture()
    let next = 0
    const played = f.render(1800, now => {
      while (now + 1e-9 >= next) { f.pcm(duration); next += duration / 1000 }
    })
    expect(played.audible).toBeGreaterThan(48000)
    expect(f.processor.counters.underruns).toBe(0)
    expect(f.processor.counters.overflows).toBe(0)
    expect(f.processor.length / f.processor.rate).toBeLessThanOrEqual(.75)
  })

  it('absorbs a delayed packet burst without repeatedly restarting playout', () => {
    const f = fixture()
    const arrivals = [0, .04, .08, .20, .20, .20, .24, .28, .32, .36, .40, .44, .48, .52, .56, .60, .64, .68, .72, .76]
    let next = 0
    const played = f.render(800, now => {
      while (next < arrivals.length && now + 1e-9 >= arrivals[next]) { f.pcm(40); next++ }
    })
    expect(played.audible).toBeGreaterThan(24000)
    expect(f.processor.counters.underruns).toBe(0)
    expect(f.processor.counters.overflows).toBe(0)
  })

  it('drains an ended tail then prebuffers the next stream, even at an exact render boundary', () => {
    const f = fixture()
    f.pcm(32)
    f.processor.message({ type: 'end' })
    expect(f.render(32).audible).toBe(1536)
    expect(f.processor.playing).toBe(false)
    expect(f.processor.counters.underruns).toBe(0)
    f.pcm(20)
    expect(f.render(40).audible).toBe(0)
    expect(f.render(300).audible).toBe(960)
  })

  it('resets playback when Close arrives after an exact-boundary drain and before fresh PCM', () => {
    const f = fixture()
    f.pcm(32)
    f.render(152)
    expect(f.render(32).audible).toBe(1536)
    expect(f.processor.length).toBe(0)
    expect(f.processor.playing).toBe(true)
    f.processor.message({ type: 'end' })
    f.pcm(20)
    expect(f.render(40).audible).toBe(0)
    expect(f.render(300).audible).toBe(960)
  })

  it('bounds the wait for a small packet after real starvation as well as initial startup', () => {
    const f = fixture()
    let next = 0
    f.render(600, now => {
      while (now + 1e-9 >= next) { f.pcm(40); next += .04 }
    })
    f.render(1000)
    expect(f.processor.counters.underruns).toBe(1)
    f.pcm(20)
    expect(f.processor.target).toBe(.3)
    const recoveryStart = f.runtime.currentTime
    expect(f.render(200).audible).toBe(0)
    const played = f.render(300)
    expect(played.audible).toBe(960)
    expect(played.firstAudible! - recoveryStart).toBeGreaterThanOrEqual(.32 - 1e-9)
    expect(played.firstAudible! - recoveryStart).toBeLessThan(.323)
  })

  it.each(['enabled', 'active', 'reset'])('discards a pending short sound on %s and gives fresh audio a fresh deadline', command => {
    const f = fixture()
    f.pcm(100)
    f.render(80)
    f.processor.message({ type: command, value: false })
    expect(f.render(1000).audible).toBe(0)
    expect(f.processor.waitUntil).toBe(null)
    if (command !== 'reset') {
      f.pcm(20)
      expect(f.render(300).audible).toBe(0)
      expect(f.processor.length).toBe(0)
      f.processor.message({ type: command, value: true })
    }
    const restarted = f.runtime.currentTime
    f.pcm(20)
    const played = f.render(300)
    expect(played.audible).toBe(960)
    expect(played.firstAudible! - restarted).toBeGreaterThanOrEqual(.14 - 1e-9)
    expect(played.firstAudible! - restarted).toBeLessThan(.143)
  })

  it('replaces both old samples and their pending deadline when the sample rate changes', () => {
    const f = fixture()
    f.pcm(100)
    f.render(80)
    f.pcm(20, 8000)
    const changed = f.runtime.currentTime
    const played = f.render(400)
    // Linear resampling may round the last sample by one output frame.
    expect(Math.abs(played.audible - 960)).toBeLessThanOrEqual(1)
    expect(played.firstAudible! - changed).toBeGreaterThanOrEqual(.14 - 1e-9)
    expect(played.firstAudible! - changed).toBeLessThan(.143)
  })
})
