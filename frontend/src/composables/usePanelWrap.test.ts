import {describe,it,expect,vi,afterEach} from 'vitest'
afterEach(()=>vi.unstubAllGlobals())
describe('panel wrap preferences',()=>{
 it('shares the toggle across panels and persists only the display preference',async()=>{
  vi.resetModules()
  const storage=new Map<string,string>()
  vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)})
  const {usePanelWrap}=await import('./usePanelWrap')
  const {nextTick}=await import('vue')
  const a=usePanelWrap(),b=usePanelWrap();a.value=false;await nextTick()
  expect(b.value).toBe(false);expect(storage.get('uniterm:panel-wrap:v1')).toBe('false')
  vi.resetModules();expect((await import('./usePanelWrap')).usePanelWrap().value).toBe(false)
 })
 it('works when storage is unavailable',async()=>{
  vi.resetModules();vi.stubGlobal('localStorage',{getItem:()=>{throw Error()},setItem:()=>{throw Error()}})
  const state=(await import('./usePanelWrap')).usePanelWrap();expect(state.value).toBe(true)
  state.value=false;await (await import('vue')).nextTick();expect(state.value).toBe(false)
 })
})
