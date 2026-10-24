import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const serviceRoot = path.join(root, 'services', 'go')
const outputRoot = path.join(root, 'resources', 'novel-studio-service')

const targets = [
  { platform: 'darwin', arch: 'arm64', goos: 'darwin', goarch: 'arm64', extension: '' },
  { platform: 'darwin', arch: 'x64', goos: 'darwin', goarch: 'amd64', extension: '' },
  { platform: 'win32', arch: 'x64', goos: 'windows', goarch: 'amd64', extension: '.exe' },
  { platform: 'linux', arch: 'x64', goos: 'linux', goarch: 'amd64', extension: '' },
]

const selectedTargets = process.env.NOVEL_STUDIO_TARGET
  ? targets.filter(target => `${target.platform}-${target.arch}` === process.env.NOVEL_STUDIO_TARGET)
  : targets
if (!selectedTargets.length) throw new Error(`Unsupported Go service target: ${process.env.NOVEL_STUDIO_TARGET}`)

for (const target of selectedTargets) {
  const outputDirectory = path.join(outputRoot, `${target.platform}-${target.arch}`)
  fs.mkdirSync(outputDirectory, { recursive: true })
  const outputFile = path.join(outputDirectory, `novel-studio-service${target.extension}`)
  execFileSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', outputFile, '.'], {
    cwd: serviceRoot,
    env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0' },
    stdio: 'inherit',
  })
  console.log(`built ${path.relative(root, outputFile)}`)
}
