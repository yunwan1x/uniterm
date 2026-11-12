<template>
  <section class="rdp-files-panel" role="region" :aria-label="t('rdp.files.title')" @pointerdown.stop="$emit('release')" @mousedown.stop @wheel.stop @keydown.stop @keyup.stop @paste.stop @focusin.stop @focusout.stop>
    <header><span><Folder :size="18" /> {{ t('rdp.files.title') }}</span><button :aria-label="t('rdp.files.close')" @click="$emit('close')"><X :size="18" /></button></header>
    <nav :aria-label="t('rdp.files.direction')">
      <button :class="{ selected: tab === 'upload' }" :aria-pressed="tab === 'upload'" @click="tab = 'upload'"><Upload :size="15" /> {{ t('rdp.files.upload') }}</button>
      <button :class="{ selected: tab === 'download' }" :aria-pressed="tab === 'download'" @click="tab = 'download'"><Download :size="15" /> {{ t('rdp.files.download') }} <b v-if="remote.length">{{ remote.length }}</b></button>
    </nav>
    <div class="files-body">
      <template v-if="tab === 'upload'">
        <input ref="input" class="file-input" type="file" multiple :disabled="!ready || uploadBusy" @change="chosen" />
        <button class="file-drop" :class="{ dragging }" :disabled="!ready || uploadBusy" @click="input?.click()" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="dropped"><Upload :size="25" /><span>{{ t('rdp.files.choose') }}</span></button>
        <p class="file-hint">{{ t(uploadBusy ? 'rdp.files.pasteHint' : 'rdp.files.uploadHint') }}</p>
      </template>
      <template v-else>
        <p class="file-hint">{{ t('rdp.files.copyHint') }}</p>
        <div v-if="!remote.length" class="file-empty"><Copy :size="28" /><span>{{ t('rdp.files.emptyRemote') }}</span></div>
        <label v-for="file in remote" :key="file.index" class="remote-file" :class="{ unsupported: file.isDirectory }">
          <input v-model="selected" type="checkbox" :value="file.index" :disabled="!ready || file.isDirectory" /><File :size="17" /><span class="file-name" :title="file.name">{{ file.name }}</span><small>{{ file.isDirectory ? t('rdp.files.folderUnsupported') : bytes(file.size) }}</small>
        </label>
        <button v-if="remote.length" class="download-selected" :disabled="!ready || !selected.length" @click="$emit('download', selected.slice())"><Download :size="15" /> {{ t('rdp.files.saveSelected') }} ({{ selected.length }})</button>
        <p class="file-note">{{ t('rdp.files.downloadLimit') }}</p>
      </template>
      <p v-if="!ready" class="file-error" role="status">{{ t(connected ? 'rdp.files.waitChannel' : 'rdp.files.disconnected') }}</p>
      <p v-if="error || localError" class="file-error" role="alert">{{ t(`rdp.files.error.${localError || error}`) }}</p>
      <div v-if="tasks.length" class="task-heading"><span>{{ t('rdp.files.tasks') }}</span><button @click="$emit('clear')">{{ t('rdp.files.clear') }}</button></div>
      <div v-for="task in tasks" :key="task.id" class="file-task" :data-task-id="task.id" :data-state="task.state">
        <component :is="task.direction === 'upload' ? Upload : Download" :size="16" class="direction-icon" />
        <div class="task-main"><div class="file-name" :title="task.name">{{ task.name }}</div><div class="task-meta"><span>{{ bytes(task.done) }} / {{ bytes(task.size) }}</span><span :class="task.state">{{ t(`rdp.files.state.${task.state}`) }}</span></div>
          <progress v-if="task.state === 'transferring'" :value="task.done" :max="task.size || 1" :aria-label="task.name" />
          <small v-if="task.error" class="file-error">{{ t(`rdp.files.error.${task.error}`) }}</small>
        </div>
        <button v-if="['preparing', 'ready', 'queued', 'transferring'].includes(task.state)" :aria-label="`${t('rdp.files.cancel')} ${task.name}`" @click="$emit('cancel', task.id)"><X :size="16" /></button>
        <button v-else-if="['failed', 'cancelled'].includes(task.state) && task.retryable" class="retry" :disabled="!ready" @click="$emit('retry', task.id)">{{ t('rdp.files.retry') }}</button>
        <Check v-else-if="task.state === 'completed'" :size="17" class="completed" />
      </div>
    </div>
    <footer>{{ t('rdp.files.keepRunning') }}</footer>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder, File, Upload, Download, Copy, X, Check } from '@lucide/vue'
