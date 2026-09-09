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
        <button type="button" @click="showCandidates">查看候选 · {{ center.candidates.length }}</button>
        <button @click="$emit('open-settings')">{{ defaultExecutionMode === 'codex' ? '创作方式 · Codex' : `规划模型 · ${planningModelName}` }}</button>
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
          <button class="index-mode" :class="{ active: characterMode === 'files' }" @click="characterMode = 'files'">人物卡 · {{ center.characters.length }}</button>
          <button class="index-mode" :class="{ active: characterMode === 'relationships' }" @click="openRelationshipGraph">关系图 · {{ center.relationships.length }}</button>
          <template v-if="characterMode === 'files'">
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
          <template v-else>
            <button class="index-add" :disabled="center.characters.length < 2" @click="startRelationshipCreate">＋ 添加人物关系</button>
            <button
              v-for="relationship in center.relationships"
              :key="relationship.id"
              class="relationship-index-item"
              :class="{ active: selectedRelationshipId === relationship.id }"
              @click="selectRelationship(relationship.id)"
            >
              <span>{{ relationship.fromCharacterName }} ↔ {{ relationship.toCharacterName }}</span>
              <small>{{ relationship.label }} · {{ relationshipTrendLabel(relationship.trend) }}</small>
            </button>
          </template>
        </template>

        <template v-else-if="section === 'world'">
          <div class="index-heading"><span>世界账本</span><small>规则先于百科</small></div>
          <button class="index-mode" :class="{ active: worldMode === 'overview' }" @click="worldMode = 'overview'">世界总览</button>
          <button class="index-mode" :class="{ active: worldMode === 'cards' }" @click="worldMode = 'cards'">设定卡片 · {{ center.worldElements.length }}</button>
          <button class="index-mode" :class="{ active: worldMode === 'locations' }" @click="openLocationView">地点视图 · {{ center.locations.length }}</button>
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
          <button class="index-mode" :class="{ active: structureMode === 'arcs' }" @click="openStoryArcs">跨卷情节弧 · {{ center.storyArcs.length }}</button>
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
          <template v-if="structureMode === 'arcs'">
            <button class="index-add" @click="createArc">＋ 添加情节线</button>
            <button
              v-for="arc in center.storyArcs"
              :key="arc.id"
              class="arc-index-item"
              :class="[{ active: selectedArcId === arc.id }, `arc-${arc.colorKey}`]"
              @click="selectArc(arc.id)"
            >
              <i></i><span><strong>{{ arc.title }}</strong><small>{{ arcCategoryLabel(arc.category) }} · {{ arc.beats.length }} 个节点</small></span>
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
            <div class="sheet-heading-support">
              <p>先固定会影响全书选择的事实。仍不确定的部分可以空着，也可以逐项生成候选。</p>
              <CreativeExecutionControl :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="AI 补全本页" @execute="generateDocumentBundle('foundation', foundationFields, $event)" />
            </div>
          </div>
          <div class="planning-field-grid">
            <PlanningField
              v-for="field in foundationFields"
              :id="`planning-field-${field.key}`"
              :key="field.key"
              :field="field"
              :model-value="center.documents.foundation.content[field.key]"
              :busy="isGenerating('document', 'foundation', field.key)"
              :default-execution-mode="defaultExecutionMode"
              :app-model-label="planningModelName"
              @update:model-value="updateDocumentField('foundation', field.key, $event)"
              @generate="generateDocumentField('foundation', field, $event)"
              @cascade="requestDocumentChange('foundation', field)"
              @edit-default="$emit('edit-project')"
            />
          </div>
        </div>

        <div v-else-if="section === 'characters'" class="planning-sheet">
          <template v-if="characterMode === 'files'">
            <EntityEditor
              v-if="selectedCharacter"
              kind="character"
              :entity="selectedCharacter"
              :entity-count="center.characters.length"
              :fields="entityFields.character"
              :generation-key="generationKey"
              :default-execution-mode="defaultExecutionMode"
              :app-model-label="planningModelName"
              @update-title="updateEntityTitle(selectedCharacter, $event)"
              @update-field="updateEntityField(selectedCharacter, $event.key, $event.value)"
              @generate-title="generateEntityTitle(selectedCharacter, $event)"
              @generate-field="generateEntityField(selectedCharacter, $event.field, $event.mode)"
              @generate-all="generateEntityBundle(selectedCharacter, entityFields.character, $event)"
              @cascade-title="requestEntityChange(selectedCharacter, { key: 'title', label: '人物姓名 / 称谓' })"
              @cascade-field="requestEntityChange(selectedCharacter, $event.field)"
              @edit-default="$emit('edit-project')"
              @move="moveEntity('character', selectedCharacter, $event)"
              @delete="requestEntityDelete(selectedCharacter)"
            />
            <EmptyPlanning v-else title="从一个会主动做选择的人开始" copy="建立主角、主要对手或关键盟友。人物卡不需要一次写完，每一个字段都可以手写或让 AI 提供候选。" action="添加第一张人物卡" @action="createEntity('character')" />
          </template>
          <template v-else>
            <div class="sheet-heading relationship-heading">
              <div><span>RELATION CONSTELLATION</span><h2>人物不是孤立档案</h2></div>
              <p>节点来自人物卡，连线只记录作者明确确认的关系。线条颜色表示关系趋势，箭头表示影响方向。</p>
            </div>
            <div v-if="center.characters.length < 2" class="relationship-empty">
              <span>◎</span><strong>至少需要两张人物卡</strong><p>先建立故事中会彼此改变选择的两个人物，再连接他们。</p><button @click="characterMode = 'files'; createEntity('character')">添加人物卡</button>
            </div>
            <template v-else>
              <section class="relationship-graph" aria-label="人物关系图">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <g v-for="edge in relationshipEdges" :key="edge.id" class="relationship-edge" :class="[`trend-${edge.trend}`, { active: selectedRelationshipId === edge.id }]" @click="selectRelationship(edge.id)">
                    <line :x1="edge.from.x" :y1="edge.from.y" :x2="edge.to.x" :y2="edge.to.y" />
                    <text :x="edge.midX" :y="edge.midY">{{ edge.edgeLabel }}</text>
                  </g>
                </svg>
                <button
                  v-for="node in relationshipNodes"
                  :key="node.id"
                  class="relationship-node"
                  :class="{ active: node.id === selectedCharacterId }"
                  :style="{ left: `${node.x}%`, top: `${node.y}%` }"
                  @click="openCharacterFile(node.id)"
                >
                  <span>{{ node.initial }}</span><strong>{{ node.title }}</strong><small>{{ node.role }}</small>
                </button>
                <div v-if="!center.relationships.length" class="relationship-graph-hint">人物节点已经就位<br><button @click="startRelationshipCreate">建立第一条关系</button></div>
              </section>

              <section class="relationship-editor" v-if="relationshipForm">
                <div class="relationship-editor-heading"><div><span>{{ relationshipForm.id ? 'EDIT RELATION' : 'NEW RELATION' }}</span><h3>{{ relationshipForm.id ? '校准这条人物关系' : '建立一条可追踪的关系' }}</h3></div><button v-if="relationshipForm.id" class="danger-link" @click="removeRelationship">删除关系</button></div>
                <div class="relationship-form-grid">
                  <label><span>人物 A</span><select v-model="relationshipForm.fromCharacterId"><option v-for="character in center.characters" :key="character.id" :value="character.id">{{ character.title }}</option></select></label>
                  <label><span>人物 B</span><select v-model="relationshipForm.toCharacterId"><option v-for="character in center.characters" :key="character.id" :value="character.id">{{ character.title }}</option></select></label>
                  <label><span class="form-label-line"><span>关系名称</span><span class="form-field-actions"><button v-if="relationshipForm.id" class="form-cascade" @click="requestRelationshipChange('label', '关系名称')">联动修改</button><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="候选" @execute="requestRelationshipDraft('label', '关系名称', $event)" /></span></span><input v-model="relationshipForm.label" placeholder="例如：旧搭档、母女、竞争者" /></label>
                  <label><span>影响方向</span><select v-model="relationshipForm.direction"><option value="mutual">相互影响</option><option value="from_to">A 影响 B</option><option value="to_from">B 影响 A</option></select></label>
                  <label><span>关系趋势</span><select v-model="relationshipForm.trend"><option value="warming">靠近</option><option value="stable">稳定</option><option value="cooling">疏远</option><option value="hostile">敌对</option></select></label>
                  <label><span>当前状态</span><select v-model="relationshipForm.status"><option value="active">持续中</option><option value="changed">已变化</option><option value="ended">已结束</option></select></label>
                  <label class="wide"><span class="form-label-line"><span>表面关系</span><span class="form-field-actions"><button v-if="relationshipForm.id" class="form-cascade" @click="requestRelationshipChange('surface', '表面关系')">联动修改</button><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="候选" @execute="requestRelationshipDraft('surface', '表面关系', $event)" /></span></span><textarea v-model="relationshipForm.surface" placeholder="他人和当事人表面上如何理解这段关系"></textarea></label>
                  <label class="wide"><span class="form-label-line"><span>真实张力</span><span class="form-field-actions"><button v-if="relationshipForm.id" class="form-cascade" @click="requestRelationshipChange('tension', '真实张力')">联动修改</button><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="候选" @execute="requestRelationshipDraft('tension', '真实张力', $event)" /></span></span><textarea v-model="relationshipForm.tension" placeholder="双方真正争夺、隐瞒、亏欠或依赖什么"></textarea></label>
                </div>
                <div class="relationship-editor-actions"><button @click="cancelRelationshipEdit">取消</button><button class="save" @click="saveRelationship">{{ relationshipForm.id ? '保存关系' : '建立关系' }}</button></div>
              </section>
              <div v-else class="relationship-selection-empty">选择一条连线进行校准，或建立新的关系。</div>
            </template>
          </template>
        </div>

        <div v-else-if="section === 'world'" class="planning-sheet">
          <template v-if="worldMode === 'overview'">
            <div class="sheet-heading">
              <div><span>WORLD CONTRACT</span><h2>先写约束行动的世界规则</h2></div>
              <div class="sheet-heading-support">
                <p>世界观总览负责共同规则；具体地点、组织、物件和历史放进设定卡片。</p>
                <CreativeExecutionControl :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="AI 补全本页" @execute="generateDocumentBundle('world', worldOverviewFields, $event)" />
              </div>
            </div>
            <div class="planning-field-grid">
              <PlanningField
                v-for="field in worldOverviewFields"
                :key="field.key"
                :field="field"
                :model-value="center.documents.world.content[field.key]"
                :busy="isGenerating('document', 'world', field.key)"
                :default-execution-mode="defaultExecutionMode"
                :app-model-label="planningModelName"
                @update:model-value="updateDocumentField('world', field.key, $event)"
                @generate="generateDocumentField('world', field, $event)"
                @cascade="requestDocumentChange('world', field)"
                @edit-default="$emit('edit-project')"
              />
            </div>
          </template>
          <EntityEditor
            v-else-if="worldMode === 'cards' && selectedWorldElement"
            kind="world"
            :entity="selectedWorldElement"
            :entity-count="center.worldElements.length"
            :fields="entityFields.world"
            :generation-key="generationKey"
            :default-execution-mode="defaultExecutionMode"
            :app-model-label="planningModelName"
            @update-title="updateEntityTitle(selectedWorldElement, $event)"
            @update-field="updateEntityField(selectedWorldElement, $event.key, $event.value)"
            @generate-title="generateEntityTitle(selectedWorldElement, $event)"
            @generate-field="generateEntityField(selectedWorldElement, $event.field, $event.mode)"
            @generate-all="generateEntityBundle(selectedWorldElement, entityFields.world, $event)"
            @cascade-title="requestEntityChange(selectedWorldElement, { key: 'title', label: '设定名称' })"
            @cascade-field="requestEntityChange(selectedWorldElement, $event.field)"
            @edit-default="$emit('edit-project')"
            @move="moveEntity('world', selectedWorldElement, $event)"
            @delete="requestEntityDelete(selectedWorldElement)"
          />
          <EmptyPlanning v-else-if="worldMode === 'cards'" title="建立第一条可被剧情检验的设定" copy="它可以是地点、组织、规则、物件或一段仍在影响现在的历史。" action="添加世界设定" @action="createEntity('world')" />
          <template v-else>
            <div class="sheet-heading location-heading">
              <div><span>PLACE ATLAS</span><h2>人物此刻在哪里</h2></div>
              <p>地点卡提供稳定规则，已接受章后状态补充人物最新位置。正文出现但尚未建卡的地点会标成“待建档”。</p>
            </div>
            <div v-if="!center.locations.length" class="relationship-empty location-empty"><span>⌖</span><strong>还没有可以索引的地点</strong><p>建立一张类型为“地点”的世界设定卡，或接受包含人物位置的章后状态。</p><button @click="createLocationCard">添加地点卡</button></div>
            <div v-else class="location-atlas">
              <button v-for="location in center.locations" :key="location.id" class="location-card" :class="[{ active: selectedLocationId === location.id }, location.sourceType]" @click="selectedLocationId = location.id">
                <div><span>{{ location.sourceType === 'planning' ? location.category : '正文发现' }}</span><small>{{ location.occupants.length }} 人在场</small></div>
                <h3>{{ location.title }}</h3><p>{{ location.summary || location.storyUse || '尚未补充地点说明' }}</p>
                <div class="location-occupants"><span v-for="occupant in location.occupants" :key="`${location.id}:${occupant.characterName}`">{{ occupant.characterName }}</span></div>
              </button>
            </div>
            <section v-if="selectedLocation" class="location-detail">
              <div class="location-detail-heading"><div><span>{{ selectedLocation.sourceType === 'planning' ? 'PLANNED PLACE' : 'OBSERVED IN MANUSCRIPT' }}</span><h3>{{ selectedLocation.title }}</h3></div><button v-if="selectedLocation.sourceType === 'observed'" @click="promoteObservedLocation(selectedLocation)">转为地点卡</button><button v-else @click="openWorldCard(selectedLocation.entityId)">编辑地点卡</button></div>
              <div class="location-detail-grid"><div><span>地点规则</span><p>{{ selectedLocation.rules || '尚未填写' }}</p></div><div><span>连续性约束</span><p>{{ selectedLocation.constraints || '尚未填写' }}</p></div><div class="wide"><span>与其他对象的连接</span><p>{{ selectedLocation.connections || '尚未填写' }}</p></div></div>
              <div v-if="selectedLocation.occupants.length" class="location-state-list"><article v-for="occupant in selectedLocation.occupants" :key="occupant.characterName"><strong>{{ occupant.characterName }}</strong><span>第 {{ occupant.chapterNo }} 章确认</span><p>{{ [occupant.physical, occupant.emotional].filter(Boolean).join('；') || '没有额外状态说明' }}</p></article></div>
            </section>
          </template>
        </div>

        <div v-else class="planning-sheet" :class="{ 'arc-planning-sheet': structureMode === 'arcs' }">
          <template v-if="structureMode === 'outline'">
            <div class="sheet-heading">
              <div><span>STORY SPINE</span><h2>全书转折骨架</h2></div>
              <div class="sheet-heading-support">
                <p>这里不是章节摘要的堆叠，而是主角一次次改变策略后形成的因果链。</p>
                <CreativeExecutionControl :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="AI 补全本页" @execute="generateDocumentBundle('outline', outlineFields, $event)" />
              </div>
            </div>
            <div class="planning-field-grid">
              <PlanningField
                v-for="field in outlineFields"
                :key="field.key"
                :field="field"
                :model-value="center.documents.outline.content[field.key]"
                :busy="isGenerating('document', 'outline', field.key)"
                :default-execution-mode="defaultExecutionMode"
                :app-model-label="planningModelName"
                @update:model-value="updateDocumentField('outline', field.key, $event)"
                @generate="generateDocumentField('outline', field, $event)"
                @cascade="requestDocumentChange('outline', field)"
                @edit-default="$emit('edit-project')"
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
            :default-execution-mode="defaultExecutionMode"
            :app-model-label="planningModelName"
            @update-title="updateEntityTitle(selectedVolume, $event)"
            @update-field="updateEntityField(selectedVolume, $event.key, $event.value)"
            @generate-title="generateEntityTitle(selectedVolume, $event)"
            @generate-field="generateEntityField(selectedVolume, $event.field, $event.mode)"
            @generate-all="generateEntityBundle(selectedVolume, entityFields.volume, $event)"
            @cascade-title="requestEntityChange(selectedVolume, { key: 'title', label: '分卷名称' })"
            @cascade-field="requestEntityChange(selectedVolume, $event.field)"
            @edit-default="$emit('edit-project')"
            @move="moveEntity('volume', selectedVolume, $event)"
            @delete="requestEntityDelete(selectedVolume)"
          />
          <EmptyPlanning v-else-if="structureMode === 'volumes'" title="把长篇拆成会改变局势的阶段" copy="每一卷都应有独立目标、主要阻力、阶段变化和卷末兑现。" action="添加第一卷" @action="createEntity('volume')" />
          <template v-else-if="structureMode === 'arcs'">
            <div class="entity-editor-heading arc-heading">
              <div><span>STORY THREADS</span><h2>跨卷情节弧</h2><p>沿着分卷追踪每条主线、人物线或悬疑线发生了什么实质变化。</p></div>
              <div class="arc-heading-actions">
                <button v-if="selectedArc" class="danger-link" @click="requestArcDelete(selectedArc)">删除当前情节线</button>
                <button class="arc-create-button" @click="createArc">＋ 新情节线</button>
              </div>
            </div>
            <div v-if="!center.storyArcs.length" class="relationship-empty arc-empty"><span>⌁</span><strong>还没有贯穿全书的情节线</strong><p>先建立一条主线，再把关键变化放进不同分卷；尚未建立分卷时也可先放在“未归卷”。</p><button @click="createArc">建立第一条线</button></div>
            <template v-else>
              <div class="arc-matrix">
                <div class="arc-grid" :style="arcGridStyle">
                  <div class="arc-corner"><span>情节线</span><small>起点 → 落点</small></div>
                  <div v-for="column in arcColumns" :key="column.id || 'unassigned'" class="arc-column-heading"><span>{{ column.title }}</span><small>{{ arcColumnChapterRange(column.id) }}</small></div>
                  <template v-for="arc in center.storyArcs" :key="arc.id">
                    <button class="arc-row-label" :class="[{ active: selectedArcId === arc.id }, `arc-${arc.colorKey}`]" @click="selectArc(arc.id)">
                      <i></i><span><strong>{{ arc.title }}</strong><small>{{ arcStatusLabel(arc.status) }} · {{ arcCategoryLabel(arc.category) }}</small></span>
                    </button>
                    <div v-for="column in arcColumns" :key="`${arc.id}:${column.id || 'unassigned'}`" class="arc-cell" :class="`arc-${arc.colorKey}`">
                      <button v-for="beat in arcBeatsInColumn(arc, column.id)" :key="beat.id" class="arc-beat-card" :class="{ active: selectedArcBeatId === beat.id }" @click="selectArcBeat(arc.id, beat.id)">
                        <strong>{{ beat.label }}</strong><small v-if="beat.chapterId">第 {{ beat.chapterNo }} 章 · {{ beat.chapterTitle }}</small><p>{{ beat.changeText || '等待补充变化结果' }}</p>
                      </button>
                      <button class="arc-beat-add" @click="startArcBeatCreate(arc.id, column.id)">＋ 节点</button>
                    </div>
                  </template>
                </div>
              </div>

              <section v-if="arcForm" class="arc-editor" :class="`arc-${arcForm.colorKey}`">
                <div class="arc-editor-heading"><div><span>THREAD CONTRACT</span><h3>{{ arcForm.title || '新情节线' }}</h3></div><button @click="requestArcDelete(selectedArc)">删除情节线</button></div>
                <div class="arc-form-grid">
                  <label class="wide"><span class="form-label-line"><span>情节线名称</span><span class="form-field-actions"><button v-if="arcForm.id" class="form-cascade" @click="requestArcChange('title', '情节线名称')">联动修改</button><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="候选" @execute="requestArcDraft('title', '情节线名称', $event)" /></span></span><input v-model="arcForm.title" placeholder="例如：失踪案真相"></label>
                  <label><span>类型</span><select v-model="arcForm.category"><option value="main">主线</option><option value="character">人物弧</option><option value="relationship">关系线</option><option value="mystery">悬疑线</option><option value="world">世界变化</option><option value="other">其他</option></select></label>
                  <label><span>状态</span><select v-model="arcForm.status"><option value="planned">待展开</option><option value="active">推进中</option><option value="resolved">已兑现</option><option value="paused">暂挂</option></select></label>
                  <label><span>线条颜色</span><select v-model="arcForm.colorKey"><option value="copper">铜红</option><option value="pine">松绿</option><option value="slate">岩蓝</option><option value="ochre">赭黄</option><option value="plum">梅紫</option></select></label>
                  <label class="wide"><span class="form-label-line"><span>起点 / 初始问题</span><span class="form-field-actions"><button v-if="arcForm.id" class="form-cascade" @click="requestArcChange('premise', '起点 / 初始问题')">联动修改</button><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="候选" @execute="requestArcDraft('premise', '起点 / 初始问题', $event)" /></span></span><textarea v-model="arcForm.premise" placeholder="这条线一开始提出什么问题、欠下什么承诺？"></textarea></label>
                  <label class="wide"><span class="form-label-line"><span>终点 / 兑现结果</span><span class="form-field-actions"><button v-if="arcForm.id" class="form-cascade" @click="requestArcChange('destination', '终点 / 兑现结果')">联动修改</button><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="候选" @execute="requestArcDraft('destination', '终点 / 兑现结果', $event)" /></span></span><textarea v-model="arcForm.destination" placeholder="到最后，局势、认知或关系必须发生什么不可逆变化？"></textarea></label>
                </div>
                <div class="relationship-editor-actions"><button @click="resetArcForm">还原</button><button class="save" @click="saveArc">保存情节线</button></div>
              </section>

              <section v-if="arcBeatForm" class="arc-beat-editor">
                <div class="arc-editor-heading"><div><span>TURNING BEAT</span><h3>{{ arcBeatForm.id ? '编辑关键节点' : '添加关键节点' }}</h3></div><button v-if="arcBeatForm.id" @click="removeArcBeat">删除节点</button></div>
                <div class="arc-form-grid">
                  <label><span>所属分卷</span><select v-model="arcBeatForm.volumeId" @change="handleArcBeatVolumeChange"><option value="">未归卷</option><option v-for="volume in center.volumes" :key="volume.id" :value="volume.id">{{ volume.title }}</option></select></label>
                  <label><span>对应章节（可选）</span><select v-model="arcBeatForm.chapterId"><option value="">不绑定章节</option><option v-for="chapter in arcBeatChapterOptions" :key="chapter.id" :value="chapter.id">第 {{ chapter.chapterNo }} 章 · {{ chapter.title }}</option></select></label>
                  <label class="wide"><span class="form-label-line"><span>节点名称</span><span class="form-field-actions"><button v-if="arcBeatForm.id" class="form-cascade" @click="requestArcBeatChange('label', '节点名称')">联动修改</button><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="候选" @execute="requestArcBeatDraft('label', '节点名称', $event)" /></span></span><input v-model="arcBeatForm.label" placeholder="例如：第二份证词出现"></label>
                  <label class="wide"><span class="form-label-line"><span>发生了什么实质变化</span><span class="form-field-actions"><button v-if="arcBeatForm.id" class="form-cascade" @click="requestArcBeatChange('changeText', '关键节点变化')">联动修改</button><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="候选" @execute="requestArcBeatDraft('changeText', '关键节点变化', $event)" /></span></span><textarea v-model="arcBeatForm.changeText" placeholder="写结果，不只写事件：谁改变策略、掌握了什么、失去了什么？"></textarea></label>
                </div>
                <div class="relationship-editor-actions"><button @click="cancelArcBeatEdit">取消</button><button class="save" @click="saveArcBeat">保存节点</button></div>
              </section>
            </template>
          </template>
          <template v-else-if="structureMode === 'chapters' && selectedChapter">
            <div class="entity-editor-heading chapter-plan-heading">
              <div><span>CHAPTER {{ String(selectedChapter.chapterNo).padStart(2, '0') }}</span><h2>{{ selectedChapter.title }}</h2><p>章节规划会直接进入正文生成上下文。</p></div>
              <div class="chapter-scope-tools">
                <CreativeExecutionControl :default-mode="defaultExecutionMode" :app-model-label="planningModelName" action-label="AI 补全本章" @execute="generateChapterBundle(selectedChapter, $event)" />
                <label>
                  <span>所属分卷</span>
                  <select :value="selectedChapter.card?.volumeId || ''" @change="assignChapterVolume(selectedChapter, $event.target.value)">
                    <option value="">未归卷</option>
                    <option v-for="volume in center.volumes" :key="volume.id" :value="volume.id">{{ volume.title }}</option>
                  </select>
                </label>
                <span class="chapter-plan-status">{{ selectedChapter.status === 'draft' ? '草稿' : selectedChapter.status }}</span>
                <button class="danger-link chapter-delete-button" @click="$emit('delete-chapter', selectedChapter)">删除章节</button>
              </div>
            </div>
            <div class="planning-field-grid">
              <PlanningField
                v-for="field in chapterPlanFields"
                :key="field.key"
                :field="field"
                :model-value="chapterFieldValue(selectedChapter, field)"
                :busy="isGenerating('chapter', selectedChapter.id, field.key)"
                :default-execution-mode="defaultExecutionMode"
                :app-model-label="planningModelName"
                @update:model-value="updateChapterField(selectedChapter, field, $event)"
                @generate="generateChapterField(selectedChapter, field, $event)"
                @cascade="requestChapterChange(selectedChapter, field)"
                @edit-default="$emit('edit-project')"
              />
            </div>
          </template>
          <EmptyPlanning v-else-if="structureMode === 'chapters'" title="项目中还没有章节" copy="回到创作桌面添加章节后，就能在这里逐章建立章节合同。" />
        </div>
      </main>

      <aside ref="candidateRail" class="candidate-rail" tabindex="-1" aria-label="规划候选签批">
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
        <span class="eyebrow copper">{{ deleteDialog.eyebrow }}</span>
        <h2>删除“{{ deleteDialog.title }}”？</h2>
        <p>{{ deleteDialog.body }}</p>
        <div><button @click="deleteTarget = null">取消</button><button class="danger" @click="confirmDeleteTarget">{{ deleteDialog.confirmLabel }}</button></div>
      </section>
    </div>
  </section>
  <div v-else class="planning-loading">{{ loadError ? `规划中心打开失败：${loadError}` : '正在铺开故事资料…' }}</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import { planningPromptProfile, renderScenePlan } from '../../electron/creative-quality.js'
