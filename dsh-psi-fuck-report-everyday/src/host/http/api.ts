import { execFile } from 'node:child_process'
import { buildDigestBundle } from '../digest.js'
import { PluginError, isPluginError } from '../errors.js'
import { archiveWeek } from '../git-archive.js'
import { dailyMarkdown, weeklyMarkdown } from '../markdown.js'
import { redact } from '../redact.js'
import { generateDaily, generateWeekly } from '../report/generate.js'
import type { LlmLike } from '../report/llm.js'
import { dateExclusion, mergeSettings, pruneExcludedByDate, validateSettings } from '../settings.js'
import type { SessionCollector } from '../sessions/collector.js'
import { expandHome, type KeyedLock, type SettingsStore } from '../store.js'
import { isoWeek, localDateKey, parseDateKey, weekDates } from '../time.js'
import type {
  Coverage,
  DailyReport,
  Exclusion,
  Sections,
  Settings,
  SourceMeta,
  WeeklyArchive,
  WeeklyReport,
} from '../types.js'

/** HTTP 层依赖的最小存储面；DynamicStore 与 ReportStore 都满足。 */
export interface StoreLike {
  readDaily(date: string): Promise<DailyReport | null>
  readWeekly(week: string): Promise<WeeklyReport | null>
  writeDaily(report: DailyReport, opts?: { replace?: boolean }): Promise<{ json: string; markdown?: string }>
  writeWeekly(report: WeeklyReport, opts?: { replace?: boolean }): Promise<{ json: string; markdown?: string }>
  saveDraft(input: {
    kind: 'daily' | 'weekly'
    date?: string
    week?: string
    sections: Sections
  }): Promise<unknown>
  /**
   * 只回写归档状态。宿主装配尚未显式实现该可选方法时，api 会退回读改写，
   * 行为等价（保留周报内容、不 push history）。
   */
  setWeeklyArchive?(week: string, archive: WeeklyArchive): Promise<boolean>
}

export interface ApiDeps {
  settings: SettingsStore
  store: StoreLike
  collector: SessionCollector
  llm: LlmLike
  lock: KeyedLock
  /** 仅供测试固定「今天」；生产不传。 */
  now?: () => Date
}

export interface ApiRequest {
  method: string
  url: string
  body?: unknown
}

export interface ApiResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const PREFIX = '/api/dsh-psi-fuck-report-everyday'
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const
const MARKDOWN_HEADERS = { 'content-type': 'text/markdown; charset=utf-8' } as const

const json = (status: number, value: unknown): ApiResponse => ({
  status,
  headers: { ...JSON_HEADERS },
  body: JSON.stringify(value),
})

const str = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
)

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** 全局排除 + 当天排除合并成 Set 视图；collector 与 sources 共用。 */
export function exclusionFor(settings: Settings, date: string): Exclusion {
  const daily = dateExclusion(settings, date)
  return {
    projects: new Set([...settings.excludedProjects, ...daily.projects]),
    sessions: new Set([...settings.excludedSessions, ...daily.sessions]),
  }
}

/** 把当天采集到的会话按 cwd 分组，供面板勾选。 */
export function groupSources(sessions: Awaited<ReturnType<SessionCollector['collect']>>) {
  const groups = new Map<string, typeof sessions>()
  for (const session of sessions) {
    const cwd = session.cwd || '(unknown)'
    const bucket = groups.get(cwd)
    if (bucket) bucket.push(session)
    else groups.set(cwd, [session])
  }
  return [...groups.entries()].map(([cwd, items]) => ({
    project: cwd.split(/[\\/]+/).filter(Boolean).pop() ?? cwd,
    cwd,
    sessions: items.map((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      time: new Date(session.firstTime).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      messages: session.messages,
      selected: true,
    })),
  }))
}

function gitToplevel(dir: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', windowsHide: true },
      (error, stdout) => resolve(error ? '' : String(stdout).trim()),
    )
  })
}

interface WeekSource {
  dailies: DailyReport[]
  missingDays: string[]
}

