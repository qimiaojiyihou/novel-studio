<template>
  <div class="empty-planning">
    <span>◌</span>
    <h2>{{ title }}</h2>
    <p>{{ copy }}</p>
    <button v-if="action" @click="$emit('action')">{{ action }}</button>
  </div>
</template>

<script setup>
defineProps({ title: { type: String, required: true }, copy: { type: String, default: '' }, action: { type: String, default: '' } })
defineEmits(['action'])
</script>

<style scoped>
.empty-planning { display: grid; justify-items: center; padding: 90px 45px; color: #8f8274; text-align: center; }
.empty-planning > span { color: var(--copper); font-size: 38px; }.empty-planning h2 { margin: 12px 0 7px; color: #49413a; font: 23px var(--font-display); }.empty-planning p { max-width: 420px; margin: 0; font: 11px/1.8 var(--font-body); }.empty-planning button { margin-top: 20px; padding: 9px 13px; color: #fff8ef; border: 1px solid var(--copper); background: var(--copper); font-size: 9px; }
</style>
