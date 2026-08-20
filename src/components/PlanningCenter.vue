<template>
  <section class="planning-center" v-if="center">
    <header class="planning-header">
      <div>
        <span class="eyebrow copper">{{ meta.eyebrow }}</span>
        <h1>{{ meta.title }}</h1>
        <p>{{ meta.description }}</p>
      </div>
      <div class="planning-header-meta">
        <span class="planning-save-state" :class="saveState"><i></i>{{ saveStateLabel }}</span>
        <span>{{ completionCount.completed }}/{{ completionCount.total }} 项已填写</span>
        <button @click="$emit('open-settings')">规划模型 · {{ planningModelName }}</button>
      </div>
    </header>

    <div class="planning-layout">
      <aside class="planning-index">
        <template v-if="section === 'foundation'">
          <div class="index-heading"><span>创作合同</span><small>从上到下逐项确认</small></div>
          <button
            v-for="field in foundationFields"
            :key="field.key"
            class="index-check"
            :class="{ complete: hasValue(center.documents.foundation.content[field.key]) }"
            @click="focusField(field.key)"
          >
            <i></i><span>{{ field.label }}</span>
          </button>
        </template>

        <template v-else-if="section === 'characters'">
          <div class="index-heading"><span>人物档案</span><button @click="createEntity('character')">＋ 添加</button></div>
          <button
            v-for="entity in center.characters"
            :key="entity.id"
            class="entity-index-item"
            :class="{ active: selectedCharacterId === entity.id }"
            @click="selectEntity('character', entity.id)"
          >
            <b>{{ String(entity.position).padStart(2, '0') }}</b>
            <span><strong>{{ entity.title }}</strong><small>{{ entity.data.role || '角色待定义' }}</small></span>
          </button>
          <div v-if="!center.characters.length" class="index-empty">还没有人物卡<br><small>先从主角或主要对手开始</small></div>
        </template>

        <template v-else-if="section === 'world'">
          <div class="index-heading"><span>世界账本</span><small>规则先于百科</small></div>
          <button class="index-mode" :class="{ active: worldMode === 'overview' }" @click="worldMode = 'overview'">世界总览</button>
          <button class="index-mode" :class="{ active: worldMode === 'cards' }" @click="worldMode = 'cards'">设定卡片 · {{ center.worldElements.length }}</button>
          <template v-if="worldMode === 'cards'">
            <button class="index-add" @click="createEntity('world')">＋ 添加世界设定</button>
            <button
              v-for="entity in center.worldElements"
              :key="entity.id"
              class="entity-index-item compact"
              :class="{ active: selectedWorldId === entity.id }"
              @click="selectEntity('world', entity.id)"
            >
              <b>{{ String(entity.position).padStart(2, '0') }}</b>
              <span><strong>{{ entity.title }}</strong><small>{{ entity.data.category || '类型待定义' }}</small></span>
            </button>
          </template>
        </template>

        <template v-else>
          <div class="index-heading"><span>结构层级</span><small>从全书到章节</small></div>
          <button class="index-mode" :class="{ active: structureMode === 'outline' }" @click="structureMode = 'outline'">总纲骨架</button>
          <button class="index-mode" :class="{ active: structureMode === 'volumes' }" @click="structureMode = 'volumes'">分卷 / 阶段 · {{ center.volumes.length }}</button>
          <button class="index-mode" :class="{ active: structureMode === 'chapters' }" @click="structureMode = 'chapters'">章节规划 · {{ center.chapters.length }}</button>
          <template v-if="structureMode === 'volumes'">
            <button class="index-add" @click="createEntity('volume')">＋ 添加分卷</button>
            <button
              v-for="entity in center.volumes"
              :key="entity.id"
              class="entity-index-item compact"
              :class="{ active: selectedVolumeId === entity.id }"
              @click="selectEntity('volume', entity.id)"
            >
              <b>{{ String(entity.position).padStart(2, '0') }}</b>
              <span><strong>{{ entity.title }}</strong><small>{{ entity.data.chapterRange || '范围待定' }}</small></span>
            </button>
          </template>
          <template v-if="structureMode === 'chapters'">
            <button
              v-for="chapter in center.chapters"
              :key="chapter.id"
              class="entity-index-item compact"
              :class="{ active: selectedChapterId === chapter.id }"
              @click="selectChapterPlan(chapter.id)"
            >
              <b>{{ String(chapter.chapterNo).padStart(2, '0') }}</b>
              <span><strong>{{ chapter.title }}</strong><small>{{ chapter.card.goal ? '章节合同已填写' : '等待规划' }}</small></span>
            </button>
          </template>
        </template>
      </aside>

      <main class="planning-canvas">
        <div v-if="section === 'foundation'" class="planning-sheet">
          <div class="sheet-heading">
            <div><span>FOUNDATION / {{ project.genre }}</span><h2>这本书为什么必须成立</h2></div>
            <p>先固定会影响全书选择的事实。仍不确定的部分可以空着，也可以逐项生成候选。</p>
          </div>
          <div class="planning-field-grid">
            <PlanningField
              v-for="field in foundationFields"
              :id="`planning-field-${field.key}`"
              :key="field.key"
              :field="field"
              :model-value="center.documents.foundation.content[field.key]"
              :busy="isGenerating('document', 'foundation', field.key)"
              @update:model-value="updateDocumentField('foundation', field.key, $event)"
              @generate="generateDocumentField('foundation', field)"
            />
          </div>
        </div>

        <div v-else-if="section === 'characters'" class="planning-sheet">
          <EntityEditor
            v-if="selectedCharacter"
            kind="character"
            :entity="selectedCharacter"
            :entity-count="center.characters.length"
            :fields="entityFields.character"
            :generation-key="generationKey"
            @update-title="updateEntityTitle(selectedCharacter, $event)"
            @update-field="updateEntityField(selectedCharacter, $event.key, $event.value)"
            @generate-title="generateEntityTitle(selectedCharacter)"
            @generate-field="generateEntityField(selectedCharacter, $event)"
            @move="moveEntity('character', selectedCharacter, $event)"
            @delete="requestEntityDelete(selectedCharacter)"
          />
          <EmptyPlanning v-else title="从一个会主动做选择的人开始" copy="建立主角、主要对手或关键盟友。人物卡不需要一次写完，每一个字段都可以手写或让 AI 提供候选。" action="添加第一张人物卡" @action="createEntity('character')" />
        </div>

        <div v-else-if="section === 'world'" class="planning-sheet">
          <template v-if="worldMode === 'overview'">
            <div class="sheet-heading">
              <div><span>WORLD CONTRACT</span><h2>先写约束行动的世界规则</h2></div>
              <p>世界观总览负责共同规则；具体地点、组织、物件和历史放进设定卡片。</p>
            </div>
            <div class="planning-field-grid">
              <PlanningField
                v-for="field in worldOverviewFields"
                :key="field.key"
                :field="field"
                :model-value="center.documents.world.content[field.key]"
                :busy="isGenerating('document', 'world', field.key)"
                @update:model-value="updateDocumentField('world', field.key, $event)"
                @generate="generateDocumentField('world', field)"
              />
            </div>
          </template>
          <EntityEditor
            v-else-if="selectedWorldElement"
            kind="world"
            :entity="selectedWorldElement"
            :entity-count="center.worldElements.length"
            :fields="entityFields.world"
            :generation-key="generationKey"
            @update-title="updateEntityTitle(selectedWorldElement, $event)"
            @update-field="updateEntityField(selectedWorldElement, $event.key, $event.value)"
            @generate-title="generateEntityTitle(selectedWorldElement)"
            @generate-field="generateEntityField(selectedWorldElement, $event)"
            @move="moveEntity('world', selectedWorldElement, $event)"
            @delete="requestEntityDelete(selectedWorldElement)"
          />
          <EmptyPlanning v-else title="建立第一条可被剧情检验的设定" copy="它可以是地点、组织、规则、物件或一段仍在影响现在的历史。" action="添加世界设定" @action="createEntity('world')" />
        </div>

        <div v-else class="planning-sheet">
          <template v-if="structureMode === 'outline'">
            <div class="sheet-heading">
              <div><span>STORY SPINE</span><h2>全书转折骨架</h2></div>
              <p>这里不是章节摘要的堆叠，而是主角一次次改变策略后形成的因果链。</p>
            </div>
            <div class="planning-field-grid">
              <PlanningField
                v-for="field in outlineFields"
                :key="field.key"
                :field="field"
                :model-value="center.documents.outline.content[field.key]"
                :busy="isGenerating('document', 'outline', field.key)"
                @update:model-value="updateDocumentField('outline', field.key, $event)"
                @generate="generateDocumentField('outline', field)"
              />
            </div>
          </template>
          <EntityEditor
            v-else-if="structureMode === 'volumes' && selectedVolume"
            kind="volume"
            :entity="selectedVolume"
            :entity-count="center.volumes.length"
            :fields="entityFields.volume"
            :generation-key="generationKey"
            @update-title="updateEntityTitle(selectedVolume, $event)"
            @update-field="updateEntityField(selectedVolume, $event.key, $event.value)"
            @generate-title="generateEntityTitle(selectedVolume)"
            @generate-field="generateEntityField(selectedVolume, $event)"
            @move="moveEntity('volume', selectedVolume, $event)"
            @delete="requestEntityDelete(selectedVolume)"
          />
          <EmptyPlanning v-else-if="structureMode === 'volumes'" title="把长篇拆成会改变局势的阶段" copy="每一卷都应有独立目标、主要阻力、阶段变化和卷末兑现。" action="添加第一卷" @action="createEntity('volume')" />
          <template v-else-if="structureMode === 'chapters' && selectedChapter">
            <div class="entity-editor-heading chapter-plan-heading">
              <div><span>CHAPTER {{ String(selectedChapter.chapterNo).padStart(2, '0') }}</span><h2>{{ selectedChapter.title }}</h2><p>章节规划会直接进入正文生成上下文。</p></div>
              <span class="chapter-plan-status">{{ selectedChapter.status === 'draft' ? '草稿' : selectedChapter.status }}</span>
            </div>
            <div class="planning-field-grid">
              <PlanningField
                v-for="field in chapterPlanFields"
                :key="field.key"
                :field="field"
                :model-value="chapterFieldValue(selectedChapter, field)"
                :busy="isGenerating('chapter', selectedChapter.id, field.key)"
                @update:model-value="updateChapterField(selectedChapter, field, $event)"
                @generate="generateChapterField(selectedChapter, field)"
              />
            </div>
          </template>
          <EmptyPlanning v-else-if="structureMode === 'chapters'" title="项目中还没有章节" copy="回到创作桌面添加章节后，就能在这里逐章建立章节合同。" />
        </div>
      </main>

      <aside class="candidate-rail">
        <div class="candidate-heading">
          <div><span class="eyebrow">AI CANDIDATES</span><h2>候选签批</h2></div>
          <span class="candidate-count">{{ center.candidates.length }}</span>
        </div>
        <label class="candidate-instruction">
          <span>本次补充要求</span>
          <textarea v-model="generationInstruction" placeholder="只影响下一次规划生成…"></textarea>
        </label>

        <div v-if="generationVisible" class="candidate-stream">
          <div><i></i><strong>{{ generationFieldLabel }}</strong><button @click="cancelGeneration">取消</button></div>
          <pre>{{ generationStream || generationStatus }}</pre>
        </div>

        <template v-else-if="activeCandidate">
          <div class="candidate-target"><span>{{ candidateTargetLabel(activeCandidate) }}</span><strong>{{ activeCandidate.fieldLabel || activeCandidate.fieldKey }}</strong></div>
          <div class="candidate-version original"><span>当前正式内容</span><pre>{{ activeCandidate.originalValue || '尚未填写' }}</pre></div>
          <div class="candidate-version proposed"><span>AI 候选</span><pre>{{ activeCandidate.candidateValue }}</pre></div>
          <div class="candidate-model">{{ activeCandidate.model?.name || 'MockProvider' }} · {{ formatTime(activeCandidate.createdAt) }}</div>
          <div class="candidate-actions">
            <button @click="resolveCandidate(activeCandidate, 'discarded')">放弃</button>
            <button class="accept" @click="resolveCandidate(activeCandidate, 'accepted')">接受为正式内容</button>
          </div>
        </template>

        <div v-else class="candidate-empty">
          <span>◌</span>
          <strong>AI 不会直接改写规划</strong>
          <p>点击任一字段右上角的“AI 候选”，结果会先来到这里。确认后才写入正式内容。</p>
        </div>

        <div v-if="center.candidates.length > 1 && !generationVisible" class="candidate-queue">
          <span>待处理候选</span>
          <button v-for="item in center.candidates" :key="item.id" :class="{ active: item.id === activeCandidateId }" @click="activeCandidateId = item.id">
            <strong>{{ item.fieldLabel || item.fieldKey }}</strong><small>{{ candidateTargetLabel(item) }}</small>
          </button>
        </div>
      </aside>
    </div>

    <div v-if="deleteTarget" class="planning-confirm-backdrop" @mousedown.self="deleteTarget = null">
      <section class="planning-confirm">
        <span class="eyebrow copper">REMOVE CARD</span>
        <h2>删除“{{ deleteTarget.title }}”？</h2>
        <p>这张规划卡及尚未处理的字段候选会一并移除，其他人物、设定或分卷不会改变。</p>
        <div><button @click="deleteTarget = null">取消</button><button class="danger" @click="confirmEntityDelete">删除卡片</button></div>
      </section>
    </div>
  </section>
  <div v-else class="planning-loading">{{ loadError ? `规划中心打开失败：${loadError}` : '正在铺开故事资料…' }}</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import { chapterPlanFields, entityFields, foundationFields, outlineFields, sectionMeta, worldOverviewFields } from '../services/planning-schema.js'
