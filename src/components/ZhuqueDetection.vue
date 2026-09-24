<template>
  <div class="zhuque-backdrop" @mousedown.self="$emit('close')">
    <section class="zhuque-dialog" role="dialog" aria-modal="true" aria-label="朱雀 AI 检测">
      <header>
        <div><span class="zhuque-kicker">章节文本检测</span><h2>朱雀 AI 检测</h2><p>仅发送当前章节正文至腾讯云 EdgeOne 朱雀接口；结果是概率参考，不替代作者判断。</p></div>
        <button class="zhuque-close" type="button" aria-label="关闭检测结果" @click="$emit('close')">×</button>
      </header>
      <main>
        <p v-if="loading" class="zhuque-notice" role="status">正在读取本章检测记录…</p>
        <template v-else>
          <div class="zhuque-key-box">
            <h3>检测密钥 <small>全局共用</small></h3>
            <p>可保存多把密钥；选择后所有书籍和章节的新检测都会使用它。密钥由主进程加密保存，不回传明文。</p>
            <div v-if="keys.length" class="zhuque-key-picker">
              <label for="zhuque-selected-key">当前使用</label>
              <select id="zhuque-selected-key" :value="selectedKeyId || ''" :disabled="busy" @change="selectKey($event.target.value)">
                <option value="" disabled>请选择密钥</option>
                <option v-for="key in keys" :key="key.id" :value="key.id">{{ key.label }}</option>
              </select>
              <button type="button" :disabled="busy || !selectedKeyId" @click="removeSelectedKey">移除当前密钥</button>
            </div>
            <form @submit.prevent="addKey">
              <input v-model.trim="keyLabel" type="text" maxlength="80" autocomplete="off" aria-label="密钥名称" placeholder="密钥名称，如：个人额度" required />
              <input v-model.trim="apiKey" type="password" autocomplete="new-password" aria-label="朱雀 API Key" placeholder="输入新的 API Key" required />
              <button type="submit" :disabled="busy || !keyLabel || !apiKey">保存并选用</button>
            </form>
          </div>
          <div class="zhuque-toolbar">
            <span>{{ configured ? '检测只在点击按钮后开始；重新检测会覆盖本章上次结果，不保留历史。' : '请先保存并选择一把密钥，再检测本章。' }}</span>
            <button type="button" :disabled="busy || !configured" @click="detect">{{ busy ? '处理中…' : result ? '重新检测本章' : '检测本章' }}</button>
          </div>
          <p v-if="error" class="zhuque-error" role="alert">{{ error }}</p>
          <p v-if="busy" class="zhuque-notice" role="status">正在检测本章正文，请稍候…</p>
          <template v-if="result">
            <div v-if="result.stale" class="zhuque-stale" role="status">正文在这次检测后已修改，以下是旧稿结果。请重新检测本章。</div>
            <div class="zhuque-result-heading"><h3>检测结果</h3><span>{{ formatDate(result.checkedAt) }}</span></div>
            <div class="zhuque-metrics">
              <div><small>整体风险比例</small><strong>{{ percent(result.ratioConfidence) }}</strong></div>
              <div><small>整体风险置信度</small><strong>{{ percent(result.softmaxConfidence) }}</strong></div>
              <div><small>人类 / AI / 疑似 AI 片段占比</small><strong>{{ percent(result.labelsRatio?.human) }} / {{ percent(result.labelsRatio?.ai) }} / {{ percent(result.labelsRatio?.suspected) }}</strong></div>
            </div>
            <p class="zhuque-hint">按接口返回的标签和置信度展示；百分比不等于文本来源的确定性证明。<span v-if="result.billedTokens !== null">本次计费 Token：{{ result.billedTokens }}</span></p>
            <div class="zhuque-repair">
              <div><strong>根据检测结果改稿</strong><p>模型会读取本章结果和正文，生成完整候选；你核对差异后决定是否写入。</p></div>
              <div class="zhuque-repair-actions">
                <button type="button" :disabled="busy || repairBusy || result.stale" @click="$emit('repair', { mode: 'codex', digest: result.manuscriptDigest })">使用 Codex 生成候选<span v-if="defaultMode === 'codex'"> · 默认</span></button>
                <button type="button" :disabled="busy || repairBusy || result.stale" @click="$emit('repair', { mode: 'app_model', digest: result.manuscriptDigest })">使用 {{ appModelLabel }} 生成候选<span v-if="defaultMode !== 'codex'"> · 默认</span></button>
              </div>
            </div>
            <h3 class="zhuque-segment-title">分段明细 <small>{{ result.segments?.length || 0 }} 段</small></h3>
            <div v-if="result.segments?.length" class="zhuque-segments">
              <article v-for="(segment, index) in result.segments" :key="index">
                <div><span :class="['zhuque-label', `label-${segment.label}`]">{{ label(segment.label) }}</span><span>置信度 {{ percent(segment.confidence) }}</span></div>
                <p>{{ segment.text }}</p>
              </article>
            </div>
            <p v-else class="zhuque-hint">接口没有返回分段明细。</p>
          </template>
        </template>
      </main>
      <footer><a href="https://cloud.tencent.com/document/product/1552/137539" target="_blank" rel="noreferrer">查看腾讯云接口说明</a><button type="button" @click="$emit('close')">关闭</button></footer>
    </section>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { appService } from '../services/app-service.js'

