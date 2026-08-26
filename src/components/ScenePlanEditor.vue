<template>
  <section class="scene-editor">
    <header class="scene-editor-head">
      <div>
        <span class="eyebrow copper">SCENE LEDGER</span>
        <h2>场景行动链</h2>
        <p>每一场从一个状态进入，以一个变化离开。正文会按这里的顺序生成。</p>
      </div>
      <button type="button" @click="addScene">＋ 添加场景</button>
    </header>

    <label class="summary-field">
      <span>本章场景摘要</span>
      <textarea :value="plan.summary" placeholder="这组场景共同完成什么变化" @input="setRoot('summary', $event.target.value)"></textarea>
    </label>

    <div v-if="!plan.scenes.length" class="empty-scenes">
      <strong>还没有结构化场景</strong>
      <p v-if="plan.legacyNotes">旧版文本已安全保留在下方。可以让 AI 重新拆分，也可以手动添加第一场。</p>
      <p v-else>添加场景，或者点击右侧“生成场景计划”。</p>
    </div>

    <article v-for="(scene, index) in plan.scenes" :key="scene.id + index" class="scene-card">
      <div class="scene-card-index">
        <span>{{ String(index + 1).padStart(2, '0') }}</span>
        <i :class="{ linked: index === 0 || Boolean(plan.scenes[index - 1]?.exitState && scene.entryState) }"></i>
      </div>
      <div class="scene-card-body">
        <div class="scene-card-title">
          <input :value="scene.id" aria-label="场景 ID" @input="setScene(index, 'id', $event.target.value)" />
          <input class="title-input" :value="scene.title" aria-label="场景标题" placeholder="场景标题" @input="setScene(index, 'title', $event.target.value)" />
          <button type="button" title="删除场景" @click="removeScene(index)">×</button>
        </div>
        <div class="scene-meta-grid">
          <label><span>视角人物</span><input :value="scene.pov" @input="setScene(index, 'pov', $event.target.value)" /></label>
          <label><span>时间</span><input :value="scene.time" @input="setScene(index, 'time', $event.target.value)" /></label>
          <label><span>地点</span><input :value="scene.location" @input="setScene(index, 'location', $event.target.value)" /></label>
          <label><span>出场人物</span><input :value="scene.presentCharacters.join('、')" placeholder="用顿号分隔" @input="setList(index, 'presentCharacters', $event.target.value)" /></label>
        </div>
        <div class="state-rail">
          <label><span>进入状态</span><textarea :value="scene.entryState" @input="setScene(index, 'entryState', $event.target.value)"></textarea></label>
          <span class="state-arrow">→</span>
          <label><span>离开状态</span><textarea :value="scene.exitState" @input="setScene(index, 'exitState', $event.target.value)"></textarea></label>
        </div>
        <div class="scene-contract-grid">
          <label><span>目标</span><textarea :value="scene.goal" @input="setScene(index, 'goal', $event.target.value)"></textarea></label>
          <label><span>阻力</span><textarea :value="scene.obstacle" @input="setScene(index, 'obstacle', $event.target.value)"></textarea></label>
          <label><span>转向</span><textarea :value="scene.turn" @input="setScene(index, 'turn', $event.target.value)"></textarea></label>
        </div>
        <label class="wide-field"><span>行动节拍</span><textarea :value="scene.actionBeats.join('\n')" placeholder="每行一个可见动作" @input="setLines(index, 'actionBeats', $event.target.value)"></textarea></label>
        <div class="scene-contract-grid two">
          <label><span>信息变化</span><textarea :value="scene.knowledgeChanges.join('\n')" @input="setLines(index, 'knowledgeChanges', $event.target.value)"></textarea></label>
          <label><span>连续性风险</span><textarea :value="scene.continuityRisks.join('\n')" @input="setLines(index, 'continuityRisks', $event.target.value)"></textarea></label>
        </div>
      </div>
    </article>

    <details v-if="plan.legacyNotes" class="legacy-notes">
      <summary>旧版场景计划原文</summary>
      <pre>{{ plan.legacyNotes }}</pre>
    </details>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { emptyScenePlan, normalizeScenePlan } from '../../electron/creative-quality.js'

const props = defineProps({ modelValue: { type: Object, default: () => emptyScenePlan() } })
const emit = defineEmits(['update:modelValue'])
const plan = computed(() => normalizeScenePlan(props.modelValue))

