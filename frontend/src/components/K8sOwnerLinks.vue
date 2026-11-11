<template>
  <span v-if="!owners.length">—</span>
  <span v-else class="k8s-owner-links">
    <button v-for="(owner, i) in owners" :key="owner.uid || `${owner.kind}/${owner.name}/${i}`" type="button" :disabled="disabled" :title="`${owner.kind}/${owner.name}`" @click.stop="$emit('open', owner)">{{ owner.kind }}<template v-if="!typeOnly">/{{ owner.name }}</template></button>
  </span>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { ownersOf, type OwnerReference } from '../services/k8sOwners'
const props = defineProps<{ target: any; typeOnly?: boolean; disabled?: boolean }>()
defineEmits<{ open: [owner: OwnerReference] }>()
const owners = computed(() => ownersOf(props.target))
</script>
<style scoped>
.k8s-owner-links { display: inline-flex; flex-wrap: wrap; gap: .35rem .6rem; }
button { border: 0; padding: 0; background: none; color: var(--el-color-primary); font: inherit; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
button:hover { text-decoration: underline; }
button:disabled { opacity: .5; cursor: wait; }
</style>
