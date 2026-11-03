import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'dsh-psi-fuck-report-everyday'
export const inject = ['webServer']

export const API_PREFIX = '/api/dsh-psi-fuck-report-everyday'

export function healthPayload() {
  return { ok: true, plugin: name } as const
}

export function apply(ctx: Context): void {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (req.method === 'GET' && url.pathname === `${API_PREFIX}/health`) {
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify(healthPayload()))
          return
        }
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { code: 'E_BAD_REQUEST', message: 'not found' } }))
      },
    }),
  )
}
