<template>
  <div ref="bounds" class="floating-keyboard-bounds">
    <section ref="panel" class="floating-keyboard" :class="{ expanded, dragging }" :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      :aria-label="t('rdp.floatingKeyboard')" :aria-disabled="disabled" @pointerdown.stop="emit('release')" @mousedown.stop @wheel.stop @contextmenu.prevent @keydown.stop="onLocalKey" @keyup.stop @focusin.stop @focusout.stop>
      <header class="keyboard-header" @pointerdown="startHeaderDrag" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag">
        <button class="keyboard-drag" :aria-label="t('rdp.keyboardMove')" :title="t('rdp.keyboardMove')" @pointerdown.prevent="startDrag" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag" @keydown="moveWithKeys"><GripVertical :size="18" /></button>
        <Keyboard :size="17" class="keyboard-icon" />
        <span v-if="expanded" class="keyboard-title">{{ t('rdp.floatingKeyboard') }}</span>
        <div v-else class="compact-keys">
          <button v-for="key in compactKeys" :key="key.code" class="keycap" :class="{ selected: modifiers[key.code as Modifier], locked: modifiers[key.code as Modifier] === 'locked' }"
            :disabled="disabled" :aria-label="key.label" :aria-pressed="isModifier(key.code) ? !!modifiers[key.code as Modifier] : undefined"
            :title="isModifier(key.code) ? t('rdp.keyboardModifierHint') : key.label"
            @pointerdown="startHold($event, key.code)" @pointerup="finishHold" @pointercancel="cancelHold" @pointerleave="cancelHold" @click="press(key.code)">
            {{ key.label }}<Lock v-if="modifiers[key.code as Modifier] === 'locked'" :size="10" />
          </button>
          <span class="keyboard-divider" />
          <button v-for="key in FLOATING_SHORTCUTS.slice(0, 5)" :key="key.label" class="keycap shortcut" :disabled="disabled" @click="shortcut(key.codes)">{{ key.label }}</button>
        </div>
        <button class="keyboard-action" :aria-label="expanded ? t('rdp.keyboardCollapse') : t('rdp.keyboardExpand')" :title="expanded ? t('rdp.keyboardCollapse') : t('rdp.keyboardExpand')" :aria-expanded="expanded" @click="toggleExpanded"><ChevronDown v-if="expanded" :size="17" /><ChevronUp v-else :size="17" /></button>
        <button class="keyboard-action" :aria-label="t('rdp.keyboardClose')" :title="t('rdp.keyboardClose')" @click="close"><X :size="16" /></button>
      </header>
      <div v-if="expanded" class="keyboard-body">
        <div class="keyboard-shortcuts"><button v-for="key in FLOATING_SHORTCUTS" :key="key.label" class="keycap shortcut" :disabled="disabled" @click="shortcut(key.codes)">{{ key.label }}</button></div>
        <div class="keyboard-layout">
          <div v-for="(row, rowIndex) in KEYBOARD_ROWS" :key="rowIndex" class="keyboard-row">
            <button v-for="(key, index) in row" :key="index" class="keycap" :style="{ flexGrow: key.grow || 1 }"
              :class="{ selected: modifiers[key.code as Modifier], locked: modifiers[key.code as Modifier] === 'locked' }" :disabled="disabled"
              :aria-label="key.label" :aria-pressed="isModifier(key.code) ? !!modifiers[key.code as Modifier] : undefined"
              :title="isModifier(key.code) ? t('rdp.keyboardModifierHint') : key.code"
              @pointerdown="startHold($event, key.code)" @pointerup="finishHold" @pointercancel="cancelHold" @pointerleave="cancelHold" @click="press(key.code)">
              {{ key.label }}<Lock v-if="modifiers[key.code as Modifier] === 'locked'" :size="10" />
            </button>
          </div>
        </div>
        <footer>{{ t('rdp.keyboardModifierHint') }}</footer>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { Keyboard, GripVertical, ChevronUp, ChevronDown, X, Lock } from '@lucide/vue'
