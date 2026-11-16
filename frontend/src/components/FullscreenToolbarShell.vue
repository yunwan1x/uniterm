<template>
  <div
    ref="root"
    class="fullscreen-toolbar-shell"
    :class="{ 'is-active': active, 'is-expanded': state.visible.value, 'has-remote-gesture': state.remoteGesture.value }"
  >
    <button
      v-if="active"
      class="fullscreen-toolbar-handle"
      :class="{ 'is-hidden': state.visible.value }"
      :disabled="state.remoteGesture.value"
      :tabindex="state.visible.value ? -1 : 0"
      :aria-hidden="state.visible.value || undefined"
      :aria-label="t('remoteDesktop.showToolbar')"
      :aria-expanded="state.visible.value"
      :title="t('remoteDesktop.showToolbar')"
      @pointerenter="state.hoverHandle($event.buttons)"
      @pointerleave="state.cancelReveal"
      @pointerdown.stop.prevent="interact"
      @mousedown.stop
      @mouseup.stop
      @pointerup.stop
      @pointermove.stop
      @mousemove.stop
      @touchstart.stop
      @touchend.stop
      @click.stop="activateHandle"
      @dblclick.stop
      @wheel.stop
      @contextmenu.stop.prevent
      @keydown.stop
      @keyup.stop
    >
      <span class="fullscreen-toolbar-handle-pill"><ChevronDown :size="16" /></span>
    </button>
    <div
      ref="content"
      class="fullscreen-toolbar-content"
      :class="{ 'is-hidden': active && !state.visible.value }"
      :role="active ? 'toolbar' : undefined"
      :aria-label="active ? t('remoteDesktop.fullscreenToolbar') : undefined"
      :aria-hidden="active && !state.visible.value || undefined"
      :inert="active && !state.visible.value || undefined"
      @pointerenter="enterToolbar"
      @pointerleave="leaveToolbar"
      @pointerdown="stopAndInteract"
      @pointerup="stopLocal"
      @pointermove="stopLocal"
      @pointercancel="stopLocal"
      @mousedown="stopLocal"
      @mouseup="stopLocal"
      @mousemove="stopLocal"
      @click="stopLocal"
      @dblclick="stopLocal"
      @touchstart="stopLocal"
      @touchmove="stopLocal"
      @touchend="stopLocal"
      @wheel="stopLocal"
      @keydown="stopLocal"
      @keyup="stopLocal"
      @contextmenu="stopContextMenu"
      @focusin="focusIn"
      @focusout="focusOut"
    >
      <button
        v-if="active"
        class="fullscreen-toolbar-button fullscreen-toolbar-pin"
        :class="{ 'is-pinned': state.pinned.value }"
        :aria-pressed="state.pinned.value"
        :aria-label="t(state.pinned.value ? 'remoteDesktop.unpinToolbar' : 'remoteDesktop.pinToolbar')"
        :title="t(state.pinned.value ? 'remoteDesktop.unpinToolbar' : 'remoteDesktop.pinToolbar')"
        @click="state.togglePin"
      >
        <Pin v-if="state.pinned.value" :size="16" />
        <PinOff v-else :size="16" />
      </button>
      <slot />
      <button
        v-if="active"
        class="fullscreen-toolbar-button fullscreen-toolbar-hide"
        :disabled="holdOpen || state.popupOpen.value"
        :aria-label="t('remoteDesktop.hideToolbar')"
        :title="t('remoteDesktop.hideToolbar')"
        @click="collapse"
      ><ChevronUp :size="16" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, Pin, PinOff } from '@lucide/vue'
import { useI18n } from '../i18n'
import { useFullscreenToolbar } from '../composables/useFullscreenToolbar'

const props = withDefaults(defineProps<{ active?: boolean; holdOpen?: boolean }>(), { active: true, holdOpen: false })
const emit = defineEmits<{ interaction: []; 'focus-desktop': [] }>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const state = useFullscreenToolbar(() => props.active, () => props.holdOpen)
const remotePointers = new Set<number>()
let owner: Document | undefined
let observer: MutationObserver | undefined
let keyboardFocus = false
let disposed = false