/** 周报只看工作日（周一至周五）已落盘的日报。 */
async function buildWeek(week: string, deps: ApiDeps): Promise<WeekSource> {
  const dates = weekDates(week).slice(0, 5)
  const dailies: DailyReport[] = []
  const missingDays: string[] = []
  for (const date of dates) {
    const daily = await deps.store.readDaily(date)
    if (daily) dailies.push(daily)
    else missingDays.push(date)
  }
  return { dailies, missingDays }
}

interface WeeklyOutcome {
  weekly: WeeklyReport
  paths: { json: string; markdown?: string }
  archive?: WeeklyArchive
}

/** archiveWeek 的 no-change 在语义上也是「已归档」，统一成前端可显示的状态。 */
function toWeeklyArchive(result: { committed: boolean; hash?: string; reason?: string }): WeeklyArchive {
  const archive: WeeklyArchive = {
    committed: result.committed || result.reason === 'no-change',
    committedAt: new Date().toISOString(),
  }
  if (result.hash) archive.hash = result.hash
  if (result.reason) archive.reason = result.reason
  return archive
}

/**
 * 优先用存储的原子回写；上下文里的 DynamicStore 尚未显式实现该可选方法时，
 * 退回「读现有周报 → 带 archive 写回」，同样保留 sections/history 且不 push history。
 */
async function persistWeeklyArchive(
  store: StoreLike,
  week: string,
  archive: WeeklyArchive,
): Promise<void> {
  if (store.setWeeklyArchive) {
    await store.setWeeklyArchive(week, archive)
    return
  }
  const report = await store.readWeekly(week)
  if (!report) return
  await store.writeWeekly({ ...report, archive })
}

async function generateAndStoreWeek(
  week: string,
  deps: ApiDeps,
  settings: Settings,
): Promise<WeeklyOutcome> {
  const { dailies, missingDays } = await buildWeek(week, deps)
  const report = await generateWeekly({
    llm: deps.llm,
    model: settings.model,
    week,
    dailies,
    missingDays,
  })
  const written = await deps.store.writeWeekly(report, { replace: true })
  let archive: WeeklyArchive | undefined
  if (settings.weeklyCommit) {
    // 设置里的 outputDir 可能带 `~`，git 与 archiveWeek 都需要真实路径。
    const outputDir = expandHome(settings.outputDir)
    const repoRoot = await gitToplevel(outputDir)
    const result = repoRoot
      ? await archiveWeek({ repoRoot, outputDir, week })
      : { committed: false, reason: 'no-git' }
    archive = toWeeklyArchive(result)
    // 归档结果写回周报 JSON，刷新后本周页仍能显示真实的提交状态。
    await persistWeeklyArchive(deps.store, week, archive)
  }
  return {
    weekly: archive ? { ...report, archive } : report,
    paths: written,
    archive,
  }
}

/**
 * 无框架依赖的 HTTP 分派：解析 URL 与 body 后返回状态码/头/正文，
 * 由 server.ts 负责真正的 node:http 读写。错误统一映射为
 * 409（锁冲突）、502（模型/解析失败）、500（写入/Git 失败）、400（其余）。
 */
