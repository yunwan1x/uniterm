import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@yume-chan/scrcpy-decoder-tinyh264',()=>({TinyH264Decoder:class {sizeChanged=()=>{};writable={getWriter:()=>({write:async()=>{}})};dispose(){} }}))
vi.mock('@yume-chan/scrcpy-decoder-webcodecs',()=>({WebCodecsVideoDecoder:class {static isSupported=false},BitmapVideoFrameRenderer:class{}}))
vi.mock('@yume-chan/scrcpy',()=>({ScrcpyVideoCodecId:{H264:1}}))
import {AndroidClient,androidClients} from './client'
class Socket {static OPEN=1;readyState=1;binaryType='';onclose=()=>{};onmessage=(_e:any)=>{};onerror=()=>{};send=vi.fn();close=vi.fn()}
function make(){vi.stubGlobal('document',{createElement:()=>({})});vi.stubGlobal('WebSocket',Socket);return new AndroidClient('ws://localhost/test')}
afterEach(()=>{androidClients.clear();vi.unstubAllGlobals()})
describe('Android browser lifecycle',()=>{
 it('uses software decoding without WebCodecs and exposes disconnect instead of spinning forever',()=>{const c=make();expect(c.mode).toBe('H.264 software');(c.ws as any).onmessage({data:JSON.stringify({width:720,height:1280})});expect(c.connected).toBe(true);androidClients.set(c.url,c);(c.ws as any).onclose();expect(c.connected).toBe(false);expect(c.error).toMatch(/closed/);expect(androidClients.has(c.url)).toBe(false)})
 it('bounds video backlog and closes on overload',()=>{const c=make();(c.ws as any).onmessage({data:new ArrayBuffer(9*1024*1024)});expect(c.error).toMatch(/cannot keep up/);expect(c.ws.close).toHaveBeenCalled()})
 it('preserves explicit server errors after transport closes',()=>{const c=make();(c.ws as any).onmessage({data:JSON.stringify({error:'device unauthorized'})});(c.ws as any).onclose();expect(c.error).toBe('device unauthorized')})
 it('encodes file paths into the authenticated same-session endpoint',()=>{const c=make();const u=new URL(c.httpURL('download','/sdcard/a b&你好.bin'));expect(u.protocol).toBe('http:');expect(u.searchParams.get('path')).toBe('/sdcard/a b&你好.bin')})
})
