// Shared by saved catalog statistics and the live manuscript editor.
export function countChinese(text = '') {
  return (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/gu) || []).length
}
