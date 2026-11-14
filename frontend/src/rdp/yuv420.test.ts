import {describe,it,expect} from 'vitest'
import {packYuv420} from './yuv420'
describe('WebCodecs YUV bridge for AVC444',()=>{
  it('preserves padded odd-sized I420 planes without RGB conversion',()=>{
    const input=new Uint8Array([1,2,3,99,4,5,6,99,7,8,9,99,10,11,99,12,13,99,20,21,99,22,23,99])
    const out=new Uint8Array(17)
    expect(packYuv420(input,'I420',[{offset:0,stride:4},{offset:12,stride:3},{offset:18,stride:3}],3,3,out)).toBe(17)
    expect([...out]).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13,20,21,22,23])
  })
  it('separates NV12 chroma without swapping or overwriting U and V',()=>{
    const input=new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,21,31,22,32,99,99,23,33,24,34])
    const out=new Uint8Array(24)
    packYuv420(input,'NV12',[{offset:0,stride:4},{offset:16,stride:6}],4,4,out)
    expect([...out]).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,21,22,23,24,31,32,33,34])
  })
  it('ignores an I420 alpha plane while preserving exact YUV byte values',()=>{
    const out=new Uint8Array(6)
    packYuv420(new Uint8Array([0,255,16,235,128,240,1,2,3,4]),'I420A',[{offset:0,stride:2},{offset:4,stride:1},{offset:5,stride:1},{offset:6,stride:2}],2,2,out)
    expect([...out]).toEqual([0,255,16,235,128,240])
  })
  it('rejects unsupported formats and malformed planes before writing output',()=>{
    const out=new Uint8Array(6),source=new Uint8Array(6)
    const planes=[{offset:0,stride:2},{offset:4,stride:1},{offset:5,stride:1}]
    expect(()=>packYuv420(source,'RGBA',planes,2,2,out)).toThrow('Unsupported')
    expect(()=>packYuv420(source,'I420',planes,2,2,new Uint8Array(5))).toThrow('small')
    expect(()=>packYuv420(source,'I420',[planes[0]!,planes[1]!,{offset:6,stride:1}],2,2,out)).toThrow('layout')
    expect(()=>packYuv420(source,'I420',[{offset:0,stride:1},planes[1]!,planes[2]!],2,2,out)).toThrow('layout')
    expect(()=>packYuv420(source,'I420',planes,0,2,out)).toThrow('extent')
    expect([...out]).toEqual([0,0,0,0,0,0])
  })
})
