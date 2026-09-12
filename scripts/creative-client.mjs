import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))

export function defaultNovelStudioUserData({ platform = process.platform, environment = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return path.join(environment.APPDATA || path.join(home, 'AppData', 'Roaming'), 'novel-studio')
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'novel-studio')
  return path.join(environment.XDG_CONFIG_HOME || path.join(home, '.config'), 'novel-studio')
}

export function defaultCreativeInterfaceDirectory(options = {}) {
  return path.join(defaultNovelStudioUserData(options), 'creative-interface')
}

export async function callCreative(clientFile, operation, input = {}, requestId = '') {
  const client = read(clientFile), server = read(client.serverFile)
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(server.url)) throw new Error('创作接口地址应为本机回环地址')
  const response = await fetch(`${server.url}/v1/call`, { method:'POST',headers:{ authorization:`Bearer ${client.token}`,'content-type':'application/json' },body:JSON.stringify({ operation,input,requestId }) })
  const result = await response.json()
  if (!result.ok) throw Object.assign(new Error(result.error.message),result.error)
  return result.result
}

export async function bindCreative(directory, input) {
  const admin = read(path.join(directory,'admin.json')), server = read(admin.serverFile)
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(server.url)) throw new Error('创作接口地址应为本机回环地址')
  const response = await fetch(`${server.url}/v1/bind`,{ method:'POST',headers:{ authorization:`Bearer ${admin.token}`,'content-type':'application/json' },body:JSON.stringify(input) })
  const result = await response.json()
  if (!result.ok) throw Object.assign(new Error(result.error.message),result.error)
  return result.result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name)+1]
  try {
    let result
    if (args[0] === 'bind') {
      const directory = args.includes('--directory') ? option('--directory') : defaultCreativeInterfaceDirectory()
      result = await bindCreative(directory,{ clientId:option('--id'),projectId:option('--project'),expectedTitle:option('--title') })
    } else {
      if (!args.includes('--client')) throw new Error('用法: node scripts/creative-client.mjs OPERATION --client /绝对路径/client.json [--input request.json] [--request-id 稳定请求ID]')
      const input = args.includes('--input') ? read(option('--input')) : {}
      result = await callCreative(option('--client'),args[0],input,args.includes('--request-id') ? option('--request-id') : '')
    }
    process.stdout.write(JSON.stringify(result,null,2)+'\n')
  } catch(error) {
    process.stderr.write(JSON.stringify({ code:error.code || 'CLIENT_ERROR',message:error.message,details:error.details || null })+'\n')
    process.exitCode = 1
  }
}
