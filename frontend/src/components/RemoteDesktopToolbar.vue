<template>
  <FullscreenToolbarShell
    class="remote-desktop-fullscreen-toolbar"
    :class="{ 'has-cursor-toggle': showDotCursor !== undefined, 'has-selects': selects }"
    :hold-open="holdOpen"
    @interaction="emit('interaction')"
    @focus-desktop="focusDesktop"
  >
    <span class="remote-desktop-toolbar-host" :title="`${host}:${port}`">
      {{ host }}:{{ port }}
    </span>
    <span class="remote-desktop-toolbar-divider" />
    <template v-if="resolution">
      <span class="remote-desktop-toolbar-resolution" :title="`${t('remoteDesktop.resolution')}: ${resolution}`">
        {{ resolution }}
      </span>
      <span class="remote-desktop-toolbar-divider" />
    </template>
    <slot name="displays" />
    <label class="remote-desktop-toolbar-scale">
      <RemoteDesktopZoomSelect
        :model-value="zoom"
        class="remote-desktop-toolbar-select"
        :compact="false"
        :teleported="false"
        :disabled="disabled"
        :allow-fit="allowFit"
        @update:model-value="value => { emit('update:zoom', value); focusDesktop() }"
      />
    </label>
    <slot name="after-zoom" />
    <template v-if="showDotCursor !== undefined">
      <span class="remote-desktop-toolbar-divider" />
      <label class="remote-desktop-toolbar-scale">
        <span>{{ t('vnc.showDotCursor') }}</span>
        <el-switch
          :model-value="showDotCursor"
          @update:model-value="emit('update:showDotCursor', $event)"
          inline-prompt
          :active-text="t('vnc.scaleOn')"
          :inactive-text="t('vnc.scaleOff')"
          :aria-label="t('vnc.showDotCursor')"
          :disabled="disabled"
          style="--el-switch-on-color: var(--success); --el-switch-off-color: var(--text-disabled)"
          @change="focusDesktop"
        />
      </label>
    </template>
    <span class="remote-desktop-toolbar-divider" />
    <button
      class="remote-desktop-toolbar-btn remote-desktop-toolbar-minimize"
      :aria-label="t('window.minimize')"
      :title="t('window.minimize')"
      @click="minimizeWindow"
    >
      <Minus :size="16" />
    </button>
    <button
      class="remote-desktop-toolbar-btn remote-desktop-toolbar-restore"
      :aria-label="t('remoteDesktop.exitFullscreen')"
      :title="t('remoteDesktop.exitFullscreen')"
      @click="emit('restore')"
    >
      <Copy :size="15" />
    </button>
  </FullscreenToolbarShell>
</template>

<script setup lang="ts">
import { Minus, Copy } from '@lucide/vue'
import { Window } from '@wailsio/runtime'
import { useI18n } from '../i18n'
import RemoteDesktopZoomSelect from './RemoteDesktopZoomSelect.vue'
import FullscreenToolbarShell from './FullscreenToolbarShell.vue'
import type { RdpZoom } from '../utils/rdpZoom'

const { t } = useI18n()
withDefaults(defineProps<{
  host: string
  port: number
  resolution?: string
  zoom: RdpZoom
  // Whether the fit ('自适应') zoom entry is offered; RDP adaptive
  // resolution already fills the pane, so it hides the entry.
  allowFit?: boolean
  // The RDP toolbar embeds three selects (resolution/quality/zoom); it gets
  // a wider, wrap-enabled layout so the labels never fold vertically.
  selects?: boolean
  showDotCursor?: boolean
  disabled: boolean
  holdOpen?: boolean
}>(), { showDotCursor: undefined, resolution: undefined, allowFit: true, selects: false, holdOpen: false })
const emit = defineEmits<{
  'update:zoom': [value: RdpZoom]
  'update:showDotCursor': [value: boolean]
  restore: []
  focusDesktop: []
  interaction: []
  minimize: []
  error: [error: unknown]
}>()

function focusDesktop() {
  emit('focusDesktop')
}

async function minimizeWindow() {
  emit('minimize')
  try {
    await Window.Minimise()
  } catch (e) {
    emit('error', e)
    focusDesktop()
  }
}

</script>

<style scoped>
.remote-desktop-fullscreen-toolbar.has-cursor-toggle {
  --fullscreen-toolbar-width: min(44rem, 100%);
}
/* RDP embeds three selects; retain enough space without resizing the canvas. */
.remote-desktop-fullscreen-toolbar.has-selects {
  --fullscreen-toolbar-width: min(52rem, 100%);
}
.remote-desktop-fullscreen-toolbar :deep(.rdp-status-label),
.remote-desktop-fullscreen-toolbar .remote-desktop-toolbar-scale > span {
  white-space: nowrap;
}
.remote-desktop-fullscreen-toolbar :deep(.rdp-status-sep) {
  color: var(--text-disabled);
}
.remote-desktop-toolbar-btn {
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
.remote-desktop-toolbar-btn:hover,
.remote-desktop-toolbar-btn:focus-visible {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.remote-desktop-toolbar-host {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font-size: 0.8125rem;
}
.remote-desktop-toolbar-divider {
  flex: none;
  width: 1px;
  height: 1rem;
  background: var(--border-default);
}
.remote-desktop-toolbar-resolution {
  flex: none;
  white-space: nowrap;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.remote-desktop-toolbar-scale {
  display: flex;
  align-items: center;
  flex: none;
  gap: 0.5rem;
  white-space: nowrap;
  font-size: 0.75rem;
}
/* Uniform metrics for every dropdown in the fullscreen toolbar. The popper
   must stay unteleported there: a body portal is invisible in fullscreen.
   Slot content (resolution/quality) belongs to the host's scope, so the
   selectors go through :deep from the toolbar root. */
.remote-desktop-fullscreen-toolbar :deep(.remote-desktop-toolbar-select) {
  width: 5.5rem;
  flex: none;
}
.remote-desktop-fullscreen-toolbar :deep(.remote-desktop-toolbar-select .el-select__wrapper) {
  min-height: 1.5rem;
  height: 1.5rem;
  font-size: 0.75rem;
}
</style>
