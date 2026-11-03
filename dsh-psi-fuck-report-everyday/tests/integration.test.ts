import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handleApi, type ApiDeps, type ApiResponse } from '../src/host/http/api'
import type { LlmLike, LlmStreamOptions } from '../src/host/report/llm'
import { WEEKLY_SYSTEM } from '../src/host/report/prompts'
import { SessionCollector } from '../src/host/sessions/collector'
import { mergeSettings } from '../src/host/settings'
import { KeyedLock, ReportStore, SettingsStore } from '../src/host/store'
import {
  assistantEvent,
  fakeQuery,
  header,
  titleEvent,
  toolEvent,
  userEvent,
  type FakeQuery,
} from './helpers/session-factory'

/**
 * 端到端集成（spec 12.3 / 计划 Task 9）：
 * generate → draft → download → weekly 全链路跑在临时目录上，
 * 覆盖 AC-1（三节限长）、AC-3（Markdown 与草稿一致）、AC-4（请求体无密钥）、
 * AC-5（子代理不重复）、AC-6（LLM 失败不覆盖旧稿）、AC-8（missingDays）
 * 与无 Git 仓库时的归档路径（AC-11 的 no-git 分支）。
 */

const API = '/api/dsh-psi-fuck-report-everyday'
const DATE = '2026-11-03'
const WEEK = '2026-W45'
/** fixture 密钥；任何模型请求体里都不允许出现原文（AC-4）。 */
const SECRET = 'sk-abc12345678'

const DAILY_JSON = JSON.stringify({
  done: ['修复登录'],
  risks: ['无'],
  tomorrow: ['继续完善测试'],
})
const WEEKLY_JSON = JSON.stringify({
  done: ['完成登录修复'],
  risks: ['无'],
  next: ['补充回归测试'],
})

function at(time: string): number {
  return Date.parse(`${DATE}T${time}:00+08:00`)
}

