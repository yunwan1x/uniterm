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
  it.each([[416,912,315,690],[912,416,690,315],[720,720,360,360]])('opens %sx%s video at matching %sx%s window dimensions',async(w,h,width,height)=>{
    const child=childWindow(),requestWindow=vi.fn().mockResolvedValue(child)
    Object.assign(window,{documentPictureInPicture:{requestWindow}})
    const root=ref({querySelector:()=>({width:w,height:h})} as unknown as HTMLElement)
    const view=useFloatingWindow(root);await view.open()
    expect(requestWindow).toHaveBeenCalledWith({width,height,disallowReturnToOpener:true})
    expect(child.document.body.style.cssText).toContain('padding:0;')
  })

  it('uses received video dimensions before the first canvas frame is drawn',async()=>{
    const requestWindow=vi.fn().mockResolvedValue(childWindow())
    Object.assign(window,{documentPictureInPicture:{requestWindow}})
    const root=ref({querySelector:()=>({width:300,height:150})} as unknown as HTMLElement)
    await useFloatingWindow(root,undefined,()=>({width:416,height:912})).open()
    expect(requestWindow).toHaveBeenCalledWith({width:315,height:690,disallowReturnToOpener:true})
  })
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
 it('can move to the bottom edge and expand across the full viewport',async()=>{
  const view=useFloatingWindow(ref());await view.open()
  view.drag(pointer('pointerdown',850,70))
  window.dispatchEvent(pointer('pointermove',850,1000))
  window.dispatchEvent(pointer('pointerup',850,1000))
  expect(view.style.value.top).toBe('260px')
  await view.maximize()
  expect(view.style.value).toMatchObject({left:'0px',top:'0px',width:'1200px',height:'900px'})
  await view.restore();await view.open()
  view.drag(pointer('pointerdown',1176,704),true)
  window.dispatchEvent(pointer('pointermove',2000,2000))
  window.dispatchEvent(pointer('pointerup',2000,2000))
  expect(view.style.value).toMatchObject({left:'0px',top:'0px',width:'1200px',height:'900px'})
 })
 it('fills height at the reachable bottom edge and restores the anchor when dragged back',async()=>{
  const view=useFloatingWindow(ref());await view.open()
  const before={...view.style.value}
  view.drag(pointer('pointerdown',1000,704),'bottom')
  window.dispatchEvent(pointer('pointermove',1000,899))
  expect(view.style.value).toMatchObject({top:'0px',height:'900px',left:before.left,width:before.width})
  window.dispatchEvent(pointer('pointermove',1000,754))
  expect(view.style.value).toMatchObject({top:before.top,height:'690px'})
  window.dispatchEvent(pointer('pointerup',1000,754))
 })
 it('fills width at the reachable right edge without changing height',async()=>{
  const view=useFloatingWindow(ref());await view.open()
  const before={...view.style.value}
  view.drag(pointer('pointerdown',1176,400),'right')
  window.dispatchEvent(pointer('pointermove',1199,400))
  expect(view.style.value).toMatchObject({left:'0px',width:'1200px',top:before.top,height:before.height})
  window.dispatchEvent(pointer('pointerup',1199,400))
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

describe('Android independent window', () => {
  it('opens a same-origin popup synchronously with video aspect ratio', () => {
    const child=childWindow(),open=vi.fn().mockReturnValue(child)
    Object.assign(window,{open})
    const view=useFloatingWindow(ref(),undefined,()=>({width:416,height:912}))
    view.openWindow()
    expect(open).toHaveBeenCalledWith('about:blank','_blank','popup=yes,width=315,height=690,resizable=yes,scrollbars=no')
    expect(view.kind.value).toBe('window');expect(view.target.value).toBe(child.document.body)
    expect(child.focus).toHaveBeenCalled();expect(child.document.body.style.cssText).toContain('padding:0;')
  })
  it('keeps the inline session visible and explains popup blocking',()=>{
    Object.assign(window,{open:vi.fn().mockReturnValue(null)})
    const view=useFloatingWindow(ref());view.openWindow('Allow this site')
    expect(view.kind.value).toBe('inline');expect(view.notice.value).toBe('Allow this site')
  })
  it('returns the same view on popup close and does not open a second child',async()=>{
    const child=childWindow(),open=vi.fn().mockReturnValue(child),restored=vi.fn()
    Object.assign(window,{open})
    const view=useFloatingWindow(ref(),restored);view.openWindow();view.openWindow()
    expect(open).toHaveBeenCalledTimes(1)
    child.dispatchEvent(new Event('pagehide'))
    expect(view.kind.value).toBe('inline');expect(restored).toHaveBeenCalledOnce()
  })
  it('expands the popup to the work area without switching to page mode',async()=>{
    const child=Object.assign(childWindow(),{screen:{availLeft:100,availTop:20,availWidth:1400,availHeight:980},moveTo:vi.fn(),resizeTo:vi.fn()})
    Object.assign(window,{open:vi.fn().mockReturnValue(child)})
    const view=useFloatingWindow(ref());view.openWindow();await view.maximize()
    expect(child.moveTo).toHaveBeenCalledWith(100,20);expect(child.resizeTo).toHaveBeenCalledWith(1400,980);expect(view.kind.value).toBe('window')
  })
  it('uses the child document when leaving fullscreen',async()=>{
    const owner={fullscreenElement:{},exitFullscreen:vi.fn().mockResolvedValue(undefined)}
    const view=useFloatingWindow(ref({ownerDocument:owner} as unknown as HTMLElement));await view.fullscreen()
    expect(owner.exitFullscreen).toHaveBeenCalledOnce()
  })
  it('closes child windows when the opener leaves',()=>{
    const child=childWindow();Object.assign(window,{open:vi.fn().mockReturnValue(child)})
    const view=useFloatingWindow(ref());view.openWindow();window.dispatchEvent(new Event('pagehide'))
    expect(child.close).toHaveBeenCalledOnce()
  })
})