import { chapterPlanFields, entityFields, foundationFields, outlineFields, sectionMeta, worldOverviewFields } from '../services/planning-schema.js'
import PlanningField from './PlanningField.vue'
import EntityEditor from './planning/EntityEditor.vue'
import EmptyPlanning from './planning/EmptyPlanning.vue'
import CreativeExecutionControl from './CreativeExecutionControl.vue'
import { draftDigest } from '../utils/inline-creative.js'

const props = defineProps({
  project: { type: Object, required: true },
  section: { type: String, default: 'foundation' },
  modelSettings: { type: Object, required: true },
})

const emit = defineEmits(['toast', 'open-settings', 'edit-project', 'chapter-updated', 'delete-chapter', 'codex-action', 'story-change'])
const center = ref(null)
const candidateRail = ref(null)
function showCandidates() {
  candidateRail.value?.scrollIntoView({ block: 'start', behavior: 'auto' })
  candidateRail.value?.focus({ preventScroll: true })
}
const loadError = ref('')
const saveState = ref('saved')
const selectedCharacterId = ref('')
const selectedWorldId = ref('')
const selectedVolumeId = ref('')
const selectedChapterId = ref('')
const selectedRelationshipId = ref('')
const selectedLocationId = ref('')
const selectedArcId = ref('')
const selectedArcBeatId = ref('')
const relationshipForm = ref(null)
const arcForm = ref(null)
const arcBeatForm = ref(null)
const characterMode = ref('files')
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
const selectedLocation = computed(() => center.value?.locations.find((item) => item.id === selectedLocationId.value) || center.value?.locations[0] || null)
const selectedArc = computed(() => center.value?.storyArcs.find((item) => item.id === selectedArcId.value) || null)
const arcColumns = computed(() => [...(center.value?.volumes || []), { id: '', title: '未归卷' }])
const arcGridStyle = computed(() => {
  const count = arcColumns.value.length
  return { gridTemplateColumns: `220px repeat(${count}, minmax(180px, 1fr))`, minWidth: `${220 + count * 180}px` }
})
const arcBeatChapterOptions = computed(() => {
  if (!arcBeatForm.value) return []
  return (center.value?.chapters || []).filter((chapter) => (chapter.card?.volumeId || '') === arcBeatForm.value.volumeId)
})
const relationshipNodes = computed(() => {
  const characters = center.value?.characters || []
  const presets = [[17, 22], [50, 14], [83, 24], [18, 72], [50, 84], [82, 70]]
  return characters.map((character, index) => {
    const angle = (Math.PI * 2 * index / Math.max(characters.length, 1)) - Math.PI / 2
    const point = presets[index] || [50 + Math.cos(angle) * 34, 50 + Math.sin(angle) * 34]
    return { id: character.id, title: character.title, role: character.data.role || '角色待定义', initial: Array.from(character.title)[0] || '人', x: point[0], y: point[1] }
  })
})
const relationshipEdges = computed(() => {
  const nodes = new Map(relationshipNodes.value.map((node) => [node.id, node]))
  return (center.value?.relationships || []).map((relationship) => {
    const from = nodes.get(relationship.fromCharacterId)
    const to = nodes.get(relationship.toCharacterId)
    const direction = relationship.direction === 'from_to' ? '→' : relationship.direction === 'to_from' ? '←' : '↔'
    return from && to ? { ...relationship, edgeLabel: `${direction} ${relationship.label}`, from, to, midX: (from.x + to.x) / 2, midY: (from.y + to.y) / 2 - 1.5 } : null
  }).filter(Boolean)
})
const activeCandidate = computed(() => center.value?.candidates.find((item) => item.id === activeCandidateId.value) || center.value?.candidates[0])
const planningModelName = computed(() => {
  const id = props.modelSettings.routes?.planning_field
  return props.modelSettings.profiles.find((profile) => profile.id === id)?.name || 'MockProvider'
})
const defaultExecutionMode = computed(() => props.project.default_execution_mode === 'codex' ? 'codex' : 'app_model')
const deleteDialog = computed(() => deleteTarget.value?.type === 'arc'
  ? {
      eyebrow: 'REMOVE STORY THREAD',
      title: deleteTarget.value.arc?.title || '当前情节线',
      body: '这条情节线及其全部关键节点会一并删除；已经写入章节、分卷和正文的内容保持不变。',
      confirmLabel: '删除情节线',
    }
  : {
      eyebrow: 'REMOVE CARD',
      title: deleteTarget.value?.entity?.title || '当前规划卡',
      body: '这张规划卡及尚未处理的字段候选会一并移除，其他人物、设定或分卷不会改变。',
      confirmLabel: '删除卡片',
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
  if (props.section === 'outline' && structureMode.value === 'arcs') {
    return selectedArc.value
      ? { completed: [selectedArc.value.title, selectedArc.value.premise, selectedArc.value.destination].filter(hasValue).length, total: 3 }
      : { completed: 0, total: 3 }
  }
  const entity = props.section === 'characters' ? selectedCharacter.value : props.section === 'world' ? selectedWorldElement.value : selectedVolume.value
  const fields = props.section === 'characters' ? entityFields.character : props.section === 'world' ? entityFields.world : entityFields.volume
  return entity ? { completed: fields.filter((field) => hasValue(entity.data[field.key])).length + (hasValue(entity.title) ? 1 : 0), total: fields.length + 1 } : { completed: 0, total: fields.length + 1 }
})

