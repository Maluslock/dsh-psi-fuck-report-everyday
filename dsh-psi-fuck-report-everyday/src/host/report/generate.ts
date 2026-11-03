import { MAX_DIGEST_BUNDLE_CHARS, MAX_SINGLE_STAGE_SESSIONS, truncate } from '../digest.js'
import { PluginError } from '../errors.js'
import type { Coverage, DailyReport, ModelRef, Sections, SessionDigest, WeeklyReport } from '../types.js'
import { callModel, type LlmLike } from './llm.js'
import { DAILY_LIMITS, GROUP_LIMITS, WEEKLY_LIMITS, parsePoints, parseSections } from './parse.js'
import {
  DAILY_SYSTEM,
  GROUP_SYSTEM,
  RETRY_SUFFIX,
  WEEKLY_SYSTEM,
  buildDailyUserMessage,
  buildWeeklyUserMessage,
} from './prompts.js'

const GROUP_SIZE = 8
const MAX_GROUPS = 4
const GROUP_MAX_TOKENS = 600
const DAILY_MAX_TOKENS = 600
const WEEKLY_MAX_TOKENS = 800
const RAW_OUTPUT_KEEP = 500

export interface GenerateDailyInput {
  llm: LlmLike
  model: ModelRef
  date: string
  digests: SessionDigest[]
  coverage: Coverage
  signal?: AbortSignal
  timeoutMs?: number
}

export interface GenerateDailyResult {
  sections: Sections
  coverage: Coverage
}

export interface GenerateWeeklyInput {
  llm: LlmLike
  model: ModelRef
  week: string
  dailies: DailyReport[]
  missingDays: string[]
  signal?: AbortSignal
  timeoutMs?: number
}

interface DigestGroup {
  items: SessionDigest[]
  /** 因超出 4 组而被折叠进本组但未展开的会话数 */
  dropped: number
}

function charLength(text: string): number {
  return [...text].length
}

function splitGroups(digests: SessionDigest[]): DigestGroup[] {
  const groups: DigestGroup[] = []
  for (let index = 0; index < digests.length; index += GROUP_SIZE) {
    groups.push({ items: digests.slice(index, index + GROUP_SIZE), dropped: 0 })
  }
  if (groups.length <= MAX_GROUPS) return groups

  const kept = groups.slice(0, MAX_GROUPS - 1)
  const rest = digests.slice((MAX_GROUPS - 1) * GROUP_SIZE)
  const fourth = rest.slice(0, GROUP_SIZE)
  return [...kept, { items: fourth, dropped: rest.length - fourth.length }]
}

function buildGroupUserMessage(group: DigestGroup): string {
  const lines = group.items.map((digest, index) => `【${index + 1}】[${digest.project}] ${digest.text}`)
  const tail = group.dropped > 0 ? `\n\n另有 ${group.dropped} 个会话未展开。` : ''
  return `以下是 ${group.items.length} 个会话摘要，请压缩成最多 5 条要点。\n\n${lines.join('\n\n')}${tail}`
}

/** 组摘要兜底：按消息数降序保留，总长不超过单次发送上限。 */
function mechanicalLimit(digests: SessionDigest[]): SessionDigest[] {
  const sorted = [...digests].sort((a, b) => b.messages - a.messages)
  const kept: SessionDigest[] = []
  let used = 0
  for (const digest of sorted) {
    const size = charLength(digest.text)
    if (used + size > MAX_DIGEST_BUNDLE_CHARS && kept.length > 0) break
    kept.push(digest)
    used += size
  }
  return kept
}

