import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sealCreativePack, validateCreativePack } from '../electron/creative-pack.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'creative-packs', 'general-longform')
const historical = path.join(root, 'creative-packs', 'historical')
if (process.argv.includes('--freeze-history')) {
  fs.mkdirSync(historical, { recursive: true })
  for (const version of ['1.0.0', '1.1.0', '1.2.0']) {
    const name = `general-longform-${version}.nspack.json`
    const target = path.join(historical, name)
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(root, 'creative-packs', 'dist', name), target)
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(source, relativePath), 'utf8'))
}

const manifest = readJson('manifest.json')
const pack = sealCreativePack({
  manifest,
  prompts: readJson('prompts/index.json'),
  schemas: {
    foundationBundle: readJson('schemas/foundation-bundle.json'),
    storyChange: readJson('schemas/story-change.json'),
    chapterCard: readJson('schemas/chapter-card.json'),
    scenePlan: readJson('schemas/scene-plan.json'),
    chapterState: readJson('schemas/chapter-state.json'),
    qualityReview: readJson('schemas/quality-review.json'),
  },
  workflows: [
    readJson('workflows/project-initialization.json'),
    readJson('workflows/chapter-creation.json'),
    readJson('workflows/chapter-compact.json'),
    readJson('workflows/story-change-propagation.json'),
  ],
  evaluations: [readJson('evaluations/urban-suspense-three-chapter.json')],
  references: {
    method: fs.readFileSync(path.join(source, 'references', 'method.md'), 'utf8'),
  },
})

validateCreativePack(pack, { appVersion: '0.1.0' })
const outputDirectory = path.join(root, 'creative-packs', 'dist')
fs.mkdirSync(outputDirectory, { recursive: true })
for (const name of fs.readdirSync(historical)) fs.copyFileSync(path.join(historical, name), path.join(outputDirectory, name))
const outputPath = path.join(outputDirectory, `general-longform-${manifest.version}.nspack.json`)
fs.writeFileSync(outputPath, JSON.stringify(pack, null, 2) + '\n')

// Publishable Skill references are generated from this same pack source.
const skillReferenceDirectory = path.join(root, 'skills', 'novel-studio-creator', 'references')
fs.mkdirSync(skillReferenceDirectory, { recursive: true })
fs.writeFileSync(path.join(skillReferenceDirectory, 'creative-method.md'), pack.references.method)
fs.writeFileSync(path.join(skillReferenceDirectory, 'workflow-contracts.json'), JSON.stringify({
  creativePack: {
    id: manifest.id,
    version: manifest.version,
    digest: pack.manifest.integrity.sha256,
  },
  schemas: pack.schemas,
  workflows: pack.workflows,
}, null, 2) + '\n')
console.log(`Built ${path.relative(root, outputPath)} (${pack.manifest.integrity.sha256})`)