onMounted(loadCenter)
watch(() => props.project.id, async () => { await flushSaves(); await loadCenter() })
watch(() => props.section, async (value) => {
  await flushSaves()
  if (value === 'world' && !['overview', 'cards', 'locations'].includes(worldMode.value)) worldMode.value = 'overview'
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
    selectedRelationshipId.value = keepOrFirst(selectedRelationshipId.value, center.value.relationships)
    selectedLocationId.value = keepOrFirst(selectedLocationId.value, center.value.locations)
    selectedArcId.value = keepOrFirst(selectedArcId.value, center.value.storyArcs)
    const arcBeats = center.value.storyArcs.flatMap((arc) => arc.beats)
    selectedArcBeatId.value = keepOrFirst(selectedArcBeatId.value, arcBeats)
    activeCandidateId.value = keepOrFirst(activeCandidateId.value, center.value.candidates)
    if (characterMode.value === 'relationships') {
      relationshipForm.value = selectedRelationshipId.value
        ? relationshipDraft(center.value.relationships.find((item) => item.id === selectedRelationshipId.value))
        : null
    }
    if (structureMode.value === 'arcs') resetArcForm()
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

function relationshipTrendLabel(trend) { return ({ warming: '靠近', stable: '稳定', cooling: '疏远', hostile: '敌对' }[trend] || '稳定') }
function openRelationshipGraph() {
  characterMode.value = 'relationships'
  selectedRelationshipId.value = keepOrFirst(selectedRelationshipId.value, center.value.relationships)
  if (selectedRelationshipId.value) selectRelationship(selectedRelationshipId.value)
  else relationshipForm.value = null
}
function relationshipDraft(relationship = {}) {
  const first = center.value.characters[0]
  const second = center.value.characters.find((character) => character.id !== first?.id)
  return {
    id: relationship.id || '',
    fromCharacterId: relationship.fromCharacterId || first?.id || '',
    toCharacterId: relationship.toCharacterId || second?.id || '',
    label: relationship.label || '', surface: relationship.surface || '', tension: relationship.tension || '',
    direction: relationship.direction || 'mutual', trend: relationship.trend || 'stable', status: relationship.status || 'active',
  }
}
function startRelationshipCreate() {
  if (center.value.characters.length < 2) return
  selectedRelationshipId.value = ''
  relationshipForm.value = relationshipDraft()
}
function selectRelationship(id) {
  const relationship = center.value.relationships.find((item) => item.id === id)
  if (!relationship) return
  selectedRelationshipId.value = id
  relationshipForm.value = relationshipDraft(relationship)
}
function cancelRelationshipEdit() {
  if (selectedRelationshipId.value) selectRelationship(selectedRelationshipId.value)
  else relationshipForm.value = null
}
async function saveRelationship() {
  if (!relationshipForm.value) return
  if (relationshipForm.value.fromCharacterId === relationshipForm.value.toCharacterId) {
    emit('toast', '人物 A 和人物 B 需要选择不同人物')
    return
  }
  try {
    const payload = cloneForIpc(relationshipForm.value)
    const saved = payload.id
      ? await appService.updateCharacterRelationship(payload)
      : await appService.createCharacterRelationship({ projectId: props.project.id, ...payload })
    const index = center.value.relationships.findIndex((item) => item.id === saved.id)
    if (index >= 0) center.value.relationships[index] = saved
    else center.value.relationships.unshift(saved)
    selectedRelationshipId.value = saved.id
    relationshipForm.value = relationshipDraft(saved)
    emit('toast', payload.id ? '人物关系已保存' : '人物关系已建立')
  } catch (error) { emit('toast', `保存人物关系失败：${error.message}`) }
}
async function removeRelationship() {
  if (!relationshipForm.value?.id) return
  try {
    center.value.relationships = await appService.deleteCharacterRelationship(relationshipForm.value.id)
    selectedRelationshipId.value = center.value.relationships[0]?.id || ''
    relationshipForm.value = selectedRelationshipId.value ? relationshipDraft(center.value.relationships[0]) : null
    emit('toast', '人物关系已删除')
  } catch (error) { emit('toast', `删除人物关系失败：${error.message}`) }
}
function openCharacterFile(id) { selectedCharacterId.value = id; characterMode.value = 'files' }
function openLocationView() { worldMode.value = 'locations'; selectedLocationId.value = keepOrFirst(selectedLocationId.value, center.value.locations) }
function openWorldCard(id) { selectedWorldId.value = id; worldMode.value = 'cards' }
async function createLocationCard() {
  try {
    const entity = await appService.createPlanningEntity({ projectId: props.project.id, kind: 'world', title: '新地点', data: { category: '地点' } })
    center.value.worldElements.push(entity)
    selectedWorldId.value = entity.id
    worldMode.value = 'cards'
    emit('toast', '新地点卡已建立')
  } catch (error) { emit('toast', `添加地点卡失败：${error.message}`) }
}
async function promoteObservedLocation(location) {
  try {
    const entity = await appService.createPlanningEntity({ projectId: props.project.id, kind: 'world', title: location.title, data: { category: '地点', summary: '正文已出现，等待补充稳定设定。' } })
    await loadCenter()
    worldMode.value = 'locations'
    selectedLocationId.value = entity.id
    emit('toast', `“${location.title}”已转为地点卡`)
  } catch (error) { emit('toast', `建立地点卡失败：${error.message}`) }
}

function arcCategoryLabel(category) { return ({ main: '主线', character: '人物弧', relationship: '关系线', mystery: '悬疑线', world: '世界变化', other: '其他' }[category] || '其他') }
function arcStatusLabel(status) { return ({ planned: '待展开', active: '推进中', resolved: '已兑现', paused: '暂挂' }[status] || '待展开') }
function arcDraft(arc) {
  return arc ? {
    id: arc.id, title: arc.title, category: arc.category, status: arc.status,
    colorKey: arc.colorKey, premise: arc.premise, destination: arc.destination,
  } : null
}
function arcBeatDraft(beat = {}, arcId = '', volumeId = '') {
  return {
    id: beat.id || '', arcId: beat.arcId || arcId, volumeId: beat.volumeId ?? volumeId,
    chapterId: beat.chapterId || '', label: beat.label || '', changeText: beat.changeText || '',
  }
}
function replaceArc(saved) {
  const index = center.value.storyArcs.findIndex((arc) => arc.id === saved.id)
  if (index >= 0) center.value.storyArcs[index] = saved
  else center.value.storyArcs.push(saved)
}
function openStoryArcs() {
  structureMode.value = 'arcs'
  selectedArcId.value = keepOrFirst(selectedArcId.value, center.value.storyArcs)
  resetArcForm()
}
async function selectArc(id) {
  await flushSaves()
  selectedArcId.value = id
  selectedArcBeatId.value = ''
  arcBeatForm.value = null
  resetArcForm()
}
function resetArcForm() { arcForm.value = arcDraft(selectedArc.value) }
async function createArc() {
  try {
    await flushSaves()
    const saved = await appService.createStoryArc({
      projectId: props.project.id,
      title: `情节线 ${center.value.storyArcs.length + 1}`,
      category: center.value.storyArcs.length ? 'character' : 'main',
    })
    center.value.storyArcs.push(saved)
    selectedArcId.value = saved.id
    selectedArcBeatId.value = ''
    arcForm.value = arcDraft(saved)
    arcBeatForm.value = null
    structureMode.value = 'arcs'
    emit('toast', '新情节线已建立')
  } catch (error) { emit('toast', `建立情节线失败：${error.message}`) }
}
async function saveArc() {
  if (!arcForm.value?.id) return
  try {
    const saved = await appService.updateStoryArc(cloneForIpc(arcForm.value))
    replaceArc(saved)
    arcForm.value = arcDraft(saved)
    emit('toast', '情节线已保存')
  } catch (error) { emit('toast', `保存情节线失败：${error.message}`) }
}
function requestArcDelete(arc) {
  if (!arc?.id) return
  deleteTarget.value = { type: 'arc', arc }
}
async function removeArc() {
  const arc = deleteTarget.value?.type === 'arc' ? deleteTarget.value.arc : selectedArc.value
  if (!arc?.id) return
  try {
    center.value.storyArcs = await appService.deleteStoryArc(arc.id)
    selectedArcId.value = center.value.storyArcs[0]?.id || ''
    selectedArcBeatId.value = ''
    arcBeatForm.value = null
    resetArcForm()
    deleteTarget.value = null
    emit('toast', '情节线及其节点已删除')
  } catch (error) { emit('toast', `删除情节线失败：${error.message}`) }
}
function startArcBeatCreate(arcId, volumeId) {
  selectedArcId.value = arcId
  selectedArcBeatId.value = ''
  arcForm.value = arcDraft(selectedArc.value)
  arcBeatForm.value = arcBeatDraft({}, arcId, volumeId)
}
function selectArcBeat(arcId, beatId) {
  const arc = center.value.storyArcs.find((item) => item.id === arcId)
  const beat = arc?.beats.find((item) => item.id === beatId)
  if (!beat) return
  selectedArcId.value = arcId
  selectedArcBeatId.value = beatId
  arcForm.value = arcDraft(arc)
  arcBeatForm.value = arcBeatDraft(beat)
}
function cancelArcBeatEdit() {
  selectedArcBeatId.value = ''
  arcBeatForm.value = null
}
function handleArcBeatVolumeChange() {
  if (!arcBeatForm.value?.chapterId) return
  const chapter = center.value.chapters.find((item) => item.id === arcBeatForm.value.chapterId)
  if ((chapter?.card?.volumeId || '') !== arcBeatForm.value.volumeId) arcBeatForm.value.chapterId = ''
}
async function saveArcBeat() {
  if (!arcBeatForm.value?.arcId) return
  try {
    const payload = cloneForIpc(arcBeatForm.value)
    const saved = payload.id
      ? await appService.updateStoryArcBeat(payload)
      : await appService.createStoryArcBeat(payload)
    const arc = center.value.storyArcs.find((item) => item.id === payload.arcId)
    const index = arc.beats.findIndex((beat) => beat.id === saved.id)
    if (index >= 0) arc.beats[index] = saved
    else arc.beats.push(saved)
    selectedArcBeatId.value = saved.id
    arcBeatForm.value = arcBeatDraft(saved)
    emit('toast', payload.id ? '情节节点已保存' : '情节节点已添加')
  } catch (error) { emit('toast', `保存情节节点失败：${error.message}`) }
}
async function removeArcBeat() {
  if (!arcBeatForm.value?.id) return
  try {
    const savedArc = await appService.deleteStoryArcBeat(arcBeatForm.value.id)
    replaceArc(savedArc)
    selectedArcBeatId.value = ''
    arcBeatForm.value = null
    arcForm.value = arcDraft(savedArc)
    emit('toast', '情节节点已删除')
  } catch (error) { emit('toast', `删除情节节点失败：${error.message}`) }
}
function arcBeatsInColumn(arc, volumeId) { return arc.beats.filter((beat) => (beat.volumeId || '') === volumeId) }
function arcColumnChapterRange(volumeId) {
  const chapters = center.value.chapters.filter((chapter) => (chapter.card?.volumeId || '') === volumeId)
  if (!chapters.length) return volumeId ? '尚无章节' : '暂存节点'
  const first = chapters[0].chapterNo
  const last = chapters.at(-1).chapterNo
  return first === last ? `第 ${first} 章` : `第 ${first}–${last} 章`
}

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
  return field.special ? renderScenePlan(chapter.scenePlan) : String(chapter.card?.[field.key] || '')
}

function updateChapterField(chapter, field, value) {
  if (field.special) chapter.scenePlan = value
  else chapter.card[field.key] = value
  dirtyChapters.add(chapter.id)
  saveState.value = 'dirty'
  schedule(chapterTimers, chapter.id, () => saveChapter(chapter.id))
}

function assignChapterVolume(chapter, volumeId) {
  if (volumeId) chapter.card.volumeId = volumeId
  else delete chapter.card.volumeId
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

function requestEntityDelete(entity) { deleteTarget.value = { type: 'entity', entity } }
async function confirmDeleteTarget() {
  if (deleteTarget.value?.type === 'arc') return removeArc()
  return confirmEntityDelete()
}
async function confirmEntityDelete() {
  const entity = deleteTarget.value?.entity
  if (!entity) return
  await flushSaves()
  try {
    const remaining = await appService.deletePlanningEntity(entity.id)
    if (entity.kind === 'character') {
      center.value.characters = remaining
      selectedCharacterId.value = remaining[0]?.id || ''
      center.value.relationships = center.value.relationships.filter((relationship) => relationship.fromCharacterId !== entity.id && relationship.toCharacterId !== entity.id)
      selectedRelationshipId.value = keepOrFirst(selectedRelationshipId.value, center.value.relationships)
      relationshipForm.value = selectedRelationshipId.value ? relationshipDraft(center.value.relationships.find((item) => item.id === selectedRelationshipId.value)) : null
    }
    if (entity.kind === 'world') { center.value.worldElements = remaining; selectedWorldId.value = remaining[0]?.id || '' }
    if (entity.kind === 'volume') {
      center.value.volumes = remaining
      selectedVolumeId.value = remaining[0]?.id || ''
      center.value.chapters.forEach((chapter) => { if (chapter.card?.volumeId === entity.id) delete chapter.card.volumeId })
      center.value.storyArcs.forEach((arc) => arc.beats.forEach((beat) => {
        if (beat.volumeId === entity.id) { beat.volumeId = ''; beat.volumeTitle = '' }
      }))
      if (arcBeatForm.value?.volumeId === entity.id) arcBeatForm.value.volumeId = ''
    }
    center.value.candidates = center.value.candidates.filter((item) => !(item.targetType === 'entity' && item.targetId === entity.id))
    deleteTarget.value = null
    emit('toast', `“${entity.title}”已删除`)
  } catch (error) { emit('toast', `删除规划卡片失败：${error.message}`) }
}

function generateDocumentField(kind, field, mode = defaultExecutionMode.value) {
  return startFieldGeneration(field, {
    targetType: 'document', targetId: kind, targetLabel: meta.value.title,
    scopeType: 'project', scopeId: props.project.id,
    planningScopeType: kind,
    currentValue: center.value.documents[kind].content[field.key] || '',
    nearbyContext: JSON.stringify(center.value.documents[kind].content),
  }, mode)
}

function generateEntityTitle(entity, mode = defaultExecutionMode.value) {
  return startFieldGeneration({ key: 'title', label: entity.kind === 'character' ? '人物姓名 / 称谓' : entity.kind === 'world' ? '设定名称' : '分卷名称' }, {
    targetType: 'entity', targetId: entity.id, targetLabel: entity.title, currentValue: entity.title,
    entityKind: entity.kind,
    scopeType: entity.kind === 'volume' ? 'volume' : 'project', scopeId: entity.kind === 'volume' ? entity.id : props.project.id,
    nearbyContext: JSON.stringify(entity.data),
  }, mode)
}

function generateEntityField(entity, field, mode = defaultExecutionMode.value) {
  return startFieldGeneration(field, {
    targetType: 'entity', targetId: entity.id, targetLabel: entity.title,
    entityKind: entity.kind,
    scopeType: entity.kind === 'volume' ? 'volume' : 'project', scopeId: entity.kind === 'volume' ? entity.id : props.project.id,
    currentValue: entity.data[field.key] || '', nearbyContext: JSON.stringify(entity.data),
  }, mode)
}

async function generateDocumentBundle(kind, fields, mode = defaultExecutionMode.value) {
  try {
    await flushSaves()
    emit('codex-action', {
      request: {
        projectId: props.project.id,
        task: 'planning_field',
        intent: 'draft',
        executionMode: mode === 'app_model' ? 'app_model' : 'codex',
        modelProfileId: mode === 'app_model' ? props.modelSettings.routes?.planning_field || '' : '',
        modelProfileName: mode === 'app_model' ? planningModelName.value : '',
        target: {
          kind: 'planning_document_bundle',
          targetId: kind,
          fieldLabel: `${sectionMeta[kind]?.title || '当前规划页'} · AI 补全本页`,
          fieldKeys: fields.map((field) => field.key),
          includeFilled: false,
        },
        instruction: [
          '一次补全当前规划页仍为空白的字段；所有字段必须属于同一套故事设计，并形成清晰因果。',
          '保留没有被请求的已确认字段，不要用同义改写覆盖它们。',
          generationInstruction.value,
        ].filter(Boolean).join('\n'),
      },
      onAccepted: () => loadCenter(),
    })
  } catch (error) {
    emit('toast', `整页生成启动失败：${error.message}`)
  }
}

async function generateEntityBundle(entity, fields, mode = defaultExecutionMode.value) {
  try {
    await flushSaves()
    emit('codex-action', {
      request: {
        projectId: props.project.id,
        task: 'planning_field',
        intent: 'draft',
        executionMode: mode === 'app_model' ? 'app_model' : 'codex',
        modelProfileId: mode === 'app_model' ? props.modelSettings.routes?.planning_field || '' : '',
        modelProfileName: mode === 'app_model' ? planningModelName.value : '',
        target: {
          kind: 'planning_entity_bundle',
          targetId: entity.id,
          fieldLabel: `${entity.title} · AI 补全整卡`,
          fieldKeys: ['title', ...fields.map((field) => field.key)],
          includeFilled: false,
        },
        instruction: [
          '一次补全这张规划卡仍为空白的字段；所有字段必须来自同一套人物、世界或分卷设计，彼此不能矛盾。',
          '保留没有被请求的已确认字段，不要用同义改写覆盖它们。',
          generationInstruction.value,
        ].filter(Boolean).join('\n'),
      },
      onAccepted: () => loadCenter(),
    })
  } catch (error) {
    emit('toast', `整卡生成启动失败：${error.message}`)
  }
}

async function generateChapterBundle(chapter, mode = defaultExecutionMode.value) {
  try {
    await flushSaves()
    emit('codex-action', {
      request: {
        projectId: props.project.id,
        chapterId: chapter.id,
        task: 'planning_field',
        intent: 'draft',
        executionMode: mode === 'app_model' ? 'app_model' : 'codex',
        modelProfileId: mode === 'app_model' ? props.modelSettings.routes?.planning_field || '' : '',
        modelProfileName: mode === 'app_model' ? planningModelName.value : '',
        target: {
          kind: 'planning_chapter_bundle',
          targetId: chapter.id,
          fieldLabel: `第 ${chapter.chapterNo} 章《${chapter.title}》 · AI 补全本章`,
          fieldKeys: chapterPlanFields.map((field) => field.key),
          includeFilled: false,
        },
        instruction: [
          '一次补全本章仍为空白的规划字段；本章合同、人物目标、阻力、转折、回报、代价、结尾和场景计划必须形成可执行的因果链。',
          '保留没有被请求的已确认字段，不要覆盖已有章节事实或越过已确认结尾。',
          generationInstruction.value,
        ].filter(Boolean).join('\n'),
      },
      onAccepted: () => loadCenter(),
    })
  } catch (error) {
    emit('toast', `整章规划生成启动失败：${error.message}`)
  }
}

function generateChapterField(chapter, field, mode = defaultExecutionMode.value) {
  return startFieldGeneration(field, {
    targetType: 'chapter', targetId: chapter.id, targetLabel: `第 ${chapter.chapterNo} 章 · ${chapter.title}`,
    currentValue: chapterFieldValue(chapter, field), nearbyContext: JSON.stringify({ card: chapter.card, scenePlan: chapter.scenePlan }),
    chapterId: chapter.id, scopeType: 'chapter', scopeId: chapter.id,
  }, mode)
}

async function emitStoryChange(target, currentValue) {
  try {
    await flushSaves()
    emit('story-change', {
      target: { ...target, currentValue: String(currentValue ?? '') },
    })
  } catch (error) {
    emit('toast', `保存当前设定后才能联动修改：${error.message}`)
  }
}

function requestDocumentChange(kind, field) {
  return emitStoryChange({
    kind: 'planning_document',
    targetId: kind,
    fieldKey: field.key,
    fieldLabel: field.label,
  }, center.value?.documents?.[kind]?.content?.[field.key])
}

function requestEntityChange(entity, field) {
  const currentValue = field.key === 'title' ? entity.title : entity.data?.[field.key]
  return emitStoryChange({
    kind: 'planning_entity',
    targetId: entity.id,
    fieldKey: field.key,
    fieldLabel: `${entity.title} · ${field.label}`,
  }, currentValue)
}

function requestChapterChange(chapter, field) {
  return emitStoryChange({
    kind: 'chapter_field',
    targetId: chapter.id,
    fieldKey: field.key,
    fieldLabel: `第 ${chapter.chapterNo} 章 · ${field.label}`,
  }, chapterFieldValue(chapter, field))
}

async function requestRendererDraft({ kind, form, targetId = '', fieldKey, fieldLabel, mode }) {
  if (!form) return
  const digest = () => draftDigest(form)
  const instruction = [
    `请为“${fieldLabel}”生成一项可直接填入表单的文本候选。`,
    `当前未保存表单（只作为草稿，不作为项目事实）：${JSON.stringify(form)}`,
  ].join('\n')
  if (mode !== 'codex') {
    const generation = appService.startGeneration({
      task: 'planning_field', projectId: props.project.id,
      instruction,
      modelProfileId: props.modelSettings.routes?.planning_field,
      planning: {
        sectionLabel: meta.value.title, targetLabel: fieldLabel, targetType: 'renderer_draft', targetId: targetId || 'new',
        fieldKey, fieldLabel, currentValue: String(form[fieldKey] || ''), nearbyContext: JSON.stringify(form),
        scopeType: 'project', scopeId: props.project.id,
      },
    })
    try {
      const result = await generation.promise
      form[fieldKey] = result.text || ''
      emit('toast', `${fieldLabel}候选已填入编辑器，尚未保存`)
    } catch (error) { emit('toast', `生成失败：${error.message}`) }
    return
  }
  const initialDigest = digest()
  emit('codex-action', {
    request: {
      projectId: props.project.id,
      task: 'planning_field',
      target: { kind, targetId, fieldKey, fieldLabel, draftDigest: initialDigest },
      instruction,
    },
    getDraftDigest: digest,
    getDraftValue: () => String(form[fieldKey] || ''),
    applyDraft: (text) => { form[fieldKey] = text },
  })
}

function requestRelationshipDraft(fieldKey, fieldLabel, mode) {
  return requestRendererDraft({ kind: 'relationship_draft', form: relationshipForm.value, targetId: relationshipForm.value?.id || '', fieldKey, fieldLabel, mode })
}
function requestArcDraft(fieldKey, fieldLabel, mode) {
  return requestRendererDraft({ kind: 'story_arc_draft', form: arcForm.value, targetId: arcForm.value?.id || '', fieldKey, fieldLabel, mode })
}
function requestArcBeatDraft(fieldKey, fieldLabel, mode) {
  return requestRendererDraft({ kind: 'story_arc_beat_draft', form: arcBeatForm.value, targetId: arcBeatForm.value?.id || '', fieldKey, fieldLabel, mode })
}

function ensurePersistedFormValue(saved, form, fieldKey, label) {
  if (!saved || String(saved[fieldKey] ?? '') !== String(form?.[fieldKey] ?? '')) {
    emit('toast', `“${label}”有尚未保存的修改，请先保存后再联动分析`)
    return false
  }
  return true
}

function requestRelationshipChange(fieldKey, fieldLabel) {
  const saved = center.value.relationships.find((item) => item.id === relationshipForm.value?.id)
  if (!ensurePersistedFormValue(saved, relationshipForm.value, fieldKey, fieldLabel)) return
  return emitStoryChange({ kind: 'relationship', targetId: saved.id, fieldKey, fieldLabel: `人物关系 · ${fieldLabel}` }, saved[fieldKey])
}

function requestArcChange(fieldKey, fieldLabel) {
  const saved = center.value.storyArcs.find((item) => item.id === arcForm.value?.id)
  if (!ensurePersistedFormValue(saved, arcForm.value, fieldKey, fieldLabel)) return
  return emitStoryChange({ kind: 'story_arc', targetId: saved.id, fieldKey, fieldLabel: `${saved.title} · ${fieldLabel}` }, saved[fieldKey])
}

function requestArcBeatChange(fieldKey, fieldLabel) {
  const saved = selectedArc.value?.beats?.find((item) => item.id === arcBeatForm.value?.id)
  if (!ensurePersistedFormValue(saved, arcBeatForm.value, fieldKey, fieldLabel)) return
  const storageFieldKey = fieldKey === 'changeText' ? 'change_text' : fieldKey
  return emitStoryChange({ kind: 'story_arc_beat', targetId: saved.id, fieldKey: storageFieldKey, fieldLabel: `${saved.label} · ${fieldLabel}` }, saved[fieldKey])
}

async function startFieldGeneration(field, target, mode = defaultExecutionMode.value) {
  if (activeGeneration) return
  try { await flushSaves() } catch { return }
  const planning = {
    sectionLabel: meta.value.title,
    targetLabel: target.targetLabel,
    targetType: target.targetType,
    targetId: target.targetId,
    fieldKey: field.key,
    fieldLabel: field.label,
    currentValue: target.currentValue,
    nearbyContext: target.nearbyContext,
    scopeType: target.planningScopeType || target.scopeType,
    scopeId: target.scopeId,
    entityKind: target.entityKind || '',
    boundaries: center.value.documents?.foundation?.content?.boundaries || '',
  }
  if (mode === 'codex') {
    const kind = target.targetType === 'document' ? 'planning_document' : target.targetType === 'entity' ? 'planning_entity' : 'chapter_field'
    emit('codex-action', {
      request: {
        projectId: props.project.id,
        chapterId: target.chapterId || '',
        task: 'planning_field',
        intent: 'draft',
        target: {
          kind,
          targetId: target.targetId,
          fieldKey: field.key,
          fieldLabel: field.label,
          promptProfile: planningPromptProfile(planning),
          scopeType: target.scopeType,
          scopeId: target.scopeId,
        },
        instruction: generationInstruction.value,
      },
      onAccepted: () => loadCenter(),
    })
    return
  }
  generationKey.value = `${target.targetType}:${target.targetId}:${field.key}`
  generationVisible.value = true
  generationStream.value = ''
  generationStatus.value = '模型正在阅读已确认的规划…'
  generationFieldLabel.value = field.label
  const generation = appService.startGeneration({
    task: 'planning_field', projectId: props.project.id, chapterId: target.chapterId,
    instruction: generationInstruction.value,
    modelProfileId: props.modelSettings.routes?.planning_field,
    promptProfile: planningPromptProfile(planning),
    planning,
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

defineExpose({ flushSaves, reload: loadCenter })
</script>

<style scoped>
.planning-center { grid-column: 2 / 4; min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; color: var(--ink); background: #eee7da; }
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
.planning-index { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 17px 10px 28px; color: #c8ccce; border-right: 1px solid #434b50; background: #2b3238; }
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
.planning-canvas { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 25px 28px 60px; background: #eee7da; }
.planning-sheet { width: min(820px, 100%); margin: 0 auto; padding: 29px 32px 44px; background: var(--paper-soft); box-shadow: 0 8px 28px rgba(62,49,39,.08); }
.sheet-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
.sheet-heading span, .entity-editor-heading span { color: var(--copper); font: 600 8px var(--font-ui); letter-spacing: .14em; }.sheet-heading h2, .entity-editor-heading h2 { margin: 8px 0 0; font: 24px/1.25 var(--font-display); }.sheet-heading p { max-width: 260px; margin: 2px 0 0; color: #918578; font: 9px/1.65 var(--font-body); }
.sheet-heading-support { display: grid; justify-items: end; gap: 12px; max-width: 300px; }
.sheet-heading-support p { text-align: right; }
.planning-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 23px 18px; }
.candidate-rail { min-height: 0; overflow: auto; overscroll-behavior: contain; color: #514a43; border-left: 1px solid #cec2b3; background: #e5dccd; }
.candidate-heading { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 20px 17px; border-bottom: 1px solid #cfc3b4; }.candidate-heading h2 { margin: 8px 0 0; font: 19px var(--font-display); }.candidate-count { display: grid; place-items: center; min-width: 23px; height: 23px; color: #fff7ed; border-radius: 50%; background: var(--copper); font-size: 9px; }
.candidate-instruction { display: grid; gap: 7px; padding: 15px 20px; border-bottom: 1px solid #d0c4b5; }.candidate-instruction span { color: #8b7e70; font-size: 8px; }.candidate-instruction textarea { min-height: 54px; padding: 8px; color: #554d45; border: 1px solid #cbbdab; outline: 0; resize: vertical; background: rgba(255,255,255,.35); font: 9px/1.5 var(--font-body); }.candidate-instruction textarea:focus { border-color: var(--copper-light); background: #fffaf2; }
.candidate-stream { margin: 17px 16px; border: 1px solid #cda992; border-left: 3px solid var(--copper); background: #fff8ef; box-shadow: 0 8px 20px rgba(80,57,43,.1); }.candidate-stream > div { display: flex; align-items: center; gap: 7px; padding: 8px 9px; color: #76685d; border-bottom: 1px solid #e0ccbc; font-size: 8px; }.candidate-stream i { width: 6px; height: 6px; border-radius: 50%; background: var(--copper); animation: save-pulse .8s infinite; }.candidate-stream button { margin-left: auto; color: var(--copper); border: 0; background: transparent; font-size: 8px; }.candidate-stream pre { max-height: 260px; overflow: auto; margin: 0; padding: 12px; color: #51473f; font: 11px/1.75 var(--font-body); white-space: pre-wrap; }
.candidate-target { display: grid; gap: 6px; padding: 17px 20px 13px; }.candidate-target span { color: #9b8d7f; font-size: 8px; }.candidate-target strong { font: 16px var(--font-display); }
.candidate-version { margin: 0 16px 10px; padding: 12px; border: 1px solid #cec0ae; background: rgba(255,255,255,.26); }.candidate-version span { color: #978778; font-size: 8px; }.candidate-version pre { margin: 8px 0 0; color: #675d53; font: 10px/1.7 var(--font-body); white-space: pre-wrap; }.candidate-version.proposed { border-color: #d2a48e; border-left: 3px solid var(--copper); background: #fff8ef; }.candidate-version.proposed pre { color: #493f37; font-size: 11px; }
.candidate-model { padding: 2px 20px 13px; color: #a09385; font-size: 7px; }.candidate-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 7px; padding: 0 16px 18px; }.candidate-actions button { padding: 9px; color: #776b60; border: 1px solid #c8baaa; background: transparent; font-size: 8px; }.candidate-actions .accept { color: #fff8ef; border-color: var(--copper); background: var(--copper); }
.candidate-empty { display: grid; justify-items: center; padding: 48px 25px; color: #8d8073; text-align: center; }.candidate-empty > span { color: var(--copper); font-size: 28px; }.candidate-empty strong { margin-top: 10px; color: #5d544c; font: 14px var(--font-display); }.candidate-empty p { margin: 8px 0 0; font: 9px/1.65 var(--font-body); }
.candidate-queue { display: grid; gap: 4px; padding: 14px 16px 25px; border-top: 1px solid #cfc3b4; }.candidate-queue > span { margin-bottom: 5px; color: #918375; font-size: 8px; }.candidate-queue button { display: grid; gap: 3px; padding: 8px 9px; color: #71675d; border: 1px solid transparent; background: rgba(255,255,255,.2); text-align: left; }.candidate-queue button.active { border-color: #c69b84; background: #fff8ef; }.candidate-queue strong { font: 10px var(--font-display); }.candidate-queue small { color: #9b8e81; font-size: 7px; }
.entity-editor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 25px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }.chapter-plan-heading p { margin: 7px 0 0; color: #93877b; font-size: 9px; }.chapter-scope-tools { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: flex-end; gap: 10px; }.chapter-scope-tools label { display: grid; gap: 5px; color: #8d7f72; font-size: 8px; }.chapter-scope-tools select { min-width: 145px; height: 29px; padding: 0 8px; color: #5a5047; border: 1px solid #d4c5b5; outline: 0; background: rgba(255,255,255,.48); font-size: 9px; }.chapter-scope-tools select:focus { border-color: var(--copper-light); }.chapter-plan-status { padding: 5px 7px; border: 1px solid #d5b6a3; }.chapter-delete-button { align-self: center; padding: 6px 4px; color: #a34e3c; border: 0; background: transparent; font-size: 8px; }
.planning-confirm-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(20,23,26,.7); backdrop-filter: blur(4px); }.planning-confirm { width: min(430px, 90vw); padding: 29px 31px; background: var(--paper-soft); box-shadow: 0 24px 65px rgba(10,12,14,.38); }.planning-confirm h2 { margin: 10px 0 8px; font: 23px var(--font-display); }.planning-confirm p { color: #8c7f72; font: 10px/1.65 var(--font-body); }.planning-confirm > div { display: flex; justify-content: flex-end; gap: 7px; margin-top: 20px; }.planning-confirm button { padding: 8px 11px; color: #766b61; border: 1px solid var(--line); background: transparent; font-size: 8px; }.planning-confirm button.danger { color: white; border-color: #9b4332; background: #9b4332; }
.index-add:disabled { opacity: .38; cursor: default; }.relationship-index-item { display: grid; gap: 4px; width: 100%; padding: 9px; color: #a2aaae; border: 0; border-left: 2px solid transparent; background: transparent; text-align: left; }.relationship-index-item:hover, .relationship-index-item.active { color: #fff8ef; border-left-color: #8aa2ad; background: #353e44; }.relationship-index-item span { overflow: hidden; font: 10px var(--font-display); text-overflow: ellipsis; white-space: nowrap; }.relationship-index-item small { overflow: hidden; color: #748086; font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }
.relationship-heading, .location-heading { align-items: center; }.relationship-graph { position: relative; min-height: 440px; overflow: hidden; margin-top: 20px; border: 1px solid #c8c1b6; background-color: #e7e4dc; background-image: linear-gradient(rgba(82,96,101,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(82,96,101,.08) 1px, transparent 1px); background-size: 28px 28px; box-shadow: inset 0 0 80px rgba(67,77,81,.06); }.relationship-graph::before { content: ''; position: absolute; inset: 18px; border: 1px solid rgba(91,108,115,.16); pointer-events: none; }.relationship-graph svg { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; overflow: visible; }.relationship-edge { cursor: pointer; }.relationship-edge line { stroke: #71848c; stroke-width: .42; vector-effect: non-scaling-stroke; transition: stroke-width .15s, opacity .15s; }.relationship-edge text { fill: #65757c; paint-order: stroke; stroke: #e7e4dc; stroke-width: .8px; font: 2.2px var(--font-ui); text-anchor: middle; dominant-baseline: central; }.relationship-edge.trend-warming line { stroke: #648b78; }.relationship-edge.trend-cooling line { stroke: #878d99; stroke-dasharray: 2 1; }.relationship-edge.trend-hostile line { stroke: #a25443; stroke-dasharray: 1.3 .8; }.relationship-edge.active line, .relationship-edge:hover line { stroke-width: 1.2; opacity: 1; }.relationship-node { position: absolute; z-index: 2; display: grid; justify-items: center; width: 112px; padding: 0; color: #455057; border: 0; background: transparent; transform: translate(-50%, -50%); }.relationship-node > span { display: grid; place-items: center; width: 47px; height: 47px; color: #fffaf2; border: 3px solid #e7e4dc; border-radius: 50%; background: #53656d; box-shadow: 0 0 0 1px #86969d, 0 7px 18px rgba(57,66,70,.18); font: 19px var(--font-display); }.relationship-node strong { max-width: 112px; margin-top: 8px; overflow: hidden; font: 13px var(--font-display); text-overflow: ellipsis; white-space: nowrap; }.relationship-node small { margin-top: 2px; color: #7d878b; font-size: 7px; }.relationship-node:hover > span, .relationship-node.active > span { background: var(--copper); box-shadow: 0 0 0 1px var(--copper), 0 8px 20px rgba(132,75,58,.2); }.relationship-graph-hint { position: absolute; z-index: 3; left: 50%; top: 50%; padding: 12px 15px; color: #788387; background: rgba(231,228,220,.9); text-align: center; transform: translate(-50%, -50%); font: 9px/1.6 var(--font-body); }.relationship-graph-hint button { margin-top: 5px; padding: 6px 8px; color: #fff8ef; border: 0; background: #53656d; font-size: 8px; }
.relationship-editor { margin-top: 18px; padding: 20px 22px; border: 1px solid #d1c5b7; background: rgba(255,252,246,.72); }.relationship-editor-heading, .location-detail-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 13px; border-bottom: 1px solid #ded4c8; }.relationship-editor-heading span, .location-detail-heading span { color: #71848c; font: 600 8px var(--font-ui); letter-spacing: .12em; }.relationship-editor-heading h3, .location-detail-heading h3 { margin: 5px 0 0; font: 18px var(--font-display); }.relationship-editor-heading .danger-link { color: #a34e3c; border: 0; background: transparent; font-size: 8px; }.relationship-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; padding-top: 17px; }.relationship-form-grid label { display: grid; gap: 6px; }.relationship-form-grid label.wide { grid-column: 1 / -1; }.relationship-form-grid label > span { color: #6e655c; font: 10px var(--font-display); }.relationship-form-grid input, .relationship-form-grid select, .relationship-form-grid textarea { width: 100%; min-height: 35px; padding: 7px 9px; color: #504840; border: 1px solid #d4c7b8; outline: 0; background: rgba(255,255,255,.5); font: 10px/1.55 var(--font-body); }.relationship-form-grid textarea { min-height: 68px; resize: vertical; }.relationship-form-grid input:focus, .relationship-form-grid select:focus, .relationship-form-grid textarea:focus { border-color: #7e949d; box-shadow: 0 0 0 2px rgba(94,116,125,.08); }.relationship-editor-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 16px; }.relationship-editor-actions button { padding: 8px 10px; color: #786c62; border: 1px solid #c9baaa; background: transparent; font-size: 8px; }.relationship-editor-actions .save { color: #fff8ef; border-color: #53656d; background: #53656d; }.relationship-selection-empty, .relationship-empty { display: grid; justify-items: center; padding: 28px; color: #887d72; border: 1px dashed #c7baac; text-align: center; }.relationship-empty { min-height: 330px; align-content: center; }.relationship-empty > span { color: #687b83; font-size: 30px; }.relationship-empty strong { margin-top: 8px; font: 16px var(--font-display); }.relationship-empty p { max-width: 320px; margin: 7px 0 12px; font: 9px/1.65 var(--font-body); }.relationship-empty button { padding: 8px 10px; color: #fff8ef; border: 0; background: #53656d; font-size: 8px; }
.location-atlas { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; margin-top: 18px; }.location-card { min-width: 0; min-height: 150px; padding: 15px 16px; color: #595149; border: 1px solid #d2c5b6; border-top: 3px solid #758a92; background: rgba(255,252,246,.65); text-align: left; }.location-card.observed { border-top-style: dashed; border-top-color: #b27a5e; }.location-card:hover, .location-card.active { border-color: #758a92; background: #fffaf2; box-shadow: 0 8px 22px rgba(67,78,83,.09); }.location-card > div:first-child { display: flex; justify-content: space-between; gap: 10px; color: #7d8c91; font-size: 7px; }.location-card > div:first-child small { color: #9a8d81; }.location-card h3 { margin: 11px 0 5px; font: 18px var(--font-display); }.location-card p { min-height: 31px; margin: 0; overflow: hidden; color: #877a6e; font: 9px/1.55 var(--font-body); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }.location-occupants { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }.location-occupants span { padding: 3px 5px; color: #53656d; border: 1px solid #b9c4c5; font-size: 7px; }.location-detail { margin-top: 16px; padding: 20px 22px; border: 1px solid #d2c5b6; background: rgba(255,252,246,.72); }.location-detail-heading button { padding: 7px 9px; color: #fff8ef; border: 0; background: #758a92; font-size: 8px; }.location-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; padding: 16px 0; }.location-detail-grid .wide { grid-column: 1 / -1; }.location-detail-grid span { color: #79898f; font-size: 8px; }.location-detail-grid p { margin: 5px 0 0; color: #73695f; font: 10px/1.6 var(--font-body); white-space: pre-line; }.location-state-list { display: grid; gap: 6px; padding-top: 13px; border-top: 1px solid #ded4c8; }.location-state-list article { display: grid; grid-template-columns: minmax(90px, .4fr) auto minmax(150px, 1fr); align-items: baseline; gap: 10px; padding: 7px 0; }.location-state-list strong { font: 12px var(--font-display); }.location-state-list span { color: #8b989c; font-size: 7px; }.location-state-list p { margin: 0; color: #7b7065; font: 9px var(--font-body); }
.arc-copper { --arc-color: #a85e47; --arc-wash: rgba(168,94,71,.1); }.arc-pine { --arc-color: #587b69; --arc-wash: rgba(88,123,105,.1); }.arc-slate { --arc-color: #647d8a; --arc-wash: rgba(100,125,138,.1); }.arc-ochre { --arc-color: #a47b35; --arc-wash: rgba(164,123,53,.11); }.arc-plum { --arc-color: #806079; --arc-wash: rgba(128,96,121,.1); }
.arc-index-item { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 9px 8px; color: #aeb4b6; border: 0; border-left: 2px solid transparent; background: transparent; text-align: left; }.arc-index-item > i { flex: 0 0 auto; width: 8px; height: 8px; margin-top: 2px; border-radius: 50%; background: var(--arc-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-color) 16%, transparent); }.arc-index-item > span { min-width: 0; display: grid; gap: 4px; }.arc-index-item strong, .arc-index-item small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.arc-index-item strong { font: 10px var(--font-display); }.arc-index-item small { color: #727d82; font-size: 7px; }.arc-index-item:hover, .arc-index-item.active { color: #fff8ef; border-left-color: var(--arc-color); background: #353e44; }
.arc-planning-sheet { width: min(1120px, 100%); }.arc-heading { align-items: center; }.arc-heading-actions { display: flex; align-items: center; gap: 8px; }.arc-heading-actions .danger-link { padding: 7px 8px; color: #a34e3c; border: 1px solid #d2a99d; background: transparent; font-size: 8px; }.arc-create-button { padding: 8px 10px; color: #fff8ef; border: 0; background: #596a70; font-size: 8px; }.arc-empty { min-height: 320px; }.arc-matrix { overflow-x: auto; margin-top: 18px; border: 1px solid #c9bdaf; background: #e9e2d7; box-shadow: inset 0 0 35px rgba(72,60,50,.04); }.arc-grid { display: grid; align-items: stretch; }.arc-corner, .arc-column-heading { min-height: 62px; padding: 13px 14px; border-right: 1px solid #cfc4b7; border-bottom: 1px solid #c7baac; background: #dfd6c8; }.arc-corner, .arc-column-heading { display: grid; align-content: center; gap: 5px; }.arc-corner span, .arc-column-heading span { color: #5f5750; font: 12px var(--font-display); }.arc-corner small, .arc-column-heading small { color: #94877a; font-size: 7px; }.arc-column-heading { text-align: center; background: #e4dccf; }
.arc-row-label { position: relative; display: flex; align-items: flex-start; gap: 10px; min-height: 126px; padding: 19px 14px; color: #5b534c; border: 0; border-right: 1px solid #cfc4b7; border-bottom: 1px solid #d0c5b8; background: #e8e0d4; text-align: left; }.arc-row-label::after { content: ''; position: absolute; right: -7px; top: 29px; z-index: 2; width: 14px; height: 2px; background: var(--arc-color); }.arc-row-label > i { flex: 0 0 auto; width: 9px; height: 9px; margin-top: 3px; border: 2px solid #e8e0d4; border-radius: 50%; background: var(--arc-color); box-shadow: 0 0 0 1px var(--arc-color); }.arc-row-label > span { min-width: 0; display: grid; gap: 6px; }.arc-row-label strong { font: 14px/1.3 var(--font-display); }.arc-row-label small { color: #908477; font-size: 7px; }.arc-row-label:hover, .arc-row-label.active { background: #f4ede3; box-shadow: inset 3px 0 0 var(--arc-color); }
.arc-cell { position: relative; min-height: 126px; padding: 18px 11px 10px; border-right: 1px solid #d3c8bb; border-bottom: 1px solid #d0c5b8; background: rgba(255,252,246,.38); }.arc-cell::before { content: ''; position: absolute; left: 0; right: 0; top: 29px; height: 2px; background: var(--arc-color); opacity: .72; }.arc-beat-card { position: relative; z-index: 1; display: grid; gap: 5px; width: 100%; margin-bottom: 7px; padding: 10px 10px 9px; color: #5a514a; border: 1px solid color-mix(in srgb, var(--arc-color) 44%, #cfc4b8); border-left: 3px solid var(--arc-color); background: #fffaf2; text-align: left; box-shadow: 0 5px 12px rgba(67,55,47,.07); }.arc-beat-card::before { content: ''; position: absolute; left: 12px; top: -10px; width: 7px; height: 7px; border: 2px solid #e8e0d4; border-radius: 50%; background: var(--arc-color); }.arc-beat-card:hover, .arc-beat-card.active { background: #fffdf8; box-shadow: 0 7px 16px var(--arc-wash); transform: translateY(-1px); }.arc-beat-card strong { font: 11px var(--font-display); }.arc-beat-card small { color: var(--arc-color); font-size: 7px; }.arc-beat-card p { margin: 0; color: #86796d; font: 8px/1.5 var(--font-body); }.arc-beat-add { position: relative; z-index: 1; width: 100%; padding: 6px; color: #93867a; border: 1px dashed #c6b9aa; background: rgba(244,237,227,.9); font-size: 7px; }.arc-beat-add:hover { color: var(--arc-color); border-color: var(--arc-color); }
.arc-editor, .arc-beat-editor { margin-top: 18px; padding: 20px 22px; border: 1px solid #cec1b3; border-top: 3px solid var(--arc-color, #647d8a); background: rgba(255,252,246,.72); }.arc-beat-editor { --arc-color: #647d8a; }.arc-editor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 13px; border-bottom: 1px solid #ded4c8; }.arc-editor-heading span { color: var(--arc-color, #647d8a); font: 600 8px var(--font-ui); letter-spacing: .12em; }.arc-editor-heading h3 { margin: 5px 0 0; font: 18px var(--font-display); }.arc-editor-heading > button { color: #a34e3c; border: 0; background: transparent; font-size: 8px; }.arc-form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 16px; padding-top: 17px; }.arc-form-grid label { display: grid; gap: 6px; }.arc-form-grid label.wide { grid-column: 1 / -1; }.arc-form-grid label > span { color: #6e655c; font: 10px var(--font-display); }.arc-form-grid input, .arc-form-grid select, .arc-form-grid textarea { width: 100%; min-height: 35px; padding: 7px 9px; color: #504840; border: 1px solid #d4c7b8; outline: 0; background: rgba(255,255,255,.5); font: 10px/1.55 var(--font-body); }.arc-form-grid textarea { min-height: 64px; resize: vertical; }.arc-form-grid input:focus, .arc-form-grid select:focus, .arc-form-grid textarea:focus { border-color: var(--arc-color, #647d8a); box-shadow: 0 0 0 2px var(--arc-wash, rgba(100,125,138,.1)); }
.planning-loading { grid-column: 2 / 4; display: grid; place-items: center; color: #9b8d7e; background: var(--paper); font: 16px var(--font-display); }
.form-label-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.form-field-actions { display: flex; align-items: center; gap: 6px; }
.form-cascade { padding: 4px 6px; color: #786c61; border: 1px solid #d5c8b8; background: transparent; font: 8px var(--font-ui); }
.form-cascade:hover { color: var(--copper); border-color: #d9b7a6; }
@keyframes save-pulse { 50% { opacity: .35; transform: scale(.75); } }
@media (max-width: 1240px) { .planning-layout { grid-template-columns: 180px minmax(400px, 1fr) 250px; }.planning-canvas { padding-right: 18px; padding-left: 18px; }.planning-sheet { padding-right: 24px; padding-left: 24px; } }
</style>
