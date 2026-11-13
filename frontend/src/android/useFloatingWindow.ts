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
  root: Ref<HTMLElement | null | undefined>,
  onRestore?: () => void,
  getVideoSize?: () => { width: number; height: number },
  title = 'Android · uniTerm',
) {
  const kind = ref<'inline' | 'page' | 'native' | 'window'>('inline')
  const target = shallowRef<HTMLElement | null>(null)
  const opening = ref(false)
  const notice = ref('')
  const geometry = ref({ x: 0, y: 0, width: 340, height: 640 })
  let pip: Window | null = null
  let themeObserver: MutationObserver | null = null
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
    syncTheme(destination)
    if (typeof MutationObserver !== 'undefined') {
      themeObserver = new MutationObserver(() => syncTheme(destination))
      themeObserver.observe(document.documentElement, { attributes: true })
      themeObserver.observe(document.body, { attributes: true })
    }
    destination.title = title
  }
  function syncTheme(destination: Document) {
    const tokens = getComputedStyle(document.documentElement)
    for (const name of Array.from(tokens)) {
      if (name.startsWith('--'))
        destination.documentElement.style.setProperty(
          name,
          tokens.getPropertyValue(name),
        )
    }
    destination.documentElement.style.cssText +=
      ';height:100%;background:var(--bg-base);color:var(--text-primary);'
    destination.body.style.cssText =
      'margin:0;padding:0;height:100%;overflow:hidden;background:var(--bg-base);color:var(--text-primary);'
    destination.title = title
  }
  function returned() {
    const wasFloating = floating.value
    cancelDrag()
    themeObserver?.disconnect()
    themeObserver = null
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
  function initialSize() {
    const video = getVideoSize?.() ?? root.value?.querySelector('canvas')
    const videoWidth = video?.width || 720, videoHeight = video?.height || 1280
    const landscape = videoWidth > videoHeight
    const scale = Math.min((landscape ? 690 : 360) / videoWidth, (landscape ? 360 : 690) / videoHeight)
    return { width: Math.max(1, Math.round(videoWidth * scale)), height: Math.max(1, Math.round(videoHeight * scale)) }
  }
  function attach(child: Window, mode: 'native' | 'window') {
    pip = child
    copyStyles(child.document)
    child.addEventListener('pagehide', () => {
      if (pip === child) returned()
    }, { once: true })
    target.value = child.document.body
    kind.value = mode
  }
  function openWindow(blockedMessage = 'Popup blocked. Allow popups for this site and try again.') {
    if (opening.value || floating.value) return
    notice.value = ''
    // Keep window.open synchronous with the click to preserve user activation.
    const { width, height } = initialSize()
    let child: Window | null = null
    try {
      child = window.open('about:blank', '_blank', `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=no`)
      if (!child) { notice.value = blockedMessage; return }
      attach(child, 'window')
      child.focus()
    } catch (error) {
      if (pip === child) returned()
      child?.close()
      notice.value = String(error)
    }
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
        const child = await api.requestWindow({ ...initialSize(), disallowReturnToOpener: true })
        if (destroyed || request !== generation) {
          child.close()
          return
        }
        attach(child, 'native')
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
    else (root.value?.querySelector<HTMLElement>('.android-screen') ?? root.value)?.focus()
  }
  function drag(e: PointerEvent, resize: boolean | 'right' | 'bottom' = false) {
    if (kind.value !== 'page' || e.button !== 0) return
    e.preventDefault()
    cancelDrag()
    const start = { ...geometry.value },
      x = e.clientX,
      y = e.clientY
    const move = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return
      if (resize) {
        // At the viewport edge there is no more pointer travel available.
        // Expand toward the opposite edge instead of keeping the old anchor.
        // Derive every update from start so dragging back restores the anchor.
        if (resize !== 'bottom') {
          const reachesEdge = event.clientX >= window.innerWidth - 2 && event.clientX > x
          geometry.value.width = reachesEdge ? window.innerWidth : Math.min(window.innerWidth, Math.max(260, start.width + event.clientX - x))
          geometry.value.x = Math.min(start.x, window.innerWidth - geometry.value.width)
        }
        if (resize !== 'right') {
          const reachesEdge = event.clientY >= window.innerHeight - 2 && event.clientY > y
          geometry.value.height = reachesEdge ? window.innerHeight : Math.min(window.innerHeight, Math.max(240, start.height + event.clientY - y))
          geometry.value.y = Math.min(start.y, window.innerHeight - geometry.value.height)
        }
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
  async function maximize() {
    if (kind.value === 'window' && pip) {
      try {
        const screen = pip.screen as Screen & { availLeft?: number; availTop?: number }
        pip.moveTo(screen.availLeft ?? 0, screen.availTop ?? 0)
        pip.resizeTo(screen.availWidth, screen.availHeight)
      } catch (error) { notice.value = String(error) }
      return
    }
    // Native PiP sizing is browser-controlled. Move the same view into the
    // opener for an unrestricted viewport-sized window, without reconnecting.
    if (pip) { window.focus(); await restore(); pageFallback() }
    if (kind.value === 'page') {
      geometry.value = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    }
  }
  async function fullscreen() {
    notice.value = ''
    try {
      const owner = root.value?.ownerDocument ?? document
      if (owner.fullscreenElement) await owner.exitFullscreen()
      else await root.value?.requestFullscreen()
    } catch (error) {
      notice.value = String(error)
    }
  }
  const closeChild = () => pip?.close()
  window.addEventListener('pagehide', closeChild)
  window.addEventListener('resize', clamp)
  onBeforeUnmount(() => {
    destroyed = true
    cancelDrag()
    window.removeEventListener('resize', clamp)
    window.removeEventListener('pagehide', closeChild)
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
    openWindow,
    restore,
    focus,
    drag,
    fullscreen,
    maximize,
  }
}
