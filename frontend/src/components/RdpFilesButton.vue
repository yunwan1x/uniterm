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
.rdp-files-trigger { display: inline-flex; align-items: center; gap: 5px; color: var(--text-primary); background: var(--bg-secondary); border: 1px solid var(--el-border-color); border-radius: 5px; cursor: pointer; padding: 3px 7px; font: inherit; white-space: nowrap; }
.rdp-files-trigger.active { color: var(--el-color-primary); border-color: var(--el-color-primary); }
.rdp-files-trigger:disabled { opacity: .5; cursor: default; }
.count { border-radius: 9px; background: var(--el-color-primary); color: white; padding: 0 5px; font-size: 11px; }
</style>
