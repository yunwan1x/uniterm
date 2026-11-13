<template>
  <button class="rdp-keys-trigger" :class="{ active: open }" :disabled="disabled" :aria-label="t('rdp.keys')" :aria-expanded="open" :aria-pressed="open" @click="emit('toggle')">
    <Keyboard :size="15" /> {{ t('rdp.keys') }}
  </button>
</template>
<script setup lang="ts">
import { Keyboard } from '@lucide/vue'
import { useI18n } from '../i18n'
defineProps<{ disabled?: boolean; open?: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
</script>
<style scoped>
.rdp-keys-trigger { display: inline-flex; align-items: center; gap: 5px; color: var(--text-primary); background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 5px; cursor: pointer; padding: 3px 7px; font: inherit; white-space: nowrap; }
.rdp-keys-trigger.active { color: var(--accent); border-color: var(--accent); }
.rdp-keys-trigger:disabled { opacity: .5; cursor: default; }
</style>
