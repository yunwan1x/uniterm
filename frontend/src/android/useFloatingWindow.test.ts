import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
const { cleanup } = vi.hoisted(() => ({ cleanup: [] as (() => void)[] }))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onBeforeUnmount: (fn: () => void) => cleanup.push(fn),
}))
import { useFloatingWindow } from './useFloatingWindow'
function childWindow() {
  return Object.assign(new EventTarget(), {
    close: vi.fn(),
    focus: vi.fn(),
    document: {
      head: { appendChild: vi.fn() },
      body: { style: { cssText: '' } },
      documentElement: { style: { setProperty: vi.fn(), cssText: '' } },
      title: '',
    },
  })
}
beforeEach(() => {
  cleanup.length = 0
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      innerWidth: 1200,
      innerHeight: 900,
      isSecureContext: true,
    }),
  )
  vi.stubGlobal('document', {
    body: {},
    documentElement: {},
    querySelectorAll: () => [],
  })
  vi.stubGlobal('getComputedStyle', () => [])
})
afterEach(() => {
  cleanup.forEach((fn) => fn())
  vi.unstubAllGlobals()
})
describe('Android floating window lifecycle', () => {
  it('uses local floating window when native API is absent and clamps to viewport', async () => {
    const view = useFloatingWindow(ref())
    await view.open()
    expect(view.kind.value).toBe('page')
    Object.assign(window, { innerWidth: 280, innerHeight: 400 })
    window.dispatchEvent(new Event('resize'))
    expect(view.style.value).toMatchObject({
      left: '0px',
      top: '0px',
      width: '280px',
      height: '400px',
    })
    await view.restore()
    expect(view.floating.value).toBe(false)
  })
  it('falls back when browser policy denies native window', async () => {
    Object.assign(window, {
      documentPictureInPicture: {
        requestWindow: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })
    const view = useFloatingWindow(ref())
    await view.open()
    expect(view.kind.value).toBe('page')
  })
  it('restores when the browser closes the native window', async () => {
    const child = childWindow()
    Object.assign(window, {
      documentPictureInPicture: {
        requestWindow: vi.fn().mockResolvedValue(child),
      },
    })
    const view = useFloatingWindow(ref())
    await view.open()
    expect(view.kind.value).toBe('native')
    child.dispatchEvent(new Event('pagehide'))
    expect(view.floating.value).toBe(false)
    expect(view.target.value).toBeNull()
  })
  it('cancels a pending native request if the connection tab is closed', async () => {
    const child = childWindow()
    let resolve!: (w: unknown) => void
    Object.assign(window, {
      documentPictureInPicture: {
        requestWindow: () =>
          new Promise((r) => {
            resolve = r
          }),
      },
    })
    const view = useFloatingWindow(ref())
    const request = view.open()
    await view.restore()
    resolve(child)
    await request
    expect(child.close).toHaveBeenCalledOnce()
    expect(view.floating.value).toBe(false)
  })
  it('ignores pagehide from an already restored window after another opens', async () => {
    const first = childWindow(),
      second = childWindow()
    Object.assign(window, {
      documentPictureInPicture: {
        requestWindow: vi
          .fn()
          .mockResolvedValueOnce(first)
          .mockResolvedValueOnce(second),
      },
    })
    const view = useFloatingWindow(ref())
    await view.open()
    await view.restore()
    await view.open()
    first.dispatchEvent(new Event('pagehide'))
    expect(view.kind.value).toBe('native')
    expect(view.target.value).toBe(second.document.body)
  })
})

describe('Android floating viewport geometry', () => {
 function pointer(type: string,x:number,y:number) {
  return Object.assign(new Event(type),{clientX:x,clientY:y,pointerId:1,button:0}) as PointerEvent
 }
 it('can reach the bottom edge, fill the viewport and resize without moving its anchor',async()=>{
  const view=useFloatingWindow(ref());await view.open()
  view.drag(pointer('pointerdown',850,70))
  window.dispatchEvent(pointer('pointermove',850,1000))
  window.dispatchEvent(pointer('pointerup',850,1000))
  expect(view.style.value.top).toBe('260px')
  await view.maximize()
  expect(view.style.value).toMatchObject({left:'0px',top:'0px',width:'1200px',height:'900px'})
  await view.restore();await view.open()
  const before=view.style.value
  view.drag(pointer('pointerdown',1176,704),true)
  window.dispatchEvent(pointer('pointermove',2000,2000))
  window.dispatchEvent(pointer('pointerup',2000,2000))
  expect(view.style.value.left).toBe(before.left)
  expect(view.style.value.top).toBe(before.top)
  expect(view.style.value.height).toBe('836px')
 })
 it('bottom and right edges resize only their own axis', async()=>{
  const view=useFloatingWindow(ref());await view.open()
  const before={...view.style.value}
  view.drag(pointer('pointerdown',500,500),'bottom')
  window.dispatchEvent(pointer('pointermove',700,550));window.dispatchEvent(pointer('pointerup',700,550))
  expect(view.style.value.width).toBe(before.width)
  expect(parseFloat(view.style.value.height!)).toBe(parseFloat(before.height!)+50)
  const height=view.style.value.height
  view.drag(pointer('pointerdown',500,500),'right')
  window.dispatchEvent(pointer('pointermove',450,600));window.dispatchEvent(pointer('pointerup',450,600))
  expect(view.style.value.height).toBe(height)
  expect(parseFloat(view.style.value.width!)).toBe(parseFloat(before.width!)-50)
 })
 it('moves native PiP into a full viewport without creating a new session',async()=>{
  const child=childWindow();Object.assign(window,{focus:vi.fn(),documentPictureInPicture:{requestWindow:vi.fn().mockResolvedValue(child)}})
  const view=useFloatingWindow(ref());await view.open();await view.maximize()
  expect(child.close).toHaveBeenCalledOnce()
  expect(view.kind.value).toBe('page')
  expect(view.style.value).toMatchObject({width:'1200px',height:'900px'})
 })
})
