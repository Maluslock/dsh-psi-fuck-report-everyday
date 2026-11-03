import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApi, type ApiDeps } from './api.js'

const PREFIX = '/api/dsh-psi-fuck-report-everyday'
/** 请求体上限：日报接口只会收到小型 JSON，1MB 足够且能挡住误传大文件。 */
const MAX_BODY = 1_000_000

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const

function errorBody(message: string): string {
  return JSON.stringify({ error: { code: 'E_BAD_REQUEST', message } })
}

/** 读完整个请求体并 JSON.parse；超限或非法 JSON 由调用方映射成 400。 */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * 在宿主 WebServer 上注册 prefix 路由，把真实的 node:http 请求交给
 * handleApi；GET 不读 body，其余方法先解析 JSON。
 */
export function registerHttpApi(ctx: Context, deps: ApiDeps): () => Promise<void> {
  return ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      let body: unknown
      try {
        if (req.method !== 'GET') body = await readBody(req)
      } catch (error) {
        res.writeHead(400, { ...JSON_HEADERS })
        res.end(errorBody(String(error)))
        return
      }
      const result = await handleApi(
        { method: req.method ?? 'GET', url: req.url ?? '/', body },
        deps,
      )
      res.writeHead(result.status, result.headers)
      res.end(result.body)
    },
  }))
}