function inside(target: EventTarget | null) { return !!(target && 'nodeType' in target && root.value?.contains(target as Node)) }
function stopLocal(event: Event) { if (props.active) event.stopPropagation() }
function interact() { if (props.active && !state.remoteGesture.value) emit('interaction') }
function stopAndInteract(event: Event) { stopLocal(event); interact() }
function stopContextMenu(event: Event) { if (props.active) { event.stopPropagation(); event.preventDefault() } }
function enterToolbar(event: PointerEvent) {
  if (!props.active || state.remoteGesture.value || event.buttons) return
  state.hovered.value = true
  state.show()
}
function leaveToolbar() { state.hovered.value = false; state.scheduleHide() }
function updateFocus() {
  const target = owner?.activeElement
  // A pointer-clicked plain button must not pin the bar indefinitely. Text
  // fields/comboboxes and keyboard navigation retain focus until the user leaves.
  state.focused.value = !!(target && content.value?.contains(target) &&
    (keyboardFocus || target.matches('input, textarea, select, [contenteditable="true"], [role="combobox"]')))
}
function focusIn() { if (props.active) { interact(); updateFocus(); state.show() } }
function focusOut() { void nextTick(() => { if (!disposed) updateFocus() }) }
function activateHandle(event: MouseEvent) {
  if (state.remoteGesture.value) return
  interact()
  state.show()
  // Move keyboard focus off the handle before it becomes hidden/inert.
  if (event.detail === 0) void nextTick(() => {
    owner?.defaultView?.requestAnimationFrame(() => {
      if (!disposed && state.visible.value) content.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
  })
}
function collapse() {
  if (state.hide()) {
    emit('focus-desktop')
  }
}
function pointerDown(event: PointerEvent) {
  keyboardFocus = false
  updateFocus()
  if (!props.active || inside(event.target)) return
  remotePointers.add(event.pointerId)
  state.remoteGesture.value = true
}
function pointerMove(event: PointerEvent) {
  if (!props.active || inside(event.target)) return
  if (event.buttons && event.pointerType !== 'touch') {
    remotePointers.add(event.pointerId)
    state.remoteGesture.value = true
  } else if (!event.buttons && event.pointerType !== 'touch') releasePointer(event)
}
function releasePointer(event: PointerEvent) {
  remotePointers.delete(event.pointerId)
  state.remoteGesture.value = remotePointers.size > 0
}
function resetPointers() { remotePointers.clear(); state.remoteGesture.value = false }
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Tab' || inside(event.target)) { keyboardFocus = true; updateFocus() }
}
function updatePopup() {
  if (!props.active || !content.value) { state.popupOpen.value = false; return }
  const candidates = content.value.querySelectorAll<HTMLElement>('[aria-expanded="true"], .el-popper, [role="dialog"], [role="menu"], [role="listbox"]')
  state.popupOpen.value = Array.from(candidates).some(node => node.getClientRects().length > 0 && owner?.defaultView?.getComputedStyle(node).visibility !== 'hidden')
}
watch(() => props.active, () => { resetPointers(); void nextTick(updatePopup) })
function unbindDocument() {
  owner?.removeEventListener('pointerdown', pointerDown, true)
  owner?.removeEventListener('pointermove', pointerMove, true)
  owner?.removeEventListener('pointerup', releasePointer, true)
  owner?.removeEventListener('pointercancel', releasePointer, true)
  owner?.removeEventListener('keydown', keyboard, true)
  owner?.defaultView?.removeEventListener('blur', resetPointers)
}
function bindDocument() {
  const nextOwner = root.value?.ownerDocument
  if (nextOwner === owner) return
  unbindDocument()
  resetPointers()
  owner = nextOwner
  owner?.addEventListener('pointerdown', pointerDown, true)
  owner?.addEventListener('pointermove', pointerMove, true)
  owner?.addEventListener('pointerup', releasePointer, true)
  owner?.addEventListener('pointercancel', releasePointer, true)
  owner?.addEventListener('keydown', keyboard, true)
  owner?.defaultView?.addEventListener('blur', resetPointers)
}
onMounted(() => {
  bindDocument()
  if (content.value) {
    observer = new MutationObserver(updatePopup)
    observer.observe(content.value, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-hidden', 'hidden', 'style', 'class'] })
    updatePopup()
  }
})
// Android can move the same component into a document PiP window via Teleport.
onUpdated(bindDocument)
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  unbindDocument()
})
</script>

<style scoped>
.fullscreen-toolbar-shell, .fullscreen-toolbar-content { display: contents; }
.fullscreen-toolbar-shell.is-active {
  position: absolute;
  display: block;
  top: 0;
  left: 50%;
  z-index: 21;
  width: var(--fullscreen-toolbar-width, min(36rem, 100%));
  transform: translateX(-50%);
  pointer-events: none;
  --wails-draggable: no-drag;
}
.is-active > .fullscreen-toolbar-content {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  padding: 0.25rem 0.5rem;
  box-sizing: border-box;
  border: 1px solid var(--border-default);
  border-top: 0;
  border-radius: 0 0 0.625rem 0.625rem;
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: 0 0.25rem 1rem #0006;
  pointer-events: auto;
  transform: translateY(0);
  transition: transform 160ms ease, visibility 0s;
}
.is-active > .fullscreen-toolbar-content.is-hidden {
  transform: translateY(-100%);
  visibility: hidden;
  pointer-events: none;
  transition: transform 160ms ease, visibility 0s 160ms;
}
.fullscreen-toolbar-handle {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  width: 64px;
  height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  pointer-events: auto;
  touch-action: manipulation;
}
.fullscreen-toolbar-handle-pill {
  display: flex;
  justify-content: center;
  width: 48px;
  height: 18px;
  border: 1px solid var(--border-default);
  border-top: 0;
  border-radius: 0 0 8px 8px;
  background: color-mix(in srgb, var(--bg-elevated) 82%, transparent);
}
.fullscreen-toolbar-handle:focus-visible .fullscreen-toolbar-handle-pill { outline: 2px solid var(--accent); }
.fullscreen-toolbar-handle.is-hidden { visibility: hidden; pointer-events: none; }
.fullscreen-toolbar-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1.875rem;
  height: 1.875rem;
  padding: 0;
  border: 0;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.fullscreen-toolbar-button:hover, .fullscreen-toolbar-button:focus-visible { background: var(--bg-hover); color: var(--text-primary); }
.fullscreen-toolbar-pin.is-pinned { color: var(--accent); background: var(--bg-hover); }
.fullscreen-toolbar-button:disabled { cursor: default; opacity: 0.45; }
/* Disable hit testing until the remote pointerup has reached its original
   target. This also covers a drag that crosses an already visible toolbar. */
.has-remote-gesture > .fullscreen-toolbar-content,
.has-remote-gesture > .fullscreen-toolbar-handle { pointer-events: none; }
@media (pointer: coarse) {
  .fullscreen-toolbar-button { min-width: 44px; min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .is-active > .fullscreen-toolbar-content,
  .is-active > .fullscreen-toolbar-content.is-hidden { transition: none; }
}
</style>
