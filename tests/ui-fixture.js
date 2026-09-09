// Browser-only fixture, served by the development smoke test. No model calls.
import { createApp, h, ref } from 'vue'
import InlineCodexPanel from '../src/components/InlineCodexPanel.vue'
import { appService } from '../src/services/app-service.js'
import '../src/styles.css'
import '../src/design-system.css'

const prose = Array.from({ length: 90 }, (_, index) => `第${index + 1}段。摊前的灯亮起来，周砚把锅搁回灶上。她看着那张菜单，问他今天怎么收摊这么早。他往街口望了望，没有急着答话。`).join('\n\n') + '\n\n【正文末尾·滚动验收】'
const run = {
  id: 'ui-fixture', projectId: 'fixture-only', chapterId: 'fixture-chapter', workflowId: 'inline-action',
  status: 'waiting_confirmation', executionMode: 'codex', actualBackend: 'codex_acp',
  modelRoutes: { codexModel: 'fixture-no-model', codexReasoningEffort: 'high' },
  currentStepId: 'step-1', steps: [{ id: 'step-1', task: 'chapter', status: 'waiting_confirmation', input: { intent: 'rewrite', target: { kind: 'manuscript', fieldLabel: '正文修改' } } }],
  candidates: [{ id: 'candidate-1', stepId: 'step-1', status: 'pending', artifactType: 'manuscript', payload: { manuscript: prose } }],
  events: [], approvals: [], messages: Array.from({ length: 8 }, (_, index) => ({ id: `discussion-${index}`, role: index % 2 ? 'assistant' : 'user', mode: 'discuss', content: `讨论记录 ${index + 1}：保留人物的顾虑和对白目的。` })),
}
appService.getAgentRun = async () => structuredClone(run)
appService.getSessionModelApproval = async () => ({ enabled: true })
appService.onAgentEvent = appService.onCodexEvent = appService.onApprovalEvent = () => () => {}
appService.listProtections = async () => []
const visible = ref(true)
createApp({ render: () => h('div', { class: 'app-shell' }, [
  h('header', { style: 'padding:20px;color:#405b63' }, 'Novel Studio · UI 工程测试（无模型调用）'),
  h('button', { onClick: () => { visible.value = true }, style: 'align-self:start;margin:16px' }, '重新打开候选'),
  h(InlineCodexPanel, { visible: visible.value, runId: run.id, sourceManuscript: prose.replace('收摊这么早', '来得这么晚'), onClose: () => { visible.value = false } }),
]) }).mount('#app')
