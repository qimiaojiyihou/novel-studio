<template>
  <section class="settings-block reader-settings" aria-label="手机与云端阅读">
    <div class="settings-block-heading"><div><span class="settings-kicker">READING & PUBLICATION</span><h3>手机与云端阅读</h3></div><a :href="status?.origin || 'https://txt.zhijianku.com'" target="_blank" rel="noopener noreferrer">打开阅读站 ↗</a></div>
    <p>在手机浏览器分页阅读，电脑关闭后仍可访问最后发布版本。只上传指定书籍的正文和公开简介；设定与创作记录留在本机。</p>
    <div class="reader-settings-grid">
      <label>阅读站地址<input v-model.trim="connection.origin" placeholder="https://txt.zhijianku.com" /></label>
      <label>发布凭据<input v-model="connection.token" type="password" autocomplete="new-password" :placeholder="status?.configured ? '已加密保存，留空保持原凭据' : '服务器配置的 64 位随机凭据'" /></label>
    </div>
    <div class="codex-actions"><button class="outline-button" :disabled="busy" @click="act(saveConnection)">保存连接</button><button class="test-button" :disabled="busy || !status?.configured" @click="act(refreshRemote)">检查阅读站</button><button class="outline-button" :disabled="busy" @click="copyLink">复制阅读链接</button></div>
    <p v-if="message" role="status" aria-live="polite">{{ message }}</p>
    <template v-if="remote">
      <div class="reader-setting-subsection"><h4>访问与阅读账号</h4><p>读者只可阅读，发布权限与阅读账号独立。账号密码修改后，已有登录会话失效。</p>
        <label class="reader-check"><input v-model="requireLogin" type="checkbox" />需要登录后阅读</label>
        <button class="outline-button" :disabled="busy" @click="act(saveAccess)">应用访问模式</button>
        <div class="reader-settings-grid"><label>阅读账号<input v-model.trim="account.username" autocomplete="off" maxlength="64" placeholder="由作者设置，不开放读者注册" /></label><label>密码<input v-model="account.password" type="password" autocomplete="new-password" maxlength="256" placeholder="至少 10 位；修改已有账号时可留空" /></label></div>
        <label class="reader-check"><input v-model="account.disabled" type="checkbox" />禁用此账号</label>
        <button class="outline-button" :disabled="busy" @click="act(saveAccount)">保存阅读账号</button>
        <ul class="reader-accounts"><li v-for="item in remote.accounts" :key="item.username"><span>{{ item.username }} · {{ item.disabled ? '已禁用' : '可用' }}</span><button :disabled="busy" @click="account = { username:item.username,password:'',disabled:item.disabled }">编辑</button><button :disabled="busy" @click="act(() => removeAccount(item.username))">删除</button></li></ul>
      </div>
    </template>
    <div class="reader-setting-subsection"><h4>按书籍发布与自动同步</h4>
      <label>选择书籍<select v-model="selectedId" @change="selectBook"><option value="">选择需要在手机阅读的书籍</option><option v-for="item in status?.projects || []" :key="item.id" :value="item.id">{{ item.title }}{{ item.auto ? ' · 自动同步' : '' }}</option></select></label>
      <template v-if="selectedId">
        <p v-if="selectedBook?.unavailable" role="alert">本机此书已归档或删除；云端旧版仍在。可以下架，恢复本机书籍后才可继续发布。</p>
        <div class="reader-settings-grid"><label>发布范围<select v-model="book.scope"><option value="completed">仅已定稿的非空正文</option><option value="all">全部非空已保存正文（含草稿）</option></select></label><label class="reader-check"><input v-model="book.auto" type="checkbox" :disabled="!selectedBook?.published" />此书保存后自动同步</label></div>
        <label>公开简介<textarea v-model="book.description" rows="3" maxlength="5000" placeholder="可留空，不自动上传故事种子或设定中的剧透" /></label>
        <p class="reader-note">每本书独立设置；自动同步约每 30 秒检查一次，只发布已保存的正文，不上传生成中的候选。需先手动发布一次再开启自动同步。仅定稿模式自动保留修订中章节的云端旧版；手动发布按当前范围替换目录。</p>
        <div class="codex-actions"><button class="outline-button" :disabled="busy || status?.busy || selectedBook?.unavailable" @click="act(saveBook)">保存此书发布设置</button><button class="primary-button" :disabled="busy || status?.busy || !status?.configured || selectedBook?.unavailable" @click="act(publish)">发布 / 同步此书</button><button v-if="selectedBook?.published" class="outline-button" :disabled="busy || status?.busy" @click="act(unpublish)">下架此书</button></div>
        <p v-if="selectedBook?.syncedAt">上次发布：{{ new Date(selectedBook.syncedAt).toLocaleString() }} · {{ selectedBook.chapterCount }} 章{{ selectedBook.auto ? ' · 自动同步已开启' : '' }}</p>
        <p v-if="selectedBook?.progress" role="status">{{ selectedBook.progress.phase }}<template v-if="selectedBook.progress.total"> · {{ selectedBook.progress.completed }} / {{ selectedBook.progress.total }} 章</template></p>
        <p v-if="selectedBook?.error || selectedBook?.progress?.error" role="alert">{{ selectedBook.error || selectedBook.progress.error }}</p>
        <p v-if="selectedBook?.auto && selectedBook.retryAt">暂时离线；下次自动重试：{{ new Date(selectedBook.retryAt).toLocaleTimeString() }}</p>
      </template>
    </div>
    <small>先在 1Panel 部署阅读服务并配置 HTTPS，再保存连接。此功能是正文发布，不是书库备份；网站访问模式全站统一，公开过的内容可能已被读者复制。</small>
  </section>
