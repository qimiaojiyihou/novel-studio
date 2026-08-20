<template>
  <section class="knowledge-center" v-if="center">
    <header class="knowledge-header">
      <div>
        <span class="eyebrow copper">KNOWLEDGE & CONTINUITY</span>
        <h1>知识与连续性</h1>
        <p>把已经确认的故事事实、时间顺序和未兑现承诺，变成下一次创作可以依赖的记忆。</p>
      </div>
      <div class="knowledge-header-actions">
        <span class="knowledge-save-state" :class="saveState"><i></i>{{ saveStateLabel }}</span>
        <button @click="syncSources" :disabled="syncing">{{ syncing ? '正在同步…' : '同步已确认规划' }}</button>
        <button @click="refreshChecks" :disabled="syncing">重新检查</button>
      </div>
    </header>

    <div class="knowledge-layout">
      <aside class="knowledge-index">
        <div class="index-heading"><span>STORY MEMORY</span><small>事实先于生成</small></div>
        <button class="knowledge-mode" :class="{ active: mode === 'facts' }" @click="selectMode('facts')">
          <span><b>事实库</b><small>已确认的规则与人物事实</small></span><strong>{{ center.counts.facts }}</strong>
        </button>
        <button class="knowledge-mode timeline-mode" :class="{ active: mode === 'timeline' }" @click="selectMode('timeline')">
          <span><b>时间线</b><small>事件发生的顺序与后果</small></span><strong>{{ center.counts.timeline }}</strong>
        </button>
        <button class="knowledge-mode foreshadow-mode" :class="{ active: mode === 'foreshadow' }" @click="selectMode('foreshadow')">
          <span><b>伏笔账本</b><small>种下、承诺与回收</small></span><strong>{{ center.counts.foreshadows }}</strong>
        </button>
        <button class="knowledge-mode check-mode" :class="{ active: mode === 'checks' }" @click="selectMode('checks')">
          <span><b>连续性检查</b><small>需要作者判断的提醒</small></span><strong>{{ center.counts.openChecks }}</strong>
        </button>

        <div class="knowledge-index-note">
          <span class="eyebrow">WORKING RULE</span>
          <p>同步只更新规划来源。你编辑过的条目会变成手工记录，保留你的判断。</p>
        </div>
      </aside>

      <main class="knowledge-canvas">
        <template v-if="mode !== 'checks'">
          <div class="knowledge-sheet-heading">
            <div>
              <span class="eyebrow copper">{{ modeMeta.eyebrow }}</span>
              <h2>{{ modeMeta.title }}</h2>
              <p>{{ modeMeta.description }}</p>
            </div>
            <button class="knowledge-add" @click="createItem">＋ {{ modeMeta.addLabel }}</button>
          </div>

          <div class="knowledge-item-layout">
            <div class="knowledge-list">
              <div v-if="!modeItems.length" class="knowledge-empty">
                <span>◌</span><strong>{{ modeMeta.emptyTitle }}</strong><p>{{ modeMeta.emptyCopy }}</p>
                <button @click="createItem">{{ modeMeta.addLabel }}</button>
              </div>
              <button
                v-for="item in modeItems"
                :key="item.id"
                class="knowledge-list-item"
                :class="[{ active: selectedItemId === item.id }, item.sourceType]"
                @click="selectItem(item.id)"
              >
                <span class="knowledge-list-mark">{{ itemMark }}</span>
                <span class="knowledge-list-copy"><strong>{{ item.title }}</strong><small>{{ itemSummary(item) }}</small></span>
                <i v-if="item.status === 'resolved'">✓</i>
              </button>
            </div>

            <article v-if="selectedItem" class="knowledge-editor" :class="`kind-${selectedItem.kind}`">
              <div class="knowledge-editor-topline">
                <span>{{ itemOriginLabel(selectedItem) }} · {{ String(selectedItem.position).padStart(2, '0') }}</span>
                <div class="knowledge-editor-actions">
                  <button :disabled="selectedItem.position <= 1" @click="moveItem(-1)">↑</button>
                  <button :disabled="selectedItem.position >= modeItems.length" @click="moveItem(1)">↓</button>
                  <button class="danger-link" @click="requestDelete(selectedItem)">删除</button>
                </div>
              </div>
              <div class="knowledge-title-row">
                <input :value="selectedItem.title" :aria-label="`${modeMeta.title}名称`" @input="updateTitle(selectedItem, $event.target.value)" />
                <span class="knowledge-status" :class="selectedItem.status">{{ selectedItem.status === 'resolved' ? '已回收' : selectedItem.status === 'archived' ? '已归档' : '开放' }}</span>
              </div>
              <p class="knowledge-editor-note">{{ editorNote }}</p>
              <div class="knowledge-fields">
                <label v-for="field in fieldsForMode" :key="field.key" :class="{ wide: field.wide }">
                  <span><strong>{{ field.label }}</strong><small>{{ field.hint }}</small></span>
                  <select v-if="field.type === 'select'" :value="selectedItem.content[field.key] || ''" :aria-label="field.label" @change="updateField(selectedItem, field.key, $event.target.value)">
                    <option value="">请选择</option>
                    <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
                  </select>
                  <input v-else-if="field.type === 'number'" type="number" min="0" :value="selectedItem.content[field.key] || ''" :aria-label="field.label" :placeholder="field.placeholder" @input="updateField(selectedItem, field.key, $event.target.value)" />
                  <input v-else-if="field.type === 'input'" :value="selectedItem.content[field.key] || ''" :aria-label="field.label" :placeholder="field.placeholder" @input="updateField(selectedItem, field.key, $event.target.value)" />
                  <textarea v-else :value="selectedItem.content[field.key] || ''" :aria-label="field.label" :placeholder="field.placeholder" @input="updateField(selectedItem, field.key, $event.target.value)"></textarea>
                </label>
              </div>
            </article>
            <div v-else class="knowledge-no-selection">选择一条{{ modeMeta.title }}，开始整理它的事实边界。</div>
          </div>
        </template>

        <template v-else>
          <div class="knowledge-sheet-heading checks-heading">
            <div><span class="eyebrow copper">CONTINUITY AUDIT</span><h2>连续性检查</h2><p>这里的提醒来自章节合同、时间节点、伏笔账本和事实键冲突。每一条都留给作者做最后判断。</p></div>
            <div class="check-summary"><strong>{{ openChecks.length }}</strong><span>待处理提醒</span></div>
          </div>
          <div v-if="!center.checks.length" class="knowledge-empty checks-empty"><span>✓</span><strong>目前没有连续性提醒</strong><p>随着章节卡、时间线和伏笔增加，检查结果会出现在这里。</p></div>
          <div v-else class="check-list">
            <article v-for="check in center.checks" :key="check.id" class="check-card" :class="[`severity-${check.severity}`, { resolved: check.status !== 'open' }]">
              <div class="check-card-mark">{{ check.status === 'open' ? (check.severity === 'critical' ? '!' : check.severity === 'warning' ? '△' : '·') : '✓' }}</div>
              <div class="check-card-copy"><div><span class="check-kind">{{ checkKindLabel(check.kind) }}</span><span class="check-status">{{ checkStatusLabel(check.status) }}</span></div><h3>{{ check.title }}</h3><p>{{ check.detail }}</p></div>
              <div class="check-card-actions" v-if="check.status === 'open'"><button @click="resolveCheck(check, 'dismissed')">忽略</button><button class="resolve" @click="resolveCheck(check, 'resolved')">标记已处理</button></div>
              <div class="check-card-actions" v-else><button @click="reopenCheck(check)">重新打开</button></div>
            </article>
          </div>
        </template>
      </main>

      <aside class="knowledge-source-rail">
        <div class="source-rail-heading"><span class="eyebrow">SOURCE LENS</span><h2>{{ mode === 'checks' ? '检查说明' : '来源镜片' }}</h2></div>
        <template v-if="mode !== 'checks' && selectedItem">
          <div class="source-badge" :class="selectedItem.sourceType"><i></i>{{ itemOriginLabel(selectedItem) }}</div>
          <div class="source-copy"><strong>{{ selectedItem.title }}</strong><p>{{ sourceDescription(selectedItem) }}</p></div>
          <div class="source-meta"><span>最近更新</span><strong>{{ formatTime(selectedItem.updatedAt) }}</strong></div>
          <div class="source-meta"><span>生成上下文</span><strong class="included">● 已纳入</strong></div>
          <div class="source-rule"></div>
          <p class="source-help">这条记录会随当前项目进入模型上下文。若它与新内容冲突，系统会在连续性检查中提示，不会静默替换。</p>
        </template>
        <template v-else-if="mode === 'checks'">
          <div class="check-rule-card"><span>01</span><strong>章节合同</strong><p>正文开始后是否仍有明确的章节目标和可回看的变化。</p></div>
          <div class="check-rule-card"><span>02</span><strong>时间顺序</strong><p>章节事件和伏笔回收是否落在合理的时间节点上。</p></div>
          <div class="check-rule-card"><span>03</span><strong>事实键</strong><p>同一个事实键不能同时拥有互相冲突的值。</p></div>
        </template>
        <div v-else class="source-empty"><span>◌</span><p>选择一条记录，查看它的来源和上下文状态。</p></div>
      </aside>
    </div>

    <div v-if="deleteTarget" class="knowledge-confirm-backdrop" @mousedown.self="deleteTarget = null">
      <section class="knowledge-confirm"><span class="eyebrow copper">REMOVE MEMORY</span><h2>删除“{{ deleteTarget.title }}”？</h2><p>这条知识记录会从当前项目的上下文中移除，来源章节和规划内容不会被删除。</p><div><button @click="deleteTarget = null">取消</button><button class="danger" @click="confirmDelete">删除记录</button></div></section>
    </div>
  </section>
  <div v-else class="knowledge-loading">{{ loadError ? `知识库打开失败：${loadError}` : '正在整理故事记忆…' }}</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'

