export function countChinese(text = '') {
  return [...text].filter((char) => /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(char)).length
}

export function countCharacters(text = '') {
  return [...text].length
}

export function formatRelativeTime(value) {
  if (!value) return '尚未保存'
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 10) return '刚刚保存'
  if (seconds < 60) return `${seconds} 秒前保存`
  return `${Math.floor(seconds / 60)} 分钟前保存`
}