import PlanningField from './PlanningField.vue'
import EntityEditor from './planning/EntityEditor.vue'
import EmptyPlanning from './planning/EmptyPlanning.vue'

const props = defineProps({
  project: { type: Object, required: true },
  section: { type: String, default: 'foundation' },
  modelSettings: { type: Object, required: true },
})

const emit = defineEmits(['toast', 'open-settings', 'chapter-updated'])
const center = ref(null)
const loadError = ref('')
const saveState = ref('saved')
const selectedCharacterId = ref('')
const selectedWorldId = ref('')
const selectedVolumeId = ref('')
const selectedChapterId = ref('')
const worldMode = ref('overview')
const structureMode = ref('outline')
const activeCandidateId = ref('')
const generationInstruction = ref('')
const generationKey = ref('')
const generationVisible = ref(false)
const generationStream = ref('')
const generationStatus = ref('')
const generationFieldLabel = ref('')
const deleteTarget = ref(null)
const documentTimers = new Map()
const entityTimers = new Map()
const chapterTimers = new Map()
const dirtyDocuments = new Set()
const dirtyEntities = new Set()
const dirtyChapters = new Set()
const activeSaves = new Set()
let activeGeneration = null

const meta = computed(() => sectionMeta[props.section] || sectionMeta.foundation)
const selectedCharacter = computed(() => center.value?.characters.find((item) => item.id === selectedCharacterId.value))
const selectedWorldElement = computed(() => center.value?.worldElements.find((item) => item.id === selectedWorldId.value))
const selectedVolume = computed(() => center.value?.volumes.find((item) => item.id === selectedVolumeId.value))
const selectedChapter = computed(() => center.value?.chapters.find((item) => item.id === selectedChapterId.value))
const activeCandidate = computed(() => center.value?.candidates.find((item) => item.id === activeCandidateId.value) || center.value?.candidates[0])
const planningModelName = computed(() => {
  const id = props.modelSettings.routes?.planning_field
  return props.modelSettings.profiles.find((profile) => profile.id === id)?.name || 'MockProvider'
})
const saveStateLabel = computed(() => ({ dirty: '等待自动保存', saving: '正在保存', saved: '规划已保存', error: '保存失败' }[saveState.value]))
const completionCount = computed(() => {
  if (!center.value) return { completed: 0, total: 0 }
  if (props.section === 'foundation') return countFields(center.value.documents.foundation.content, foundationFields)
  if (props.section === 'world' && worldMode.value === 'overview') return countFields(center.value.documents.world.content, worldOverviewFields)
  if (props.section === 'outline' && structureMode.value === 'outline') return countFields(center.value.documents.outline.content, outlineFields)
  if (props.section === 'outline' && structureMode.value === 'chapters' && selectedChapter.value) {
    return { completed: chapterPlanFields.filter((field) => hasValue(chapterFieldValue(selectedChapter.value, field))).length, total: chapterPlanFields.length }
  }
  const entity = props.section === 'characters' ? selectedCharacter.value : props.section === 'world' ? selectedWorldElement.value : selectedVolume.value
  const fields = props.section === 'characters' ? entityFields.character : props.section === 'world' ? entityFields.world : entityFields.volume
  return entity ? { completed: fields.filter((field) => hasValue(entity.data[field.key])).length + (hasValue(entity.title) ? 1 : 0), total: fields.length + 1 } : { completed: 0, total: fields.length + 1 }
})

