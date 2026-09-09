<template>
  <section class="author-samples">
    <h2>认可片段</h2><p>从当前章节粘贴你认可的原文并写下原因。每次最多取三段相关样本，只学习表达，不带入旧剧情。</p>
    <p role="alert">{{ error }}</p>
    <label>原文片段<textarea v-model="draft.text" rows="6" /></label>
    <label>认可原因<input v-model="draft.reason" placeholder="例如：人物没把话说透，但读者能理解他的顾虑" /></label>
    <button type="button" @click="save(draft)">保存认可片段</button>
    <article v-for="sample in samples" :key="sample.id">
      <textarea v-model="sample.text" rows="5" /><input v-model="sample.reason" aria-label="认可原因" />
      <label><input v-model="sample.active" type="checkbox" :true-value="1" :false-value="0" />启用</label>
      <button type="button" @click="save(sample)">保存修改</button><button type="button" @click="save({ ...sample, action: 'delete' })">删除</button>
    </article>
  </section>
</template>
<script setup>
import { ref, reactive, watch } from 'vue'
import { appService } from '../services/app-service.js'
const props = defineProps({ projectId: String, chapterId: String })
const samples = ref([]), error = ref(''), draft = reactive({ text: '', reason: '' })
async function load() { try { samples.value = await appService.listStyleSamples({ projectId: props.projectId }) } catch (e) { error.value = e.message } }
async function save(item) { try { error.value = ''; await appService.saveStyleSample({ ...item, projectId: props.projectId, chapterId: props.chapterId }); if (item === draft) Object.assign(draft, { text: '', reason: '' }); await load() } catch (e) { error.value = e.message } }
watch(() => props.projectId, load, { immediate: true })
</script>
<style scoped>
.author-samples{display:grid;gap:16px}.author-samples p{line-height:1.7}.author-samples label{display:grid;gap:8px}.author-samples textarea,.author-samples input:not([type=checkbox]){width:100%;box-sizing:border-box;background:white;border:1px solid #b7cbd0;border-radius:8px;padding:12px;color:#2d424b;font:inherit}.author-samples article{display:grid;gap:10px;border-top:1px solid #c9d8dd;padding-top:20px}.author-samples button{justify-self:start;border:1px solid #8eaeb3;background:#e7f1f0;color:#294e50;border-radius:7px;padding:10px 16px;cursor:pointer}
</style>
