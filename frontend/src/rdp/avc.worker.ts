/// <reference lib="webworker" />
import { packYuv420 } from './yuv420'
// One request at a time. Output is copied before signalling the protocol worker.
const scope = self as unknown as DedicatedWorkerGlobalScope
const decoders = new Map<number, { decoder: VideoDecoder; codec: string; timestamp: number }>()
let control: Int32Array, pixels: Uint8Array
let rawYuv = new Uint8Array(0)
let active: { timestamp: number; done: boolean; yuv: boolean } | null = null
function finish(status: number) { if (active?.done) return; if (active) active.done = true; Atomics.store(control, 0, status); Atomics.notify(control, 0) }
function reset() { for (const d of decoders.values()) d.decoder.close(); decoders.clear() }
function nalUnits(data: Uint8Array) {
  const starts: { offset: number; payload: number }[] = []
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
      const n = data[i + 2] === 1 ? 3 : 4; starts.push({ offset: i, payload: i + n }); i += n - 1
    }
  }
  return starts.map((s, i) => data.subarray(s.payload, starts[i + 1]?.offset ?? data.length))
}
async function probeYuv(): Promise<boolean> {
  // A real decoded picture is required: API presence alone does not guarantee
  // that an opaque GPU frame exposes readable I420/NV12 planes.
  const data=new Uint8Array([0,0,0,1,103,66,192,10,217,30,192,68,0,0,3,0,4,0,0,3,0,202,60,72,153,32,0,0,0,1,104,203,131,203,32,0,0,0,1,101,136,132,4,188,152,160,0,56,163,128])
  return new Promise(resolve=>{
    let settled=false
    const complete=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);try{decoder.close()}catch{};resolve(ok)}
    const decoder=new VideoDecoder({output:async frame=>{
      try {
        const width=frame.codedWidth,height=frame.codedHeight,rect={x:0,y:0,width,height}
        const source=new Uint8Array(frame.allocationSize({rect})),out=new Uint8Array(width*height+2*Math.ceil(width/2)*Math.ceil(height/2))
        const layout=await frame.copyTo(source,{rect})
        packYuv420(source,frame.format,layout,width,height,out)
        complete(true)
      }catch{complete(false)}finally{frame.close()}
    },error:()=>complete(false)})
    const timer=setTimeout(()=>complete(false),2000)
    try { decoder.configure({codec:'avc1.42C00A',optimizeForLatency:true});decoder.decode(new EncodedVideoChunk({type:'key',timestamp:0,data})) }catch{complete(false)}
  })
}
scope.onmessage = async ({ data: m }) => {
  if (m.method === 'init') {
    control = new Int32Array(m.control); pixels = new Uint8Array(m.pixels)
    let supported = false
    try { supported = (await VideoDecoder.isConfigSupported({ codec: 'avc1.42E028', optimizeForLatency: true })).supported === true } catch {}
    let yuv = false
    try { yuv = supported && (await VideoDecoder.isConfigSupported({ codec: 'avc1.640033', optimizeForLatency: true })).supported === true } catch {}
    if(yuv)yuv=await probeYuv()
    scope.postMessage({ ready: supported, yuv }); return
  }
  if (m.method === 'reset') { reset(); return }
  if (m.method !== 'decode') return
  active = { timestamp: m.timestamp, done: false, yuv: m.yuv === true }
  try {
    const nals = nalUnits(m.data)
    const sps = nals.find(n => (n[0] & 31) === 7)
    const key = nals.some(n => (n[0] & 31) === 5)
    let state = decoders.get(m.surface)
    const codec = sps && sps.length >= 4 ? 'avc1.' + [...sps.subarray(1, 4)].map(v => v.toString(16).padStart(2, '0')).join('') : state?.codec
    if (!codec) throw new Error('Missing AVC sequence header')
    if (!state || state.codec !== codec) {
      state?.decoder.close()
      if (!state && decoders.size >= 16) throw new Error('Too many AVC surfaces')
      const decoder = new VideoDecoder({
        output: async frame => {
          try {
            if (active?.done || frame.timestamp !== active?.timestamp) throw new Error('Delayed AVC picture')
            const width = frame.codedWidth, height = frame.codedHeight
            const size = width * height * 4
            if (size > pixels.length || width < 1 || height < 1) throw new Error('AVC picture too large')
            const rect = { x: 0, y: 0, width, height }
            if (active.yuv) {
              const required=frame.allocationSize({rect})
              if(required>pixels.length)throw new Error('YUV allocation too large')
              if(rawYuv.length<required)rawYuv=new Uint8Array(required)
              const layout=await frame.copyTo(rawYuv,{rect})
              packYuv420(rawYuv,frame.format,layout,width,height,pixels)
            } else await frame.copyTo(pixels, { format: 'RGBA', rect })
            Atomics.store(control, 1, width); Atomics.store(control, 2, height)
            finish(1)
          } catch { finish(-1) } finally { frame.close() }
        },
        error: () => finish(-1),
      })
      decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'no-preference' })
      state = { decoder, codec, timestamp: 0 }; decoders.set(m.surface, state)
    }
    state.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: m.timestamp, data: m.data }))
    // No flush per frame: flush would require the next chunk to be a key frame.
  } catch { finish(-1) }
}