onMounted(loadCenter)
watch(() => props.project.id, async () => { await flushSaves(); await loadCenter() })
watch(() => props.section, async (value) => {
  await flushSaves()
  if (value === 'world' && !['overview', 'cards'].includes(worldMode.value)) worldMode.value = 'overview'
})
onBeforeUnmount(() => {
  void activeGeneration?.cancel()
  void flushSaves()
})

async function loadCenter() {
  loadError.value = ''
  try {
    center.value = await appService.loadPlanningCenter(props.project.id)
    selectedCharacterId.value = keepOrFirst(selectedCharacterId.value, center.value.characters)
    selectedWorldId.value = keepOrFirst(selectedWorldId.value, center.value.worldElements)
    selectedVolumeId.value = keepOrFirst(selectedVolumeId.value, center.value.volumes)
    selectedChapterId.value = keepOrFirst(selectedChapterId.value, center.value.chapters)
    activeCandidateId.value = keepOrFirst(activeCandidateId.value, center.value.candidates)
    saveState.value = 'saved'
  } catch (error) {
    loadError.value = error.message
    emit('toast', `读取故事规划失败：${error.message}`)
  }
}

function keepOrFirst(currentId, list) {
  return list.some((item) => item.id === currentId) ? currentId : list[0]?.id || ''
}

