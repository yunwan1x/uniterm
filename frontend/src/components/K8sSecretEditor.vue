<template>
  <section class="secret-editor">
    <div class="secret-actions">
      <strong>Secret Data</strong>
      <el-button size="small" :disabled="saving" @click="toggle">{{ revealed ? t('secret.hide') : t('secret.decode') }}</el-button>
      <el-button v-if="revealed" size="small" type="primary" :disabled="!dirty || !!target.immutable" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
    </div>
    <template v-if="revealed">
      <p v-if="target.immutable">{{ t('secret.immutable') }}</p>
      <p v-if="!entries.length">{{ t('secret.empty') }}</p>
      <label v-for="entry in entries" :key="entry.key" class="secret-field">
        <strong>{{ entry.key }}</strong>
        <span v-if="entry.binary">{{ t('secret.binary') }}</span>
        <textarea v-else v-model="entry.text" :aria-label="entry.key" :readonly="!!target.immutable || saving" :wrap="wrap ? 'soft' : 'off'" spellcheck="false" autocomplete="off" autocapitalize="off" :style="{whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal'}" />
      </label>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="saved" role="status">{{ t('secret.saved') }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { ElButton } from 'element-plus'
import { decodeSecret, secretPatch, type SecretEntry } from '../services/k8sSecret'
import { requestJSON } from '../services/k8sClient'
import { useI18n } from '../i18n'
import { usePanelWrap } from '../composables/usePanelWrap'
const props = defineProps<{ target: any; connId: string }>()
const emit = defineEmits<{ saved: [target: any] }>()
const { t } = useI18n()
const wrap = usePanelWrap()
const entries = ref<SecretEntry[]>([])
const revealed = ref(false), saving = ref(false), saved = ref(false), error = ref('')
let generation = 0
onBeforeUnmount(() => { generation++; entries.value = [] })
watch(() => [props.target, props.connId], () => { generation++; entries.value = []; revealed.value = false; error.value = ''; saved.value = false; saving.value = false })
const dirty = computed(() => entries.value.some(e => !e.binary && e.text !== decodeSecret({[e.key]: e.original})[0].text))
function toggle() {
  revealed.value = !revealed.value
  entries.value = revealed.value ? decodeSecret(props.target.data) : []
  error.value = ''; saved.value = false
}
async function save() {
  const current = ++generation
  saving.value = true; error.value = ''; saved.value = false
  try {
    const target = props.target
    const patch = secretPatch(target, entries.value)
    const path = `/api/v1/namespaces/${encodeURIComponent(target.metadata.namespace)}/secrets/${encodeURIComponent(target.metadata.name)}`
    const result = await requestJSON(props.connId, 'PATCH', path, patch, 'application/merge-patch+json')
    if (current !== generation) return
    if (result.status === 409) throw Error(t('secret.conflict'))
    if (result.status < 200 || result.status >= 300) throw Error(`HTTP ${result.status}: ${result.data?.message || t('secret.failed')}`)
    if (!result.data?.metadata?.resourceVersion) throw Error(t('secret.failed'))
    entries.value = []; revealed.value = false; saved.value = true
    emit('saved', result.data)
  } catch (e: any) { if (current === generation) error.value = String(e?.message || e) }
  finally { if (current === generation) saving.value = false }
}
</script>
<style scoped>
.secret-editor { margin: .75rem 0; }
.secret-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
.secret-field { display: flex; flex-direction: column; gap: .35rem; margin: .75rem 0; }
textarea { box-sizing: border-box; width: 100%; min-height: 6rem; resize: vertical; overflow: auto; background: var(--el-fill-color-blank); color: var(--el-text-color-primary); border: 1px solid var(--el-border-color); border-radius: 4px; padding: .5rem; font: inherit; }
[role=alert] { color: var(--el-color-danger); }
</style>
