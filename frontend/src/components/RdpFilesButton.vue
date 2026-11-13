<template>
  <button class="rdp-files-trigger" :class="{ active: open }" :disabled="disabled" :aria-expanded="open" :aria-label="t('rdp.files.button')" @click="$emit('toggle')">
    <Folder :size="15" /> {{ t('rdp.files.button') }} <span v-if="count" class="count">{{ count }}</span>
  </button>
</template>
<script setup lang="ts">
import { Folder } from '@lucide/vue'
import { useI18n } from '../i18n'
defineProps<{ open: boolean; disabled: boolean; count: number }>()
defineEmits<{ toggle: [] }>()
const { t } = useI18n()
</script>
<style scoped>
.rdp-files-trigger { display: inline-flex; align-items: center; gap: 5px; color: var(--text-primary); background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 5px; cursor: pointer; padding: 3px 7px; font: inherit; white-space: nowrap; }
.rdp-files-trigger.active { color: var(--accent); border-color: var(--accent); }
.rdp-files-trigger:disabled { opacity: .5; cursor: default; }
.count { border-radius: 9px; background: var(--accent); color: var(--on-accent); padding: 0 5px; font-size: 11px; }
</style>