function parse<T>(response: ApiResponse): T {
  return JSON.parse(response.body) as T
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 2 个可见会话共 3 条消息，s2 文本含密钥与路径，另有 1 个必须被过滤的子代理会话。 */
function integrationQuery(): FakeQuery {
  return fakeQuery([
    {
      header: header({ id: 's1', cwd: '/home/user/x' }),
      events: [
        titleEvent(at('09:00'), '修复登录'),
        userEvent(at('09:01'), '登录报错，帮忙修一下'),
        assistantEvent(at('09:02'), '已修复登录并补了测试'),
        toolEvent(at('09:03'), 'Edit'),
      ],
    },
    {
      header: header({ id: 's2' }),
      events: [userEvent(at('10:00'), `把 ${SECRET} 从 /home/user/x/config.yaml 移除`)],
    },
    {
      header: header({ id: 'sub', cwd: '/home/user/x', parentSession: 's1', delegationDepth: 1 }),
      events: [userEvent(at('10:30'), '子代理任务')],
    },
  ])
}

interface RecordingLlm {
  llm: LlmLike
  calls: LlmStreamOptions[]
}

/** 依次返回给定文本；用完后重复最后一条。 */
function recordingLlm(...responses: string[]): RecordingLlm {
  const calls: LlmStreamOptions[] = []
  const llm: LlmLike = {
    async *stream(options: LlmStreamOptions) {
      calls.push(options)
      const text = responses[Math.min(calls.length - 1, responses.length - 1)] ?? ''
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  return { llm, calls }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function makeHarness(llm: LlmLike, query: FakeQuery): Promise<{
  deps: ApiDeps
  outputDir: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'eod-int-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const dataDir = join(root, 'data')
  const outputDir = join(root, 'out')
  const settings = new SettingsStore(dataDir)
  // outputDir 固定在临时目录（不在任何 Git 仓库内）→ 归档必须走 no-git 分支。
  await settings.write(mergeSettings({ outputDir, weeklyCommit: true }))
  const deps: ApiDeps = {
    settings,
    store: new ReportStore({ dataDir, outputDir, writeMarkdown: true, weeklyCommit: true }),
    collector: new SessionCollector(query),
    llm,
    lock: new KeyedLock(),
    now: () => new Date('2026-11-03T10:00:00+08:00'),
  }
  return { deps, outputDir }
}

const generateDaily = (deps: ApiDeps): Promise<ApiResponse> =>
  handleApi({ method: 'POST', url: `${API}/generate`, body: { date: DATE } }, deps)

describe('integration: report flow', () => {
  it('generate → draft → download → weekly，含 no-git 归档与脱敏请求体', async () => {
    const query = integrationQuery()
    const recorder = recordingLlm(DAILY_JSON, WEEKLY_JSON)
    const { deps, outputDir } = await makeHarness(recorder.llm, query)

    // ---- 生成日报 ----
    const generated = await generateDaily(deps)
    expect(generated.status).toBe(200)
    const dailyPayload = parse<{
      daily: {
        date: string
        sections: { done: string[]; risks: string[]; tomorrow?: string[] }
        sources: Array<{ sessionId: string }>
        coverage: { sessions: number; messages: number }
      }
      paths: { json: string; markdown?: string }
    }>(generated)
    expect(dailyPayload.daily.date).toBe(DATE)

    // AC-5：子代理不重复计入——只读取 s1/s2，coverage 恰为 2 会话 3 条消息。
    expect(query.readIds).toEqual(['s1', 's2'])
    expect(dailyPayload.daily.coverage).toMatchObject({ sessions: 2, messages: 3 })
    expect(dailyPayload.daily.sources.map((source) => source.sessionId)).toEqual(['s1', 's2'])

    // AC-1：三节各 1–3 / 0–3 条，每条 ≤40 个码点。
    const sections = dailyPayload.daily.sections
    expect(sections.done).toEqual(['修复登录'])
    expect(sections.risks).toEqual(['无'])
    expect(sections.tomorrow).toEqual(['继续完善测试'])
    for (const item of [...sections.done, ...sections.risks, ...(sections.tomorrow ?? [])]) {
      expect([...item].length).toBeLessThanOrEqual(40)
    }

    // AC-4：进入模型的请求体不含密钥原文，且能见到脱敏占位符。
    const requestBodies = recorder.calls.map((call) =>
      JSON.stringify({ system: call.system, messages: call.messages }),
    )
    expect(requestBodies[0]).not.toContain(SECRET)
    expect(requestBodies[0]).toContain('sk-***')
    expect(requestBodies.join('\n')).not.toContain(SECRET)

    // 日报 JSON 与 Markdown 都已落盘。
    expect(await exists(dailyPayload.paths.json)).toBe(true)
    const markdownPath = join(outputDir, `${DATE}.md`)
    expect(dailyPayload.paths.markdown).toBe(markdownPath)
    expect(await exists(markdownPath)).toBe(true)

    // ---- 编辑草稿 ----
    const drafted = await handleApi(
      {
        method: 'PUT',
        url: `${API}/draft`,
        body: { kind: 'daily', date: DATE, sections: { done: ['改过'], risks: [], tomorrow: [] } },
      },
      deps,
    )
    expect(drafted.status).toBe(200)

    // ---- 下载与文件一致（AC-3）----
    const download = await handleApi(
      { method: 'GET', url: `${API}/download?kind=daily&date=${DATE}` },
      deps,
    )
    expect(download.status).toBe(200)
    const markdown = await readFile(markdownPath, 'utf8')
    expect(download.body).toBe(markdown)
    expect(markdown).toContain('- 改过')
    expect(markdown).toContain('## 今日完成')

    // ---- 生成周报 ----
    const weekly = await handleApi(
      { method: 'POST', url: `${API}/generate-week`, body: { week: WEEK } },
      deps,
    )
    expect(weekly.status).toBe(200)
    const weeklyPayload = parse<{
      weekly: { week: string; days: string[]; missingDays: string[]; sections: { done: string[] } }
      paths: { json: string; markdown?: string }
      archive?: { committed: boolean; reason?: string; committedAt?: string }
    }>(weekly)
    expect(weeklyPayload.weekly.week).toBe(WEEK)
    expect(weeklyPayload.weekly.days).toEqual([DATE])
    // AC-8：缺天如实记录（其余 4 个工作日）。
    expect(weeklyPayload.weekly.missingDays).toEqual([
      '2026-11-02',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ])
    expect(weeklyPayload.weekly.sections.done).toEqual(['完成登录修复'])

    // 无 Git 仓库：自动归档返回 no-git 而不失败（AC-11 的无 Git 分支）。
    expect(weeklyPayload.archive).toMatchObject({ committed: false, reason: 'no-git' })
    expect(weeklyPayload.archive!.committedAt).toEqual(expect.any(String))
    expect(await exists(weeklyPayload.paths.json)).toBe(true)
    const weeklyMarkdownPath = join(outputDir, `${WEEK}-周报.md`)
    expect(weeklyPayload.paths.markdown).toBe(weeklyMarkdownPath)
    const weeklyMarkdown = await readFile(weeklyMarkdownPath, 'utf8')
    expect(weeklyMarkdown).toContain(`# ${WEEK} 周报`)
    expect(weeklyMarkdown).toContain('- 完成登录修复')

    // 周报只汇总已落盘日报：第二次模型调用的用户消息来自已编辑的日报。
    expect(recorder.calls).toHaveLength(2)
    expect(recorder.calls[1]?.system).toBe(WEEKLY_SYSTEM)
    expect(recorder.calls[1]?.messages[0]?.content[0]?.text).toContain('完成：改过')
    expect(recorder.calls[1]?.messages[0]?.content[0]?.text).not.toContain(SECRET)
  })

  it('模型失败时不覆盖旧稿，JSON 与 Markdown 原样保留（AC-6）', async () => {
    const query = integrationQuery()
    const recorder = recordingLlm(DAILY_JSON)
    const { deps, outputDir } = await makeHarness(recorder.llm, query)

    expect((await generateDaily(deps)).status).toBe(200)
    await handleApi(
      {
        method: 'PUT',
        url: `${API}/draft`,
        body: { kind: 'daily', date: DATE, sections: { done: ['改过'], risks: [], tomorrow: [] } },
      },
      deps,
    )

    const failing: LlmLike = {
      async *stream() {
        throw new Error('provider down')
      },
    }
    deps.llm = failing
    const again = await generateDaily(deps)
    expect(again.status).toBe(502)
    expect(parse<{ error: { code: string } }>(again).error.code).toBe('E_LLM_UNAVAILABLE')

    const state = parse<{
      daily: { sections: { done: string[] }; history: unknown[] } | null
    }>(await handleApi({ method: 'GET', url: `${API}/state?date=${DATE}` }, deps))
    expect(state.daily?.sections.done).toEqual(['改过'])
    expect(state.daily?.history).toEqual([])

    const markdown = await readFile(join(outputDir, `${DATE}.md`), 'utf8')
    expect(markdown).toContain('- 改过')
    expect(markdown).not.toContain('- 修复登录')
  })
})
