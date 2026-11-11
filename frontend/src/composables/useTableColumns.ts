import { reactive, shallowReactive, nextTick, type ComponentPublicInstance } from 'vue'

export interface TableColumnOption { key: string; label: string; required?: boolean }
const prefix = 'uniterm:table-columns:v1:'
const hidden = reactive<Record<string, string[]>>({})
function read(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(prefix + key) || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))] : []
  } catch { return [] }
}
export function hiddenColumns(key: string): string[] {
  if (!Object.prototype.hasOwnProperty.call(hidden, key)) hidden[key] = read(key)
  return hidden[key]
}
export function columnIsVisible(table: string, column: string): boolean {
  return !hiddenColumns(table).includes(column)
}
export function setColumnVisible(table: string, column: string, visible: boolean) {
  const next = new Set(hiddenColumns(table))
  if (visible) next.delete(column)
  else next.add(column)
  hidden[table] = [...next]
  try { localStorage.setItem(prefix + table, JSON.stringify(hidden[table])) } catch { /* Session-only if storage is unavailable. */ }
}
export function resetColumns(table: string) {
  hidden[table] = []
  try { localStorage.removeItem(prefix + table) } catch { /* Session-only. */ }
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === null) {
      for (const key of Object.keys(hidden)) hidden[key] = read(key)
    } else if (event.key.startsWith(prefix)) {
      const key = event.key.slice(prefix.length)
      hidden[key] = read(key)
    }
  })
}
// Keep existing table refs and events intact; only column VNodes are removed.
export function useTableColumns() {
  const columnTableRefs = shallowReactive<Record<string, any>>({})
  function bindColumnTable(key: string) {
    return (element: Element | ComponentPublicInstance | null) => { columnTableRefs[key] = element }
  }
  function refreshColumnLayout(table: any) {
    table?.clearSort?.()
    table?.clearFilter?.()
    void nextTick(() => table?.doLayout?.())
  }
  return { columnIsVisible, columnTableRefs, bindColumnTable, refreshColumnLayout }
}