import { useI18n } from '../i18n'
import { MODIFIERS, KEYBOARD_ROWS, FLOATING_SHORTCUTS, toggleModifier, consumeKey, clampKeyboard, type Modifier, type ModifierState } from '../utils/floatingKeyboard'
const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ send: [codes: string[]]; release: []; close: [] }>()
const { t } = useI18n()
const bounds = ref<HTMLElement>(), panel = ref<HTMLElement>()
const expanded = ref(false), dragging = ref(false), modifiers = ref<ModifierState>({})
const position = ref({ x: 0, y: 0 })
const compactKeys = [{ label: 'Esc', code: 'Escape' }, { label: 'Tab', code: 'Tab' }, { label: 'Ctrl', code: 'ControlLeft' }, { label: 'Alt', code: 'AltLeft' }, { label: 'Shift', code: 'ShiftLeft' }, { label: 'Win', code: 'MetaLeft' }]
const storageKey = 'uniterm.rdp.floatingKeyboard.position.v1'
let anchor = { x: .5, y: .94 }
let observer: ResizeObserver | undefined
let holdTimer: ReturnType<typeof setTimeout> | undefined
let holdCode: string | undefined
let drag: { id: number; x: number; y: number; left: number; top: number; target: HTMLElement } | undefined
function isModifier(code: string): code is Modifier { return (MODIFIERS as readonly string[]).includes(code) }
function cancelHold() { clearTimeout(holdTimer); holdTimer = undefined; holdCode = undefined }
function finishHold() { clearTimeout(holdTimer); holdTimer = undefined }
function startHold(event: PointerEvent, code: string) {
  cancelHold()
  if (props.disabled || !isModifier(code) || event.button !== 0) return
  holdTimer = setTimeout(() => { modifiers.value = toggleModifier(modifiers.value, code, true); holdCode = code }, 500)
}
function press(code: string) {
  if (props.disabled) return
  if (holdCode === code) { cancelHold(); return }
  cancelHold()
  if (isModifier(code)) modifiers.value = toggleModifier(modifiers.value, code)
  else { const next = consumeKey(modifiers.value, code); modifiers.value = next.state; emit('send', next.codes) }
}
function shortcut(codes: string[]) { if (!props.disabled) { reset(); emit('send', codes) } }
function reset() { cancelHold(); modifiers.value = {}; emit('release') }
function toggleExpanded() { reset(); expanded.value = !expanded.value; nextTick(place) }
function close() { reset(); emit('close') }
function sizes() { return { w: bounds.value?.clientWidth || 0, h: bounds.value?.clientHeight || 0, pw: panel.value?.offsetWidth || 0, ph: panel.value?.offsetHeight || 0 } }
function place() { const { w,h,pw,ph } = sizes(); position.value = clampKeyboard(anchor.x * Math.max(0,w-pw), anchor.y * Math.max(0,h-ph), w,h,pw,ph) }
function remember() {
  const { w,h,pw,ph } = sizes()
  anchor = { x: w > pw ? position.value.x/(w-pw) : anchor.x, y: h > ph ? position.value.y/(h-ph) : anchor.y }
  try { localStorage.setItem(storageKey, JSON.stringify(anchor)) } catch { /* Storage may be disabled. */ }
}
function onLocalKey(e: KeyboardEvent) { if (e.code === 'Escape') { e.preventDefault(); close() } }
function startHeaderDrag(e: PointerEvent) {
  if (!(e.target as HTMLElement).closest('button')) { e.preventDefault(); startDrag(e) }
}
function startDrag(e: PointerEvent) {
  if (e.button !== 0) return
  cancelHold(); emit('release')
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  drag = { id:e.pointerId, x:e.clientX, y:e.clientY, left:position.value.x, top:position.value.y, target }; dragging.value = true
}
function moveDrag(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  const { w,h,pw,ph } = sizes(); position.value = clampKeyboard(drag.left+e.clientX-drag.x, drag.top+e.clientY-drag.y, w,h,pw,ph)
}
function stopDrag() {
  if (!drag) return
  const previous = drag; drag = undefined; dragging.value = false
  if (previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
  remember()
}
function moveWithKeys(e: KeyboardEvent) {
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) return
  e.preventDefault(); const { w,h,pw,ph } = sizes()
  position.value = clampKeyboard(position.value.x+(e.code === 'ArrowRight' ? 16 : e.code === 'ArrowLeft' ? -16 : 0), position.value.y+(e.code === 'ArrowDown' ? 16 : e.code === 'ArrowUp' ? -16 : 0), w,h,pw,ph); remember()
}
function onBlur() { stopDrag(); reset() }
function visibility() { if (document.hidden) onBlur() }
watch(() => props.disabled, value => { if (value) onBlur() })
onMounted(() => {
  try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (saved && [saved.x,saved.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) anchor = saved } catch { /* Ignore invalid storage. */ }
  observer = new ResizeObserver(() => { if (!bounds.value?.clientWidth) onBlur(); else if (!dragging.value) place() })
  if (bounds.value) observer.observe(bounds.value)
  if (panel.value) observer.observe(panel.value)
  place(); window.addEventListener('blur', onBlur); document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => { observer?.disconnect(); stopDrag(); reset(); window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', visibility) })
</script>
<style scoped>
.floating-keyboard-bounds { position: absolute; inset: 0 0 38px; pointer-events: none; z-index: 25; overflow: hidden; }
.floating-keyboard { position: absolute; pointer-events: auto; width: max-content; max-width: calc(100% - 16px); box-sizing: border-box; color: var(--text-primary, #e7eaf0); background: var(--bg-secondary, #23262c); border: 1px solid var(--el-border-color, #484d58); border-radius: 14px; box-shadow: 0 12px 40px #0005, 0 2px 8px #0003; user-select: none; }
.floating-keyboard.expanded { width: 880px; }
.keyboard-header { touch-action: none; display: flex; align-items: center; gap: 7px; padding: 8px; min-width: 0; }
.keyboard-title { flex: 1; font-size: 13px; font-weight: 600; }
.keyboard-icon { flex-shrink: 0; color: var(--text-secondary); }
.keyboard-drag, .keyboard-action { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 30px; border: 0; border-radius: 6px; color: var(--text-secondary); background: transparent; cursor: pointer; }
.keyboard-drag { cursor: grab; touch-action: none; }
.dragging .keyboard-drag { cursor: grabbing; }
.keyboard-action:hover, .keyboard-drag:hover { background: var(--el-fill-color); color: var(--text-primary); }
.compact-keys { display: flex; align-items: center; gap: 5px; overflow-x: auto; min-width: 0; scrollbar-width: thin; }
.keycap { display: inline-flex; align-items: center; justify-content: center; gap: 3px; min-width: 32px; height: 32px; padding: 0 9px; color: inherit; background: var(--el-fill-color, #343941); border: 1px solid var(--el-border-color, #484d58); border-radius: 7px; line-height: 1.2; font-family: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; box-shadow: 0 1px 1px #0002; touch-action: manipulation; }
.keycap:hover:not(:disabled) { border-color: var(--el-color-primary, #4c9ffe); }
.keycap:active:not(:disabled) { transform: translateY(1px); }
.keycap.selected { color: var(--el-color-primary, #4c9ffe); background: var(--el-color-primary-light-9, #20354c); border-color: var(--el-color-primary, #4c9ffe); }
.keycap.locked { background: var(--el-color-primary, #4c9ffe); color: white; }
.keycap:disabled { opacity: .4; cursor: default; }
button:focus-visible { outline: 2px solid var(--el-color-primary, #4c9ffe); outline-offset: 2px; }
.keyboard-divider { height: 20px; border-left: 1px solid var(--el-border-color); margin: 0 4px; }
.keyboard-body { padding: 0 12px 10px; max-height: min(380px, 65vh); overflow: auto; scrollbar-width: thin; }
.keyboard-shortcuts { display: flex; gap: 6px; padding: 4px 0 12px; overflow-x: auto; }
.shortcut { flex-shrink: 0; }
.keyboard-layout { min-width: 650px; }
.keyboard-row { display: flex; gap: 5px; margin-bottom: 5px; }
.keyboard-row .keycap { flex: 1 1 0; min-width: 0; padding: 0 4px; height: 36px; }
footer { color: var(--text-secondary); font-size: 11px; padding-top: 5px; }
@media (pointer: coarse) { .keycap { min-height: 40px; } .keyboard-action, .keyboard-drag { min-width: 36px; min-height: 40px; } }
</style>
