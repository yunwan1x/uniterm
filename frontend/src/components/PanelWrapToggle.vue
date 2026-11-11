<template><el-button size="small" :type="wrap ? 'primary' : 'default'" :aria-pressed="wrap" :title="t('panel.wrap')" @click="wrap = !wrap">Wrap</el-button></template>
<script setup lang="ts">
import { ElButton } from 'element-plus'
import { usePanelWrap } from '../composables/usePanelWrap'
import { useI18n } from '../i18n'
const wrap = usePanelWrap()
const { t } = useI18n()
</script>
<style>
.detail-drawer.panel-wrap .detail-value, .detail-drawer.panel-wrap pre, .detail-drawer.panel-wrap .layer-cmd, .detail-drawer.panel-wrap .log-line { white-space: pre-wrap !important; overflow-wrap: anywhere; word-break: break-word !important; min-width: 0; }
.detail-drawer.panel-nowrap .detail-value, .detail-drawer.panel-nowrap pre, .detail-drawer.panel-nowrap .layer-cmd, .detail-drawer.panel-nowrap .log-line { white-space: pre !important; overflow-wrap: normal; word-break: normal !important; }
.detail-drawer.panel-nowrap .detail-value { overflow-x: auto; min-width: 0; }
.detail-drawer.panel-wrap .k8s-owner-links button { white-space: pre-wrap; }
.detail-drawer.panel-nowrap .k8s-owner-links { flex-wrap: nowrap; }
.detail-drawer.panel-nowrap .k8s-owner-links button { white-space: pre; }
.detail-drawer .layer-cmd { min-width: 0; overflow-x: auto; text-overflow: clip; }
</style>
