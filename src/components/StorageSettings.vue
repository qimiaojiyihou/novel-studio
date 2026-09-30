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
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { appService } from '../services/app-service.js'
const status = ref(null), busy = ref(false), message = ref('')
const sizeLabel = computed(() => `${((status.value?.databaseBytes || 0) / 1024 ** 3).toFixed(2)} GB`)
onMounted(async () => { try { status.value = await appService.getStorageStatus() } catch (error) { message.value = error.message } })
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