function hasValue(value) { return Boolean(String(value || '').trim()) }
function countFields(content, fields) { return { completed: fields.filter((field) => hasValue(content[field.key])).length, total: fields.length } }
function focusField(key) { document.getElementById(`planning-field-${key}`)?.querySelector('input, textarea')?.focus() }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' }

function updateDocumentField(kind, key, value) {
  center.value.documents[kind].content[key] = value
  dirtyDocuments.add(kind)
  saveState.value = 'dirty'
  schedule(documentTimers, kind, () => saveDocument(kind))
}

function updateEntityTitle(entity, value) {
  entity.title = value
  markEntityDirty(entity)
}

function updateEntityField(entity, key, value) {
  entity.data[key] = value
  markEntityDirty(entity)
}

function markEntityDirty(entity) {
  dirtyEntities.add(entity.id)
  saveState.value = 'dirty'
  schedule(entityTimers, entity.id, () => saveEntity(entity.id))
}

function chapterFieldValue(chapter, field) {
  return field.special ? chapter.scenePlan || '' : String(chapter.card?.[field.key] || '')
}

function updateChapterField(chapter, field, value) {
  if (field.special) chapter.scenePlan = value
  else chapter.card[field.key] = value
  dirtyChapters.add(chapter.id)
  saveState.value = 'dirty'
  schedule(chapterTimers, chapter.id, () => saveChapter(chapter.id))
}

function schedule(timerMap, key, action) {
  if (timerMap.has(key)) clearTimeout(timerMap.get(key))
  timerMap.set(key, setTimeout(() => {
    timerMap.delete(key)
    Promise.resolve().then(action).catch(() => {})
  }, 800))
}

