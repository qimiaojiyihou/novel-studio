export const MANUSCRIPT_FORMAT_OPTIONS = [
  {
    id: 'remove-blank-lines',
    label: '去除段间空行',
    description: '段落保留换行，删除中间的空白行',
  },
  {
    id: 'single-blank-line',
    label: '段间留一空行',
    description: '统一为每段之间一行空白',
  },
  {
    id: 'indent-two',
    label: '段首缩进两格',
    description: '每个非空段落使用两个全角空格',
  },
  {
    id: 'remove-indent',
    label: '清除段首缩进',
    description: '删除段首的空格和制表符',
  },
  {
    id: 'trim-line-ends',
    label: '清除行尾空格',
    description: '清理复制粘贴留下的隐藏空格',
  },
]

function normalizeLineEndings(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n')
}

function countChangedLines(before, after) {
  const left = before.split('\n')
  const right = after.split('\n')
  const length = Math.max(left.length, right.length)
  let changed = 0
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) changed += 1
  }
  return changed
}

export function formatManuscript(value, action) {
  const source = normalizeLineEndings(value)
  let text = source

  if (action === 'remove-blank-lines') {
    text = source.split('\n').filter((line) => line.trim() !== '').join('\n')
  } else if (action === 'single-blank-line') {
    text = source.split('\n').filter((line) => line.trim() !== '').join('\n\n')
  } else if (action === 'indent-two') {
    text = source.split('\n').map((line) => line.trim() ? `　　${line.replace(/^[\s\u3000]+/, '')}` : line).join('\n')
  } else if (action === 'remove-indent') {
    text = source.split('\n').map((line) => line.replace(/^[\s\u3000]+/, '')).join('\n')
  } else if (action === 'trim-line-ends') {
    text = source.split('\n').map((line) => line.replace(/[\t \u3000]+$/g, '')).join('\n')
  } else {
    throw new Error('不支持的正文排版方式')
  }

  return {
    text,
    changed: text !== source,
    changedLines: countChangedLines(source, text),
  }
}
