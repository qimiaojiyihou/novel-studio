<template>
  <section class="settings-block storage-settings" aria-label="书库与存储">
    <div class="settings-block-heading"><div><span class="settings-kicker">LOCAL LIBRARY</span><h3>书库与存储</h3></div><span class="settings-hint">本机数据目录</span></div>
    <p>正文、设定、版本、候选和创作记录集中保存。更换目录时，先正常保存退出，再复制、核验并切换；原目录保留。</p>
    <dl class="storage-paths">
      <dt>当前目录</dt><dd>{{ status?.directory || '读取中…' }}</dd>
      <dt>数据库文件</dt><dd>{{ status?.databasePath || '—' }}<small v-if="status">{{ sizeLabel }} · 迁移时回收内部空闲页，不删除创作记录</small></dd>
      <template v-if="status?.previousDirectory"><dt>保留的原目录</dt><dd>{{ status.previousDirectory }}</dd></template>
    </dl>
    <div v-if="status?.pending" class="storage-migration-plan" role="status">
      <strong>下次启动迁移到</strong><p>{{ status.pending.targetDirectory }}</p>
      <small>核对全部数据表与附属文件后才启用。失败时继续使用原书库。大书库可能需要数分钟。</small>
    </div>
    <p v-if="status?.lastError" role="alert">上次迁移未完成：{{ status.lastError }}。仍在使用原书库，可另选空目录重试。</p>
    <p v-if="message" role="status" aria-live="polite">{{ message }}</p>
    <div class="codex-actions">
      <button class="outline-button" :disabled="busy" @click="act('open')">打开当前目录</button>
      <button v-if="!status?.pending" class="outline-button" :disabled="busy || !status" @click="act('choose')">更换数据目录…</button>
      <template v-else><button class="outline-button" :disabled="busy" @click="act('cancel')">取消迁移计划</button><button class="primary-button" :disabled="busy" @click="act('restart')">保存退出并迁移</button></template>
    </div>
    <small>请选择本机磁盘的空文件夹，保持磁盘连接。应用缓存、Codex 组件和外接接口入口留在系统应用目录，已有书籍专属任务继续绑定原项目 ID。迁移不是多电脑实时共享书库。</small>
    <div class="storage-migration-plan" aria-label="自动任务历史清理">
      <h4>自动任务历史清理</h4>
      <p>自动创作完成后归档 Codex 会话；每天在空闲时检查一次，清理超过保留期、已归档且已完成或取消的自动任务历史文件。正文、候选和生成记录继续保存在书库中。</p>
      <label><input v-model="cleanupEnabled" type="checkbox" :disabled="busy || !status" /> 定期清理历史文件</label>
      <label> 保留最近 <input v-model.number="retentionDays" type="number" min="1" max="365" style="width: 5em" :disabled="busy || !status" /> 天</label>
      <button class="outline-button" :disabled="busy || !status" @click="saveCleanup">保存清理设置</button>
      <p v-if="status?.historyCleanup?.lastRunAt">上次检查：{{ new Date(status.historyCleanup.lastRunAt).toLocaleString() }}<template v-if="status.historyCleanup.lastResult"> · 清理 {{ status.historyCleanup.lastResult.removed }} 个文件，释放 {{ (status.historyCleanup.lastResult.bytesFreed / 1024 ** 2).toFixed(1) }} MB<template v-if="status.historyCleanup.lastResult.errors"> · {{ status.historyCleanup.lastResult.errors }} 个文件未处理，将在下次检查重试</template></template></p>
      <p v-if="status?.historyCleanup?.lastError" role="alert">上次清理暂缓：{{ status.historyCleanup.lastError }}</p>
      <small v-if="status?.historyCleanup?.lastResult?.batchLimited">历史文件较多，后台会在空闲时继续分批清理。</small>
      <small>保留期默认 30 天。未完成任务、待采纳候选和手动会话会跳过。清理后的 Codex 历史原文不再保留，应用内创作结果和记录保留。</small>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { appService } from '../services/app-service.js'
const status = ref(null), busy = ref(false), message = ref('')
const cleanupEnabled = ref(true), retentionDays = ref(30)
const sizeLabel = computed(() => `${((status.value?.databaseBytes || 0) / 1024 ** 3).toFixed(2)} GB`)
onMounted(async () => {
  try {
    status.value = await appService.getStorageStatus()
    cleanupEnabled.value = status.value.historyCleanup?.enabled !== false
    retentionDays.value = status.value.historyCleanup?.retentionDays || 30
  } catch (error) { message.value = error.message }
})
async function saveCleanup() {
  if (busy.value) return
  busy.value = true; message.value = ''
  try {
    status.value = await appService.saveHistoryCleanupSettings({ enabled: cleanupEnabled.value, retentionDays: retentionDays.value })
    message.value = '清理设置已保存，将在后台空闲时按保留期检查。'
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
}
async function act(action) {
  if (busy.value) return
  busy.value = true; message.value = ''
  try {
    if (action === 'open') await appService.openStorageDirectory()
    if (action === 'choose') {
      const result = await appService.chooseStorageDirectory()
      if (!result.cancelled) { status.value = result; message.value = '迁移计划已保存；点击“保存退出并迁移”，或下次正常启动时执行。' }
    }
    if (action === 'cancel') { status.value = await appService.cancelStorageMigration(); message.value = '已取消迁移计划，继续使用当前书库。' }
    if (action === 'restart') { await appService.restartForStorageMigration(); message.value = '正在正常保存并退出；若仍有创作任务，请结束任务后重试。' }
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
}
</script>