function next(mutator) {
  const draft = normalizeScenePlan(JSON.parse(JSON.stringify(plan.value)))
  mutator(draft)
  emit('update:modelValue', draft)
}
function setRoot(key, value) { next((draft) => { draft[key] = value }) }
function setScene(index, key, value) { next((draft) => { draft.scenes[index][key] = value }) }
function setList(index, key, value) { setScene(index, key, String(value).split(/[、,，]/).map((item) => item.trim()).filter(Boolean)) }
function setLines(index, key, value) { setScene(index, key, String(value).split(/\n+/).map((item) => item.trim()).filter(Boolean)) }
function addScene() {
  next((draft) => draft.scenes.push({
    id: `S${draft.scenes.length + 1}`, title: `场景 ${draft.scenes.length + 1}`, pov: '', time: '', location: '', presentCharacters: [],
    entryState: '', goal: '', obstacle: '', actionBeats: [], turn: '', exitState: '', knowledgeChanges: [], continuityRisks: [],
  }))
}
function removeScene(index) { next((draft) => draft.scenes.splice(index, 1)) }
</script>

<style scoped>
.scene-editor { height: 100%; overflow: auto; padding: 34px 8% 90px; background: #f3eee4; }
.scene-editor-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.scene-editor-head h2 { margin: 8px 0 5px; font: 27px var(--font-display); }
.scene-editor-head p { margin: 0; color: #887e72; font: 11px/1.6 var(--font-body); }
.scene-editor-head button { padding: 9px 12px; color: #fff9f0; border: 1px solid var(--copper); background: var(--copper); font-size: 10px; }
label { display: grid; gap: 6px; color: #756b60; font-size: 9px; letter-spacing: .04em; }
input, textarea { width: 100%; color: #403a34; border: 1px solid #d7ccbd; outline: 0; background: rgba(255,255,255,.55); font: 11px/1.55 var(--font-body); }
input { min-height: 34px; padding: 7px 9px; }
textarea { min-height: 62px; resize: vertical; padding: 8px 9px; }
input:focus, textarea:focus { border-color: #bd816e; background: #fffaf2; }
.summary-field { margin-bottom: 18px; }
.summary-field textarea { min-height: 74px; font-size: 13px; }
.empty-scenes { padding: 26px; color: #746a5e; border: 1px dashed #c9baa8; background: rgba(255,255,255,.3); text-align: center; }
.empty-scenes strong { font: 17px var(--font-display); }
.empty-scenes p { margin: 8px 0 0; font-size: 10px; }
.scene-card { display: grid; grid-template-columns: 38px 1fr; margin-top: 14px; border: 1px solid #d4c8b8; background: #fbf8f1; box-shadow: 0 9px 24px rgba(70,58,43,.06); }
.scene-card-index { display: flex; flex-direction: column; align-items: center; padding-top: 18px; color: var(--copper); border-right: 1px solid #ddd2c3; background: #eee6da; font: 9px var(--font-ui); }
.scene-card-index i { width: 7px; height: 7px; margin-top: 12px; border: 1px solid #b86a54; border-radius: 50%; background: #eee6da; }
.scene-card-index i.linked { background: #568071; border-color: #568071; }
.scene-card-body { padding: 16px 17px 19px; }
.scene-card-title { display: grid; grid-template-columns: 66px 1fr 28px; gap: 7px; margin-bottom: 12px; }
.scene-card-title .title-input { font: 15px var(--font-display); }
.scene-card-title button { color: #9a766a; border: 1px solid #dacbc0; background: transparent; font-size: 17px; }
.scene-meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.state-rail { display: grid; grid-template-columns: 1fr 24px 1fr; align-items: center; gap: 6px; margin-top: 13px; padding: 12px; background: #eee7da; }
.state-arrow { color: var(--copper); text-align: center; }
.scene-contract-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
.scene-contract-grid.two { grid-template-columns: repeat(2, 1fr); }
.wide-field { margin-top: 10px; }
.legacy-notes { margin-top: 18px; padding: 12px 15px; color: #776d62; border: 1px solid #d2c6b7; background: #ebe3d7; font-size: 10px; }
.legacy-notes pre { white-space: pre-wrap; font: 11px/1.7 var(--font-body); }
@media (max-width: 1180px) { .scene-meta-grid { grid-template-columns: repeat(2, 1fr); } .scene-contract-grid { grid-template-columns: 1fr; } }
</style>
