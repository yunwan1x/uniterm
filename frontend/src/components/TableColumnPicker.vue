<template>
  <div class="table-column-toolbar" @click.stop @keydown.stop @mousedown.stop>
    <el-popover v-model:visible="open" trigger="click" placement="bottom-end" :width="280" @after-leave="search = ''">
      <template #reference>
        <el-button size="small" :aria-label="t('tableColumns.show')" :aria-expanded="open">
          <Columns3 :size="14" /><span>{{ t('tableColumns.show') }}</span>
          <span v-if="hiddenCount" class="column-count">{{ shownCount }}/{{ columns.length }}</span>
        </el-button>
      </template>
      <div class="column-picker" @keydown.esc.stop.prevent="open = false">
        <div class="column-picker-heading"><strong>{{ t('tableColumns.show') }}</strong><el-button link size="small" @click="resetColumns(tableKey)">{{ t('tableColumns.reset') }}</el-button></div>
        <el-input v-if="columns.length > 8" v-model="search" size="small" clearable :placeholder="t('tableColumns.search')" :aria-label="t('tableColumns.search')" />
        <div class="column-picker-list">
          <el-checkbox v-for="col in filtered" :key="col.key" :model-value="col.required || columnIsVisible(tableKey, col.key)" :disabled="col.required" @change="value => setColumnVisible(tableKey, col.key, !!value)">
            <span :title="col.label">{{ col.label }}</span><small v-if="col.required"> {{ t('tableColumns.required') }}</small>
          </el-checkbox>
          <span v-if="!filtered.length" class="column-picker-note">{{ t('tableColumns.noMatch') }}</span>
        </div>
        <div class="column-picker-note">{{ t('tableColumns.saved') }}</div>
      </div>
    </el-popover>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElPopover, ElCheckbox, ElInput } from 'element-plus'
import { Columns3 } from '@lucide/vue'
import { useI18n } from '../i18n'
import { columnIsVisible, hiddenColumns, resetColumns, setColumnVisible, type TableColumnOption } from '../composables/useTableColumns'
const props = defineProps<{ tableKey: string; columns: TableColumnOption[] }>()
const emit = defineEmits<{ change: [] }>()
const { t } = useI18n()
const open = ref(false)
const search = ref('')
const filtered = computed(() => props.columns.filter(c => c.label.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const hiddenCount = computed(() => props.columns.filter(c => !c.required && !columnIsVisible(props.tableKey, c.key)).length)
const shownCount = computed(() => props.columns.length - hiddenCount.value)
watch(() => [props.tableKey, ...hiddenColumns(props.tableKey)], () => emit('change'))
watch(() => props.tableKey, () => { open.value = false; search.value = '' })
</script>
<style>
.table-column-toolbar { display: flex; justify-content: flex-end; align-items: center; height: 2.25rem; flex-shrink: 0; gap: .4rem; }
.table-column-toolbar .el-button > span { gap: .35rem; }
.column-count, .column-picker-note, .column-picker small { color: var(--el-text-color-secondary); font-size: 12px; }
.column-picker { display: flex; flex-direction: column; gap: .6rem; }
.column-picker-heading { display: flex; justify-content: space-between; align-items: center; }
.column-picker-list { display: flex; flex-direction: column; max-height: min(320px, 50vh); overflow-y: auto; }
.column-picker-list .el-checkbox { margin-right: 0; min-height: 30px; height: auto; }
.column-picker-list .el-checkbox__label { white-space: normal; overflow-wrap: anywhere; }
</style>
