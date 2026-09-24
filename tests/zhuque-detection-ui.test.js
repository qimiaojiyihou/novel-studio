import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const component = readFileSync(fileURLToPath(new URL('../src/components/ZhuqueDetection.vue', import.meta.url)), 'utf8')

test('Zhuque repair exposes Codex and app model as visible direct actions', () => {
  assert.match(component, /<button[^>]+@click="\$emit\('repair', \{ mode: 'codex', digest: result\.manuscriptDigest \}\)"[^>]*>使用 Codex 生成候选/)
  assert.match(component, /<button[^>]+@click="\$emit\('repair', \{ mode: 'app_model', digest: result\.manuscriptDigest \}\)"[^>]*>使用 \{\{ appModelLabel \}\} 生成候选/)
  assert.doesNotMatch(component, /<CreativeExecutionControl\b/)
})