const props = defineProps({ project: { type: Object, required: true } })
const emit = defineEmits(['toast'])
const center = ref(null)
const loadError = ref('')
const mode = ref('facts')
const selectedItemId = ref('')
const saveState = ref('saved')
const syncing = ref(false)
const deleteTarget = ref(null)
const itemTimers = new Map()
const dirtyItems = new Set()
const activeSaves = new Set()

const modes = {
  facts: { eyebrow: 'CONFIRMED FACTS', title: '事实库', description: '记录后文必须尊重的规则、人物事实和世界约束。', addLabel: '添加事实', emptyTitle: '还没有手工事实', emptyCopy: '同步已确认规划，或直接写下一条后文必须尊重的规则。' },
  timeline: { eyebrow: 'CHRONOLOGY', title: '时间线', description: '把事件按发生顺序排列，让章节承接不依赖记忆。', addLabel: '添加时间节点', emptyTitle: '还没有时间节点', emptyCopy: '可以从一场改变局势的事件开始记录。' },
  foreshadow: { eyebrow: 'PROMISE LEDGER', title: '伏笔账本', description: '记录种下什么、向读者承诺什么，以及准备在哪一章回收。', addLabel: '添加伏笔', emptyTitle: '还没有伏笔记录', emptyCopy: '把一个具体的未兑现信息或物件记下来。' },
}
const fieldSets = {
  facts: [
    { key: 'category', label: '事实类别', hint: '人物、世界、剧情或规则', type: 'select', options: ['人物', '世界', '剧情', '规则', '关系', '其他'] },
    { key: 'statement', label: '事实陈述', hint: '写成可以判断真假的句子', type: 'textarea', wide: true, placeholder: '例如：改稿室只有原作者能在午夜打开。' },
    { key: 'key', label: '事实键', hint: '同一件事保持同一个键名', type: 'input', placeholder: '例如：改稿室开放时间' },
    { key: 'value', label: '事实值', hint: '用于发现前后冲突', type: 'input', placeholder: '例如：午夜' },
    { key: 'scope', label: '作用范围', hint: '这条事实影响哪里', type: 'textarea', placeholder: '全书、某一卷、某个人物或某个地点' },
    { key: 'certainty', label: '确认程度', hint: '作者对它的承诺强度', type: 'select', options: ['已确认', '暂定', '待核对'] },
  ],
  timeline: [
    { key: 'dateLabel', label: '时间标记', hint: '日期、时代或章节位置', type: 'input', placeholder: '例如：第一章当夜 / 2026 年冬' },
    { key: 'chapterNo', label: '关联章节', hint: '用于顺序检查', type: 'number', placeholder: '章节号' },
    { key: 'event', label: '发生了什么', hint: '只写改变局势的动作或事实', type: 'textarea', wide: true, placeholder: '谁做了什么，造成什么不可逆变化' },
    { key: 'participants', label: '涉及人物', hint: '谁在场或被影响', type: 'textarea', placeholder: '人物、组织或地点' },
    { key: 'consequence', label: '直接后果', hint: '下一步选择被怎样改变', type: 'textarea', placeholder: '事件结束后，什么再也回不到原样' },
  ],
  foreshadow: [
    { key: 'seed', label: '伏笔种子', hint: '读者先看到什么', type: 'textarea', wide: true, placeholder: '一个物件、动作、异常信息或未解释的选择' },
    { key: 'promise', label: '阅读承诺', hint: '它让读者等待什么答案', type: 'textarea', placeholder: '读者会期待它解释什么或改变什么' },
    { key: 'dueChapterNo', label: '预定回收章', hint: '超过后会进入连续性提醒', type: 'number', placeholder: '章节号' },
    { key: 'payoffChapterNo', label: '实际回收章', hint: '完成后补记', type: 'number', placeholder: '尚未回收可留空' },
    { key: 'payoff', label: '回收方式', hint: '答案、反转或行动后果', type: 'textarea', wide: true, placeholder: '它最终怎样被兑现，不要只写“揭晓”' },
    { key: 'notes', label: '连续性备注', hint: '容易写错的边界', type: 'textarea', wide: true, placeholder: '前文出现位置、不能提前透露的部分或例外' },
  ],
}

