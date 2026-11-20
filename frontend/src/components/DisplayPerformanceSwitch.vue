<template>
  <button type="button" class="display-performance-switch" role="switch"
    :aria-checked="enabled" :aria-label="t('remoteDesktop.performance')" :title="hint"
    @click.stop="$emit('toggle')">
    <Activity :size="15" aria-hidden="true" /><span v-if="!compact">{{ t('remoteDesktop.performance') }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Activity } from '@lucide/vue'
import { useI18n } from '../i18n'
const props = defineProps<{ enabled: boolean; video?: boolean; compact?: boolean }>()
defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const hint = computed(() => t(props.video ? 'remoteDesktop.videoRates' : 'remoteDesktop.sessionRates'))
</script>

<style scoped>
.display-performance-switch {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  flex: none; padding: 3px 6px; cursor: pointer; white-space: nowrap;
  border: 1px solid var(--border-subtle); border-radius: 4px;
  background: var(--bg-surface); color: var(--text-secondary); font: inherit;
}
.display-performance-switch[aria-checked="true"] { color: var(--accent); border-color: currentColor; }
@container (max-width: 760px) { .display-performance-switch span { display: none; } }
@media (max-width: 760px) { .display-performance-switch span { display: none; } }
</style>
