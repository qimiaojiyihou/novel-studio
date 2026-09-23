<template>
  <div v-if="visible" class="transfer-backdrop" @mousedown.self="emit('close')">
    <section class="transfer-panel" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
      <header class="transfer-header">
        <div>
          <span class="transfer-kicker">PROJECT PORTFOLIO</span>
          <h2 id="transfer-title">带走正文，也保全创作现场</h2>
          <p>《{{ project?.title || '未命名小说' }}》可以交付为通用文稿，也可以封存为可恢复的完整项目。</p>
        </div>
        <button class="transfer-close" :disabled="busy" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <div class="transfer-spread">
        <section class="folio manuscript-folio">
          <div class="folio-index">01</div>
          <span class="folio-label">MANUSCRIPT</span>
          <h3>交付正文</h3>
          <p>按当前章节顺序整理成干净文稿，不夹带章节卡、提示词和内部记录。</p>
          <div class="format-stack">
            <button v-for="format in manuscriptFormats" :key="format.id" :disabled="busy" @click="emit('export', format.id)">
              <span class="format-mark">{{ format.mark }}</span>
              <span><strong>{{ format.name }}</strong><small>{{ format.note }}</small></span>
              <i>↗</i>
            </button>
          </div>
        </section>

        <section class="folio archive-folio">
          <div class="folio-index">02</div>
          <span class="folio-label">ARCHIVE</span>
          <h3>保全项目</h3>
          <p>正文、规划、人物、世界观、连续性、提示词绑定和版本记录会一并保存。</p>
          <div class="archive-seal" aria-hidden="true"><span>NS</span><small>PROJECT<br />ARCHIVE</small></div>
          <button class="archive-button" :disabled="busy" @click="emit('export', 'json')">
            <span><strong>导出项目备份</strong><small>JSON · 带完整性校验</small></span><i>保存</i>
          </button>
          <div class="privacy-note"><span>◇</span>模型配置与 API Key 不进入备份</div>
        </section>
      </div>

      <footer class="transfer-import">
        <div>
          <span class="transfer-kicker">OPEN ANOTHER WORK</span>
          <strong>从文件建立新项目</strong>
          <small>支持 TXT、Markdown、Word、JSON；导入后生成独立项目，不覆盖当前内容。</small>
        </div>
        <button :disabled="busy" @click="emit('import')">{{ busy ? '正在处理…' : '选择文件导入' }}</button>
      </footer>
    </section>
  </div>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  project: { type: Object, default: () => ({}) },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'export', 'import'])

const manuscriptFormats = [
  { id: 'txt', mark: 'TXT', name: '纯文本', note: '适合平台上传与轻量交换' },
  { id: 'markdown', mark: 'MD', name: 'Markdown', note: '保留书名与章节标题层级' },
  { id: 'docx', mark: 'W', name: 'Word 书籍', note: '章节标题加粗，正文首行缩进且段间无空行' },
]
</script>

<style scoped>
.transfer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(25, 24, 21, 0.74);
  backdrop-filter: blur(9px);
}

.transfer-panel {
  width: min(920px, 96vw);
  max-height: 92vh;
  overflow: auto;
  color: #292722;
  background: #eee9de;
  border: 1px solid rgba(255, 255, 255, 0.48);
  border-radius: 4px;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
}

