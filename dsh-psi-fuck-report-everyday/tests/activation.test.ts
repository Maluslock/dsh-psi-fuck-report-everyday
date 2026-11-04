import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.js'
import type { SessionQueryLike } from '../src/host/sessions/collector.js'

/**
 * 回归：sessionQuery 是可选服务，插件不能用 ctx.sessionQuery 直接读。
 * 干净 profile 里的 cordis 会在未声明 inject 时对属性访问抛
 * `cannot get property "sessionQuery" without inject`，导致整个插件不激活。
 */
describe('plugin activation', () => {
  const originalHome = process.env.DSH_HOME

  afterEach(() => {
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
  })

  it('keeps sessionQuery out of the required inject list', () => {
    expect(inject).toEqual(['webServer', 'llm'])
    expect(inject).not.toContain('sessionQuery')
  })

  it('reads optional sessionQuery through ctx.get instead of property access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-activation-'))
    process.env.DSH_HOME = root

    const getCalls: string[] = []
    const registered: unknown[] = []
    const query: SessionQueryLike = {
      listSessions: async () => [],
      readSession: async () => {
        throw new Error('unused')
      },
    }
    const ctx = new Proxy(
      {
        get: (key: string) => {
          getCalls.push(key)
          return key === 'sessionQuery' ? query : undefined
        },
        effect: (fn: () => unknown) => {
          fn()
          return async () => {}
        },
        webServer: {
          register: (route: unknown) => {
            registered.push(route)
            return async () => {}
          },
        },
        llm: {},
      },
      {
        get(target, prop, receiver) {
          // 模拟 cordis：未 inject 的服务直接属性访问会抛错。
          if (prop === 'sessionQuery') {
            throw new Error('cannot get property "sessionQuery" without inject')
          }
          return Reflect.get(target, prop, receiver)
        },
      },
    )

    expect(() => apply(ctx as unknown as Context)).not.toThrow()
    expect(getCalls).toContain('sessionQuery')
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      kind: 'prefix',
      path: '/api/dsh-psi-fuck-report-everyday',
    })

    await rm(root, { recursive: true, force: true })
  })
})
