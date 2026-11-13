import { describe, expect, it } from 'vitest'
import { AdaptiveBitrate, presetQuality, storedQuality } from './quality'
const good = (now:number) => ({now,delay:10,rttGrowth:5,pending:0,decodeMs:2,active:true})
describe('Android quality presets and adaptive bitrate', () => {
 it('preserves custom settings and maps presets to independent encoding parameters',()=>{
  const custom={size:'2560',fps:15,bitrate:30}
  expect(presetQuality('custom',custom)).toEqual(custom)
  expect(presetQuality('fidelity',custom)).toEqual({size:'0',fps:60,bitrate:40})
  expect(presetQuality('balanced',custom)).toEqual({size:'1920',fps:30,bitrate:8})
  expect(presetQuality('auto',custom)).toEqual({size:'auto',fps:30,bitrate:8})
  expect(storedQuality(custom)?.preset).toBe('custom')
  expect(storedQuality({...custom,preset:'auto'})?.preset).toBe('auto')
  expect(storedQuality({...custom,bitrate:999})).toBeNull()
 })
 it('reduces bitrate after sustained network congestion without changing resolution',()=>{
  const a=new AdaptiveBitrate(8000000)
  expect(a.sample({...good(2000),delay:400})).toBeNull()
  expect(a.sample({...good(4000),delay:400})).toBe(4000000)
  expect(a.bitrate).toBe(8000000)
  a.bitrate=4000000
  expect(a.sample({...good(6000),pending:2000000})).toBeNull()
  expect(a.sample({...good(8000),pending:2000000})).toBeNull()
  expect(a.sample({...good(10000),pending:2000000})).toBe(2000000)
 })
 it('raises slowly, never on static screens, with bounded rates',()=>{
  const a=new AdaptiveBitrate(8000000)
  for(let i=1;i<=20;i++)expect(a.sample({...good(i*2000),active:false})).toBeNull()
  for(let i=21;i<30;i++)expect(a.sample(good(i*2000))).toBeNull()
  expect(a.sample(good(60000))).toBe(12000000)
  const max=new AdaptiveBitrate(40000000)
  for(let i=1;i<=20;i++)expect(max.sample(good(i*2000))).toBeNull()
 })
 it('treats decoder backpressure as congestion',()=>{
  const a=new AdaptiveBitrate(20000000)
  a.sample({...good(2000),decodeMs:150})
  expect(a.sample({...good(4000),decodeMs:150})).toBe(12000000)
 })
})
