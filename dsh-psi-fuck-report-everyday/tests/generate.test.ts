import { describe, expect, it } from 'vitest'
import { generateDaily, generateWeekly } from '../src/host/report/generate'
import { callModel, type LlmLike, type LlmStreamOptions } from '../src/host/report/llm'
import { DAILY_SYSTEM, GROUP_SYSTEM, WEEKLY_SYSTEM } from '../src/host/report/prompts'
import type { Coverage, DailyReport, Sections, SessionDigest } from '../src/host/types'

const model = { provider: 'deepseek', model: 'deepseek-v4' }

interface RecordedCall {
  system: string | undefined
  user: string
}

function fakeLlm(responses: string[]): { llm: LlmLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const llm: LlmLike = {
    async *stream(options: LlmStreamOptions) {
      calls.push({
        system: options.system,
        user: String(options.messages[0]?.content[0]?.text ?? ''),
      })
      const response = responses[Math.min(calls.length - 1, responses.length - 1)] ?? ''
      yield { type: 'text-delta', index: 0, text: response }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  return { llm, calls }
}

function digest(index: number, text = `会话 ${index} 摘要`, messages = index): SessionDigest {
  return {
    sessionId: `session-${index}`,
    project: index % 2 === 0 ? 'alpha' : 'beta',
    text,
    messages,
  }
}

function coverage(overrides: Partial<Coverage> = {}): Coverage {
  return { sessions: 1, messages: 1, truncated: false, groups: 1, ...overrides }
}

function dailySections(overrides: Partial<Sections> = {}): Sections {
  return { done: ['完成一件事'], risks: ['无'], tomorrow: ['继续'], ...overrides }
}

function dailyReport(date: string, sections: Sections): DailyReport {
  return {
    version: 1,
    date,
    generatedAt: '2026-11-03T10:00:00.000Z',
    model,
    sources: [],
    coverage: coverage(),
    sections,
    editedAt: null,
    history: [],
  }
}

describe('generateDaily', () => {
  it('calls the model once for a normal day and keeps the coverage', async () => {
    const sections = dailySections({ done: ['修复登录', '补充测试'], risks: ['无'], tomorrow: ['发版'] })
    const { llm, calls } = fakeLlm([JSON.stringify(sections)])

    const result = await generateDaily({
      llm,
      model,
      date: '2026-11-03',
      digests: [digest(1), digest(2)],
      coverage: coverage({ sessions: 2, messages: 5 }),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.system).toBe(DAILY_SYSTEM)
    expect(calls[0]?.user).toContain('日期：2026-11-03')
    expect(calls[0]?.user).toContain('覆盖：2 个会话，5 条消息，分 1 组。')
    expect(calls[0]?.user).toContain('会话 1 摘要')
    expect(result.sections).toEqual(sections)
    expect(result.coverage).toEqual({ sessions: 2, messages: 5, truncated: false, groups: 1 })
  })

  it('compresses 40 sessions into four groups plus one daily call', async () => {
    const groupResponse = '{"points":["产出 A","问题 B"]}'
    const { llm, calls } = fakeLlm([
      groupResponse,
      groupResponse,
      groupResponse,
      groupResponse,
      JSON.stringify(dailySections()),
    ])
    const digests = Array.from({ length: 40 }, (_, index) => digest(index + 1))

    const result = await generateDaily({
      llm,
      model,
      date: '2026-11-03',
      digests,
      coverage: coverage({ sessions: 40, messages: 400 }),
    })

    expect(calls).toHaveLength(5)
    expect(calls.slice(0, 4).every((call) => call.system === GROUP_SYSTEM)).toBe(true)
    expect(calls[0]?.user).toContain('以下是 8 个会话摘要')
    expect(calls[3]?.user).toContain('另有 8 个会话未展开。')
    expect(calls[4]?.system).toBe(DAILY_SYSTEM)
    expect(calls[4]?.user).toContain('分 4 组')
    expect(calls[4]?.user).toContain('产出 A')
    expect(result.coverage.groups).toBe(4)
    expect(result.coverage.truncated).toBe(true)
    expect(result.coverage.sessions).toBe(40)
  })

  it('triggers two-stage compression on total digest length', async () => {
    const longText = 'x'.repeat(9000)
    const { llm, calls } = fakeLlm(['{"points":["压缩后要点"]}', JSON.stringify(dailySections())])

    const result = await generateDaily({
      llm,
      model,
      date: '2026-11-03',
      digests: [digest(1, longText, 3), digest(2, longText, 4)],
      coverage: coverage({ sessions: 2, messages: 7 }),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.system).toBe(GROUP_SYSTEM)
    expect(calls[1]?.user).toContain('压缩后要点')
    expect(result.coverage.groups).toBe(1)
  })

  it('falls back to mechanical truncation when a group summary fails', async () => {
    const { llm, calls } = fakeLlm(['not json at all', JSON.stringify(dailySections())])
    const digests = Array.from({ length: 40 }, (_, index) => digest(index + 1, `摘要 ${index}`, index + 1))

    const result = await generateDaily({
      llm,
      model,
      date: '2026-11-03',
      digests,
      coverage: coverage({ sessions: 40, messages: 820 }),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.system).toBe(GROUP_SYSTEM)
    expect(calls[1]?.system).toBe(DAILY_SYSTEM)
    expect(calls[1]?.user).toContain('摘要 39')
    expect(result.coverage.groups).toBe(1)
    expect(result.coverage.truncated).toBe(true)
  })

  it('retries once with the JSON-only suffix when the first answer is unparsable', async () => {
    const { llm, calls } = fakeLlm(['不是 JSON', JSON.stringify(dailySections())])

    const result = await generateDaily({
      llm,
      model,
      date: '2026-11-03',
      digests: [digest(1)],
      coverage: coverage(),
    })

    expect(calls).toHaveLength(2)
    expect(calls[1]?.user).toContain('只输出 JSON')
    expect(result.sections.done).toEqual(['完成一件事'])
  })

  it('throws E_LLM_BAD_OUTPUT after a second unparsable answer', async () => {
    const { llm, calls } = fakeLlm(['不是 JSON', '还是不是'])

    await expect(
      generateDaily({ llm, model, date: '2026-11-03', digests: [digest(1)], coverage: coverage() }),
    ).rejects.toMatchObject({ code: 'E_LLM_BAD_OUTPUT' })
    expect(calls).toHaveLength(2)
  })

  it('throws E_NO_SESSIONS without calling the model when the day is empty', async () => {
    const { llm, calls } = fakeLlm([JSON.stringify(dailySections())])

    await expect(
      generateDaily({ llm, model, date: '2026-11-03', digests: [], coverage: coverage({ sessions: 0, messages: 0 }) }),
    ).rejects.toMatchObject({ code: 'E_NO_SESSIONS' })
    expect(calls).toHaveLength(0)
  })
})

describe('generateWeekly', () => {
  it('summarises dailies into a weekly report and sorts days', async () => {
    const { llm, calls } = fakeLlm([
      JSON.stringify({ done: ['本周完成'], risks: ['无'], next: ['下周计划'] }),
    ])
    const dailies = [
      dailyReport('2026-11-04', dailySections({ done: ['b'] })),
      dailyReport('2026-11-03', dailySections({ done: ['a'] })),
    ]

    const report = await generateWeekly({
      llm,
      model,
      week: '2026-W45',
      dailies,
      missingDays: ['2026-11-06'],
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.system).toBe(WEEKLY_SYSTEM)
    expect(calls[0]?.user).toContain('周：2026-W45')
    expect(calls[0]?.user).toContain('日期：2026-11-03')
    expect(calls[0]?.user).toContain('完成：a')
    expect(report).toMatchObject({
      version: 1,
      week: '2026-W45',
      model,
      days: ['2026-11-03', '2026-11-04'],
      missingDays: ['2026-11-06'],
      editedAt: null,
      history: [],
    })
    expect(report.sections).toEqual({ done: ['本周完成'], risks: ['无'], next: ['下周计划'] })
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false)
  })

  it('throws E_NO_WEEKLY_SOURCE when no daily exists', async () => {
    const { llm, calls } = fakeLlm(['{"done":[],"risks":[],"next":[]}'])

    await expect(
      generateWeekly({ llm, model, week: '2026-W45', dailies: [], missingDays: [] }),
    ).rejects.toMatchObject({ code: 'E_NO_WEEKLY_SOURCE' })
    expect(calls).toHaveLength(0)
  })
})

describe('callModel', () => {
  it('maps a finish failure to E_LLM_UNAVAILABLE', async () => {
    const llm: LlmLike = {
      async *stream() {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'rate limited', code: '429' } } }
      },
    }

    await expect(callModel(llm, { system: 's', user: 'u', model })).rejects.toMatchObject({
      code: 'E_LLM_UNAVAILABLE',
      detail: 'rate limited',
    })
  })

  it('times out when the stream never finishes', async () => {
    const llm: LlmLike = {
      async *stream(options: LlmStreamOptions) {
        await new Promise((_resolve, reject) => {
          if (options.signal?.aborted) {
            reject(new Error('aborted'))
            return
          }
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
    }

    await expect(callModel(llm, { system: 's', user: 'u', model, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'E_LLM_UNAVAILABLE',
    })
  })

  it('rejects empty model output', async () => {
    const { llm } = fakeLlm(['   '])

    await expect(callModel(llm, { system: 's', user: 'u', model })).rejects.toMatchObject({
      code: 'E_LLM_BAD_OUTPUT',
    })
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const { llm, calls } = fakeLlm(['{"done":[]}'])

    await expect(
      callModel(llm, { system: 's', user: 'u', model, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'E_LLM_UNAVAILABLE' })
    expect(calls).toHaveLength(0)
  })
})
