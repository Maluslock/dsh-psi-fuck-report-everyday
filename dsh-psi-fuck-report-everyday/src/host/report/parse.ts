import type { Sections } from '../types.js'

export interface ParseLimits {
  /** 每节最多保留几条 */
  perSection: number
  /** 每条最多保留多少码点 */
  itemChars: number
}

export const DAILY_LIMITS: ParseLimits = { perSection: 3, itemChars: 40 }
export const WEEKLY_LIMITS: ParseLimits = { perSection: 4, itemChars: 50 }
export const GROUP_LIMITS: ParseLimits = { perSection: 5, itemChars: 40 }

/** 路径、文件名、命令片段：模型输出里出现就整条丢弃。 */
const PATH_LIKE = /(^|[\s（(])(\/[\w@./-]+|[A-Za-z]:\\[^\s]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|md|py|go|java|sh|yml|yaml|toml|lock))(\s|$|[，。；、])/

/** 去掉可能存在的 Markdown 代码围栏，返回 JSON 正文。 */
export function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```[A-Za-z]*\s*\n?([\s\S]*?)\n?```$/.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

function cleanSection(raw: unknown, limits: ParseLimits): string[] {
  if (!Array.isArray(raw)) throw new Error('section must be an array')
  const items: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const text = value.replace(/\s+/g, ' ').trim()
    if (!text || PATH_LIKE.test(text)) continue
    const chars = [...text]
    items.push(chars.length > limits.itemChars ? chars.slice(0, limits.itemChars).join('') : text)
    if (items.length >= limits.perSection) break
  }
  return items
}

/**
 * 解析模型返回的 JSON 为三节。daily 用 done/risks/tomorrow，weekly 用 done/risks/next。
 * 非数组节、非法 JSON 都会抛错，由调用方决定是否重试。
 */
export function parseSections(raw: string, kind: 'daily' | 'weekly', limits: ParseLimits): Sections {
  const parsed = JSON.parse(stripFence(raw)) as Record<string, unknown>
  if (!parsed || typeof parsed !== 'object') throw new Error('response must be an object')
  const done = cleanSection(parsed.done, limits)
  const risks = cleanSection(parsed.risks, limits)
  if (kind === 'daily') {
    return { done, risks, tomorrow: cleanSection(parsed.tomorrow ?? [], limits) }
  }
  return { done, risks, next: cleanSection(parsed.next ?? [], limits) }
}

/** 解析分组摘要 {"points":[...]}。 */
export function parsePoints(raw: string, limits: ParseLimits = GROUP_LIMITS): string[] {
  const parsed = JSON.parse(stripFence(raw)) as Record<string, unknown>
  if (!parsed || typeof parsed !== 'object') throw new Error('response must be an object')
  return cleanSection(parsed.points, limits)
}
