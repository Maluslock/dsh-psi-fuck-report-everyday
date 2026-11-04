import { dayWindow, localDateKey } from '../time.js'
import type { CollectedSession, Exclusion } from '../types.js'

export interface SessionHeaderLike {
  id: string
  createdAt: number
  cwd?: string
  parentSession?: string
  delegationDepth?: number
}
export interface SessionRecordLike {
  header: SessionHeaderLike
  /** 宿主会话记录自带的 live 标记：仍在运行的长会话不受 createdAt 窗口限制。 */
  live?: boolean
}
export interface SessionEventLike {
  type: string
  seq: number
  time: number
  data: unknown
}
export interface SessionSnapshotLike {
  session: SessionHeaderLike
  events: SessionEventLike[]
}
export interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<readonly SessionRecordLike[]>
  readSession(id: string, signal?: AbortSignal): Promise<SessionSnapshotLike>
}

/** 会话事件的时间窗（含端点），Unix 毫秒。 */
export interface SessionWindow {
  start: number
  end: number
}

/**
 * 可选能力：按时间窗列会话、按时间窗读事件。
 *
 * 文件回退实现用它按 mtime 剪枝并只保留窗口内事件，避免为了生成一天日报
 * 把整个会话库（可能数百 MB）读进内存；宿主原生的 sessionQuery 不实现它，
 * collector 会自动退回普通接口。
 */
export interface WindowedSessionQuery extends SessionQueryLike {
  listSessionsInWindow?(
    window: SessionWindow,
    signal?: AbortSignal,
  ): Promise<readonly SessionRecordLike[]>
  readSessionInWindow?(
    id: string,
    window: SessionWindow,
    signal?: AbortSignal,
  ): Promise<SessionSnapshotLike>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        isRecord(block) && block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('\n')
}

function truncate(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

function lastTitle(events: readonly SessionEventLike[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'session/title') continue
    if (typeof event.data === 'string') return event.data
    if (isRecord(event.data) && typeof event.data.title === 'string') return event.data.title
    if (isRecord(event.data) && typeof event.data.text === 'string') return event.data.text
  }
  return undefined
}

function lastTodos(events: readonly SessionEventLike[]): Array<{ content: string; status: string }> {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'todo/write' || !isRecord(event.data) || !Array.isArray(event.data.todos)) {
      continue
    }
    return event.data.todos
      .filter(
        (todo): todo is { content: string; status: string } =>
          isRecord(todo) && typeof todo.content === 'string' && typeof todo.status === 'string',
      )
      .map((todo) => ({ content: todo.content, status: todo.status }))
  }
  return []
}

/** 把一天时间窗内的原始事件压成日报可用的会话摘要。 */
export function normalizeSession(
  header: SessionHeaderLike,
  events: readonly SessionEventLike[],
): CollectedSession {
  const userTexts: string[] = []
  const assistantTexts: string[] = []
  const toolCounts: Record<string, number> = {}
  let messages = 0
  for (const event of events) {
    if (event.type === 'user/message') {
      messages += 1
      if (userTexts.length < 10 && isRecord(event.data)) {
        const text = truncate(textBlocks(event.data.content), 200).trim()
        if (text) userTexts.push(text)
      }
    } else if (event.type === 'assistant/message') {
      messages += 1
      if (assistantTexts.length < 10 && isRecord(event.data) && isRecord(event.data.message)) {
        const text = truncate(textBlocks(event.data.message.content), 300).trim()
        if (text) assistantTexts.push(text)
      }
    } else if (event.type === 'tool/call' && isRecord(event.data) && typeof event.data.name === 'string') {
      toolCounts[event.data.name] = (toolCounts[event.data.name] ?? 0) + 1
    }
  }
  const title = lastTitle(events)?.trim() || truncate(userTexts[0] ?? '未命名会话', 40)
  return {
    sessionId: header.id,
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    title,
    firstTime: events[0]?.time ?? header.createdAt,
    lastTime: events[events.length - 1]?.time ?? header.createdAt,
    userTexts,
    assistantTexts,
    toolCounts,
    todos: lastTodos(events),
    messages,
  }
}

export class SessionCollector {
  constructor(private readonly query: SessionQueryLike) {}

  /**
   * 排除工作区选择器用的轻量扫描：只列一次会话元数据，不读会话正文。
   *
   * 设置页的「扫描最近 7 天」只需要 cwd，若逐天走 collect() 会把全部历史
   * 会话读 7 遍；这里按 createdAt 窗口 + live 过滤，一次 listSessions 完成。
   */
  async listWorkspaces(days: number, signal?: AbortSignal): Promise<string[]> {
    const span = Math.max(1, Math.min(30, Math.trunc(days)))
    const start = dayWindow(localDateKey(new Date(Date.now() - (span - 1) * 86_400_000))).start
    const records = await this.query.listSessions(signal)
    const found = new Set<string>()
    for (const record of records) {
      const header = record.header
      if ((header.delegationDepth ?? 0) > 0 || header.parentSession) continue
      if (header.createdAt < start && record.live !== true) continue
      if (typeof header.cwd === 'string' && header.cwd) found.add(header.cwd)
    }
    return [...found].sort()
  }

  async collect(date: string, exclusion: Exclusion, signal?: AbortSignal): Promise<CollectedSession[]> {
    const { start, end } = dayWindow(date)
    const window: SessionWindow = { start, end }
    // 可选的时间窗接口：文件回退实现借此按 mtime 剪枝，避免全库扫描。
    const windowed = this.query as WindowedSessionQuery
    const listInWindow = windowed.listSessionsInWindow
    const readInWindow = windowed.readSessionInWindow
    // 不按 createdAt 设下限：长会话可能创建于数周前、今天仍在活动；
    // 是否属于当天只由事件时间决定。
    const records = listInWindow
      ? await listInWindow.call(this.query, window, signal)
      : await this.query.listSessions(signal)
    const candidates = records
      .map((record) => record.header)
      .filter((header) => {
        if (header.createdAt > end) return false
        if ((header.delegationDepth ?? 0) > 0 || header.parentSession) return false
        if (exclusion.sessions.has(header.id)) return false
        if (header.cwd && exclusion.projects.has(header.cwd)) return false
        return true
      })

    const collected: CollectedSession[] = []
    for (const header of candidates) {
      let snapshot: SessionSnapshotLike
      try {
        snapshot = readInWindow
          ? await readInWindow.call(this.query, header.id, window, signal)
          : await this.query.readSession(header.id, signal)
      } catch {
        continue
      }
      const events = snapshot.events.filter((event) => event.time >= start && event.time <= end)
      if (events.length === 0) continue
      const session = normalizeSession(header, events)
      if (session.messages === 0) continue
      collected.push(session)
    }
    return collected.sort((a, b) => a.firstTime - b.firstTime)
  }
}