const modeMeta = computed(() => modes[mode.value])
const modeKinds = { facts: 'fact', timeline: 'timeline', foreshadow: 'foreshadow' }
const modeItems = computed(() => center.value?.items.filter((item) => item.kind === modeKinds[mode.value] && item.status !== 'archived') || [])
const selectedItem = computed(() => modeItems.value.find((item) => item.id === selectedItemId.value) || modeItems.value[0] || null)
const fieldsForMode = computed(() => fieldSets[mode.value] || [])
const openChecks = computed(() => center.value?.checks.filter((check) => check.status === 'open') || [])
const itemMark = computed(() => mode.value === 'facts' ? 'F' : mode.value === 'timeline' ? 'T' : 'P')
const saveStateLabel = computed(() => ({ dirty: '等待自动保存', saving: '正在保存', saved: '已保存', error: '保存失败' }[saveState.value]))
const editorNote = computed(() => selectedItem.value?.sourceType === 'manual' ? '这是作者手工维护的记忆。同步规划时会保留它。' : '这是从已确认规划或章节生成的来源事实。编辑后会转为手工记录。')

onMounted(loadCenter)
watch(() => props.project.id, async () => { await flushSaves(); await loadCenter() })
onBeforeUnmount(() => { void flushSaves() })

async function loadCenter() {
  loadError.value = ''
  try {
    center.value = await appService.loadKnowledgeCenter(props.project.id)
    selectedItemId.value = keepSelected(selectedItemId.value)
    saveState.value = 'saved'
  } catch (error) {
    loadError.value = error.message
    emit('toast', `读取知识库失败：${error.message}`)
  }
}

