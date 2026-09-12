import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  codexProjectDirectoryName,
  createCodexBookWorkspace,
  createCodexProjectMirror,
  findCodexBookWorkspace,
  loadCandidateBundle,
  readMirrorText,
  removeCodexBookWorkspace,
  resolveMirrorPath,
  stableDigest,
  stableSourceValue,
  writeMirrorText,
} from '../electron/codex-project-mirror.js'

test('Codex project directory names are valid on Windows', () => {
  assert.equal(codexProjectDirectoryName('在世证明'), '在世证明')
  assert.equal(codexProjectDirectoryName('悬疑:档案?  '), '悬疑 档案')
  assert.equal(codexProjectDirectoryName('CON'), '_CON')
  assert.equal(codexProjectDirectoryName('nul.txt'), '_nul.txt')
  assert.equal(codexProjectDirectoryName('...'), '未命名小说')
  assert.equal(codexProjectDirectoryName(`${'书'.repeat(71)}.`), '书'.repeat(71))
})

function fixture() {
  const baseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-codex-mirror-'))
  const workspace = {
    project: { id: 'project-1', title: '镜像故事', genre: '悬疑', idea: '病历被修改', style: '克制', apiKey: 'secret' },
    chapters: [{ id: 'chapter-1', title: '第一章', manuscript: '原始正文', card: { goal: '调查' }, scenePlan: { scenes: [] }, updated_at: 'v1' }],
  }
  const agentRun = { id: 'run-1', chapterId: 'chapter-1', creativePack: { id: 'pack', version: '1.0.0', digest: 'pack-digest' } }
  const mirror = createCodexProjectMirror({
    baseDirectory, agentRun, workspace,
    planningCenter: { characters: [{ title: '林砚', data: { secret: 'character-secret' } }], documents: {} },
    knowledgeCenter: { items: [], continuityChecks: [] },
    creativePack: { manifest: { id: 'pack', version: '1.0.0' } },
  })
  return { baseDirectory, mirror }
}

test('Codex project mirror contains only the controlled project projection', () => {
  const { baseDirectory, mirror } = fixture()
  try {
    const collaboration = JSON.parse(readMirrorText(mirror.root, '.nscollab.json'))
    assert.equal(collaboration.projectId, 'project-1')
    assert.equal(collaboration.sourceDigest, mirror.sourceDigest)
    assert.notEqual(mirror.workspaceRoot, mirror.root)
    assert.equal(path.dirname(mirror.root), path.join(baseDirectory, 'codex-workspaces'))
    assert.equal(path.dirname(mirror.workspaceRoot), path.join(baseDirectory, 'codex-projects'))
    const foundation = readMirrorText(mirror.root, 'project/foundation.md')
    assert.match(foundation, /镜像故事/)
    assert.doesNotMatch(foundation, /secret/)
    assert.equal(fs.existsSync(path.join(mirror.root, 'novel-studio.sqlite')), false)
  } finally {
    fs.rmSync(baseDirectory, { recursive: true, force: true })
  }
})

test('Codex book workspace is stable across title changes and contains no creative source data', () => {
  const baseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-codex-book-'))
  try {
    const first = createCodexBookWorkspace({
      baseDirectory,
      project: { id: 'project-stable', title: '明星 / 手艺人', genre: '文娱', idea: '不应写入目录', apiKey: 'secret' },
    })
    const second = createCodexBookWorkspace({
      baseDirectory,
      project: { id: 'project-stable', title: '明星手艺人 · 新书名', genre: '文娱' },
    })
    assert.equal(second.root, first.root)
    assert.match(path.basename(first.root), /明星 手艺人/)
    const descriptor = JSON.parse(fs.readFileSync(path.join(first.root, '.novel-studio-project.json'), 'utf8'))
    assert.equal(descriptor.title, '明星手艺人 · 新书名')
    const contents = [
      fs.readFileSync(path.join(first.root, '.novel-studio-project.json'), 'utf8'),
      fs.readFileSync(path.join(first.root, 'AGENTS.md'), 'utf8'),
      fs.readFileSync(path.join(first.root, 'README.md'), 'utf8'),
    ].join('\n')
    assert.doesNotMatch(contents, /不应写入目录|secret/)
    assert.equal(findCodexBookWorkspace({ baseDirectory, projectId: 'project-stable' }).root, first.root)
    assert.equal(removeCodexBookWorkspace({ baseDirectory, projectId: 'project-stable' }), true)
    assert.equal(fs.existsSync(first.root), false)
  } finally {
    fs.rmSync(baseDirectory, { recursive: true, force: true })
  }
})

test('Codex mirror blocks traversal, SQLite, and symlink escape', () => {
  const { baseDirectory, mirror } = fixture()
  const outside = path.join(baseDirectory, 'outside.txt')
  fs.writeFileSync(outside, 'outside')
  try {
    assert.throws(() => resolveMirrorPath(mirror.root, '../../outside.txt'), /越出/)
    assert.throws(() => resolveMirrorPath(mirror.root, 'project/novel-studio.sqlite'), /数据库/)
    const link = path.join(mirror.root, 'project', 'outside-link')
    fs.symlinkSync(outside, link)
    assert.throws(() => readMirrorText(mirror.root, 'project/outside-link'), /符号链接越出/)
  } finally {
    fs.rmSync(baseDirectory, { recursive: true, force: true })
  }
})

test('Codex candidate import marks changed project sources as stale', () => {
  const { baseDirectory, mirror } = fixture()
  try {
    const bundle = {
      schemaVersion: 1,
      artifactType: 'chapter_card',
      sourceDigest: mirror.sourceDigest,
      payload: { goal: '进入医院' },
    }
    writeMirrorText(mirror.root, 'candidates/card.nscandidate.json', JSON.stringify(bundle))
    assert.equal(loadCandidateBundle(mirror.root, 'candidates/card.nscandidate.json', mirror.sourceDigest).stale, false)
    assert.equal(loadCandidateBundle(mirror.root, 'candidates/card.nscandidate.json', stableDigest('changed')).stale, true)
  } finally {
    fs.rmSync(baseDirectory, { recursive: true, force: true })
  }
})

test('source digest ignores repository timestamps but detects creative fact changes', () => {
  const original = {
    project: { id: 'project-1', title: '镜像故事', updated_at: 'v1' },
    chapter: { id: 'chapter-1', card: { goal: '调查病历' }, updatedAt: 'v1' },
    knowledge: { items: [{ id: 'fact-1', title: '钥匙规则', updated_at: 'v1' }] },
  }
  const metadataOnly = {
    project: { ...original.project, updated_at: 'v2' },
    chapter: { ...original.chapter, updatedAt: 'v2' },
    knowledge: { items: [{ ...original.knowledge.items[0], updated_at: 'v2' }] },
  }
  const changedFact = {
    ...metadataOnly,
    chapter: { ...metadataOnly.chapter, card: { goal: '销毁病历' } },
  }
  assert.equal(stableDigest(stableSourceValue(original)), stableDigest(stableSourceValue(metadataOnly)))
  assert.notEqual(stableDigest(stableSourceValue(original)), stableDigest(stableSourceValue(changedFact)))
})