function cloneForIpc(value) {
  return JSON.parse(JSON.stringify(value ?? {}))
}

function trackSave(promise) {
  activeSaves.add(promise)
  promise.then(() => activeSaves.delete(promise), () => activeSaves.delete(promise))
  return promise
}

async function saveDocument(kind) {
  if (!dirtyDocuments.has(kind)) return
  dirtyDocuments.delete(kind)
  saveState.value = 'saving'
  return trackSave(appService.savePlanningDocument({ projectId: props.project.id, kind, content: cloneForIpc(center.value.documents[kind].content) })
    .then((saved) => { center.value.documents[kind] = saved; settleSaveState() })
    .catch((error) => { dirtyDocuments.add(kind); saveState.value = 'error'; emit('toast', `规划保存失败：${error.message}`); throw error }))
}

async function saveEntity(entityId) {
  if (!dirtyEntities.has(entityId)) return
  const entity = allEntities().find((item) => item.id === entityId)
  if (!entity) return
  dirtyEntities.delete(entityId)
  saveState.value = 'saving'
  return trackSave(appService.updatePlanningEntity({ id: entity.id, title: entity.title, data: cloneForIpc(entity.data) })
    .then((saved) => { replaceEntity(saved); settleSaveState() })
    .catch((error) => { dirtyEntities.add(entityId); saveState.value = 'error'; emit('toast', `规划卡片保存失败：${error.message}`); throw error }))
}

async function saveChapter(chapterId) {
  if (!dirtyChapters.has(chapterId)) return
  const chapter = center.value.chapters.find((item) => item.id === chapterId)
  if (!chapter) return
  dirtyChapters.delete(chapterId)
  saveState.value = 'saving'
  return trackSave(appService.updateChapter({ id: chapter.id, card: cloneForIpc(chapter.card), scenePlan: chapter.scenePlan })
    .then((saved) => { chapter.updatedAt = saved.updated_at; settleSaveState(); emit('chapter-updated', saved) })
    .catch((error) => { dirtyChapters.add(chapterId); saveState.value = 'error'; emit('toast', `章节规划保存失败：${error.message}`); throw error }))
}

function settleSaveState() {
  saveState.value = dirtyDocuments.size || dirtyEntities.size || dirtyChapters.size ? 'dirty' : 'saved'
}

async function flushSaves() {
  for (const timer of documentTimers.values()) clearTimeout(timer)
  for (const timer of entityTimers.values()) clearTimeout(timer)
  for (const timer of chapterTimers.values()) clearTimeout(timer)
  documentTimers.clear(); entityTimers.clear(); chapterTimers.clear()
  const tasks = [
    ...Array.from(dirtyDocuments, (kind) => saveDocument(kind)),
    ...Array.from(dirtyEntities, (id) => saveEntity(id)),
    ...Array.from(dirtyChapters, (id) => saveChapter(id)),
  ].filter(Boolean)
  await Promise.all(tasks)
  if (activeSaves.size) await Promise.all(Array.from(activeSaves))
  return true
}

function allEntities() { return [...center.value.characters, ...center.value.worldElements, ...center.value.volumes] }
function entityList(kind) { return kind === 'character' ? center.value.characters : kind === 'world' ? center.value.worldElements : center.value.volumes }
function replaceEntity(saved) {
  const list = entityList(saved.kind)
  const index = list.findIndex((item) => item.id === saved.id)
  if (index >= 0) list[index] = saved
}

async function createEntity(kind) {
  await flushSaves()
  try {
    const entity = await appService.createPlanningEntity({ projectId: props.project.id, kind })
    entityList(kind).push(entity)
    if (kind === 'character') selectedCharacterId.value = entity.id
    if (kind === 'world') { selectedWorldId.value = entity.id; worldMode.value = 'cards' }
    if (kind === 'volume') { selectedVolumeId.value = entity.id; structureMode.value = 'volumes' }
    emit('toast', `${entity.title}已建立`)
  } catch (error) { emit('toast', `添加规划卡片失败：${error.message}`) }
}

async function selectEntity(kind, id) {
  await flushSaves()
  if (kind === 'character') selectedCharacterId.value = id
  if (kind === 'world') selectedWorldId.value = id
  if (kind === 'volume') selectedVolumeId.value = id
}

async function selectChapterPlan(id) { await flushSaves(); selectedChapterId.value = id }

async function moveEntity(kind, entity, direction) {
  await flushSaves()
  const list = entityList(kind)
  const from = list.findIndex((item) => item.id === entity.id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= list.length) return
  const ids = list.map((item) => item.id)
  ids.splice(to, 0, ids.splice(from, 1)[0])
  try {
    const reordered = await appService.reorderPlanningEntities({ projectId: props.project.id, kind, entityIds: ids })
    if (kind === 'character') center.value.characters = reordered
    if (kind === 'world') center.value.worldElements = reordered
    if (kind === 'volume') center.value.volumes = reordered
  } catch (error) { emit('toast', `调整顺序失败：${error.message}`) }
}