function keepSelected(id = '') { return modeItems.value.some((item) => item.id === id) ? id : modeItems.value[0]?.id || '' }
function selectMode(nextMode) { mode.value = nextMode; selectedItemId.value = keepSelected('') }
async function selectItem(id) { await flushSaves(); selectedItemId.value = id }
function cloneForIpc(value) { return JSON.parse(JSON.stringify(value ?? {})) }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' }

function updateTitle(item, value) { item.title = value; markDirty(item) }
function updateField(item, key, value) { item.content[key] = value; markDirty(item) }
function markDirty(item) {
  dirtyItems.add(item.id)
  saveState.value = 'dirty'
  if (itemTimers.has(item.id)) clearTimeout(itemTimers.get(item.id))
  itemTimers.set(item.id, setTimeout(() => { itemTimers.delete(item.id); Promise.resolve().then(() => saveItem(item.id)).catch(() => {}) }, 800))
}
function trackSave(promise) { activeSaves.add(promise); promise.then(() => activeSaves.delete(promise), () => activeSaves.delete(promise)); return promise }
async function saveItem(id) {
  if (!dirtyItems.has(id)) return
  const item = center.value.items.find((entry) => entry.id === id)
  if (!item) return
  dirtyItems.delete(id); saveState.value = 'saving'
  return trackSave(appService.updateKnowledgeItem({ id, title: item.title, content: cloneForIpc(item.content), status: item.status })
    .then((saved) => { replaceItem(saved); settleSaveState() })
    .catch((error) => { dirtyItems.add(id); saveState.value = 'error'; emit('toast', `知识记录保存失败：${error.message}`); throw error }))
}
function replaceItem(saved) { center.value.items = center.value.items.map((item) => item.id === saved.id ? saved : item) }
function settleSaveState() { saveState.value = dirtyItems.size ? 'dirty' : 'saved' }
async function flushSaves() {
  for (const timer of itemTimers.values()) clearTimeout(timer)
  itemTimers.clear()
  const saves = [...dirtyItems].map((id) => saveItem(id)).filter(Boolean)
  await Promise.all(saves)
  if (activeSaves.size) await Promise.all([...activeSaves])
}

