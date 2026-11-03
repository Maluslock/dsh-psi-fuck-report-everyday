import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { handleApi, type ApiDeps, type ApiResponse } from '../src/host/http/api'
import { registerHttpApi } from '../src/host/http/server'
import type { LlmLike, LlmStreamOptions } from '../src/host/report/llm'
import { SessionCollector, type SessionQueryLike } from '../src/host/sessions/collector'
import { mergeSettings } from '../src/host/settings'
import { KeyedLock, ReportStore, SettingsStore } from '../src/host/store'
import type { WeeklyArchive, WeeklyReport } from '../src/host/types'
import {
  assistantEvent,
  fakeQuery,
  header,
  titleEvent,
  toolEvent,
  userEvent,
} from './helpers/session-factory'

const API = '/api/dsh-psi-fuck-report-everyday'
const DATE = '2026-11-03'
const WEEK = '2026-W45'
const FIXED_NOW = new Date('2026-11-03T16:00:00+08:00')

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

function defaultQuery(): SessionQueryLike {
  return fakeQuery([
    {
      header: header({ id: 's1', cwd: '/work/alpha' }),
      events: [
        titleEvent(at('09:00'), '修复登录'),
        userEvent(at('09:01'), '登录报错，帮忙修一下'),
        assistantEvent(at('09:02'), '已修复登录并补了测试'),
        toolEvent(at('09:03'), 'Edit'),
      ],
    },
    {
      header: header({ id: 's2', cwd: '/work/beta' }),
      events: [
        titleEvent(at('10:00'), '整理文档'),
        userEvent(at('10:01'), '整理部署文档'),
        assistantEvent(at('10:02'), '文档整理完成'),
      ],
    },
  ])
}

interface RecordingLlm {
  llm: LlmLike
  calls: LlmStreamOptions[]
}

/** 依次返回给定文本；用完后重复最后一条，便于验证重试次数。 */
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

