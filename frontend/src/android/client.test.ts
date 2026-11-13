import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@yume-chan/scrcpy-decoder-tinyh264',()=>({TinyH264Decoder:class {sizeChanged=()=>{};writable={getWriter:()=>({write:async()=>{}})};dispose(){} }}))
vi.mock('@yume-chan/scrcpy-decoder-webcodecs',()=>({WebCodecsVideoDecoder:class {static isSupported=false},BitmapVideoFrameRenderer:class{}}))
vi.mock('@yume-chan/scrcpy',()=>({ScrcpyVideoCodecId:{H264:1}}))
import {AndroidClient,androidClients} from './client'
class Socket {static OPEN=1;readyState=1;binaryType='';onclose=()=>{};onmessage=(_e:any)=>{};onerror=()=>{};send=vi.fn();close=vi.fn()}
const created:AndroidClient[]=[]
function make(){vi.stubGlobal('document',{createElement:()=>({dataset:{}})});vi.stubGlobal('WebSocket',Socket);const c=new AndroidClient('ws://localhost/test');created.push(c);return c}
afterEach(()=>{created.splice(0).forEach(c=>c.dispose());androidClients.clear();vi.useRealTimers();vi.unstubAllGlobals()})
describe('Android browser lifecycle',()=>{
 it('uses software decoding without WebCodecs and exposes disconnect instead of spinning forever',()=>{const c=make();expect(c.mode).toBe('H.264 software');(c.ws as any).onmessage({data:JSON.stringify({width:720,height:1280})});expect(c.connected).toBe(true);androidClients.set(c.url,c);(c.ws as any).onclose();expect(c.connected).toBe(false);expect(c.error).toMatch(/closed/);expect(androidClients.has(c.url)).toBe(false)})
 it('bounds video backlog and closes on overload',()=>{const c=make();(c.ws as any).onmessage({data:new ArrayBuffer(9*1024*1024)});expect(c.error).toMatch(/cannot keep up/);expect(c.ws.close).toHaveBeenCalled()})
 it('preserves explicit server errors after transport closes',()=>{const c=make();(c.ws as any).onmessage({data:JSON.stringify({error:'device unauthorized'})});(c.ws as any).onclose();expect(c.error).toBe('device unauthorized')})
 it('encodes file paths into the authenticated same-session endpoint',()=>{const c=make();const u=new URL(c.httpURL('download','/sdcard/a b&你好.bin'));expect(u.protocol).toBe('http:');expect(u.searchParams.get('path')).toBe('/sdcard/a b&你好.bin')})
})

