import type {
  SessionEventLike,
  SessionHeaderLike,
  SessionQueryLike,
  SessionRecordLike,
  SessionSnapshotLike,
} from '../../src/host/sessions/collector'

export interface SessionFixture {
  header: SessionHeaderLike
  events: SessionEventLike[]
}

export interface FakeQueryOptions {
  /** 这些 sessionId 的 readSession 直接抛错，用于验证单会话失败被跳过 */
  failing?: readonly string[]
}

export interface FakeQuery extends SessionQueryLike {
  readonly readCount: number
  readonly listCount: number
  readonly readIds: string[]
}

export function header(overrides: Partial<SessionHeaderLike> = {}): SessionHeaderLike {
  return {
    id: 's1',
    createdAt: Date.parse('2026-11-03T00:00:00+08:00'),
    ...overrides,
  }
}

export function userEvent(time: number, text: string): SessionEventLike {
  return {
    type: 'user/message',
    seq: 0,
    time,
    data: {
      id: `u-${time}-${text.length}`,
      role: 'user',
      source: 'user',
      content: [{ type: 'text', text }],
    },
  }
}

export function assistantEvent(time: number, text: string): SessionEventLike {
  return {
    type: 'assistant/message',
    seq: 0,
    time,
    data: {
      turn: 1,
      step: 1,
      stream: false,
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    },
  }
}

export function toolEvent(time: number, name: string): SessionEventLike {
  return {
    type: 'tool/call',
    seq: 0,
    time,
    data: { turn: 1, step: 1, callId: `call-${time}-${name}`, name, arguments: '{}' },
  }
}

export function titleEvent(time: number, title: string): SessionEventLike {
  return { type: 'session/title', seq: 0, time, data: { title } }
}

export function todoEvent(
  time: number,
  todos: Array<{ content: string; status: string }>,
): SessionEventLike {
  return { type: 'todo/write', seq: 0, time, data: { todos } }
}

export function fakeQuery(entries: readonly SessionFixture[], options: FakeQueryOptions = {}): FakeQuery {
  const byId = new Map(entries.map((entry) => [entry.header.id, entry]))
  const failing = new Set(options.failing ?? [])
  let readCount = 0
  let listCount = 0
  const readIds: string[] = []
  return {
    get readCount() {
      return readCount
    },
    get listCount() {
      return listCount
    },
    get readIds() {
      return readIds
    },
    async listSessions(_signal?: AbortSignal): Promise<readonly SessionRecordLike[]> {
      listCount += 1
      return entries.map((entry) => ({ header: entry.header }))
    },
    async readSession(id: string, _signal?: AbortSignal): Promise<SessionSnapshotLike> {
      readCount += 1
      readIds.push(id)
      if (failing.has(id)) throw new Error(`fake read failure: ${id}`)
      const entry = byId.get(id)
      if (!entry) throw new Error(`unknown session: ${id}`)
      return { session: entry.header, events: entry.events }
    },
  }
}
