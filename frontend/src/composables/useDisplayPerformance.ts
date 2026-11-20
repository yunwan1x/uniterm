import { ref, watch } from 'vue'

export function useDisplayPerformance(connectionId: () => string | undefined) {
  const enabled = ref(false)
  function key() {
    const id = connectionId()
    return id && 'uniterm:display-performance:' + id
  }
  watch(connectionId, () => {
    const storageKey = key()
    try { enabled.value = !!storageKey && localStorage.getItem(storageKey) === 'on' }
    catch { enabled.value = false }
  }, { immediate: true })
  function toggle() {
    enabled.value = !enabled.value
    const storageKey = key()
    if (!storageKey) return
    try {
      if (enabled.value) localStorage.setItem(storageKey, 'on')
      else localStorage.removeItem(storageKey)
    } catch { /* Session-only preference when storage is unavailable. */ }
  }
  return { enabled, toggle }
}