interface Harness {
  deps: ApiDeps
  store: ReportStore
  settings: SettingsStore
  dataDir: string
  outputDir: string
  cleanup(): Promise<void>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

async function makeHarness(options: {
  llm?: LlmLike
  query?: SessionQueryLike
  weeklyCommit?: boolean
  git?: boolean
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'eod-http-'))
  const dataDir = join(root, 'data')
  const repoRoot = join(root, 'repo')
  const outputDir = options.git ? join(repoRoot, '工作日志') : join(root, 'out')
  if (options.git) {
    await mkdir(outputDir, { recursive: true })
    git(repoRoot, ['init', '-q', '-b', 'main'])
    git(repoRoot, ['config', 'user.name', 'EOD Test'])
    git(repoRoot, ['config', 'user.email', 'eod@example.com'])
    git(repoRoot, ['config', 'commit.gpgsign', 'false'])
  }
  const weeklyCommit = options.weeklyCommit ?? false
  const settings = new SettingsStore(dataDir)
  // 把输出目录固定到临时目录（必要时临时 Git 仓库），避免测试读写真实 HOME。
  await settings.write(mergeSettings({ outputDir, weeklyCommit }))
  const store = new ReportStore({ dataDir, outputDir, writeMarkdown: true, weeklyCommit })
  const deps: ApiDeps = {
    settings,
    store,
    collector: new SessionCollector(options.query ?? defaultQuery()),
    llm: options.llm ?? recordingLlm(DAILY_JSON).llm,
    lock: new KeyedLock(),
    now: () => new Date(FIXED_NOW),
  }
  const cleanup = async (): Promise<void> => {
    await rm(root, { recursive: true, force: true })
  }
  cleanups.push(cleanup)
  return { deps, store, settings, dataDir, outputDir, cleanup }
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

describe('handleApi', () => {
  it('answers health with the stable plugin payload', async () => {
    const harness = await makeHarness()
    const response = await handleApi({ method: 'GET', url: `${API}/health` }, harness.deps)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(parse(response)).toEqual({ ok: true, plugin: 'dsh-psi-fuck-report-everyday' })
  })

  it('404s outside the plugin prefix and on unknown paths', async () => {
    const harness = await makeHarness()

    const outside = await handleApi({ method: 'GET', url: '/api/other/health' }, harness.deps)
    const unknown = await handleApi({ method: 'GET', url: `${API}/nope` }, harness.deps)

    expect(outside.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(parse<{ error: { code: string } }>(unknown).error.code).toBe('E_BAD_REQUEST')
  })

  it('generates a daily report, writes markdown, and exposes it through state', async () => {
    const harness = await makeHarness()
    const generated = await handleApi(
      { method: 'POST', url: `${API}/generate`, body: { date: DATE } },
      harness.deps,
    )

    expect(generated.status).toBe(200)
    const payload = parse<{
      daily: {
        date: string
        sections: { done: string[] }
        sources: Array<{ sessionId: string }>
        coverage: { sessions: number; messages: number }
      }
      paths: { json: string; markdown?: string }
    }>(generated)
    expect(payload.daily.date).toBe(DATE)
    expect(payload.daily.sections.done).toEqual(['修复登录'])
    expect(payload.daily.sources.map((source) => source.sessionId)).toEqual(['s1', 's2'])
    expect(payload.daily.coverage.sessions).toBe(2)
    expect(payload.daily.coverage.messages).toBe(4)
    expect(await exists(payload.paths.json)).toBe(true)

    const markdownPath = join(harness.outputDir, `${DATE}.md`)
    expect(payload.paths.markdown).toBe(markdownPath)
    expect(await exists(markdownPath)).toBe(true)
    expect(await readFile(markdownPath, 'utf8')).toContain('- 修复登录')

    const state = parse<{
      daily: { sections: { done: string[] } } | null
      week: string
      weekly: unknown
    }>(await handleApi({ method: 'GET', url: `${API}/state?date=${DATE}` }, harness.deps))
    expect(state.daily?.sections.done).toEqual(['修复登录'])
    expect(state.week).toBe(WEEK)
    expect(state.weekly).toBeNull()
  })

  it('saves a draft and serves it as markdown download', async () => {
    const harness = await makeHarness()
    await handleApi({ method: 'POST', url: `${API}/generate`, body: { date: DATE } }, harness.deps)

    const drafted = await handleApi(
      {
        method: 'PUT',
        url: `${API}/draft`,
        body: {
          kind: 'daily',
          date: DATE,
          sections: { done: ['改过'], risks: [], tomorrow: [] },
        },
      },
      harness.deps,
    )
    expect(drafted.status).toBe(200)
    expect(parse<{ ok: boolean }>(drafted).ok).toBe(true)

    const download = await handleApi(
      { method: 'GET', url: `${API}/download?kind=daily&date=${DATE}` },
      harness.deps,
    )
    expect(download.status).toBe(200)
    expect(download.headers['content-type']).toContain('text/markdown')
    expect(download.body).toContain('- 改过')
    expect(download.body).not.toContain('- 修复登录')
  })

  it('rejects invalid dates and missing drafts without writing anything', async () => {
    const harness = await makeHarness()

    const badDate = await handleApi(
      { method: 'POST', url: `${API}/generate`, body: { date: '2026-13-40' } },
      harness.deps,
    )
    expect(badDate.status).toBe(400)
    expect(parse<{ error: { code: string } }>(badDate).error.code).toBe('E_BAD_DATE')

    const missing = await handleApi(
      { method: 'GET', url: `${API}/download?kind=daily&date=${DATE}` },
      harness.deps,
    )
    expect(missing.status).toBe(400)
    expect(parse<{ error: { message: string } }>(missing).error.message).toBe('日报尚未生成')

    const badDraft = await handleApi(
      { method: 'PUT', url: `${API}/draft`, body: { kind: 'daily', date: DATE, sections: {} } },
      harness.deps,
    )
    expect(badDraft.status).toBe(400)
    expect(parse<{ error: { code: string } }>(badDraft).error.code).toBe('E_BAD_REQUEST')
    expect(await exists(join(harness.outputDir, `${DATE}.md`))).toBe(false)
  })

  it('maps a failing model to 502 and leaves no daily report behind', async () => {
    const failing: LlmLike = {
      async *stream() {
        throw new Error('provider down')
      },
    }
    const harness = await makeHarness({ llm: failing })

    const generated = await handleApi(
      { method: 'POST', url: `${API}/generate`, body: { date: DATE } },
      harness.deps,
    )
    expect(generated.status).toBe(502)
    expect(parse<{ error: { code: string } }>(generated).error.code).toBe('E_LLM_UNAVAILABLE')

    const state = parse<{ daily: unknown }>(
      await handleApi({ method: 'GET', url: `${API}/state?date=${DATE}` }, harness.deps),
    )
    expect(state.daily).toBeNull()
    expect(await exists(join(harness.outputDir, `${DATE}.md`))).toBe(false)
  })

  it('maps unparsable model output to 502 after exactly one retry', async () => {
    const recorder = recordingLlm('not json')
    const harness = await makeHarness({ llm: recorder.llm })

    const generated = await handleApi(
      { method: 'POST', url: `${API}/generate`, body: { date: DATE } },
      harness.deps,
    )
    expect(generated.status).toBe(502)
    expect(parse<{ error: { code: string } }>(generated).error.code).toBe('E_LLM_BAD_OUTPUT')
    expect(recorder.calls).toHaveLength(2)
    expect(recorder.calls[1]?.messages[0]?.content[0]?.text).toContain('只输出 JSON')
  })

  it('returns 400 E_NO_SESSIONS when the day has no sessions', async () => {
    const harness = await makeHarness({ query: fakeQuery([]) })
    const generated = await handleApi(
      { method: 'POST', url: `${API}/generate`, body: { date: DATE } },
      harness.deps,
    )
    expect(generated.status).toBe(400)
    expect(parse<{ error: { code: string } }>(generated).error.code).toBe('E_NO_SESSIONS')
  })

  it('groups sources by project and reports coverage', async () => {
    const harness = await makeHarness()
    const response = await handleApi(
      { method: 'GET', url: `${API}/sources?date=${DATE}` },
      harness.deps,
    )
    expect(response.status).toBe(200)
    const payload = parse<{
      groups: Array<{
        project: string
        cwd: string
        sessions: Array<{
          sessionId: string
          title: string
          time: string
          messages: number
          selected: boolean
        }>
      }>
      coverage: { sessions: number; messages: number }
    }>(response)
    expect(payload.groups.map((group) => group.project)).toEqual(['alpha', 'beta'])
    expect(payload.groups.map((group) => group.cwd)).toEqual(['/work/alpha', '/work/beta'])
    expect(payload.groups[0]?.sessions[0]).toMatchObject({
      sessionId: 's1',
      title: '修复登录',
      messages: 2,
      selected: true,
    })
    expect(payload.groups[0]?.sessions[0]?.time).toMatch(/^\d{2}:\d{2}$/)
    expect(payload.coverage).toEqual({ sessions: 2, messages: 4 })
  })

  it('persists settings and per-day exclusions', async () => {
    const harness = await makeHarness()

    const settings = await handleApi(
      {
        method: 'PUT',
        url: `${API}/settings`,
        body: {
          reminderTime: '18:00',
          weeklyDay: 3,
          model: { provider: 'custom', model: 'custom-model' },
          outputDir: harness.outputDir,
          weeklyCommit: false,
        },
      },
      harness.deps,
    )
    expect(settings.status).toBe(200)
    expect(parse<{ settings: { reminderTime: string } }>(settings).settings.reminderTime).toBe('18:00')

    const excluded = await handleApi(
      {
        method: 'POST',
        url: `${API}/exclude`,
        body: { date: DATE, projects: ['/work/alpha'], sessions: ['s2'] },
      },
      harness.deps,
    )
    expect(excluded.status).toBe(200)

    const stored = await harness.settings.read()
    expect(stored.excludedByDate[DATE]).toEqual({
      projects: ['/work/alpha'],
      sessions: ['s2'],
    })

    const sources = parse<{ groups: unknown[]; coverage: { sessions: number } }>(
      await handleApi({ method: 'GET', url: `${API}/sources?date=${DATE}` }, harness.deps),
    )
    expect(sources.groups).toEqual([])
    expect(sources.coverage.sessions).toBe(0)
  })

  it('generates a weekly report from stored dailies and serves its markdown', async () => {
    const recorder = recordingLlm(DAILY_JSON, WEEKLY_JSON)
    const harness = await makeHarness({ llm: recorder.llm })
    await handleApi({ method: 'POST', url: `${API}/generate`, body: { date: DATE } }, harness.deps)

    const response = await handleApi(
      { method: 'POST', url: `${API}/generate-week`, body: { week: WEEK } },
      harness.deps,
    )
    expect(response.status).toBe(200)
    const payload = parse<{
      weekly: { week: string; days: string[]; missingDays: string[]; sections: { done: string[] } }
      paths: { json: string; markdown?: string }
    }>(response)
    expect(payload.weekly.week).toBe(WEEK)
    expect(payload.weekly.days).toEqual([DATE])
    expect(payload.weekly.missingDays).toEqual(['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-06'])
    expect(payload.weekly.sections.done).toEqual(['完成登录修复'])
    expect(await exists(payload.paths.json)).toBe(true)

    const weeklyMarkdown = join(harness.outputDir, `${WEEK}-周报.md`)
    expect(payload.paths.markdown).toBe(weeklyMarkdown)
    expect(await readFile(weeklyMarkdown, 'utf8')).toContain('- 完成登录修复')

    const download = await handleApi(
      { method: 'GET', url: `${API}/download?kind=weekly&date=${DATE}` },
      harness.deps,
    )
    expect(download.status).toBe(200)
    expect(download.body).toContain(`# ${WEEK} 周报`)
  })

  it('persists the weekly archive so a state refresh still shows it', async () => {
    const recorder = recordingLlm(DAILY_JSON, WEEKLY_JSON)
    const harness = await makeHarness({ llm: recorder.llm, weeklyCommit: true })
    await handleApi({ method: 'POST', url: `${API}/generate`, body: { date: DATE } }, harness.deps)

    const generated = await handleApi(
      { method: 'POST', url: `${API}/generate-week`, body: { week: WEEK } },
      harness.deps,
    )
    expect(generated.status).toBe(200)
    const payload = parse<{
      weekly: { archive?: WeeklyArchive }
      archive: WeeklyArchive
      paths: { json: string }
    }>(generated)
    expect(payload.archive).toMatchObject({ committed: false, reason: 'no-git' })
    expect(payload.archive.committedAt).toEqual(expect.any(String))
    expect(payload.weekly.archive).toEqual(payload.archive)

    // 刷新页面只会重新 GET /state；归档状态必须从落盘 JSON 恢复。
    const state = parse<{
      weekly: { archive?: WeeklyArchive }
      archive: WeeklyArchive | null
    }>(await handleApi({ method: 'GET', url: `${API}/state?date=${DATE}` }, harness.deps))
    expect(state.archive).toEqual(payload.archive)
    expect(state.weekly.archive).toEqual(payload.archive)
    expect(JSON.parse(await readFile(payload.paths.json, 'utf8')).archive).toEqual(payload.archive)
  })

  it('persists the archive of a manual commit and returns it from state', async () => {
    const harness = await makeHarness({ weeklyCommit: true, git: true })
    const report: WeeklyReport = {
      version: 1,
      week: WEEK,
      generatedAt: '2026-11-06T17:00:00+08:00',
      model: { provider: 'deepseek-official', model: 'deepseek-flash' },
      days: [DATE],
      missingDays: ['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-06'],
      sections: { done: ['完成登录修复'], risks: [], next: [] },
      editedAt: null,
      history: [],
    }
    await harness.store.writeWeekly(report)

    const committed = await handleApi(
      { method: 'POST', url: `${API}/commit`, body: { week: WEEK } },
      harness.deps,
    )
    expect(committed.status).toBe(200)
    const payload = parse<{
      ok: boolean
      committed: boolean
      hash?: string
      archive: WeeklyArchive
    }>(committed)
    expect(payload.ok).toBe(true)
    expect(payload.committed).toBe(true)
    expect(payload.hash).toEqual(expect.any(String))
    expect(payload.archive).toMatchObject({ committed: true, hash: payload.hash })
    expect(payload.archive.committedAt).toEqual(expect.any(String))

    const state = parse<{ archive: WeeklyArchive | null }>(
      await handleApi({ method: 'GET', url: `${API}/state?date=${DATE}` }, harness.deps),
    )
    expect(state.archive).toEqual(payload.archive)
    expect(JSON.parse(await readFile(harness.store.weeklyPath(WEEK), 'utf8')).archive)
      .toEqual(payload.archive)
  })

  it('reports E_NO_WEEKLY_SOURCE when no daily exists for the week', async () => {
    const harness = await makeHarness()
    const response = await handleApi(
      { method: 'POST', url: `${API}/generate-week`, body: { week: WEEK } },
      harness.deps,
    )
    expect(response.status).toBe(400)
    expect(parse<{ error: { code: string } }>(response).error.code).toBe('E_NO_WEEKLY_SOURCE')
  })

  it('commits without a repository reports no-git instead of failing', async () => {
    const harness = await makeHarness()
    const response = await handleApi(
      { method: 'POST', url: `${API}/commit`, body: { week: WEEK } },
      harness.deps,
    )
    expect(response.status).toBe(200)
    expect(parse(response)).toMatchObject({
      ok: false,
      committed: false,
      reason: 'no-git',
      archive: { committed: false, reason: 'no-git' },
    })
  })

  it('maps a concurrent same-key generation to 409 E_LOCKED', async () => {
    const harness = await makeHarness()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = harness.deps.lock.run(`daily:${DATE}`, () => gate)

    const response = await handleApi(
      { method: 'POST', url: `${API}/generate`, body: { date: DATE } },
      harness.deps,
    )
    expect(response.status).toBe(409)
    expect(parse<{ error: { code: string } }>(response).error.code).toBe('E_LOCKED')

    release()
    await holding
  })

  it('maps an unexpected internal error to 500', async () => {
    const harness = await makeHarness()
    const broken = {
      read: async () => {
        throw new Error('settings exploded')
      },
      write: async () => undefined,
    } as unknown as SettingsStore

    const response = await handleApi(
      { method: 'GET', url: `${API}/state` },
      { ...harness.deps, settings: broken },
    )
    expect(response.status).toBe(500)
    expect(parse<{ error: { message: string } }>(response).error.message).toContain('settings exploded')
  })
})

interface CapturedRoute {
  kind: string
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

function fakeContext(): { ctx: Context; route(): CapturedRoute | undefined } {
  let captured: CapturedRoute | undefined
  const ctx = {
    effect: (execute: () => unknown) => {
      const disposer = execute()
      return async () => {
        if (typeof disposer === 'function') await disposer()
      }
    },
    webServer: {
      register: (route: CapturedRoute) => {
        captured = route
        return () => {
          captured = undefined
        }
      },
    },
  } as unknown as Context
  return { ctx, route: () => captured }
}

function makeRequest(method: string, url: string, payload?: string): IncomingMessage {
  const stream = Readable.from(payload === undefined ? [] : [Buffer.from(payload, 'utf8')])
  return Object.assign(stream, { method, url }) as unknown as IncomingMessage
}

interface ResponseState {
  status: number
  headers: Record<string, string>
  body: string
}

function makeResponse(): { res: ServerResponse; state: ResponseState } {
  const state: ResponseState = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status
      state.headers = headers ?? {}
      return res
    },
    end(body?: string | Buffer) {
      state.body = body === undefined ? '' : String(body)
    },
  }
  return { res: res as unknown as ServerResponse, state }
}

describe('registerHttpApi', () => {
  it('registers a prefix route and serves health through node:http', async () => {
    const harness = await makeHarness()
    const fake = fakeContext()
    registerHttpApi(fake.ctx, harness.deps)

    const route = fake.route()
    expect(route?.kind).toBe('prefix')
    expect(route?.path).toBe(API)

    const { res, state } = makeResponse()
    await route!.handler(makeRequest('GET', `${API}/health`), res)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ ok: true, plugin: 'dsh-psi-fuck-report-everyday' })
  })