function requestEntityDelete(entity) { deleteTarget.value = entity }
async function confirmEntityDelete() {
  const entity = deleteTarget.value
  if (!entity) return
  await flushSaves()
  try {
    const remaining = await appService.deletePlanningEntity(entity.id)
    if (entity.kind === 'character') { center.value.characters = remaining; selectedCharacterId.value = remaining[0]?.id || '' }
    if (entity.kind === 'world') { center.value.worldElements = remaining; selectedWorldId.value = remaining[0]?.id || '' }
    if (entity.kind === 'volume') { center.value.volumes = remaining; selectedVolumeId.value = remaining[0]?.id || '' }
    center.value.candidates = center.value.candidates.filter((item) => !(item.targetType === 'entity' && item.targetId === entity.id))
    deleteTarget.value = null
    emit('toast', `“${entity.title}”已删除`)
  } catch (error) { emit('toast', `删除规划卡片失败：${error.message}`) }
}

function generateDocumentField(kind, field) {
  return startFieldGeneration(field, {
    targetType: 'document', targetId: kind, targetLabel: meta.value.title,
    currentValue: center.value.documents[kind].content[field.key] || '',
    nearbyContext: JSON.stringify(center.value.documents[kind].content),
  })
}

function generateEntityTitle(entity) {
  return startFieldGeneration({ key: 'title', label: entity.kind === 'character' ? '人物姓名 / 称谓' : entity.kind === 'world' ? '设定名称' : '分卷名称' }, {
    targetType: 'entity', targetId: entity.id, targetLabel: entity.title, currentValue: entity.title,
    nearbyContext: JSON.stringify(entity.data),
  })
}

function generateEntityField(entity, field) {
  return startFieldGeneration(field, {
    targetType: 'entity', targetId: entity.id, targetLabel: entity.title,
    currentValue: entity.data[field.key] || '', nearbyContext: JSON.stringify(entity.data),
  })
}

function generateChapterField(chapter, field) {
  return startFieldGeneration(field, {
    targetType: 'chapter', targetId: chapter.id, targetLabel: `第 ${chapter.chapterNo} 章 · ${chapter.title}`,
    currentValue: chapterFieldValue(chapter, field), nearbyContext: JSON.stringify({ card: chapter.card, scenePlan: chapter.scenePlan }),
    chapterId: chapter.id,
  })
}

async function startFieldGeneration(field, target) {
  if (activeGeneration) return
  try { await flushSaves() } catch { return }
  generationKey.value = `${target.targetType}:${target.targetId}:${field.key}`
  generationVisible.value = true
  generationStream.value = ''
  generationStatus.value = '模型正在阅读已确认的规划…'
  generationFieldLabel.value = field.label
  const generation = appService.startGeneration({
    task: 'planning_field', projectId: props.project.id, chapterId: target.chapterId,
    instruction: generationInstruction.value,
    modelProfileId: props.modelSettings.routes?.planning_field,
    planning: {
      sectionLabel: meta.value.title,
      targetLabel: target.targetLabel,
      fieldKey: field.key,
      fieldLabel: field.label,
      currentValue: target.currentValue,
      nearbyContext: target.nearbyContext,
    },
  }, handleGenerationEvent)
  activeGeneration = generation
  try {
    const result = await generation.promise
    const candidate = await appService.createPlanningCandidate({
      projectId: props.project.id,
      targetType: target.targetType,
      targetId: target.targetId,
      fieldKey: field.key,
      fieldLabel: field.label,
      originalValue: target.currentValue,
      candidateValue: result.text,
      instruction: generationInstruction.value,
      model: result.model,
    })
    center.value.candidates.unshift(candidate)
    activeCandidateId.value = candidate.id
    emit('toast', `${field.label}候选已生成，请在右侧确认`)
  } catch (error) {
    emit('toast', error.message.includes('取消') ? '规划生成已取消' : `规划生成失败：${error.message}`)
  } finally {
    activeGeneration = null
    generationVisible.value = false
    generationKey.value = ''
  }
}

function handleGenerationEvent(event) {
  if (event.type === 'delta') { generationStream.value += event.delta || ''; generationStatus.value = '候选内容持续抵达中…' }
  if (event.type === 'gateway-fallback') generationStatus.value = 'Go 服务未响应，已接续到内置服务…'
  if (event.type === 'started') generationStatus.value = '模型已接收规划任务…'
}

async function cancelGeneration() { await activeGeneration?.cancel() }
function isGenerating(targetType, targetId, fieldKey) { return generationKey.value === `${targetType}:${targetId}:${fieldKey}` }

async function resolveCandidate(candidate, decision) {
  try {
    await flushSaves()
    await appService.resolvePlanningCandidate({ candidateId: candidate.id, decision })
    await loadCenter()
    emit('toast', decision === 'accepted' ? `${candidate.fieldLabel}候选已接受` : `${candidate.fieldLabel}候选已放弃`)
  } catch (error) { emit('toast', `候选处理失败：${error.message}`) }
}

function candidateTargetLabel(candidate) {
  if (candidate.targetType === 'document') return sectionMeta[candidate.targetId]?.title || '规划文档'
  if (candidate.targetType === 'entity') return allEntities().find((item) => item.id === candidate.targetId)?.title || '规划卡片'
  const chapter = center.value.chapters.find((item) => item.id === candidate.targetId)
  return chapter ? `第 ${chapter.chapterNo} 章 · ${chapter.title}` : '章节规划'
}

