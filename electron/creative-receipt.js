import { gzip as gzipCallback, gzipSync, gunzipSync } from 'node:zlib'
import { promisify } from 'node:util'

const gzip = promisify(gzipCallback)
export const RECEIPT_PREFIX = 'gzip-v1:'
const MIN_COMPRESS_BYTES = 4096

function packedReceipt(json, compressed) {
  const packed = RECEIPT_PREFIX + compressed.toString('base64')
  return Buffer.byteLength(packed) < Buffer.byteLength(json) ? packed : json
}

export async function encodeCreativeReceipt(value) {
  const json = JSON.stringify(value ?? null)
  if (Buffer.byteLength(json) < MIN_COMPRESS_BYTES) return json
  return packedReceipt(json, await gzip(json))
}

export function compressStoredReceipt(json) {
  if (!json || json.startsWith(RECEIPT_PREFIX) || Buffer.byteLength(json) < MIN_COMPRESS_BYTES) return json
  return RECEIPT_PREFIX + gzipSync(json).toString('base64')
}

export function decodeCreativeReceipt(stored) {
  const text = String(stored || 'null')
  if (!text.startsWith(RECEIPT_PREFIX)) return JSON.parse(text)
  return JSON.parse(gunzipSync(Buffer.from(text.slice(RECEIPT_PREFIX.length), 'base64')).toString('utf8'))
}