.transfer-header {
  display: flex;
  justify-content: space-between;
  gap: 32px;
  padding: 30px 34px 26px;
  border-bottom: 1px solid rgba(62, 57, 49, 0.16);
  background: linear-gradient(115deg, #f6f2e8 0%, #eee7d9 65%, #e7ded0 100%);
}

.transfer-kicker,
.folio-label {
  color: #9b5c45;
  font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.19em;
}

.transfer-header h2 {
  margin: 8px 0 7px;
  font: 600 28px/1.18 "Songti SC", STSong, serif;
}

.transfer-header p,
.folio p {
  margin: 0;
  color: #6e685e;
  font-size: 13px;
  line-height: 1.65;
}

.transfer-close {
  flex: 0 0 34px;
  height: 34px;
  color: #5e574e;
  border: 1px solid rgba(59, 54, 47, 0.18);
  border-radius: 50%;
  background: transparent;
  font-size: 24px;
  cursor: pointer;
}

.transfer-spread {
  display: grid;
  grid-template-columns: 1.08fr 0.92fr;
}

.folio {
  position: relative;
  min-height: 390px;
  padding: 32px 34px;
  overflow: hidden;
}

.manuscript-folio { border-right: 1px solid rgba(62, 57, 49, 0.15); }
.archive-folio { background: #ded5c7; }

.folio-index {
  position: absolute;
  top: 13px;
  right: 20px;
  color: rgba(79, 71, 61, 0.12);
  font: 700 78px/1 Georgia, serif;
}

.folio h3 {
  position: relative;
  margin: 8px 0 8px;
  font: 600 23px/1.2 "Songti SC", STSong, serif;
}

.format-stack {
  display: grid;
  gap: 10px;
  margin-top: 24px;
}

.format-stack button,
.archive-button {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  padding: 13px 14px;
  color: inherit;
  text-align: left;
  border: 1px solid rgba(70, 63, 54, 0.15);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.43);
  cursor: pointer;
  transition: 160ms ease;
}

.format-stack button:hover:not(:disabled),
.archive-button:hover:not(:disabled) {
  border-color: rgba(155, 92, 69, 0.52);
  background: rgba(255, 255, 255, 0.72);
  transform: translateX(2px);
}

.format-stack button > span:nth-child(2),
.archive-button > span { display: grid; gap: 2px; flex: 1; }
.format-stack strong,
.archive-button strong { font-size: 13px; }
.format-stack small,
.archive-button small { color: #766f65; font-size: 11px; }
.format-stack i,
.archive-button i { color: #a35f47; font-size: 12px; font-style: normal; }

.format-mark {
  display: grid;
  place-items: center;
  width: 39px;
  height: 39px;
  color: #f5eee5;
  background: #373a36;
  border-radius: 2px;
  font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.archive-seal {
  display: grid;
  place-items: center;
  width: 126px;
  height: 126px;
  margin: 26px auto 22px;
  color: #8f543f;
  border: 1px solid rgba(143, 84, 63, 0.62);
  border-radius: 50%;
  box-shadow: inset 0 0 0 6px #ded5c7, inset 0 0 0 7px rgba(143, 84, 63, 0.28);
  transform: rotate(-6deg);
}

.archive-seal span { font: 600 30px/1 Georgia, serif; letter-spacing: 0.06em; }
.archive-seal small { margin-top: -27px; font: 700 8px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.16em; text-align: center; }
.archive-button { background: #353a36; color: #f1ece3; border-color: #353a36; }
.archive-button small { color: #beb9b0; }
.archive-button:hover:not(:disabled) { background: #414741; border-color: #414741; transform: translateY(-1px); }

.privacy-note {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 13px;
  color: #71695f;
  font-size: 11px;
}

.privacy-note span { color: #9b5c45; }

.transfer-import {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 34px;
  color: #e9e3d9;
  background: #30342f;
}

.transfer-import > div { display: grid; gap: 3px; }
.transfer-import strong { font: 600 15px/1.35 "Songti SC", STSong, serif; }
.transfer-import small { color: #aaa79f; font-size: 11px; }
.transfer-import button {
  flex: 0 0 auto;
  padding: 10px 17px;
  color: #f3ede4;
  border: 1px solid #a9634a;
  border-radius: 2px;
  background: #965942;
  cursor: pointer;
}

button:disabled { opacity: 0.55; cursor: wait; }

@media (max-width: 720px) {
  .transfer-backdrop { padding: 12px; }
  .transfer-header { padding: 23px; }
  .transfer-spread { grid-template-columns: 1fr; }
  .folio { min-height: auto; padding: 26px 23px; }
  .manuscript-folio { border-right: 0; border-bottom: 1px solid rgba(62, 57, 49, 0.15); }
  .transfer-import { align-items: stretch; flex-direction: column; padding: 20px 23px; }
}
</style>
