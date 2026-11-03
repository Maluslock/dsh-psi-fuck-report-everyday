import { pad2 } from './time.js'
import type { CollectedSession, SessionDigest } from './types.js'

/** 单条会话摘要的硬上限（按 code point 计） */
export const MAX_SESSION_DIGEST_CHARS = 800
/** 单次发送允许的摘要总长（按 code point 计） */
export const MAX_DIGEST_BUNDLE_CHARS = 16000
/** 超过该会话数就改走两阶段摘要 */
export const MAX_SINGLE_STAGE_SESSIONS = 32

const MAX_ASK_ITEMS = 10
const MAX_CONCLUSION_ITEMS = 10
const MAX_TOOL_NAMES = 8
const MAX_TODO_ITEMS = 8

/** 一次生成的摘要集合，needsTwoStage 为真时调用方应先做两阶段提炼。 */
export interface DigestBundle {
  digests: SessionDigest[]
  totalChars: number
  needsTwoStage: boolean
}

/** 按 code point 截断，避免把 emoji / 中文切坏。 */
export function truncate(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  return chars.slice(0, Math.max(0, Math.floor(max))).join('')
}

function clock(time: number): string {
  if (!Number.isFinite(time)) return '--:--'
  const d = new Date(time)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 本地时间跨度，形如 `09:00–10:30`。 */
export function formatSpan(firstTime: number, lastTime: number): string {
  return `${clock(firstTime)}–${clock(lastTime)}`
}

function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter((part) => part.length > 0)
  return parts.at(-1) ?? cwd
}

function formatTools(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TOOL_NAMES)
    .map(([name, count]) => `${name}×${count}`)
    .join(', ')
}

function cleanTexts(values: string[], limit: number): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, limit)
}

/**
 * 把一条采集到的会话压成不超过 800 字的摘要。
 * 只保留标题、项目、时间跨度、用户诉求、助手结论、工具计数与未完成事项，
 * 不保留完整对话与工具输出。
 */
export function buildSessionDigest(session: CollectedSession): SessionDigest {
  const project = projectName(session.cwd)
  const title = session.title.trim() || '未命名会话'
  const parts: string[] = [`[${project}] ${title}（${formatSpan(session.firstTime, session.lastTime)}）`]

  const asks = cleanTexts(session.userTexts, MAX_ASK_ITEMS)
  if (asks.length > 0) parts.push(`用户诉求：${asks.join('；')}`)

  const conclusions = cleanTexts(session.assistantTexts, MAX_CONCLUSION_ITEMS)
  if (conclusions.length > 0) parts.push(`助手结论：${conclusions.join('；')}`)

  const tools = formatTools(session.toolCounts)
  if (tools.length > 0) parts.push(`工具：${tools}`)

  const openTodos = session.todos
    .filter((todo) => todo.status === 'pending' || todo.status === 'in_progress')
    .map((todo) => todo.content.trim())
    .filter((content) => content.length > 0)
    .slice(0, MAX_TODO_ITEMS)
  if (openTodos.length > 0) parts.push(`未完成：${openTodos.join('；')}`)

  return {
    sessionId: session.sessionId,
    project,
    text: truncate(parts.join('\n'), MAX_SESSION_DIGEST_CHARS),
    messages: session.messages,
  }
}

/**
 * 生成一批摘要；会话数超过 32 或总长超过 maxTotal 时提示走两阶段提炼，
 * 避免一次性把超长内容塞进模型上下文。
 */
export function buildDigestBundle(
  sessions: CollectedSession[],
  maxTotal: number = MAX_DIGEST_BUNDLE_CHARS,
): DigestBundle {
  const digests = sessions.map(buildSessionDigest)
  const totalChars = digests.reduce((sum, digest) => sum + [...digest.text].length, 0)
  return {
    digests,
    totalChars,
    needsTwoStage: sessions.length > MAX_SINGLE_STAGE_SESSIONS || totalChars > maxTotal,
  }
}