import { useI18n } from '../i18n'
import type { FileTask, RemoteOffer } from '../utils/rdpBrowserFiles'
const props = defineProps<{ ready: boolean; connected: boolean; tasks: FileTask[]; remote: RemoteOffer[]; error: string }>()
const emit = defineEmits<{ close: []; release: []; select: [files: globalThis.File[]]; download: [indices: number[]]; cancel: [id: string]; retry: [id: string]; clear: [] }>()
const { t } = useI18n()
const tab = ref<'upload' | 'download'>('upload'), input = ref<HTMLInputElement>(), selected = ref<number[]>([]), dragging = ref(false), localError = ref('')
const uploadBusy = computed(() => props.tasks.some(t => t.direction === 'upload' && ['preparing', 'ready', 'transferring'].includes(t.state)))
watch(() => props.remote, files => { selected.value = files.filter(f => !f.isDirectory).map(f => f.index) })
function chosen(e: Event) { const target = e.target as HTMLInputElement; localError.value = ''; if (target.files?.length) emit('select', [...target.files]); target.value = '' }
function dropped(e: DragEvent) {
  dragging.value = false
  if (!props.ready || uploadBusy.value) return
  if ([...e.dataTransfer?.items ?? []].some(item => item.webkitGetAsEntry?.()?.isDirectory)) { localError.value = 'folders'; return }
  localError.value = ''; const files = [...e.dataTransfer?.files ?? []]; if (files.length) emit('select', files)
}
function bytes(value: number) { if (!value) return '0 B'; const i = Math.min(3, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][i]}` }
</script>
<style scoped>
.rdp-files-panel { position: absolute; z-index: 30; bottom: 44px; right: 12px; width: min(420px, calc(100% - 24px)); max-height: calc(100% - 72px); display: flex; flex-direction: column; background: var(--bg-secondary, #20252c); color: var(--text-primary); border: 1px solid var(--el-border-color); border-radius: 12px; box-shadow: 0 8px 30px #0006; font-size: 13px; }
header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px 8px; font-size: 15px; font-weight: 600; }
header span, nav button, .download-selected { display: flex; align-items: center; justify-content: center; gap: 7px; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; border-radius: 5px; padding: 5px; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible { outline: 2px solid var(--el-color-primary); }
nav { display: flex; gap: 4px; padding: 6px 12px 10px; }
nav button { flex: 1; padding: 9px 6px; background: var(--bg-primary); border: 1px solid var(--el-border-color); }
nav button.selected, .download-selected { background: var(--el-color-primary); color: white; }
nav b { font-size: 11px; }
.files-body { overflow: auto; min-height: 0; padding: 0 16px 12px; }
.file-input { display: none; }
.file-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 90px; border: 1px dashed var(--el-border-color); margin-top: 4px; }
.file-drop.dragging, .file-drop:not(:disabled):hover { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.file-hint { padding: 9px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); border-radius: 6px; line-height: 1.6; }
.file-note, footer { color: var(--text-secondary); font-size: 11px; line-height: 1.5; }
footer { padding: 10px 16px; border-top: 1px solid var(--el-border-color); }
.file-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 22px 8px; color: var(--text-secondary); }
.remote-file, .file-task { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color); }
.remote-file .file-name { flex: 1; }.remote-file input { accent-color: var(--el-color-primary); }.unsupported { opacity: .6; }
.file-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }.task-main { min-width: 0; flex: 1; }
.task-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 5px; font-size: 11px; color: var(--text-secondary); }
progress { display: block; width: 100%; height: 5px; margin-top: 7px; accent-color: var(--el-color-primary); }
.completed { color: var(--el-color-success); }.failed, .file-error { color: var(--el-color-warning); }.file-error { line-height: 1.5; }
.download-selected { width: 100%; margin-top: 12px; padding: 9px; }.retry { color: var(--el-color-primary); border: 1px solid var(--el-color-primary); font-size: 11px; }
.task-heading { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; color: var(--text-secondary); font-size: 12px; }
@media (max-height: 480px) { .rdp-files-panel { bottom: 36px; max-height: calc(100% - 44px); } .file-drop { min-height: 55px; } }
</style>
