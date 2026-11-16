import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

export const FULLSCREEN_TOOLBAR_PIN_KEY = 'uniterm:fullscreen-toolbar-pinned:v1'
function readPinned() {
  try { return localStorage.getItem(FULLSCREEN_TOOLBAR_PIN_KEY) === 'true' } catch { return false }
}
// One preference across RDP, VNC, SPICE and Android, including cached panels.
const pinned = ref(readPinned())
watch(pinned, value => {
  try { localStorage.setItem(FULLSCREEN_TOOLBAR_PIN_KEY, String(value)) } catch { /* Session-only if storage is unavailable. */ }
}, { flush: 'sync' })

export function useFullscreenToolbarPinned() { return pinned }

/** Timer/gesture policy is separate from the DOM so it can be exercised with a fake clock. */
export function useFullscreenToolbar(
  active: () => boolean,
  holdOpen: () => boolean,
  pin: Ref<boolean> = pinned,
) {
  const expanded = ref(true)
  const hovered = ref(false)
  const focused = ref(false)
  const popupOpen = ref(false)
  const remoteGesture = ref(false)
  const visible = computed(() => active() && (pin.value || expanded.value))
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let initialUntil = 0

  function cancelHide() { clearTimeout(hideTimer); hideTimer = undefined }
  function cancelReveal() { clearTimeout(revealTimer); revealTimer = undefined }
  function held() { return pin.value || holdOpen() || hovered.value || focused.value || popupOpen.value }
  function scheduleHide() {
    cancelHide()
    if (!active() || held()) return
    hideTimer = setTimeout(() => {
      hideTimer = undefined
      if (!held()) expanded.value = false
    }, Math.max(1000, initialUntil - Date.now()))
  }
  function show() {
    if (!active() || remoteGesture.value) return
    cancelReveal()
    cancelHide()
    expanded.value = true
    scheduleHide()
  }
  function hoverHandle(buttons = 0) {
    cancelReveal()
    if (!active() || remoteGesture.value || buttons !== 0) return
    revealTimer = setTimeout(() => { revealTimer = undefined; show() }, 200)
  }
  function hide() {
    if (!active() || holdOpen() || popupOpen.value || remoteGesture.value) return false
    cancelReveal()
    cancelHide()
    initialUntil = 0
    hovered.value = false
    focused.value = false
    pin.value = false
    expanded.value = false
    return true
  }
  function togglePin() {
    pin.value = !pin.value
    show()
  }

  watch(active, enabled => {
    cancelHide()
    cancelReveal()
    hovered.value = false
    focused.value = false
    popupOpen.value = false
    expanded.value = enabled
    initialUntil = enabled ? Date.now() + 2000 : 0
    if (enabled) scheduleHide()
  }, { immediate: true, flush: 'sync' })
  watch([pin, holdOpen, hovered, focused, popupOpen], () => {
    if (active() && held()) {
      cancelHide()
      // An external panel opening must keep its toolbar reachable.
      if (!remoteGesture.value) expanded.value = true
    } else scheduleHide()
  }, { flush: 'sync' })
  watch(remoteGesture, dragging => { if (dragging) cancelReveal() }, { flush: 'sync' })
  onScopeDispose(() => { cancelHide(); cancelReveal() })
  return { pinned: pin, visible, expanded, hovered, focused, popupOpen, remoteGesture, show, hide, togglePin, hoverHandle, cancelReveal, scheduleHide }
}
