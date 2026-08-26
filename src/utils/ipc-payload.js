export function toIpcPayload(value, label = 'IPC payload') {
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? null : JSON.parse(serialized)
  } catch (error) {
    throw new Error(`${label}包含不可传输的数据：${error.message}`)
  }
}