export async function handleApi(request: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const url = new URL(request.url, 'http://localhost')
  if (!url.pathname.startsWith(PREFIX)) {
    return json(404, { error: { code: 'E_BAD_REQUEST', message: 'not found' } })
  }
  const path = url.pathname.slice(PREFIX.length) || '/'
  const now = deps.now?.() ?? new Date()

  try {
    if (request.method === 'GET' && path === '/health') {
      return json(200, { ok: true, plugin: 'dsh-psi-fuck-report-everyday' })
    }

    if (request.method === 'GET' && path === '/state') {
      const settings = await deps.settings.read()
      const date = str(url.searchParams.get('date')) ?? localDateKey(now)
      const daily = await deps.store.readDaily(date)
      const week = isoWeek(date)
      const weekly = await deps.store.readWeekly(week)
      return json(200, {
        settings,
        date,
        daily,
        week,
        weekly,
        // 顶层单独给出归档状态，客户端刷新时无需从 weekly 里猜。
        archive: weekly?.archive ?? null,
        outputDir: settings.outputDir,
      })
    }

    if (request.method === 'GET' && path === '/sources') {
      const settings = await deps.settings.read()
      const date = str(url.searchParams.get('date')) ?? localDateKey(now)
      const exclusion = exclusionFor(settings, date)
      const sessions = await deps.collector.collect(date, exclusion)
      const groups = groupSources(sessions).map((group) => ({
        ...group,
        sessions: group.sessions.map((session) => ({
          ...session,
          selected: !exclusion.sessions.has(session.sessionId),
        })),
      }))
      return json(200, {
        groups,
        coverage: {
          sessions: sessions.length,
          messages: sessions.reduce((sum, session) => sum + session.messages, 0),
        },
      })
    }

    if (request.method === 'GET' && path === '/workspaces') {
      const requested = Number(url.searchParams.get('days'))
      const days = Number.isFinite(requested) && requested > 0 ? Math.min(30, Math.floor(requested)) : 7
      return json(200, { cwds: await deps.collector.listWorkspaces(days) })
    }

    // 设置页的会话选择器：返回指定日期的会话清单（含已被排除的），不读正文之外的字段。
    if (request.method === 'GET' && path === '/session-options') {
      const date = str(url.searchParams.get('date')) ?? localDateKey(now)
      const sessions = await deps.collector.listSessionOptions(date)
      return json(200, {
        date,
        sessions: sessions.map((session) => ({
          id: session.sessionId,
          title: session.title,
          cwd: session.cwd,
          firstTime: session.firstTime,
          lastTime: session.lastTime,
          messages: session.messages,
        })),
      })
    }

    if (request.method === 'POST' && path === '/generate') {
      const body = (request.body ?? {}) as Record<string, unknown>
      const date = str(body.date) ?? localDateKey(now)
      const withWeekly = body.withWeekly === true
      return await deps.lock.run(`daily:${date}`, async (): Promise<ApiResponse> => {
        const settings = await deps.settings.read()
        const sessions = await deps.collector.collect(date, exclusionFor(settings, date))
        const bundle = buildDigestBundle(sessions)
        const digests = bundle.digests.map((digest) => ({ ...digest, text: redact(digest.text) }))
        const coverage: Coverage = {
          sessions: sessions.length,
          messages: sessions.reduce((sum, session) => sum + session.messages, 0),
          truncated: bundle.needsTwoStage,
          groups: 1,
        }
        const result = await generateDaily({
          llm: deps.llm,
          model: settings.model,
          date,
          digests,
          coverage,
        })
        const report: DailyReport = {
          version: 1,
          date,
          generatedAt: new Date().toISOString(),
          model: settings.model,
          sources: sessions.map((session): SourceMeta => ({
            sessionId: session.sessionId,
            cwd: session.cwd,
            title: session.title,
            messages: session.messages,
          })),
          coverage: {
            ...result.coverage,
            truncated: result.coverage.truncated || bundle.needsTwoStage,
          },
          sections: result.sections,
          editedAt: null,
          history: [],
        }
        const written = await deps.store.writeDaily(report, { replace: true })
        let weekly: WeeklyReport | undefined
        let archive: WeeklyOutcome['archive']
        if (withWeekly) {
          const generated = await generateAndStoreWeek(isoWeek(date), deps, settings)
          weekly = generated.weekly
          archive = generated.archive
        }
        return json(200, { daily: report, weekly, archive, paths: written })
      })
    }

    if (request.method === 'POST' && path === '/generate-week') {
      const body = (request.body ?? {}) as Record<string, unknown>
      const week = str(body.week) ?? isoWeek(localDateKey(now))
      return await deps.lock.run(`weekly:${week}`, async () => {
        const settings = await deps.settings.read()
        return json(200, await generateAndStoreWeek(week, deps, settings))
      })
    }

    if (request.method === 'PUT' && path === '/draft') {
      const body = (request.body ?? {}) as Record<string, unknown>
      const sections = body.sections as Partial<Sections> | undefined
      if (!sections || !isStringArray(sections.done) || !isStringArray(sections.risks)) {
        throw new PluginError('E_BAD_REQUEST', 'sections.done 与 sections.risks 必须是字符串数组')
      }
      for (const key of ['tomorrow', 'next'] as const) {
        const value = sections[key]
        if (value !== undefined && !isStringArray(value)) {
          throw new PluginError('E_BAD_REQUEST', `sections.${key} 必须是字符串数组`)
        }
      }
      await deps.store.saveDraft({
        kind: body.kind === 'weekly' ? 'weekly' : 'daily',
        date: str(body.date),
        week: str(body.week),
        sections: {
          done: sections.done,
          risks: sections.risks,
          ...(sections.tomorrow ? { tomorrow: sections.tomorrow } : {}),
          ...(sections.next ? { next: sections.next } : {}),
        },
      })
      return json(200, { ok: true, savedAt: new Date().toISOString() })
    }

    if (request.method === 'PUT' && path === '/settings') {
      const merged = pruneExcludedByDate(mergeSettings(request.body))
      const errors = validateSettings(merged)
      if (errors.length > 0) {
        throw new PluginError('E_BAD_REQUEST', `invalid settings: ${errors.join(',')}`)
      }
      await deps.settings.write(merged)
      return json(200, { settings: await deps.settings.read() })
    }

    if (request.method === 'GET' && path === '/download') {
      if (url.searchParams.get('kind') === 'weekly') {
        const dateParam = str(url.searchParams.get('date'))
        const week = str(url.searchParams.get('week'))
          ?? (dateParam ? isoWeek(dateParam) : isoWeek(localDateKey(now)))
        const report = await deps.store.readWeekly(week)
        if (!report) throw new PluginError('E_BAD_REQUEST', '周报尚未生成')
        return { status: 200, headers: { ...MARKDOWN_HEADERS }, body: weeklyMarkdown(report) }
      }
      const date = str(url.searchParams.get('date')) ?? localDateKey(now)
      const report = await deps.store.readDaily(date)
      if (!report) throw new PluginError('E_BAD_REQUEST', '日报尚未生成')
      return { status: 200, headers: { ...MARKDOWN_HEADERS }, body: dailyMarkdown(report) }
    }

    if (request.method === 'POST' && path === '/exclude') {
      const body = (request.body ?? {}) as Record<string, unknown>
      const date = str(body.date)
      if (!date) throw new PluginError('E_BAD_REQUEST', 'date is required')
      // 先校验日期，避免把非法 key 写进设置后又被 mergeSettings 静默丢弃。
      parseDateKey(date)
      const settings = await deps.settings.read()
      settings.excludedByDate[date] = {
        projects: isStringArray(body.projects) ? body.projects : [],
        sessions: isStringArray(body.sessions) ? body.sessions : [],
      }
      await deps.settings.write(settings)
      return json(200, { ok: true })
    }

    if (request.method === 'POST' && path === '/commit') {
      const body = (request.body ?? {}) as Record<string, unknown>
      const week = str(body.week) ?? isoWeek(localDateKey(now))
      const settings = await deps.settings.read()
      const outputDir = expandHome(settings.outputDir)
      const repoRoot = await gitToplevel(outputDir)
      if (!repoRoot) {
        const archive = toWeeklyArchive({ committed: false, reason: 'no-git' })
        await persistWeeklyArchive(deps.store, week, archive)
        return json(200, { ok: false, committed: false, reason: 'no-git', archive })
      }
      const result = await archiveWeek({ repoRoot, outputDir, week })
      const archive = toWeeklyArchive(result)
      await persistWeeklyArchive(deps.store, week, archive)
      return json(200, {
        ok: archive.committed,
        committed: archive.committed,
        ...(archive.hash ? { hash: archive.hash } : {}),
        ...(archive.reason ? { reason: archive.reason } : {}),
        archive,
      })
    }

    return json(404, { error: { code: 'E_BAD_REQUEST', message: 'not found' } })
  } catch (error) {
    if (isPluginError(error)) {
      const status = error.code === 'E_LOCKED'
        ? 409
        : error.code === 'E_LLM_UNAVAILABLE' || error.code === 'E_LLM_BAD_OUTPUT'
          ? 502
          : error.code === 'E_WRITE_FAILED' || error.code === 'E_GIT_FAILED'
            ? 500
            : 400
      return json(status, { error: { code: error.code, message: error.message, detail: error.detail } })
    }
    return json(500, { error: { code: 'E_BAD_REQUEST', message: String(error) } })
  }
}
