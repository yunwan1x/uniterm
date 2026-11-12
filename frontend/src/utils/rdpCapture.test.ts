import { afterEach, expect, it, vi } from 'vitest'
import { PcmResampler, RdpCapture } from './rdpCapture'
afterEach(() => vi.unstubAllGlobals())
it('resamples across uneven chunks with identical PCM and duplicated stereo', () => {
 const input=Float32Array.from({length:4800},(_,i)=>Math.sin(i*.1))
 const whole=new PcmResampler(48000,16000,2).push(input)
 const r=new PcmResampler(48000,16000,2), parts=[...r.push(input.slice(0,713)),...r.push(input.slice(713,2171)),...r.push(input.slice(2171))]
 expect(parts).toEqual([...whole]);expect(whole.length).toBe(1600*4)
 const v=new DataView(whole.buffer);for(let i=0;i<whole.length;i+=4)expect(v.getInt16(i,true)).toBe(v.getInt16(i+2,true))
})
it('releases a permission response that arrives after disconnect', async () => {
 let resolve!: (s:any)=>void
 vi.stubGlobal('window',{isSecureContext:true});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}})
 const capture=new RdpCapture(vi.fn(),vi.fn()), stop=vi.fn()
 const pending=capture.enable('camera');capture.stopAll();resolve({getTracks:()=>[{stop}]})
 expect(await pending).toBe(false);expect(stop).toHaveBeenCalled();expect(capture.enabled('camera')).toBe(false)
})
it('never requests devices on insecure origins, and stops tracks on disable', async () => {
 const getUserMedia=vi.fn();vi.stubGlobal('window',{isSecureContext:false});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}})
 const capture=new RdpCapture(vi.fn(),vi.fn());await expect(capture.enable('microphone')).rejects.toThrow('HTTPS_REQUIRED');expect(getUserMedia).not.toHaveBeenCalled()
 vi.stubGlobal('window',{isSecureContext:true});const stop=vi.fn();getUserMedia.mockResolvedValue({getTracks:()=>[{stop}]})
 await capture.enable('microphone');expect(capture.enabled('microphone')).toBe(true);capture.disable('microphone');expect(stop).toHaveBeenCalled();expect(capture.enabled('microphone')).toBe(false)
})