defineExpose({ flushSaves })
</script>

<style scoped>
.planning-center { grid-column: 2 / 4; min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); color: var(--ink); background: #eee7da; }
.planning-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; padding: 24px 28px 20px; color: #f5f1e8; border-bottom: 1px solid #3f464b; background: #262c31; }
.planning-header h1 { margin: 8px 0 4px; font: 28px/1.15 var(--font-display); }
.planning-header p { margin: 0; color: #9ca4a8; font-size: 10px; }
.planning-header-meta { display: flex; align-items: center; gap: 12px; color: #8f989c; font-size: 9px; }
.planning-header-meta button { padding: 7px 9px; color: #d7c5b6; border: 1px solid #545d62; background: transparent; font-size: 9px; }
.planning-save-state { display: inline-flex; align-items: center; gap: 6px; color: #9eb9ac; }
.planning-save-state i { width: 5px; height: 5px; border-radius: 50%; background: #72a089; }
.planning-save-state.dirty { color: #d8b878; }.planning-save-state.dirty i { background: #c8964a; }
.planning-save-state.saving i { animation: save-pulse .8s ease-in-out infinite; }.planning-save-state.error { color: #df8c78; }.planning-save-state.error i { background: #c75e48; }
.planning-layout { min-height: 0; display: grid; grid-template-columns: 205px minmax(430px, 1fr) 285px; }
.planning-index { min-height: 0; overflow: auto; padding: 17px 10px 28px; color: #c8ccce; border-right: 1px solid #434b50; background: #2b3238; }
.index-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px 12px; color: #899299; font-size: 8px; letter-spacing: .1em; }
.index-heading small { color: #657078; font-size: 7px; letter-spacing: 0; }.index-heading button { padding: 3px 5px; color: var(--copper-light); border: 0; background: transparent; font-size: 8px; }
.index-check { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 8px; color: #9ca4a8; border: 0; background: transparent; text-align: left; font-size: 10px; }
.index-check:hover { color: #f4efe6; background: #353e44; }.index-check i { width: 6px; height: 6px; border: 1px solid #69747a; border-radius: 50%; }.index-check.complete i { border-color: #719682; background: #719682; box-shadow: 0 0 0 3px rgba(113,150,130,.11); }.index-check.complete { color: #c4ceca; }
.index-mode { width: 100%; padding: 10px 9px; color: #a7aeb1; border: 0; border-left: 2px solid transparent; background: transparent; text-align: left; font: 11px var(--font-display); }
.index-mode:hover, .index-mode.active { color: #fff8ef; background: #353e44; border-left-color: var(--copper); }
.index-add { width: calc(100% - 12px); margin: 10px 6px; padding: 7px; color: #dc9279; border: 1px dashed #6e5048; background: transparent; font-size: 8px; }
.entity-index-item { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 10px 8px; color: #bbc0c2; border: 1px solid transparent; background: transparent; text-align: left; }
.entity-index-item:hover, .entity-index-item.active { background: #353e44; border-color: #4e585d; }.entity-index-item.active { box-shadow: inset 2px 0 0 var(--copper); }
.entity-index-item b { color: #cf7b63; font: 8px var(--font-ui); }.entity-index-item > span { min-width: 0; display: grid; gap: 4px; }.entity-index-item strong { overflow: hidden; font: 11px var(--font-display); text-overflow: ellipsis; white-space: nowrap; }.entity-index-item small { overflow: hidden; color: #747f85; text-overflow: ellipsis; white-space: nowrap; font-size: 7px; }.entity-index-item.compact { padding-top: 8px; padding-bottom: 8px; }
.index-empty { margin: 10px 7px; padding: 14px 10px; color: #899399; border: 1px dashed #566168; font: 11px/1.6 var(--font-display); }.index-empty small { font: 8px var(--font-ui); }
.planning-canvas { min-width: 0; min-height: 0; overflow: auto; padding: 25px 28px 60px; background: #eee7da; }
.planning-sheet { width: min(820px, 100%); margin: 0 auto; padding: 29px 32px 44px; background: var(--paper-soft); box-shadow: 0 8px 28px rgba(62,49,39,.08); }
.sheet-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
.sheet-heading span, .entity-editor-heading span { color: var(--copper); font: 600 8px var(--font-ui); letter-spacing: .14em; }.sheet-heading h2, .entity-editor-heading h2 { margin: 8px 0 0; font: 24px/1.25 var(--font-display); }.sheet-heading p { max-width: 260px; margin: 2px 0 0; color: #918578; font: 9px/1.65 var(--font-body); }
.planning-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 23px 18px; }
.candidate-rail { min-height: 0; overflow: auto; color: #514a43; border-left: 1px solid #cec2b3; background: #e5dccd; }
.candidate-heading { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 20px 17px; border-bottom: 1px solid #cfc3b4; }.candidate-heading h2 { margin: 8px 0 0; font: 19px var(--font-display); }.candidate-count { display: grid; place-items: center; min-width: 23px; height: 23px; color: #fff7ed; border-radius: 50%; background: var(--copper); font-size: 9px; }
.candidate-instruction { display: grid; gap: 7px; padding: 15px 20px; border-bottom: 1px solid #d0c4b5; }.candidate-instruction span { color: #8b7e70; font-size: 8px; }.candidate-instruction textarea { min-height: 54px; padding: 8px; color: #554d45; border: 1px solid #cbbdab; outline: 0; resize: vertical; background: rgba(255,255,255,.35); font: 9px/1.5 var(--font-body); }.candidate-instruction textarea:focus { border-color: var(--copper-light); background: #fffaf2; }
.candidate-stream { margin: 17px 16px; border: 1px solid #cda992; border-left: 3px solid var(--copper); background: #fff8ef; box-shadow: 0 8px 20px rgba(80,57,43,.1); }.candidate-stream > div { display: flex; align-items: center; gap: 7px; padding: 8px 9px; color: #76685d; border-bottom: 1px solid #e0ccbc; font-size: 8px; }.candidate-stream i { width: 6px; height: 6px; border-radius: 50%; background: var(--copper); animation: save-pulse .8s infinite; }.candidate-stream button { margin-left: auto; color: var(--copper); border: 0; background: transparent; font-size: 8px; }.candidate-stream pre { max-height: 260px; overflow: auto; margin: 0; padding: 12px; color: #51473f; font: 11px/1.75 var(--font-body); white-space: pre-wrap; }
.candidate-target { display: grid; gap: 6px; padding: 17px 20px 13px; }.candidate-target span { color: #9b8d7f; font-size: 8px; }.candidate-target strong { font: 16px var(--font-display); }
.candidate-version { margin: 0 16px 10px; padding: 12px; border: 1px solid #cec0ae; background: rgba(255,255,255,.26); }.candidate-version span { color: #978778; font-size: 8px; }.candidate-version pre { margin: 8px 0 0; color: #675d53; font: 10px/1.7 var(--font-body); white-space: pre-wrap; }.candidate-version.proposed { border-color: #d2a48e; border-left: 3px solid var(--copper); background: #fff8ef; }.candidate-version.proposed pre { color: #493f37; font-size: 11px; }
.candidate-model { padding: 2px 20px 13px; color: #a09385; font-size: 7px; }.candidate-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 7px; padding: 0 16px 18px; }.candidate-actions button { padding: 9px; color: #776b60; border: 1px solid #c8baaa; background: transparent; font-size: 8px; }.candidate-actions .accept { color: #fff8ef; border-color: var(--copper); background: var(--copper); }
.candidate-empty { display: grid; justify-items: center; padding: 48px 25px; color: #8d8073; text-align: center; }.candidate-empty > span { color: var(--copper); font-size: 28px; }.candidate-empty strong { margin-top: 10px; color: #5d544c; font: 14px var(--font-display); }.candidate-empty p { margin: 8px 0 0; font: 9px/1.65 var(--font-body); }
.candidate-queue { display: grid; gap: 4px; padding: 14px 16px 25px; border-top: 1px solid #cfc3b4; }.candidate-queue > span { margin-bottom: 5px; color: #918375; font-size: 8px; }.candidate-queue button { display: grid; gap: 3px; padding: 8px 9px; color: #71675d; border: 1px solid transparent; background: rgba(255,255,255,.2); text-align: left; }.candidate-queue button.active { border-color: #c69b84; background: #fff8ef; }.candidate-queue strong { font: 10px var(--font-display); }.candidate-queue small { color: #9b8e81; font-size: 7px; }
.entity-editor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 25px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }.chapter-plan-heading p { margin: 7px 0 0; color: #93877b; font-size: 9px; }.chapter-plan-status { padding: 5px 7px; border: 1px solid #d5b6a3; }
.planning-confirm-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(20,23,26,.7); backdrop-filter: blur(4px); }.planning-confirm { width: min(430px, 90vw); padding: 29px 31px; background: var(--paper-soft); box-shadow: 0 24px 65px rgba(10,12,14,.38); }.planning-confirm h2 { margin: 10px 0 8px; font: 23px var(--font-display); }.planning-confirm p { color: #8c7f72; font: 10px/1.65 var(--font-body); }.planning-confirm > div { display: flex; justify-content: flex-end; gap: 7px; margin-top: 20px; }.planning-confirm button { padding: 8px 11px; color: #766b61; border: 1px solid var(--line); background: transparent; font-size: 8px; }.planning-confirm button.danger { color: white; border-color: #9b4332; background: #9b4332; }
.planning-loading { grid-column: 2 / 4; display: grid; place-items: center; color: #9b8d7e; background: var(--paper); font: 16px var(--font-display); }
@keyframes save-pulse { 50% { opacity: .35; transform: scale(.75); } }
@media (max-width: 1240px) { .planning-layout { grid-template-columns: 180px minmax(400px, 1fr) 250px; }.planning-canvas { padding-right: 18px; padding-left: 18px; }.planning-sheet { padding-right: 24px; padding-left: 24px; } }
</style>
