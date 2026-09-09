import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createCodexProjectMirror } from '../electron/codex-project-mirror.js'

test('Creator Skill is shipped outside ASAR and copied into a real run mirror', () => {
  const projectRoot = path.resolve(import.meta.dirname, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const resource = pkg.build.extraResources.find(item => item.to === 'skills/novel-studio-creator')
  assert.ok(resource, 'Creator Skill must be an unpacked extraResource for fs.cpSync')
  assert.equal(pkg.dependencies['@openai/codex'], '0.153.4')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-packaged-skill-'))
  try {
    const skill = path.join(temp, 'Resources', resource.to)
    fs.cpSync(path.join(projectRoot, resource.from), skill, { recursive: true })
    const mirror = createCodexProjectMirror({
      baseDirectory: path.join(temp, 'data'),
      agentRun: { id: 'packaged-run', projectId: 'fixture-project', creativePack: {} },
      workspace: { project: { id: 'fixture-project', title: 'Packaging fixture' }, chapters: [] },
      skillSourceDirectory: skill,
    })
    for (const name of ['SKILL.md', 'references/creative-method.md', 'references/workflow-contracts.json']) {
      assert.equal(fs.readFileSync(path.join(mirror.root, '.codex/skills/novel-studio-creator', name), 'utf8'),
        fs.readFileSync(path.join(skill, name), 'utf8'))
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
