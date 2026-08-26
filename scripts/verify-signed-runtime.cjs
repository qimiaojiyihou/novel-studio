const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function verifySignedRuntime(context) {
  const platform = context.electronPlatformName
  if (!['darwin', 'win32'].includes(platform)) return
  const signingRequested = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK || process.env.CSC_NAME || context.packager.platformSpecificBuildOptions.identity)
  if (!signingRequested) return
  const productName = context.packager.appInfo.productFilename
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources', 'codex-runtime')
    : path.join(context.appOutDir, 'resources', 'codex-runtime')
  const binaries = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.name === (platform === 'win32' ? 'codex.exe' : 'codex')) binaries.push(target)
    }
  }
  visit(resources)
  if (!binaries.length) throw new Error('Signed package is missing the Codex CLI')
  for (const binary of binaries) {
    const verified = platform === 'darwin'
      ? spawnSync('codesign', ['--verify', '--strict', '--verbose=2', binary], { encoding: 'utf8' })
      : spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${binary.replace(/'/g, "''")}').Status`], { encoding: 'utf8' })
    if (platform === 'win32' && verified.status === 0 && !/^Valid\s*$/m.test(verified.stdout || '')) verified.status = 1
    if (verified.status !== 0) throw new Error(`Nested Codex signature verification failed: ${verified.stderr || verified.stdout}`)
  }
}