  it('parses a JSON body and forwards it to handleApi', async () => {
    const harness = await makeHarness()
    const fake = fakeContext()
    registerHttpApi(fake.ctx, harness.deps)

    const { res, state } = makeResponse()
    await fake.route()!.handler(
      makeRequest('POST', `${API}/generate`, JSON.stringify({ date: DATE })),
      res,
    )
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body).daily.sections.done).toEqual(['修复登录'])
  })

  it('rejects malformed JSON and bodies larger than 1MB', async () => {
    const harness = await makeHarness()
    const fake = fakeContext()
    registerHttpApi(fake.ctx, harness.deps)
    const route = fake.route()!

    const malformed = makeResponse()
    await route.handler(makeRequest('POST', `${API}/generate`, '{'), malformed.res)
    expect(malformed.state.status).toBe(400)
    expect(JSON.parse(malformed.state.body).error.code).toBe('E_BAD_REQUEST')

    const oversized = makeResponse()
    await route.handler(
      makeRequest('POST', `${API}/generate`, `{"date":"${DATE}","pad":"${'a'.repeat(1_000_000)}"}`),
      oversized.res,
    )
    expect(oversized.state.status).toBe(400)
    expect(JSON.parse(oversized.state.body).error.message).toContain('body too large')
  })
})