async function createItem() {
  await flushSaves()
  const kind = mode.value === 'facts' ? 'fact' : mode.value
  try {
    const item = await appService.createKnowledgeItem({ projectId: props.project.id, kind, title: modeMeta.value.addLabel, content: kind === 'fact' ? { category: '其他', certainty: '已确认' } : {} })
    center.value.items.push(item)
    selectedItemId.value = item.id
    emit('toast', `${modeMeta.value.addLabel}已建立`)
  } catch (error) { emit('toast', `添加知识记录失败：${error.message}`) }
}

async function moveItem(direction) {
  if (!selectedItem.value) return
  await flushSaves()
  const list = modeItems.value
  const from = list.findIndex((item) => item.id === selectedItem.value.id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= list.length) return
  const ids = list.map((item) => item.id); ids.splice(to, 0, ids.splice(from, 1)[0])
  try {
    const reordered = await appService.reorderKnowledgeItems({ projectId: props.project.id, kind: selectedItem.value.kind, itemIds: ids })
    center.value.items = [...center.value.items.filter((item) => item.kind !== selectedItem.value.kind), ...reordered]
    selectedItemId.value = reordered[to].id
  } catch (error) { emit('toast', `调整顺序失败：${error.message}`) }
}

function requestDelete(item) { deleteTarget.value = item }
async function confirmDelete() {
  const item = deleteTarget.value
  if (!item) return
  await flushSaves()
  try {
    const remaining = await appService.deleteKnowledgeItem(item.id)
    center.value.items = [...center.value.items.filter((entry) => entry.kind !== item.kind), ...remaining]
    selectedItemId.value = remaining[0]?.id || ''
    deleteTarget.value = null
    emit('toast', `“${item.title}”已删除`)
  } catch (error) { emit('toast', `删除知识记录失败：${error.message}`) }
}

async function syncSources() {
  await flushSaves(); syncing.value = true
  try { center.value = await appService.syncKnowledgeSources(props.project.id); selectedItemId.value = keepSelected(selectedItemId.value); emit('toast', '已确认规划同步到知识库') }
  catch (error) { emit('toast', `同步知识来源失败：${error.message}`) }
  finally { syncing.value = false }
}
async function refreshChecks() {
  await flushSaves(); syncing.value = true
  try { center.value = await appService.refreshContinuityChecks(props.project.id); emit('toast', '连续性检查已刷新') }
  catch (error) { emit('toast', `连续性检查失败：${error.message}`) }
  finally { syncing.value = false }
}
async function resolveCheck(check, status) {
  try { const saved = await appService.resolveContinuityCheck({ id: check.id, status }); center.value.checks = center.value.checks.map((item) => item.id === saved.id ? saved : item); center.value.counts.openChecks = center.value.checks.filter((item) => item.status === 'open').length }
  catch (error) { emit('toast', `处理连续性提醒失败：${error.message}`) }
}
function reopenCheck(check) { resolveCheck(check, 'open') }
function itemSummary(item) { return item.kind === 'fact' ? item.content.statement || item.content.value || '等待填写事实陈述' : item.kind === 'timeline' ? item.content.event || item.content.consequence || '等待填写事件' : item.content.seed || item.content.promise || '等待填写伏笔种子' }
function itemOriginLabel(item) { return item.sourceType === 'planning' ? '规划来源' : item.sourceType === 'chapter' ? '章节来源' : '手工记录' }
function sourceDescription(item) { return item.sourceType === 'planning' ? '这条记录来自故事基础、人物、世界观或结构规划。' : item.sourceType === 'chapter' ? '这条记录来自章节合同或章节事件。' : '这条记录由作者直接维护，不会被规划同步覆盖。' }
function checkKindLabel(kind) { return ({ 'missing-contract': '章节合同', 'missing-scene-plan': '场景计划', 'overdue-foreshadow': '伏笔回收', 'conflicting-fact': '事实冲突' }[kind] || '连续性') }
function checkStatusLabel(status) { return status === 'resolved' ? '已处理' : status === 'dismissed' ? '已忽略' : '待处理' }

defineExpose({ flushSaves })
</script>

