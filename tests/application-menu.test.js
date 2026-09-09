import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applicationMenuTemplate } from '../electron/application-menu.js'

function flatten(items) {
  return items.flatMap(item => [item, ...flatten(item.submenu || [])])
}

test('macOS application menu has Chinese titles and native roles throughout', () => {
  const menu = applicationMenuTemplate('darwin')
  assert.deepEqual(menu.map(item => item.label), ['Novel Studio', '文件', '编辑', '视图', '窗口'])
  const items = flatten(menu), roles = new Map(items.filter(item => item.role).map(item => [item.role, item]))
  for (const [role, label] of Object.entries({
    about: '关于 Novel Studio', services: '服务', hide: '隐藏 Novel Studio',
    hideOthers: '隐藏其他应用', unhide: '显示全部', quit: '退出 Novel Studio',
    undo: '撤销', redo: '重做', copy: '复制', paste: '粘贴', close: '关闭窗口',
    startSpeaking: '开始朗读', stopSpeaking: '停止朗读', togglefullscreen: '切换全屏',
  })) assert.equal(roles.get(role)?.label, label)
  for (const item of items) {
    if (item.type === 'separator') continue
    if (item.role !== 'appMenu') assert.match(item.label, /[\u3400-\u9fff]/)
    assert.equal(item.click, undefined, 'native behavior is not replaced by custom callbacks')
    assert.equal(item.accelerator, undefined, 'platform role shortcuts remain in effect')
  }
})

test('Windows and Linux menus retain native edit, window and quit commands', () => {
  for (const platform of ['win32', 'linux']) {
    const menu = applicationMenuTemplate(platform), items = flatten(menu)
    assert.deepEqual(menu.map(item => item.label), ['文件', '编辑', '视图', '窗口'])
    assert.equal(items.filter(item => item.role === 'quit').length, 1)
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'minimize', 'close', 'togglefullscreen']) {
      assert.ok(items.some(item => item.role === role), role)
    }
    assert.ok(!items.some(item => ['appMenu', 'services', 'hide', 'front', 'startSpeaking'].includes(item.role)))
  }
})
