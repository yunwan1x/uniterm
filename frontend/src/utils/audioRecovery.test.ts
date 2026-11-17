import { afterEach, describe, expect, it, vi } from 'vitest'
import { PcmAudioPlayer } from './pcmAudio'
import { AudioTransport } from '../rdp/audio-transport'
class Port {
  onmessage: any = null
  postMessage = vi.fn()
  start = vi.fn()
  close = vi.fn()
}
function fixture() {
  const nodes: any[] = [], channels: any[] = []
  vi.stubGlobal('MessageChannel', class { port1 = new Port(); port2 = new Port(); constructor() { channels.push(this) } })
  vi.stubGlobal('AudioWorkletNode', class {
    port = new Port(); onprocessorerror: any = null; connect = vi.fn(); disconnect = vi.fn()
    constructor() { nodes.push(this) }
  })
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const ctx: any = { state: 'running', currentTime: 0, destination: {}, audioWorklet: { addModule: vi.fn(async () => {}) },
    createChannelSplitter: node, createChannelMerger: node, createGain: () => ({ ...node(), gain: { value: 1, setValueAtTime: vi.fn() } }), close: vi.fn(async () => {}) }
  const blocked = vi.fn(), player = new PcmAudioPlayer(blocked, () => ctx)
  return { nodes, channels, ctx, blocked, player }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('audio processor recovery', () => {
  it('rebuilds only the failed node and replaces direct PCM port, retaining volume', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.player.createInputPort()
    const control = f.channels[0].port1, old = f.nodes[0]
    control.onmessage({ data: { type: 'volume', left: .25, right: .5 } })
    old.onprocessorerror(); expect(old.disconnect).toHaveBeenCalledOnce(); expect(old.port.close).toHaveBeenCalledOnce()
    expect(control.postMessage).toHaveBeenLastCalledWith({ type: 'detach' })
    await vi.advanceTimersByTimeAsync(250)
    expect(f.nodes).toHaveLength(2)
    expect(f.nodes[1].port.postMessage).toHaveBeenCalledWith({ type: 'volume', left: .25, right: .5 })
    expect(control.postMessage.mock.calls.filter((c:any[])=>c[0].type==='attach')).toHaveLength(2)
    expect(f.player.getStats()).toMatchObject({ processorFailures: 1, recoveryAttempts: 1, recovering: false })
    expect(f.blocked).toHaveBeenLastCalledWith(false); f.player.dispose()
  })
  it('bounds automatic retries and allows explicit sound off/on recovery', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.player.createInputPort()
    for (let i=0;i<4;i++) { f.nodes.at(-1).onprocessorerror(); await vi.advanceTimersByTimeAsync(1000) }
    expect(f.nodes).toHaveLength(4); expect(f.player.getStats()).toMatchObject({ recoveryAttempts: 3, recovering: true })
    await vi.advanceTimersByTimeAsync(60000); expect(f.nodes).toHaveLength(4)
    f.player.setEnabled(false); f.player.setEnabled(true); await vi.advanceTimersByTimeAsync(250)
    expect(f.nodes).toHaveLength(5); f.player.dispose()
  })
  it('does not recover after disabling or disposal, including an in-flight module load', async () => {
    vi.useFakeTimers(); const f=fixture(); await f.player.createInputPort(); f.nodes[0].onprocessorerror()
    f.player.setEnabled(false); await vi.advanceTimersByTimeAsync(2000); expect(f.nodes).toHaveLength(1)
    f.player.setEnabled(true)
    let finish!: ()=>void; f.ctx.audioWorklet.addModule.mockImplementation(()=>new Promise<void>(r=>{finish=r}))
    await vi.advanceTimersByTimeAsync(250); f.player.dispose(); finish(); await Promise.resolve(); await Promise.resolve()
    expect(f.nodes).toHaveLength(1); expect(f.channels[0].port1.close).toHaveBeenCalledOnce()
  })
  it('also recovers the callback PCM path without an input port', async () => {
    vi.useFakeTimers(); const f=fixture(); f.player.unlock(); await Promise.resolve(); await Promise.resolve()
    f.nodes[0].onprocessorerror(); await vi.advanceTimersByTimeAsync(250)
    f.player.pcm(new Uint8Array(320),8000,1,16)
    expect(f.nodes[1].port.postMessage.mock.calls.some((c:any[])=>c[0].type==='pcm')).toBe(true); f.player.dispose()
  })
})
describe('worker PCM endpoint replacement', () => {
  it('drops during failure, resets outstanding credits and ignores obsolete acknowledgements', () => {
    const control=new Port(), first=new Port(), second=new Port(); const transport=new AudioTransport(control as any)
    expect(transport.canSend(1)).toBe(false)
    control.onmessage({data:{type:'attach',port:first}})
    transport.send({type:'pcm',data:new Uint8Array(256*1024)})
    expect(transport.canSend(1)).toBe(false); const oldAck=first.onmessage
    control.onmessage({data:{type:'detach'}}); expect(first.close).toHaveBeenCalledOnce()
    expect(transport.canSend(1)).toBe(false)
    control.onmessage({data:{type:'attach',port:second}})
    expect(transport.canSend(256*1024)).toBe(true)
    transport.send({type:'pcm',data:new Uint8Array(256*1024)})
    oldAck({data:{type:'consumed',bytes:256*1024}}); expect(transport.canSend(1)).toBe(false)
    second.onmessage({data:{type:'consumed',bytes:256*1024}}); expect(transport.canSend(1)).toBe(true)
    expect(second.postMessage).toHaveBeenCalledOnce()
  })
})
