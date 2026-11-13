import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  type Ref,
} from 'vue'

type PiPWindowAPI = {
  requestWindow(options: {
    width: number
    height: number
    disallowReturnToOpener: boolean
  }): Promise<Window>
}

// Move the existing view, never create a second decoder or Android session.
export function useFloatingWindow(
  root: Ref<HTMLElement | undefined>,
  onRestore?: () => void,
) {
  const kind = ref<'inline' | 'page' | 'native'>('inline')
  const target = shallowRef<HTMLElement | null>(null)
  const opening = ref(false)
  const notice = ref('')
  const geometry = ref({ x: 0, y: 0, width: 340, height: 640 })
  let pip: Window | null = null
  let destroyed = false
  let generation = 0
  let cancelDrag = () => {}
  const floating = computed(() => kind.value !== 'inline')
  const style = computed(() =>
    kind.value === 'page'
      ? {
          left: `${geometry.value.x}px`,
          top: `${geometry.value.y}px`,
          width: `${geometry.value.width}px`,
          height: `${geometry.value.height}px`,
        }
      : {},
  )

  function clamp() {
    const g = geometry.value
    g.width = Math.min(g.width, window.innerWidth)
    g.height = Math.min(g.height, window.innerHeight)
    g.x = Math.max(0, Math.min(g.x, window.innerWidth - g.width))
    g.y = Math.max(0, Math.min(g.y, window.innerHeight - g.height))
  }
  function pageFallback() {
    geometry.value = {
      x: window.innerWidth - 364,
      y: 64,
      width: 340,
      height: 640,
    }
    clamp()
    target.value = document.body
    kind.value = 'page'
  }
  function copyStyles(destination: Document) {
    // Include compiled scoped styles, font declarations and the active theme tokens.
    document
      .querySelectorAll('style, link[rel="stylesheet"]')
      .forEach((node) => {
        const clone = node.cloneNode(true) as HTMLElement
        if (clone instanceof HTMLLinkElement)
          clone.href = (node as HTMLLinkElement).href
        destination.head.appendChild(clone)
      })
    const tokens = getComputedStyle(root.value || document.documentElement)
    for (const name of Array.from(tokens)) {
      if (name.startsWith('--'))
        destination.documentElement.style.setProperty(
          name,
          tokens.getPropertyValue(name),
        )
    }
    destination.documentElement.style.cssText +=
      ';height:100%;background:#111;color:#eee;'
    destination.body.style.cssText =
      'margin:0;height:100%;overflow:hidden;background:#111;color:#eee;'
    destination.title = 'Android · uniTerm'
  }
  function returned() {
    const wasFloating = floating.value
    cancelDrag()
    pip = null
    kind.value = 'inline'
    target.value = null
    if (wasFloating && !destroyed) onRestore?.()
  }
  async function restore() {
    const previous = pip
    generation++
    returned()
    // Move teleported children back before disposing their document.
    await nextTick()
    previous?.close()
  }
  async function open() {
    if (opening.value || floating.value) return
    opening.value = true
    const request = ++generation
    notice.value = ''
    try {
      const api = (
        window as Window & { documentPictureInPicture?: PiPWindowAPI }
      ).documentPictureInPicture
      if (window.isSecureContext && api) {
        const child = await api.requestWindow({
          width: 360,
          height: 690,
          disallowReturnToOpener: true,
        })
        if (destroyed || request !== generation) {
          child.close()
          return
        }
        pip = child
        copyStyles(child.document)
        child.addEventListener(
          'pagehide',
          () => {
            if (pip === child) returned()
          },
          { once: true },
        )
        target.value = child.document.body
        kind.value = 'native'
      } else pageFallback()
    } catch {
      // Permission/browser-policy denial must still leave a usable local window.
      pip?.close()
      pip = null
      if (!destroyed && request === generation) pageFallback()
    } finally {
      opening.value = false
    }
  }
  function focus() {
    if (pip) pip.focus()
    else root.value?.querySelector<HTMLElement>('.android-screen')?.focus()
  }
  function drag(e: PointerEvent, resize = false) {
    if (kind.value !== 'page' || e.button !== 0) return
    e.preventDefault()
    cancelDrag()
    const start = { ...geometry.value },
      x = e.clientX,
      y = e.clientY
    const move = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return
      if (resize) {
        geometry.value.width = Math.max(260, start.width + event.clientX - x)
        geometry.value.height = Math.max(360, start.height + event.clientY - y)
      } else {
        geometry.value.x = start.x + event.clientX - x
        geometry.value.y = start.y + event.clientY - y
      }
      clamp()
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
    }
    cancelDrag = end
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
  }
  async function fullscreen() {
    notice.value = ''
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await root.value?.requestFullscreen()
    } catch (error) {
      notice.value = String(error)
    }
  }
  window.addEventListener('resize', clamp)
  onBeforeUnmount(() => {
    destroyed = true
    cancelDrag()
    window.removeEventListener('resize', clamp)
    const previous = pip
    returned()
    previous?.close()
  })
  return {
    kind,
    target,
    opening,
    notice,
    floating,
    style,
    open,
    restore,
    focus,
    drag,
    fullscreen,
  }
}
