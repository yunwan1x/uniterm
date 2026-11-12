<template>
  <el-popover placement="top-end" :width="290" trigger="click" :teleported="false" :disabled="disabled" @show="releaseRemoteKeyboardFocus">
    <template #reference><button class="rdp-devices-trigger" :disabled="disabled">{{ t('rdp.devices') }}<span v-if="microphone || camera" class="device-dot"> ●</span></button></template>
    <div class="rdp-devices" @keydown.stop @keyup.stop>
      <p>{{ t('rdp.devicesHint') }}</p>
      <button v-for="kind in (['microphone', 'camera'] as const)" :key="kind" :disabled="busy" :aria-pressed="kind === 'microphone' ? microphone : camera" @click="emit('toggle', kind)">
        {{ t(`rdp.${kind}`) }} · {{ t((kind === 'microphone' ? microphone : camera) ? 'rdp.deviceOn' : 'rdp.deviceOff') }}
      </button>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
  </el-popover>
</template>
<script setup lang="ts">
import { useI18n } from '../i18n'
import { releaseRemoteKeyboardFocus } from '../utils/remoteKeyboard'
import type { CaptureKind } from '../utils/rdpCapture'
defineProps<{ microphone: boolean; camera: boolean; busy: boolean; disabled: boolean; error: string }>()
const emit = defineEmits<{ toggle: [kind: CaptureKind] }>()
const { t } = useI18n()
</script>
<style scoped>
.rdp-devices-trigger, .rdp-devices button { color: var(--text-primary); background: var(--bg-secondary); border: 1px solid var(--el-border-color); border-radius: 4px; padding: 2px 6px; font: inherit; white-space: nowrap; cursor: pointer; }
.rdp-devices { display: grid; gap: 8px; }
.rdp-devices p { margin: 0; font-size: 12px; color: var(--text-secondary); }
.rdp-devices button[aria-pressed=true], .device-dot { color: var(--el-color-success); }
.rdp-devices button:disabled { opacity: .5; }
</style>
