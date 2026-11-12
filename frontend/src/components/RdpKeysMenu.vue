<template>
  <el-popover placement="top-end" :width="320" trigger="click" :teleported="false" :disabled="disabled" @show="releaseRemoteKeyboardFocus">
    <template #reference><button class="rdp-keys-trigger" :disabled="disabled">{{ t('rdp.keys') }}</button></template>
    <div class="rdp-keys-grid" @keydown.stop @keyup.stop>
      <button v-for="key in RDP_QUICK_KEYS" :key="key.label" @click="emit('send', key.codes)">{{ key.label }}</button>
    </div>
  </el-popover>
</template>
<script setup lang="ts">
import { useI18n } from '../i18n'
import { RDP_QUICK_KEYS } from '../utils/rdpKeys'
import { releaseRemoteKeyboardFocus } from '../utils/remoteKeyboard'
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ send: [codes: string[]] }>()
const { t } = useI18n()
</script>
<style scoped>
.rdp-keys-trigger, .rdp-keys-grid button { color: var(--text-primary); background: var(--bg-secondary); border: 1px solid var(--el-border-color); border-radius: 4px; cursor: pointer; padding: 2px 6px; font: inherit; white-space: nowrap; }
.rdp-keys-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.rdp-keys-grid button:hover { background: var(--el-fill-color); }
.rdp-keys-trigger:disabled { opacity: .5; cursor: default; }
</style>