</template>
<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { appService } from '../services/app-service.js'
const status = ref(null), remote = ref(null), busy = ref(false), message = ref(''), selectedId = ref(''), requireLogin = ref(true)
const connection = reactive({ origin: 'https://txt.zhijianku.com', token: '' }), book = reactive({ scope:'completed', description:'', auto:false })
const account = ref({ username:'', password:'', disabled:false })
const selectedBook = computed(() => status.value?.projects.find(p => p.id === selectedId.value))
let timer, polling = false
async function refreshStatus() { status.value = await appService.readerStatus() }
onMounted(async () => { try { await refreshStatus(); connection.origin = status.value.origin } catch (error) { message.value = error.message }; timer = setInterval(async () => { if (polling) return; polling = true; try { await refreshStatus() } catch { /* explicit actions report errors */ } finally { polling = false } }, 1500) })
onUnmounted(() => clearInterval(timer))
function selectBook() { const selected = selectedBook.value; Object.assign(book, { scope:selected?.scope || 'completed', description:selected?.description || '', auto:selected?.auto || false }) }
async function act(fn) { if (busy.value) return; busy.value = true; message.value = ''; try { await fn() } catch (error) { message.value = error.message } finally { busy.value = false; await refreshStatus().catch(() => {}) } }
async function saveConnection() { const result = await appService.readerSave(connection); status.value = result; connection.token = ''; remote.value = null; selectedId.value = ''; message.value = '连接已保存；检查阅读站后设置访问模式。' }
async function refreshRemote() { remote.value = await appService.readerRemote(); requireLogin.value = remote.value.requireLogin; message.value = '阅读站连接正常。' }
async function saveAccess() { const result = await appService.readerAccess(requireLogin.value); if (result.cancelled) { requireLogin.value = remote.value.requireLogin; return }; remote.value = { ...remote.value, ...result }; message.value = requireLogin.value ? '已开启登录保护。' : '已开启免登录阅读。' }
async function saveAccount() { try { const result = await appService.readerAccount(account.value); remote.value = { ...remote.value, ...result }; message.value = '阅读账号已保存，原登录会话已撤销。' } finally { account.value.password = '' } }
async function removeAccount(username) { remote.value = { ...remote.value, ...await appService.readerAccount({ username,remove:true }) }; message.value = '阅读账号已删除。' }
async function saveBook() { status.value = await appService.readerBookSave({ projectId:selectedId.value,...book }); message.value = '此书发布设置已保存；其他书籍不受影响。' }
async function publish() { await saveBook(); const result = await appService.readerPublish(selectedId.value); message.value = result.cancelled ? '已取消，本次未上传。' : `已发布 ${result.chapterCount} 章。`; await refreshStatus() }
async function unpublish() { const result = await appService.readerUnpublish(selectedId.value); if (!result.cancelled) { status.value = result; book.auto = false; message.value = '书籍已下架，自动同步已关闭。本机稿件保持不变。' } }
async function copyLink() { try { await navigator.clipboard.writeText(status.value?.origin || connection.origin); message.value = '阅读链接已复制。' } catch { message.value = '请复制上方阅读站地址。' } }
</script>
<style scoped>
.reader-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}.reader-settings label{display:grid;gap:8px;font-size:13px}.reader-settings input:not([type=checkbox]),.reader-settings select,.reader-settings textarea{width:100%;padding:10px;border:1px solid #c5d8df;border-radius:8px;background:#fff;color:#314c55;font:inherit}.reader-settings .reader-check{display:flex;align-items:center;gap:10px;margin:12px 0}.reader-check input{accent-color:#416e67}.reader-setting-subsection{border-top:1px solid #d5e3e1;margin-top:22px;padding-top:14px}.reader-setting-subsection h4{font-size:16px}.reader-note{font-size:12px;line-height:1.8;color:#617982}.reader-accounts{list-style:none;padding:0}.reader-accounts li{display:flex;align-items:center;gap:12px;padding:8px 0}.reader-accounts li span{flex:1}.reader-accounts button{background:white;border:1px solid #c5d8df;border-radius:5px;padding:6px 10px;color:#416e67}.reader-settings a{color:#416e67;font-size:13px}@media(max-width:700px){.reader-settings-grid{grid-template-columns:1fr}}
</style>