<style scoped>
.knowledge-center { grid-column: 2 / 4; min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); color: var(--ink); background: #eee7da; }
.knowledge-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding: 24px 28px 20px; color: #f5f1e8; border-bottom: 1px solid #3f464b; background: #262c31; }.knowledge-header h1 { margin: 8px 0 4px; font: 28px/1.15 var(--font-display); }.knowledge-header p { margin: 0; color: #9ca4a8; font-size: 10px; }.knowledge-header-actions { display: flex; align-items: center; gap: 8px; }.knowledge-header-actions button { padding: 7px 9px; color: #d7c5b6; border: 1px solid #545d62; background: transparent; font-size: 9px; }.knowledge-header-actions button:hover { color: #fff8ef; border-color: var(--copper); }.knowledge-save-state { display: inline-flex; align-items: center; gap: 6px; margin-right: 6px; color: #9eb9ac; font-size: 9px; }.knowledge-save-state i { width: 5px; height: 5px; border-radius: 50%; background: #72a089; }.knowledge-save-state.dirty { color: #d8b878; }.knowledge-save-state.dirty i { background: #c8964a; }.knowledge-save-state.saving i { animation: knowledge-pulse .8s infinite; }.knowledge-save-state.error { color: #df8c78; }.knowledge-save-state.error i { background: #c75e48; }
.knowledge-layout { min-height: 0; display: grid; grid-template-columns: 205px minmax(520px, 1fr) 285px; }.knowledge-index { min-height: 0; overflow: auto; padding: 17px 10px 28px; color: #c8ccce; border-right: 1px solid #434b50; background: #2b3238; }.index-heading { display: flex; align-items: center; justify-content: space-between; padding: 7px 8px 14px; color: #899299; font-size: 8px; letter-spacing: .1em; }.index-heading small { color: #657078; font-size: 7px; letter-spacing: 0; }.knowledge-mode { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 12px 9px; color: #a7aeb1; border: 0; border-left: 2px solid transparent; background: transparent; text-align: left; }.knowledge-mode:hover, .knowledge-mode.active { color: #fff8ef; background: #353e44; border-left-color: var(--copper); }.knowledge-mode > span { display: grid; gap: 4px; }.knowledge-mode b { font: 13px var(--font-display); }.knowledge-mode small { color: #747f85; font-size: 7px; }.knowledge-mode strong { display: grid; place-items: center; min-width: 20px; height: 20px; color: #d7c2b0; border: 1px solid #566168; border-radius: 50%; font: 9px var(--font-ui); }.knowledge-mode.active strong { color: #fff8ef; border-color: var(--copper); background: rgba(182,85,62,.35); }.knowledge-index-note { margin: 30px 8px 0; padding-top: 16px; border-top: 1px solid #444f55; }.knowledge-index-note p { margin: 8px 0 0; color: #79858a; font: 10px/1.65 var(--font-body); }
.knowledge-canvas { min-width: 0; min-height: 0; overflow: auto; padding: 25px 28px 60px; background: #eee7da; }.knowledge-sheet-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; width: min(980px, 100%); margin: 0 auto 20px; padding: 0 2px 20px; border-bottom: 1px solid #d4c9bb; }.knowledge-sheet-heading h2 { margin: 7px 0 4px; font: 25px var(--font-display); }.knowledge-sheet-heading p { max-width: 510px; margin: 0; color: #928679; font: 10px/1.6 var(--font-body); }.knowledge-add { padding: 8px 10px; color: #fff8ef; border: 1px solid var(--copper); background: var(--copper); font-size: 9px; }.knowledge-item-layout { display: grid; grid-template-columns: minmax(180px, .34fr) minmax(360px, 1fr); gap: 18px; width: min(980px, 100%); margin: 0 auto; }.knowledge-list { display: grid; align-content: start; gap: 5px; }.knowledge-list-item { display: grid; grid-template-columns: 22px minmax(0, 1fr) 15px; align-items: start; gap: 8px; width: 100%; padding: 11px 9px; color: #70655a; border: 1px solid transparent; border-left: 2px solid #c8b8a6; background: rgba(255,255,255,.32); text-align: left; }.knowledge-list-item:hover, .knowledge-list-item.active { color: #403932; border-color: #c7b7a5; border-left-color: var(--copper); background: #fffaf2; }.knowledge-list-item.chapter { border-left-color: #a98c73; }.knowledge-list-item.manual { border-left-color: #729481; }.knowledge-list-mark { color: var(--copper); font: 9px var(--font-ui); }.knowledge-list-copy { min-width: 0; display: grid; gap: 4px; }.knowledge-list-copy strong { overflow: hidden; font: 12px var(--font-display); text-overflow: ellipsis; white-space: nowrap; }.knowledge-list-copy small { overflow: hidden; color: #94887b; font: 9px/1.45 var(--font-body); text-overflow: ellipsis; white-space: nowrap; }.knowledge-list-item i { color: var(--pine); font-style: normal; }.knowledge-empty, .knowledge-no-selection { display: grid; justify-items: center; align-content: center; min-height: 270px; padding: 25px; color: #8d8073; border: 1px dashed #c3b5a5; text-align: center; }.knowledge-empty > span { color: var(--copper); font-size: 26px; }.knowledge-empty strong { margin-top: 8px; color: #5d544c; font: 15px var(--font-display); }.knowledge-empty p { max-width: 220px; margin: 8px 0 14px; font: 10px/1.6 var(--font-body); }.knowledge-empty button { padding: 8px 10px; color: #fff8ef; border: 1px solid var(--copper); background: var(--copper); font-size: 9px; }.knowledge-editor { min-width: 0; padding: 22px 24px 30px; background: var(--paper-soft); box-shadow: 0 8px 28px rgba(62,49,39,.08); }.knowledge-editor-topline { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--copper); font: 600 8px var(--font-ui); letter-spacing: .13em; }.knowledge-editor-actions { display: flex; gap: 4px; }.knowledge-editor-actions button { width: 26px; height: 25px; color: #82766b; border: 1px solid #d6cabc; background: transparent; font-size: 9px; }.knowledge-editor-actions button:disabled { opacity: .4; }.knowledge-editor-actions .danger-link { width: auto; padding: 0 7px; color: #a14d3b; }.knowledge-title-row { display: flex; align-items: center; gap: 12px; margin-top: 9px; }.knowledge-title-row input { min-width: 0; flex: 1; padding: 2px 0; color: #352f2a; border: 0; border-bottom: 1px solid transparent; outline: 0; background: transparent; font: 25px var(--font-display); }.knowledge-title-row input:focus { border-bottom-color: var(--copper-light); }.knowledge-status { flex: 0 0 auto; padding: 5px 7px; color: #82766b; border: 1px solid #d5c4b4; font-size: 8px; }.knowledge-status.resolved { color: var(--pine); border-color: #a2b9aa; }.knowledge-status.archived { color: #9d8d7e; }.knowledge-editor-note { margin: 8px 0 22px; color: #93877b; font: 9px/1.55 var(--font-body); }.knowledge-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 19px 16px; }.knowledge-fields label { display: grid; align-content: start; gap: 7px; min-width: 0; }.knowledge-fields label.wide { grid-column: 1 / -1; }.knowledge-fields label > span { display: grid; gap: 3px; }.knowledge-fields label strong { color: #49423b; font: 13px var(--font-display); }.knowledge-fields label small { color: #9a8d7e; font-size: 8px; line-height: 1.35; }.knowledge-fields input, .knowledge-fields textarea, .knowledge-fields select { width: 100%; min-height: 36px; padding: 8px 9px; color: #49423b; border: 1px solid #d8cdbf; outline: 0; background: rgba(255,255,255,.46); font: 11px/1.65 var(--font-body); }.knowledge-fields textarea { min-height: 84px; resize: vertical; }.knowledge-fields input:focus, .knowledge-fields textarea:focus, .knowledge-fields select:focus { border-color: var(--copper-light); background: #fffdf8; box-shadow: 0 0 0 2px rgba(182,85,62,.06); }.knowledge-fields select { height: 36px; }
.knowledge-source-rail { min-height: 0; overflow: auto; color: #514a43; border-left: 1px solid #cec2b3; background: #e5dccd; }.source-rail-heading { padding: 22px 20px 17px; border-bottom: 1px solid #cfc3b4; }.source-rail-heading h2 { margin: 8px 0 0; font: 19px var(--font-display); }.source-badge { display: inline-flex; align-items: center; gap: 6px; margin: 19px 20px 0; padding: 5px 7px; color: #8b7769; border: 1px solid #cdb7a5; font-size: 8px; }.source-badge i { width: 5px; height: 5px; border-radius: 50%; background: #a88a70; }.source-badge.manual { color: var(--pine); border-color: #a7b8aa; }.source-badge.manual i { background: var(--pine); }.source-badge.chapter { color: #80654f; }.source-copy { padding: 14px 20px 18px; }.source-copy strong { font: 15px var(--font-display); }.source-copy p { margin: 8px 0 0; color: #8d8073; font: 10px/1.6 var(--font-body); }.source-meta { display: flex; justify-content: space-between; gap: 10px; padding: 10px 20px; border-top: 1px solid #d0c4b5; color: #978a7c; font-size: 8px; }.source-meta strong { color: #6e6258; font-size: 8px; }.source-meta .included { color: var(--pine); }.source-rule { margin: 18px 20px; border-top: 1px solid #cdbfaf; }.source-help { margin: 0 20px; color: #887b6f; font: 10px/1.7 var(--font-body); }.source-empty { display: grid; justify-items: center; padding: 50px 25px; color: #8d8073; text-align: center; }.source-empty span { color: var(--copper); font-size: 27px; }.source-empty p { font: 10px/1.6 var(--font-body); }.check-rule-card { margin: 14px 20px 0; padding: 12px 0 14px 29px; border-bottom: 1px solid #cfc3b4; position: relative; }.check-rule-card span { position: absolute; left: 0; top: 12px; color: var(--copper); font: 9px var(--font-ui); }.check-rule-card strong { font: 14px var(--font-display); }.check-rule-card p { margin: 6px 0 0; color: #8d8073; font: 10px/1.6 var(--font-body); }
.checks-heading { align-items: center; }.check-summary { display: grid; justify-items: end; color: #927c69; }.check-summary strong { color: var(--copper); font: 29px var(--font-display); }.check-summary span { font-size: 8px; }.check-list { display: grid; gap: 9px; width: min(980px, 100%); margin: 0 auto; }.check-card { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: start; gap: 13px; padding: 17px 18px; border: 1px solid #d1c1b1; border-left: 3px solid #c89b82; background: var(--paper-soft); }.check-card.severity-warning { border-left-color: #bd8a48; }.check-card.severity-critical { border-left-color: #a34e3c; }.check-card.resolved { opacity: .62; border-left-color: #799786; }.check-card-mark { display: grid; place-items: center; width: 27px; height: 27px; color: #a9795d; border: 1px solid #d6b6a2; border-radius: 50%; font: 14px var(--font-display); }.severity-warning .check-card-mark { color: #a5793e; border-color: #d5b680; }.severity-critical .check-card-mark { color: #a34e3c; border-color: #d29b8c; }.resolved .check-card-mark { color: var(--pine); border-color: #9bb2a2; }.check-card-copy > div { display: flex; gap: 8px; }.check-kind { color: var(--copper); font-size: 8px; letter-spacing: .08em; }.check-status { color: #a09385; font-size: 8px; }.check-card h3 { margin: 7px 0 4px; color: #4c433c; font: 15px var(--font-display); }.check-card p { margin: 0; color: #897c6e; font: 10px/1.6 var(--font-body); }.check-card-actions { display: flex; gap: 6px; align-self: center; }.check-card-actions button { padding: 7px 8px; color: #776b60; border: 1px solid #c8baaa; background: transparent; font-size: 8px; white-space: nowrap; }.check-card-actions button.resolve { color: #fff8ef; border-color: var(--copper); background: var(--copper); }.checks-empty { width: min(980px, 100%); margin: 0 auto; }.checks-empty > span { color: var(--pine); font-size: 27px; }.knowledge-confirm-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(20,23,26,.7); backdrop-filter: blur(4px); }.knowledge-confirm { width: min(430px, 90vw); padding: 29px 31px; background: var(--paper-soft); box-shadow: 0 24px 65px rgba(10,12,14,.38); }.knowledge-confirm h2 { margin: 10px 0 8px; font: 23px var(--font-display); }.knowledge-confirm p { color: #8c7f72; font: 10px/1.65 var(--font-body); }.knowledge-confirm > div { display: flex; justify-content: flex-end; gap: 7px; margin-top: 20px; }.knowledge-confirm button { padding: 8px 11px; color: #766b61; border: 1px solid var(--line); background: transparent; font-size: 8px; }.knowledge-confirm button.danger { color: white; border-color: #9b4332; background: #9b4332; }.knowledge-loading { grid-column: 2 / 4; display: grid; place-items: center; color: #9b8d7e; background: var(--paper); font: 16px var(--font-display); }
@keyframes knowledge-pulse { 50% { opacity: .35; transform: scale(.75); } }
@media (max-width: 1240px) { .knowledge-layout { grid-template-columns: 180px minmax(430px, 1fr) 250px; }.knowledge-canvas { padding-right: 18px; padding-left: 18px; }.knowledge-item-layout { grid-template-columns: minmax(155px, .34fr) minmax(300px, 1fr); } }
</style>
