<template>
  <div class="project-brief-fields">
    <section class="brief-section genre-section" aria-labelledby="genre-heading">
      <div class="brief-section-heading">
        <div>
          <strong id="genre-heading">题材</strong>
          <small>先选一个接近的方向，也可以在下方改成混合题材</small>
        </div>
        <span>可自定义</span>
      </div>
      <div class="genre-choice-grid" role="list" aria-label="常用题材">
        <button
          v-for="option in GENRE_OPTIONS"
          :key="option"
          type="button"
          class="genre-choice"
          :class="{ active: genre === option }"
          :aria-pressed="genre === option"
          @click="emit('update:genre', option)"
        >
          {{ option }}
        </button>
      </div>
      <label class="brief-custom-input" :for="`${idPrefix}-genre`">
        <span>题材名称</span>
        <input
          :id="`${idPrefix}-genre`"
          :value="genre"
          :list="`${idPrefix}-genre-options`"
          placeholder="例如：历史穿越、科幻悬疑、娱乐圈经营"
          @input="emit('update:genre', $event.target.value)"
        />
        <datalist :id="`${idPrefix}-genre-options`">
          <option v-for="option in GENRE_OPTIONS" :key="option" :value="option" />
        </datalist>
      </label>
    </section>

    <section class="brief-section idea-section" aria-labelledby="idea-heading">
      <div class="brief-section-heading">
        <div>
          <strong id="idea-heading">一句话想法</strong>
          <small>完整句、几个关键词，甚至一个反常画面都可以</small>
        </div>
        <span>故事种子</span>
      </div>
      <textarea
        :id="`${idPrefix}-idea`"
        class="brief-main-textarea"
        :value="idea"
        aria-label="一句话想法"
        placeholder="例如：一个收到未来来信的记者，必须阻止信里预告的下一场死亡。"
        @input="emit('update:idea', $event.target.value)"
      ></textarea>
      <details class="idea-builder">
        <summary>
          <span>
            <b>不会概括？用四个短语拼一句</b>
            <small>不调用模型，边填边生成，之后仍可任意修改</small>
          </span>
          <i>⌄</i>
        </summary>
        <div class="idea-builder-body">
          <div class="idea-builder-grid">
            <label :for="`${idPrefix}-protagonist`">
              <span>主角是谁</span>
              <input :id="`${idPrefix}-protagonist`" v-model="storySeed.protagonist" placeholder="一名失去部分记忆的记者" />
            </label>
            <label :for="`${idPrefix}-event`">
              <span>发生了什么</span>
              <input :id="`${idPrefix}-event`" v-model="storySeed.incitingEvent" placeholder="收到一封来自三天后的信" />
            </label>
            <label :for="`${idPrefix}-goal`">
              <span>必须做什么</span>
              <input :id="`${idPrefix}-goal`" v-model="storySeed.goal" placeholder="找出下一名死者并阻止凶案" />
            </label>
            <label :for="`${idPrefix}-stakes`">
              <span>失败会怎样（可空）</span>
              <input :id="`${idPrefix}-stakes`" v-model="storySeed.stakes" placeholder="他会成为唯一嫌疑人" />
            </label>
          </div>
          <div class="idea-preview" :class="{ empty: !ideaPreview }" aria-live="polite">
            <div>
              <span>拼出的故事句</span>
              <p>{{ ideaPreview || '填入上面的短语，这里会出现一条可编辑的故事想法。' }}</p>
            </div>
            <button type="button" :disabled="!ideaPreview" @click="emit('update:idea', ideaPreview)">填入上方</button>
          </div>
        </div>
      </details>
    </section>

    <section v-if="includeStyle" class="brief-section style-section" aria-labelledby="style-heading">
      <div class="brief-section-heading">
        <div>
          <strong id="style-heading">项目文风</strong>
          <small>不用掌握术语，先选一种读感，再修改不合适的字句</small>
        </div>
        <span>全书生效</span>
      </div>
      <div class="style-preset-grid" role="list" aria-label="文风起步方案">
        <button
          v-for="preset in STYLE_PRESETS"
          :key="preset.id"
          type="button"
          class="style-preset"
          :class="{ active: style === preset.text }"
          :aria-pressed="style === preset.text"
          :title="preset.text"
          @click="emit('update:style', preset.text)"
        >
          <b>{{ preset.label }}</b>
          <small>{{ preset.description }}</small>
        </button>
      </div>
      <label class="style-custom-copy" :for="`${idPrefix}-style`">
        <span>可执行的文风说明</span>
        <textarea
          :id="`${idPrefix}-style`"
          :value="style"
          placeholder="选择上方方案会自动填入；也可以只写：多对白、少解释、节奏快。"
          @input="emit('update:style', $event.target.value)"
        ></textarea>
      </label>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue'
import { buildIdeaSentence, GENRE_OPTIONS, STYLE_PRESETS } from '../utils/project-brief.js'

defineProps({
  genre: { type: String, default: '' },
  idea: { type: String, default: '' },
  style: { type: String, default: '' },
  includeStyle: { type: Boolean, default: true },
  idPrefix: { type: String, default: 'project-brief' },
})

const emit = defineEmits(['update:genre', 'update:idea', 'update:style'])
const storySeed = reactive({ protagonist: '', incitingEvent: '', goal: '', stakes: '' })
const ideaPreview = computed(() => buildIdeaSentence(storySeed))
</script>

