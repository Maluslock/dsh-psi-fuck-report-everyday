import { describe, expect, it } from 'vitest'
import type {
  SessionEventLike,
  SessionQueryLike,
  SessionWindow,
  WindowedSessionQuery,
} from '../src/host/sessions/collector'
import { SessionCollector } from '../src/host/sessions/collector'
import type { Exclusion } from '../src/host/types'
import {
  assistantEvent,
  fakeQuery,
  header,
  titleEvent,
  todoEvent,
  toolEvent,
  userEvent,
} from './helpers/session-factory'

const DATE = '2026-11-03'
const at = (hours: number, minutes = 0, day = 3): number =>
  new Date(2026, 10, day, hours, minutes, 0, 0).getTime()

const noExclusion = (): Exclusion => ({ projects: new Set(), sessions: new Set() })

function buildFixture() {
  return fakeQuery([
    {
      header: header({ id: 'a', cwd: '/repo/alpha', createdAt: at(8) }),
      events: [
        userEvent(at(9, 0, 2), '昨天的消息'),
        userEvent(at(9), '修复登录失败'),
        assistantEvent(at(9, 10), '已定位到会话过期逻辑'),
        toolEvent(at(9, 20), 'edit'),
        titleEvent(at(9, 30), '登录修复'),
        todoEvent(at(9, 40), [
          { content: '补回归用例', status: 'pending' },
          { content: '提交代码', status: 'completed' },
        ]),
      ],
    },
    {
      header: header({ id: 'b', cwd: '/repo/beta', createdAt: at(8) }),
      events: [userEvent(at(10), '整理周报模板'), assistantEvent(at(10, 5), '已整理')],
    },
    {
      header: header({
        id: 'sub',
        cwd: '/repo/alpha',
        createdAt: at(8),
        delegationDepth: 1,
        parentSession: 'a',
      }),
      events: [userEvent(at(9, 5), '子代理消息')],
    },
    {
      header: header({ id: 'excluded', cwd: '/repo/excluded', createdAt: at(8) }),
      events: [userEvent(at(9), '不该出现')],
    },
    {
      header: header({ id: 'empty', cwd: '/repo/alpha', createdAt: at(8, 0, 1) }),
      events: [userEvent(at(9, 0, 1), '前天消息')],
    },
  ])
}

