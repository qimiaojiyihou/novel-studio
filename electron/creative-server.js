import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { CreativeInterfaceError } from './creative-interface.js'

function privateJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode:0o600, flag:'wx' })
  fs.renameSync(temporary, file)
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const equal = (a,b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b))

export async function startCreativeServer({ api, directory, databasePath, buildId }) {
  fs.mkdirSync(directory, { recursive:true, mode:0o700 })
  fs.chmodSync(directory, 0o700)
  const clientsDirectory = path.join(directory, 'clients')
  fs.mkdirSync(clientsDirectory, { recursive:true, mode:0o700 })
  const serverFile = path.join(directory, 'server.json'), adminFile = path.join(directory, 'admin.json')
  const adminToken = randomBytes(32).toString('hex'), instanceId = randomUUID()
  const server = createServer(async (request,response) => {
    response.setHeader('content-type','application/json; charset=utf-8')
    response.setHeader('cache-control','no-store')
    try {
      // No CORS/browser entry point: clients are local CLI processes with capabilities.
      if (request.method !== 'POST' || request.headers.origin || !/^127\.0\.0\.1:\d+$/.test(request.headers.host || '')) throw new CreativeInterfaceError('INVALID_TRANSPORT','仅接受本机创作客户端请求')
      const chunks = []; let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 2 * 1024 * 1024) throw new CreativeInterfaceError('BODY_TOO_LARGE','单次请求超过 2 MiB')
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), token = String(request.headers.authorization || '').replace(/^Bearer /, '')
      let result
      if (request.url === '/v1/bind') {
        if (!equal(token, adminToken)) throw new CreativeInterfaceError('UNAUTHENTICATED','绑定管理凭据无效')
        if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(input.clientId || '')) throw new CreativeInterfaceError('INVALID_BINDING','客户端标识无效')
        const clientFile = path.join(clientsDirectory, `${input.clientId}.json`)
        const existing = fs.existsSync(clientFile) ? readJson(clientFile) : null
        const clientToken = existing?.token || randomBytes(32).toString('hex')
        const binding = api.bind({ ...input, token:clientToken })
        privateJson(clientFile, { ...binding, token:clientToken, serverFile })
        result = { ...binding, clientFile }
      } else if (request.url === '/v1/call') result = await api.call(token,input)
      else throw new CreativeInterfaceError('NOT_FOUND','创作接口不存在')
      response.end(JSON.stringify({ ok:true, result }))
    } catch(error) {
      response.statusCode = error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'PROJECT_MISMATCH' ? 403 : 400
      response.end(JSON.stringify({ ok:false, error:{ code:error.code || 'INVALID_REQUEST',message:error.message,details:error.details || null } }))
    }
  })
  server.requestTimeout = 30000
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve) })
  const info = { protocolVersion:1, instanceId, url:`http://127.0.0.1:${server.address().port}`, buildId, databasePath, serverFile }
  privateJson(serverFile,info)
  privateJson(adminFile,{ token:adminToken, serverFile })
  return { ...info, close:() => {
    // Old instances never remove a newer server's descriptor.
    if (fs.existsSync(serverFile) && readJson(serverFile).instanceId === instanceId) fs.unlinkSync(serverFile)
    server.closeAllConnections()
    return new Promise(resolve => server.close(resolve))
  } }
}