const props = defineProps({
  projectId: { type: String, required: true }, chapterId: { type: String, required: true },
  defaultMode: { type: String, default: 'app_model' }, appModelLabel: { type: String, default: '任务模型' },
  repairBusy: { type: Boolean, default: false },
})
defineEmits(['close', 'repair'])
const loading = ref(true), busy = ref(false), configured = ref(false), result = ref(null), error = ref(''), apiKey = ref(''), keyLabel = ref(''), keys = ref([]), selectedKeyId = ref(null)
let stopKeyEvents
const target = () => ({ projectId: props.projectId, chapterId: props.chapterId })
const percent = (value) => value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`
const label = (value) => ({ 0: '人类', 1: 'AI', 2: '疑似 AI' })[value] || '未标注'
const formatDate = (value) => value ? new Date(value).toLocaleString('zh-CN') : ''

async function detect() {
  if (busy.value || !configured.value) return
  busy.value = true
  error.value = ''
  try { result.value = await appService.detectChapterWithZhuque(target()) }
  catch (cause) { error.value = cause.message || String(cause) }
  finally { busy.value = false }
}

function applyKeyStatus(status) {
  keys.value = status.keys || []
  selectedKeyId.value = status.selectedKeyId || null
  configured.value = status.configured
}

async function addKey() {
  if (busy.value || !apiKey.value || !keyLabel.value) return
  busy.value = true
  error.value = ''
  try {
    applyKeyStatus(await appService.addZhuqueApiKey({ label: keyLabel.value, apiKey: apiKey.value }))
    apiKey.value = ''
    keyLabel.value = ''
  } catch (cause) { error.value = cause.message || String(cause) }
  finally { busy.value = false }
}

async function selectKey(id) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { applyKeyStatus(await appService.selectZhuqueApiKey(id)) }
  catch (cause) { error.value = cause.message || String(cause) }
  finally { busy.value = false }
}

async function removeSelectedKey() {
  if (busy.value || !selectedKeyId.value) return
  busy.value = true
  error.value = ''
  try { applyKeyStatus(await appService.removeZhuqueApiKey(selectedKeyId.value)) }
  catch (cause) { error.value = cause.message || String(cause) }
  finally { busy.value = false }
}

onMounted(async () => {
  stopKeyEvents = appService.onZhuqueKeysChanged(applyKeyStatus)
  try {
    const status = await appService.getZhuqueDetection(target())
    applyKeyStatus(status)
    result.value = status.result
  } catch (cause) { error.value = cause.message || String(cause) }
  finally { loading.value = false }
})
onUnmounted(() => stopKeyEvents?.())
</script>

<style scoped>
.zhuque-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(25,43,53,.48);display:grid;place-items:center;padding:24px}
.zhuque-dialog{width:min(1040px,100%);max-height:min(850px,calc(100vh - 48px));display:flex;flex-direction:column;background:#f8fcfd;border:1px solid #c7dce2;border-radius:20px;box-shadow:0 24px 90px #142e3952;color:#263b44;overflow:hidden}
.zhuque-dialog header,.zhuque-dialog footer{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:22px 28px;background:#f0f8fa}
.zhuque-dialog header{border-bottom:1px solid #d5e5e9}.zhuque-dialog header h2{font-size:25px;margin:2px 0 6px}.zhuque-dialog header p{margin:0;color:#61767e;font-size:13px}.zhuque-kicker{font-size:11px;letter-spacing:.15em;color:#507970}.zhuque-close{font-size:27px;line-height:1;min-width:38px}
.zhuque-dialog main{padding:24px 28px;overflow:auto;min-height:130px}.zhuque-dialog footer{align-items:center;border-top:1px solid #d5e5e9;padding:14px 28px}.zhuque-dialog footer a{color:#396c72;font-size:13px}
.zhuque-dialog button{border:1px solid #bcd4db;border-radius:9px;background:#fff;color:#264a50;padding:10px 15px;cursor:pointer}.zhuque-dialog button:disabled{opacity:.55;cursor:default}.zhuque-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#eaf5f4;padding:13px 16px;border-radius:10px;font-size:13px}.zhuque-toolbar button,.zhuque-key-box button{background:#37695f;color:white;border-color:#37695f}
.zhuque-key-box{border:1px solid #d1e3e6;background:white;border-radius:12px;padding:20px;margin-bottom:12px}.zhuque-key-box h3{margin:0 0 8px}.zhuque-key-box h3 small{font-size:12px;color:#5a8077;font-weight:normal}.zhuque-key-box p,.zhuque-hint{font-size:13px;color:#687e85}.zhuque-key-box form,.zhuque-key-picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}.zhuque-key-picker label{font-size:13px}.zhuque-dialog input,.zhuque-dialog select{flex:1;min-width:180px;padding:10px 12px;border:1px solid #bcd4db;border-radius:8px;font:inherit;background:white;color:#263b44}
.zhuque-error,.zhuque-stale,.zhuque-notice{padding:12px 15px;border-radius:8px;margin:14px 0}.zhuque-error{background:#fff1ed;color:#a13f2c}.zhuque-stale{background:#fff6df;color:#76591d}.zhuque-notice{background:#e8f3f6;color:#365b68}.zhuque-result-heading{display:flex;align-items:baseline;justify-content:space-between;margin-top:20px}.zhuque-result-heading h3{margin:0 0 12px}.zhuque-result-heading span{font-size:12px;color:#687e85}
.zhuque-repair{display:flex;justify-content:space-between;align-items:center;gap:20px;margin:20px 0 24px;padding:17px;border:1px solid #c9dfdc;border-radius:10px;background:#edf7f4}.zhuque-repair strong{font-size:15px}.zhuque-repair p{font-size:12px;color:#61767e;margin:5px 0 0}
.zhuque-repair-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;flex-shrink:0}.zhuque-dialog .zhuque-repair-actions button{background:#37695f;border-color:#37695f;color:#fff;font-weight:600;white-space:nowrap}.zhuque-dialog .zhuque-repair-actions button+button{background:#fff;color:#37695f}.zhuque-repair-actions button span{font-size:11px;opacity:.8}
.zhuque-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.zhuque-metrics>div{background:white;border:1px solid #d5e5e9;border-radius:10px;padding:17px;display:flex;flex-direction:column;gap:9px}.zhuque-metrics small{color:#61767e}.zhuque-metrics strong{font-size:20px;overflow-wrap:anywhere}.zhuque-hint span{margin-left:12px}.zhuque-segment-title{margin:28px 0 12px}.zhuque-segment-title small{font-size:13px;font-weight:normal;color:#687e85}.zhuque-segments{display:grid;gap:10px}.zhuque-segments article{border:1px solid #d5e5e9;border-radius:10px;background:white;padding:16px}.zhuque-segments article>div{display:flex;gap:12px;align-items:center;font-size:12px;color:#687e85}.zhuque-segments p{white-space:pre-wrap;line-height:1.75;margin:10px 0 0}.zhuque-label{border-radius:5px;padding:3px 7px;background:#e8f3ed;color:#326549}.zhuque-label.label-1{background:#fff0eb;color:#a24233}.zhuque-label.label-2{background:#fff5de;color:#81621d}.zhuque-key-settings{margin-top:26px;font-size:13px;color:#61767e}.zhuque-key-settings summary{cursor:pointer}
@media(max-width:700px){.zhuque-backdrop{padding:8px}.zhuque-dialog{max-height:calc(100vh - 16px)}.zhuque-dialog header,.zhuque-dialog main{padding:17px}.zhuque-metrics{grid-template-columns:1fr}.zhuque-toolbar,.zhuque-repair{align-items:flex-start;flex-direction:column}.zhuque-repair-actions{justify-content:flex-start}}
</style>