function audioFixture() {
 const contexts:any[]=[]
 vi.stubGlobal('AudioContext',class {
  constructor(){
   const sources:any[]=[];const node=()=>({connect:vi.fn(),disconnect:vi.fn()})
   const ctx:any={state:'running',currentTime:1,destination:{},sources,
    resume:vi.fn(async()=>{}),close:vi.fn(async()=>{}),
    createChannelSplitter:node,createChannelMerger:node,
    createGain:()=>({...node(),gain:{value:1,setValueAtTime:vi.fn()}}),
    createBuffer:(_:number,frames:number,rate:number)=>({duration:frames/rate,copyToChannel:vi.fn()}),
    createBufferSource:()=>{const source={...node(),start:vi.fn(),stop:vi.fn(),onended:null};sources.push(source);return source},
   };contexts.push(ctx);return ctx
  }
 })
 return contexts
}
function pcm(client:AndroidClient,bytes=3840) {
 const packet=new Uint8Array(13+bytes);packet[0]=2
 ;(client.ws as any).onmessage({data:packet.buffer})
}
describe('Android shared PCM playback',()=>{
 it('starts only after a gesture and uses the shared continuous timeline',()=>{
  const contexts=audioFixture(),c=make();pcm(c);expect(contexts).toHaveLength(0)
  c.enableAudio();c.enableAudio();expect(contexts).toHaveLength(1)
  const ctx=contexts[0]
  for(const time of [1,1.02,1.05,1.06,1.08]){ctx.currentTime=time;pcm(c)}
  expect(ctx.sources).toHaveLength(5)
  ctx.sources.slice(1).forEach((s:any,i:number)=>expect(s.start.mock.calls[0][0]-ctx.sources[i].start.mock.calls[0][0]).toBeCloseTo(.02))
  expect(ctx.sources[0].start.mock.calls[0][0]).toBeCloseTo(1.12)
  c.dispose()
 })
 it('preserves a 300ms audio burst instead of dropping new packets at 250ms',()=>{
  const contexts=audioFixture(),c=make();c.enableAudio();for(let i=0;i<6;i++)pcm(c,9600)
  expect(contexts[0].sources).toHaveLength(6)
  expect(contexts[0].sources.every((s:any)=>!s.stop.mock.calls.length)).toBe(true);c.dispose()
 })
 it('clears queued audio on suspension and transport close without reopening it',()=>{
  const contexts=audioFixture(),c=make();c.enableAudio();pcm(c);const ctx=contexts[0]
  ctx.state='suspended';ctx.onstatechange();expect(ctx.sources[0].stop).toHaveBeenCalled()
  pcm(c);expect(ctx.sources).toHaveLength(1);expect(ctx.resume).toHaveBeenCalled()
  ctx.state='running';ctx.currentTime=2;pcm(c);expect(ctx.sources).toHaveLength(2)
  ;(c.ws as any).onclose();expect(ctx.sources[1].stop).toHaveBeenCalled();expect(ctx.close).toHaveBeenCalledTimes(1)
  expect(JSON.parse(c.canvas.dataset.androidAudioStats!).state).toBe('closed')
  c.enableAudio();pcm(c);expect(contexts).toHaveLength(1);expect(ctx.sources).toHaveLength(2)
 })
 it('keeps audio contexts independent between sessions',()=>{
  const contexts=audioFixture(),a=make(),b=make();a.enableAudio();b.enableAudio();pcm(a);pcm(b)
  a.dispose();expect(contexts[0].close).toHaveBeenCalled();expect(contexts[1].close).not.toHaveBeenCalled()
  pcm(b);expect(contexts[1].sources).toHaveLength(2);b.dispose()
 })
 it('rejects incomplete or oversized PCM without breaking video metadata',()=>{
  const contexts=audioFixture(),c=make();c.enableAudio();pcm(c,5);pcm(c,192004)
  expect(contexts[0].sources).toHaveLength(0)
  ;(c.ws as any).onmessage({data:JSON.stringify({width:1280,height:720})});expect(c.connected).toBe(true);c.dispose()
 })
})

describe('Android camera metadata', () => {
 it('retains camera source for cached sessions and defaults older servers to display', () => {
  const client = make()
  ;(client.ws as any).onmessage({data:JSON.stringify({width:1280,height:720,videoSource:'front'})})
  expect(client.videoSource).toBe('front')
  expect(client.connected).toBe(true)
  ;(client.ws as any).onmessage({data:JSON.stringify({width:720,height:1280})})
  expect(client.videoSource).toBe('display')
 })
})

 describe('Android connection failures',()=>{
  it('reports a silent startup and closes the socket instead of waiting forever',()=>{
   vi.useFakeTimers();const c=make();c.changed=vi.fn();
   vi.advanceTimersByTime(45000);
   expect(c.error).toMatch(/timed out/);expect(c.connected).toBe(false);expect(c.ws.close).toHaveBeenCalled();expect(c.changed).toHaveBeenCalled();
  })
  it('does not treat metadata alone as a working video stream',()=>{
   vi.useFakeTimers();const c=make();(c.ws as any).onmessage({data:JSON.stringify({width:720,height:1280})});
   vi.advanceTimersByTime(45000);expect(c.error).toMatch(/no video/);expect(c.connected).toBe(false);
  })
  it('clears startup timeout once video data is accepted',async()=>{
   vi.useFakeTimers();const c=make();const packet=new Uint8Array(14);packet[0]=1;
   (c.ws as any).onmessage({data:packet.buffer});await vi.advanceTimersByTimeAsync(45000);
   expect(c.error).toBe('');expect(c.ws.close).not.toHaveBeenCalled();
  })
  it('reports malformed metadata and preserves server errors across late events',()=>{
   const c=make();(c.ws as any).onmessage({data:'not json'});expect(c.error).toMatch(/Invalid response/);
   const d=make();(d.ws as any).onmessage({data:JSON.stringify({error:{message:'Device authorization rejected'}})});
   (d.ws as any).onerror();(d.ws as any).onclose();expect(d.error).toBe('Device authorization rejected');expect(d.connected).toBe(false);
  })
  it('does not turn an intentional dispose into a connection error',()=>{
   vi.useFakeTimers();const c=make();c.dispose();(c.ws as any).onclose();vi.advanceTimersByTime(45000);expect(c.error).toBe('');
  })
 })
