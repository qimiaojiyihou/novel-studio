// Keep Electron's native roles (and their platform shortcuts); only localize labels.
export function applicationMenuTemplate(platform = process.platform) {
  const isMac = platform === 'darwin'
  const item = (role, label) => ({ role, label })
  const separator = () => ({ type: 'separator' })
  return [
    ...(isMac ? [{
      role: 'appMenu', label: 'Novel Studio', submenu: [
        item('about', '关于 Novel Studio'),
        separator(),
        item('services', '服务'),
        separator(),
        item('hide', '隐藏 Novel Studio'),
        item('hideOthers', '隐藏其他应用'),
        item('unhide', '显示全部'),
        separator(),
        item('quit', '退出 Novel Studio'),
      ],
    }] : []),
    {
      role: 'fileMenu', label: '文件', submenu: [
        isMac ? item('close', '关闭窗口') : item('quit', '退出 Novel Studio'),
      ],
    },
    {
      role: 'editMenu', label: '编辑', submenu: [
        item('undo', '撤销'),
        item('redo', '重做'),
        separator(),
        item('cut', '剪切'),
        item('copy', '复制'),
        item('paste', '粘贴'),
        ...(isMac ? [item('pasteAndMatchStyle', '粘贴并匹配样式')] : []),
        item('delete', '删除'),
        separator(),
        item('selectAll', '全选'),
        ...(isMac ? [separator(), {
          label: '语音', submenu: [
            item('startSpeaking', '开始朗读'),
            item('stopSpeaking', '停止朗读'),
          ],
        }] : []),
      ],
    },
    {
      role: 'viewMenu', label: '视图', submenu: [
        item('reload', '重新加载'),
        item('forceReload', '强制重新加载'),
        item('toggleDevTools', '切换开发者工具'),
        separator(),
        item('resetZoom', '实际大小'),
        item('zoomIn', '放大'),
        item('zoomOut', '缩小'),
        separator(),
        item('togglefullscreen', '切换全屏'),
      ],
    },
    {
      role: 'windowMenu', label: '窗口', submenu: [
        item('minimize', '最小化'),
        item('zoom', '缩放窗口'),
        ...(isMac ? [separator(), item('front', '全部置于前台')] : [item('close', '关闭窗口')]),
      ],
    },
  ]
}
