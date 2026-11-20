<template>
  <div ref="element" class="display-performance">
    <span>{{ rates.fps }} FPS</span><span>↓ {{ rates.bitrate }}</span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { displayRates, type DisplayCounters } from '../utils/displayPerformance'

const props = defineProps<{ read: () => DisplayCounters | undefined }>()
const element = ref<HTMLElement>()
const empty = { fps: '—', bitrate: '—' }
const rates = ref(empty)
let previous: DisplayCounters | undefined
let stop: (() => void) | undefined

onMounted(() => {
  const node = element.value!
  const doc = node.ownerDocument
  const win = doc.defaultView!
  let timer: number | undefined
  let baselineAt = 0
  let visible = true
  function sample() {
    const snapshot = props.read()
    const current = snapshot && snapshot.at >= baselineAt && performance.now() - snapshot.at < 3000 ? snapshot : undefined
    if (current && previous && current.at === previous.at) return
    rates.value = current ? displayRates(previous, current) : empty
    previous = current
  }
  function reset() {
    win.clearInterval(timer)
    rates.value = empty
    previous = undefined
    baselineAt = performance.now()
    if (visible && !doc.hidden) {
      sample()
      timer = win.setInterval(sample, 1000)
    }
  }
  const observer = new IntersectionObserver(entries => {
    const next = entries[entries.length - 1]!.isIntersecting
    if (next !== visible) { visible = next; reset() }
  })
  observer.observe(node)
  doc.addEventListener('visibilitychange', reset)
  reset()
  stop = () => {
    win.clearInterval(timer)
    doc.removeEventListener('visibilitychange', reset)
    observer.disconnect()
  }
})
onBeforeUnmount(() => stop?.())
</script>

<style scoped>
.display-performance {
  position: absolute;
  inset: 10px auto auto 10px;
  z-index: 2;
  display: flex;
  gap: 1ch;
  padding: 4px 7px;
  border-radius: 4px;
  background: rgb(15 18 22 / 78%);
  color: white;
  font: 12px/1.35 ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
}
</style>