describe('SessionCollector.collect', () => {
  it('collects in-window sessions and skips subagent, excluded and empty ones', async () => {
    const query = buildFixture()
    const sessions = await new SessionCollector(query).collect(DATE, {
      projects: new Set(['/repo/excluded']),
      sessions: new Set(),
    })

    expect(sessions.map((s) => s.sessionId)).toEqual(['a', 'b'])
    const a = sessions[0]!
    const b = sessions[1]!

    expect(a).toMatchObject({ cwd: '/repo/alpha', title: '登录修复', messages: 2 })
    expect(a.toolCounts).toEqual({ edit: 1 })
    expect(a.userTexts).toEqual(['修复登录失败'])
    expect(a.assistantTexts).toEqual(['已定位到会话过期逻辑'])
    expect(a.todos).toEqual([
      { content: '补回归用例', status: 'pending' },
      { content: '提交代码', status: 'completed' },
    ])
    expect(a.firstTime).toBe(at(9))
    expect(a.lastTime).toBe(at(9, 40))

    expect(b.cwd).toBe('/repo/beta')
    expect(b.messages).toBe(2)

    // a、b、empty 被读取；sub 与 excluded 在读取前就被过滤
    expect(query.readCount).toBe(3)
    expect(query.readIds).toEqual(['a', 'b', 'empty'])
    expect(query.listCount).toBe(1)
  })

  it('honors a sessionId exclusion', async () => {
    const query = buildFixture()
    const sessions = await new SessionCollector(query).collect(DATE, {
      projects: new Set(['/repo/excluded']),
      sessions: new Set(['a']),
    })

    expect(sessions.map((s) => s.sessionId)).toEqual(['b'])
    expect(query.readCount).toBe(2)
  })

  it('returns an empty list for a day without events', async () => {
    const query = buildFixture()
    const sessions = await new SessionCollector(query).collect('2026-10-01', noExclusion())

    expect(sessions).toEqual([])
    expect(query.readCount).toBe(0)
  })

  it('keeps long-running sessions created weeks before the target day', async () => {
    const query = fakeQuery([
      {
        header: header({
          id: 'old',
          cwd: '/repo/legacy',
          createdAt: Date.parse('2026-09-01T00:00:00+08:00'),
        }),
        events: [userEvent(at(9), '长会话今天仍在活动')],
      },
    ])
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())

    expect(sessions.map((s) => s.sessionId)).toEqual(['old'])
  })

  it('skips sessions created after the target day', async () => {
    const query = fakeQuery([
      {
        header: header({ id: 'future', createdAt: new Date(2026, 10, 10, 8, 0).getTime() }),
        events: [userEvent(at(9), '未来会话')],
      },
    ])
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())

    expect(sessions).toEqual([])
    expect(query.readCount).toBe(0)
  })

  it('includes events exactly on the day boundaries of a past date', async () => {
    const dayStart = new Date(2026, 9, 1, 0, 0, 0, 0).getTime()
    const dayEnd = new Date(2026, 9, 1, 23, 59, 59, 999).getTime()
    const query = fakeQuery([
      {
        header: header({ id: 'edges', cwd: '/repo/edges', createdAt: dayStart }),
        events: [
          userEvent(dayStart - 1, '前一天最后时刻'),
          userEvent(dayStart, '当天第一刻'),
          assistantEvent(dayEnd, '当天最后一刻'),
          toolEvent(dayEnd + 1, '次日第一刻'),
        ],
      },
    ])
    const sessions = await new SessionCollector(query).collect('2026-10-01', noExclusion())
    const edge = sessions[0]!

    expect(edge.messages).toBe(2)
    expect(edge.firstTime).toBe(dayStart)
    expect(edge.lastTime).toBe(dayEnd)
    expect(edge.userTexts).toEqual(['当天第一刻'])
    expect(edge.title).toBe('当天第一刻')
    expect(edge.toolCounts).toEqual({})
  })

  it('truncates user and assistant texts by code point', async () => {
    const query = fakeQuery([
      {
        header: header({ id: 'long', cwd: '/repo/long' }),
        events: [userEvent(at(9), '一'.repeat(250)), assistantEvent(at(9, 1), '二'.repeat(350))],
      },
    ])
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())
    const long = sessions[0]!

    expect(long.userTexts[0]).toBe('一'.repeat(200))
    expect(long.assistantTexts[0]).toBe('二'.repeat(300))
  })

  it('keeps at most ten texts per side while counting every message', async () => {
    const events: SessionEventLike[] = []
    for (let i = 0; i < 12; i += 1) events.push(userEvent(at(9, i), `问题${i + 1}`))
    events.push(assistantEvent(at(10), '汇总'))
    const query = fakeQuery([{ header: header({ id: 'many', cwd: '/repo/many' }), events }])
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())
    const many = sessions[0]!

    expect(many.messages).toBe(13)
    expect(many.userTexts).toHaveLength(10)
    expect(many.userTexts[9]).toBe('问题10')
  })

  it('aggregates tool counts and uses the last todos write', async () => {
    const query = fakeQuery([
      {
        header: header({ id: 'tools', cwd: '/repo/tools' }),
        events: [
          userEvent(at(9), '跑工具'),
          toolEvent(at(9, 1), 'bash'),
          toolEvent(at(9, 2), 'bash'),
          toolEvent(at(9, 3), 'edit'),
          todoEvent(at(9, 4), [{ content: '旧任务', status: 'completed' }]),
          todoEvent(at(9, 5), [{ content: '新任务', status: 'pending' }]),
        ],
      },
    ])
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())
    const tools = sessions[0]!

    expect(tools.toolCounts).toEqual({ bash: 2, edit: 1 })
    expect(tools.todos).toEqual([{ content: '新任务', status: 'pending' }])
  })

  it('tolerates malformed event payloads', async () => {
    const query = fakeQuery([
      {
        header: header({ id: 'malformed', cwd: '/repo/malformed' }),
        events: [
          { type: 'user/message', seq: 0, time: at(9), data: null },
          { type: 'assistant/message', seq: 1, time: at(9, 1), data: {} },
          { type: 'tool/call', seq: 2, time: at(9, 2), data: { name: 123 } },
          userEvent(at(9, 3), '正常消息'),
        ],
      },
    ])
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())
    const malformed = sessions[0]!

    expect(malformed.messages).toBe(3)
    expect(malformed.userTexts).toEqual(['正常消息'])
    expect(malformed.toolCounts).toEqual({})
    expect(malformed.title).toBe('正常消息')
  })

  it('falls back to 未命名会话 when there is no title and no user text', async () => {
    const query = fakeQuery([
      {
        header: header({ id: 'assistant-only', cwd: '/repo/assistant-only' }),
        events: [assistantEvent(at(9), '只有助手消息')],
      },
    ])
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())

    expect(sessions[0]!.title).toBe('未命名会话')
  })

  it('skips a session whose readSession throws', async () => {
    const query = fakeQuery(
      [
        { header: header({ id: 'ok', cwd: '/repo/ok' }), events: [userEvent(at(9), '正常')] },
        { header: header({ id: 'broken', cwd: '/repo/broken' }), events: [userEvent(at(9), '坏掉')] },
      ],
      { failing: ['broken'] },
    )
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())

    expect(sessions.map((s) => s.sessionId)).toEqual(['ok'])
    expect(query.readCount).toBe(2)
  })

  it('forwards the abort signal to listSessions and readSession', async () => {
    const seen: Array<AbortSignal | undefined> = []
    const query: SessionQueryLike = {
      async listSessions(signal) {
        seen.push(signal)
        return [{ header: header({ id: 'sig', cwd: '/repo/sig' }) }]
      },
      async readSession(id, signal) {
        seen.push(signal)
        return { session: header({ id }), events: [userEvent(at(9), '信号透传')] }
      },
    }
    const controller = new AbortController()
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion(), controller.signal)

    expect(sessions).toHaveLength(1)
    expect(seen).toEqual([controller.signal, controller.signal])
  })

  it('prefers the windowed query hooks when the query exposes them', async () => {
    const dayStart = new Date(2026, 9, 1, 0, 0, 0, 0).getTime()
    const dayEnd = new Date(2026, 9, 1, 23, 59, 59, 999).getTime()
    const seen: SessionWindow[] = []
    const query: SessionQueryLike & WindowedSessionQuery = {
      async listSessions() {
        throw new Error('listSessions should not be called')
      },
      async readSession() {
        throw new Error('readSession should not be called')
      },
      async listSessionsInWindow(window) {
        seen.push(window)
        return [{ header: header({ id: 'windowed', cwd: '/repo/windowed', createdAt: dayStart - 86_400_000 }) }]
      },
      async readSessionInWindow(id, window) {
        seen.push(window)
        return { session: header({ id }), events: [userEvent(dayStart + 3_600_000, '窗口读取')] }
      },
    }

    const sessions = await new SessionCollector(query).collect('2026-10-01', noExclusion())

    expect(sessions.map((session) => session.sessionId)).toEqual(['windowed'])
    expect(seen).toEqual([
      { start: dayStart, end: dayEnd },
      { start: dayStart, end: dayEnd },
    ])
  })

  it('sorts collected sessions by first event time', async () => {
    const query = fakeQuery([
      { header: header({ id: 'late', cwd: '/repo/late' }), events: [userEvent(at(15), '晚')] },
      { header: header({ id: 'early', cwd: '/repo/early' }), events: [userEvent(at(8), '早')] },
    ])
    const sessions = await new SessionCollector(query).collect(DATE, noExclusion())

    expect(sessions.map((s) => s.sessionId)).toEqual(['early', 'late'])
    expect(sessions.map((s) => s.firstTime)).toEqual([at(8), at(15)])
  })
})

describe('listWorkspaces', () => {
  it('lists unique cwds from recent and live sessions without reading logs', async () => {
    const now = Date.now()
    let reads = 0
    const query: SessionQueryLike = {
      async listSessions() {
        return [
          { header: header({ id: 'recent', cwd: '/repo/recent', createdAt: now - 86_400_000 }) },
          {
            header: header({ id: 'live-old', cwd: '/repo/live', createdAt: now - 30 * 86_400_000 }),
            live: true,
          },
          { header: header({ id: 'old', cwd: '/repo/old', createdAt: now - 10 * 86_400_000 }) },
          {
            header: header({ id: 'sub', cwd: '/repo/sub', createdAt: now, delegationDepth: 1 }),
          },
          { header: header({ id: 'dup', cwd: '/repo/recent', createdAt: now }) },
        ]
      },
      async readSession() {
        reads += 1
        throw new Error('must not read session logs')
      },
    }

    const cwds = await new SessionCollector(query).listWorkspaces(7)

    expect(cwds).toEqual(['/repo/live', '/repo/recent'])
    expect(reads).toBe(0)
  })
})
