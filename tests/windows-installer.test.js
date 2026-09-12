import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

test('Windows installer uses the self-safe process check', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(packageJson.build?.nsis?.include, 'build/installer.nsh')

  const installer = await readFile(new URL('build/installer.nsh', root), 'utf8')
  assert.match(installer, /!macro customCheckAppRunning/)
  assert.match(installer, /\$\$_\.ProcessId -ne \$pid/)
  assert.match(installer, /\$\$_\.Path\.StartsWith\('\$INSTDIR'/)
  assert.match(installer, /nsProcess::_FindProcess \/NOUNLOAD "\$\{APP_EXECUTABLE_FILENAME\}"/)
  assert.match(installer, /nsProcess::_CloseProcess \/NOUNLOAD "\$\{APP_EXECUTABLE_FILENAME\}"/)
  assert.match(installer, /nsProcess::_KillProcess \/NOUNLOAD "\$\{APP_EXECUTABLE_FILENAME\}"/)
  assert.match(installer, /!ifndef BUILD_UNINSTALLER[\s\S]*!macro novelStudioRepairLegacyUninstaller/)
  assert.match(installer, /File \/oname=\$PLUGINSDIR\\novel-studio-fixed-uninstaller\.exe "\$\{UNINSTALLER_OUT_FILE\}"/)
  assert.match(installer, /CopyFiles \/SILENT "\$PLUGINSDIR\\novel-studio-fixed-uninstaller\.exe" "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"/)
  assert.match(installer, /!insertmacro novelStudioRepairLegacyUninstaller/)
})
