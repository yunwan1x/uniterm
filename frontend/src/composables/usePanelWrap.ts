import { ref, watch } from 'vue'
const key = 'uniterm:panel-wrap:v1'
function read() { try { return localStorage.getItem(key) !== 'false' } catch { return true } }
const panelWrap = ref(read())
watch(panelWrap, value => { try { localStorage.setItem(key, String(value)) } catch { /* Session-only. */ } })
export function usePanelWrap() { return panelWrap }
