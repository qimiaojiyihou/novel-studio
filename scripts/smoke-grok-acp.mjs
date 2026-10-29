// Diagnostic defaults to discovery only. --generate sends one synthetic prompt.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GrokAgentGateway } from '../electron/grok-agent-gateway.js'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-grok-smoke-'))
const mirrorRoot=path.join(root,'mirror'), workspaceRoot=path.join(root,'book')
fs.mkdirSync(mirrorRoot); fs.mkdirSync(workspaceRoot)
const gateway = new GrokAgentGateway({ settingsProvider: () => ({ grokCliPath: process.env.GROK_SMOKE_CLI || '' }), shouldAutoApprove: input => input.actionType === 'model_call' })
const model=process.env.GROK_SMOKE_MODEL || '', reasoningEffort=process.env.GROK_SMOKE_EFFORT || ''
const timeout=setTimeout(()=>{gateway.process?.kill();process.exitCode=1},60000)
try {
  const status=await gateway.testConnection({cwd:workspaceRoot,model,reasoningEffort})
  console.log(JSON.stringify({authenticated:status.runtime.authenticatedMethod,selected:status.selected,configOptions:status.configOptions}))
  if(process.argv.includes('--generate')){
    const result=await gateway.prompt({agentRunId:'synthetic-grok-test',agentStepId:'one-sentence',
      messages:[{role:'user',content:'写一句中文虚构故事开头，包含末班车和车票。只输出 JSON，结构为 {"text":"故事句子"}。无需读取文件或使用工具。'}],
      outputSchema:{type:'object',required:['text'],properties:{text:{type:'string'}}},settings:{mirrorRoot,workspaceRoot,model,reasoningEffort,agentProvider:'grok',authMethod:'cached_token'}})
    assert.equal(result.backend,'grok_acp');assert.ok(result.structuredOutput?.text)
    console.log(JSON.stringify({backend:result.backend,model:result.modelSnapshot,text:result.structuredOutput.text}))
  }
}finally{clearTimeout(timeout);await gateway.shutdown();fs.rmSync(root,{recursive:true,force:true})}