async function parseWithRetry(
  input: GenerateDailyInput | GenerateWeeklyInput,
  system: string,
  user: string,
  kind: 'daily' | 'weekly',
  maxTokens: number,
): Promise<Sections> {
  const limits = kind === 'daily' ? DAILY_LIMITS : WEEKLY_LIMITS
  const first = await callModel(input.llm, {
    system,
    user,
    model: input.model,
    maxTokens,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  })
  try {
    return parseSections(first, kind, limits)
  } catch {
    // 第一次解析失败：追加约束再试一次。
  }

  const second = await callModel(input.llm, {
    system,
    user: `${user}${RETRY_SUFFIX}`,
    model: input.model,
    maxTokens,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  })
  try {
    return parseSections(second, kind, limits)
  } catch (error) {
    throw new PluginError(
      'E_LLM_BAD_OUTPUT',
      kind === 'daily' ? '模型输出不是合法的日报 JSON' : '模型输出不是合法的周报 JSON',
      {
        first: truncate(first, RAW_OUTPUT_KEEP),
        second: truncate(second, RAW_OUTPUT_KEEP),
        reason: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

async function summariseGroup(
  input: GenerateDailyInput,
  group: DigestGroup,
  index: number,
): Promise<SessionDigest> {
  const raw = await callModel(input.llm, {
    system: GROUP_SYSTEM,
    user: buildGroupUserMessage(group),
    model: input.model,
    maxTokens: GROUP_MAX_TOKENS,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  })
  const points = parsePoints(raw, GROUP_LIMITS)
  if (points.length === 0) throw new Error('empty group summary')
  return {
    sessionId: `group-${index + 1}`,
    project: group.items[0]?.project ?? '分组',
    text: points.map((point, order) => `${order + 1}. ${point}`).join('\n'),
    messages: group.items.reduce((sum, digest) => sum + digest.messages, 0),
  }
}

/**
 * 生成日报：摘要总量超限时先按每 8 个会话一组做两段式压缩（最多 4 组），
 * 组摘要失败则按消息数机械截断；最终解析失败只重试一次。
 */
export async function generateDaily(input: GenerateDailyInput): Promise<GenerateDailyResult> {
  if (input.digests.length === 0) {
    throw new PluginError('E_NO_SESSIONS', '当天没有可用的会话')
  }

  const totalChars = input.digests.reduce((sum, digest) => sum + charLength(digest.text), 0)
  const twoStage = input.digests.length > MAX_SINGLE_STAGE_SESSIONS || totalChars > MAX_DIGEST_BUNDLE_CHARS
  let coverage: Coverage = { ...input.coverage }
  let promptDigests: SessionDigest[] = input.digests
  let truncated = false

  if (twoStage) {
    const groups = splitGroups(input.digests)
    const summaries: SessionDigest[] = []
    let failed = false
    for (const [index, group] of groups.entries()) {
      try {
        summaries.push(await summariseGroup(input, group, index))
      } catch {
        failed = true
        break
      }
    }

    if (failed || summaries.length === 0) {
      promptDigests = mechanicalLimit(input.digests)
      coverage = { ...coverage, groups: 1 }
      truncated = true
    } else {
      promptDigests = summaries
      coverage = { ...coverage, groups: groups.length }
      truncated = groups.some((group) => group.dropped > 0)
    }
  } else {
    coverage = { ...coverage, groups: 1 }
  }

  coverage = { ...coverage, truncated: coverage.truncated || truncated }
  const user = buildDailyUserMessage({ date: input.date, coverage, digests: promptDigests })
  const sections = await parseWithRetry(input, DAILY_SYSTEM, user, 'daily', DAILY_MAX_TOKENS)
  return { sections, coverage }
}

/** 生成周报：只汇总已落盘的日报三节，不读原始会话。 */
export async function generateWeekly(input: GenerateWeeklyInput): Promise<WeeklyReport> {
  if (input.dailies.length === 0) {
    throw new PluginError('E_NO_WEEKLY_SOURCE', '本周还没有日报可以汇总')
  }

  const user = buildWeeklyUserMessage({ week: input.week, dailies: input.dailies })
  const sections = await parseWithRetry(input, WEEKLY_SYSTEM, user, 'weekly', WEEKLY_MAX_TOKENS)
  return {
    version: 1,
    week: input.week,
    generatedAt: new Date().toISOString(),
    model: input.model,
    days: input.dailies.map((daily) => daily.date).sort(),
    missingDays: [...input.missingDays].sort(),
    sections,
    editedAt: null,
    history: [],
  }
}
